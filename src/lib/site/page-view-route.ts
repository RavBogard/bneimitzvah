/**
 * The public page-view beacon's route and body cap (release 1.5, cookieless analytics). Dependency-free so the client
 * beacon can import it without pulling the reading catalog or the course into its bundle; the allow-list that turns a
 * location into a stored path is src/lib/site/page-views.ts, used only on the server.
 */
export const PAGE_VIEW_ROUTE = "/api/public/view";
/** The body is the page's own pathname and query, as plain text; anything longer is not a public page and is dropped. */
export const PAGE_VIEW_BODY_LIMIT = 512;
