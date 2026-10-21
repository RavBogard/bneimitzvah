import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { accessFixture } from "./access-fixture";
import { applyStudyGuide } from "../../src/server/study-guides/bridge";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import * as s from "../../src/server/db/index";
import { guide, note, source, theme } from "../helpers/study-guide-fixture";

const open: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });
const pekudei = { date: "2027-03-13", calendar: "diaspora", classification: "regular", haftarah: "I Kings 7:51-8:21",
  reading: { parashah: "Pekudei", type: "shabbat", summary: "", source: "Hebcal", triennial: null, aliyot: [{ n: 1, ref: "Exodus 38:21-40:38" }] } };
// Invented commentary rows in Sefaria's related-API shape: one narrow numeric citation, one not.
const related = vi.fn(async (verse: string) => parseRelatedMetadata([
  { _id: "aaaa1111", sourceRef: "Invented Commentary on Exodus 40:34:1", index_title: "Invented Commentary on Exodus", category: "Commentary", anchorRef: verse },
  { _id: "bbbb2222", sourceRef: "Invented Essays, Clouds", index_title: "Invented Essays", category: "Modern", anchorRef: verse },
], verse));

async function fixture() {
  const f = await accessFixture(); open.push(f);
  await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Exodus 40:34", status: "confirmed",
      setByMembershipId: f.adminMember.id, proposalSnapshot: { slotProvenance: 1, needsReview: false, source: pekudei } }).returning();
    await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: 1, verseRef: "Exodus 40:34" });
  });
  const body = (ids = ["aaaa1111", "bbbb2222"]) => guide({ themes: [theme("cloud", { notes: [note("Exodus 40:34", { sources: ids.map(id => source(id)) })] })] });
  const run = (extra: Partial<Parameters<typeof applyStudyGuide>[0]> = {}) => applyStudyGuide({ db: f.db, tenantId: "crc", membershipId: f.adminMember.id, kind: "torah", readingKey: "pekudei",
    body: body(), apply: false, related, ...extra });
  const counts = () => f.owner(async () => ({ guides: (await f.db.select().from(s.studyGuide)).length, audits: (await f.db.select().from(s.auditEvent)).filter(a => a.action === "study-guide.set").length }));
  return { ...f, run, body, counts };
}

test("dry run writes nothing", async () => {
  const f = await fixture();
  expect(await f.run()).toEqual({ mode: "dry-run", outcome: "valid", themes: 1, notes: 1, sources: 2, readableSources: 1 });
  expect(await f.counts()).toEqual({ guides: 0, audits: 0 });
});

test("apply writes one version and one audit row, with server metadata and readability", async () => {
  const f = await fixture();
  expect(await f.run({ apply: true })).toMatchObject({ mode: "apply", outcome: "committed", version: 1, held: false, sources: 2, readableSources: 1 });
  expect(await f.counts()).toEqual({ guides: 1, audits: 1 });
  const [row] = await f.owner(async () => f.db.select().from(s.studyGuide));
  expect(row).toMatchObject({ origin: "claude", reviewed: false, channel: "operator", actorMembershipId: f.adminMember.id });
  expect(row.body.themes[0].notes[0].sources).toEqual([
    { id: "aaaa1111", ref: "Invented Commentary on Exodus 40:34:1", indexTitle: "Invented Commentary on Exodus", category: "Commentary", labels: { en: null, he: null }, readable: true },
    { id: "bbbb2222", ref: "Invented Essays, Clouds", indexTitle: "Invented Essays", category: "Modern", labels: { en: null, he: null }, readable: false },
  ]);
  // A second apply is a new version against the head it read.
  expect(await f.run({ apply: true, body: guide({ overview: "Revised invented overview.", themes: [] }) })).toMatchObject({ outcome: "committed", version: 2 });
});

test("refuses invented citation", async () => {
  const f = await fixture();
  const report = await f.run({ apply: true, body: f.body(["aaaa1111", "made-up-9"]) });
  expect(report).toMatchObject({ outcome: "refused", code: "invalid", problems: ["themes[0].notes[0].sources[1]: made-up-9 is not a Sefaria source for Exodus 40:34"] });
  expect(await f.counts()).toEqual({ guides: 0, audits: 0 });
});

test("refuses a verse outside the reading and an unreachable Sefaria", async () => {
  const f = await fixture();
  expect(await f.run({ apply: true, body: guide({ themes: [theme("t", { notes: [note("Genesis 1:1", { sources: [] })] })] }) }))
    .toMatchObject({ outcome: "refused", code: "invalid", problems: ["themes[0].notes[0]: Genesis 1:1 is not in this reading"] });
  expect(await f.run({ apply: true, related: async () => { throw new Error("offline"); } })).toMatchObject({ outcome: "refused", code: "invalid" });
  expect(await f.counts()).toEqual({ guides: 0, audits: 0 });
});

test("refuses when membership is not admin", async () => {
  const f = await fixture();
  await expect(f.run({ apply: true, membershipId: f.multiMember.id })).rejects.toMatchObject({ status: 403 });
  await expect(f.run({ apply: true, membershipId: f.learnerMember.id })).rejects.toMatchObject({ status: 403 });
  expect(await f.counts()).toEqual({ guides: 0, audits: 0 });
});

test("a Cowork draft may name sources by Sefaria ref alone; an unlisted ref refuses the whole guide", async () => {
  const f = await fixture();
  const byRef = (refs: string[]) => guide({ themes: [theme("cloud", { notes: [note("Exodus 40:34", { sources: refs.map(ref => ({ ref })) as never })] })] });
  expect(await f.run({ body: byRef(["Invented Commentary on Exodus 40:34:1"]) })).toMatchObject({ mode: "dry-run", outcome: "valid", sources: 1, readableSources: 1 });
  const refused = await f.run({ apply: true, body: byRef(["Invented Commentary on Exodus 40:34:1", "Made-up Commentary 1:1"]) });
  expect(refused).toMatchObject({ outcome: "refused", code: "invalid", problems: ["Made-up Commentary 1:1 is not a Sefaria source for Exodus 40:34"] });
  expect(await f.counts()).toEqual({ guides: 0, audits: 0 });
  expect(await f.run({ apply: true, body: byRef(["Invented Essays, Clouds"]) })).toMatchObject({ outcome: "committed", version: 1, sources: 1, readableSources: 0 });
  const [row] = await f.owner(async () => f.db.select().from(s.studyGuide));
  expect(row.body.themes[0].notes[0].sources[0]).toMatchObject({ id: "bbbb2222", ref: "Invented Essays, Clouds" });
});

test("a ref written the way people write it still finds Sefaria's record, but never ambiguously", async () => {
  const f = await fixture();
  const byRef = (refs: string[]) => guide({ themes: [theme("cloud", { notes: [note("Exodus 40:34", { sources: refs.map(ref => ({ ref })) as never })] })] });
  expect(await f.run({ body: byRef(["invented essays: clouds"]) })).toMatchObject({ outcome: "valid", sources: 1 });
  expect(await f.run({ body: byRef(["Invented Commentary on Exodus, 40:34:1"]) })).toMatchObject({ outcome: "valid", sources: 1, readableSources: 1 });
  expect(await f.run({ body: byRef(["Invented Commentary Exodus 40:35:1"]) })).toMatchObject({ outcome: "refused" });
  // "on" and punctuation differences, as in the Women's Commentary's Sefaria spelling.
  expect(await f.run({ body: byRef(["Invented Commentary Exodus 40:34:1"]) })).toMatchObject({ outcome: "valid", sources: 1 });
});
