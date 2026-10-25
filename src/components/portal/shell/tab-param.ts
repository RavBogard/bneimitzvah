// `?tab=` on a student's page: which of Reading, Service parts and Lessons is showing, kept in the address so a reload (or a
// shared link) comes back to it. It is written in place with the History API, which Next.js folds into useSearchParams, so
// choosing a view makes no request and adds no history entry.
import type { ReadingTab } from "./tabs";

export function writeTabParam(value: ReadingTab) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch { /* An address that cannot be rewritten leaves the view where it is. */ }
}
