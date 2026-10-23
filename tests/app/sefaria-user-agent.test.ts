import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSefariaCommentaryReader } from "../../src/server/study/commentary";
import { createSefariaSourceReader } from "../../src/server/study/source-text";
import { fetchSefariaJson, SEFARIA_ORIGIN, SEFARIA_REQUEST_HEADERS, SEFARIA_USER_AGENT } from "../../src/server/study/sefaria-json";
import { ShelfLinksCredit } from "../../src/components/portal/workspace/study/shelf-view";
import { creditLine } from "../../src/lib/readings/edition-credit";
import { sourceAnswer, sourceVersion } from "../helpers/shelf";
import { syntheticCommentaryFetch } from "../helpers/commentary";

// Sefaria publishes no rate limit and does not ask for a User-Agent, but a courteous API consumer names itself so
// they can reach us instead of blocking an unknown host range. The value names no person and adds no address.
const EXPECTED = "CRC-Torah/1.4 (+https://torah.centralreform.org)";
const headerOf = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);

test("the identifying User-Agent is exactly the reviewed value and rides beside accept on the shared headers", () => {
  expect(SEFARIA_USER_AGENT).toBe(EXPECTED);
  expect(SEFARIA_REQUEST_HEADERS).toEqual({ accept: "application/json", "user-agent": EXPECTED });
  expect(Object.isFrozen(SEFARIA_REQUEST_HEADERS)).toBe(true);
  expect(EXPECTED).not.toMatch(/@/);
});

test("the shared JSON fetch sends it", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  await fetchSefariaJson(fetch, new URL(`${SEFARIA_ORIGIN}/api/v3/texts/Genesis%201`), { deadlineMs: 1000, maxBytes: 1024 });
  expect(headerOf(fetch.mock.calls[0][1], "user-agent")).toBe(EXPECTED);
  expect(headerOf(fetch.mock.calls[0][1], "accept")).toBe("application/json");
});

test("the commentary reader and the shelf source reader send it", async () => {
  const commentary = vi.fn(syntheticCommentaryFetch());
  await createSefariaCommentaryReader({ fetch: commentary as typeof globalThis.fetch })("rashi", "Genesis 1");
  expect(headerOf((commentary.mock.calls[0] as unknown[])[1] as RequestInit, "user-agent")).toBe(EXPECTED);
  const ref = "Synthetic Commentator on Genesis 12:1", source = vi.fn<typeof globalThis.fetch>(async () =>
    new Response(JSON.stringify(sourceAnswer(ref, [sourceVersion("he", "Synthetic Hebrew", "א")])), { headers: { "content-type": "application/json" } }));
  await createSefariaSourceReader({ fetch: source })(ref);
  expect(headerOf(source.mock.calls[0][1], "user-agent")).toBe(EXPECTED);
});

/**
 * The remaining readers (chapter text, source content, source metadata) are pinned in their own test files. This
 * scan is the backstop: any server file under study/ that talks to Sefaria must use the shared headers or the shared fetch.
 */
test("every server file that fetches from Sefaria uses the shared headers or the shared fetch", () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) && files.push(path); } };
  walk("src/server");
  const talks = files.filter(path => { const text = readFileSync(path, "utf8"); return /https:\/\/www\.sefaria\.org\/api\//.test(text) || /fetchSefariaJson|SEFARIA_ORIGIN/.test(text); });
  expect(talks.length).toBeGreaterThanOrEqual(7);
  for (const path of talks) {
    const text = readFileSync(path, "utf8");
    expect(/SEFARIA_REQUEST_HEADERS|fetchSefariaJson/.test(text), path).toBe(true);
    expect(/headers:\s*\{\s*accept:\s*"application\/json"\s*\}/.test(text), `${path} sets its own Sefaria headers`).toBe(false);
  }
});

// The links behind More on this verse are CC BY: the panel credits Sefaria and links the licence, in the credit format
// the rest of Study already uses, with the panel's own name as the title (no new wording).
test("More on this verse credits the CC BY links in the existing credit format and links the licence", () => {
  const html = renderToStaticMarkup(createElement(ShelfLinksCredit));
  expect(html.replace(/<[^>]+>/g, "")).toBe(creditLine("More on this verse", "CC-BY"));
  expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
  expect(html).toContain('rel="noopener noreferrer"');
});
