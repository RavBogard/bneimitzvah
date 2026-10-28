import "server-only";
import { createHmac } from "node:crypto";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { ActiveMode, AccessRequest, AccessTransaction, VerifiedIdentity } from "../access/types";
import type { createPracticeService } from "../practice/service";
import type { PracticeContextView } from "../practice/types";
import type { StudentView } from "../data/students";
import { confirmedReadings, availableRoles, membershipOf } from "../data/portal";
import { obtainMembership } from "../data/invitations";
import { activeMember, approves } from "../accounts/data";
import { expandReadingRanges, parseCeremonyDate } from "../../lib/readings/ranges";
import { assignmentNeedsReview } from "../../lib/readings/review";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { aliyahStarts } from "../../lib/readings/aliyah-starts";
import { assignmentReadingKey } from "../../lib/readings/reading-key";
import type { Snapshot } from "../../lib/readings/proposals";

const object = (input: unknown): Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
function date(input: unknown) { try { return parseCeremonyDate(input); } catch { return null; } }
export function readingView(row: Awaited<ReturnType<typeof confirmedReadings>>[number], ceremonyDate: string) {
  if ((row.kind !== "torah" && row.kind !== "haftarah") || !["triennial", "selection", "full", "custom"].includes(row.basis)) throw new Error("Unsupported confirmed reading");
  // Treat ref/snapshot as data, not arbitrary display strings or JSON. Only
  // canonical references and explicitly selected source metadata leave here.
  const ranges = row.ref.split(/;\s*/);
  const expected = expandReadingRanges(ranges, row.kind, TANAKH_VERSE_COUNTS);
  if (expected.length !== row.verses.length || expected.some((ref, index) => ref !== row.verses[index])) throw new Error("Confirmed reading is inconsistent");
  const snapshot = object(row.snapshot), source = object(snapshot.source), leyning = object(source.reading);
  const confirmationDate = date(snapshot.confirmationDate);
  const sourceStatus = snapshot.sourceStatus === "available" || snapshot.sourceStatus === "unavailable" ? snapshot.sourceStatus : "unknown";
  const sourceFetchedAt = typeof snapshot.sourceFetchedAt === "number" && Number.isFinite(snapshot.sourceFetchedAt) && snapshot.sourceFetchedAt >= 0 ? snapshot.sourceFetchedAt : null;
  return Object.freeze({ id: row.id, status: "confirmed" as const, kind: row.kind, basis: row.basis, revision: row.revision, ranges: Object.freeze(ranges), verses: Object.freeze(row.verses),
    confirmationDate, needsReview: assignmentNeedsReview(snapshot, ceremonyDate), aliyahStarts:aliyahStarts(row.kind,row.aliyahStarts,expected),
    // Derived, never stored: the signed Hebcal snapshot and the verses decide which study guide applies.
    readingKey: assignmentReadingKey(source as unknown as Snapshot, row.kind, expected, TANAKH_VERSE_COUNTS),
    source: Object.freeze({ status: sourceStatus, fetchedAt: sourceFetchedAt, date: snapshot.slotProvenance===1 ? date(snapshot.readingDate) : date(source.date),
      calendar: source.calendar === "diaspora" || source.calendar === "israel" ? source.calendar : null,
      attribution: leyning.source === "Hebcal" ? Object.freeze({ name: "Hebcal", url: "https://www.hebcal.com/" }) : null }) });
}

export function createPortalService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>; sessionBindingSecret: string }) {
  if (typeof input.sessionBindingSecret !== "string" || input.sessionBindingSecret.length < 32) throw new AccessUnavailable();
  /**
   * One summary for both entrances. `saved`: this account keeps its own saved layer, which since readings for everyone
   * (Daniel, 2026-10-27) is every live membership; `approver`: it may approve link requests. The Member role (an approved
   * request) and approving are worked out live, never granted (accounts plan choice B).
   */
  async function summarize(tx: AccessTransaction<Q>, identity: VerifiedIdentity, membership: VerifiedIdentity["membership"]) {
    const grants = membership ? await availableRoles(tx, identity.tenantId, membership.id) : [];
    const member = membership ? await activeMember(tx, identity.tenantId, membership.id) : null;
    const approver = membership ? await approves(tx, identity.tenantId, membership.id) : false;
    const sessionBinding = createHmac("sha256", input.sessionBindingSecret).update(JSON.stringify(["session-ui-binding:v2", identity.origin, identity.tenantId, identity.userId,
      identity.authSessionId, membership?.id ?? null, membership?.authorityRevision ?? null, grants.map(grant => [grant.role, grant.id, grant.revision]),
      member?.id ?? null, approver])).digest("base64url");
    return Object.freeze({ membershipAvailable: membership !== null, roles: Object.freeze(grants.map(grant => grant.role)), saved: membership !== null, approver, sessionBinding });
  }
  async function sessionSummary(request: AccessRequest) {
    return input.access.withVerifiedIdentity(request, { intent: "read" }, (tx, identity) => summarize(tx, identity, identity.membership));
  }
  /**
   * The first sign-in's membership (plan D1): called once by the entry after a summary with no membership, under the
   * cookie-mutation rule (POST, exact Origin). A verified, enabled account in the host's tenant gets its membership row
   * here, as accepting an invitation would have made it; a disabled one is refused before anything is written (403). The
   * answer is the same summary sessionSummary builds, now with a shelf. Idempotent: a membership that exists is reused.
   */
  async function beginSession(request: AccessRequest & { method?: string }) {
    return input.access.withVerifiedIdentity(request, { intent: "data-write", mutation: true }, async (tx, identity) => {
      const membershipId = await obtainMembership(tx, identity);
      const membership = await membershipOf(tx, identity.tenantId, membershipId);
      if (!membership || membership.disabledAt) throw new AccessDenied(403);
      return summarize(tx, identity, Object.freeze({ id: membership.id, authorityRevision: membership.authorityRevision }));
    });
  }
  async function assignedReading(request: AccessRequest, selection: { mode: ActiveMode | "child-practice"; studentId: string }) {
    if (selection.mode === "child-practice") {
      return input.practice.withPracticeCapability(request, { mode: "child-practice", studentId: selection.studentId, capability: "read" }, async (tx, actor, student) =>
        Object.freeze({ student, mode: actor.mode, context: actor.context, readings: Object.freeze((await confirmedReadings(tx, actor.tenantId, student.id)).map(row => readingView(row, student.ceremonyDate))) }));
    }
    return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, async (tx, actor, student) =>
      Object.freeze({ student: student as StudentView, mode: actor.mode, context: null as PracticeContextView | null,
        readings: Object.freeze((await confirmedReadings(tx, actor.tenantId, student.id)).map(row => readingView(row, student.ceremonyDate))) }));
  }
  return Object.freeze({ sessionSummary, beginSession, assignedReading });
}
