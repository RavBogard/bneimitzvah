import { childLearnHref } from "../learn/child-practice";

export type AssignedLessonTarget =
  | { studentId: string; source: "music"; rowId: string; key: string }
  | { studentId: string; source: "plan"; planId: string; revision: number; catalogIdentity: string; unitId: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const prefix = "#assigned-part=";
function boundedId(value: unknown) { return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value); }

export function assignedLessonHref(lessonId: string, target: AssignedLessonTarget, child: boolean) {
  const href = `/learn/service/${encodeURIComponent(lessonId)}${prefix}${encodeURIComponent(JSON.stringify(target))}`;
  return child ? childLearnHref(href) : href;
}

export function assignedLessonTarget(hash: string): AssignedLessonTarget | null {
  if (!hash.startsWith(prefix) || hash.length > 2000) return null;
  try {
    const row = JSON.parse(decodeURIComponent(hash.slice(prefix.length)));
    if (!row || typeof row.studentId !== "string" || !uuid.test(row.studentId)) return null;
    if (row.source === "music" && Object.keys(row).length === 4 && boundedId(row.rowId) && typeof row.key === "string" && digest.test(row.key))
      return { studentId: row.studentId, source: row.source, rowId: row.rowId, key: row.key };
    if (row.source === "plan" && Object.keys(row).length === 6 && typeof row.planId === "string" && uuid.test(row.planId)
      && Number.isSafeInteger(row.revision) && row.revision > 0 && typeof row.catalogIdentity === "string" && digest.test(row.catalogIdentity) && boundedId(row.unitId))
      return { studentId: row.studentId, source: row.source, planId: row.planId, revision: row.revision, catalogIdentity: row.catalogIdentity, unitId: row.unitId };
  } catch { /* Unknown fragments are ordinary lesson links. */ }
  return null;
}

export function assignedPartsHref(childId?: string, target?: AssignedLessonTarget) {
  const path = childId ? `/workspace/practice/${encodeURIComponent(childId)}` : "/mine/reading";
  const selection = target ? `?${new URLSearchParams({ source: target.source, part: target.source === "music" ? target.rowId : target.unitId })}` : "";
  return `${path}#service-parts${selection}`;
}

export function assignedPartReturn(hash: string) {
  if (!hash.startsWith("#service-parts?") || hash.length > 1000) return null;
  const params = new URLSearchParams(hash.slice("#service-parts?".length)), source = params.get("source"), part = params.get("part");
  return (source === "music" || source === "plan") && part && boundedId(part) ? { source, part } : null;
}
