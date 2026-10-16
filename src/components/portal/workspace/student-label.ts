import type { Student } from "./api";

export function reconcileSelectedStudent(rows: Student[], selectedId: string | null, current: Student): Student[] {
  if (current.id !== selectedId) return rows;
  const existing = rows.find(row => row.id === selectedId);
  if (!existing || current.revision < existing.revision) return rows;
  if (current.revision === existing.revision && current.firstName === existing.firstName && current.lastName === existing.lastName && current.ceremonyDate === existing.ceremonyDate) return rows;
  return rows.map(row => row.id === selectedId ? current : row);
}
