// Invented source bytes and native event clocks; no real media/corpus/network.
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { createReadingPlayback } from "../../src/components/portal/workspace/study/main-playback";
import { FlowingStudyText, StudyHebrew, studyFlowGroups } from "../../src/components/portal/workspace/study/annotations";
import { ReadingPlayer, playMainVerseForWord } from "../../src/components/portal/workspace/study/reading-player";
import { ReadingToolbar } from "../../src/components/portal/workspace/reading-toolbar";
import { createReferencePlayback, createReferenceAudioReuse, type ReferenceAudioElement } from "../../src/lib/reference-audio/playback";
import type { ReferenceResolution } from "../../src/lib/reference-audio/source";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { normalizeHebrew } from "../../src/server/study/normalize";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
vi.mock("server-only", () => ({}));
const data = new Uint8Array([1, 2, 3, 4]), text = "אבג דהו זחט";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const source = { schema: "reference-source/v1" as const, asset: "ra_" + "a".repeat(32), url: "https://archive.org/download/PockettorahAudioFiles/Synthetic-main.mp3", sha256: hash(data), bytes: data.length };
function resolution(index: number, timed = true): ReferenceResolution {
  const start = index ? 20 : 10;
  return { source, verse: { schema: "reference-verse/v1", ref: `Genesis 1:${index + 1}`, table: "torah", playback: { status: "ready", asset: source.asset, clip: { start, end: start + 5 } }, words: timed ? { status: "ready", readingTextSha256: hash(text), starts: [start + 0.5, start + 2, start + 4] } : { status: "unavailable", reason: "no-words" }, attribution: REFERENCE_ATTRIBUTION } };
}
function response() { const value = new Response(data); Object.defineProperty(value, "url", { value: "https://ia800000.us.archive.org/synthetic.mp3" }); return value; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
class Media extends EventTarget {
  src = ""; preload = ""; duration = 40; currentTime = 0; playbackRate = 1; preservesPitch = true;
  play = vi.fn<() => Promise<void>>().mockResolvedValue(); pause = vi.fn();
  load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata"))); }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
}
function fixture(load = vi.fn(async (index: number) => resolution(index)), fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response())) {
  const media: Media[] = [], revoked: string[] = [], active: unknown[] = [];
  const platform = { fetch: fetcher, audio() { const value = new Media(); media.push(value); return value as ReferenceAudioElement; }, createUrl: () => `blob:synthetic-${media.length}`, revokeUrl: (url: string) => { revoked.push(url); },
    scheduler: { frame: () => 1, cancelFrame() {}, timer: () => 1 as unknown as ReturnType<typeof setTimeout>, clearTimer() {} } };
  const owner = createReadingPlayback({ verses: [0, 1].map(index => ({ ref: `Genesis 1:${index + 1}`, readingText: text, wordCount: 3 })), load, onState() {}, onActiveWord: value => { active.push(value); }, platform });
  return { owner, media, revoked, active, load, fetcher, platform };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("main second-word activation plays the whole verse from its start while grammar retains the tapped word and highlights advance", async () => {
  const f = fixture(), selected = vi.fn(), pending: Promise<void>[] = [];
  const player = { select(index: number, selection?: "verse" | number) { pending.push(f.owner.select(index, selection)); } };
  playMainVerseForWord(player, { select: selected }, 0, 1); await Promise.all(pending);
  expect(f.owner.state.selection).toBe("verse"); expect(f.media[0].currentTime).toBe(10); expect(selected).toHaveBeenLastCalledWith(0, 1);
  f.media[0].currentTime = 10.6; f.media[0].dispatchEvent(new Event("timeupdate")); expect(f.active.at(-1)).toEqual({ verse: 0, index: 0 });
  f.media[0].currentTime = 12.1; f.media[0].dispatchEvent(new Event("timeupdate")); expect(f.active.at(-1)).toEqual({ verse: 0, index: 1 });
  await f.owner.select(0, 1); expect(f.owner.state.selection).toBe(1); expect(f.media[0].currentTime).toBe(12); f.owner.dispose();
});

it("rapid main word intents still choose the latest whole verse and never start a held older selection", async () => {
  const held = deferred<ReferenceResolution>(), f = fixture(vi.fn(index => index ? Promise.resolve(resolution(index)) : held.promise)), pending: Promise<void>[] = [], tools = vi.fn();
  const player = { select(index: number, selection?: "verse" | number) { pending.push(f.owner.select(index, selection)); } };
  playMainVerseForWord(player, { select: tools }, 0, 2); playMainVerseForWord(player, { select: tools }, 1, 1);
  await pending[1]; held.resolve(resolution(0)); await pending[0];
  expect(f.owner.state).toMatchObject({ verse: 1, selection: "verse" }); expect(f.media).toHaveLength(1); expect(f.media[0].currentTime).toBe(20);
  expect(f.media[0].play).toHaveBeenCalledTimes(1); expect(tools).toHaveBeenLastCalledWith(1, 1); f.owner.dispose();
});

it("main verse playback needs no word timing but an explicit numeric drill still refuses missing timing", async () => {
  const f = fixture(vi.fn(async index => resolution(index, false))), pending: Promise<void>[] = [];
  playMainVerseForWord({ select(index, selection) { pending.push(f.owner.select(index, selection)); } }, null, 0, 1); await Promise.all(pending);
  expect(f.owner.state).toMatchObject({ selection: "verse", timingHeld: false }); expect(f.media[0].play).toHaveBeenCalledTimes(1);
  await f.owner.select(0, 1); expect(f.owner.state.timingHeld).toBe(true); expect(f.media[0].play).toHaveBeenCalledTimes(1); f.owner.dispose();
});

it("flowing keyboard affordances name whole verse while lifted/explicit word labels retain word identity", () => {
  const verse: StudyVerse = { ref: "Genesis 1:1", english: null, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } };
  const flowing = renderToStaticMarkup(createElement(FlowingStudyText, { verses: [verse], assignment: { kind: "torah", confirmed: true, verses: [verse.ref] }, group: "main", activeWord: null, onWord() {}, onVerse() {} }));
  expect(flowing).toContain('tabindex="0"'); expect(flowing).toContain('Hear whole verse Genesis 1:1; select word 2 for tools');
  const lifted = renderToStaticMarkup(createElement(StudyHebrew, { verse, colors: null, id: "lifted", onWordSelect() {} }));
  expect(lifted).toContain('Hear word 2 of Genesis 1:1'); expect(lifted).not.toContain("Hear whole verse");
  const initial = renderToStaticMarkup(createElement(ReadingPlayer, { scopeKey: "main", verses: [verse], active: true, load: vi.fn(), register() {}, onActiveWord() {} }));
  expect(initial).toContain("hear the whole verse"); expect(initial).not.toContain("Click a word to hear it");
});

it("held listening preserves the exact flowing text and word-tool affordances without Hear promises", () => {
  const hebrew = normalizeHebrew('אָ֑ב <span class="mam-kq"><span class="mam-kq-k">זָ</span><span class="mam-kq-q">[גַּ]</span></span>');
  const verse: StudyVerse = { ref: "Genesis 1:1", english: null, hebrew: { ...hebrew, segments: [...hebrew.segments] } };
  const common = { verses: [verse], assignment: { kind: "torah" as const, confirmed: true, verses: [verse.ref] }, group: "main", activeWord: null, onWord() {} };
  const held = renderToStaticMarkup(createElement(FlowingStudyText, { ...common, listening: false }));
  expect(held).toContain("Select word 2 of Genesis 1:1 for tools"); expect(held).toContain("study-read-alternative"); expect(held).toContain('tabindex="-1"'); expect(held).not.toContain("Hear");
  const enabled = renderToStaticMarkup(createElement(FlowingStudyText, { ...common, onVerse() {} }));
  const textOnly = (html: string) => html.replace(/<[^>]*>/g, "");
  const heldText = textOnly(held);
  expect(heldText.trim()).not.toBe(""); expect(heldText).toContain("אָ֑ב"); expect(heldText).toContain("גַּ");
  expect(heldText).toBe(textOnly(enabled));
  type ToolbarProps = NonNullable<Parameters<typeof ReadingToolbar>[0]>;
  const toolbar = renderToStaticMarkup(createElement<ToolbarProps>(ReadingToolbar, { onHear() {} })); expect(toolbar).not.toContain("Hear verse");
  expect(renderToStaticMarkup(createElement<ToolbarProps>(ReadingToolbar, { onHear() {}, listeningEnabled: true }))).toContain("Hear verse");
});

it("plays a clicked word in one explicit request, reuses same-verse media and adjacent verified bytes but refreshes authority", async () => {
  const f = fixture(); expect(f.load).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  await f.owner.select(0, 1); expect(f.media).toHaveLength(1); expect(f.media[0].play).toHaveBeenCalledTimes(1); expect(f.media[0].currentTime).toBe(12);
  await f.owner.select(0, 2); expect(f.load).toHaveBeenCalledTimes(1); expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.media[0].currentTime).toBe(14);
  f.owner.setSpeed(0.5); f.owner.setRepeat(true);
  await f.owner.select(1, 0); expect(f.media[0].playbackRate).toBe(0.5); expect(f.owner.state.playback.repeat).toBe(true); expect(f.load).toHaveBeenCalledTimes(2); expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.media).toHaveLength(1);
  expect(f.media[0].src).not.toBe(""); expect(f.media[0].pause).toHaveBeenCalled(); expect(f.media[0].currentTime).toBe(20.5); expect(f.media[0].play).toHaveBeenCalledTimes(3);
  f.owner.dispose(); expect(f.media[0].src).toBe(""); expect(f.revoked).toHaveLength(1);
});
it("latest intent wins both held cross-verse authority and shared same-verse download without late play", async () => {
  const gate = deferred<ReferenceResolution>(), f = fixture(vi.fn(index => index ? Promise.resolve(resolution(1)) : gate.promise));
  const old = f.owner.select(0, 0); await f.owner.select(1, 1); gate.resolve(resolution(0)); await old;
  expect(f.media).toHaveLength(1); expect(f.media[0].currentTime).toBe(22); expect(f.media[0].play).toHaveBeenCalledTimes(1); f.owner.dispose();
  const body = deferred<Response>(), g = fixture(undefined, vi.fn(() => body.promise));
  const first = g.owner.select(0, 0), latest = g.owner.select(0, 2); body.resolve(response()); await Promise.all([first, latest]);
  expect(g.media).toHaveLength(1); expect(g.media[0].currentTime).toBe(14); expect(g.media[0].play).toHaveBeenCalledTimes(1); expect(g.load).toHaveBeenCalledTimes(1); g.owner.dispose();
});
it("a word without proven timing pauses and holds instead of broadening to a verse; explicit verse restores play", async () => {
  const f = fixture(vi.fn(async index => resolution(index, false))); await f.owner.select(0, 1);
  expect(f.owner.state.timingHeld).toBe(true); expect(f.media[0].play).not.toHaveBeenCalled(); f.owner.setRepeat(true); expect(f.owner.state.playback.repeat).toBe(false);
  await f.owner.select(0, "verse"); expect(f.owner.state.timingHeld).toBe(false); expect(f.media[0].play).toHaveBeenCalledTimes(1);
  await f.owner.select(0, 2); expect(f.owner.state.timingHeld).toBe(true); expect(f.media[0].play).toHaveBeenCalledTimes(1); expect(f.media[0].pause).toHaveBeenCalled(); f.owner.dispose();
});
it("background suspension cancels work and never resumes itself; explicit retry refreshes authority and may reuse verified bytes", async () => {
  const f = fixture(); await f.owner.select(0, 0); f.owner.setSpeed(0.75); f.owner.setRepeat(true); f.owner.suspend(); expect(f.media[0].src).toBe(""); expect(f.owner.state.suspended).toBe(true);
  await Promise.resolve(); expect(f.media).toHaveLength(1); await f.owner.play(); expect(f.media).toHaveLength(2); expect(f.media[1].playbackRate).toBe(0.75); expect(f.owner.state.playback.repeat).toBe(true); expect(f.load).toHaveBeenCalledTimes(2); expect(f.fetcher).toHaveBeenCalledTimes(1); f.owner.dispose();
  const body = deferred<Response>(), entered = deferred<void>(), canceled = deferred<void>();
  const g = fixture(undefined, vi.fn(() => { entered.resolve(undefined); return body.promise; })), work = g.owner.select(0, 1);
  // Text hashing is asynchronous: observe the held download before suspending.
  await entered.promise; expect(g.fetcher).toHaveBeenCalledTimes(1); expect(g.owner.state.playback.status).toBe("loading"); expect(g.media).toHaveLength(0);
  g.owner.suspend(); await work; const late = response(), originalCancel = late.body!.cancel.bind(late.body!);
  const cancel = vi.spyOn(late.body!, "cancel").mockImplementation(async reason => { try { return await originalCancel(reason); } finally { canceled.resolve(undefined); } });
  body.resolve(late); await canceled.promise; expect(cancel).toHaveBeenCalledTimes(1); expect(g.media).toHaveLength(0); g.owner.dispose();
});
it("rejects wrong ref/text timing despite reusable bytes, malformed capabilities and changed immutable source keys", async () => {
  const load = vi.fn(async (index: number) => { const value = resolution(index); return index ? { ...value, source: { ...source, url: source.url.replace("main", "other") } } : value; }), f = fixture(load);
  await f.owner.select(0, 0); await f.owner.select(1, 0); expect(f.fetcher).toHaveBeenCalledTimes(2); f.owner.dispose();
  const g = fixture(vi.fn(async () => resolution(0))); await g.owner.select(1, 0); expect(g.fetcher).not.toHaveBeenCalled(); expect(g.media).toHaveLength(0); g.owner.dispose();
  const bypass = createReferencePlayback({ ref: "Genesis 1:1", readingText: text, wordCount: 3, load: async () => resolution(0), assetReuse: Object.freeze({ clear() {} }), ...f.platform });
  await bypass.load(); expect(bypass.state.status).toBe("error"); bypass.dispose();
});
it("clear fences an in-flight verified Blob and never caches a failed or obsolete download", async () => {
  const capability = createReferenceAudioReuse(), f = fixture(), gate = deferred<Response>(), entered = deferred<void>();
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => { entered.resolve(undefined); return gate.promise; }).mockImplementation(async () => response());
  const make = () => createReferencePlayback({ ...f.platform, fetch: fetcher, ref: "Genesis 1:1", readingText: text, wordCount: 3, load: async () => resolution(0), assetReuse: capability });
  const first = make(), loading = first.load();
  // The real text digest precedes fetch; a timer tick cannot prove entry.
  await entered.promise; expect(fetcher).toHaveBeenCalledTimes(1); expect(first.state.status).toBe("loading"); expect(f.media).toHaveLength(0);
  capability.clear(); gate.resolve(response()); await loading; expect(first.state.status).toBe("error"); expect(f.media).toHaveLength(0);
  const second = make(); await second.load(); expect(second.state.status).toBe("ready"); expect(fetcher).toHaveBeenCalledTimes(2); first.dispose(); second.dispose(); capability.clear();
});
it("preserves play-rejection retry and ignores escaped selection after disposal", async () => {
  const f = fixture(), pending = f.owner.select(0, 0); await pending; f.media[0].play.mockRejectedValueOnce(new Error("synthetic gesture refusal")); await f.owner.play();
  expect(f.owner.state.playback).toMatchObject({ status: "ready", retryPlay: true }); await f.owner.play(); expect(f.owner.state.playback.status).toBe("playing");
  f.owner.dispose(); const requests = f.load.mock.calls.length; await f.owner.select(1, 0); expect(f.load).toHaveBeenCalledTimes(requests);
});
it("flows consecutive Hebrew without verse cards, while preserving actual breaks, qere and canonical keyboard words", () => {
  const verse = (ref: string, value = "בָּ֑ג דָּ֖ה"): StudyVerse => { const hebrew = normalizeHebrew(value); return { ref, hebrew: { ...hebrew, segments: hebrew.segments.map(part => ({ ...part })) }, english: "Synthetic" }; };
  const verses = [verse("Genesis 1:1", 'בָּ֑ג־<span class="mam-kq"><span class="mam-kq-k">זָח</span><span class="mam-kq-q">[דָּ֖ה]</span></span>'), verse("Genesis 1:2"), verse("Genesis 1:4"), verse("Genesis 2:1")];
  expect(studyFlowGroups(verses)).toEqual([[0,1],[2],[3]]);
  expect(studyFlowGroups([{ ...verses[0], hebrew: { ...verses[0].hebrew, paragraphAfter: "petuchah" } }, ...verses.slice(1)])).toEqual([[0],[1],[2],[3]]);
  const markup = renderToStaticMarkup(createElement(FlowingStudyText, { verses, assignment: { kind: "torah", confirmed: true, verses: verses.map(value => value.ref) }, group: "synthetic", onVerse() {}, onWord() {}, activeWord: { verse: 0, index: 1 } }));
  expect(markup).not.toContain("verse-card"); expect(markup).not.toContain("<article"); expect(markup).not.toContain("<dialog");
  expect(markup).toContain('aria-label="Hear Genesis 1:1"'); expect(markup).toContain('aria-label="Hear whole verse Genesis 1:1; select word 2 for tools"'); expect(markup).toContain('data-reference-active="true"'); expect(markup).toMatch(/זָח<\/span><span class="study-read-alternative"/);
  const load = vi.fn(); renderToStaticMarkup(createElement(ReadingPlayer, { scopeKey: "synthetic", verses, active: true, load, register() {}, onActiveWord() {} })); expect(load).not.toHaveBeenCalled();
});

it("keeps speed preference through an unsupported native capability without claiming it was applied", async () => {
  const f = fixture(); await f.owner.select(0, 0); f.owner.setSpeed(0.5); f.owner.setRepeat(true);
  const native = f.platform.audio; let count = 0;
  // Construct a separate owner with a capability that disappears on the second verse.
  const owner = createReadingPlayback({ verses: [0,1].map(index => ({ ref: `Genesis 1:${index + 1}`, readingText: text, wordCount: 3 })), load: async index => { const value = resolution(index); return index ? { ...value, source: { ...source, url: source.url.replace("main", "unsupported") } } : value; }, onState() {}, onActiveWord() {},
    platform: { ...f.platform, audio() { const media = native(); if (++count === 2) Object.defineProperty(media, "preservesPitch", { value: undefined }); return media; } } });
  await owner.select(0, 0); owner.setSpeed(0.75); owner.setRepeat(true); await owner.select(1, 0);
  expect(owner.state.playback).toMatchObject({ speed: 1, speedSupported: false, repeat: true });
  await owner.select(0, 1); expect(owner.state.playback).toMatchObject({ speed: 0.75, speedSupported: true, repeat: true }); owner.dispose(); f.owner.dispose();
});
