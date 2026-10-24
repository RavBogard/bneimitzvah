import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSefariaTranslationsReader, TranslationsUnavailable } from "../../src/server/study/translations";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { COMPARE_LIMITS, parseCompareVerse, sefariaEditionUrl, targumRef } from "../../src/lib/readings/compare";
import { creditLine, licenseLabel, NOT_STATED, plainCredit } from "../../src/lib/readings/edition-credit";
import { englishVersion, shownTranslation, syntheticTranslationsFetch, targumVersion, textsAnswer } from "../helpers/translations";
import { unavailableExtras, unavailableTranslations } from "../helpers/translations";

// Invented edition titles, licences and numbered English; invented syllables for the Aramaic.
const verse = "Genesis 12:1";
const ok = (versions = [englishVersion("Synthetic Edition One"), englishVersion("Synthetic Edition Two")]) =>
  syntheticTranslationsFetch({ english: ref => textsAnswer(ref, versions), targum: ref => textsAnswer(ref, [targumVersion("he", "Synthetic Aramaic", "אָב גַּד"), targumVersion("en", "Synthetic Targum English", "Synthetic targum rendering.", "CC-BY-NC")]) });

test("verses: Torah or Prophets, in range, canonical spelling only", () => {
  expect(parseCompareVerse("Genesis 12:1")).toMatchObject({ book: "Genesis", chapter: 12, verse: 1, corpus: "torah" });
  expect(parseCompareVerse("I Samuel 20:18")).toMatchObject({ corpus: "neviim" });
  for (const bad of ["Psalms 1:1", "Ruth 1:1", "Genesis 51:1", "Genesis 1:32", "Genesis 0:1", "Genesis 01:1", "genesis 1:1", "Genesis 1", "Genesis 1:1-2", " Genesis 1:1", "Genesis  1:1", "__proto__ 1:1", "", null, 1])
    expect(parseCompareVerse(bad), String(bad)).toBeNull();
  expect(targumRef(parseCompareVerse("Genesis 12:1")!)).toBe("Onkelos Genesis 12:1");
  expect(targumRef(parseCompareVerse("Isaiah 40:1")!)).toBe("Targum Jonathan on Isaiah 40:1");
  expect(sefariaEditionUrl("I Samuel 20:18", "en", "Synthetic Edition")).toBe("https://www.sefaria.org/I_Samuel.20.18?ven=Synthetic_Edition&lang=bi");
});

test("licences read as Sefaria states them: codes by name, Copyright verbatim, nothing stated as not stated", () => {
  expect(licenseLabel("Public Domain")).toBe("public domain"); expect(licenseLabel("PD")).toBe("public domain");
  expect(licenseLabel("CC-BY-NC")).toBe("CC BY-NC"); expect(licenseLabel("CC-BY-SA")).toBe("CC BY-SA"); expect(licenseLabel("CC0")).toBe("CC0");
  expect(licenseLabel("Copyright: Synthetic Press")).toBe("Copyright: Synthetic Press");
  for (const empty of ["", "unknown", "Unknown", "   ", null, undefined, 5, "‮"]) expect(licenseLabel(empty), String(empty)).toBe(NOT_STATED);
  expect(licenseLabel(`Copyright: ${"x".repeat(200)}`)).toBe(NOT_STATED);
  expect(licenseLabel("Copyright: Synthetic‮ Press <b>")).toBe("Copyright: Synthetic Press b");
  expect(creditLine("Synthetic Edition", "")).toBe("Synthetic Edition, via Sefaria (licence not stated)");
  expect(plainCredit("a\u0000b\nc", 10)).toBe("ab c");
});

test("Compare lists every other English edition in Sefaria's order, and the Targum's Aramaic and English, credited", async () => {
  const sefaria = ok(), read = createSefariaTranslationsReader({ fetch: sefaria.fetch });
  const { answer, complete } = await read(verse);
  expect(complete).toBe(true);
  expect(answer.verse).toBe(verse);
  expect(answer.translations!.map(row => row.title)).toEqual(["Synthetic Edition One", "Synthetic Edition Two"]);
  expect(answer.translations![0]).toMatchObject({ license: "CC-BY", licenseLabel: "CC BY", credit: "Synthetic Edition One, via Sefaria (CC BY)",
    url: "https://www.sefaria.org/Genesis.12.1?ven=Synthetic_Edition_One&lang=bi", runs: [{ text: "Synthetic rendering of the verse by Synthetic Edition One." }] });
  expect(answer.targum).toMatchObject({ work: "Onkelos", aramaic: { title: "Synthetic Aramaic", licenseLabel: "public domain", runs: [{ text: "אָב גַּד" }],
    url: "https://www.sefaria.org/Onkelos_Genesis.12.1?vhe=Synthetic_Aramaic&lang=bi" }, english: { title: "Synthetic Targum English", licenseLabel: "CC BY-NC" } });
  // Two requests, in parallel, bounded and credential-free.
  expect(sefaria.calls.map(url => [decodeURIComponent(url.pathname), url.searchParams.getAll("version").join(",")])).toEqual([
    ["/api/v3/texts/Genesis 12:1", "english|all"], ["/api/v3/texts/Onkelos Genesis 12:1", "hebrew,english"]]);
});

test("the shown main translation, empty texts, other languages and repeats are left out; markup is sanitised", async () => {
  const sefaria = ok([shownTranslation(), englishVersion("Synthetic Empty", ""), englishVersion("Synthetic Blank", "<b> </b>"), englishVersion("Synthetic Romanian [ro]"),
    englishVersion("Synthetic English [en]"), englishVersion("Synthetic Twice"), englishVersion("Synthetic Twice"), englishVersion("Synthetic Array", ["a", "b"]),
    englishVersion("Synthetic Hebrew", "x", { actualLanguage: "he" }), englishVersion("Synthetic‮ Bidi"), englishVersion("Synthetic Markup", "<b>Bold</b> and <i class=\"footnote\">note</i><script>x</script> words")]);
  const { answer } = await createSefariaTranslationsReader({ fetch: sefaria.fetch })(verse);
  expect(answer.translations!.map(row => row.title)).toEqual(["Synthetic English [en]", "Synthetic Twice", "Synthetic Bidi", "Synthetic Markup"]);
  expect(answer.translations!.at(-1)!.runs).toEqual([{ text: "Bold", bold: true }, { text: " and words" }]);
  expect(JSON.stringify(answer)).not.toContain("‮");
});

test("caps: at most 40 editions, each text bounded, the whole answer under 256 KiB", async () => {
  const many = Array.from({ length: 60 }, (_, i) => englishVersion(`Synthetic Edition ${i + 1}`));
  expect((await createSefariaTranslationsReader({ fetch: ok(many).fetch })(verse)).answer.translations).toHaveLength(COMPARE_LIMITS.translations);
  const long = [englishVersion("Synthetic Long", "x".repeat(COMPARE_LIMITS.textChars + 1)), englishVersion("Synthetic Short")];
  expect((await createSefariaTranslationsReader({ fetch: ok(long).fetch })(verse)).answer.translations!.map(row => row.title)).toEqual(["Synthetic Short"]);
  const big = Array.from({ length: 40 }, (_, i) => englishVersion(`Synthetic Big ${i + 1}`, "word ".repeat(3000)));
  const { answer } = await createSefariaTranslationsReader({ fetch: ok(big).fetch })(verse);
  expect(Buffer.byteLength(JSON.stringify(answer))).toBeLessThanOrEqual(COMPARE_LIMITS.responseBytes);
  expect(answer.translations!.length).toBeLessThan(40);
});

test("one side failing leaves that side null and the answer incomplete; both failing, or a bad verse, is a failure", async () => {
  const targumDown = syntheticTranslationsFetch({ english: ref => textsAnswer(ref, [englishVersion("Synthetic Edition One")]), targum: () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } }) });
  const partial = await createSefariaTranslationsReader({ fetch: targumDown.fetch })(verse);
  expect(partial).toMatchObject({ complete: false, answer: { targum: null, translations: [{ title: "Synthetic Edition One" }] } });
  const englishDown = syntheticTranslationsFetch({ english: () => { throw new TypeError("synthetic network"); }, targum: ref => textsAnswer(ref, [targumVersion("he", "Synthetic Aramaic", "אָב")]) });
  expect(await createSefariaTranslationsReader({ fetch: englishDown.fetch })(verse)).toMatchObject({ complete: false, answer: { translations: null, targum: { aramaic: { title: "Synthetic Aramaic" }, english: null } } });
  // No Targum text at all (Sefaria's 404) is an answer, not a failure.
  const noTargum = syntheticTranslationsFetch({ english: ref => textsAnswer(ref, [englishVersion("Synthetic Edition One")]) });
  expect(await createSefariaTranslationsReader({ fetch: noTargum.fetch })(verse)).toMatchObject({ complete: true, answer: { targum: null } });
  // Any other 404 is a failure of that half: answered without it, and only briefly cached.
  for (const body of [{ error: "Something else." }, { error: "We have no text for <b>x</b>." }, {}]) {
    const odd = syntheticTranslationsFetch({ english: ref => textsAnswer(ref, [englishVersion("Synthetic Edition One")]), targum: () => new Response(JSON.stringify(body), { status: 404, headers: { "content-type": "application/json" } }) });
    expect(await createSefariaTranslationsReader({ fetch: odd.fetch })(verse), JSON.stringify(body)).toMatchObject({ complete: false, answer: { targum: null } });
  }
  // An oversize Targum costs only the Targum, never the whole answer.
  const hugeTargum = syntheticTranslationsFetch({ english: ref => textsAnswer(ref, Array.from({ length: 40 }, (_, i) => englishVersion(`Synthetic Big ${i + 1}`, "word ".repeat(1150)))),
    targum: ref => textsAnswer(ref, [targumVersion("he", "Synthetic Aramaic", "אָב ".repeat(3900)), targumVersion("en", "Synthetic Targum English", "word ".repeat(3000))]) });
  const degraded = await createSefariaTranslationsReader({ fetch: hugeTargum.fetch })(verse);
  expect(degraded).toMatchObject({ complete: false, answer: { targum: null } });
  expect(degraded.answer.translations!.length).toBeGreaterThan(0);
  const down = syntheticTranslationsFetch({ english: () => new Response("x", { status: 502 }), targum: () => new Response("x", { status: 502 }) });
  await expect(createSefariaTranslationsReader({ fetch: down.fetch })(verse)).rejects.toMatchObject({ code: "upstream" });
  await expect(createSefariaTranslationsReader({ fetch: ok().fetch })("Psalms 1:1")).rejects.toMatchObject({ code: "invalid-request" });
  // A wrong ref in the answer, or a non-JSON body, is upstream trouble for that side.
  const wrong = syntheticTranslationsFetch({ english: () => textsAnswer("Genesis 12:2", [englishVersion("X")]), targum: () => new Response("<html>", { headers: { "content-type": "text/html" } }) });
  await expect(createSefariaTranslationsReader({ fetch: wrong.fetch })(verse)).rejects.toBeInstanceOf(TranslationsUnavailable);
});

test("the public route: closed query, checked before the runtime, cached thirty days when whole and an hour when partial, no-store on failure", async () => {
  let opened = 0, reader = createSefariaTranslationsReader({ fetch: ok().fetch });
  const runtime = () => ({ resolveTenant: async () => undefined, reading: {} as PublicRuntime["reading"], commentary: async () => { throw new Error("unused"); }, ...unavailableExtras, translations: reader }) satisfies PublicRuntime;
  const call = (query: string) => handlePublicReadingRequest(new Request(`https://beitmitzvah.centralreform.org/api/public/translations${query}`), async action => { opened++; return action(runtime()); });
  const whole = await call("?verse=Genesis+12%3A1");
  expect(whole.status).toBe(200); expect(whole.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=2592000, stale-while-revalidate=86400"); expect(whole.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect((await whole.json()).translations).toHaveLength(2);
  reader = createSefariaTranslationsReader({ fetch: syntheticTranslationsFetch({ english: ref => textsAnswer(ref, [englishVersion("Synthetic Edition One")]), targum: () => new Response("x", { status: 500 }) }).fetch });
  expect((await call("?verse=Genesis+12%3A1")).headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=3600");
  reader = unavailableTranslations;
  const failed = await call("?verse=Genesis+12%3A1");
  expect(failed.status).toBe(503); expect(failed.headers.get("cache-control")).toBe("no-store");
  const before = opened;
  for (const bad of ["?verse=Psalms+1%3A1", "?verse=Genesis%2012%3A1", "?verse=Genesis+12:1", "?verse=Genesis+12%3A1&verse=Genesis+12%3A1", "?ref=Genesis+12%3A1", "?verse=Genesis+51%3A1", ""]) {
    const response = await call(bad);
    expect(response.status, bad).toBe(400); expect(response.headers.get("cache-control"), bad).toBe("no-store");
  }
  expect(opened).toBe(before);
  expect((await handlePublicReadingRequest(new Request("https://beitmitzvah.centralreform.org/api/public/translations?verse=Genesis+12%3A1", { method: "POST", body: "{}" }), async action => action(runtime()))).status).toBe(405);
});
