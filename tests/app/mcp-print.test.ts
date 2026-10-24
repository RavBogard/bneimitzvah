import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { closeMcpFixtures, mcpFixture, ORIGIN, syntheticReading } from "./mcp-fixture";
import { addDays, thisShabbat } from "../../src/lib/readings/public-shabbat";
import { parsePrintAddress } from "../../src/lib/print/print-address";
import { DEFAULT_FORMAT } from "../../src/lib/print/sheet-format";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// The reader's print sheet from Claude: a link and a plain statement, never a verse. The fixture's text loader throws
// ("no network"), so any tool that tried to read the text would fail here; the calendar is synthetic.
async function setup(who: "admin" | "multi" = "admin") {
  const loadReading = vi.fn(syntheticReading);
  const t = await mcpFixture(true, undefined, { loadReading });
  await t.google(who);
  const token = (await t.connect(who, { scope: "portal:read" })).access_token as string;
  const texts: string[] = [];
  const call = async (args: Record<string, unknown>) => { const r = await t.call(token, "print_sheet_link", args); texts.push(r.text); return r; };
  return { t, token, call, texts, loadReading };
}
const target = (link: string) => { const url = new URL(link); expect(url.origin).toBe(ORIGIN); expect(url.pathname).toBe("/print"); return parsePrintAddress(url.search); };

describe("print_sheet_link", () => {
  it("defaults to this coming Shabbat's Torah reading in the default format, for a tutor's read-only connection too", async () => {
    const { t, token, call, texts, loadReading } = await setup("multi");
    const listed = (await t.rpc(token, "tools/list")).body.result.tools.find((tool: { name: string }) => tool.name === "print_sheet_link");
    expect(listed.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const result = (await call({})).json();
    expect(result.ok).toBe(true);
    expect(target(result.link)).toEqual({ target: { mode: "week", date: thisShabbat(), kind: null, pick: "full" }, format: DEFAULT_FORMAT });
    expect(result.reading).toMatchObject({ name: "Synthetic", kind: "torah", portion: "full", passage: "Genesis 1:1–6", verses: 6 });
    expect(result.reading.statement).toContain("Synthetic, Torah, the whole parashah: Genesis 1:1–6 (6 verses)");
    expect(result.format).toContain("Hebrew (vowels and trope) and English (JPS 2023) side by side");
    expect(loadReading).toHaveBeenCalledWith(thisShabbat(), "diaspora");
    // Nothing but numbers, names and the format: no verse text and no private data.
    expect(texts.join("")).not.toMatch(/[֐-׿]|@|Bearer/);
  });

  it("names a part of a Shabbat's reading, its haftarah, a parashah, any passage or a saved reading, with any format", async () => {
    const { call } = await setup();
    const date = addDays(thisShabbat(), 14);
    const aliyah = (await call({ date: addDays(date, -2), portion: "aliyah-2", format: { size: "huge", show: "hebrew", numbers: false } })).json();
    expect(target(aliyah.link)).toEqual({ target: { mode: "week", date, kind: null, pick: "aliyah-2" }, format: { ...DEFAULT_FORMAT, size: "huge", show: "hebrew", numbers: false } });
    expect(aliyah.reading.passage).toBe("Genesis 1:4–6");
    expect(aliyah.format).toContain("Hebrew only (vowels and trope), large print, no verse numbers");
    const haftarah = (await call({ kind: "haftarah" })).json();
    expect(target(haftarah.link).target).toEqual({ mode: "week", date: thisShabbat(), kind: "haftarah", pick: "full" });
    expect(haftarah.reading.passage).toBe("Isaiah 1:1–3");
    const named = (await call({ parashah: "Lech Lecha" })).json();
    expect(target(named.link).target).toEqual({ mode: "named", slug: "lech-lecha", passage: 1 });
    expect(named.reading.statement).toBe("Lech-Lecha, Torah: Genesis 12:1–17:27 (126 verses).");
    expect(target((await call({ parashah: "noach", kind: "haftarah" })).json().link).target).toEqual({ mode: "named", slug: "noach", passage: 2 });
    const second = (await call({ parashah: "noach", passage: 2 })).json();
    expect(target(second.link).target).toEqual({ mode: "named", slug: "noach", passage: 2 });
    expect(second.reading.kind).toBe("haftarah");
    expect((await call({ parashah: "noach", passage: 9 })).json().problems[0]).toContain("has 2 passages");
    expect((await call({ ref: "Genesis 1:1-5", passage: 1 })).json().problems[0]).toContain("passage applies only with parashah");
    const ref = (await call({ ref: "Isaiah 40:1-11", kind: "haftarah" })).json();
    expect(target(ref.link).target).toEqual({ mode: "ref", ref: "Isaiah 40:1-11", kind: "haftarah" });
    const id = "0f0e0d0c-0b0a-4908-8706-050403020100", saved = (await call({ savedReadingId: id })).json();
    expect(target(saved.link).target).toEqual({ mode: "saved", id });
    expect(saved.reading.statement).toContain("this tool cannot see its name or verses");
  });

  it("refuses what it cannot name plainly, writing nothing and guessing nothing", async () => {
    const { call } = await setup();
    const problems = async (args: Record<string, unknown>) => { const r = (await call(args)).json(); expect(r.ok).toBe(false); return r.problems.join(" "); };
    expect(await problems({ parashah: "Noach", ref: "Genesis 1:1-5" })).toContain("at most one");
    expect(await problems({ parashah: "Not a parashah" })).toContain("No reading by that name");
    expect(await problems({ ref: "Genesis 1:1-99" })).toContain("not a Torah passage");
    expect(await problems({ ref: "Genesis 1:1-5", portion: "aliyah-1" })).toContain("portion applies only");
    expect(await problems({ savedReadingId: "0f0e0d0c-0b0a-4908-8706-050403020100", date: thisShabbat() })).toContain("does not apply to a saved reading");
    expect(await problems({ kind: "haftarah", portion: "triennial" })).toContain("only to the Torah reading");
    expect(await problems({ portion: "aliyah-5" })).toContain("gives no aliyah 5");
    expect(await problems({ date: "2026-02-30" })).toContain("real date");
    expect(await problems({ format: { size: "giant" } })).toContain("format.size must be one of");
  });

  it("names a Shabbat with no weekly reading honestly", async () => {
    const holiday = vi.fn(async (date: string, calendar: "diaspora" | "israel") => { const value = await syntheticReading(date, calendar); return { ...value, snapshot: { ...value.snapshot, classification: "holiday" as const } }; });
    const t = await mcpFixture(true, undefined, { loadReading: holiday });
    await t.google("admin");
    const token = (await t.connect("admin", { scope: "portal:read" })).access_token as string;
    const result = (await t.call(token, "print_sheet_link", {})).json();
    expect(result).toMatchObject({ ok: false });
    expect(result.problems[0]).toContain("no weekly Torah reading");
  });
});
