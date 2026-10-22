import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createListeningReviewService } from "../../src/server/listening-review/service";
import { createPocketTorahListeningSource } from "../../src/server/listening-review/sources";
import { createShortReferenceAudioService } from "../../src/server/reference-audio/short-service";
import { createShortSourceManifestLoader } from "../../src/server/reference-audio/short-source-manifest";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { LISTENING_SAMPLE, LISTENING_SAMPLE_VERSION, listeningNote, type ListeningItem } from "../../src/lib/listening-review/sample";
import { LISTENING_SAMPLE_PROVENANCE } from "../../src/lib/listening-review/sample-generated";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS, } from "../../src/lib/readings/catalog";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { syntheticResponse } from "../helpers/study";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"), json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const OVERVIEW = "/api/admin/listening-review", VERDICTS = "/api/admin/listening-review/verdicts", ITEM = (id: string) => `/api/admin/listening-review/items/${id}`;
const sample: ListeningItem[] = [...[1, 2, 3].map((n): ListeningItem => ({ id: `pt-genesis-1-${n}`, source: "pocket-torah", set: n === 2 ? "random" : "stress", kind: "torah", ref: `Genesis 1:${n}`, why: `Synthetic ${n}` })),
  { id: "fj-genesis-1-1", source: "finkel", set: "stress", kind: "torah", ref: "Genesis 1:1", why: "Second source" }];

async function fixture(options: { configured?: boolean } = {}) {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const asset = `ra_${"1".repeat(32)}`, readingTextSha256 = createHash("sha256").update("אָ֑ב ג׃".normalize("NFC")).digest("hex");
  const raw = { schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic.mp3", sha256: "a".repeat(64), bytes: 7,
    verses: [1, 2, 3].map(n => ({ schema: "reference-verse/v1", ref: `Genesis 1:${n}`, table: "torah", playback: { status: "ready", asset, clip: { start: n * 3 + 0.00002, end: n * 3 + 2.00001 } },
      words: { status: "ready", readingTextSha256, starts: [n * 3 + 0.1, n * 3 + 1] }, attribution: REFERENCE_ATTRIBUTION })) }] };
  const catalog = parseReferenceCatalog(raw)!, parent = json(raw);
  const source = (n: number, digit = String(n)) => { const h = digit.repeat(64), first = Math.floor((n * 3 + 0.00002) * 44100), last = Math.ceil((n * 3 + 2.00001) * 44100);
    return { schema: "reference-short-source/v1", id: `rs_${h}`, parent: { asset, sha256: "a".repeat(64), bytes: 7 }, sha256: h, bytes: 16500, path: `/reference-audio/short-v1/${h}.mp3`, codec: "mp3", bitrate: 64000,
      sampleRate: 44100, channels: 2, presentationFrames: last - first, origin: { firstFrame: first, parentRate: 44100 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version }; };
  // Verse 3 has no published clip, as for a capacity-held verse.
  const body = json({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: hash(parent), recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: [source(1), source(2)] });
  const sealed = await createShortSourceManifestLoader({ sha256: hash(body), parentCatalogSHA256: hash(parent), parentCatalogBytes: parent, get: async () => new ReadableStream({ start(c) { c.enqueue(body); c.close(); } }) })();
  const loadText = vi.fn(createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS }));
  const loadCatalog = vi.fn(async () => catalog), loadManifest = vi.fn(async () => sealed);
  const configured = options.configured !== false;
  const pocket = createPocketTorahListeningSource({ loadCatalog, loadManifest, catalogSha256: configured ? "c".repeat(64) : undefined, manifestSha256: "d".repeat(64) });
  const listeningReview = createListeningReviewService({ access: f.service, loadText, sources: [pocket], sample });
  const runtime = { ...f.runtime, listeningReview }, dispatch = createHttpDispatcher(async action => action(runtime));
  const send = async (path: string, options: Parameters<typeof f.request>[1] = {}) => { const response = await dispatch(f.request(path, options)); const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null }; };
  const verdict = (body: Record<string, unknown>, who: "admin" | "multi" | "learner" = "admin", extra: Parameters<typeof f.request>[1] = {}) =>
    send(VERDICTS, { who, method: "POST", body: { itemId: "pt-genesis-1-1", verdict: "pass", asset: `rs_${"1".repeat(64)}`, mutationId: randomUUID(), ...body }, ...extra });
  const rows = () => f.owner(async () => f.db.select().from(s.listeningReviewVerdict));
  const audits = () => f.owner(async () => (await f.db.select().from(s.auditEvent)).filter(a => a.action === "listening-review.set"));
  return { ...f, send, verdict, rows, audits, loadText, loadCatalog, loadManifest, catalog, sealed, dispatch };
}

test("the generated sample is a 25-40 verse stress set plus a disjoint 20-verse random draw, distinct and canonical, across all five books and the haftarot", () => {
  const stress = LISTENING_SAMPLE.filter(i => i.set === "stress"), draw = LISTENING_SAMPLE.filter(i => i.set === "random");
  expect(stress.length).toBeGreaterThanOrEqual(25); expect(stress.length).toBeLessThanOrEqual(40); expect(draw.length).toBe(20);
  expect(LISTENING_SAMPLE.every(i => i.source === "pocket-torah")).toBe(true);
  expect(LISTENING_SAMPLE_PROVENANCE.candidates).toBeGreaterThan(6000); expect(LISTENING_SAMPLE_PROVENANCE.catalogSha256).toMatch(/^[a-f0-9]{64}$/); expect(LISTENING_SAMPLE_PROVENANCE.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(new Set(LISTENING_SAMPLE.map(i => i.id)).size).toBe(LISTENING_SAMPLE.length);
  expect(new Set(LISTENING_SAMPLE.map(i => i.ref)).size).toBe(LISTENING_SAMPLE.length);
  for (const book of ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]) expect(stress.some(i => i.kind === "torah" && i.ref.startsWith(`${book} `))).toBe(true);
  expect(stress.filter(i => i.kind === "haftarah").length).toBeGreaterThanOrEqual(10);
  for (const i of LISTENING_SAMPLE) {
    expect(i.id).toMatch(/^[a-z]{2}-[a-z0-9-]{1,60}$/);
    expect(expandReadingRanges([i.ref], i.kind, TANAKH_VERSE_COUNTS)).toEqual([i.ref]);
  }
  expect(LISTENING_SAMPLE_VERSION).toMatch(/^listening-sample\/v[1-9]/);
});

test("an admin walks the sample: text and the student's clip, a saved verdict with receipt and audit, a per-source tally, replay and conflict", async () => {
  const f = await fixture();
  const first = await f.send(OVERVIEW, { who: "admin" });
  expect(first.status).toBe(200);
  expect(first.body.overview.items.map((i: { id: string; available: boolean; verdict: unknown }) => [i.id, i.available, i.verdict])).toEqual([
    ["pt-genesis-1-1", true, null], ["pt-genesis-1-2", true, null], ["pt-genesis-1-3", false, null], ["fj-genesis-1-1", false, null]]);
  // A verse with no published clip is not counted, so it can never block "all heard".
  expect(first.body.overview.tallies).toEqual([{ source: "pocket-torah", set: "stress", items: 1, heard: 0, pass: 0, needsWork: 0, wouldTeachWrong: 0 },
    { source: "pocket-torah", set: "random", items: 1, heard: 0, pass: 0, needsWork: 0, wouldTeachWrong: 0 }, { source: "finkel", set: "stress", items: 0, heard: 0, pass: 0, needsWork: 0, wouldTeachWrong: 0 }]);
  expect(first.body.overview.comparison).toEqual({ passRate: 0.95, wouldTeachWrong: 0 });
  expect(f.loadText).not.toHaveBeenCalled();
  const item = await f.send(ITEM("pt-genesis-1-1"), { who: "admin" });
  expect(item.status).toBe(200);
  expect(item.body.item.ref).toBe("Genesis 1:1"); expect(item.body.page.verses.map((v: { ref: string }) => v.ref)).toEqual(["Genesis 1:1"]);
  expect(item.body.reference.source.id).toBe(`rs_${"1".repeat(64)}`); expect(item.body.reference.verse.playback.status).toBe("ready");
  // A verse with no published clip is shown, but has nothing to mark.
  const held = await f.send(ITEM("pt-genesis-1-3"), { who: "admin" });
  expect(held.status).toBe(200); expect(held.body.reference).toBeNull();
  expect((await f.verdict({ itemId: "pt-genesis-1-3", asset: `rs_${"3".repeat(64)}` })).body).toEqual({ ok: false, code: "unavailable" });
  // The second source is listed but not composed: never playable or countable.
  expect((await f.send(ITEM("fj-genesis-1-1"), { who: "admin" })).status).toBe(503);
  expect((await f.verdict({ itemId: "fj-genesis-1-1" })).body).toEqual({ ok: false, code: "unavailable" });

  const mutationId = randomUUID();
  const saved = await f.verdict({ mutationId, note: "Clean start.", latencyMs: 412 });
  expect(saved.status).toBe(200); expect(saved.body).toMatchObject({ ok: true, replayed: false, verdict: { verdict: "pass", reasons: [], note: "Clean start.", latencyMs: 412, asset: `rs_${"1".repeat(64)}` } });
  expect((await f.verdict({ mutationId, note: "Clean start.", latencyMs: 412 })).body).toMatchObject({ ok: true, replayed: true });
  // A resend answers from its receipt before any audio lookup, even when the source is failing.
  f.loadCatalog.mockRejectedValueOnce(new Error("synthetic outage"));
  expect((await f.verdict({ mutationId, note: "Clean start.", latencyMs: 412 })).body).toMatchObject({ ok: true, replayed: true });
  f.loadCatalog.mockReset(); f.loadCatalog.mockImplementation(async () => f.catalog);
  expect(await f.verdict({ mutationId, verdict: "needs-work" })).toEqual({ status: 409, body: { ok: false, code: "conflict" } });
  // A clip other than the one the student would get now is refused.
  expect((await f.verdict({ asset: `rs_${"9".repeat(64)}` })).body).toEqual({ ok: false, code: "changed" });
  expect((await f.verdict({ itemId: "pt-genesis-1-2", asset: `rs_${"2".repeat(64)}`, verdict: "needs-work", reasons: ["would-teach-wrong", "verse-cut"] })).body)
    .toMatchObject({ ok: true, verdict: { verdict: "needs-work", reasons: ["verse-cut", "would-teach-wrong"] } });
  const [row] = (await f.rows()).filter(r => r.itemId === "pt-genesis-1-1");
  expect({ source: row.source, pin: row.sourcePin, sample: row.sampleVersion, ref: row.verseRef, actor: row.actorMembershipId === f.adminMember.id, role: row.role, mode: row.mode })
    .toEqual({ source: "pocket-torah", pin: createHash("sha256").update(`pocket-torah/short-v1:${"c".repeat(64)}:${"d".repeat(64)}`).digest("hex"), sample: LISTENING_SAMPLE_VERSION, ref: "Genesis 1:1", actor: true, role: "admin", mode: "admin" });
  expect((await f.audits()).map(a => [a.targetType, a.mode]).sort()).toEqual([["listening_review_verdict", "admin"], ["listening_review_verdict", "admin"]]);
  // A later verdict replaces the earlier one in the tally; the earlier row is kept.
  await f.verdict({ verdict: "needs-work", reasons: ["slow-start"] });
  const after = await f.send(OVERVIEW, { who: "admin" });
  expect(after.body.overview.items[0].verdict).toMatchObject({ verdict: "needs-work", reasons: ["slow-start"] });
  expect(after.body.overview.tallies.slice(0, 2)).toEqual([{ source: "pocket-torah", set: "stress", items: 1, heard: 1, pass: 0, needsWork: 1, wouldTeachWrong: 0 },
    { source: "pocket-torah", set: "random", items: 1, heard: 1, pass: 0, needsWork: 1, wouldTeachWrong: 1 }]);
  expect((await f.rows()).length).toBe(3);
});

test("verdict input is closed: unknown items, reasons on a pass, bad notes, latency and ids are refused without a row", async () => {
  const f = await fixture();
  for (const body of [{ itemId: "pt-genesis-9-9" }, { reasons: ["slow-start"] }, { verdict: "maybe" }, { verdict: "needs-work", reasons: ["other"] }, { verdict: "needs-work", reasons: ["sound", "sound"] },
    { note: "<b>no</b>" }, { note: "x".repeat(1001) }, { note: `bidi${String.fromCharCode(0x202e)}` }, { note: 7 }, { latencyMs: -1 }, { latencyMs: 60001 }, { latencyMs: 1.5 }, { asset: 5 }])
    expect((await f.verdict(body)).body, JSON.stringify(body)).toEqual({ ok: false, code: "invalid" });
  expect((await f.verdict({ mutationId: "nope" })).status).toBe(403);
  expect((await f.send(VERDICTS, { who: "admin", method: "POST", body: { itemId: "pt-genesis-1-1", verdict: "pass", asset: "x", mutationId: randomUUID(), extra: 1 } })).status).toBe(400);
  expect(await f.rows()).toEqual([]);
  expect(listeningNote("  line one\r\nline two ")).toBe("line one\nline two"); expect(listeningNote("")).toBeNull(); expect(listeningNote("tab\there")).toBeUndefined();
});

test("only the admin grant in admin mode reaches the review; other roles, anonymous, practice context, cross-site and revoked grants are refused before any audio lookup", async () => {
  const f = await fixture();
  for (const who of ["multi", "learner"] as const) {
    expect((await f.send(OVERVIEW, { who })).status).toBe(403);
    expect((await f.send(ITEM("pt-genesis-1-1"), { who })).status).toBe(403);
    expect((await f.verdict({}, who)).status).toBe(403);
  }
  for (const path of [OVERVIEW, ITEM("pt-genesis-1-1")]) expect((await f.send(path, { who: "anonymous" })).status).toBe(401);
  expect((await f.send(ITEM("pt-genesis-1-1"), { who: "multi", handle: "synthetic-handle" })).status).toBe(403);
  expect((await f.verdict({}, "admin", { headers: { origin: "http://evil.example" } })).status).toBe(403);
  expect((await f.verdict({}, "admin", { headers: { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" } })).status).toBe(403);
  expect((await f.send(OVERVIEW, { who: "admin", method: "POST", body: {} })).status).toBe(405);
  expect((await f.send(`${OVERVIEW}?x=1`, { who: "admin" })).status).toBe(400);
  expect(f.loadText).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled(); expect(f.loadManifest).not.toHaveBeenCalled();
  await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
  expect((await f.send(OVERVIEW, { who: "admin" })).status).toBe(403);
  expect((await f.verdict({})).status).toBe(403);
  expect(await f.rows()).toEqual([]);
});

test("a source whose loaders are not configured offers nothing, even with its pins set", async () => {
  const f = await fixture();
  const pocket = createPocketTorahListeningSource({ loadCatalog: f.loadCatalog, loadManifest: f.loadManifest, catalogSha256: "c".repeat(64), manifestSha256: "d".repeat(64), configured: () => false });
  const review = createListeningReviewService({ access: f.service, loadText: f.loadText, sources: [pocket], sample });
  const overview = await review.overview(f.request(OVERVIEW, { who: "admin" }));
  expect(overview.items.every(i => !i.available)).toBe(true);
  await expect(review.item(f.request(ITEM("pt-genesis-1-1"), { who: "admin" }), "pt-genesis-1-1")).rejects.toBeDefined();
  expect(f.loadCatalog).not.toHaveBeenCalled();
});

test("an unconfigured source lists its items as unavailable and refuses playback and verdicts", async () => {
  const f = await fixture({ configured: false });
  const overview = await f.send(OVERVIEW, { who: "admin" });
  expect(overview.body.overview.items.every((i: { available: boolean }) => !i.available)).toBe(true);
  expect(overview.body.overview.tallies[0]).toMatchObject({ items: 0, heard: 0 });
  expect((await f.send(ITEM("pt-genesis-1-1"), { who: "admin" })).status).toBe(503);
  expect((await f.verdict({})).body).toEqual({ ok: false, code: "unavailable" });
  expect(f.loadCatalog).not.toHaveBeenCalled();
});

test("passing verdicts change nothing a student can hear: the unreleased student page stays masked", async () => {
  const f = await fixture();
  for (const n of [1, 2]) expect((await f.verdict({ itemId: `pt-genesis-1-${n}`, asset: `rs_${String(n).repeat(64)}` })).body.ok).toBe(true);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return row;
  });
  const student = createShortReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: f.loadCatalog, loadManifest: f.loadManifest });
  const selection = { mode: "student" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  const learner = await student.readPage(f.request("/api/reference-short", { who: "learner" }), selection);
  if (!learner.ok || !("page" in learner)) throw new Error("Learner page expected");
  expect(learner.page.references.every(v => v.source === null && v.verse.playback.status === "unavailable")).toBe(true);
});
