import "server-only";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import type { StudentView } from "../data/students";
import { confirmedReadings } from "../data/portal";
import * as s from "../db/index";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { aliyahStarts } from "../../lib/readings/aliyah-starts";
import { assignmentNeedsReview } from "../../lib/readings/review";
import type { HonorsContext, HonorsContextView, HonorsForm } from "../../lib/honors/types";
import { hash, LIMITS } from "./validation";
import { closedObject } from "../http/query";
import { uuid, integer } from "../student-work/validation";
import { parseCeremonyDate } from "../../lib/readings/ranges";
const unavailable = (): never => { throw new Error("Honors context unavailable"); };
export function view(snapshot: HonorsContext): HonorsContextView {
  const torah = snapshot.torah, starts = torah?.cuts === null || !torah ? [] : [torah.verses[0], ...torah.cuts];
  const spans = starts.map((startVerse, i) => ({ startVerse, endVerse: i + 1 === starts.length ? torah!.verses.at(-1)! : torah!.verses[torah!.verses.indexOf(starts[i + 1]) - 1] }));
  return Object.freeze({ hash: hash(snapshot), snapshot, spans: Object.freeze(spans), status: !torah ? "unassigned" : torah.cuts === null ? "unresolved-cuts" : "assigned",
    unknownSlot: snapshot.serviceSlot === "unknown", readingNeedsReview: !!torah && (torah.confirmation.needsReview || torah.confirmation.serviceSlot !== snapshot.serviceSlot) });
}
export function storedView(input: HonorsContext, expectedHash: string): HonorsContextView {
  try {
    const value = closedObject(input, ["schemaVersion", "tenantId", "studentId", "ceremonyDate", "serviceSlot", "torah"]);
    if (value.schemaVersion !== 1 || typeof value.tenantId !== "string" || !value.tenantId || value.tenantId.length > 128 || uuid(value.studentId) !== value.studentId || parseCeremonyDate(value.ceremonyDate as string) !== value.ceremonyDate || !["morning", "havdalah", "unknown"].includes(value.serviceSlot as string)) return unavailable();
    if (value.torah !== null) {
      const torah = closedObject(value.torah, ["id", "revision", "ref", "basis", "confirmation", "verses", "cuts"]);
      if (uuid(torah.id) !== torah.id || integer(torah.revision, 1, 2147483647) !== torah.revision || !["custom", "full", "selection", "triennial"].includes(torah.basis as string) || typeof torah.ref !== "string") return unavailable();
      const verses = expandReadingRanges(torah.ref.split(/;\s*/), "torah", TANAKH_VERSE_COUNTS);
      if (!verses.length || verses.length > 1000 || JSON.stringify(verses) !== JSON.stringify(torah.verses)) return unavailable();
      if (JSON.stringify(aliyahStarts("torah", torah.cuts, verses)) !== JSON.stringify(torah.cuts)) return unavailable();
      const facts = closedObject(torah.confirmation, ["confirmationDate", "serviceSlot", "slotProvenance", "needsReview"]);
      if (facts.confirmationDate !== null && parseCeremonyDate(facts.confirmationDate as string) !== facts.confirmationDate || facts.serviceSlot !== null && !["morning", "havdalah", "unknown"].includes(facts.serviceSlot as string)
        || facts.slotProvenance !== null && (typeof facts.slotProvenance !== "number" || !Number.isFinite(facts.slotProvenance)) || typeof facts.needsReview !== "boolean") return unavailable();
    }
    // jsonb does not preserve object key order. Rebuild the same canonical
    // snapshot used at capture before verifying its hash or returning history.
    const t = input.torah;
    const canonical: HonorsContext = { schemaVersion: 1, tenantId: input.tenantId, studentId: input.studentId, ceremonyDate: input.ceremonyDate, serviceSlot: input.serviceSlot,
      torah: t === null ? null : { id: t.id, revision: t.revision, ref: t.ref, basis: t.basis,
        confirmation: { confirmationDate: t.confirmation.confirmationDate, serviceSlot: t.confirmation.serviceSlot, slotProvenance: t.confirmation.slotProvenance, needsReview: t.confirmation.needsReview },
        verses: [...t.verses], cuts: t.cuts === null ? null : [...t.cuts] } };
    if (Buffer.byteLength(JSON.stringify(canonical)) > LIMITS.contextBytes || hash(canonical) !== expectedHash) return unavailable();
    return view(canonical);
  } catch { return unavailable(); }
}
export async function capture<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: StudentActor, student: StudentView): Promise<HonorsContextView> {
  const [row] = await tx.select({ slot: s.student.serviceSlot }).from(s.student).where(and(eq(s.student.tenantId, actor.tenantId), eq(s.student.id, student.id)));
  if (!row || !["morning", "havdalah", "unknown"].includes(row.slot)) return unavailable();
  const readings = await confirmedReadings(tx, actor.tenantId, student.id), reading = readings.find(r => r.kind === "torah");
  let torah: HonorsContext["torah"] = null;
  if (reading) {
    const verses = expandReadingRanges(reading.ref.split(/;\s*/), "torah", TANAKH_VERSE_COUNTS);
    if (!verses.length || verses.length > 1000 || JSON.stringify(verses) !== JSON.stringify(reading.verses)) return unavailable();
    let cuts; try { cuts = aliyahStarts("torah", reading.aliyahStarts, verses); } catch { return unavailable(); }
    const facts = reading.snapshot;
    torah = Object.freeze({ id: reading.id, revision: reading.revision, ref: reading.ref, basis: reading.basis,
      confirmation: Object.freeze({ confirmationDate: typeof facts?.confirmationDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(facts.confirmationDate) ? facts.confirmationDate : null,
        serviceSlot: ["morning", "havdalah", "unknown"].includes(facts?.serviceSlot as string) ? facts!.serviceSlot as string : null, slotProvenance: typeof facts?.slotProvenance === "number" && Number.isFinite(facts.slotProvenance) ? facts.slotProvenance : null,
        needsReview: assignmentNeedsReview(facts, student.ceremonyDate) }), verses: Object.freeze(verses), cuts: cuts === null ? null : Object.freeze(cuts) });
  }
  const snapshot: HonorsContext = Object.freeze({ schemaVersion: 1, tenantId: actor.tenantId, studentId: student.id, ceremonyDate: student.ceremonyDate, serviceSlot: row.slot, torah });
  return storedView(snapshot, hash(snapshot));
}
export function validMappings(form: HonorsForm, context: HonorsContextView): boolean {
  let previous = -1;
  return form.aliyot.every(row => { const index = context.spans.findIndex(span => span.startVerse === row.startVerse); if (index <= previous) return false; previous = index; return true; });
}
