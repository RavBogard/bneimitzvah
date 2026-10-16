import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { ActiveMode, AccessRequest } from "../access/types";
import type { createPracticeService } from "../practice/service";
import type { PracticeContextView } from "../practice/types";
import type { StudentView } from "../data/students";
import { confirmedReadings, availableRoles } from "../data/portal";
import { expandReadingRanges, parseCeremonyDate } from "../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";

const object = (input: unknown): Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
function date(input: unknown) { try { return parseCeremonyDate(input); } catch { return null; } }
function readingView(row: Awaited<ReturnType<typeof confirmedReadings>>[number], ceremonyDate: string) {
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
    confirmationDate, needsReview: snapshot.needsReview !== false || confirmationDate !== ceremonyDate,
    source: Object.freeze({ status: sourceStatus, fetchedAt: sourceFetchedAt, date: date(source.date),
      calendar: source.calendar === "diaspora" || source.calendar === "israel" ? source.calendar : null,
      attribution: leyning.source === "Hebcal" ? Object.freeze({ name: "Hebcal", url: "https://www.hebcal.com/" }) : null }) });
}

export function createPortalService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>> }) {
  async function sessionSummary(request: AccessRequest) {
    return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => Object.freeze({
      membershipAvailable: identity.membership !== null,
      roles: Object.freeze(identity.membership ? (await availableRoles(tx, identity.tenantId, identity.membership.id)).map(grant => grant.role) : []),
    }));
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
  return Object.freeze({ sessionSummary, assignedReading });
}
