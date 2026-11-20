import type { Student } from "../workspace/api";
import type { Learner } from "./api";

export const learnerShelfHref = (membershipId: string) => `/mine/learner/${encodeURIComponent(membershipId)}`;

export type StudentRow = Readonly<{ key: string; name: string; ceremonyDate: string | null; note: string | null; href: string; studentId?: string; rehearsal1?: string | null; rehearsal2?: string | null }>;

/** Dated students by ceremony, earliest first; then the claimed learners with no student record, by name. Linked students are not listed twice. */
export function studentRows(students: readonly Student[], learners: readonly Learner[], notes: ReadonlyMap<string, string | null> = new Map()): StudentRow[] {
  const dated = [...students].sort((a, b) => a.ceremonyDate.localeCompare(b.ceremonyDate) || a.id.localeCompare(b.id))
    .map(student => ({ key: `student:${student.id}`, name: `${student.firstName} ${student.lastName}`, ceremonyDate: student.ceremonyDate, note: notes.get(student.id) ?? null, href: `/workspace/tutor/${encodeURIComponent(student.id)}`,
      studentId: student.id, rehearsal1: student.rehearsal1 ?? null, rehearsal2: student.rehearsal2 ?? null }));
  const known = new Set(students.map(student => student.id));
  const claimed = learners.filter(row => row.tutor?.mine && !(row.student && known.has(row.student.id))).sort((a, b) => a.name.localeCompare(b.name))
    .map(row => ({ key: `learner:${row.membershipId}`, name: row.name, // With no student record, the date is the learner's nearest saved reading (tutor walk 2026-10-28, finding 10).
      ceremonyDate: row.student?.ceremonyDate ?? row.nearest?.date ?? null, note: null, href: learnerShelfHref(row.membershipId) }));
  return [...dated, ...claimed];
}
