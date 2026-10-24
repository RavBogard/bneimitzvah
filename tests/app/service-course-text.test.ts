import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkCourseTextPins, courseTextAnswer, courseTextIdentity, CourseTextInvalid, parsePublicCourseFeed } from "../../src/server/service-course/public-feed";
import { PUBLIC_COURSE_TEXT, PUBLIC_COURSE_VOLUMES } from "../../src/server/service-course/pin";
import { CourseTextUnavailable } from "../../src/server/service-course/text";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { SERVICE_TEXT_UNITS, lessonById } from "../../src/lib/service-course/course";
import { alignedTranslit, hebrewWords, parseServiceText, plainWord, REFUSED_UNIT, SERVICE_TEXT_BUILD, type ServiceText } from "../../src/lib/service-course/text";
import { answerCheck, buildCheck, checkDone, currentCheck, letters, resolveKeyWords, seeded, startCheck, type CheckItem } from "../../src/lib/service-course/check";
import { verseTargets } from "../../src/components/learn/service/text-api";
import type { AnalysedVerse } from "../../src/lib/learn/verse";
import { unavailableExtras } from "../helpers/translations";
import { feedBytes, SHMA_TR, SHMA_WORDS, SYNTHETIC_NAME, syntheticBuild, syntheticFeedValue, syntheticPins, syntheticWord } from "../helpers/course-text";

const parse = (mutate?: Parameters<typeof syntheticBuild>[0], pins?: (p: ReturnType<typeof syntheticPins>) => unknown) => {
  const build = syntheticBuild(mutate);
  return parsePublicCourseFeed(build.bytes, pins ? pins(build.pins) : build.pins);
};
const refused = (mutate?: Parameters<typeof syntheticBuild>[0], pins?: (p: ReturnType<typeof syntheticPins>) => unknown) => expect(() => parse(mutate, pins)).toThrow(CourseTextInvalid);

describe("the pin", () => {
  it("names the producer's public-lane artifact of the Shabbat morning volume and nothing licensed", () => {
    expect(PUBLIC_COURSE_TEXT).toEqual({ volume: "shabbat-shacharit", lane: "public", feedSha256: "aca598e7e6e202b7a64c9ef244f83b17b7f87cfa24265a5b99f5b19a65dc4e6b",
      artifactRepo: "RavBogard/ShireiShabbat", artifactCommit: "edfef85e1e06737d5fea1c33970f23961f599fc5", artifactRunId: "35741258239", artifactName: "shabbat-shacharit-edfef85", sourceGitSha: "edfef85" });
    expect(() => checkCourseTextPins({ ...PUBLIC_COURSE_TEXT })).not.toThrow();
    expect(PUBLIC_COURSE_VOLUMES).toEqual(["shabbat-shacharit"]);
    // Every text URL names the pinned build, so a moved pin moves every URL and no cache pairs old lines with new word indices.
    expect(SERVICE_TEXT_BUILD).toBe(PUBLIC_COURSE_TEXT.sourceGitSha);
    expect(JSON.stringify(PUBLIC_COURSE_TEXT)).not.toMatch(/LICENSED|dist-app|legacy|beit-mitzvah|licensed/i);
  });
  it("refuses every pin that names a licensed lane, volume, source or artifact, or is not exactly the eight keys", () => {
    const ok = { ...PUBLIC_COURSE_TEXT } as Record<string, string>;
    for (const bad of [{ lane: "licensed" }, { volume: "legacy-beit-mitzvah" }, { volume: "legacy-shabbat-evening" }, { volume: "crc-rh-morning" }, { volume: "shabbat-maariv" },
      { sourceGitSha: "edfef85-LICENSED" }, { artifactName: "dist-app" }, { artifactName: "legacy-beit-mitzvah-edfef85" }, { artifactName: "shabbat-shacharit-0000000" },
      { feedSha256: "x" }, { artifactCommit: "edfef85" }, { sourceGitSha: "1234567" }, { artifactRunId: "0" }, { extra: "x" }]) {
      expect(() => checkCourseTextPins({ ...ok, ...bad }), JSON.stringify(bad)).toThrow(CourseTextInvalid);
    }
    const { lane: _lane, ...missing } = ok;
    expect(() => checkCourseTextPins(missing)).toThrow(CourseTextInvalid);
  });
});

describe("the public-volume parser", () => {
  it("projects lines of Hebrew with their transliteration and English, and nothing else", () => {
    const feed = parse();
    expect(feed.volume).toBe("shabbat-shacharit");
    expect(feed.identity).toBe(courseTextIdentity(syntheticBuild().pins));
    const shma = courseTextAnswer(feed, "shma.the-shma@shabbat-shacharit")!;
    expect(shma.lines).toEqual([{ he: SHMA_WORDS.join(" "), tr: SHMA_TR, en: "Synthetic first line." }, { he: expect.any(String), en: "Synthetic second line." }]);
    expect(shma.credit).toEqual({ title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0" });
    // English blocks join the Hebrew they translate; a rubric is not a line; a footnote never leaves the parser.
    const barchu = courseTextAnswer(feed, "shma.barchu@shabbat-shacharit")!;
    expect(barchu.lines.map(line => line.en)).toEqual(["Synthetic English one.", "Synthetic English two."]);
    expect(JSON.stringify(barchu)).not.toMatch(/rubric|footnote|folio|All/);
    // A unit carrying the volume's maariv suffix is still the morning volume's (A2 discrepancy 9).
    expect(courseTextAnswer(feed, "amidah.avodah@shabbat-maariv")?.lines).toHaveLength(1);
    // The front matter is the tallit blessing alone, addressed as front.tallit.
    expect(courseTextAnswer(feed, "front.tallit@shabbat-shacharit")?.lines[0].en).toBe("Synthetic front English.");
    expect(courseTextAnswer(feed, "front.tallit@shabbat-maariv")).toBeNull();
    expect(courseTextAnswer(feed, "shma.nothing@shabbat-shacharit")).toBeNull();
  });
  it("drops the mixed Mi Shebeirach at parse, so no answer can carry it under any name (A2 discrepancy 13)", () => {
    const feed = parse();
    expect([...feed.units.keys()].some(id => /mi-shebeirach/.test(id))).toBe(false);
    for (const unit of ["torah.mi-shebeirach-healing@shabbat-shacharit", "front.mi-shebeirach@shabbat-shacharit", "x.mi-shebeirach@shabbat-maariv"]) expect(courseTextAnswer(feed, unit)).toBeNull();
    expect(JSON.stringify([...feed.units.values()])).not.toContain("Synthetic placeholder English");
    expect(REFUSED_UNIT.test("torah.mi-shebeirach-healing@shabbat-shacharit")).toBe(true);
  });
  it("refuses a licensed lane, a licensed or legacy volume, a -LICENSED source, the wrong licence or bytes that are not the pin", () => {
    refused(feed => { (feed.printing as { source: { lane: string } }).source.lane = "licensed"; });
    refused(feed => { feed.volume = "legacy-beit-mitzvah"; });
    refused(undefined, pins => ({ ...pins, volume: "legacy-beit-mitzvah" }));
    refused(feed => { (feed.license as { spdx: string }).spdx = "LicenseRef-CRC-only"; });
    refused(feed => { (feed.printing as { gitSha: string }).gitSha = "aaaaaaa-LICENSED"; });
    refused(undefined, pins => ({ ...pins, sourceGitSha: "aaaaaaa-LICENSED" }));
    refused(undefined, pins => ({ ...pins, artifactName: "dist-app" }));
    refused(undefined, pins => ({ ...pins, feedSha256: "0".repeat(64) }));
    // A licensed BM unit id, an unknown block key or block type, or an extra top-level key fails the whole build.
    refused(feed => { feed.units[0].id = "shma.the-shma@bm-shacharit"; });
    refused(feed => { feed.units[0].id = "shma.the-shma@legacy-beit-mitzvah"; });
    refused(feed => { feed.units[0].blocks[0].licensed = true; });
    refused(feed => { feed.units[0].blocks[0].type = "licensed"; });
    refused(feed => { feed.units[1].blocks[3].he = syntheticWord(9); }); // Hebrew in an English block is refused, not shown
    refused(feed => { feed.units[1].blocks[2].he = syntheticWord(9); }); // and in a rubric
    refused(feed => { feed.lane = "public"; });
    refused(feed => { feed.units.push({ ...feed.units[0] }); });
    const bytes = feedBytes(syntheticFeedValue());
    expect(() => parsePublicCourseFeed(bytes.slice(1), syntheticPins(bytes))).toThrow(CourseTextInvalid);
    expect(() => parsePublicCourseFeed(new Uint8Array(0), syntheticPins(bytes))).toThrow(CourseTextInvalid);
  });
  it("never repeats its input in an error", () => {
    try { parse(feed => { feed.units[0].blocks[0].type = "SECRET-INPUT"; }); } catch (error) { expect(String(error)).not.toContain("SECRET"); expect((error as Error).message).toBe("Course text unavailable"); }
  });
});

describe("words, transliteration and the browser's parse", () => {
  it("counts words by spaces and maqafs, and lines up transliteration only when the counts agree", () => {
    const maqaf = `${syntheticWord(1)}\u05BE${syntheticWord(2)} ${syntheticWord(3)} \u05C0 ${syntheticWord(4)}`;
    expect(hebrewWords(maqaf)).toHaveLength(4);
    expect(alignedTranslit({ he: maqaf, tr: "mah tov — uma na’im," })).toEqual(["mah", "tov", "uma", "na’im"]);
    expect(alignedTranslit({ he: maqaf, tr: "mah tov" })).toBeNull();
    expect(alignedTranslit({ he: maqaf })).toBeNull();
    expect(plainWord(`(${syntheticWord(9)}.)`)).toBe(syntheticWord(9));
  });
  it("accepts only the exact answer shape for the unit asked for", () => {
    const good = { unit: "shma.the-shma@shabbat-shacharit", volume: "shabbat-shacharit", credit: { title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0" }, lines: [{ he: SHMA_WORDS.join(" "), tr: SHMA_TR }] };
    expect(parseServiceText(good, good.unit)?.lines).toHaveLength(1);
    expect(parseServiceText(good, "shma.barchu@shabbat-shacharit")).toBeNull();
    expect(parseServiceText({ ...good, lane: "licensed" }, good.unit)).toBeNull();
    expect(parseServiceText({ ...good, lines: [{ he: "no Hebrew here" }] }, good.unit)).toBeNull();
    expect(parseServiceText({ ...good, lines: [] }, good.unit)).toBeNull();
    expect(parseServiceText({ ...good, lines: [{ he: SHMA_WORDS[0], footnote: "x" }] }, good.unit)).toBeNull();
  });
});

describe("the Check (A4 8.2, A8)", () => {
  const shma = lessonById("shma")!;
  const text: ServiceText = { unit: shma.read!.unit, volume: "shabbat-shacharit", credit: { title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0" },
    lines: [{ he: SHMA_WORDS.join(" "), tr: SHMA_TR }, { he: [syntheticWord(20), syntheticWord(21)].join(" ") }] };
  it("resolves the Sh'ma's key words in the loaded text and keeps the divine name out of reading items", () => {
    const keys = resolveKeyWords(shma, text);
    expect(keys.map(key => [key.word, key.translit, key.checkable])).toEqual([[0, "Sh’ma", true], [1, "Yisra’el", true], [2, "Adonai", false], [3, "Eloheinu", true], [5, "echad", true]]);
    expect(letters(SYNTHETIC_NAME)).toBe("\u05D9\u05D9");
  });
  it("builds five items, about half reading and half meaning, each with three distinct choices and one right answer", () => {
    for (let seed = 1; seed < 40; seed++) {
      const items = buildCheck(shma, text, seeded(seed));
      expect(items).toHaveLength(5);
      expect(items.filter(item => item.kind === "says").length).toBe(3);
      for (const item of items) {
        expect(item.choices).toHaveLength(3);
        if (item.kind === "says") {
          expect(item.target.translit).not.toBe("Adonai");
          expect(new Set(item.choices.map(choice => letters(choice.he))).size).toBe(3);
          expect(item.choices.filter(choice => choice.translit === item.target.translit)).toHaveLength(1);
          expect(item.choices.some(choice => letters(choice.he) === "\u05D9\u05D9")).toBe(false);
        } else if (item.kind === "what-means") expect(item.choices.filter(gloss => gloss === item.target.gloss)).toHaveLength(1);
        else expect(item.choices.filter(choice => choice.gloss === item.target.gloss)).toHaveLength(1);
      }
    }
  });
  it("brings a miss back later, at most twice, and counts nothing", () => {
    const items = buildCheck(shma, text, seeded(7)), rng = seeded(3);
    let run = startCheck(items); const first = currentCheck(run)!;
    run = answerCheck(run, false, rng);
    expect(run.queue.filter((item: CheckItem) => item.key === first.key)).toHaveLength(2);
    while (!checkDone(run)) run = answerCheck(run, currentCheck(run)!.key !== first.key, rng);
    expect(run.misses.get(first.key)).toBe(3);
    expect(run.queue.filter((item: CheckItem) => item.key === first.key)).toHaveLength(3);
    expect(Object.keys(run)).toEqual(["queue", "at", "misses"]);
  });
  it("is absent when the text gives fewer than three items", () => {
    const thin: ServiceText = { ...text, lines: [{ he: SHMA_WORDS.slice(0, 2).join(" ") }] };
    expect(buildCheck(shma, thin, seeded(1))).toEqual([]);
  });
});

describe("the verse card's alignment (A4 7)", () => {
  const verseOf = (words: readonly string[]): AnalysedVerse => ({ ref: "Isaiah 6:3", kind: "haftarah", book: "Isaiah", phrases: [],
    units: words.map((text, index) => ({ index, text, words: [index, index] })) } as unknown as AnalysedVerse);
  it("finds the line's words inside the verse by their letters, the divine name in either spelling", () => {
    const opening = [syntheticWord(80), syntheticWord(81)], line = [syntheticWord(82), SYNTHETIC_NAME, syntheticWord(83)];
    const verse = verseOf([...opening, `${syntheticWord(82)}\u0591`, "\u05D9\u05D4\u05D5\u05D4", `${syntheticWord(83)}\u05C3`]);
    const target = verseTargets(verse, line.join(" "), { ref: "Isaiah 6:3", kind: "haftarah", block: 0, words: [0, 2] })!;
    expect(target(1)).toMatchObject({ unit: 3, word: 3 });
    expect(target(5)).toBeNull();
    expect(verseTargets(verseOf([syntheticWord(90), syntheticWord(91), syntheticWord(92)]), line.join(" "), { ref: "Isaiah 6:3", kind: "haftarah", block: 0, words: [0, 2] })).toBeNull();
  });
  it("refuses a line that matches the verse in two places", () => {
    const word = syntheticWord(5);
    expect(verseTargets(verseOf([word, word, word]), `${word} ${word}`, { ref: "Isaiah 6:3", kind: "haftarah", block: 0, words: [0, 1] })).toBeNull();
  });
});

describe("the licensed lane cannot be reached from the course", () => {
  const ROOT = join(__dirname, "..", "..");
  const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap(name => statSync(join(ROOT, dir, name)).isDirectory() ? files(`${dir}/${name}`) : [`${dir}/${name}`]);
  const COURSE = [...files("src/server/service-course"), ...files("src/lib/service-course"), ...files("src/components/learn/service"), "src/server/runtime/public-composition.ts", "src/app/learn/service/[lesson]/page.tsx"];
  it("no course module, page or the public runtime reads the licensed catalog, its parser or a licensed volume", () => {
    for (const file of COURSE) {
      // Code only: the comments say what is never read, by name.
      const text = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(text, file).not.toMatch(/serviceCatalog\b|service_catalog\b|parseServiceFeed|readStoredFeed|createServiceLearningService|booklet-projector|dist-app/);
      // The licensed volume's name appears only as the siddur book a link names (bits.tsx through the congregation file), never as text to read.
      if (!file.endsWith(".json")) expect(text.match(/legacy-beit-mitzvah/g)?.length ?? 0, file).toBe(0);
    }
    // The fork shares only the bounded scanner with the licensed parser.
    const imports = readFileSync(join(ROOT, "src/server/service-course/public-feed.ts"), "utf8").match(/^import .* from "\.\.\/service-learning\/feed";$/m)?.[0];
    expect(imports).toBe('import { parseBoundedServiceJson } from "../service-learning/feed";');
  });
  it("no course module holds a Hebrew prayer word: Hebrew in its code is escaped letter ranges only", () => {
    for (const file of COURSE.filter(name => /\.(?:ts|tsx|css)$/.test(name))) expect(readFileSync(join(ROOT, file), "utf8"), file).not.toMatch(/[\u0590-\u05FF]/);
  });
});

describe("GET /api/public/service-text", () => {
  const ORIGIN = "http://localhost:3000";
  const feed = parse();
  function harness(serviceText: PublicRuntime["serviceText"]) {
    let opens = 0; const asked: string[] = [];
    const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: {} as PublicRuntime["reading"], commentary: async () => { throw new Error("unused"); }, ...unavailableExtras,
      serviceText: async unit => { asked.push(unit); return serviceText(unit); } };
    const call = (path: string, init: RequestInit = {}) => handlePublicReadingRequest(new Request(ORIGIN + path, init), async action => { opens++; return action(runtime); });
    return { call, asked, opens: () => opens };
  }
  const answerOf = async (unit: string) => { const found = courseTextAnswer(feed, unit); if (!found) throw new CourseTextUnavailable("not-found"); return found; };
  it("answers a course unit with its lines, kept like a verse page, and the same for everyone", async () => {
    const { call, asked } = harness(answerOf);
    const response = await call("/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit&build=edfef85");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=86400, stale-while-revalidate=86400");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["unit", "volume", "credit", "lines"]);
    expect(body.lines[0]).toEqual({ he: SHMA_WORDS.join(" "), tr: SHMA_TR, en: "Synthetic first line." });
    expect(asked).toEqual(["shma.the-shma@shabbat-shacharit"]);
  });
  it("refuses, before the database, a unit the course does not name, the Mi Shebeirach, a licensed id or any other query", async () => {
    const { call, opens } = harness(answerOf);
    for (const path of ["/api/public/service-text?unit=torah.mi-shebeirach-healing%40shabbat-shacharit&build=edfef85", "/api/public/service-text?unit=torah.mi-shebeirach-healing@shabbat-shacharit&build=edfef85",
      "/api/public/service-text?unit=shma.the-shma%40bm-shacharit&build=edfef85", "/api/public/service-text?unit=shma.the-shma%40legacy-beit-mitzvah&build=edfef85", "/api/public/service-text?unit=awakening.hodu%40shabbat-shacharit&build=edfef85",
      "/api/public/service-text?unit=&build=edfef85", "/api/public/service-text", "/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit",
      // The build is the pinned one, by exact value, in its place: an old, licensed or reordered build key never opens the database.
      "/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit&build=0000000", "/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit&build=edfef85-LICENSED",
      "/api/public/service-text?build=edfef85&unit=shma.the-shma%40shabbat-shacharit", "/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit&lane=licensed",
      "/api/public/service-text?lane=licensed&unit=shma.the-shma%40shabbat-shacharit"]) {
      const response = await call(path);
      expect(response.status, path).toBe(400);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
    }
    expect(opens()).toBe(0);
    expect((await call("/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit&build=edfef85", { method: "POST" })).status).toBe(405);
  });
  it("is never kept when the build is missing, fails its pin or lacks the unit", async () => {
    const down = harness(async () => { throw new CourseTextUnavailable("unavailable"); });
    const response = await down.call("/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit&build=edfef85");
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    const missing = harness(async () => { throw new CourseTextUnavailable("not-found"); });
    expect((await missing.call("/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit&build=edfef85")).status).toBe(404);
    // A runtime that answers some other unit, or the Mi Shebeirach, is refused rather than served.
    const wrong = harness(async () => ({ ...(await answerOf("shma.barchu@shabbat-shacharit")) }));
    expect((await wrong.call("/api/public/service-text?unit=shma.the-shma%40shabbat-shacharit&build=edfef85")).status).toBe(503);
  });
  it("names exactly the course's thirty units, and no response for any of them can carry a licensed or mixed unit", async () => {
    expect(SERVICE_TEXT_UNITS.size).toBe(30);
    const everything = harness(async unit => ({ unit, volume: "shabbat-shacharit", credit: { title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0" }, lines: [{ he: SHMA_WORDS.join(" ") }] }));
    for (const unit of SERVICE_TEXT_UNITS) {
      const response = await everything.call(`/api/public/service-text?unit=${encodeURIComponent(unit)}&build=edfef85`);
      expect(response.status, unit).toBe(200);
      expect(await response.text(), unit).not.toMatch(/legacy-beit-mitzvah|@bm-|mi-shebeirach|licensed/);
    }
  });
});
