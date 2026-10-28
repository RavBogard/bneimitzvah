import type { Student } from "./api";

// A route id is only honoured when it is in this account's authorized list; an unknown one never falls back to another student.
export function selectAuthorizedStudent(rows: readonly { id: string }[], previous: string | null, routeId: string | null | undefined, mode: string): string | null {
  if (previous && rows.some(row => row.id === previous)) return previous;
  if (routeId) return rows.some(row => row.id === routeId) ? routeId : null;
  return (mode === "student" || mode === "parent") && rows.length === 1 ? rows[0].id : null;
}

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

/**
 * The order a person sees their students in: the nearest ceremony first, a missing or unreadable date last, then by name.
 * The list the page holds stays in the server's paging order (its cursor is the last row's id); only the view is sorted.
 */
export function sortStudentsByCeremony<T extends Pick<Student, "ceremonyDate" | "firstName" | "lastName">>(rows: readonly T[]): T[] {
  const dated = (row: T) => /^\d{4}-\d{2}-\d{2}/.test(row.ceremonyDate ?? "");
  return [...rows].sort((a, b) => Number(!dated(a)) - Number(!dated(b))
    || (dated(a) && dated(b) ? (a.ceremonyDate < b.ceremonyDate ? -1 : a.ceremonyDate > b.ceremonyDate ? 1 : 0) : 0)
    || a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
}
