import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSefariaSourceReader, projectSourceText, SourceTextUnavailable } from "../../src/server/study/source-text";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { parseShelfLinks } from "../../src/server/study/shelf";
import { parseShelfAnswer, parseSourceText } from "../../src/components/portal/workspace/study/shelf-api";
import { sourceSefariaUrl } from "../../src/lib/readings/shelf";
import { sourceAnswer, sourceVersion, syntheticLinks } from "../helpers/shelf";
import { unavailableExtras } from "../helpers/translations";

// Invented edition titles and syllables; numbered English.
const ref = "Synthetic Commentator on Genesis 12:1";
const code = (action: () => unknown) => { try { action(); return "ok"; } catch (error) { return error instanceof SourceTextUnavailable ? error.code : String(error); } };

test("a string is one segment and an array a range; segments pair by index; each language is credited from what Sefaria returns", () => {
  const one = projectSourceText(sourceAnswer("Synthetic 1:1", [sourceVersion("he", "Synthetic Hebrew", "<b>אָב</b> גַּד"), sourceVersion("en", "Synthetic English", "One <i>two</i>", "")]), "Synthetic 1:1");
  expect(one.segments).toEqual([{ hebrew: [{ text: "אָב", bold: true }, { text: " גַּד" }], english: [{ text: "One " }, { text: "two", italic: true }] }]);
  expect(one.editions).toEqual([
    { language: "he", title: "Synthetic Hebrew", license: "CC-BY", licenseLabel: "CC BY", credit: "Synthetic Hebrew, via Sefaria (CC BY)", url: sourceSefariaUrl("Synthetic 1:1", { language: "he", title: "Synthetic Hebrew" }) },
    { language: "en", title: "Synthetic English", license: "", licenseLabel: "licence not stated", credit: "Synthetic English, via Sefaria (licence not stated)", url: sourceSefariaUrl("Synthetic 1:1", { language: "en", title: "Synthetic English" }) }]);
  expect(one.sefariaUrl).toBe("https://www.sefaria.org/Synthetic%201%3A1");
  const range = projectSourceText(sourceAnswer(ref, [sourceVersion("he", "Synthetic Hebrew", ["א", "ב", "ג"]), sourceVersion("en", "Synthetic English", ["One", "", "Three"])]), ref);
  expect(range.segments.map(segment => [segment.hebrew?.[0].text ?? null, segment.english?.[0].text ?? null])).toEqual([["א", "One"], ["ב", null], ["ג", "Three"]]);
  // Hebrew only (Sefaria warns there is no English): credited for Hebrew only. Footnotes are dropped by the sanitiser.
  const hebrew = projectSourceText(sourceAnswer("Synthetic 1:1", [sourceVersion("he", "Synthetic Hebrew", "אָב<sup class=\"footnote-marker\">1</sup><i class=\"footnote\">note</i>")],
    [{ english: { warning_code: 102, message: "synthetic" } }]), "Synthetic 1:1");
  expect(hebrew.segments).toEqual([{ hebrew: [{ text: "אָב" }], english: null }]);
  expect(hebrew.editions.map(edition => edition.language)).toEqual(["he"]);
  // The browser parser accepts exactly these.
  for (const [value, at] of [[one, "Synthetic 1:1"], [range, ref], [hebrew, "Synthetic 1:1"]] as const) expect(parseSourceText(JSON.parse(JSON.stringify(value)), at)).toEqual(JSON.parse(JSON.stringify(value)));
});

test("deeper, larger or empty texts are unsupported (open on Sefaria); a bad shape is upstream trouble", () => {
  const project = (versions: Record<string, unknown>[], warnings: unknown[] = [], at = "Synthetic 1:1") => code(() => projectSourceText(sourceAnswer(at, versions, warnings), at));
  expect(project([sourceVersion("he", "H", [["nested"]])])).toBe("unsupported");
  expect(project([sourceVersion("he", "H", Array.from({ length: 65 }, () => "x"))])).toBe("unsupported");
  expect(project([sourceVersion("he", "H", "")])).toBe("unsupported");
  expect(project([sourceVersion("he", "H", "x".repeat(70 * 1024))])).toBe("unsupported");
  expect(project([sourceVersion("he", "H", Array.from({ length: 64 }, () => "word ".repeat(1000)))])).toBe("unsupported"); // over 256 KiB
  expect(project([sourceVersion("he", "H", [1, 2])])).toBe("upstream");
  expect(project([sourceVersion("he", "H", { a: 1 })])).toBe("upstream");
  expect(project([{ ...sourceVersion("he", "H", "x"), actualLanguage: "en" }])).toBe("unsupported");
  expect(project([sourceVersion("he", "‮", "x")])).toBe("unsupported"); // no title left once made plain
  expect(projectSourceText(sourceAnswer("Synthetic 1:1", [sourceVersion("he", "<b>Title</b>‮", "x")]), "Synthetic 1:1").editions[0].title).toBe("bTitle/b");
  expect(project([sourceVersion("he", "H", "x")], [{ hebrew: { warning_code: 500 } }])).toBe("upstream");
  expect(project([sourceVersion("he", "H", "x")], [{ "hebrew|Other": { warning_code: 101 } }])).toBe("upstream");
  expect(code(() => projectSourceText(sourceAnswer("Synthetic 1:2", [sourceVersion("he", "H", "x")]), "Synthetic 1:1"))).toBe("unsupported"); // renamed: open on Sefaria
  expect(code(() => projectSourceText({ error: "x" }, "Synthetic 1:1"))).toBe("upstream");
});

test("the reader: one bounded request in the default editions; Sefaria's 404 or 400 is not found; anything else upstream", async () => {
  const answering = (response: () => Response) => createSefariaSourceReader({ fetch: (async () => response()) as typeof globalThis.fetch });
  let asked: URL | undefined;
  const ok = createSefariaSourceReader({ fetch: (async (input: RequestInfo | URL) => { asked = new URL(String(input));
    return new Response(JSON.stringify(sourceAnswer(ref, [sourceVersion("he", "Synthetic Hebrew", "א")])), { headers: { "content-type": "application/json" } }); }) as typeof globalThis.fetch });
  expect((await ok(ref)).segments).toHaveLength(1);
  expect(asked?.pathname).toBe(`/api/v3/texts/${encodeURIComponent(ref)}`); expect(asked?.searchParams.getAll("version")).toEqual(["hebrew", "english"]);
  const json = (status: number) => () => new Response(JSON.stringify({ error: "synthetic" }), { status, headers: { "content-type": "application/json" } });
  await expect(answering(json(404))(ref)).rejects.toMatchObject({ code: "not-found" });
  // Sefaria's own "no text" is definite: unsupported, which the route lets the CDN keep.
  await expect(answering(() => new Response(JSON.stringify({ error: `We have no text for ${ref}.` }), { status: 404, headers: { "content-type": "application/json" } }))(ref)).rejects.toMatchObject({ code: "unsupported" });
  await expect(answering(json(400))(ref)).rejects.toMatchObject({ code: "not-found" });
  await expect(answering(json(500))(ref)).rejects.toMatchObject({ code: "upstream" });
  await expect(answering(() => new Response("<html>", { headers: { "content-type": "text/html" } }))(ref)).rejects.toMatchObject({ code: "upstream" });
  await expect(answering(json(200))("<b>x</b> 1")).rejects.toMatchObject({ code: "invalid-request" });
});

test("the related and source routes: closed queries checked before the runtime, a week and thirty days on the CDN, no-store on failure", async () => {
  let opened = 0, source = createSefariaSourceReader({ fetch: (async () => new Response(JSON.stringify(sourceAnswer(ref, [sourceVersion("he", "Synthetic Hebrew", "א")])), { headers: { "content-type": "application/json" } })) as typeof globalThis.fetch });
  let shelf: PublicRuntime["shelf"] = async verse => parseShelfLinks(syntheticLinks(), verse);
  const runtime = () => ({ resolveTenant: async () => undefined, reading: {} as PublicRuntime["reading"], commentary: async () => { throw new Error("unused"); }, ...unavailableExtras, shelf, source,
    productName: async () => "Synthetic Portal" }) satisfies PublicRuntime;
  const call = (path: string) => handlePublicReadingRequest(new Request(`https://beitmitzvah.centralreform.org${path}`), async action => { opened++; return action(runtime()); });
  const related = await call("/api/public/related?verse=Genesis+12%3A1");
  expect(related.status).toBe(200); expect(related.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=604800");
  const shelfBody = await related.json();
  expect(shelfBody.groups).toHaveLength(6); expect(shelfBody.productName).toBe("Synthetic Portal");
  expect(parseShelfAnswer(shelfBody, "Genesis 12:1").productName).toBe("Synthetic Portal");
  const text = await call(`/api/public/source?${new URLSearchParams([["ref", ref]])}`);
  expect(text.status).toBe(200); expect(text.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=2592000");
  // A 404 that is not Sefaria's own "no text" is not kept.
  source = createSefariaSourceReader({ fetch: (async () => new Response(JSON.stringify({ error: "x" }), { status: 404, headers: { "content-type": "application/json" } })) as typeof globalThis.fetch });
  const missing = await call(`/api/public/source?${new URLSearchParams([["ref", ref]])}`);
  expect(missing.status).toBe(404); expect(missing.headers.get("cache-control")).toBe("no-store"); expect(missing.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  // Definite answers are kept an hour: Sefaria's "no text", and texts this page will never show (too deep, too large, renamed).
  for (const definite of [() => new Response(JSON.stringify({ error: `We have no text for ${ref}.` }), { status: 404, headers: { "content-type": "application/json" } }),
    () => new Response(JSON.stringify(sourceAnswer(ref, [sourceVersion("he", "H", [["nested"]])])), { headers: { "content-type": "application/json" } }),
    () => new Response(JSON.stringify(sourceAnswer("Renamed 1:1", [sourceVersion("he", "H", "x")])), { headers: { "content-type": "application/json" } })]) {
    source = createSefariaSourceReader({ fetch: (async () => definite()) as typeof globalThis.fetch });
    const kept = await call(`/api/public/source?${new URLSearchParams([["ref", ref]])}`);
    expect(kept.status).toBe(404); expect(kept.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=3600"); expect(kept.headers.get("cache-control")).toBe("public, max-age=300");
    expect(kept.headers.get("x-robots-tag")).toBe("noindex, nofollow"); expect(await kept.json()).toEqual({ error: "not-found" });
  }
  // A real upstream failure is never kept.
  for (const failing of [() => new Response("x", { status: 502 }), () => new Response("{", { headers: { "content-type": "application/json" } })]) {
    source = createSefariaSourceReader({ fetch: (async () => failing()) as typeof globalThis.fetch });
    const down = await call(`/api/public/source?${new URLSearchParams([["ref", ref]])}`);
    expect(down.status).toBe(503); expect(down.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  }
  shelf = async () => { throw new (await import("../../src/server/study/sources/metadata")).SourceMetadataUnavailable(); };
  const down = await call("/api/public/related?verse=Genesis+12%3A1");
  expect(down.status).toBe(503); expect(down.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  const before = opened;
  for (const bad of ["/api/public/related?verse=Psalms+1%3A1", "/api/public/related?verse=Genesis+12%3A1&x=1", "/api/public/related?ref=Genesis+12%3A1",
    "/api/public/source?ref=%3Cb%3Ex%3C%2Fb%3E+1", "/api/public/source?ref=Genesis", `/api/public/source?ref=${"x".repeat(300)}+1`, "/api/public/source?ref=Genesis%2012%3A1",
    "/api/public/source?ref=Genesis+12%3A1&kind=torah", "/api/public/source?ref=Genesis+12%3A1%E2%80%AE"]) {
    const response = await call(bad);
    expect(response.status, bad).toBe(400); expect(response.headers.get("cache-control"), bad).toBe("no-store");
  }
  expect(opened).toBe(before);
});

test("the browser parser refuses a source answer that is not exactly the server's", () => {
  const body = JSON.parse(JSON.stringify(projectSourceText(sourceAnswer(ref, [sourceVersion("he", "Synthetic Hebrew", ["א", "ב"]), sourceVersion("en", "Synthetic English", ["One", "Two"])]), ref)));
  const mutations: [string, (v: Record<string, any>) => void][] = [
    ["other ref", v => { v.ref = "Other 1:1"; }], ["link elsewhere", v => { v.sefariaUrl = "https://example.com/"; }], ["credit changed", v => { v.editions[0].credit = "x"; }],
    ["edition link elsewhere", v => { v.editions[1].url = "https://example.com/"; }], ["uncredited English", v => { v.editions.pop(); }], ["empty", v => { v.segments = []; }],
    ["markup key", v => { v.segments[0].hebrew[0].html = "<b>"; }], ["both null", v => { v.segments[0] = { hebrew: null, english: null }; }], ["extra key", v => { v.extra = 1; }],
  ];
  for (const [name, mutate] of mutations) { const value = structuredClone(body); mutate(value); expect(() => parseSourceText(value, ref), name).toThrow(); }
});
