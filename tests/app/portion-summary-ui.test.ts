import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { fetchPortionSummary, parsePortionSummary } from "../../src/components/portal/workspace/study/portion-summary-api";
import { PortionSummaryBlock, StudySummary } from "../../src/components/portal/workspace/study/portion-summary";
import { parashahSlug, portionSummaryPath } from "../../src/lib/portion-summary/reading";
import { SaveReadingView, STUDENT_LINE } from "../../src/components/portal/saved/save-reading";

// The portion summary on screen (1.9 N7). Synthetic text only: invented summary lines and a made-up emphasis; no real summary anywhere.
const CREDIT = "Rabbi Daniel Bogard";
const answer = (changes: Record<string, unknown> = {}) => ({ reading: "vayera", summary: { reading: "vayera", revision: 2, credit: CREDIT, approvedAt: "2026-10-24T12:00:00.000Z",
  summary: "A synthetic overview.\n\n- one made-up point\n- another made-up point",
  outline: [1, 2, 3, 4, 5, 6, 7].map(aliyah => ({ aliyah, line: `Synthetic line ${aliyah}` })), ...changes } });
afterEach(() => { vi.unstubAllGlobals(); });

test("a parashah is found by its slug or its usual name; a festival, a special Shabbat and a stranger are not parashiyot", () => {
  expect(parashahSlug("vayera")).toBe("vayera");
  expect(parashahSlug("Vayera")).toBe("vayera");
  expect(parashahSlug("Lech Lecha")).toBe("lech-lecha");
  expect(parashahSlug("Vayakhel-Pekudei")).toBe("vayakhel-pekudei");
  for (const value of ["Shabbat Rosh Chodesh Chanukah", "shabbat-hachodesh-on-rosh-chodesh", "Not a portion", "", null, undefined, 4, "x".repeat(200)]) expect(parashahSlug(value), String(value)).toBeNull();
  expect(portionSummaryPath("vayera")).toBe("/api/public/portion-summary?reading=vayera");
});

test("the answer is parsed strictly: an approved summary with its credit, null for none, and anything else is a failure", () => {
  const parsed = parsePortionSummary(answer(), "vayera")!;
  expect(parsed).toMatchObject({ reading: "vayera", revision: 2, credit: CREDIT });
  expect(parsed.outline.map(row => row.aliyah)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(parsePortionSummary({ reading: "vayera", summary: null }, "vayera")).toBeNull();
  const bad: [string, unknown][] = [
    ["another reading", answer()],
    ["wrong outline length", answer({ outline: [{ aliyah: 1, line: "x" }] })],
    ["outline out of order", answer({ outline: [2, 1, 3, 4, 5, 6, 7].map(aliyah => ({ aliyah, line: "x" })) })],
    ["no credit", answer({ credit: "" })],
    ["a hidden character", answer({ summary: `Hidden${String.fromCharCode(0x200b)}mark` })],
    ["an empty summary", answer({ summary: "  " })],
    ["a non-date", answer({ approvedAt: "yesterday" })],
    ["not an object", "nonsense"],
  ];
  for (const [name, value] of bad) expect(() => parsePortionSummary(value, name === "another reading" ? "vayeira" : "vayera"), name).toThrow();
});

test("the call is a plain same-origin GET, the same signed in or out: no credentials, no Authorization", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("location", { origin: "http://localhost:3000" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const response = new Response(JSON.stringify(answer()), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    Object.defineProperty(response, "url", { value: `http://localhost:3000${url}` });
    return response;
  });
  expect((await fetchPortionSummary("vayera", new AbortController().signal))?.credit).toBe(CREDIT);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("/api/public/portion-summary?reading=vayera");
  expect(calls[0].init).toMatchObject({ credentials: "omit", mode: "same-origin", referrerPolicy: "no-referrer" });
  expect(JSON.stringify(calls[0].init.headers)).not.toMatch(/authorization|cookie/i);
});

test("the block is headed 'This portion', shows the credit exactly as stamped and one outline line per aliyah", () => {
  const summary = parsePortionSummary(answer(), "vayera")!;
  const markup = renderToStaticMarkup(createElement(PortionSummaryBlock, { summary }));
  expect(markup).toContain(">This portion</summary>");
  expect(markup).toContain('data-portion-summary-credit="">Rabbi Daniel Bogard</p>');
  expect(markup).toContain("<li>one made-up point</li>");
  expect(markup.match(/data-outline-aliyah="/g)).toHaveLength(7);
  for (const n of [1, 2, 3, 4, 5, 6, 7]) { expect(markup).toContain(`>Aliyah ${n}</span><span>Synthetic line ${n}</span>`); }
  // No sections to go to: plain lines, never buttons that promise a jump.
  expect(markup).not.toContain("<button");
  expect(markup).toContain(" open=");
});

test("an outline line is a button only for an aliyah the page has as a section", () => {
  const summary = parsePortionSummary(answer(), "vayera")!, go = vi.fn();
  const markup = renderToStaticMarkup(createElement(PortionSummaryBlock, { summary, aliyot: ["1", "2", "3", "4", "5", "6", "7", "M"], onAliyah: go }));
  expect(markup.match(/<button/g)).toHaveLength(7);
  const some = renderToStaticMarkup(createElement(PortionSummaryBlock, { summary, aliyot: ["1", "4"], onAliyah: go }));
  expect(some.match(/<button/g)).toHaveLength(2);
  expect(some).toContain('<button type="button" class="' );
  expect(some).toMatch(/<button[^>]*data-outline-aliyah="4"/);
  expect(some).not.toMatch(/<button[^>]*data-outline-aliyah="3"/);
  // Sections but nowhere to go: still plain.
  expect(renderToStaticMarkup(createElement(PortionSummaryBlock, { summary, aliyot: ["1", "4"] }))).not.toContain("<button");
});

test("nothing is drawn until an approved summary has come (and never for a reading that is not a parashah)", () => {
  expect(renderToStaticMarkup(createElement(StudySummary, { slug: "vayera", active: true }))).toBe("");
  expect(renderToStaticMarkup(createElement(StudySummary, { slug: null, active: true }))).toBe("");
});

test("a signed-in student pressing Save is told why and where their reading is, with the approved wording (N20-1, N20-2)", () => {
  const view = (student: boolean) => renderToStaticMarkup(createElement(SaveReadingView, { step: "not-eligible", problem: null, name: "Noach · Torah", date: "", panelId: "p", student,
    onSave: () => {}, onName: () => {}, onDate: () => {}, onSubmit: () => {}, onCancel: () => {} }));
  expect(STUDENT_LINE).toBe("Student accounts don’t save other readings. Your assigned reading is always under Reading.");
  expect(view(true)).toContain("Student accounts don’t save other readings. Your assigned reading is always under Reading. <a href=\"/workspace/student?tab=reading\">Open your reading</a>");
  expect(view(true)).not.toContain("Ask for an account");
  // Any other account that cannot save keeps the way to ask.
  expect(view(false)).toContain('<a href="/account">Ask for an account to save readings</a>');
  expect(view(false)).not.toContain("Student accounts");
});
