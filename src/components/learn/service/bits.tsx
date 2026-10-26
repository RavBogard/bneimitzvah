import type { ReactNode } from "react";
import { DEFAULT_SIDDUR_URL } from "../../../server/settings/validation";
import { siddurPageLink } from "../../../lib/siddur/link";
import { CRC_TENANT, pageOf, type ServiceSlot, type Tenant } from "../../../lib/service-course/course";
import { COPY, fill } from "../../../lib/service-course/copy";
import { SiddurOrOffline } from "./offline";
import styles from "./service.module.css";

// The course's own small pieces. It does not import Learn to lein's components, so a course page never carries
// the trope course's data or audio code.
const svg = (children: ReactNode, size = 22) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
export const icons = {
  close: svg(<path d="M6 6l12 12M18 6L6 18" />),
  check: svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, 18),
  arrow: svg(<path d="M9 6l6 6-6 6" />, 20),
};

export function ServiceAppBar() {
  return <header className="portal-header app-bar"><a className="portal-brand" href="/" aria-label="CRC Torah home">CRC Torah</a></header>;
}

/**
 * "Open in the siddur, page {page}" for one lesson, or nothing when the lesson has no printed page or the siddur address is not the
 * recognised reader, so a broken link is never drawn (A4 11). Signed out, the page is the morning's; a Havdalah-slot student's is the
 * evening's (2.0 SC7), and an evening lesson has only its evening page.
 */
export function LessonSiddurLink({ lessonId, tenant = CRC_TENANT, slot = "morning" }: { lessonId: string; tenant?: Tenant; slot?: ServiceSlot }) {
  const page = pageOf(tenant, lessonId, slot), href = page === undefined ? null : siddurPageLink(DEFAULT_SIDDUR_URL, tenant.siddurBook, page);
  if (!href || page === undefined) return null;
  // 2.0 SC6: offline, in the installed app, "Needs a connection" in its place (offline.tsx).
  return <SiddurOrOffline className={styles.siddur} href={href} page={page}>{fill(COPY.done.siddur, { page })}</SiddurOrOffline>;
}
