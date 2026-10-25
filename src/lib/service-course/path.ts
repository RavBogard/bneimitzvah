import { TENANTS, lessonById, type Tenant } from "./course";

/**
 * A signed-in student's own path through the service course (2.0 SC4, A4 6.3): their tutor's service plan (0015), or the six
 * default parts when there is none (Batch 3b Q16). Pure: the server maps the plan's Beit Mitzvah unit ids to lessons through the
 * congregation file, and the browser reads the answer back with the strict parser below. A path carries lesson ids and printed
 * page numbers only: never a unit's name or caption, which come from the licensed feed.
 */
export type Slot = "morning" | "havdalah" | "unknown";
export type PathState = "assigned" | "no-plan" | "cleared" | "withdrawn";
export type PathItem = Readonly<{ lesson: string; page?: number }>;
export type PathPlan = Readonly<{ id: string; revision: number; catalogId: string; catalogIdentity: string }>;
export type Path = Readonly<{ ok: true; state: PathState; slot: Slot; review: boolean; items: readonly PathItem[]; serviceStart?: number; plan?: PathPlan }>;
export const PATH_LIMITS = Object.freeze({ items: 96, page: 9999 });

/** The congregation's course file, or null when it has none (A4 12: the course is not offered there). */
export const tenantFile = (tenantId: string): Tenant | null => TENANTS.find(tenant => tenant.tenant === tenantId && tenant.enabled) ?? null;

/** The base of a Beit Mitzvah unit id, without its service family ("@bm-shacharit" / "@bm-maariv", feed.ts). */
const FAMILY = /@bm-(?:shacharit|maariv)$/;
export function baseUnitId(unitId: string): string | null {
  return FAMILY.test(unitId) ? unitId.replace(FAMILY, "") : null;
}
/** The lesson that teaches a Beit Mitzvah unit, through the congregation file's `bm` ids; null for a unit no lesson teaches. */
export function lessonForUnit(tenant: Tenant, unitId: string): string | null {
  const base = baseUnitId(unitId);
  if (!base) return null;
  for (const [id, row] of Object.entries(tenant.lessons)) if (row.bm?.includes(base) && lessonById(id)) return id;
  return null;
}
/**
 * The plan's units as lessons, in the plan's (service) order: a unit with no lesson is left out silently (A4 6.3 step 4), a lesson
 * two units map to is listed once, and each keeps the printed page of its first unit.
 */
export function assignedItems(tenant: Tenant, units: readonly Readonly<{ id: string; page?: number }>[]): PathItem[] {
  const items: PathItem[] = [], seen = new Set<string>();
  for (const unit of units) {
    const lesson = lessonForUnit(tenant, unit.id);
    if (!lesson || seen.has(lesson)) continue;
    seen.add(lesson);
    items.push(Object.freeze(validPage(unit.page) ? { lesson, page: unit.page } : { lesson }));
  }
  return items;
}
/**
 * The congregation's default path with this learner's pages. An unknown slot reads the morning's pages (with its own line on the
 * home); an evening learner whose page the file does not have yet gets no page rather than the morning's.
 */
export function defaultItems(tenant: Tenant, slot: Slot): PathItem[] {
  return tenant.defaultPath.filter(id => lessonById(id)).map(lesson => {
    const pages = tenant.lessons[lesson]?.pages, page = slot === "havdalah" ? pages?.evening : pages?.morning;
    return Object.freeze(validPage(page) ? { lesson, page } : { lesson });
  });
}
const validPage = (page: unknown): page is number => Number.isSafeInteger(page) && (page as number) >= 1 && (page as number) <= PATH_LIMITS.page;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, IDENTITY = /^[a-f0-9]{64}$/;
/** The path route's answer, strictly: an unknown key, a lesson the course does not know or a malformed page is no answer. */
export function parsePath(value: unknown): Path | null {
  try {
    if (!isRecord(value)) return null;
    const keys = Object.keys(value);
    if (keys.some(key => !["ok", "state", "slot", "review", "items", "serviceStart", "plan"].includes(key))) return null;
    if (value.ok !== true || !["assigned", "no-plan", "cleared", "withdrawn"].includes(value.state as string) || !["morning", "havdalah", "unknown"].includes(value.slot as string)
      || typeof value.review !== "boolean" || !Array.isArray(value.items) || value.items.length > PATH_LIMITS.items) return null;
    const items: PathItem[] = [], seen = new Set<string>();
    for (const item of value.items) {
      if (!isRecord(item) || Object.keys(item).some(key => key !== "lesson" && key !== "page") || typeof item.lesson !== "string" || !lessonById(item.lesson) || seen.has(item.lesson)) return null;
      if (item.page !== undefined && !validPage(item.page)) return null;
      seen.add(item.lesson);
      items.push(Object.freeze(item.page === undefined ? { lesson: item.lesson } : { lesson: item.lesson, page: item.page as number }));
    }
    if (value.serviceStart !== undefined && !validPage(value.serviceStart)) return null;
    let plan: PathPlan | undefined;
    if (value.plan !== undefined) {
      const p = value.plan;
      if (!isRecord(p) || Object.keys(p).length !== 4 || typeof p.id !== "string" || !UUID.test(p.id) || !Number.isSafeInteger(p.revision) || (p.revision as number) < 1
        || typeof p.catalogId !== "string" || !UUID.test(p.catalogId) || typeof p.catalogIdentity !== "string" || !IDENTITY.test(p.catalogIdentity)) return null;
      plan = Object.freeze({ id: p.id, revision: p.revision as number, catalogId: p.catalogId, catalogIdentity: p.catalogIdentity });
    }
    if ((value.state === "cleared" || value.state === "withdrawn") && items.length) return null;
    return Object.freeze({ ok: true as const, state: value.state as PathState, slot: value.slot as Slot, review: value.review, items: Object.freeze(items),
      ...(value.serviceStart !== undefined ? { serviceStart: value.serviceStart as number } : {}), ...(plan ? { plan } : {}) });
  } catch { return null; }
}
