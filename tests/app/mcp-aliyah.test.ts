import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";
import { NAMED_READINGS } from "../../src/lib/readings/named-readings";
import { addDays, thisShabbat } from "../../src/lib/readings/public-shabbat";
import { parseCeremonyDate, expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { sectionsOf } from "../../src/lib/readings/sections";
import { parseReadAddress } from "../../src/components/portal/public-reading/urls";
import type { Calendar, Snapshot } from "../../src/lib/readings/proposals";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// Release 1.9 N25: Claude names a portion and an aliyah. The calendar is synthetic (no network): one real-shaped Torah cycle with
// Vayakhel-Pekudei combined, Vayera's aliyot as Hebcal divides them (numbers and refs only, as tests/app/aliyot-paging.test.ts has them),
// and a Shabbat with two aliyot only. No verse text anywhere.
const VAYERA = [["1", "Genesis 18:1-14"], ["2", "Genesis 18:15-33"], ["3", "Genesis 19:1-20"], ["4", "Genesis 19:21-21:4"], ["5", "Genesis 21:5-21"], ["6", "Genesis 21:22-34"], ["7", "Genesis 22:1-24"], ["M", "Genesis 22:20-24"]];
const TRIENNIAL = [["1", "Genesis 18:1-14"], ["2", "Genesis 18:15-21"], ["3", "Genesis 18:22-33"]];
const COMBINED = new Set(["vayakhel-pekudei", "tazria-metzora", "achrei-mot-kedoshim", "behar-bechukotai", "chukat-balak", "matot-masei", "nitzavim-vayeilech"]);
const CYCLE = NAMED_READINGS.filter(row => row.group === "parashah").filter(row => !COMBINED.has(row.slug) || row.slug === "vayakhel-pekudei").filter(row => !["vayakhel", "pekudei"].includes(row.slug)).map(row => row.name);
const START = CYCLE.indexOf("Shemot");
const row = (n: string, ref: string) => ({ n: n === "M" ? "M" as const : Number(n), ref });

function calendar() {
  return vi.fn(async (date: string, cal: Calendar): Promise<{ snapshot: Snapshot; fetchedAt: number }> => {
    const weeks = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${thisShabbat()}T00:00:00Z`)) / (7 * 86_400_000));
    const name = CYCLE[((START + weeks) % CYCLE.length + CYCLE.length) % CYCLE.length];
    const aliyot = name === "Vayera" ? VAYERA.map(([n, ref]) => row(n, ref)) : [row("1", "Exodus 1:1-10"), row("2", "Exodus 1:11-22")];
    return { fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(date), calendar: cal, classification: "regular",
      reading: { parashah: name, type: "shabbat", summary: "", source: "Hebcal", aliyot, triennial: { year: 2, aliyot: name === "Vayera" ? TRIENNIAL.map(([n, ref]) => row(n, ref)) : [row("1", "Exodus 1:1-10")] } },
      haftarah: name === "Vayera" ? "II Kings 4:1-37" : "Isaiah 27:6-28:13; Isaiah 29:22-23" } };
  });
}
const weeksUntil = (name: string) => ((CYCLE.indexOf(name) - START) % CYCLE.length + CYCLE.length) % CYCLE.length;
const NOT_FOUND = "Not found, or not available to this connection.";

async function setup() {
  const loadReading = calendar();
  const t = await mcpFixture(true, undefined, { loadReading });
  const other = await t.f.owner(async () => (await t.f.db.insert(s.savedReading).values({ tenantId: "crc", membershipId: t.f.multiMember.id, userId: t.f.identities.multi.id, name: "Tutor's own", kind: "torah", ranges: "Genesis 1:1-3", verseCount: 3 }).returning())[0]);
  await t.google("admin"); await t.google("multi");
  const admin = (await t.connect("admin", { scope: "portal:read" })).access_token as string, tutor = (await t.connect("multi", { scope: "portal:read" })).access_token as string;
  const texts: string[] = [];
  const call = async (token: string, name: string, args: Record<string, unknown> = {}) => { const r = await t.call(token, name, args); texts.push(r.text); return r; };
  const stored = (id: string) => t.f.owner(async () => (await t.f.db.select().from(s.savedReading).where(eq(s.savedReading.id, id)))[0]);
  return { t, admin, tutor, call, texts, loadReading, other, stored };
}

describe("get_reading", () => {
  it("lists a portion's aliyot, triennial and haftarah as refs, for the Shabbat it is next read, and takes nothing but the portion", async () => {
    const { t, admin, call, texts, loadReading } = await setup();
    const listed = (await t.rpc(admin, "tools/list")).body.result.tools.find((tool: { name: string }) => tool.name === "get_reading");
    expect(listed.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(Object.keys(listed.inputSchema.properties)).toEqual(["portion"]);
    const vayera = (await call(admin, "get_reading", { portion: "Vayera" })).json();
    expect(vayera).toMatchObject({ ok: true, parashah: "Vayera", date: addDays(thisShabbat(), 7 * weeksUntil("Vayera")) });
    expect(vayera.aliyot.map((x: { aliyah: string; ref: string }) => [x.aliyah, x.ref])).toEqual(VAYERA.filter(([n]) => n !== "M"));
    expect(vayera.aliyot[3]).toMatchObject({ pick: "aliyah-4", ref: "Genesis 19:21-21:4" });
    expect(vayera.maftir).toMatchObject({ pick: "maftir", ref: "Genesis 22:20-24" });
    expect(vayera.triennial).toMatchObject({ year: 2 });
    expect(vayera.triennial.aliyot.map((x: { pick: string }) => x.pick)).toEqual(["triennial-aliyah-1", "triennial-aliyah-2", "triennial-aliyah-3"]);
    expect(vayera.haftarah).toMatchObject({ ref: "II Kings 4:1-37" });
    expect(vayera.torah).toMatchObject({ ref: "Genesis 18:1-22:24" });
    // The calendar was asked a bounded number of times to place it.
    expect(loadReading.mock.calls.length).toBeLessThanOrEqual(12);
    // Default: this coming Shabbat. Nothing but refs and numbers comes back: no verse text, no private data.
    const week = (await call(admin, "get_reading")).json();
    expect(week).toMatchObject({ ok: true, parashah: "Shemot", date: thisShabbat() });
    expect(texts.join("")).not.toMatch(/[֐-׿]|@|Bearer/);
    // A closed schema: no student, user, saved reading or date is taken.
    for (const args of [{ studentId: randomUUID() }, { savedReadingId: randomUUID() }, { date: thisShabbat() }, { portion: "x".repeat(81) }]) expect((await t.call(admin, "get_reading", args)).isError, JSON.stringify(args)).toBe(true);
  });

  it("refuses a portion it cannot place plainly", async () => {
    const { call, admin } = await setup();
    const problems = async (portion: string) => { const r = (await call(admin, "get_reading", { portion })).json(); expect(r.ok).toBe(false); return r.problems.join(" "); };
    expect(await problems("Not a parashah")).toContain("No reading by that name");
    expect(await problems("Shabbat Shekalim")).toContain("not a weekly parashah");
    expect(await problems("Pekudei")).toContain("read together with its neighbour as Vayakhel-Pekudei");
    expect((await call(admin, "get_reading", { portion: "Vayakhel-Pekudei" })).json()).toMatchObject({ ok: true, parashah: "Vayakhel-Pekudei" });
  });
});

describe("portion and pick", () => {
  it("sets up 'my Shabbat with aliyah 4 of Vayera' as one call chain: get_reading, then study_link, then a saved reading", async () => {
    const { admin, call, stored } = await setup();
    const info = (await call(admin, "get_reading", { portion: "Vayera" })).json();
    const four = info.aliyot.find((x: { pick: string }) => x.pick === "aliyah-4");
    // The app's own aliyah data: Vayera's passage cut into its calendar sections (lib/readings/sections), as the reader's chips cut it.
    const verses = expandReadingRanges(["Genesis 18:1-22:24"], "torah", TANAKH_VERSE_COUNTS);
    const section = sectionsOf(VAYERA.map(([n, ref]) => ({ n, ref })), verses).find(x => x.n === "4")!;
    const ownVerses = expandReadingRanges([four.ref], "torah", TANAKH_VERSE_COUNTS);
    expect(ownVerses).toEqual(verses.slice(section.start, section.end));
    expect(ownVerses).toHaveLength(40);

    const link = (await call(admin, "study_link", { portion: "Vayera", pick: "aliyah-4" })).json();
    expect(link.ok).toBe(true);
    const url = new URL(link.link);
    expect(url.pathname).toBe("/read");
    expect(parseReadAddress(url.search)).toEqual({ target: { mode: "week", date: info.date, kind: null }, verse: null, study: true, pick: "aliyah-4" });
    expect(link.reading).toMatchObject({ name: "Vayera", date: info.date, kind: "torah", pick: "aliyah-4", passage: "Genesis 19:21–21:4", verses: 40 });
    expect(link.reading.statement).toContain("Torah, aliyah 4: Genesis 19:21–21:4 (40 verses)");

    const mutationId = randomUUID();
    const made = (await call(admin, "create_saved_reading", { name: "Vayera, aliyah 4", portion: "Vayera", pick: "aliyah-4", mutationId })).json();
    expect(made).toMatchObject({ ok: true, reading: { name: "Vayera, aliyah 4", kind: "torah", ranges: "Genesis 19:21-21:4", verseCount: 40, date: info.date, revision: 1 } });
    expect((await stored(made.reading.id)).ranges).toBe("Genesis 19:21-21:4");
    expect((await call(admin, "create_saved_reading", { name: "Vayera, aliyah 4", portion: "Vayera", pick: "aliyah-4", mutationId })).json()).toMatchObject({ ok: true, replayed: true, reading: { id: made.reading.id } });
    // A revision takes the same words; a given date is kept, and the corpus never changes.
    const revised = (await call(admin, "revise_saved_reading", { id: made.reading.id, revision: 1, portion: "Vayera", pick: "aliyah-2" })).json();
    expect(revised).toMatchObject({ ok: true, reading: { ranges: "Genesis 18:15-33", verseCount: 19, revision: 2, date: info.date } });
    expect((await call(admin, "revise_saved_reading", { id: made.reading.id, revision: 2, portion: "Vayera", pick: "haftarah" })).json()).toMatchObject({ ok: false, code: "invalid" });
  });

  it("names the maftir, the triennial reading, a triennial aliyah, the haftarah and the whole portion", async () => {
    const { admin, call } = await setup();
    const link = async (args: Record<string, unknown>) => (await call(admin, "study_link", { portion: "Vayera", ...args })).json();
    const date = addDays(thisShabbat(), 7 * weeksUntil("Vayera"));
    expect(parseReadAddress(new URL((await link({ pick: "maftir" })).link).search).pick).toBe("maftir");
    expect((await link({ pick: "triennial" })).reading).toMatchObject({ passage: "Genesis 18:1–33", verses: 33 });
    expect(parseReadAddress(new URL((await link({ pick: "triennial" })).link).search).pick).toBe("triennial");
    const tri = await link({ pick: "triennial-aliyah-2" });
    expect(parseReadAddress(new URL(tri.link).search).target).toEqual({ mode: "ref", ref: "Genesis 18:15-21", kind: "torah" });
    expect(tri.reading.statement).toContain("triennial aliyah 2 (year 2): Genesis 18:15–21 (7 verses)");
    const haftarah = await link({ pick: "haftarah" });
    expect(parseReadAddress(new URL(haftarah.link).search).target).toEqual({ mode: "week", date, kind: "haftarah" });
    expect(haftarah.reading.passage).toBe("II Kings 4:1–37");
    const whole = await link({});
    expect(parseReadAddress(new URL(whole.link).search)).toMatchObject({ target: { mode: "week", date }, study: true });
    expect(new URL(whole.link).searchParams.has("pick")).toBe(false);
    // A pick alone is this coming Shabbat's; a verse counts within the whole portion for an aliyah.
    expect((await call(admin, "study_link", { pick: "aliyah-2" })).json().reading).toMatchObject({ name: "Shemot", date: thisShabbat(), passage: "Exodus 1:11–22" });
    expect((await call(admin, "study_link", { portion: "Vayera", pick: "aliyah-4", verse: 60 })).json()).toMatchObject({ ok: true });
    expect((await call(admin, "study_link", { portion: "Vayera", pick: "aliyah-4", verse: 9999 })).isError).toBe(true);
    const saved = (await call(admin, "create_saved_reading", { name: "Vayera haftarah", portion: "Vayera", pick: "haftarah", mutationId: randomUUID() })).json();
    expect(saved).toMatchObject({ ok: true, reading: { kind: "haftarah", ranges: "II Kings 4:1-37", date } });
  });

  it("refuses an unknown portion, an out-of-range aliyah, a pick the week lacks and every mix it cannot honour", async () => {
    const { t, admin, call } = await setup();
    const study = async (args: Record<string, unknown>) => { const r = (await call(admin, "study_link", args)).json(); expect(r.ok, JSON.stringify(args)).toBe(false); return r.problems.join(" "); };
    expect(await study({ portion: "Not a parashah", pick: "aliyah-4" })).toContain("No reading by that name");
    expect(await study({ portion: "Shabbat Shekalim", pick: "aliyah-1" })).toContain("not a weekly parashah");
    // Out of range: aliyah 8 is not a pick at all (the schema refuses it before the handler runs); the 7th aliyah of a week that has two is refused by the calendar.
    for (const tool of ["study_link", "create_saved_reading"]) expect((await t.call(admin, tool, { portion: "Vayera", pick: "aliyah-8", name: "x", mutationId: randomUUID() })).isError, tool).toBe(true);
    expect((await t.call(admin, "study_link", { portion: "Vayera", pick: "aliyah-0" })).isError).toBe(true);
    expect(await study({ pick: "aliyah-7" })).toContain("The calendar gives no aliyah 7");
    expect(await study({ pick: "maftir" })).toContain("The calendar gives no maftir");
    expect(await study({ portion: "Vayera", pick: "aliyah-4", kind: "haftarah" })).toContain("is the Torah");
    expect(await study({ portion: "Vayera", pick: "haftarah", kind: "torah" })).toContain("is the Prophets");
    expect(await study({ portion: "Vayera", ref: "Genesis 1:1-3" })).toContain("at most one");
    expect(await study({ portion: "Vayera", parashah: "Noach" })).toContain("at most one");
    expect(await study({ portion: "Vayera", date: thisShabbat() })).toContain("date applies only");
    expect(await study({ ref: "Genesis 1:1-3", pick: "aliyah-1" })).toContain("pick applies only");
    expect(await study({ parashah: "Noach", pick: "aliyah-1" })).toContain("pick applies only");
    expect(await study({ savedReadingId: randomUUID(), pick: "aliyah-1" })).toContain("pick applies only");
    // Saved readings: ranges and a portion together, or neither, are refused with nothing saved.
    const saved = async (args: Record<string, unknown>) => (await call(admin, "create_saved_reading", { name: "x", mutationId: randomUUID(), ...args })).json();
    expect(await saved({ portion: "Not a parashah", pick: "aliyah-4" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await saved({ portion: "Vayera", pick: "aliyah-4", ranges: "Genesis 18:1-14" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await saved({})).toMatchObject({ ok: false, code: "invalid" });
    expect((await call(admin, "list_saved_readings")).json().total).toBe(0);
  });

  it("never reaches another person's saved reading, and a scheduled routine reaches none at all", async () => {
    const { t, admin, tutor, call, other, stored } = await setup();
    // The tutor's reading, revised by name and id from the admin's connection with a portion and a pick: one 404, nothing changed.
    const revise = await call(admin, "revise_saved_reading", { id: other.id, revision: 1, portion: "Vayera", pick: "aliyah-4" });
    expect([revise.isError, revise.text]).toEqual([true, NOT_FOUND]);
    expect((await stored(other.id))).toMatchObject({ ranges: "Genesis 1:1-3", revision: 1, name: "Tutor's own" });
    expect([(await call(admin, "open_saved_reading", { id: other.id })).isError, (await call(admin, "list_saved_readings")).json().total]).toEqual([true, 0]);
    // The tutor's own connection still reaches it, and a create with a portion lands only in the creator's own list.
    expect((await call(tutor, "revise_saved_reading", { id: other.id, revision: 1, portion: "Vayera", pick: "aliyah-1" })).json()).toMatchObject({ ok: true, reading: { ranges: "Genesis 18:1-14" } });
    expect((await call(admin, "create_saved_reading", { name: "Mine", portion: "Vayera", pick: "aliyah-3", mutationId: randomUUID() })).json().ok).toBe(true);
    expect((await call(admin, "list_saved_readings")).json().readings.map((x: { name: string }) => x.name)).toEqual(["Mine"]);
    expect((await call(tutor, "list_saved_readings")).json().readings.map((x: { name: string }) => x.name)).toEqual(["Tutor's own"]);
    // The row-level count for the tutor is unchanged by anything the admin did.
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.savedReading).where(and(eq(s.savedReading.tenantId, "crc"), eq(s.savedReading.membershipId, t.f.multiMember.id)))).length)).toBe(1);
  });
});
