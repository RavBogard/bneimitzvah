import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { arrange, GuidesView, type Actions } from "../../src/components/portal/workspace/guide-admin/workspace";
import { parseOverview, type Overview } from "../../src/components/portal/workspace/guide-admin/api";

// The admin's Guides page (gap A6). Invented rows only. Ordering and actions are asserted by test ids and data attributes;
// one test pins the page's wording deliberately.
const at = "2026-11-17T12:00:00.000Z";
const version = (n: number, extra: Record<string, unknown> = {}) => ({ version: n, origin: "claude", reviewed: false, changedAt: at, ...extra });
const answer = {
  ok: true, rabbiName: "Rabbi Synthetic", truncated: false,
  guides: [
    { kind: "torah", readingKey: "vayera", reading: { slug: "vayera", name: "Vayera", order: 3 }, state: "reviewed", current: version(1, { origin: "rabbi", reviewed: true }), visible: version(1, { origin: "rabbi", reviewed: true }), href: "/read?reading=vayera&lens=study" },
    { kind: "torah", readingKey: "pekudei", reading: { slug: "pekudei", name: "Pekudei", order: 22 }, state: "held", current: version(2), visible: version(1, { reviewed: true }), href: "/read?reading=pekudei&lens=study" },
    { kind: "torah", readingKey: "noach", reading: { slug: "noach", name: "Noach", order: 1 }, state: "draft", current: version(1), visible: version(1), href: "/read?reading=noach&lens=study" },
  ],
  discussions: [{ slug: "why-this-verse", title: "Why this verse", kind: "torah", status: "published", revision: 1, sourceCount: 2, reading: { slug: "noach", name: "Noach", order: 1 }, changedAt: at, href: "/read?reading=noach&lens=study" }],
  summaries: [
    { reading: "vayera", readingPlace: { slug: "vayera", name: "Vayera", order: 3 }, revision: 2, status: "draft", summary: "A synthetic draft.", outline: [1, 2, 3, 4, 5, 6, 7].map(aliyah => ({ aliyah, line: `Line ${aliyah}` })), changedAt: at, href: null },
    { reading: "noach", readingPlace: { slug: "noach", name: "Noach", order: 1 }, revision: 1, status: "approved", summary: "A synthetic approved summary.", outline: [1, 2, 3, 4, 5, 6, 7].map(aliyah => ({ aliyah, line: `Line ${aliyah}` })), credit: "Rabbi Synthetic", changedAt: at, href: "/read?reading=noach&lens=study" },
  ],
};
const actions: Actions = { withdrawDiscussion: async () => {}, approveSummary: async () => {}, withdrawSummary: async () => {} };
const render = (overview: Overview) => renderToStaticMarkup(createElement(GuidesView, { overview, actions }));

test("held guide drafts and unapproved summaries come first, under their own heading, before the readings in calendar order", () => {
  const overview = parseOverview(answer), { waiting, groups } = arrange(overview);
  expect(waiting.map(item => item.type === "guide" ? `guide:${item.row.readingKey}` : item.type === "summary" ? `summary:${item.row.reading}:${item.row.status}` : "discussion"))
    .toEqual(["summary:vayera:draft", "guide:pekudei"]);
  expect(groups.map(group => group.key)).toEqual(["noach", "vayera"]);
  expect(groups[0].items.map(item => item.type)).toEqual(["guide", "summary", "discussion"]);
  const markup = render(overview);
  const waitingAt = markup.indexOf('data-testid="guide-admin-waiting"'), readingsAt = markup.indexOf('data-testid="guide-admin-readings"');
  expect(waitingAt).toBeGreaterThan(-1);
  expect(waitingAt).toBeLessThan(readingsAt);
  expect(markup.indexOf('data-state="held"')).toBeGreaterThan(waitingAt);
  expect(markup.indexOf('data-state="held"')).toBeLessThan(readingsAt);
  // Approval sits only on a draft, under its text; withdrawal on a published discussion and a non-withdrawn summary; no guide has a write.
  expect(markup.match(/data-testid="guide-admin-approve"/g)).toHaveLength(1);
  expect(markup.match(/data-testid="guide-admin-withdraw-summary"/g)).toHaveLength(2);
  expect(markup.match(/data-testid="guide-admin-withdraw-discussion"/g)).toHaveLength(1);
  expect(markup.indexOf('data-testid="guide-admin-approve"')).toBeGreaterThan(markup.indexOf('data-testid="guide-admin-summary-text"'));
  // Reader addresses are only ever /read pages.
  for (const match of markup.matchAll(/data-testid="guide-admin-open"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*data-testid="guide-admin-open"/g)) expect(match[1] ?? match[2]).toMatch(/^\/read\?/);
});

test("an empty congregation shows the empty state, and an address that is not a /read page is refused", () => {
  const empty = render(parseOverview({ ...answer, guides: [], discussions: [], summaries: [] }));
  expect(empty).not.toContain("guide-admin-waiting");
  expect(empty).not.toContain("guide-admin-readings");
  expect(() => parseOverview({ ...answer, discussions: [{ ...answer.discussions[0], href: "https://evil.example/" }] })).toThrow();
  expect(() => parseOverview({ ...answer, guides: [{ ...answer.guides[0], state: "published" }] })).toThrow();
});

test("the page's wording, pinned once", () => {
  const markup = render(parseOverview(answer));
  expect(markup).toContain("Waiting for Rabbi Synthetic");
  expect(markup).toContain("Held guide drafts and unapproved portion summaries. Readers do not see these yet.");
  expect(markup).toContain("Readers see version 1 until this draft is released. Release it through Claude.");
  expect(markup).toContain("By reading");
  expect(markup).toContain("Approve revision 2");
  expect(markup).toContain("Open the study page");
  expect(render(parseOverview({ ...answer, guides: [], discussions: [], summaries: [] }))).toContain("No study content yet");
  expect(markup).not.toMatch(/[A-Za-z.]!|practise/);
});
