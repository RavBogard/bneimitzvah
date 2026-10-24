import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { closeMcpFixtures, mcpFixture, ORIGIN, syntheticReading } from "./mcp-fixture";
import { addDays, thisShabbat } from "../../src/lib/readings/public-shabbat";
import { parseReadAddress } from "../../src/components/portal/public-reading/urls";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// A selection opened in Study from Claude: a /read link and a plain statement, never a verse. The fixture's text loader throws
// ("no network"), so a tool that tried to read the text would fail here; the calendar is synthetic.
async function setup(who: "admin" | "multi" = "admin") {
  const loadReading = vi.fn(syntheticReading);
  const t = await mcpFixture(true, undefined, { loadReading });
  await t.google(who);
  const token = (await t.connect(who, { scope: "portal:read" })).access_token as string;
  const texts: string[] = [];
  const call = async (args: Record<string, unknown>) => { const r = await t.call(token, "study_link", args); texts.push(r.text); return r; };
  return { t, token, call, texts, loadReading };
}
const opened = (link: string) => { const url = new URL(link); expect(url.origin).toBe(ORIGIN); expect(url.pathname).toBe("/read"); expect(url.searchParams.get("lens")).toBe("study"); return parseReadAddress(url.search); };

describe("study_link", () => {
  it("opens a selection of separated groups in Study, read-only and for a tutor's connection too", async () => {
    const { t, token, call, texts, loadReading } = await setup("multi");
    const listed = (await t.rpc(token, "tools/list")).body.result.tools.find((tool: { name: string }) => tool.name === "study_link");
    expect(listed.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const result = (await call({ ref: "Genesis 1:1-5; Genesis 2:1-3" })).json();
    expect(result.ok).toBe(true);
    expect(opened(result.link)).toEqual({ target: { mode: "ref", ref: "Genesis 1:1-5; Genesis 2:1-3", kind: "torah" }, verse: null, study: true });
    expect(result.reading).toMatchObject({ kind: "torah", passage: "Genesis 1:1–5; Genesis 2:1–3", segments: 2, verses: 8 });
    expect(result.reading.statement).toBe("Torah: Genesis 1:1–5; Genesis 2:1–3 (8 verses).");
    const prophets = (await call({ ref: "Isaiah 40:1-11", kind: "haftarah", verse: 3 })).json();
    expect(opened(prophets.link)).toEqual({ target: { mode: "ref", ref: "Isaiah 40:1-11", kind: "haftarah" }, verse: 3, study: true });
    // A ref needs no calendar; nothing but numbers and names comes back: no verse text and no private data.
    expect(loadReading).not.toHaveBeenCalled();
    expect(texts.join("")).not.toMatch(/[֐-׿]|@|Bearer/);
  });

  it("names this Shabbat, another Shabbat, a parashah or a saved reading by id", async () => {
    const { call, loadReading } = await setup();
    const week = (await call({})).json();
    expect(opened(week.link)).toEqual({ target: { mode: "week", date: thisShabbat(), kind: null }, verse: null, study: true });
    expect(week.reading.statement).toContain("Synthetic, Torah: Genesis 1:1–6 (6 verses)");
    expect(loadReading).toHaveBeenCalledWith(thisShabbat(), "diaspora");
    const date = addDays(thisShabbat(), 14);
    const haftarah = (await call({ date: addDays(date, -2), kind: "haftarah" })).json();
    expect(opened(haftarah.link).target).toEqual({ mode: "week", date, kind: "haftarah" });
    expect(haftarah.reading.passage).toBe("Isaiah 1:1–3");
    const named = (await call({ parashah: "Lech Lecha" })).json();
    expect(opened(named.link).target).toEqual({ mode: "named", slug: "lech-lecha", passage: 1 });
    expect(named.reading.statement).toBe("Lech-Lecha, Torah: Genesis 12:1–17:27 (126 verses).");
    expect(opened((await call({ parashah: "noach", kind: "haftarah" })).json().link).target).toEqual({ mode: "named", slug: "noach", passage: 2 });
    const id = "0f0e0d0c-0b0a-4908-8706-050403020100", saved = (await call({ savedReadingId: id, verse: 2 })).json();
    expect(opened(saved.link)).toEqual({ target: { mode: "saved", id }, verse: 2, study: true });
    expect(saved.reading.statement).toContain("this tool cannot see its name or verses");
  });

  it("refuses what it cannot name plainly, guessing nothing", async () => {
    const { t, token, call } = await setup();
    const problems = async (args: Record<string, unknown>) => { const r = (await call(args)).json(); expect(r.ok).toBe(false); return r.problems.join(" "); };
    expect(await problems({ parashah: "Noach", ref: "Genesis 1:1-5" })).toContain("at most one");
    expect(await problems({ parashah: "Not a parashah" })).toContain("No reading by that name");
    for (const ref of ["Genesis 1:1-99", "Genesis 12:1-12:5", "Genesis 1:1;Genesis 1:2", "Genesis 2:1; Genesis 1:1", "Genesis 1:1; Exodus 1:1", "Psalms 1:1-6",
      Array(33).fill(0).map((_, i) => `Genesis ${i + 1}:1`).join("; ")]) expect(await problems({ ref }), ref).toContain("not a Torah selection");
    expect(await problems({ ref: "Genesis 1:1-3", kind: "haftarah" })).toContain("not a Prophets selection");
    expect(await problems({ ref: "Genesis 1:1-5", verse: 6 })).toContain("verse must be from 1 to 5");
    expect(await problems({ ref: "Genesis 1:1-5", passage: 1 })).toContain("passage applies only with parashah");
    expect(await problems({ ref: "Genesis 1:1-5", date: thisShabbat() })).toContain("date applies only");
    expect(await problems({ savedReadingId: "0f0e0d0c-0b0a-4908-8706-050403020100", kind: "torah" })).toContain("does not apply to a saved reading");
    expect(await problems({ date: "2026-02-30" })).toContain("real date");
    // The closed schema refuses what the tool does not take, before the handler runs.
    for (const args of [{ format: {} }, { verse: 0 }, { savedReadingId: "not-an-id" }]) expect((await t.call(token, "study_link", args)).isError, JSON.stringify(args)).toBe(true);
  });
});
