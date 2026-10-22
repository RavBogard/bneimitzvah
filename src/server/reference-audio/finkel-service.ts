import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, ActiveMode } from "../access/types";
import { AccessDenied } from "../access/errors";
import { lockRoleGrant } from "../data/authority";
import type { ReferenceCatalogGet } from "./storage";
import { readVerifiedReviewBytes } from "../reference-review/batch-storage";
import { FINKEL_CLIPS_SCHEMA, FINKEL_LIMITS, FINKEL_SOURCE, finkelDigest, finkelVerse, type FinkelClips } from "../../lib/reference-audio/finkel";
import { FINKEL_MANIFEST_BYTES, FinkelUnavailable, findFinkelClips, findFinkelMedia, finkelAudioKey, finkelManifestKey, parseFinkelManifest, type FinkelManifest } from "./finkel-manifest";

/** The recordings are licensed to CRC; no other congregation is served. */
export const FINKEL_TENANT = "crc";
type Request = AccessRequest & { signal?: AbortSignal };
type Binding = Readonly<{ tenantId: string; userId: string; authSessionId: string; sessionExpiresAt: number; membershipId: string;
  authorityRevision: number; roleGrantId: string; roleGrantRevision: number; mode: ActiveMode }>;
const MODES: readonly ActiveMode[] = ["student", "parent", "tutor", "admin"];
const same = (a: Binding, b: Binding) => (Object.keys(a) as (keyof Binding)[]).every(key => a[key] === b[key]);
let cached: Readonly<{ sha256: string; manifest: FinkelManifest }> | undefined;

/** Finkel playback beside PocketTorah. The release rule is PocketTorah's own:
 * students, parents and tutors hear reference audio only once the shared
 * student release is on; until then only a live admin grant in admin mode may
 * read the clip list or the bytes. Every read authorizes twice, before and
 * after provider work, and the second pass must match the first. */
export function createFinkelReferenceService<Q extends PgQueryResultHKT>(input: {
  access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity">;
  manifestSha256?: string; get: ReferenceCatalogGet; studentRelease?: boolean;
}) {
  const released = input.studentRelease === true, pin = input.manifestSha256, get = input.get;
  if (pin !== undefined && !finkelDigest(pin)) throw new FinkelUnavailable();
  const listeningEnabled = (mode: string) => pin !== undefined && (released || mode === "admin");
  const connected = (request: Request) => { if (request.signal?.aborted) throw new FinkelUnavailable(); };
  async function authorize(request: Request, mode: ActiveMode): Promise<Binding> {
    // Deny before any database or provider work when the hold applies.
    if (!MODES.includes(mode) || !listeningEnabled(mode)) throw new AccessDenied(404);
    connected(request);
    const binding = await input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
      if (identity.tenantId !== FINKEL_TENANT || !identity.membership) throw new AccessDenied(404);
      const grant = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, mode, "read");
      if (!grant || grant.revokedAt) throw new AccessDenied(404);
      return Object.freeze({ tenantId: identity.tenantId, userId: identity.userId, authSessionId: identity.authSessionId,
        sessionExpiresAt: identity.sessionExpiresAt.getTime(), membershipId: identity.membership.id, authorityRevision: identity.membership.authorityRevision,
        roleGrantId: grant.id, roleGrantRevision: grant.revision, mode });
    });
    connected(request); if (binding.sessionExpiresAt <= Date.now()) throw new AccessDenied(401);
    return binding;
  }
  async function reauthorize(request: Request, first: Binding) {
    const second = await authorize(request, first.mode);
    if (!same(first, second)) throw new AccessDenied(404);
    return second;
  }
  async function manifest(signal?: AbortSignal): Promise<FinkelManifest> {
    if (!pin) throw new FinkelUnavailable();
    if (cached?.sha256 === pin) return cached.manifest;
    try {
      const parsed = parseFinkelManifest(await readVerifiedReviewBytes(get, finkelManifestKey(pin), pin, FINKEL_MANIFEST_BYTES, signal), pin);
      // One immutable completed success only; never a promise or a failure.
      cached = Object.freeze({ sha256: pin, manifest: parsed }); return parsed;
    } catch { throw new FinkelUnavailable(); }
  }
  return Object.freeze({
    listeningEnabled,
    /** Internal composition only (no HTTP route calls this): the pinned manifest, unauthorized. */
    loadManifest: manifest,
    /** Clips overlapping [from, to] in one book, or every clip for an admin's review list. */
    async clips(request: Request, selection: Readonly<{ mode: ActiveMode; from?: string; to?: string }>): Promise<FinkelClips & { sessionExpiresAt: number }> {
      const ranged = selection.from !== undefined || selection.to !== undefined;
      if (ranged) { const a = finkelVerse(selection.from), b = finkelVerse(selection.to); if (!a || !b || a.book !== b.book) throw new AccessDenied(404); }
      else if (selection.mode !== "admin") throw new AccessDenied(404);
      const first = await authorize(request, selection.mode);
      const loaded = await manifest(request.signal); connected(request);
      const found = ranged ? findFinkelClips(loaded, selection.from!, selection.to!) : loaded.clips;
      // Before release, students never get here; after it, they hear the chosen take only.
      const clips = first.mode === "admin" ? found : found.filter(clip => clip.preferred);
      const final = await reauthorize(request, first);
      const result = Object.freeze({ schema: FINKEL_CLIPS_SCHEMA, source: FINKEL_SOURCE, pin: loaded.sha256, clips: Object.freeze([...clips]), sessionExpiresAt: final.sessionExpiresAt });
      if (Buffer.byteLength(JSON.stringify(result)) > FINKEL_LIMITS.responseBytes) throw new FinkelUnavailable();
      return result;
    },
    /** Whole, verified bytes of one manifest clip; never a range, redirect or provider URL. */
    async media(request: Request, selection: Readonly<{ mode: ActiveMode; sha256: string }>) {
      if (!finkelDigest(selection.sha256)) throw new AccessDenied(404);
      const first = await authorize(request, selection.mode);
      const loaded = await manifest(request.signal); connected(request);
      const clip = findFinkelMedia(loaded, selection.sha256);
      if (!clip || first.mode !== "admin" && !clip.preferred) throw new AccessDenied(404);
      let bytes: Uint8Array<ArrayBuffer>;
      try { bytes = await readVerifiedReviewBytes(get, finkelAudioKey(clip.sha256), clip.sha256, clip.bytes, request.signal, clip.bytes); }
      catch { throw new FinkelUnavailable(); }
      const final = await reauthorize(request, first);
      return Object.freeze({ bytes, sessionExpiresAt: final.sessionExpiresAt });
    },
  });
}
export type FinkelReferenceService = ReturnType<typeof createFinkelReferenceService>;
/** Test seam only: forget the one cached manifest. */
export function resetFinkelManifestCache() { cached = undefined; }
