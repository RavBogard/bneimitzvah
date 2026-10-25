import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSavedReading, fetchSavedReadings, parseSavedList, parseSavedReading, parseSaveResult, SavedRequestError } from "../../src/components/portal/saved/api";
import { MyReadingsView, MY_READINGS_FIRST, savedReadingHref, type MyReadingsState } from "../../src/components/portal/saved/my-readings";
import { SaveReadingView, suggestedName, type SaveStep } from "../../src/components/portal/saved/save-reading";
import { FrontDoor } from "../../src/components/portal/front-door/front-door";

// Synthetic readings only: invented names, real verse references.
const row = (index: number, extra: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: `Reading ${index}`, date: "2026-10-17",
  kind: "torah", ranges: "Genesis 1:1-2:3", verseCount: 34, revision: 1, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z", ...extra });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the saved-readings client", () => {
  it("accepts exactly the server's reading shape and refuses anything else", () => {
    expect(parseSavedReading(row(1))).toEqual({ id: row(1).id, name: "Reading 1", date: "2026-10-17", kind: "torah", ranges: "Genesis 1:1-2:3", verseCount: 34, revision: 1 });
    expect(parseSavedReading(row(2, { date: null, kind: "haftarah", name: "נח · Haftarah" }))?.name).toBe("נח · Haftarah");
    for (const bad of [row(3, { id: "nope" }), row(3, { name: "" }), row(3, { name: "x".repeat(81) }), row(3, { name: "a\u2028b" }), row(3, { name: "a\nb" }), row(3, { date: "17 Oct" }),
      row(3, { kind: "blessing-before" }), row(3, { ranges: "Genesis 1:1" }), row(3, { verseCount: 0 }), row(3, { verseCount: 1001 }), row(3, { revision: 0 }), row(3, { extra: 1 }),
      (({ revision: _r, ...rest }) => rest)(row(3)), null, [], "reading"]) expect(parseSavedReading(bad), JSON.stringify(bad)).toBeNull();
  });
  it("reads the list's status as the account's own state", () => {
    expect(parseSavedList(401, { error: "authentication-required" })).toEqual({ state: "signed-out" });
    expect(parseSavedList(403, { error: "forbidden" })).toEqual({ state: "not-eligible" });
    expect(parseSavedList(200, { ok: true, readings: [row(1), row(2)] })).toMatchObject({ state: "ready", readings: [{ name: "Reading 1" }, { name: "Reading 2" }] });
    for (const [status, value] of [[200, { ok: true, readings: [row(1), row(1)] }], [200, { ok: true, readings: [row(1, { id: 4 })] }], [200, { ok: true }], [200, { ok: true, readings: [], extra: 1 }],
      [200, { ok: true, readings: Array.from({ length: 101 }, (_, i) => row(i)) }], [503, { error: "unavailable" }], [400, {}]] as const)
      expect(() => parseSavedList(status, value)).toThrow(SavedRequestError);
  });
  it("reads a save's answer: the reading, or why not", () => {
    expect(parseSaveResult(200, { ok: true, reading: row(1) })).toMatchObject({ ok: true, reading: { id: row(1).id } });
    expect(parseSaveResult(409, { ok: false, code: "limit" })).toEqual({ ok: false, code: "limit" });
    expect(parseSaveResult(409, { ok: false, code: "conflict" })).toEqual({ ok: false, code: "unavailable" });
    expect(parseSaveResult(400, { error: "invalid-request" })).toEqual({ ok: false, code: "invalid" });
    expect(parseSaveResult(401, {})).toEqual({ ok: false, code: "signed-out" });
    expect(parseSaveResult(403, {})).toEqual({ ok: false, code: "not-eligible" });
    expect(parseSaveResult(200, { ok: true, reading: row(1, { name: "" }) })).toEqual({ ok: false, code: "unavailable" });
    expect(parseSaveResult(503, null)).toEqual({ ok: false, code: "unavailable" });
  });
  it("asks same-origin and uncached, posts only the four fields, and refuses an oversized answer", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
    let next = () => answer(200, { ok: true, readings: [row(1)] });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return next(); });
    expect((await fetchSavedReadings()).state).toBe("ready");
    expect(calls[0].url).toBe("/api/saved/readings");
    expect(calls[0].init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    next = () => answer(200, { ok: true, reading: row(9) });
    expect((await createSavedReading({ name: "Bereshit · Torah", date: null, kind: "torah", ranges: "Genesis 1:1-6:8" })).ok).toBe(true);
    expect(calls[1]).toMatchObject({ url: "/api/saved/readings/create", init: { method: "POST", credentials: "same-origin" } });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ name: "Bereshit · Torah", date: null, kind: "torah", ranges: "Genesis 1:1-6:8" });
    next = () => answer(401, { error: "authentication-required" });
    expect(await fetchSavedReadings()).toEqual({ state: "signed-out" });
    next = () => new Response("x".repeat(200 * 1024), { status: 200, headers: { "content-type": "application/json" } });
    await expect(fetchSavedReadings()).rejects.toThrow(SavedRequestError);
    next = () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(fetchSavedReadings()).rejects.toThrow(SavedRequestError);
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    await expect(fetchSavedReadings()).rejects.toThrow(SavedRequestError);
    expect(await createSavedReading({ name: "R", date: null, kind: "torah", ranges: "Genesis 1:1" })).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("Save on /read", () => {
  const view = (step: SaveStep, problem: Parameters<typeof SaveReadingView>[0]["problem"] = null) => renderToStaticMarkup(createElement(SaveReadingView, { step, problem, name: "Noach · Torah", date: "2026-10-24",
    panelId: "save-panel", onSave: () => {}, onName: () => {}, onDate: () => {}, onSubmit: () => {}, onCancel: () => {} }));
  it("is a quiet Save until pressed, then answers by the account's state, inline", () => {
    expect(view("idle")).toContain('<button type="button" class="button-hero-secondary" aria-expanded="false">Save</button>');
    expect(view("idle")).not.toContain("<form");
    expect(view("checking")).toMatch(/disabled="">Save<\/button>/);
    // Signed out, Save is "Sign in to save" (F4), a link in Save's own place; no Save button beside it.
    expect(view("signed-out")).toContain('<a class="button-hero-secondary" href="/sign-in">Sign in to save</a>');
    expect(view("signed-out")).not.toContain(">Save</button>");
    expect(view("not-eligible")).toContain('<a href="/account">Ask for an account to save readings</a>');
    expect(view("unavailable")).toContain("Saving isn’t available right now. Try again.");
    const saved = view("saved");
    expect(saved).toContain('Saved to <a href="/">My readings</a>.');
    expect(saved).not.toContain(">Save</button>");
  });
  it("opens an inline form with the name and the Shabbat filled in, never a dialog", () => {
    const form = view("form");
    expect(form).toContain('aria-expanded="true" aria-controls="save-panel"');
    expect(form).toContain('<form id="save-panel"');
    expect(form).toContain('value="Noach · Torah"');
    expect(form).toContain('type="date" name="date" value="2026-10-24"');
    expect(form).toContain("(optional)");
    expect(form).toContain(">Save reading</button>");
    expect(form).toContain(">Cancel</button>");
    expect(form).not.toMatch(/dialog|aria-modal/);
    expect(view("saving")).toMatch(/disabled="">Save reading<\/button>/);
    expect(view("form", "limit")).toContain("You have 100 saved readings, the most an account keeps. Remove one to save another.");
    expect(view("form", "invalid")).toContain('role="alert"');
    // No pep talk anywhere in the Save copy.
    for (const step of ["idle", "signed-out", "not-eligible", "form", "saved", "unavailable"] as const) expect(view(step)).not.toMatch(/!/);
  });
  it("names the reading after its parashah and kind, within 80 characters", () => {
    expect(suggestedName({ title: "Noach", label: null, kind: "torah", ranges: ["Genesis 6:9-11:32"], date: "2026-10-24" })).toBe("Noach · Torah");
    expect(suggestedName({ title: "Noach", label: null, kind: "haftarah", ranges: ["Isaiah 54:1-55:5"], date: "2026-10-24" })).toBe("Noach · Haftarah");
    expect(suggestedName({ title: null, label: null, kind: "torah", ranges: ["Exodus 12:21-51"], date: null })).toBe("Shabbat reading · Torah");
    expect(suggestedName({ title: "Bereshit", label: "Maftir", kind: "torah", ranges: ["Genesis 6:5-8"], date: null })).toBe("Bereshit · Maftir");
    expect(Array.from(suggestedName({ title: "א".repeat(100), label: null, kind: "torah", ranges: ["Genesis 1:1"], date: null }))).toHaveLength(80);
  });
});

describe("My readings on the front door", () => {
  const view = (state: MyReadingsState, expanded = false) => renderToStaticMarkup(createElement(MyReadingsView, { state, expanded, listId: "mine", onExpand: () => {}, onRetry: () => {} }));
  const readings = (n: number) => Array.from({ length: n }, (_, i) => parseSavedReading(row(i + 1, i % 2 ? { date: null, kind: "haftarah", ranges: "Isaiah 54:1-55:5" } : {}))!);
  it("shows the five most recent with their dates and ranges, and the rest inline on request", () => {
    const some = view({ status: "ready", readings: readings(3) });
    expect(some).toContain('<h2 id="my-readings-title"');
    expect(some.match(/<li>/g)).toHaveLength(3);
    expect(some).toContain(`href="${savedReadingHref(row(1).id)}"`);
    expect(savedReadingHref(row(1).id)).toBe(`/read?saved=${row(1).id}`);
    expect(some).toContain("<bdi>Reading 1</bdi>");
    expect(some).toContain('<time dateTime="2026-10-17">Saturday, October 17, 2026</time> · Torah <bdi dir="ltr">Genesis 1:1–2:3</bdi>');
    expect(some).toContain('Haftarah <bdi dir="ltr">Isaiah 54:1–55:5</bdi>');
    expect(some).not.toContain("All my readings");
    const many = view({ status: "ready", readings: readings(7) });
    expect(many.match(/<li>/g)).toHaveLength(MY_READINGS_FIRST);
    expect(many).toContain('aria-expanded="false" aria-controls="mine">All my readings</button>');
    const all = view({ status: "ready", readings: readings(7) }, true);
    expect(all.match(/<li>/g)).toHaveLength(7);
    expect(all).toContain('aria-expanded="true" aria-controls="mine">Fewer readings</button>');
  });
  it("says plainly when there are none, while loading, and when the list fails; refused, it is not there at all", () => {
    expect(view({ status: "ready", readings: [] })).toContain("Save a reading from This week to see it here.");
    expect(view({ status: "loading" })).toContain('aria-busy="true"');
    const failed = view({ status: "failed" });
    expect(failed).toContain("Your readings didn’t load.");
    expect(failed).toContain(">Try again</button>");
    expect(view({ status: "hidden" })).toBe("");
    for (const state of [{ status: "ready", readings: readings(7) }, { status: "failed" }, { status: "ready", readings: [] }] as const) expect(view(state)).not.toMatch(/!|badge/i);
  });
  it("appears on the front door, under This week, only for an account that keeps saved readings", () => {
    const door = (account: Parameters<typeof FrontDoor>[0]["account"]) => renderToStaticMarkup(createElement(FrontDoor, { account, onSignIn: () => {}, children: createElement("p", null, "Synthetic task") }));
    const member = door({ kind: "account", role: "Parent", saved: true });
    expect(member).toContain("data-my-readings");
    expect(member.indexOf('id="this-week-title"')).toBeLessThan(member.indexOf("data-my-readings"));
    expect(member.indexOf("data-my-readings")).toBeLessThan(member.indexOf('data-door="beit-mitzvah"'));
    for (const account of [{ kind: "account", role: "Student", saved: false } as const, { kind: "sign-in" } as const, null]) expect(door(account)).not.toContain("data-my-readings");
  });
});
