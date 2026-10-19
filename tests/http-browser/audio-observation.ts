import { expect } from "vitest";
import { expect as ui } from "@playwright/test";
import type { BrowserContext, Page, Request as BrowserRequest, Route } from "playwright";
/** Counts actual media side effects. Empty persistent/retired elements are not speech. */
export async function observeSilentAudio(context: BrowserContext) {
  await context.addInitScript(() => {
    const state = { elements: [] as HTMLAudioElement[], plays: 0, urls: 0, bodies: 0, contexts: 0 };
    Object.defineProperty(window, "silentAudioProbe", { value: state });
    window.Audio = new Proxy(window.Audio, { construct(target, args) { const audio = Reflect.construct(target, args) as HTMLAudioElement; state.elements.push(audio); const play = audio.play.bind(audio); audio.play = () => { state.plays++; return play(); }; return audio; } });
    const create = URL.createObjectURL.bind(URL); URL.createObjectURL = value => { state.urls++; return create(value); };
    const originalFetch = window.fetch.bind(window); window.fetch = (input, init) => { const url = new URL(input instanceof Request ? input.url : String(input), location.href); if (url.pathname.startsWith("/reference-audio/short-v1/") || url.hostname === "archive.org" || url.hostname.endsWith(".archive.org")) state.bodies++; return originalFetch(input, init); };
    const target = window as unknown as Record<string, unknown>;
    for (const key of ["AudioContext", "webkitAudioContext", "OfflineAudioContext", "webkitOfflineAudioContext"]) { const original = target[key]; if (typeof original === "function") target[key] = new Proxy(original, { construct(constructor, args, next) { state.contexts++; return Reflect.construct(constructor, args, next); } }); }
  });
}
export async function expectSilentAudio(page: Page) {
  const state = await page.evaluate(() => { const value = (window as unknown as { silentAudioProbe: { elements: HTMLAudioElement[]; plays: number; urls: number; bodies: number; contexts: number } }).silentAudioProbe; return { silent: value.elements.every(audio => audio.paused && !audio.getAttribute("src")), plays: value.plays, urls: value.urls, bodies: value.bodies, contexts: value.contexts }; });
  expect(state).toEqual({ silent: true, plays: 0, urls: 0, bodies: 0, contexts: 0 });
}
/** Exact initial-page terminal barrier; no networkidle or arbitrary sleep. */
export function observeInitialShortPage(page: Page) {
  const pending = new Set<BrowserRequest>(); let seen = 0, terminals = 0;
  const matches = (request: BrowserRequest) => new URL(request.url()).pathname.endsWith("/reference-audio/short/page");
  page.on("request", request => { if (matches(request)) { pending.add(request); seen++; } });
  const finish = (request: BrowserRequest) => { if (pending.delete(request)) terminals++; };
  page.on("requestfinished", finish); page.on("requestfailed", finish);
  return { async settled() { await ui.poll(() => ({ started: seen > 0, pending: pending.size, terminals })).toMatchObject({ started: true, pending: 0 }); expect(terminals).toBe(seen); }, counts: () => ({ seen, terminals, pending: pending.size }) };
}

/** Never let Playwright serialize authenticated request headers into an error. */
export async function privateRouteFetch(route: Route, page: Page, options?: Parameters<Route["fetch"]>[0]) {
  try { return await route.fetch(options); } catch { if (page.isClosed()) return null; throw new Error("Controlled route fetch failed; private details withheld"); }
}
