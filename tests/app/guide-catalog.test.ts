import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudyGuideService, type GuideChecker } from "../../src/server/study-guides/service";
import { membershipRabbiAuthority, operatorRabbiAuthority } from "../../src/server/study-guides/authority";
import { AccessDenied } from "../../src/server/access/errors";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { guideCatalogEntries } from "../../src/lib/readings/guide-catalog";
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
  // Torah keys resolve verses only from an assigned student's snapshot today; unassigned ones are not yet draftable.
  expect(before.entries.find(e => e.name === "Pekudei" && e.kind === "torah")!.draftable).toBe(false);
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
