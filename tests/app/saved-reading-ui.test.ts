import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { conflictMark, fetchSavedPage, parseSavedPage, removeSavedReading, SavedRequestError, setSavedMark, updateSavedReading } from "../../src/components/portal/saved/api";
import { SavedReadingEdit, SavedReadingState, SavedVerseMarkReadOnly, SavedVerseMarks, type EditStep } from "../../src/components/portal/saved/saved-reading";
import { parseReadAddress, readAddress } from "../../src/components/portal/public-reading/urls";

// Synthetic saved readings only.
const ID = "00000000-0000-4000-8000-000000000001";
const reading = { id: ID, name: "Synthetic reading", date: "2026-10-24", kind: "torah", ranges: "Genesis 1:1-3", verseCount: 3, revision: 1, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" };
const stamp = "2026-10-22T00:00:00.000Z";
const page = (extra: Record<string, unknown> = {}) => ({ ok: true, reading, offset: 0, totalVerses: 3, nextOffset: null,
  verses: [{ ref: "Genesis 1:1", translation: null, note: null, mark: null }, { ref: "Genesis 1:2", translation: { text: "Mine", version: 2, updatedAt: stamp }, note: null, mark: { state: "working", version: 1, updatedAt: stamp } },
    { ref: "Genesis 1:3", translation: null, note: null, mark: { state: "got-it", version: 3, updatedAt: stamp } }], ...extra });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the saved reading's address", () => {
  it("is /read?saved=<id>, round-trips with verse and lens, and refuses anything that is not an id", () => {
    expect(readAddress({ mode: "saved", id: ID })).toBe(`/read?saved=${ID}`);
    expect(readAddress({ mode: "saved", id: ID }, { verse: 2, study: true })).toBe(`/read?saved=${ID}&verse=2&lens=study`);
    expect(parseReadAddress(`?saved=${ID}&verse=2&lens=study`)).toEqual({ target: { mode: "saved", id: ID }, verse: 2, study: true });
    expect(parseReadAddress(`?saved=${ID.toUpperCase()}`).target).toEqual({ mode: "saved", id: ID });
    for (const bad of ["?saved=", "?saved=nope", `?saved=${ID}x`, "?saved=../api"]) expect(parseReadAddress(bad).target, bad).toBeNull();
  });
  it("carries a learner with the saved id for the staff view (plan D7), and drops it without one or when it is not an id", () => {
    const learner = "00000000-0000-4000-8000-000000000002";
    expect(parseReadAddress(`?saved=${ID}&learner=${learner.toUpperCase()}`).target).toEqual({ mode: "saved", id: ID, learner });
    expect(readAddress({ mode: "saved", id: ID, learner })).toBe(`/read?saved=${ID}&learner=${learner}`);
    expect(readAddress({ mode: "saved", id: ID, learner }, { verse: 2, study: true })).toBe(`/read?saved=${ID}&learner=${learner}&verse=2&lens=study`);
    expect(parseReadAddress(`?saved=${ID}&learner=nope`).target).toEqual({ mode: "saved", id: ID });
    expect(parseReadAddress(`?learner=${learner}`).target).toEqual({ mode: "week", date: null, kind: null });
    expect(parseReadAddress(`?saved=nope&learner=${learner}`).target).toBeNull();
  });
});

describe("the saved reading client", () => {
  it("reads a page of verses with their marks, and the account's refusals as states", () => {
    const value = parseSavedPage(200, page(), 0);
    expect(value.state === "ready" && value.verses.map(row => row.mark?.state ?? null)).toEqual([null, "working", "got-it"]);
    expect(value.state === "ready" && value.verses[1].translation).toEqual({ text: "Mine", version: 2 });
    expect(parseSavedPage(401, {}, 0)).toEqual({ state: "signed-out" });
    expect(parseSavedPage(403, {}, 0)).toEqual({ state: "not-eligible" });
    expect(parseSavedPage(404, {}, 0)).toEqual({ state: "missing" });
    for (const [bad, offset] of [[page({ offset: 10 }), 0], [page({ totalVerses: 4 }), 0], [page({ verses: [] }), 0], [page({ nextOffset: 7 }), 0], [page({ extra: 1 }), 0],
      [page({ verses: [{ ref: "Genesis 1:1", translation: null, note: null, mark: { state: "done", version: 1, updatedAt: stamp } }] }), 0],
      [page({ verses: [{ ref: "<b>", translation: null, note: null, mark: null }] }), 0], [page(), 10]] as const)
      expect(() => parseSavedPage(200, bad, offset)).toThrow(SavedRequestError);
    expect(() => parseSavedPage(503, null, 0)).toThrow(SavedRequestError);
  });
  it("asks for one page by id and offset only, and refuses a bad id before any request", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { calls.push(url); return new Response(JSON.stringify(page()), { status: 200, headers: { "content-type": "application/json" } }); });
    expect((await fetchSavedPage(ID, 0)).state).toBe("ready");
    expect(calls).toEqual([`/api/saved/reading?id=${ID}`]);
    await expect(fetchSavedPage("nope", 0)).rejects.toThrow(SavedRequestError);
    await expect(fetchSavedPage(ID, -1)).rejects.toThrow(SavedRequestError);
    expect(calls).toHaveLength(1);
  });
  it("turns edit and mark answers into results, conflicts carrying what is saved now", async () => {
    let answer: { status: number; body: unknown } = { status: 200, body: { ok: true, reading: { ...reading, name: "Renamed", revision: 2 } } };
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(init.body as string)); return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } }); });
    expect(await updateSavedReading({ id: ID, revision: 1, name: "Renamed", date: null })).toMatchObject({ ok: true, value: { name: "Renamed", revision: 2 } });
    expect(bodies.at(-1)).toEqual({ id: ID, revision: 1, name: "Renamed", date: null });
    answer = { status: 409, body: { ok: false, code: "conflict", current: reading } };
    expect(await updateSavedReading({ id: ID, revision: 1, name: "Renamed", date: null })).toEqual({ ok: false, code: "conflict", current: reading });
    answer = { status: 200, body: { ok: true, removed: ID } };
    expect(await removeSavedReading({ id: ID, revision: 2 })).toEqual({ ok: true, value: ID });
    answer = { status: 200, body: { ok: true, removed: "00000000-0000-4000-8000-000000000002" } };
    expect(await removeSavedReading({ id: ID, revision: 2 })).toEqual({ ok: false, code: "unavailable" });
    answer = { status: 200, body: { ok: true, verseRef: "Genesis 1:2", mark: { state: "got-it", version: 2, updatedAt: stamp } } };
    expect(await setSavedMark({ readingId: ID, verseRef: "Genesis 1:2", expectedVersion: 1, state: "got-it" })).toEqual({ ok: true, value: { state: "got-it", version: 2 } });
    answer = { status: 409, body: { ok: false, code: "limit" } };
    expect(await setSavedMark({ readingId: ID, verseRef: "Genesis 1:2", expectedVersion: 0, state: "working" })).toEqual({ ok: false, code: "limit" });
    for (const [status, code] of [[401, "signed-out"], [403, "not-eligible"], [404, "missing"], [400, "invalid"], [503, "unavailable"]] as const) {
      answer = { status, body: { error: "x" } };
      expect(await setSavedMark({ readingId: ID, verseRef: "Genesis 1:2", expectedVersion: 0, state: "working" })).toEqual({ ok: false, code });
    }
    expect(conflictMark(null)).toBeNull();
    expect(conflictMark({ state: "working", version: 4, updatedAt: stamp })).toEqual({ state: "working", version: 4 });
    expect(conflictMark({ state: "done" })).toBeUndefined();
  });
});

describe("the saved reading page's parts", () => {
  const edit = (step: EditStep, notice = "") => renderToStaticMarkup(createElement(SavedReadingEdit, { step, panelId: "edit", name: "Synthetic reading", date: "2026-10-24", notice,
    onName: () => {}, onDate: () => {}, onSave: () => {}, onCancel: () => {}, onAskRemove: () => {}, onRemove: () => {}, onKeep: () => {} }));
  it("opens Edit inline with the name and date, and asks once before removing", () => {
    expect(edit("closed")).toBe("");
    expect(edit("closed", "Saved.")).toContain('role="status">Saved.</p>');
    const open = edit("open");
    expect(open).toContain('aria-label="Edit this reading"');
    expect(open).toContain('value="Synthetic reading"');
    expect(open).toContain('type="date" name="date" value="2026-10-24"');
    expect(open).toContain(">Save changes</button>");
    expect(open).toContain(">Remove reading</button>");
    expect(open).not.toContain("can’t be undone");
    const confirm = edit("confirm");
    expect(confirm).toContain("Removes this reading with its marks, notes and translation. This can’t be undone.");
    expect(confirm).toContain(">Remove</button>");
    expect(confirm).toContain(">Keep it</button>");
    expect(confirm).not.toContain(">Remove reading</button>");
    expect(edit("removing")).toMatch(/disabled="">Remove<\/button>/);
    expect(edit("open", "This reading changed elsewhere. The form shows what’s saved now.")).toContain('role="alert"');
    for (const step of ["open", "confirm"] as const) expect(edit(step)).not.toMatch(/dialog|aria-modal|!/);
  });
  it("shows a verse's mark with the progress marks' words, and waits while it loads", () => {
    const marks = (mark: Parameters<typeof SavedVerseMarks>[0]["mark"], pending = false, notice = "") =>
      renderToStaticMarkup(createElement(SavedVerseMarks, { verseRef: "Genesis 1:2", mark, pending, notice, onChoose: () => {} }));
    const working = marks({ state: "working", version: 1 });
    expect(working).toContain('aria-label="How Genesis 1:2 is going"');
    expect(working).toMatch(/data-state="working" aria-pressed="true"[^>]*>Still working<\/button>/);
    expect(working).toMatch(/data-state="got-it" aria-pressed="false"[^>]*><svg[^]*Got it<\/button>/);
    expect(marks(null)).not.toContain('aria-pressed="true"');
    expect(marks(undefined)).toContain('aria-disabled="true"');
    expect(marks({ state: "got-it", version: 2 }, true)).toContain('aria-disabled="true"');
    expect(marks(null, false, "This mark changed elsewhere. It shows what’s saved now.")).toContain("This mark changed elsewhere");
  });
  it("the learner view's mark is read-only: the learner's state in words, no buttons, nothing when unmarked", () => {
    const view = (mark: Parameters<typeof SavedVerseMarkReadOnly>[0]["mark"]) => renderToStaticMarkup(createElement(SavedVerseMarkReadOnly, { verseRef: "Genesis 1:2", mark }));
    expect(view({ state: "working", version: 1 })).toContain("Still working");
    expect(view({ state: "got-it", version: 3 })).toContain("Got it");
    expect(view({ state: "got-it", version: 3 })).toContain('data-testid="learner-mark"');
    for (const markup of [view({ state: "working", version: 1 }), view({ state: "got-it", version: 3 })]) { expect(markup).not.toContain("<button"); expect(markup).not.toContain("aria-pressed"); }
    expect(view({ state: "unmarked", version: 2 })).toBe("");
    expect(view(null)).toBe(""); expect(view(undefined)).toBe("");
  });
  it("says plainly why a saved reading cannot open", () => {
    const state = (status: Parameters<typeof SavedReadingState>[0]["status"]) => renderToStaticMarkup(createElement(SavedReadingState, { status, onRetry: () => {} }));
    expect(state("signed-out")).toContain('href="/sign-in">Sign in</a>');
    expect(state("not-eligible")).toContain("Saving isn’t available for this account.");
    expect(state("not-eligible")).not.toContain("/account");
    expect(state("missing")).toContain("This reading isn’t in your saved readings");
    expect(state("missing")).toContain('href="/read">Go to this week</a>');
    expect(state("failed")).toContain(">Try again</button>");
  });
});
