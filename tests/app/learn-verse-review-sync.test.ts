import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createVerseReviewSync, parseVerseRemote, type VerseState } from "../../src/components/learn/verse-review-sync";
import { addVerseCards, emptyVerseReview, recordVerse, verseCardId, VERSE_REVIEW_SCHEMA } from "../../src/lib/learn/verse-review";

vi.mock("server-only", () => ({}));
// 1.9 N19: the browser side of a student's own verse cards. Synthetic answers only; nothing is stored on the device.
const { markedVerses } = await import("../../src/components/learn/own-verses");
const D = "2026-11-02", NOA = verseCardId("torah", "Genesis 23:1"), SECOND = verseCardId("torah", "Genesis 23:2");
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const doc = (cards: Record<string, [number, string]>) => ({ schema: VERSE_REVIEW_SCHEMA, cards: Object.fromEntries(Object.entries(cards).map(([id, [box, due]]) => [id, { box, due }])) });
function harness(answers: Response[]) {
  const calls: { path: string; body: unknown }[] = [], states: VerseState[] = [], timers: (() => void)[] = [];
  const fetch = vi.fn(async (path: string, init?: RequestInit) => { calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return answers.shift() ?? json({ error: "unavailable" }, 503); });
  const sync = createVerseReviewSync({ fetch: fetch as unknown as typeof globalThis.fetch, onState: state => states.push(state), timer: callback => { timers.push(callback); return timers.length; }, clearTimer: () => {} });
  const tick = async () => { for (const callback of timers.splice(0)) callback(); await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { sync, calls, states, tick };
}

const A = "a".repeat(32), B = "b".repeat(32);
const ok = (owner: string, review: unknown, version: number, until: string | null = null) => ({ ok: true, owner, review, version, until });
describe("the verse cards in the browser", () => {
  it("reads the account's cards, writes a change under the version and owner last seen, and keeps nothing on the device", async () => {
    for (const path of ["src/components/learn/verse-review-sync.ts", "src/components/learn/own-verses.ts", "src/components/learn/verse-run.tsx", "src/components/learn/run-through.tsx"])
      expect(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), path).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|document\.cookie/);
    const h = harness([json(ok(A, null, 0, "2027-01-02")), json(ok(A, doc({ [NOA]: [1, "2026-11-03"] }), 1, "2027-01-02"))]);
    await h.sync.start();
    expect(h.sync.state).toEqual({ status: "ready", review: emptyVerseReview(), until: "2027-01-02" });
    h.sync.update(review => addVerseCards(review, [NOA], D, "2027-01-02"));
    await h.tick();
    expect(h.calls.map(call => call.path)).toEqual(["/api/learn/verses", "/api/learn/verses/put"]);
    expect(h.calls[1].body).toEqual({ review: doc({ [NOA]: [1, "2026-11-03"] }), expectedVersion: 0, expectedOwner: A });
    expect(h.sync.state).toMatchObject({ status: "ready", review: doc({ [NOA]: [1, "2026-11-03"] }) });
  });
  it("merges a stale write with the other device's cards, each at the higher box, and writes again", async () => {
    const theirs = doc({ [SECOND]: [3, "2026-11-10"] });
    const h = harness([json(ok(A, null, 0)), json({ ok: false, code: "conflict", current: ok(A, theirs, 4) }, 409), json(ok(A, doc({ [NOA]: [0, D], [SECOND]: [3, "2026-11-10"] }), 5))]);
    await h.sync.start();
    h.sync.update(review => recordVerse(review, NOA, false, D));
    await h.tick();
    expect(h.calls.map(call => call.path)).toEqual(["/api/learn/verses", "/api/learn/verses/put", "/api/learn/verses/put"]);
    expect(h.calls[2].body).toEqual({ review: doc({ [NOA]: [0, D], [SECOND]: [3, "2026-11-10"] }), expectedVersion: 4, expectedOwner: A });
  });
  it("never folds one student's cards into another's: an answer for someone else drops the cards and sends nothing more", async () => {
    // Sibling A's page stays open; B signs in in another tab. The server answers for B (a conflict carrying B's cards, or a refusal).
    for (const answer of [json({ ok: false, code: "conflict", current: ok(B, doc({ [SECOND]: [2, D] }), 3) }, 409), json(ok(B, doc({ [NOA]: [0, D] }), 1)), json({ error: "forbidden" }, 403)]) {
      const h = harness([json(ok(A, null, 0)), answer]);
      await h.sync.start();
      h.sync.update(review => recordVerse(review, NOA, false, D));
      await h.tick();
      expect(h.sync.state).toEqual({ status: "unavailable" });
      h.sync.update(review => recordVerse(review, SECOND, false, D)); h.sync.flush();
      await h.tick();
      expect(h.calls.map(call => call.path)).toEqual(["/api/learn/verses", "/api/learn/verses/put"]);
      expect((h.calls[1].body as { expectedOwner: string }).expectedOwner).toBe(A);
    }
  });
  it("drops what it holds on sign-out and reads afresh, for the new owner, on the next start", async () => {
    const h = harness([json(ok(A, doc({ [NOA]: [2, D] }), 1)), json(ok(B, null, 0))]);
    await h.sync.start();
    h.sync.update(review => recordVerse(review, SECOND, false, D));
    h.sync.reset();
    expect(h.sync.state).toEqual({ status: "unknown" });
    await h.tick();
    await h.sync.start();
    expect(h.sync.state).toEqual({ status: "ready", review: emptyVerseReview(), until: null });
    h.sync.update(review => recordVerse(review, NOA, false, D)); await h.tick();
    expect(h.calls.map(call => call.path)).toEqual(["/api/learn/verses", "/api/learn/verses", "/api/learn/verses/put"]);
    expect(h.calls[2].body).toEqual({ review: doc({ [NOA]: [0, D] }), expectedVersion: 0, expectedOwner: B });
  });
  it("is unavailable to anyone the server refuses, and then sends nothing", async () => {
    for (const status of [401, 403]) {
      const h = harness([json({ error: "forbidden" }, status)]);
      await h.sync.start();
      expect(h.sync.state).toEqual({ status: "unavailable" });
      h.sync.update(review => addVerseCards(review, [NOA], D));
      await h.tick();
      expect(h.calls).toHaveLength(1);
    }
  });
  it("parses the account's answer strictly", () => {
    expect(parseVerseRemote(ok(A, null, 0))).toEqual({ owner: A, review: null, version: 0, until: null });
    for (const bad of [ok(A, null, 1), ok(A, doc({}), 0), { ok: true, review: null, version: 0, until: null }, ok("x", null, 0), { ...ok(A, null, 0), extra: 1 },
      ok(A, { schema: "learn-progress/v1", cards: {} }, 1), ok(A, null, 0, "soon")]) expect(parseVerseRemote(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("two tabs, two accounts, one browser (the progress-sync race)", () => {
  // One browser's cookie jar, shared by both tabs; a fake server that keeps one document per account, as the real one does
  // (owner check before anything is read or written). Every request reads the cookie at the moment it is sent.
  function browser() {
    let cookie: "A" | "B" = "A";
    const docs: Record<string, { review: unknown; version: number }> = { A: { review: null, version: 0 }, B: { review: null, version: 0 } };
    const name = (who: string) => who.toLowerCase().repeat(32);
    const held: (() => void)[] = [];
    const server = (path: string, init?: RequestInit) => {
      const who = cookie, mine = docs[who], view = () => ({ ok: true, owner: name(who), review: mine.review, version: mine.version, until: null });
      if (!init?.body) return json(view());
      const body = JSON.parse(String(init.body)) as { review: unknown; expectedVersion: number; expectedOwner: string };
      if (body.expectedOwner !== name(who)) return json({ error: "forbidden" }, 403);
      if (body.expectedVersion !== mine.version) return json({ ok: false, code: "conflict", current: view() }, 409);
      mine.review = body.review; mine.version++;
      return json(view());
    };
    const tab = (slow = false) => {
      const timers: (() => void)[] = [];
      const fetch = async (path: string, init?: RequestInit) => { const answer = server(path, init); if (slow && init?.body) await new Promise<void>(resolve => held.push(resolve)); return answer; };
      const sync = createVerseReviewSync({ fetch: fetch as unknown as typeof globalThis.fetch, onState: () => {}, timer: callback => { timers.push(callback); return timers.length; }, clearTimer: () => {} });
      const tick = async () => { for (const callback of timers.splice(0)) callback(); for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
      return { sync, tick };
    };
    return { tab, docs, signIn: (who: "A" | "B") => { cookie = who; }, release: async () => { for (const resolve of held.splice(0)) resolve(); for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); } };
  }
  it("a slow answer for A that lands after B took the browser stays A's: B's cards and B's tab are untouched, and nothing is kept on the device", async () => {
    const b = browser(), one = b.tab(true);
    await one.sync.start();
    one.sync.update(review => recordVerse(review, NOA, false, D));
    await one.tick();                       // A's write leaves with A's cookie and its answer is held
    b.signIn("B");
    const two = b.tab();
    await two.sync.start();
    two.sync.update(review => recordVerse(review, SECOND, false, D)); await two.tick();
    await b.release();                      // A's answer lands now, after B took the browser
    expect(b.docs.A.review).toEqual(doc({ [NOA]: [0, D] }));
    expect(b.docs.B.review).toEqual(doc({ [SECOND]: [0, D] }));
    expect(two.sync.state).toEqual({ status: "ready", review: doc({ [SECOND]: [0, D] }), until: null });
    // Tab one's next change goes out with B's cookie and A's owner: refused, dropped, and B's document is unchanged.
    one.sync.update(review => recordVerse(review, SECOND, true, D)); one.sync.update(review => recordVerse(review, verseCardId("torah", "Genesis 23:3"), false, D));
    await one.tick(); await b.release();
    expect(one.sync.state).toEqual({ status: "unavailable" });
    expect(b.docs.B).toEqual({ review: doc({ [SECOND]: [0, D] }), version: 1 });
    expect(b.docs.A).toEqual({ review: doc({ [NOA]: [0, D] }), version: 1 });
  });
  it("a write queued in A's tab that leaves after B signed in is refused before anything is read or written", async () => {
    const b = browser(), one = b.tab();
    await one.sync.start();
    one.sync.update(review => recordVerse(review, NOA, false, D));
    b.signIn("B");
    await one.tick();
    expect(one.sync.state).toEqual({ status: "unavailable" });
    expect(b.docs.B).toEqual({ review: null, version: 0 });
    expect(b.docs.A).toEqual({ review: null, version: 0 });
  });
});

describe("Got it and Solid marks become cards", () => {
  const assigned = (mode: "student" | "tutor") => ({ mode, student: { id: "11111111-1111-4111-8111-111111111111", firstName: "Noa", lastName: "Synthetic", ceremonyDate: "2027-01-02", revision: 1 }, context: null,
    readings: [{ id: "22222222-2222-4222-8222-222222222222", kind: "torah", revision: 1, ranges: ["Genesis 23:1-4"], verses: ["Genesis 23:1", "Genesis 23:2", "Genesis 23:3", "Genesis 23:4"], needsReview: false }] }) as never;
  const verse = (ref: string, self: string, assessment: string) => ({ verseRef: ref, selfCheck: { state: self, version: 1 }, assessment: { state: assessment, version: 1 } });
  it("takes the student's own Got it and the tutor's Solid, every page, and nothing else", async () => {
    const read = vi.fn(async (_baseline: unknown, _kind: unknown, operation: { offset: number }) => operation.offset === 0
      ? { offset: 0, nextOffset: 2, verses: [verse("Genesis 23:1", "got-it", "not-started"), verse("Genesis 23:2", "working", "working")], counts: {} }
      : { offset: 2, nextOffset: null, verses: [verse("Genesis 23:3", "unmarked", "solid"), verse("Genesis 23:4", "unmarked", "not-started")], counts: {} });
    expect(await markedVerses(assigned("student"), "torah", new AbortController().signal, read as never)).toEqual([NOA, verseCardId("torah", "Genesis 23:3")]);
    expect(read.mock.calls.map(call => call[2])).toEqual([{ type: "page", offset: 0 }, { type: "page", offset: 2 }]);
  });
  it("asks nothing for a melody with no reading, or for anyone but the student", async () => {
    const read = vi.fn();
    expect(await markedVerses(assigned("student"), "haftarah", new AbortController().signal, read as never)).toEqual([]);
    expect(await markedVerses(assigned("tutor"), "torah", new AbortController().signal, read as never)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
