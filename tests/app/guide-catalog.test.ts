import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudyGuideService, type GuideChecker } from "../../src/server/study-guides/service";
import { membershipRabbiAuthority, operatorRabbiAuthority } from "../../src/server/study-guides/authority";
import { AccessDenied } from "../../src/server/access/errors";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { catalogTorahVerses, guideCatalogEntries } from "../../src/lib/readings/guide-catalog";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import * as s from "../../src/server/db/index";
import { torahPassageVerses } from "../../src/server/data/study-guides";
import { NAMED_READINGS } from "../../src/lib/readings/named-readings";
import { haftarahRefForKey } from "../../src/lib/readings/reading-key";
import { guide, note, theme } from "../helpers/study-guide-fixture";

const open: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });

test("golden: the full key list has no gaps or duplicates and every key resolves to verses", () => {
  const { entries, unresolved } = guideCatalogEntries(TANAKH_VERSE_COUNTS);
  expect(unresolved).toEqual([]);
  const ids = entries.map(e => `${e.kind}:${e.readingKey}`);
  expect(new Set(ids).size).toBe(ids.length);
  for (const e of entries) {
    expect(e.verseCount, e.readingKey).toBeGreaterThan(0);
    expect(e.readingKey).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    if (e.kind === "haftarah") expect(haftarahRefForKey(e.readingKey, TANAKH_VERSE_COUNTS), e.readingKey).not.toBeNull();
  }
  const parashot = entries.filter(e => e.kind === "torah" && /^(Genesis|Exodus|Leviticus|Numbers|Deuteronomy)$/.test(e.group));
  // 54 portions plus the 7 doubled weeks.
  expect(parashot).toHaveLength(61);
  const named = new Set(NAMED_READINGS.filter(r => r.group === "parashah").map(r => r.name));
  expect(new Set(parashot.map(e => e.name))).toEqual(named);
  for (const name of ["Bereshit", "Pekudei", "Vayakhel", "Pinchas", "Vezot Haberakhah", "Vayakhel-Pekudei", "Matot-Masei"]) expect(named.has(name), name).toBe(true);
  // Special Shabbatot and holidays are present, and no group is empty.
  for (const name of ["Shabbat Shekalim", "Shabbat Zachor", "Shabbat Parah", "Shabbat HaChodesh", "Shabbat HaGadol", "Shabbat Rosh Chodesh", "Shabbat Machar Chodesh"]) expect(entries.some(e => e.name === name && e.group === "special" && e.kind === "haftarah"), name).toBe(true);
  expect(entries.some(e => e.group === "special" && e.name.startsWith("Shabbat Shuva"))).toBe(true);
  // Chanukah's haftarah is Beha'alotcha's passage: one key, listed under the first reading that uses it.
  expect(entries.some(e => e.name.includes("Chanukah") || e.alsoFor.some(n => n.includes("Chanukah")))).toBe(true);
  expect(entries.some(e => e.group === "holiday" && e.kind === "torah" && e.name === "Rosh Hashana I")).toBe(true);
  expect(entries.some(e => e.group === "holiday" && e.kind === "haftarah")).toBe(true);
});

async function fixture() {
  const f = await accessFixture(); open.push(f);
  const check = vi.fn<GuideChecker>(async ({ body }) => ({ ok: true as const, body }));
  const guides = createStudyGuideService({ access: f.service, practice: createPracticeService({ access: f.service }), check });
  const bind = (grant: { id: string; revision: number }, member: { authorityRevision: number }) => ({ roleGrantId: grant.id, roleGrantRevision: grant.revision, authorityRevision: member.authorityRevision });
  const mcp = (membershipId: string, bound: ReturnType<typeof bind>) => membershipRabbiAuthority({ db: f.db, tenantId: "crc", membershipId, channel: "mcp", mayReview: true, bound });
  return { ...f, guides, bind, mcp, rabbi: () => mcp(f.adminMember.id, bind(f.adminGrant, f.adminMember)) };
}
const refused = async (action: () => Promise<unknown>) => { try { await action(); return null; } catch (e) { return e instanceof AccessDenied ? e.status : "other"; } };

test("the catalog reports base-guide status and draftable, for the rabbi and the operator bridge", async () => {
  const f = await fixture();
  const before = await f.guides.guideCatalog(f.rabbi());
  expect(before.calendar).toBe("diaspora");
  expect(before.entries.every(e => e.base.status === "none" && e.base.version === 0)).toBe(true);
  const shekalim = before.entries.find(e => e.name === "Shabbat Shekalim")!;
  expect(shekalim.draftable).toBe(true);
  // With no student assigned, every key resolves: Torah keys from the catalog's own passage.
  expect(before.entries.filter(e => !e.draftable)).toEqual([]);
  expect(await f.guides.setBaseGuide(f.rabbi(), { kind: "haftarah", readingKey: shekalim.readingKey, expectedVersion: 0, body: guide({ themes: [theme("t", { notes: [note("II Kings 12:1")] })] }), origin: "claude", reviewed: false, hold: true, mutationId: randomUUID() })).toMatchObject({ ok: true, held: true });
  const after = await f.guides.guideCatalog(operatorRabbiAuthority({ db: f.db, tenantId: "crc", membershipId: f.adminMember.id }));
  expect(after.entries.find(e => e.readingKey === shekalim.readingKey)!.base).toMatchObject({ status: "held-draft", version: 1, visibleVersion: null });
  expect(JSON.stringify(after)).not.toMatch(/@example\.test|firstName/);
});

test("a non-rabbi is refused exactly as list_guide_work refuses", async () => {
  const f = await fixture();
  const tutor = () => f.mcp(f.multiMember.id, f.bind(f.tutorGrant, f.multiMember));
  const work = await refused(() => f.guides.guideWork(tutor()));
  expect(work).toBe(403);
  expect(await refused(() => f.guides.guideCatalog(tutor()))).toBe(work);
  const learner = () => f.mcp(f.learnerMember.id, f.bind(f.learnerGrant, f.learnerMember));
  expect(await refused(() => f.guides.guideCatalog(learner()))).toBe(await refused(() => f.guides.guideWork(learner())));
});

test("catalogTorahVerses gives every Torah key its full kriyah and nothing for a key outside the catalog", () => {
  const { entries } = guideCatalogEntries(TANAKH_VERSE_COUNTS);
  for (const e of entries.filter(x => x.kind === "torah")) expect(catalogTorahVerses(e.readingKey, TANAKH_VERSE_COUNTS), e.readingKey).toHaveLength(e.verseCount);
  for (const key of ["not-a-reading", "shabbat-shekalim", "", "isaiah-42-5-43-10"]) expect(catalogTorahVerses(key, TANAKH_VERSE_COUNTS), key).toEqual([]);
  // A doubled week is both parts, in order.
  expect(catalogTorahVerses("vayakhel-pekudei", TANAKH_VERSE_COUNTS)).toEqual([...catalogTorahVerses("vayakhel", TANAKH_VERSE_COUNTS), ...catalogTorahVerses("pekudei", TANAKH_VERSE_COUNTS)]);
  // A holiday key is its reading and its maftir, from another book.
  const roshHashana = catalogTorahVerses("rosh-hashana-i", TANAKH_VERSE_COUNTS);
  expect([roshHashana[0], roshHashana.at(-1), roshHashana.length]).toEqual(["Genesis 21:1", "Numbers 29:6", 34 + 6]);
});

test("get_reading_for_guide's passage falls back to the catalog: unassigned parashah, holiday, doubled week, unknown key", async () => {
  const f = await fixture();
  const passage = async (readingKey: string) => (await f.guides.guidePassage(f.rabbi(), { kind: "torah", readingKey })).verses;
  expect(await passage("bereshit")).toEqual(catalogTorahVerses("bereshit", TANAKH_VERSE_COUNTS));
  expect((await passage("yom-kippur")).slice(-5)).toEqual(["Numbers 29:7", "Numbers 29:8", "Numbers 29:9", "Numbers 29:10", "Numbers 29:11"]);
  expect(await passage("matot-masei")).toHaveLength(catalogTorahVerses("matot", TANAKH_VERSE_COUNTS).length + catalogTorahVerses("masei", TANAKH_VERSE_COUNTS).length);
  expect(await passage("not-a-reading")).toEqual([]);
});

test("for every parashah, a seeded Hebcal-shaped snapshot and the catalog give the same verses, and the snapshot still wins", async () => {
  const f = await fixture();
  const parashot = guideCatalogEntries(TANAKH_VERSE_COUNTS).entries.filter(e => e.kind === "torah" && e.group !== "holiday");
  expect(parashot).toHaveLength(61);
  const studentId = f.students[0].id;
  const [row] = await f.owner(() => f.db.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Genesis 1:1", status: "confirmed", setByMembershipId: f.adminMember.id }).returning());
  const refOf = (verses: string[]) => { const [book, a] = verses[0].split(/ (?=\d+:)/), b = verses.at(-1)!.split(/ (?=\d+:)/)[1]; return `${book} ${a}-${b}`; };
  for (const e of parashot) {
    const verses = catalogTorahVerses(e.readingKey, TANAKH_VERSE_COUNTS), size = Math.ceil(verses.length / 7);
    // Seven contiguous aliyot covering the parashah, and a maftir repeating its last verses, as Hebcal's full kriyah gives them.
    const aliyot = Array.from({ length: 7 }, (_, i) => verses.slice(i * size, (i + 1) * size)).filter(x => x.length).map((x, i) => ({ n: i + 1, ref: refOf(x) }));
    aliyot.push({ n: "M" as never, ref: refOf(verses.slice(-3)) });
    expect(aliyot.reduce((n, a) => n + expandReadingRanges([a.ref], "torah", TANAKH_VERSE_COUNTS).length, 0)).toBe(verses.length + 3);
    const source = { date: "2027-01-02", calendar: "diaspora", classification: "regular", haftarah: null, reading: { parashah: e.name, type: "shabbat", summary: "", source: "Hebcal", triennial: null, aliyot } };
    const fromSnapshot = await f.owner(async () => {
      await f.db.update(s.assignment).set({ proposalSnapshot: { slotProvenance: 1, needsReview: false, source } }).where(eq(s.assignment.id, row.id));
      return f.db.transaction(tx => torahPassageVerses(tx as never, "crc", e.readingKey, TANAKH_VERSE_COUNTS));
    });
    expect([...fromSnapshot], e.readingKey).toEqual(verses);
  }
  // A snapshot carrying more than the catalog (a Rosh Chodesh maftir) is used as is: the verse set of an assigned key does not change.
  const source = { date: "2027-01-02", calendar: "diaspora", classification: "regular", haftarah: null, reading: { parashah: "Bereshit", type: "shabbat", summary: "", source: "Hebcal", triennial: null, aliyot: [{ n: 1, ref: "Genesis 1:1-5" }, { n: "M", ref: "Numbers 28:9-15" }] } };
  await f.owner(() => f.db.update(s.assignment).set({ proposalSnapshot: { slotProvenance: 1, needsReview: false, source } }).where(eq(s.assignment.id, row.id)));
  const assigned = (await f.guides.guidePassage(f.rabbi(), { kind: "torah", readingKey: "bereshit" })).verses;
  expect([assigned.length, assigned[0], assigned.at(-1)]).toEqual([5 + 7, "Genesis 1:1", "Numbers 28:15"]);
});
