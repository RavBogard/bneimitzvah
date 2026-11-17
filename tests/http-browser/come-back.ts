import type { Page } from "playwright";
import { RETURN_RECHECK_MS } from "../../src/components/portal/workspace/session";

/**
 * The person leaves the tab and comes back after RETURN_RECHECK_MS: the signed-in shell reads the session once (session.ts).
 * A bare focus event no longer re-checks anything (C2, 2026-11-17), so tests that mean "the person came back" use this.
 */
export function comeBack(tab: Page) {
  return tab.evaluate(async wait => {
    window.dispatchEvent(new Event("blur"));
    await new Promise(resolve => setTimeout(resolve, wait));
    window.dispatchEvent(new Event("focus"));
  }, RETURN_RECHECK_MS + 100);
}
