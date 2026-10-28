import type { Page } from "@playwright/test";

// The two Core Web Vitals the performance gate (Readings for everyone, Done means) names, measured the way e2e/public-reader-layout.spec.ts measures CLS.
export type Shift = { value: number; time: number; nodes: string[] };

/** Records every layout shift not caused by a recent input, from before the page's own scripts run. */
export async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const seen: { value: number; time: number; nodes: string[] }[] = [];
    (window as unknown as { __shifts: typeof seen }).__shifts = seen;
    const name = (node: Element | null) => node ? `${node.tagName.toLowerCase()}.${String(node.getAttribute("class") ?? "").split(" ")[0]}` : "gone";
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as unknown as { value: number; startTime: number; hadRecentInput: boolean; sources: { node: Element | null }[] }[])
          if (!entry.hadRecentInput) seen.push({ value: entry.value, time: entry.startTime, nodes: entry.sources.map(source => name(source.node)) });
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* No layout-shift entries here. */ }
  });
}
export const shiftsOf = (page: Page) => page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);

/** CLS: the worst window of shifts, each within 1 s of the last and the window within 5 s. */
export function cls(shifts: readonly Shift[]): number {
  let worst = 0, total = 0, start = -Infinity, last = -Infinity;
  for (const shift of shifts) {
    if (shift.time - last > 1000 || shift.time - start > 5000) { total = 0; start = shift.time; }
    total += shift.value; last = shift.time; worst = Math.max(worst, total);
  }
  return worst;
}

/** What axe's structure rules check, made directly (as e2e/visual-system.spec.ts does): one h1, no skipped heading level, every control named, no repeated id, one main. */
export async function structureProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const levels = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(node => (node as HTMLElement).offsetParent !== null || getComputedStyle(node).position === "fixed").map(node => Number(node.tagName[1]));
    if (levels.filter(level => level === 1).length !== 1) problems.push(`h1 count ${levels.filter(level => level === 1).length}`);
    levels.reduce((previous, level) => { if (level - previous > 1) problems.push(`heading level skipped to h${level}`); return level; }, 0);
    for (const node of document.querySelectorAll<HTMLElement>("button, a[href], [role=button], [role=link], input:not([type=hidden]), select, textarea")) {
      if (node.hidden || node.closest("[hidden], [inert], dialog:not([open])") || node.getAttribute("aria-hidden") === "true") continue;
      const label = (node.getAttribute("aria-label") ?? "").trim() || (node.textContent ?? "").trim() || (node.getAttribute("title") ?? "").trim() || (node as HTMLInputElement).labels?.[0]?.textContent?.trim() || node.getAttribute("aria-labelledby");
      if (!label) problems.push(`unnamed ${node.tagName.toLowerCase()}.${String(node.getAttribute("class") ?? "").split(" ")[0]}`);
    }
    const ids = [...document.querySelectorAll("[id]")].map(node => node.id); if (ids.length !== new Set(ids).size) problems.push("repeated id");
    if (document.querySelectorAll("main, [role=main]").length !== 1) problems.push("main landmark count");
    return problems;
  });
}
