import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSefariaTranslationsReader } from "../../src/server/study/translations";
import { parseCompareAnswer, comparePath } from "../../src/components/portal/workspace/study/translations-api";
import { parseCompareVerse } from "../../src/lib/readings/compare";
import { VerseActions, VersePanelScope } from "../../src/components/portal/workspace/study/verse-panel";
import { StudyLensScope } from "../../src/components/portal/workspace/study-lens";
import { ReadingToolbar as Toolbar, workCoverageNote } from "../../src/components/portal/workspace/reading-toolbar";
import type { FunctionComponent } from "react";
const ReadingToolbar = Toolbar as FunctionComponent<NonNullable<Parameters<typeof Toolbar>[0]>>;
import { englishVersion, syntheticTranslationsFetch, targumVersion, textsAnswer } from "../helpers/translations";

// Invented edition titles and numbered English; invented syllables for the Aramaic.
async function served(ref = "Isaiah 40:1") {
  const sefaria = syntheticTranslationsFetch({ english: r => textsAnswer(r, [englishVersion("Synthetic Edition One"), englishVersion("Synthetic Edition Two", "<i>Italic</i> words", { license: "Copyright: Synthetic Press" })]),
    targum: r => textsAnswer(r, [targumVersion("he", "Synthetic Aramaic", "אָב גַּד"), targumVersion("en", "Synthetic Targum English", "Synthetic targum rendering.", "")]) });
  const { answer } = await createSefariaTranslationsReader({ fetch: sefaria.fetch })(ref);
  return JSON.parse(JSON.stringify(answer));
}

test("the browser parser accepts exactly the server's answer, credits recomputed and links checked", async () => {
  const verse = parseCompareVerse("Isaiah 40:1")!, body = await served();
  const parsed = parseCompareAnswer(structuredClone(body), verse);
  expect(parsed).toEqual(body);
  expect(parsed.targum).toMatchObject({ work: "Targum Jonathan", english: { licenseLabel: "licence not stated", credit: "Synthetic Targum English, via Sefaria (licence not stated)" } });
  expect(parsed.translations![1]).toMatchObject({ licenseLabel: "Copyright: Synthetic Press", runs: [{ text: "Italic", italic: true }, { text: " words" }] });
  expect(comparePath("I Samuel 20:18")).toBe("/api/public/translations?verse=I+Samuel+20%3A18");
  const mutations: [string, (v: Record<string, any>) => void][] = [
    ["other verse", v => { v.verse = "Isaiah 40:2"; }], ["extra key", v => { v.extra = 1; }], ["both halves missing", v => { v.translations = null; v.targum = null; }],
    ["credit changed", v => { v.translations[0].credit = "Synthetic Edition One, via Sefaria (public domain)"; }], ["label changed", v => { v.translations[0].licenseLabel = "CC0"; }],
    ["link elsewhere", v => { v.translations[0].url = "https://example.com/x"; }], ["link to another verse", v => { v.translations[0].url = v.translations[0].url.replace("40.1", "40.2"); }],
    ["title with markup", v => { v.translations[0].title = "<b>x</b>"; v.translations[0].credit = "<b>x</b>, via Sefaria (CC BY)"; }],
    ["duplicate title", v => { v.translations[1] = structuredClone(v.translations[0]); }], ["empty runs", v => { v.translations[0].runs = []; }],
    ["run with markup key", v => { v.translations[0].runs[0].html = "<b>"; }], ["too many", v => { v.translations = Array.from({ length: 41 }, (_, i) => ({ ...v.translations[0], title: `T${i}` })); }],
    ["wrong targum work", v => { v.targum.work = "Onkelos"; }], ["empty targum", v => { v.targum.aramaic = null; v.targum.english = null; }],
    ["targum link to the verse", v => { v.targum.aramaic.url = v.translations[0].url; }],
  ];
  for (const [name, mutate] of mutations) { const value = structuredClone(body); mutate(value); expect(() => parseCompareAnswer(value, verse), name).toThrow(); }
  // A missing half is allowed and stays null.
  expect(parseCompareAnswer({ ...structuredClone(body), targum: null }, verse).targum).toBeNull();
  expect(parseCompareAnswer({ ...structuredClone(body), translations: null }, verse).translations).toBeNull();
});

test("Compare sits under each Study row only inside a panel scope, in Study, for Torah and Prophets verses", () => {
  const inStudy = (child: ReturnType<typeof createElement>, lens: "study" | "lein" = "study") => renderToStaticMarkup(createElement(StudyLensScope, { storageKey: null, query: lens, children: createElement(VersePanelScope, { children: child }) }));
  expect(inStudy(createElement(VerseActions, { verse: "Genesis 12:1" }))).toContain(">Compare</button>");
  expect(inStudy(createElement(VerseActions, { verse: "Genesis 12:1" }))).toContain('aria-haspopup="dialog"');
  expect(inStudy(createElement(VerseActions, { verse: "Genesis 12:1" }), "lein")).toContain(">Compare</button>"); // the rows only exist in Study
  expect(inStudy(createElement(VerseActions, { verse: "Psalms 1:1" }))).toBe("");
  expect(renderToStaticMarkup(createElement(VerseActions, { verse: "Genesis 12:1" }))).toBe(""); // no scope: no action
});

test("Works names the new commentators and says which cover only the Torah or only the Prophets", () => {
  expect(workCoverageNote("ramban")).toBe("Torah only"); expect(workCoverageNote("radak")).toBe("Prophets only"); expect(workCoverageNote("rashi")).toBeNull();
  const menu = (corpus: "torah" | "neviim") => renderToStaticMarkup(createElement(StudyLensScope, { storageKey: null, query: "study", children: createElement(ReadingToolbar, { worksCorpus: corpus }) }));
  const torah = menu("torah"), prophets = menu("neviim");
  for (const name of ["Ramban", "Ibn Ezra", "Sforno", "Rashbam", "Or HaChaim", "Kli Yakar", "Chizkuni", "Radak", "Metzudat David"]) expect(torah).toContain(name);
  expect(torah).toContain("Prophets only"); expect(prophets).toContain("Torah only");
});
