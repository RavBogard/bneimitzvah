import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import rawCourse from "../../src/lib/service-course/course.json";
import rawCrc from "../../src/lib/service-course/tenants/crc.json";
import * as s from "../../src/server/db/index";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { accessFixture } from "./access-fixture";
import { CRC_TENANT, CourseError, EVENING_TEXT_UNITS, SERVICE_COURSE, SERVICE_TEXT_UNITS, eveningOrder, eveningTextTenant, homeUnits, isEveningLesson, lessonById, lessonOpen,
  mapSections, pageOf, sectionLessons, serviceNeighbours, teachingOf, validateServiceCourse, type Tenant } from "../../src/lib/service-course/course";
import { EVENING_TEXT_BUILD, alignedTranslit, parseEveningText, parseServiceText, type ServiceText } from "../../src/lib/service-course/text";
import { completeLesson, emptyProgress, lessonAfter, nextLesson, parseProgress } from "../../src/lib/service-course/progress";
import { EVENING_TEXT_PIN, TRANSLIT_FIXES, eveningLines, eveningTenantFile, eveningTextOf, parseEveningBook, readEveningText, translitMatches } from "../../src/server/service-course/evening";
import { CourseTextUnavailable } from "../../src/server/service-course/text";
import { APPROVED_BOOKLET } from "../../src/server/honoree/booklet-projector";
import { AccessDenied } from "../../src/server/access/errors";
import { EVENING_CACHE_TAG, handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import type { ServiceBlock } from "../../src/server/service-learning/feed";
import { eveningTextPath } from "../../src/components/learn/service/text-api";
import { EVENING_PACK_KEY, openOffline, parseOwnerAnswer, renewPack, PackStopped, type OwnerAnswer, type PackerIo } from "../../src/lib/offline/packer";
import { readIndex } from "../../src/lib/offline/pack-index";
import { INDEX_KEY, OFFLINE_CACHE, ownerOnlyAsset, packAssetAllowed, parsePackIndex, TORAH_ORIGIN, WINDOW_MS } from "../../src/lib/offline/policy";
import { workerSource } from "../../src/lib/offline/worker-source";
import { unavailableExtras } from "../helpers/translations";
import { SYNTHETIC_HE, SYNTHETIC_TR, syntheticEveningCatalog } from "../helpers/evening-text";

// Release 2.0 SC7: the Saturday evening and Havdalah lessons, which show the CRC Beit Mitzvah siddur's own text (MISSION, amended
// 2026-10-25): CRC only; anyone on the CRC site may read it; only a signed-in CRC person may keep it offline; never in any repo.
// Synthetic Hebrew only: no prayer text is in this file or its helper.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function problemsOf(change: (course: Json, crc: Json) => void): string[] {
  const course = copy(rawCourse) as Json, crc = copy(rawCrc) as Json;
  change(course, crc);
  try { validateServiceCourse(course, [crc]); return []; } catch (error) { if (error instanceof CourseError) return [...error.problems]; throw error; }
}
const has = (problems: string[], part: string) => problems.some(problem => problem.includes(part));
const EVENING = ["maariv-aravim", "ahavat-olam", "hashkiveinu", "shalom-rav", "yayin", "bsamim", "eish", "havdalah", "eliyahu", "miryam", "shavua-tov"];
const VOLUME = CRC_TENANT.siddurBook;

describe("the evening lessons in the course and the congregation file", () => {
  it("are the 11 lessons of A4's U7 and U8, each reading one Saturday-evening unit of the siddur, by id only", () => {
    expect(SERVICE_COURSE.lessons.filter(lesson => isEveningLesson(lesson)).map(lesson => lesson.id)).toEqual(EVENING);
    expect(SERVICE_COURSE.units.filter(unit => unit.phase === "evening").map(unit => [unit.id, unit.lessons])).toEqual([["evening", EVENING.slice(0, 4)], ["havdalah", EVENING.slice(4)]]);
    expect([...EVENING_TEXT_UNITS].sort()).toEqual(EVENING.map(id => lessonById(id)!.read!.unit).sort());
    for (const unit of EVENING_TEXT_UNITS) { expect(unit).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+@bm-maariv$/); expect(unit).not.toMatch(/mi-shebeirach/); expect(SERVICE_TEXT_UNITS.has(unit)).toBe(false); }
    for (const id of EVENING) {
      const lesson = lessonById(id)!;
      expect(lesson.kind, id).toBe("prayer"); expect(lesson.read!.blocks[0], id).toBe(0); expect(lesson.goal, id).toMatch(/^After this you can read /);
      expect(lesson.keyWords.length, id).toBeGreaterThanOrEqual(id === "shavua-tov" ? 1 : 3);
    }
  });
  it("follow the book's order and printed pages, 33 to 63, with the morning prayers the evening repeats in their places", () => {
    const order = eveningOrder().map(lesson => lesson.id);
    expect(order[0]).toBe("tallit"); expect(order.at(-1)).toBe("closing-blessing");
    for (const id of EVENING) expect(order).toContain(id);
    expect(order).not.toContain("modeh-ani"); expect(order).not.toContain("sim-shalom"); expect(order).not.toContain("adon-olam");
    const pages = order.map(id => pageOf(CRC_TENANT, id, "havdalah")!);
    expect(pages.every((page, i) => page >= 33 && page <= 63 && (i === 0 || page >= pages[i - 1]))).toBe(true);
    expect(Object.fromEntries(EVENING.map(id => [id, pageOf(CRC_TENANT, id, "morning")]))).toEqual({ "maariv-aravim": 37, "ahavat-olam": 38, hashkiveinu: 42, "shalom-rav": 50,
      yayin: 60, bsamim: 60, eish: 61, havdalah: 61, eliyahu: 62, miryam: 62, "shavua-tov": 62 });
    expect(serviceNeighbours("maariv-aravim", SERVICE_COURSE, "evening")).toMatchObject({ before: { id: "barchu" }, after: { id: "ahavat-olam" } });
    expect(serviceNeighbours("hashkiveinu", SERVICE_COURSE, "evening")).toMatchObject({ before: { id: "mi-chamochah" }, after: { id: "tfilah" } });
    expect(mapSections(SERVICE_COURSE, "evening").map(unit => unit.id)).toEqual(["evening", "havdalah"]);
    expect(sectionLessons("havdalah", SERVICE_COURSE, "evening").map(lesson => lesson.id)).toEqual(EVENING.slice(4));
  });
  it("give a Havdalah-slot student the evening page and teaching of a repeated prayer, and everyone else the morning's", () => {
    expect([pageOf(CRC_TENANT, "barchu", "havdalah"), pageOf(CRC_TENANT, "barchu", "morning"), pageOf(CRC_TENANT, "barchu", "unknown"), pageOf(CRC_TENANT, "barchu")]).toEqual([36, 7, 7, 7]);
    expect(pageOf(CRC_TENANT, "modeh-ani", "havdalah")).toBe(2); // not in the evening service: its only page
    for (const id of ["tallit", "chatzi-kaddish", "mi-chamochah", "torah-service", "torah-reading", "haftarah-reading"]) {
      const evening = teachingOf(CRC_TENANT, id, "havdalah")!, morning = teachingOf(CRC_TENANT, id, "morning")!;
      expect(evening.text, id).not.toBe(morning.text); expect(teachingOf(CRC_TENANT, id)).toBe(morning); expect(teachingOf(CRC_TENANT, id, "unknown")).toBe(morning);
      expect(evening.approved).toBe("2026-10-24"); expect(evening.from).toBe("A3-DRAFTS/evening-33-63.md");
    }
    expect(teachingOf(CRC_TENANT, "barchu", "havdalah")).toBe(teachingOf(CRC_TENANT, "barchu", "morning"));
  });
  it("hold the approved evening teachings verbatim, and each evening version as the morning text with exactly Daniel's approved edits", () => {
    const draft = readFileSync(new URL("../../docs/planning/2026-10-24-release-2-0/cowork/A3-DRAFTS/evening-33-63.md", import.meta.url), "utf8").replace(/\r/g, "");
    for (const id of EVENING.filter(id => id !== "shalom-rav")) expect(draft.includes(teachingOf(CRC_TENANT, id)!.text), id).toBe(true);
    const morning = (id: string) => teachingOf(CRC_TENANT, id, "morning")!.text, evening = (id: string) => teachingOf(CRC_TENANT, id, "havdalah")!.text;
    expect(evening("tallit")).toBe(morning("tallit").replace("which is why it belongs to the morning", "so a service that begins before sunset still falls within its time"));
    expect(evening("chatzi-kaddish")).toBe(morning("chatzi-kaddish").replace("Here it seals the verses of song and turns us toward Bar'chu.", "Here it closes the gathering and turns us toward Bar'chu."));
    expect(evening("torah-reading")).toBe(morning("torah-reading").replace("each week's portion. ", "each week's portion. At a Shabbat afternoon service the tradition reads only a short passage, three aliyot from the opening of the coming week's portion; the Talmud credits Ezra with setting that reading (Bava Kamma 82a). ")
      .replace("When Ezra read the Torah to the whole people, men, women and all who could understand stood to hear it (Nehemiah 8:2–3). ", ""));
    expect(evening("haftarah-reading")).toBe(morning("haftarah-reading").replace("chooses it instead. ", "chooses it instead. On Shabbat the tradition reads a haftarah only in the morning; adding one to this service gives the student the prophets to chant as well. "));
    // The draft gives these edited texts in full, with its own markup: struck text out, bracketed text in.
    const quoted = (heading: string) => { const at = draft.indexOf(heading), q = draft.indexOf("\n> ", at); return draft.slice(q + 3, draft.indexOf("\n", q + 3))
      .replace(/~~[^~]*~~\s?/g, "").replace(/\*\*\[([^\]]*)\]\*\*/g, "$1").replace(/\s+/g, " ").replace(/ ([.,;])/g, "$1").trim(); };
    expect(evening("mi-chamochah")).toBe(quoted("## BM52."));
    expect(evening("torah-service")).toBe(quoted("## BM64."));
    expect(teachingOf(CRC_TENANT, "shalom-rav")!.text).toBe(quoted("## BM61."));
  });
  it("refuse, in the validator: the evening for any congregation but CRC, a morning lesson reading the siddur, an evening lesson reading the public volume, and stray evening teachings", () => {
    expect(problemsOf(() => {})).toEqual([]);
    expect(has(problemsOf((_, crc) => { crc.tenant = "synthetic-second"; }), "the evening lessons are for CRC only")).toBe(true);
    expect(problemsOf((_, crc) => { crc.tenant = "synthetic-second"; crc.evening = false; })).toEqual([]);
    expect(has(problemsOf((_, crc) => { delete crc.evening; }), "evening")).toBe(true);
    expect(has(problemsOf(course => { course.lessons.find((l: Json) => l.id === "barchu").read.unit = "shma.barchu@bm-maariv"; }), "a morning lesson reads a public unit")).toBe(true);
    expect(has(problemsOf(course => { course.lessons.find((l: Json) => l.id === "yayin").read.unit = "shma.barchu@shabbat-shacharit"; }), "an evening lesson reads a Saturday-evening unit")).toBe(true);
    expect(has(problemsOf(course => { course.lessons.find((l: Json) => l.id === "yayin").read.unit = "havdalah.the-wine@bm-shacharit"; }), "read unit")).toBe(true);
    expect(has(problemsOf(course => { course.lessons.find((l: Json) => l.id === "yayin").read.unit = "torah.mi-shebeirach-healing@bm-maariv"; }), "read unit is refused")).toBe(true);
    expect(has(problemsOf(course => { course.lessons.find((l: Json) => l.id === "f5").corpus[0].unit = "shma.barchu@bm-maariv"; }), "not a public unit")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons["modeh-ani"].eveningTeaching = crc.lessons["modeh-ani"].teaching; }), "evening teaching belongs")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.yayin.eveningTeaching = crc.lessons.yayin.teaching; }), "evening teaching belongs")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.yayin.pages.morning = 3; }), "no morning page")).toBe(true);
    expect(has(problemsOf((_, crc) => { delete crc.lessons.barchu.pages.evening; }), "no evening page")).toBe(true);
    expect(has(problemsOf((_, crc) => { crc.lessons.barchu.pages.evening = 60; }), "out of the book's order")).toBe(true);
    expect(has(problemsOf(course => { course.evening = course.evening.filter((id: string) => id !== "eish"); }), "evening: must list")).toBe(true);
    expect(has(problemsOf(course => { course.evening.push("f1"); }), "evening: must list")).toBe(true);
    // One line of two words may go without a Check; a longer read may not.
    expect(has(problemsOf(course => { const l = course.lessons.find((row: Json) => row.id === "eliyahu"); l.keyWords = l.keyWords.slice(0, 2); delete l.check; }), "three to six key words")).toBe(true);
  });
  it("exist only where the evening is on: a synthetic second congregation sees no evening lesson, unit or Next", () => {
    const second: Tenant = { ...CRC_TENANT, tenant: "synthetic-second", evening: false };
    expect(SERVICE_COURSE.lessons.filter(lesson => lessonOpen(lesson, SERVICE_COURSE, second)).some(lesson => isEveningLesson(lesson))).toBe(false);
    expect(homeUnits(SERVICE_COURSE, second).some(unit => unit.phase === "evening")).toBe(false);
    expect(homeUnits().filter(unit => unit.phase === "evening").map(unit => unit.id)).toEqual(["evening", "havdalah"]);
    const morning = SERVICE_COURSE.lessons.filter(lesson => lesson.kind !== "fluency" && !isEveningLesson(lesson)).reduce((p, lesson) => completeLesson(p, lesson, 1), emptyProgress());
    expect(nextLesson(morning, second)).toBeNull(); expect(lessonAfter(morning, "closing-blessing", second)).toBeNull();
    expect(nextLesson(morning)!.id).toBe("maariv-aravim");
    expect(eveningTextTenant("crc")).toBe(true); expect(eveningTextTenant("synthetic-second")).toBe(false); expect(eveningTextTenant(undefined)).toBe(false);
    expect(eveningTenantFile("crc")).toBe(CRC_TENANT); expect(eveningTenantFile("other")).toBeNull();
  });
  it("keep an evening lesson's progress in the course's own document", () => {
    const parsed = parseProgress({ schema: "service-course-progress/v1", lessons: { yayin: { done: "2026-10-25T10:00:00.000Z" } }, cards: { "word:yayin:read": { box: 1, due: "2026-10-26" } } });
    expect(parsed!.lessons).toEqual({ yayin: { done: "2026-10-25T10:00:00.000Z" } }); expect(Object.keys(parsed!.cards)).toEqual(["word:yayin:read"]);
  });
});

describe("the evening text's projection", () => {
  const block = (value: Record<string, unknown>) => value as unknown as ServiceBlock;
  it("keeps lines of Hebrew with their transliteration and the printed translation with its credit, and drops everything else", () => {
    const blocks = [block({ type: "english", en: "Kavannah.", label: "Kavannah" }), block({ type: "english", en: "Epigraph." }), block({ type: "stanza", he: SYNTHETIC_HE[0] }),
      block({ type: "stanza", he: "" }), block({ type: "stanza", he: SYNTHETIC_HE[1] }), block({ type: "stanza", he: "\u05DB\u05DC" }), block({ type: "english", en: "Translation." }),
      block({ type: "english", en: "~ Translator" }), block({ type: "english", en: "Note.", label: "Kavannah" }), block({ type: "english", role: "original", en: "Page." }),
      block({ type: "rubric", text: [{ t: "Rubric" }] }), block({ type: "english", he: SYNTHETIC_HE[0], en: "Hebrew in an English block is not a line." })];
    const tr = [undefined, undefined, SYNTHETIC_TR[0], "Lyric", SYNTHETIC_TR[1], "~ Credit row"];
    expect(eveningLines(blocks, tr)).toEqual([{ he: SYNTHETIC_HE[0], tr: SYNTHETIC_TR[0] }, { he: SYNTHETIC_HE[1], tr: SYNTHETIC_TR[1] },
      { he: "\u05DB\u05DC", en: "Translation.\n~ Translator\nHebrew in an English block is not a line." }]);
  });
  it("puts the Hashkiveinu's transliteration back on its own Hebrew row on the pinned build, and shows none where the source drops a word", () => {
    const fix = TRANSLIT_FIXES[EVENING_TEXT_PIN.identity]["shma.hashkiveinu@bm-maariv"];
    expect(fix).toEqual({ 7: 8, 8: 9, 13: 14, 14: null, 15: 16 });
    expect(Object.keys(TRANSLIT_FIXES)).toEqual([EVENING_TEXT_PIN.identity]);
    // The defect's shape, in synthetic words: each Hebrew row sits one row above its transliteration, the rows between carry credits.
    const he = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(0x05D0 + i) + String.fromCharCode(0x05D1 + i)).join(" ");
    const tr = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const rows: [string | undefined, string | undefined][] = [[undefined, undefined], [undefined, undefined], [undefined, undefined], [undefined, "Lyric one"], [undefined, "Lyric two"],
      [undefined, "Lyric three"], [undefined, "Lyric four"], [he(4), "~U2"], [he(3), tr(4)], [undefined, tr(3)], [undefined, undefined], [undefined, "Lyric five"], [undefined, "Lyric six"],
      [he(3), "~Bob Marley"], [he(4), tr(3)], [he(6), tr(3)], [undefined, tr(6)]];
    const blocks = rows.map(([h]) => block(h ? { type: "stanza", he: h } : { type: "stanza", he: "" })), translits = rows.map(([, t]) => t);
    const unfixed = eveningLines(blocks, translits), fixed = eveningLines(blocks, translits, fix);
    // Without the fix, no Hebrew row has its own transliteration: three would show a neighbour's and two a credit, and all are dropped.
    expect(unfixed.filter(line => alignedTranslit(line)).length).toBe(0); expect(unfixed.filter(line => line.tr).length).toBe(0); // the guard drops them all
    expect(fixed.map(line => line.tr)).toEqual([tr(4), tr(3), tr(3), undefined, tr(6)]);
    expect(fixed.every(line => !line.tr || alignedTranslit(line))).toBe(true);
  });
  it("never shows a transliteration that does not match its line word for word, so a shifted row cannot show its neighbour's, in any unit or build", () => {
    // Synthetic rows shifted the way the Hashkiveinu's are, in a unit with no correction: each Hebrew row would carry the next row's words.
    const words = (n: number, at = 0) => Array.from({ length: n }, (_, i) => String.fromCharCode(0x05D0 + at + i) + String.fromCharCode(0x05D1 + at + i)).join(" ");
    const blocks = [block({ type: "stanza", he: words(4) }), block({ type: "stanza", he: words(3, 5) }), block({ type: "stanza", he: words(5, 9) })];
    const shifted = eveningLines(blocks, ["one two three", "uno dos tres cuatro cinco", "un deux"]);
    expect(shifted.map(line => line.tr)).toEqual([undefined, undefined, undefined]);
    // Matching rows keep theirs, a printed repeat mark aside; a row one word short, or one word long, shows none.
    const kept = eveningLines(blocks, ["a b c d", "a (3x) b c", "a b c d e (8X)."]);
    expect(kept.map(line => line.tr)).toEqual(["a b c d", "a (3x) b c", "a b c d e (8X)."]);
    expect(eveningLines([blocks[0]], ["a b c"])[0].tr).toBeUndefined();
    expect(eveningLines([blocks[0]], ["a b c d e"])[0].tr).toBeUndefined();
    expect(translitMatches(words(2), "a (3x) b")).toBe(true); expect(translitMatches(words(2), "a b (3x) c")).toBe(false);
  });
  it("reads only the course's evening units from the pinned bytes, with the book's title and attribution, and refuses anything not pinned", () => {
    const c = syntheticEveningCatalog();
    const book = parseEveningBook(c.feedBytes, c.provenanceBytes, c.pins, c.pin);
    expect([...book.units.keys()].sort()).toEqual(c.named);
    expect(book).toMatchObject({ identity: c.identity, title: "Synthetic book one", attribution: "Synthetic congregation credit, for this congregation only." });
    const text = eveningTextOf(book, c.named[0], VOLUME);
    expect(text).toEqual({ unit: c.named[0], volume: VOLUME, credit: { title: "Synthetic book one", attribution: "Synthetic congregation credit, for this congregation only." },
      lines: [{ he: SYNTHETIC_HE[0], tr: SYNTHETIC_TR[0] }, { he: SYNTHETIC_HE[1], tr: SYNTHETIC_TR[1] }, { he: "\u05DB\u05DC", en: `Synthetic translation 0.\n~ Synthetic translator` }] });
    expect(JSON.stringify(text)).not.toMatch(/kavannah|epigraph|lyric|rubric|Synthetic note|Synthetic part/i);
    for (const unit of [...c.extra, "shma.the-shma@shabbat-shacharit", "nope"]) expect(() => eveningTextOf(book, unit, VOLUME), unit).toThrow(CourseTextUnavailable);
    // Not the pin: other pins, other bytes, a different identity.
    expect(() => parseEveningBook(c.feedBytes, c.provenanceBytes, { ...c.pins, artifactRunId: "124" }, c.pin)).toThrow();
    expect(() => parseEveningBook(c.feedBytes, c.provenanceBytes, c.pins, { ...c.pin, identity: "0".repeat(64) })).toThrow();
    expect(() => parseEveningBook(syntheticEveningCatalog("two").feedBytes, c.provenanceBytes, c.pins, c.pin)).toThrow();
    expect(() => parseEveningBook(c.feedBytes, c.provenanceBytes, { ...c.pins, extra: "x" }, c.pin)).toThrow();
  });
  it("is pinned to the licensed build the app already serves, and every URL names that build", () => {
    expect(EVENING_TEXT_PIN).toMatchObject({ identity: APPROVED_BOOKLET.identity, feedSha256: APPROVED_BOOKLET.feedSha256, provenanceSha256: APPROVED_BOOKLET.provenanceSha256,
      artifactRepo: APPROVED_BOOKLET.artifactRepo, artifactCommit: APPROVED_BOOKLET.artifactCommit, artifactRunId: APPROVED_BOOKLET.artifactRunId, sourceGitSha: APPROVED_BOOKLET.sourceGitSha });
    expect(EVENING_TEXT_BUILD).toBe(EVENING_TEXT_PIN.identity.slice(0, 12));
    expect(eveningTextPath("havdalah.the-wine@bm-maariv")).toBe(`/api/public/evening-text?unit=havdalah.the-wine%40bm-maariv&build=${EVENING_TEXT_BUILD}`);
  });
  it("parses in the browser only an answer of the unit asked for, from the congregation's siddur, with its attribution", () => {
    const good = { unit: "havdalah.the-wine@bm-maariv", volume: VOLUME, credit: { title: "Book", attribution: "Credit." }, lines: [{ he: SYNTHETIC_HE[0], tr: SYNTHETIC_TR[0] }] };
    expect(parseEveningText(good, good.unit, VOLUME)).toEqual(good);
    expect(parseEveningText(good, "havdalah.the-spices@bm-maariv", VOLUME)).toBeNull();
    expect(parseEveningText({ ...good, volume: "shabbat-shacharit" }, good.unit, VOLUME)).toBeNull();
    expect(parseEveningText({ ...good, credit: { title: "Book", licence: "CC" } }, good.unit, VOLUME)).toBeNull();
    expect(parseEveningText({ ...good, unit: "torah.mi-shebeirach-healing@bm-maariv" }, "torah.mi-shebeirach-healing@bm-maariv", VOLUME)).toBeNull();
    expect(parseEveningText({ ...good, unit: "shma.the-shma@bm-shacharit" }, "shma.the-shma@bm-shacharit", VOLUME)).toBeNull();
    expect(parseServiceText(good, good.unit)).toBeNull(); // the public parser never takes it
  });
});

describe("reading the siddur book, by congregation (PGlite, forced row security)", () => {
  const opened: { client: { close(): Promise<void> } }[] = [];
  afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
  it("gives CRC its pinned book, refuses a synthetic second congregation before any query even with a catalog of its own, and shows nothing unpinned", async () => {
    const f = await accessFixture(); opened.push(f);
    type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
    const as = <T,>(tenant: string, action: (tx: Tx) => Promise<T>) => withTenantTransaction(f.db, { tenantId: tenant }, action);
    const c = syntheticEveningCatalog();
    await f.owner(async () => {
      for (const tenantId of ["crc", "other"]) {
        const [row] = await f.db.insert(s.serviceCatalog).values({ tenantId, identity: c.identity, feedBytes: c.feedBytes, provenanceBytes: c.provenanceBytes, pins: c.pins }).returning();
        await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId, catalogId: row.id, state: "active" });
      }
    });
    const { book, volume } = await as("crc", tx => readEveningText(tx, "crc", c.pin));
    expect(volume).toBe(VOLUME);
    expect(eveningTextOf(book, c.named[0], volume).lines[0]).toEqual({ he: SYNTHETIC_HE[0], tr: SYNTHETIC_TR[0] });
    // The second congregation has the very same catalog stored, and still gets none of it: refused before the database is asked.
    let queried = 0;
    const spy = new Proxy({}, { get: () => { queried++; throw new Error("no query may run"); } }) as unknown as Tx;
    await expect(readEveningText(spy, "other", c.pin)).rejects.toMatchObject({ code: "not-found" });
    await expect(readEveningText(spy, "synthetic-second", c.pin)).rejects.toMatchObject({ code: "not-found" });
    expect(queried).toBe(0);
    await expect(as("other", tx => readEveningText(tx, "other", c.pin))).rejects.toMatchObject({ code: "not-found" });
    // A transaction for another congregation cannot see CRC's rows at all.
    await expect(as("other", tx => readEveningText(tx, "crc", { ...c.pin, identity: "a".repeat(64) }))).rejects.toMatchObject({ code: "unavailable" });
    // The code pin is the authority: the real pin does not match a synthetic row, so CRC is shown nothing either.
    await expect(as("crc", tx => readEveningText(tx, "crc"))).rejects.toMatchObject({ code: "unavailable" });
    await expect(as("crc", tx => readEveningText(tx, "crc", { ...c.pin, artifactRunId: "999" }))).rejects.toMatchObject({ code: "unavailable" });
    // A withdrawn catalog shows nothing.
    await f.owner(() => f.db.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }));
    await expect(as("crc", tx => readEveningText(tx, "crc", { ...c.pin }))).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("GET /api/public/evening-text", () => {
  const ORIGIN = "http://localhost:3000";
  const c = syntheticEveningCatalog(), book = parseEveningBook(c.feedBytes, c.provenanceBytes, c.pins, c.pin);
  const UNIT = "havdalah.the-wine@bm-maariv", PATH = `/api/public/evening-text?unit=${encodeURIComponent(UNIT)}&build=${EVENING_TEXT_BUILD}`;
  function harness(eveningText: PublicRuntime["eveningText"], tenant: "crc" | "other" = "crc") {
    let opens = 0; const asked: string[] = [];
    const runtime: PublicRuntime = { resolveTenant: async () => { if (tenant !== "crc") throw new AccessDenied(404); }, reading: {} as PublicRuntime["reading"],
      commentary: async () => { throw new Error("unused"); }, ...unavailableExtras, eveningText: async unit => { asked.push(unit); return eveningText(unit); } };
    const call = (path: string, init: RequestInit = {}) => handlePublicReadingRequest(new Request(ORIGIN + path, init), async action => { opens++; return action(runtime); });
    return { call, asked, opens: () => opens };
  }
  const answer = async (unit: string) => eveningTextOf(book, unit, VOLUME);
  it("answers anyone on the CRC site, signed out or in, the same lines, and tells the browser to keep none of it", async () => {
    const { call, asked } = harness(answer);
    const out = await call(PATH), signedIn = await call(PATH, { headers: { cookie: "synthetic-session=1" } });
    for (const response of [out, signedIn]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=86400, stale-while-revalidate=86400");
      // Tagged, so a withdrawal or a moved pin purges every cached answer at once.
      expect(response.headers.get("vercel-cache-tag")).toBe(EVENING_CACHE_TAG); expect(EVENING_CACHE_TAG).toBe("evening-text");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    const body = await out.json();
    expect(body).toEqual(await signedIn.json());
    expect(Object.keys(body)).toEqual(["unit", "volume", "credit", "lines"]);
    expect(parseEveningText(body, UNIT, VOLUME)).toEqual(await answer(UNIT));
    expect(asked).toEqual([UNIT, UNIT]);
  });
  it("gives a synthetic second congregation's site nothing: 404, not kept, and the text is never asked for", async () => {
    const { call, asked, opens } = harness(answer, "other");
    const response = await call(PATH);
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toMatch(/[\u0590-\u05FF]|Synthetic/);
    expect(asked).toEqual([]); expect(opens()).toBe(1);
    // And the reader itself refuses any congregation but CRC.
    const refused = harness(async () => { throw new CourseTextUnavailable("not-found"); });
    expect((await refused.call(PATH)).status).toBe(404);
  });
  it("refuses, before the database, a unit no evening lesson names, a morning or public unit, the Mi Shebeirach, another build or any other query", async () => {
    const { call, opens } = harness(answer);
    const q = (unit: string, build = EVENING_TEXT_BUILD) => `/api/public/evening-text?unit=${encodeURIComponent(unit)}&build=${build}`;
    for (const path of [q("torah.mi-shebeirach-healing@bm-maariv"), q("havdalah.the-wine@bm-shacharit"), q("shma.the-shma@bm-shacharit"), q("sample.unnamed@bm-maariv"), q("havdalah.parents-blessing@bm-maariv"),
      q("shma.the-shma@shabbat-shacharit"), q("havdalah.the-wine@legacy-beit-mitzvah"), q(UNIT, "edfef85"), q(UNIT, "0".repeat(12)), q(UNIT, EVENING_TEXT_PIN.identity),
      `/api/public/evening-text?build=${EVENING_TEXT_BUILD}&unit=${encodeURIComponent(UNIT)}`, `/api/public/evening-text?unit=${encodeURIComponent(UNIT)}`, `${PATH}&lane=licensed`, "/api/public/evening-text"]) {
      const response = await call(path);
      expect(response.status, path).toBe(400); expect(response.headers.get("cache-control"), path).toBe("no-store");
    }
    expect(opens()).toBe(0);
    expect((await call(PATH, { method: "POST" })).status).toBe(405);
    // The public course route never serves an evening unit either.
    expect((await call(`/api/public/service-text?unit=${encodeURIComponent(UNIT)}&build=edfef85`)).status).toBe(400);
  });
  it("is never kept when the book is missing or unpinned, and refuses a runtime that answers another unit or a public credit", async () => {
    const down = harness(async () => { throw new CourseTextUnavailable("unavailable"); });
    const response = await down.call(PATH);
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await harness(async () => answer("havdalah.the-spices@bm-maariv")).call(PATH)).status).toBe(503);
    expect((await harness(async () => ({ ...(await answer(UNIT)), credit: { title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0" } }) as ServiceText).call(PATH)).status).toBe(503);
  });
  it("names exactly the 11 evening units", async () => {
    const all = harness(answer);
    for (const unit of EVENING_TEXT_UNITS) expect((await all.call(`/api/public/evening-text?unit=${encodeURIComponent(unit)}&build=${EVENING_TEXT_BUILD}`)).status, unit).toBe(200);
    expect(EVENING_TEXT_UNITS.size).toBe(11);
  });
});

describe("offline: only a signed-in CRC person keeps the evening text", () => {
  const origin = TORAH_ORIGIN, NOW = Date.parse("2026-10-25T15:00:00Z"), OWNER = "o".repeat(43), OTHER_OWNER = "p".repeat(43);
  class FakeCache {
    entries = new Map<string, Response>();
    async match(input: RequestInfo) { const hit = this.entries.get(new URL(typeof input === "string" ? input : input.url, origin).href); return hit?.clone(); }
    async put(input: RequestInfo, response: Response) { this.entries.set(new URL(typeof input === "string" ? input : input.url, origin).href, response.clone()); }
    async delete(input: RequestInfo) { return this.entries.delete(new URL(typeof input === "string" ? input : input.url, origin).href); }
    async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
  }
  class FakeCaches { stores = new Map<string, FakeCache>(); async open(name: string) { if (!this.stores.has(name)) this.stores.set(name, new FakeCache()); return this.stores.get(name)!; } async has(name: string) { return this.stores.has(name); } async delete(name: string) { return this.stores.delete(name); } async keys() { return [...this.stores.keys()]; } }
  const c = syntheticEveningCatalog(), book = parseEveningBook(c.feedBytes, c.provenanceBytes, c.pins, c.pin);
  function harness(owner: () => OwnerAnswer) {
    const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: {} as PublicRuntime["reading"], commentary: async () => { throw new Error("unused"); }, ...unavailableExtras,
      eveningText: async unit => eveningTextOf(book, unit, VOLUME) };
    const requests: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input); requests.push({ url, init });
      // Only the evening text answers here; This week and the course fail, as a route that is down would.
      const response = new URL(url).pathname === "/api/public/evening-text" ? await handlePublicReadingRequest(new Request(url.replace(origin, "http://localhost:3000")), async action => action(runtime))
        : new Response(null, { status: 503 });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }) as unknown as typeof globalThis.fetch;
    const caches = new FakeCaches();
    const io: PackerIo = { origin, fetch, caches: caches as unknown as CacheStorage, now: () => NOW, estimate: async () => ({ usage: 0, quota: 10 ** 9 }), owner: async () => owner() };
    const packs = async () => (await readIndex((await caches.open(OFFLINE_CACHE)) as unknown as Cache));
    const stored = async () => [...((await caches.open(OFFLINE_CACHE)).entries.keys())].filter(url => url.includes("/api/public/evening-text"));
    return { io, caches, requests, packs, stored };
  }
  it("packs every evening unit, as an owner pack, for a signed-in CRC person the private endpoint names", async () => {
    const h = harness(() => ({ state: "owner", owner: OWNER, packs: [], evening: true }));
    await openOffline(h.io);
    const index = await h.packs(), pack = index.packs.find(row => row.key === EVENING_PACK_KEY)!;
    expect(index.owner).toBe(OWNER);
    expect(pack).toMatchObject({ owner: OWNER, descriptor: { type: "evening" }, renewedAt: NOW, expiresAt: NOW + WINDOW_MS });
    expect([...pack.assets].sort()).toEqual([...EVENING_TEXT_UNITS].map(unit => eveningTextPath(unit)).sort());
    expect(pack.assets.every(ownerOnlyAsset)).toBe(true);
    expect(await h.stored()).toHaveLength(11);
    // Fetched like every pack: no cookie.
    for (const request of h.requests.filter(row => row.url.includes("evening-text"))) expect(request.init.credentials).toBe("omit");
  });
  it("keeps none for a signed-out device, a person the endpoint does not name for it, or an endpoint it cannot reach", async () => {
    for (const answer of [{ state: "signed-out" }, { state: "unknown" }, { state: "owner", owner: OWNER, packs: [] }, { state: "owner", owner: OWNER, packs: [], evening: false }] as OwnerAnswer[]) {
      const h = harness(() => answer);
      await openOffline(h.io);
      expect((await h.packs()).packs.some(pack => pack.descriptor.type === "evening"), JSON.stringify(answer)).toBe(false);
      expect(await h.stored(), JSON.stringify(answer)).toEqual([]);
      expect(h.requests.some(row => row.url.includes("evening-text")), JSON.stringify(answer)).toBe(false);
    }
    // The evening pack is never packed without an owner.
    const h = harness(() => ({ state: "signed-out" }));
    await expect(renewPack(h.io, { type: "evening" }, new AbortController().signal)).rejects.toBeInstanceOf(PackStopped);
  });
  it("is removed at sign-out and when another account takes the device", async () => {
    let answer: OwnerAnswer = { state: "owner", owner: OWNER, packs: [], evening: true };
    const h = harness(() => answer);
    await openOffline(h.io);
    expect(await h.stored()).toHaveLength(11);
    answer = { state: "signed-out" };
    await openOffline(h.io);
    expect((await h.packs()).packs.some(pack => pack.descriptor.type === "evening")).toBe(false);
    expect(await h.stored()).toEqual([]);
    answer = { state: "owner", owner: OWNER, packs: [], evening: true };
    await openOffline(h.io);
    answer = { state: "owner", owner: OTHER_OWNER, packs: [] };
    await openOffline(h.io);
    expect((await h.packs()).owner).toBe(OTHER_OWNER);
    expect(await h.stored()).toEqual([]);
  });
  it("is never part of a public pack: the stored index refuses one, and the endpoint's answer must say evening plainly", () => {
    const asset = eveningTextPath(UNIT_OF(0));
    expect(packAssetAllowed(asset)).toBe(true); expect(packAssetAllowed("/api/public/evening-text")).toBe(false);
    const pack = (owner: string, descriptor: unknown, assets: string[]) => ({ key: "k", owner, label: "", descriptor, assets, bytes: 1, renewedAt: NOW, expiresAt: NOW + WINDOW_MS, format: 1 });
    expect(parsePackIndex({ format: 1, owner: OWNER, packs: [pack(OWNER, { type: "evening" }, [asset])] }).packs).toHaveLength(1);
    for (const bad of [pack("public", { type: "evening" }, [asset]), pack("public", { type: "course" }, [asset]), pack("public", { type: "week", date: "2026-10-24" }, [asset]),
      pack(OWNER, { type: "evening" }, ["/api/public/text?date=2026-10-24&kind=torah&offset=0"]), pack(OTHER_OWNER, { type: "evening" }, [asset])]) {
      expect(parsePackIndex({ format: 1, owner: OWNER, packs: [bad] }).packs, JSON.stringify(bad)).toEqual([]);
    }
    expect(parsePackIndex({ format: 1, owner: null, packs: [pack(OWNER, { type: "evening" }, [asset])] }).packs).toEqual([]);
    expect(parseOwnerAnswer(200, { owner: OWNER, packs: [], evening: true })).toEqual({ state: "owner", owner: OWNER, packs: [], evening: true });
    expect(parseOwnerAnswer(200, { owner: OWNER, packs: [], evening: "yes" })).toEqual({ state: "unknown" });
    expect(parseOwnerAnswer(200, { owner: OWNER, packs: [] })).toEqual({ state: "owner", owner: OWNER, packs: [] });
  });
  it("is served by the worker only from a live pack of the device's own owner, never from a public pack", async () => {
    const asset = eveningTextPath(UNIT_OF(0));
    async function worker(index: unknown) {
      const caches = new FakeCaches(), listeners = new Map<string, ((event: unknown) => void)[]>();
      const self = { location: new URL(`${origin}/sw.js`), addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), handler]),
        registration: { unregister: vi.fn(async () => true) }, clients: { claim: vi.fn(async () => undefined) }, skipWaiting: vi.fn(async () => undefined), navigator: {} };
      const context = vm.createContext({ self, caches, fetch: async () => { throw new TypeError("offline"); }, Response, Headers, Request, URL, TextDecoder, TextEncoder, console });
      vm.runInContext(await workerSource({ build: "abc1234", enabled: true }), context);
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.put(INDEX_KEY, new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }));
      await cache.put(asset, new Response('{"synthetic":true}', { headers: { "content-type": "application/json; charset=utf-8" } }));
      let answer: Promise<Response> | null = null;
      for (const handler of listeners.get("fetch") ?? []) handler({ request: new Request(new URL(asset, origin)), respondWith: (work: Promise<Response>) => { answer = work; } });
      try { return answer ? (await answer as Response).status : null; } catch { return "network-error"; }
    }
    const pack = (owner: string) => ({ key: "k", owner, label: "", descriptor: { type: "evening" }, assets: [asset], bytes: 1, renewedAt: Date.now(), expiresAt: Date.now() + WINDOW_MS, format: 1 });
    expect(await worker({ format: 1, owner: OWNER, packs: [pack(OWNER)] })).toBe(200);
    expect(await worker({ format: 1, owner: OWNER, packs: [pack("public")] })).toBe("network-error");
    expect(await worker({ format: 1, owner: null, packs: [pack("public")] })).toBe("network-error");
  });
});
function UNIT_OF(n: number) { return [...EVENING_TEXT_UNITS].sort()[n]; }

describe("the one course module that reads the siddur book", () => {
  const ROOT = join(__dirname, "..", "..");
  const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap(name => statSync(join(ROOT, dir, name)).isDirectory() ? files(`${dir}/${name}`) : [`${dir}/${name}`]);
  const code = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  it("reads only the catalog and its lifecycle, only with SELECT, and the licensed parser's checks and scanner only", () => {
    const text = code("src/server/service-course/evening.ts");
    expect(text.match(/\bs\.([A-Za-z]+)\b/g)!.map(name => name.slice(2)).filter((name, i, all) => all.indexOf(name) === i).sort()).toEqual(["serviceCatalog", "serviceCatalogLifecycle"]);
    expect(text).not.toMatch(/\.(?:insert|update|delete)\(|\bsql`|execute\(/);
    expect(text).toMatch(/import \{ parseBoundedServiceJson, parseServiceFeed, SERVICE_FEED_LIMITS, type ServiceBlock, type ServiceSpan \} from "\.\.\/service-learning\/feed";/);
    expect(text).not.toMatch(/createServiceLearningService|readStoredFeed|studentServicePlan|dist-app|booklet-projector/);
    // The congregation check comes before the first query.
    const body = text.slice(text.indexOf("export async function readEveningText"));
    expect(body.indexOf("eveningTenantFile(tenantId)")).toBeLessThan(body.indexOf("tx.select"));
    expect(body.indexOf("throw new CourseTextUnavailable(\"not-found\")")).toBeLessThan(body.indexOf("tx.select"));
  });
  it("is imported only by the public runtime and the offline endpoint, and no browser module reaches it", () => {
    const importers = [...files("src")].filter(file => /\.(?:ts|tsx)$/.test(file) && /from "[./]*(?:server\/)?service-course\/evening"/.test(code(file)));
    expect(importers.sort()).toEqual(["src/server/offline/service.ts", "src/server/runtime/public-composition.ts"]);
    for (const file of [...files("src/components"), ...files("src/lib"), ...files("src/app")].filter(file => /\.(?:ts|tsx)$/.test(file))) expect(code(file), file).not.toMatch(/service-course\/evening"/);
  });
  it("holds no Hebrew and no prayer text, and the course's JSON names ids only", () => {
    for (const file of ["src/server/service-course/evening.ts", "src/lib/service-course/text.ts", "src/lib/service-course/course.ts", "tests/helpers/evening-text.ts", "tests/app/service-course-evening.test.ts"])
      expect(readFileSync(join(ROOT, file), "utf8"), file).not.toMatch(/[\u0590-\u05FF]/);
    expect(JSON.stringify(rawCrc)).not.toMatch(/[\u0590-\u05FF]/);
  });
});
