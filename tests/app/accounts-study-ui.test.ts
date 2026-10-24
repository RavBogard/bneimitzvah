import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DRILL_STRINGS, drillNext, TranslateDrillPanel } from "../../src/components/portal/public-reading/translate-drill";
import { StarButton, STAR_STRINGS, type OwnStars } from "../../src/components/portal/workspace/study/own-layer";
import { YoursRowView, YOURS_STRINGS } from "../../src/components/portal/saved/yours";
import { conflictWork, fetchSavedStars, parseSavedStars, saveSavedWork, savedText, SavedRequestError, setSavedStar } from "../../src/components/portal/saved/api";
import { Shell } from "../../src/components/portal/public-reading/view";
import { ReadingToolbar } from "../../src/components/portal/workspace/reading-toolbar";
import { APPROVER_HELP_LINE } from "../../src/components/portal/workspace/accounts/workspace";

// Release 1.4 PR 3: the Yours row, stars and the translate drill. Synthetic text only.
const ID = "00000000-0000-4000-8000-000000000001", stamp = "2026-10-23T00:00:00.000Z";
afterEach(() => { vi.unstubAllGlobals(); });
const BANNED = /\b(correct|right|wrong|check|answer|score|try again|nice|great|done|streak|progress)\b|!/i;

describe("the translate drill", () => {
  it("uses the plan's four control names, and no line grades, cheers or counts", () => {
    expect([DRILL_STRINGS.control, DRILL_STRINGS.reveal, DRILL_STRINGS.next, DRILL_STRINGS.end]).toEqual(["Translate drill", "Reveal", "Next verse", "End drill"]);
    for (const [key, value] of Object.entries(DRILL_STRINGS)) expect(typeof value === "function" ? value("3") : value, key).not.toMatch(BANNED);
    expect(DRILL_STRINGS.moved("3")).toBe("Verse 3. English hidden.");
  });
  it("moves within the text page, onto the next page, or stops at the reading's last verse", () => {
    expect(drillNext(0, 10, 10)).toBe("on-page");
    expect(drillNext(9, 10, 10)).toBe("next-page");
    expect(drillNext(9, 10, null)).toBe("last");
    expect(drillNext(2, 3, null)).toBe("last");
  });
  const panel = (props: Partial<Parameters<typeof TranslateDrillPanel>[0]> = {}) => renderToStaticMarkup(createElement(TranslateDrillPanel, {
    verseRef: "Genesis 1:2", english: "Synthetic English two.", revealed: false, hint: false, last: false, announce: "",
    onReveal: () => {}, onHide: () => {}, onNext: () => {}, onRestart: () => {}, onEnd: () => {}, ...props }));
  const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  it("hides the English behind one line until Reveal, with the prompt and, on the first verse, the hint", () => {
    const hidden = panel({ hint: true });
    expect(plain(hidden)).toBe("English hidden Read the Hebrew aloud in your own English, then reveal. Tap a word for its meaning. Hear plays the verse. Reveal End drill");
    expect(hidden).not.toContain("Synthetic English two.");
    expect(hidden).toContain('aria-label="Translate drill on Genesis 1:2"');
    expect(hidden).toContain('role="status" aria-live="polite"');
    expect(plain(panel())).not.toContain("Tap a word");
  });
  it("reveals JPS, compares, and offers Next verse, Hide again and End drill; the last verse offers the first again", () => {
    const shown = panel({ revealed: true, announce: DRILL_STRINGS.shown });
    expect(plain(shown)).toBe("JPS Synthetic English two. Compare it with what you said. Next verse Hide again End drill JPS translation shown.");
    expect(shown).toMatch(/<h5[^>]*tabindex="-1"[^>]*>JPS<\/h5>/);
    const last = panel({ revealed: true, last: true });
    expect(plain(last)).toContain("That is the last verse of this reading. Start from the first verse Hide again End drill");
    expect(plain(last)).not.toContain("Next verse");
    expect(plain(panel({ revealed: true, english: null }))).toContain("No JPS translation is available for this verse.");
  });
  it("reveals JPS only: no own translation and no way into Yours, whatever the account holds", () => {
    const html = panel({ revealed: true });
    expect(plain(html)).not.toMatch(/My translation|Yours|Write one|No translation of this verse/);
    expect(Object.keys(DRILL_STRINGS)).not.toEqual(expect.arrayContaining(["mine"]));
    expect(Object.keys(DRILL_STRINGS).filter(key => /^(mine|noDraft|noDraftLink)$/.test(key))).toEqual([]);
    expect(html).not.toContain("<textarea");
  });
  it("lives in Lein's verse tools only: Study rows have no drill, and the drill stores nothing and never writes the English preference", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    const sources = (dir: string): string[] => readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name).split("\\").join("/")] : []);
    const importers = sources("src").filter(path => /from "\.\/translate-drill"|public-reading\/translate-drill"/.test(read(path)));
    expect(importers).toEqual(["src/components/portal/public-reading/view.tsx"]);
    expect(read("src/components/portal/workspace/study/study-rows.tsx")).not.toMatch(/drill/i);
    expect(read("src/components/portal/public-reading/translate-drill.tsx")).not.toMatch(/localStorage|sessionStorage|fetch\(|setReadingPrefs|indexedDB/);
    const view = read("src/components/portal/public-reading/view.tsx");
    expect(view).not.toMatch(/setReadingPrefs|localStorage/);
    // The drill is built only where Study is off.
    expect(view).toMatch(/const drillVerse = !study && drill/);
  });
  it("brings the new verse's controls into view after Next verse, with reduced motion respected and focus still moved without a scroll of its own", () => {
    const view = readFileSync(join(process.cwd(), "src/components/portal/public-reading/view.tsx"), "utf8");
    expect(view).toMatch(/matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
    expect(view).toMatch(/scrollIntoView\(\{ block: "nearest", behavior: reduced \|\| !near \? "auto" : "smooth" \}\)/);
    expect(view).toMatch(/focus\(\{ preventScroll: target !== "toggle" \}\)/);
  });
  it("points Play at the verse the drill moved to, and lets any verse the reader chooses take that back", () => {
    const view = readFileSync(join(process.cwd(), "src/components/portal/public-reading/view.tsx"), "utf8");
    expect(view).toContain("setDrillTarget({ index: at, generation: ++drillGeneration.current })");
    expect(view).toContain("target={drillTarget ?? (linkedOnPage !== null");
    for (const chosen of [/const hear = [^]*?setFocus\(at\); setDrillTarget\(null\)/, /const chooseWord = [^]*?setFocus\(at\); setDrillTarget\(null\)/, /const changeOffset = [^]*?setDrillTarget\(null\)/, /const changeIndex = [^]*?setDrillTarget\(null\)/])
      expect(view).toMatch(chosen);
  });
  it("shows the toolbar's English button not pressed, and says why it does nothing, while the drill hides the English", () => {
    type Props = NonNullable<Parameters<typeof ReadingToolbar>[0]>;
    const english = (html: string) => /<button[^>]*>(?:(?!<\/button>).)*<span>English<\/span><\/button>(<span[^>]*sr-only[^>]*>[^<]*<\/span>)?/.exec(html)![0];
    const off = english(renderToStaticMarkup(createElement<Props>(ReadingToolbar, {})));
    expect(off).not.toContain("aria-disabled"); expect(off).not.toContain("aria-describedby");
    const on = english(renderToStaticMarkup(createElement<Props>(ReadingToolbar, { englishHidden: true })));
    expect(on).toContain('aria-pressed="false"'); expect(on).toContain('aria-disabled="true"'); expect(on).toMatch(/aria-describedby="[^"]+"/);
    expect(on).toContain("English is hidden while the translate drill is on. End the drill to change it.");
    expect(on).not.toContain(" disabled");
  });
});

describe("stars and the Yours row", () => {
  const stars = (on: boolean, pending = false, notice = ""): OwnStars => ({ starred: () => on, pending: () => pending, notice: () => notice, toggle: () => {} });
  it("stars a comment with a 44 px pressed button, labelled as the plan says, and none past the server's sixtieth comment", () => {
    const off = renderToStaticMarkup(createElement(StarButton, { stars: stars(false), work: "rashi", verseRef: "Genesis 1:1", index: 0 }));
    expect(off).toContain('aria-pressed="false"'); expect(off).toContain('aria-label="Star comment"'); expect(off).toContain('data-star="rashi|Genesis 1:1|1"');
    const on = renderToStaticMarkup(createElement(StarButton, { stars: stars(true, true, STAR_STRINGS.failed), work: "rashi", verseRef: "Genesis 1:1", index: 2 }));
    expect(on).toContain('aria-pressed="true"'); expect(on).toContain('aria-label="Starred"'); expect(on).toContain('aria-disabled="true"'); expect(on).toContain(STAR_STRINGS.failed);
    expect(renderToStaticMarkup(createElement(StarButton, { stars: stars(false), work: "rashi", verseRef: "Genesis 1:1", index: 60 }))).toBe("");
    // Error lines keep the product’s "Try again"; the drill alone bans it. No line cheers.
    for (const value of Object.values(STAR_STRINGS)) expect(value).not.toMatch(/!|nice|great/i);
  });
  it("is a closed row that opens in place to stored My translation and My notes as plain read-only text, never an editor or a dialog", () => {
    const closed = renderToStaticMarkup(createElement(YoursRowView, { verseRef: "Genesis 1:2", open: false, onToggle: () => {}, translation: "Mine", note: "Kept", starred: null }));
    expect(closed).toMatch(/aria-expanded="false"[^>]*>Yours<\/button>/); expect(closed).not.toContain("Mine"); expect(closed).not.toContain("Kept");
    const open = renderToStaticMarkup(createElement(YoursRowView, { verseRef: "Genesis 1:2", open: true, onToggle: () => {}, translation: "Synthetic stored translation.", note: "Synthetic stored note.", starred: null }));
    expect(open).toContain('aria-label="Yours on Genesis 1:2"');
    expect(open).toContain("Synthetic stored translation."); expect(open).toContain("Synthetic stored note.");
    expect(open).toContain("My translation"); expect(open).toContain("My notes");
    expect(open).toContain(YOURS_STRINGS.privacy);
    expect(open).not.toMatch(/<textarea|<input|<form|<label|>Save<|dialog|aria-modal/);
    // A stream with nothing stored shows neither its label nor an empty field.
    const half = renderToStaticMarkup(createElement(YoursRowView, { verseRef: "Genesis 1:2", open: true, onToggle: () => {}, translation: undefined, note: "  ", starred: null }));
    expect(half).not.toMatch(/My translation|My notes|<textarea/);
    for (const value of Object.values(YOURS_STRINGS)) expect(value).not.toMatch(/!|nice|great/i);
  });
  it("offers no way to write notes or translations: the editor sources and their writers are gone from the components", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    const own = read("src/components/portal/workspace/study/own-layer.tsx"), yoursSource = read("src/components/portal/saved/yours.tsx"), drillSource = read("src/components/portal/public-reading/translate-drill.tsx");
    for (const source of [own, yoursSource, drillSource, read("src/components/portal/saved/saved-reading.tsx"), read("src/components/portal/public-reading/view.tsx")])
      expect(source).not.toMatch(/writeOwn|openStudy|saveSavedWork|savedText\(|<textarea|DrillDraft|noDraft/);
    expect(yoursSource).not.toMatch(/YoursField|onSave|Write one in Yours/);
  });
  it("is Daniel's approved sign-in card heading on a public reading, with the body unchanged", () => {
    const html = renderToStaticMarkup(createElement(Shell, { title: "Synthetic", children: null }));
    expect(html).toMatch(/<h2 id="public-sign-in-heading">Save this reading<\/h2>/);
    expect(html).toContain("Sign in to see your own verses, your tutor’s notes and your practice days. Everything on this page is open to anyone.");
    expect(html).not.toContain("Preparing for your Beit Mitzvah?");
    const signedIn = renderToStaticMarkup(createElement(Shell, { title: "Synthetic", children: null, signedIn: true }));
    expect(signedIn).not.toContain("public-sign-in-heading");
  });
  it("keeps text the server would keep, and refuses what it would refuse before asking", () => {
    expect(savedText("a\r\nb")).toBe("a\nb"); expect(savedText("")).toBe("");
    expect(savedText("א".repeat(2048))).toBe("א".repeat(2048)); expect(savedText("א".repeat(2049))).toBeNull();
    expect(savedText("a\u0000b")).toBeNull(); expect(savedText("a\u2028b")).toBeNull(); expect(savedText("\ud800")).toBeNull();
  });
  it("saves a verse's text and a star with exactly their fields, reading every answer strictly", async () => {
    let answer: { status: number; body: unknown } = { status: 200, body: { ok: true, verseRef: "Genesis 1:2", stream: "translation", work: { text: "Mine", version: 1, updatedAt: stamp } } };
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, body: init.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } }); });
    expect(await saveSavedWork({ readingId: ID, verseRef: "Genesis 1:2", stream: "translation", expectedVersion: 0, text: "Mine" })).toEqual({ ok: true, value: { text: "Mine", version: 1 } });
    expect(calls.at(-1)).toEqual({ url: "/api/saved/work", body: { readingId: ID, verseRef: "Genesis 1:2", stream: "translation", expectedVersion: 0, text: "Mine" } });
    answer = { status: 409, body: { ok: false, code: "conflict", current: { text: "Theirs", version: 2, updatedAt: stamp } } };
    const conflict = await saveSavedWork({ readingId: ID, verseRef: "Genesis 1:2", stream: "note", expectedVersion: 0, text: "Mine" });
    expect(conflict.ok === false && conflict.code === "conflict" && conflictWork(conflict.current)).toEqual({ text: "Theirs", version: 2 });
    expect(conflictWork(null)).toBeNull(); expect(conflictWork({ text: 1 })).toBeUndefined();
    answer = { status: 200, body: { ok: true, star: { work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true } } };
    expect(await setSavedStar({ work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true })).toEqual({ ok: true, value: { work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true } });
    expect(calls.at(-1)).toEqual({ url: "/api/saved/star", body: { work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true } });
    // An answer about another comment is not this star's.
    answer = { status: 200, body: { ok: true, star: { work: "rashi", verseRef: "Genesis 1:1", comment: 2, starred: true } } };
    expect(await setSavedStar({ work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true })).toEqual({ ok: false, code: "unavailable" });
    answer = { status: 409, body: { ok: false, code: "limit" } };
    expect(await setSavedStar({ work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true })).toEqual({ ok: false, code: "limit" });
    answer = { status: 200, body: { ok: true, stars: [{ work: "rashi", verseRef: "Genesis 1:1", comment: 1 }] } };
    expect(await fetchSavedStars()).toEqual({ state: "ready", stars: [{ work: "rashi", verseRef: "Genesis 1:1", comment: 1 }] });
    expect(calls.at(-1)).toEqual({ url: "/api/saved/stars", body: null });
  });
  it("reads the star list's refusals as the account's state and anything else as a failure", () => {
    expect(parseSavedStars(401, {})).toEqual({ state: "signed-out" });
    expect(parseSavedStars(403, {})).toEqual({ state: "not-eligible" });
    for (const bad of [{ ok: true, stars: [{ work: "rashi", verseRef: "Genesis 1:1", comment: 0 }] }, { ok: true, stars: [{ work: "<b>", verseRef: "Genesis 1:1", comment: 1 }] },
      { ok: true, stars: [{ work: "rashi", verseRef: "Genesis 1:1", comment: 1, extra: 1 }] }, { ok: true }, { ok: true, stars: {} }])
      expect(() => parseSavedStars(200, bad)).toThrow(SavedRequestError);
  });
});

describe("the approvers' help line", () => {
  it("is Daniel's approved wording, verbatim", () => {
    expect(APPROVER_HELP_LINE).toBe("Anyone who asks in good faith can have an account, member or not. Decline only spam or abuse.");
  });
});
