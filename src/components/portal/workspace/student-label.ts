import type { Student } from "./api";

export function reconcileSelectedStudent(rows: Student[], selectedId: string | null, current: Student): Student[] {
  if (current.id !== selectedId) return rows;
  const existing = rows.find(row => row.id === selectedId);
  if (!existing || current.revision < existing.revision) return rows;
  if (current.revision === existing.revision && current.firstName === existing.firstName && current.lastName === existing.lastName && current.ceremonyDate === existing.ceremonyDate) return rows;
  // Reading metadata never supplies list capability. Keep the latest list verdict,
  // including a false/missing verdict after quiet revalidation.
  const { ownAdultHonors: _ignored, ...metadata } = current;
  const updated = !Object.hasOwn(existing, "ownAdultHonors") && !Object.hasOwn(current, "ownAdultHonors") ? current : { ...metadata, ...(Object.hasOwn(existing, "ownAdultHonors") ? { ownAdultHonors: existing.ownAdultHonors } : {}) };
  return rows.map(row => row.id === selectedId ? updated : row);
}
