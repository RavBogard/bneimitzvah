import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest } from "../access/types";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import * as data from "../data/tenant-settings";
import * as s from "../db/index";
import { DEFAULT_SIDDUR_URL, legacyRabbiName, SERVICE_SLOTS, validateSettings, type CongregationSettings, type ServiceSetting, type ServiceSlot } from "./validation";

type Failure = Readonly<{ ok: false; code: "conflict" | "no-change" | "invalid"; problems?: readonly string[] }>;
export type SettingsSaveResult = Failure | Readonly<{ ok: true; replayed: boolean; version: number }>;
export type CongregationDisplay = Readonly<{
  links: Readonly<{ siddurUrl: string; musicUrl: string | null }>;
  services: Readonly<Partial<Record<ServiceSlot, ServiceSetting>>>; consentNotice: string | null;
}>;
export type SettingsView = Readonly<{
  version: number; settings: CongregationSettings; updatedAt: string | null;
  // What each field falls back to when it is left blank, so the page can say so.
  defaults: Readonly<{ rabbiDisplayName: string; siddurUrl: string }>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: Failure["code"], problems?: readonly string[]): Failure => Object.freeze({ ok: false, code, ...(problems ? { problems: Object.freeze([...problems]) } : {}) });
/** Key-sorted JSON so a body compares equal after jsonb has reordered its keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const settingsDigest = (expected: number, body: CongregationSettings) => createHash("sha256").update(canonical(["tenant-settings/v1", expected, body])).digest("hex");
const versionOf = (value: unknown): number => { if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 2147483646) throw new AccessDenied(403); return value as number; };
const mutationOf = (value: unknown): string => { if (typeof value !== "string" || !UUID.test(value)) throw new AccessDenied(403); return value.toLowerCase(); };
const frozen = (settings: CongregationSettings): CongregationSettings => JSON.parse(JSON.stringify(settings));

/**
 * Congregation settings. Writes need the admin grant in admin mode ("manage-defaults"): in this
 * product the admin grant is the rabbi/clergy (study spec S21), so no separate clergy capability
 * exists yet. Every save is a new version bound to expectedVersion and a mutation id receipt.
 */
export function createCongregationSettingsService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>> }) {
  async function read(request: AccessRequest): Promise<SettingsView> {
    return input.access.withAdminCapability(request, { mode: "admin", capability: "read-defaults" }, async (tx, actor) => {
      const head = await data.settingsHead(tx, actor.tenantId), checked = head ? validateSettings(head.body) : null;
      const [tenant] = await tx.select({ customs: s.tenant.customs }).from(s.tenant).where(eq(s.tenant.id, actor.tenantId)).limit(1);
      return Object.freeze({ version: head?.version ?? 0, settings: checked?.ok ? frozen(checked.value) : {}, updatedAt: head ? head.createdAt.toISOString() : null,
        defaults: Object.freeze({ rabbiDisplayName: legacyRabbiName(tenant?.customs) ?? "the rabbi", siddurUrl: DEFAULT_SIDDUR_URL }) });
    });
  }
  async function save(request: CookieMutationRequest, supplied: { expectedVersion: unknown; settings: unknown; mutationId: unknown }): Promise<SettingsSaveResult> {
    const expected = versionOf(supplied.expectedVersion), mutationId = mutationOf(supplied.mutationId), checked = validateSettings(supplied.settings);
    if (!checked.ok) return fail("invalid", checked.problems);
    const body = frozen(checked.value), digest = settingsDigest(expected, body);
    const replay = (row: data.SettingsRow) => row.requestDigest === digest ? Object.freeze({ ok: true as const, replayed: true, version: row.version }) : fail("conflict");
    return input.access.withAdminCapability(request, { mode: "admin", capability: "manage-defaults" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      const prior = await data.settingsReceipt(tx, actor, mutationId); if (prior) return replay(prior);
      const head = await data.settingsHead(tx, actor.tenantId);
      if ((head?.version ?? 0) !== expected) return fail("conflict");
      if (head && canonical(head.body) === canonical(body)) return fail("no-change");
      if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
      const row = await data.appendSettings(tx, actor, { expected, body, mutationId, digest });
      if (row) return Object.freeze({ ok: true as const, replayed: false, version: row.version });
      const raced = await data.settingsReceipt(tx, actor, mutationId); return raced ? replay(raced) : fail("conflict");
    });
  }
  /**
   * What every member's pages show from the settings: the links, the service names and start times,
   * and the consent notice. Any signed-in member of the congregation may read them; none is private.
   */
  async function display(request: AccessRequest): Promise<CongregationDisplay> {
    return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      const settings = await data.currentSettings(tx, identity.tenantId);
      const configured = settings?.services ?? {};
      const services = Object.fromEntries(SERVICE_SLOTS.flatMap(slot => configured[slot] ? [[slot, { ...configured[slot] }]] : []));
      return JSON.parse(JSON.stringify({ links: { siddurUrl: settings?.siddurUrl ?? DEFAULT_SIDDUR_URL, musicUrl: settings?.musicUrl ?? null },
        services, consentNotice: settings?.consentNotice ?? null })) as CongregationDisplay;
    });
  }
  return Object.freeze({ read, save, display });
}
