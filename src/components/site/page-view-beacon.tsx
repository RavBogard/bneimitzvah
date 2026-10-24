"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { PAGE_VIEW_BODY_LIMIT, PAGE_VIEW_ROUTE } from "../../lib/site/page-view-route";

/** The /read query keys that say which public reading is shown; date, verse, lens and anything else never leave the page. */
const NAMING_KEYS: ReadonlySet<string> = new Set(["reading", "passage", "ref", "kind"]);

/**
 * The public page-view beacon (release 1.5, cookieless analytics; Daniel: "path and day only"). Mounted only in the
 * public layouts (/read, /learn and its pages, /trope-chart); signed-in workspaces never mount it. Once per page shown
 * (each new pathname), it posts the page's pathname, with only the query keys that name a public reading, to the counter
 * and forgets it. A member's own saved reading (`/read?saved=`) is never posted. The server keeps one allow-listed path and
 * the day, nothing else. Nothing is stored on this device, no cookie is sent (credentials omit),
 * no referrer is sent, and nothing is shown or waited on: any failure is silent.
 */
export function PageViewBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const { pathname: path, search } = window.location, params = new URLSearchParams(search);
      if (params.has("saved")) return;
      const kept = new URLSearchParams([...params].filter(([key]) => NAMING_KEYS.has(key))).toString();
      const page = kept ? `${path}?${kept}` : path;
      if (page.length > PAGE_VIEW_BODY_LIMIT) return;
      void fetch(PAGE_VIEW_ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page }),
        credentials: "omit", cache: "no-store", keepalive: true, referrerPolicy: "no-referrer", mode: "same-origin" }).catch(() => undefined);
    } catch { /* Counting never affects the page. */ }
  }, [pathname]);
  return null;
}
