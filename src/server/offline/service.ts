import "server-only";
import { createHmac } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest } from "../access/types";
import { availableRoles } from "../data/portal";
import { activeMember } from "../accounts/data";
import type { createPortalService } from "../portal/service";
import type { SavedService } from "../saved/service";
import { canonicalReadingRef } from "../../lib/readings/reading-ref";
import { congregationToday } from "../../lib/readings/public-shabbat";
import { eveningTenantFile } from "../service-course/evening";

/**
 * The installed app's owner packs (1.5 plan §3.10, A2): which of the signed-in person's own readings the device may
 * keep, as descriptors only (a kind and a canonical ref; for a member, the reading's own name). Never text or audio:
 * the device fetches those from the public routes, with no cookie. Daniel's rulings (2026-10-23):
 * - a student: their confirmed readings, through the student-mode assignedReading; none confirmed, nothing here;
 * - a member (an active tenant_member row): the three nearest upcoming saved readings, past ones skipped;
 * - tutor, admin and parent grants add nothing, and no one gets a child's reading through a parent.
 * `owner` is opaque and stable per person in this congregation, so the device can tell an account switch.
 */
export const OFFLINE_MEMBER_UPCOMING = 3;
export const OFFLINE_OWNER_PACKS = 8;
const STUDENTS = 4;
export type OfflinePackDescriptor = Readonly<{ kind: "torah" | "haftarah"; ref: string; name: string | null }>;
/** `evening`: this person may keep the CRC siddur's evening lesson text on the device (2.0 SC7): a signed-in CRC member, never another congregation. */
export type OfflinePacks = Readonly<{ owner: string; packs: readonly OfflinePackDescriptor[]; evening: boolean }>;

export function createOfflineService<Q extends PgQueryResultHKT>(input: {
  access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity" | "listStudents">;
  portal: Pick<ReturnType<typeof createPortalService<Q>>, "assignedReading">;
  saved: Pick<SavedService, "list">;
  ownerSecret: string;
  now?: () => number;
}) {
  if (typeof input.ownerSecret !== "string" || input.ownerSecret.length < 32) throw new AccessUnavailable();
  const now = input.now ?? Date.now;
  const ownerKey = (tenantId: string, userId: string) => createHmac("sha256", input.ownerSecret).update(JSON.stringify(["offline-owner:v1", tenantId, userId])).digest("base64url");

  async function packs(request: AccessRequest): Promise<OfflinePacks> {
    // One verified read: who this is in the host's tenant, and which of the two owner kinds apply now.
    const who = await input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
      const grants = identity.membership ? await availableRoles(tx, identity.tenantId, identity.membership.id) : [];
      const member = identity.membership ? await activeMember(tx, identity.tenantId, identity.membership.id) : null;
      return Object.freeze({ tenantId: identity.tenantId, userId: identity.userId, student: grants.some(grant => grant.role === "student"), member: member !== null,
        // Daniel, 2026-10-25: "Yes, for signed-in CRC people". A membership in the host's congregation, which is CRC with its evening on.
        evening: !!identity.membership && eveningTenantFile(identity.tenantId) !== null });
    });
    const out: OfflinePackDescriptor[] = [], seen = new Set<string>();
    const add = (kind: unknown, ref: unknown, name: string | null) => {
      const canonical = canonicalReadingRef(ref, kind);
      if (!canonical || out.length >= OFFLINE_OWNER_PACKS) return;
      const key = `${canonical.kind}:${canonical.ref}`;
      if (seen.has(key)) return;
      seen.add(key); out.push(Object.freeze({ kind: canonical.kind, ref: canonical.ref, name }));
    };
    if (who.student) {
      // Each service re-verifies the session and re-checks the live grant and link; a link that went away is skipped.
      let students: readonly { id: string }[] = [];
      try { students = await input.access.listStudents(request, { mode: "student", limit: STUDENTS }); }
      catch (error) { if (!(error instanceof AccessDenied) || error.status === 401) throw error; }
      for (const student of students) {
        let readings: readonly { kind: string; ranges: readonly string[] }[] = [];
        try { readings = (await input.portal.assignedReading(request, { mode: "student", studentId: student.id })).readings; }
        catch (error) { if (!(error instanceof AccessDenied) || error.status === 401) throw error; }
        for (const reading of readings) add(reading.kind, reading.ranges.join("; "), null);
      }
    }
    if (who.member) {
      let saved: readonly { name: string; date: string | null; kind: string; ranges: string; createdAt: string }[] = [];
      try { saved = (await input.saved.list(request)).readings; }
      catch (error) { if (!(error instanceof AccessDenied) || error.status === 401) throw error; }
      const today = congregationToday(now());
      const upcoming = saved.filter(row => typeof row.date === "string" && row.date >= today)
        .sort((a, b) => a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
        .slice(0, OFFLINE_MEMBER_UPCOMING);
      for (const row of upcoming) add(row.kind, row.ranges, row.name);
    }
    return Object.freeze({ owner: ownerKey(who.tenantId, who.userId), packs: Object.freeze(out), evening: who.evening });
  }
  return Object.freeze({ packs });
}
export type OfflineService = ReturnType<typeof createOfflineService>;
