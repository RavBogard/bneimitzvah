import { parseReadAddress } from "../../components/portal/public-reading/urls";
import { COURSE, lessonById, practiceById } from "../learn/course";
import { NAMED_READINGS } from "../readings/named-readings";
import { PAGE_VIEW_BODY_LIMIT } from "./page-view-route";

/**
 * Which public page a beacon names, as the one path the counter stores (Daniel: "path and day only"). The browser sends
 * its own pathname and query; this is the only place that reads them, and it keeps nothing of the query but a catalog
 * slug. Every result is one of publicPageViewPaths(), a fixed list built from the code (about 140 paths), so no request
 * can add a path of its own. Anything else, including a member's saved reading (`/read?saved=<id>`), is null and dropped.
 *
 * - `/read`, `/read?date=…`, `&kind=`, `&verse=`, `&lens=`: the weekly page, `/read`.
 * - `/read?reading=<slug>` (any `&passage=`): `/read/<slug>`, for a slug in the named-reading catalog.
 * - `/read?ref=<canonical ref>&kind=…`: "Any reading", one bucket, `/read/any`; the passage itself is not kept.
 * - `/learn`, `/learn/about`, `/learn/review`, `/learn/<lesson id>` for a lesson in the course, `/learn/practice/<id>` for a
 *   practice run (1.6, Quick ten), and `/trope-chart`.
 */
export const READ_ANY_PATH = "/read/any";
const FIXED = Object.freeze(["/read", READ_ANY_PATH, "/learn", "/learn/about", "/learn/review", "/trope-chart"]);

export function publicPageViewPaths(): readonly string[] {
  return Object.freeze([...FIXED, ...NAMED_READINGS.map(reading => `/read/${reading.slug}`), ...COURSE.lessons.map(lesson => `/learn/${lesson.id}`),
    ...COURSE.practice.map(practice => `/learn/practice/${practice.id}`)]);
}

export function normalizePublicPagePath(location: unknown): string | null {
  if (typeof location !== "string" || location.length > PAGE_VIEW_BODY_LIMIT || !location.startsWith("/") || location.startsWith("//")
    || /[\u0000- \u007f-\u009f\\#]/.test(location)) return null;
  let url: URL;
  try { url = new URL(location, "https://page-view.invalid"); } catch { return null; }
  if (url.origin !== "https://page-view.invalid") return null;
  const pathname = url.pathname;
  if (pathname === "/read") {
    const { target } = parseReadAddress(url.search);
    if (!target || target.mode === "saved") return null;
    if (target.mode === "named") return `/read/${target.slug}`;
    if (target.mode === "ref") return READ_ANY_PATH;
    return "/read";
  }
  if (pathname === "/learn" || pathname === "/learn/about" || pathname === "/learn/review" || pathname === "/trope-chart") return pathname;
  const lesson = /^\/learn\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  if (lesson && lessonById(lesson[1])) return pathname;
  const practice = /^\/learn\/practice\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  if (practice && practiceById(practice[1])) return pathname;
  return null;
}
