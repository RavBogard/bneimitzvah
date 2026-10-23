import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseShelfLinks } from "../../src/server/study/shelf";
import { createSefariaMetadataReader } from "../../src/server/study/sources/sefaria-metadata";
import { SourceMetadataUnavailable } from "../../src/server/study/sources/metadata";
import { compositionDates, inlineShelfTitles, isInlineWork, parseSourceRef, shelfSefariaUrl, SHELF_LIMITS, sourceSefariaUrl } from "../../src/lib/readings/shelf";
import { parseShelfAnswer } from "../../src/components/portal/workspace/study/shelf-api";
import { linkRow, syntheticLinks } from "../helpers/shelf";

// Invented link rows: titles, categories, dates and citations only.
const verse = "Genesis 12:1";
const shape = (answer: ReturnType<typeof parseShelfLinks>) => answer.groups.map(group => [group.key, group.works.map(work => work.title)]);

test("groups in order, curated works first in the curated order, the rest by composition date", () => {
  const answer = parseShelfLinks(syntheticLinks(), verse);
  expect(answer.verse).toBe(verse); expect(answer.sefariaUrl).toBe("https://www.sefaria.org/Genesis.12.1?with=all&lang=bi");
  expect(shape(answer)).toEqual([
    ["commentary", ["Rashi", "Ramban", "Early Synthetic Commentary", "Synthetic Commentator"]],
    ["midrash", ["Bereshit Rabbah", "Midrash Tanchuma", "Synthetic Midrash"]],
    ["halakhah", ["Mishneh Torah, Synthetic Laws"]],
    // Bavli, then the Jerusalem Talmud, then Mishnah, then Tosefta.
    ["talmud", ["Synthetic Tractate", "Jerusalem Talmud Synthetic", "Mishnah Synthetic", "Tosefta Synthetic"]],
    ["targum", ["Onkelos Genesis", "Tafsir Synthetic"]],
    // Everything else by category (most links first), then by work.
    ["other", ["Synthetic Chasidut", "Other Chasidut", "Synthetic Kabbalah"]],
  ]);
  const commentary = answer.groups[0];
  expect(commentary).toMatchObject({ label: "Commentary", count: 7 });
  expect(commentary.works[1]).toEqual({ title: "Ramban", heTitle: "רמב״ן", dates: [1246, 1270], category: "Commentary", curated: true,
    // Ramban's three comments on the verse open as one text; his comment elsewhere stands alone.
    items: [{ ref: "Ramban on Genesis 12:1", segments: 3 }, { ref: "Ramban on Deuteronomy 8:3:1", segments: 1 }], more: 0 });
  expect(commentary.works[2]).toMatchObject({ dates: [900, 900], curated: false });
  expect(commentary.works[3]).toMatchObject({ heTitle: null, curated: false });
  expect(answer.groups.find(group => group.key === "midrash")!.works[2].dates).toBeNull();
  // A Talmud segment never folds into its whole daf, nor a midrash into its chapter.
  expect(answer.groups.find(group => group.key === "talmud")!.works[0].items).toEqual([{ ref: "Synthetic Tractate 16b:7", segments: 1 }]);
  // The browser parser accepts exactly this answer.
  expect(parseShelfAnswer(JSON.parse(JSON.stringify(answer)), verse)).toEqual(JSON.parse(JSON.stringify(answer)));
});

test("a Prophets verse uses the Prophets' curated commentators", () => {
  const anchor = "Isaiah 40:1";
  const rows = ["Abarbanel", "Malbim", "Metzudat David", "Radak", "Rashi", "Synthetic Later"].map(name =>
    linkRow({ index: `${name} on Isaiah`, title: name, category: "Commentary", ref: `${name} on Isaiah 40:1:1`, anchor, dates: [1000, 1001] }));
  expect(shape(parseShelfLinks(rows, anchor))).toEqual([["commentary", ["Rashi", "Radak", "Metzudat David", "Malbim", "Abarbanel", "Synthetic Later"]]]);
});

test("only rows anchored on the verse are kept", () => {
  const rows = [linkRow({ index: "A", category: "Midrash", ref: "A 1:1", anchor: "Genesis 12:1" }),
    linkRow({ index: "B", category: "Midrash", ref: "B 1:1", anchor: "Genesis 12:1-2", expanded: ["Genesis 12:1", "Genesis 12:2"] }),
    linkRow({ index: "C", category: "Midrash", ref: "C 1:1", anchor: "Genesis 12:2" }),
    linkRow({ index: "D", category: "Midrash", ref: "D 1:1", anchor: "Genesis 12:2-3", expanded: ["Genesis 12:2", "Genesis 12:3"] }),
    linkRow({ index: "E", category: "Midrash", ref: "E 1:1", anchor: "Genesis 12:1-2", expanded: ["Genesis 12:1", "Genesis 12:1"] })];
  expect(shape(parseShelfLinks(rows, verse))).toEqual([["midrash", ["A", "B"]]]);
});

test("caps: 50 items a work with the rest counted, 400 works, 384 KiB", () => {
  const many = Array.from({ length: 60 }, (_, i) => linkRow({ index: "Synthetic Many", category: "Midrash", ref: `Synthetic Many ${i + 1}:1` }));
  expect(parseShelfLinks(many, verse).groups[0].works[0]).toMatchObject({ more: 10 });
  expect(parseShelfLinks(many, verse).groups[0].works[0].items).toHaveLength(SHELF_LIMITS.itemsPerWork);
  const works = Array.from({ length: 500 }, (_, i) => linkRow({ index: `Synthetic Work ${i + 1}`, category: "Chasidut", ref: `Synthetic Work ${i + 1} 1` }));
  const capped = parseShelfLinks(works, verse);
  expect(capped.groups.reduce((sum, group) => sum + group.works.length, 0)).toBe(SHELF_LIMITS.works);
  const heavy = Array.from({ length: 4000 }, (_, i) => linkRow({ index: `Synthetic ${"Long Title ".repeat(18)}${i % 300}`, category: "Musar", ref: `Synthetic ${"Long Title ".repeat(18)}${i % 300} ${i}:${i}` }));
  const bounded = parseShelfLinks(heavy, verse);
  expect(new TextEncoder().encode(JSON.stringify(bounded)).byteLength).toBeLessThanOrEqual(SHELF_LIMITS.responseBytes);
  expect(bounded.groups[0].works.length).toBeGreaterThan(0);
});

test("hostile rows are refused one by one; a body where none was asked for, or too many rows, refuses the answer", () => {
  const good = linkRow({ index: "Kept", category: "Midrash", ref: "Kept 1:1" });
  const bad = [
    linkRow({ index: "Bidi‮Title", category: "Midrash", ref: "Bidi 1:1" }), linkRow({ index: "Markup", category: "Midrash", ref: "<b>Markup</b> 1:1" }),
    linkRow({ index: "No Address", category: "Midrash", ref: "No Address" }), linkRow({ index: "x".repeat(600), category: "Midrash", ref: "Long 1:1" }),
    linkRow({ index: "Bad Title", category: "Midrash", ref: "Bad Title 1:1", title: "Bad\u0000Title" }), linkRow({ index: "Bad He", category: "Midrash", ref: "Bad He 1:1", he: "‮x" }),
    { ...linkRow({ index: "Proto", category: "Midrash", ref: "Proto 1:1" }), collectiveTitle: Object.create({ en: "Inherited" }) },
    Object.assign(Object.create({ index_title: "Inherited" }), { _id: "x", category: "Midrash" }), null, 7, "row",
    linkRow({ index: "Kept", category: "Midrash", ref: "Kept 1:1" }), // a repeat
  ];
  // An inherited (prototype) collectiveTitle refuses its row too: labels must be the row's own plain data.
  expect(shape(parseShelfLinks([good, ...bad], verse))).toEqual([["midrash", ["Kept"]]]);
  expect(() => parseShelfLinks([good, { ...linkRow({ index: "Text", category: "Midrash", ref: "Text 1:1" }), text: "a body" }], verse)).toThrow(SourceMetadataUnavailable);
  expect(() => parseShelfLinks(Array.from({ length: 4097 }, () => good), verse)).toThrow(SourceMetadataUnavailable);
  expect(() => parseShelfLinks({ length: 1 }, verse)).toThrow(SourceMetadataUnavailable);
  expect(() => parseShelfLinks([good], "Psalms 1:1")).toThrow(SourceMetadataUnavailable);
  expect(parseShelfLinks([], verse).groups).toEqual([]);
});

test("the shelf reads the same bounded links request as the signed-in catalog", async () => {
  let asked: URL | undefined;
  const reader = createSefariaMetadataReader({ fetch: async input => { asked = new URL(String(input)); return new Response(JSON.stringify(syntheticLinks()), { headers: { "content-type": "application/json" } }); } });
  const answer = await reader.shelfLinks(verse, new AbortController().signal);
  expect(asked?.href).toBe("https://www.sefaria.org/api/links/Genesis%2012%3A1?with_text=0&with_sheet_links=0");
  expect(answer.groups.length).toBe(6);
  const failing = createSefariaMetadataReader({ fetch: async () => new Response("x", { status: 500 }) });
  await expect(failing.shelfLinks(verse, new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable);
});

test("citations, dates, inline works and Sefaria links", () => {
  for (const ok of ["Ramban on Genesis 12:1", "Rosh Hashanah 16b:7", "Mishneh Torah, Sanctification of the New Month 1:1-3", "Tze'enah Ure'enah, Haftarot, Vaetchanan 2", "Berakhot 2a-3b", "Chizkuni, Genesis 12:1:1"])
    expect(parseSourceRef(ok), ok).toBe(ok);
  for (const bad of ["Genesis", "Genesis 12:1 ", " Genesis 12:1", "Genesis  12:1", "<b>x</b> 1", "Genesis 12:1‮", "Genesis 12:1?x=1", "Genesis/12:1", "x".repeat(260) + " 1", "Genesis 12:1#", "", null])
    expect(parseSourceRef(bad), String(bad)).toBeNull();
  expect(compositionDates([1246, 1270])).toBe("Composed 1246–1270"); expect(compositionDates([900, 900])).toBe("Composed 900");
  expect(compositionDates([-200, -100])).toBe("Composed 200 BCE–100 BCE"); expect(compositionDates(null)).toBeNull();
  expect(inlineShelfTitles("womens")).toContain("The Torah; A Women's Commentary");
  expect(isInlineWork("Rashi", ["rashi"])).toBe(true); expect(isInlineWork("Chizkuni", ["chizkuni"])).toBe(true); expect(isInlineWork("Ramban", ["rashi"])).toBe(false);
  expect(isInlineWork("The Torah; A Women's Commentary", ["womens"])).toBe(true);
  expect(shelfSefariaUrl("I Samuel 20:18")).toBe("https://www.sefaria.org/I_Samuel.20.18?with=all&lang=bi");
  expect(sourceSefariaUrl("Rosh Hashanah 16b:7", { language: "en", title: "Synthetic Edition" })).toBe("https://www.sefaria.org/Rosh%20Hashanah%2016b%3A7?ven=Synthetic_Edition&lang=bi");
});

test("the browser parser refuses anything but the server's shape", () => {
  const body = JSON.parse(JSON.stringify(parseShelfLinks(syntheticLinks(), verse)));
  const mutations: [string, (v: Record<string, any>) => void][] = [
    ["other verse", v => { v.verse = "Genesis 12:2"; }], ["link elsewhere", v => { v.sefariaUrl = "https://example.com/"; }], ["extra key", v => { v.extra = 1; }],
    ["group order", v => { v.groups.reverse(); }], ["label", v => { v.groups[0].label = "Notes"; }], ["empty group", v => { v.groups[0].works = []; }],
    ["work in the wrong group", v => { v.groups[0].works[0].category = "Midrash"; }], ["markup title", v => { v.groups[0].works[0].title = "<b>x</b>"; }],
    ["bad citation", v => { v.groups[0].works[0].items[0].ref = "javascript:alert(1)"; }], ["no items", v => { v.groups[0].works[0].items = []; }],
    ["repeated item", v => { v.groups[0].works[1].items[1] = v.groups[0].works[1].items[0]; }], ["dates backwards", v => { v.groups[0].works[1].dates = [1270, 1246]; }],
    ["segments zero", v => { v.groups[0].works[1].items[0].segments = 0; }], ["curated not boolean", v => { v.groups[0].works[0].curated = "yes"; }],
  ];
  for (const [name, mutate] of mutations) { const value = structuredClone(body); mutate(value); expect(() => parseShelfAnswer(value, verse), name).toThrow(); }
});
