import type { BrowserContext, Page } from "playwright";

/**
 * Waiting for the page's own fetches to finish, counted inside the page.
 *
 * Playwright's waitForLoadState("networkidle") counts requests from the browser's request events. Firefox reports
 * neither requestfinished nor requestfailed for a request the page aborts (an AbortSignal) while the context has any
 * route installed, so that request stays "in flight" for good and networkidle then times out after 30 s. The
 * workspace aborts fetches on purpose (React strict mode's second effect pass, a superseded session check), which
 * made the wait fail at random. A fetch promise settles for an abort too, so counting there is exact and has no
 * dependence on the browser's request events.
 */
type Counter = Window & { __fetchesInFlight?: number; __fetchesIdleSince?: number };

/** Install before the first navigation of the context. */
export async function countPageFetches(context: BrowserContext) {
  await context.addInitScript(() => {
    const state = window as Counter;
    if (state.__fetchesInFlight !== undefined) return;
    state.__fetchesInFlight = 0;
    const original = window.fetch.bind(window);
    window.fetch = ((...args: Parameters<typeof fetch>) => {
      state.__fetchesInFlight!++;
      let settled = false; const done = () => { if (!settled) { settled = true; state.__fetchesInFlight!--; } };
      let promise: Promise<Response>;
      try { promise = original(...args); } catch (error) { done(); throw error; }
      promise.then(done, done);
      return promise;
    }) as typeof fetch;
  });
}

/** Resolves once no fetch has been in flight for `quietMs`, so a request that follows another right away is still waited for. */
export async function pageFetchesSettled(tab: Page, quietMs = 400) {
  await tab.waitForFunction(quiet => {
    const state = window as Counter;
    if ((state.__fetchesInFlight ?? 0) !== 0) { state.__fetchesIdleSince = undefined; return false; }
    state.__fetchesIdleSince ??= performance.now();
    return performance.now() - state.__fetchesIdleSince >= quiet;
  }, quietMs, { polling: 50, timeout: 30_000 });
}
