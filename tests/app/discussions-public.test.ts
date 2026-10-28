import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSefariaPinnedSourceReader, SourceTextUnavailable } from "../../src/server/study/source-text";
import { handlePublicReadingRequest, publicReadingRouteMethods, type PublicRuntime } from "../../src/server/http/public-reading";
import { memoPinnedSource, PUBLIC_DISCUSSION_LIMITS, readPublicDiscussions, type PublicDiscussionsRead } from "../../src/server/discussions/public";
import type { PublicSourceRow } from "../../src/server/discussions/data";
import { anchorVerses, slugBase, validateDiscussion, versesFor } from "../../src/server/discussions/validation";
import { namedReading } from "../../src/lib/readings/named-readings";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { sourceAnswer, sourceVersion } from "../helpers/shelf";
import { unavailableExtras } from "../helpers/translations";
import { EN, HE, REFS, syntheticPinned } from "../helpers/discussions";
import { accessFixture } from "./access-fixture";

// The public discussions route (1.7 M6): the same answer signed in or out, published rows only, credits and details apart,
// cacheable with s-maxage and stale-while-revalidate. Synthetic rows and a synthetic Sefaria only.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("the pinned reader asks Sefaria for exactly the chosen edition, and never accepts a substitute", async () => {
  const ref = REFS[0];
  let asked: URL | null = null;
  const reader = (answer: unknown) => createSefariaPinnedSourceReader({ fetch: (async (input: RequestInfo | URL) => { asked = new URL(String(input)); return json(answer); }) as typeof globalThis.fetch });
  const english = await reader(sourceAnswer(ref, [sourceVersion("he", HE, "א"), sourceVersion("en", EN, "One")]))(ref, { language: "en", title: EN });
  expect(asked!.searchParams.getAll("version")).toEqual(["hebrew", `english|${EN}`]);
  expect(english.editions.map(e => [e.language, e.title])).toEqual([["he", HE], ["en", EN]]);
  const hebrew = await reader(sourceAnswer(ref, [sourceVersion("he", HE, "א")]))(ref, { language: "he", title: HE });
  expect(asked!.searchParams.getAll("version")).toEqual([`hebrew|${HE}`]);
  expect(hebrew.segments).toEqual([{ hebrew: [{ text: "א" }], english: null }]);
  const code = async (promise: Promise<unknown>) => { try { await promise; return "ok"; } catch (error) { return error instanceof SourceTextUnavailable ? error.code : String(error); } };
  // Sefaria warns the edition is not there, or returns another edition: refused, not substituted.
  expect(await code(reader(sourceAnswer(ref, [sourceVersion("he", HE, "א")], [{ [`english|${EN}`]: { warning_code: 103, message: "synthetic" } }]))(ref, { language: "en", title: EN }))).toBe("unsupported");
  expect(await code(reader(sourceAnswer(ref, [sourceVersion("he", HE, "א"), sourceVersion("en", "Another Edition", "One")]))(ref, { language: "en", title: EN }))).toBe("unsupported");
  expect(await code(reader(sourceAnswer("Renamed 1:1", [sourceVersion("en", EN, "One")]))(ref, { language: "en", title: EN }))).toBe("unsupported");
  expect(await code(reader({})("not a ref", { language: "en", title: EN }))).toBe("invalid-request");
  expect(await code(reader({})(ref, { language: "en", title: " padded" }))).toBe("invalid-request");
});

test("anchors are verses of real readings, inputs are closed, and slugs are plain", () => {
  expect(anchorVerses("torah").has("Genesis 12:1")).toBe(true);
  expect(anchorVerses("torah").has("Deuteronomy 34:12")).toBe(true);
  expect(anchorVerses("torah").has("Isaiah 40:27")).toBe(false);
  expect(anchorVerses("haftarah").has("Isaiah 40:27")).toBe(true);
  expect(anchorVerses("haftarah").has("Job 1:1")).toBe(false);
  expect(anchorVerses("haftarah").has("Genesis 12:1")).toBe(false);
  const base = { title: "A question", kind: "torah", sources: [{ ref: REFS[0], anchorRef: "Genesis 12:1", edition: EN }] };
  expect(validateDiscussion(base).ok).toBe(true);
  for (const extra of [{ intro: "x" }, { essay: "x" }, { overview: "x" }, { themes: [] }]) expect(validateDiscussion({ ...base, ...extra }).ok).toBe(false);
  expect(validateDiscussion({ ...base, sources: [{ ...base.sources[0], body: "Commentary of our own." }] }).ok).toBe(false);
  expect(slugBase("What does it mean to go forth?")).toBe("what-does-it-mean-to-go-forth");
  expect(slugBase("Ha’azinu: Élan")).toBe("haazinu-elan");
  expect(slugBase("???")).toBe("discussion");
  expect(versesFor({ ref: "Genesis 12:1-3", kind: "torah" })).toEqual(["Genesis 12:1", "Genesis 12:2", "Genesis 12:3"]);
  expect(versesFor({ reading: namedReading("lech-lecha")! })).toContain("Isaiah 40:27");
});

const row = (slug: string, position: number, anchorRef: string, extra: Partial<PublicSourceRow> = {}): PublicSourceRow => ({ slug, title: `Synthetic ${slug}`, kind: "torah", revision: 1,
  updatedAt: new Date("2026-10-24T00:00:00Z"), position, ref: REFS[position - 1] ?? REFS[0], anchorRef, edition: EN, translationId: null, selectedByName: "Synthetic Curator", translationEdition: null, translationBody: null, ...extra });
function harness(read: PublicDiscussionsRead, pinned = syntheticPinned()) {
  let opens = 0;
  const asked: (readonly string[])[] = [];
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: {} as PublicRuntime["reading"], commentary: async () => { throw new Error("unused"); }, ...unavailableExtras,
    discussions: async verses => { asked.push(verses); return read; }, pinnedSource: pinned };
  const call = (path: string, init: RequestInit = {}) => handlePublicReadingRequest(new Request(ORIGIN + path, init), async action => { opens++; return action(runtime); });
  return { call, asked, opens: () => opens, pinned };
}

test("the route answers published discussions with ordered sources, credits and a separate 'Selected by', cacheably and the same for everyone", async () => {
  expect(publicReadingRouteMethods("/api/public/discussions")).toEqual(["GET"]);
  const translationId = randomUUID();
  const read: PublicDiscussionsRead = { productName: "Synthetic Torah", truncated: false, rows: [
    row("second", 1, "Genesis 12:3"),
    row("first", 1, "Genesis 12:1"), row("first", 2, "Genesis 12:2", { ref: REFS[2], edition: null, translationId, translationEdition: HE, translationBody: "Synthetic translation." }),
  ] };
  const h = harness(read);
  const response = await h.call("/api/public/discussions?reading=lech-lecha");
  expect(response.status).toBe(200);
  expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  const body = await response.json();
  expect(h.asked[0]).toEqual(versesFor({ reading: namedReading("lech-lecha")! }));
  expect(body).toMatchObject({ reading: "lech-lecha", productName: "Synthetic Torah", complete: true });
  // Ordered by where each first sits in the reading, then by position.
  expect(body.discussions.map((d: { slug: string }) => d.slug)).toEqual(["first", "second"]);
  const [first] = body.discussions;
  expect(first.anchors).toEqual(["Genesis 12:1", "Genesis 12:2"]);
  expect(first.sources[0]).toMatchObject({ position: 1, kind: "edition", ref: REFS[0], anchorRef: "Genesis 12:1", edition: EN, credit: `${EN}, via Sefaria (CC BY)`, licenseLabel: "CC BY",
    details: { selectedBy: "Selected by Synthetic Curator" } });
  expect(first.sources[0].text.segments[0].english[0].text).toBe(`Synthetic English for ${REFS[0]}`);
  expect(first.sources[1]).toMatchObject({ position: 2, kind: "translation", credit: "Claude translation for Synthetic Torah", translation: { body: "Synthetic translation.", originalEdition: HE },
    details: { selectedBy: "Selected by Synthetic Curator" } });
  expect(first.sources[1].text.editions.map((e: { language: string }) => e.language)).toEqual(["he"]);
  // The credit never carries the curator, and nothing names a membership or an address.
  for (const source of first.sources) expect(source.credit).not.toContain("Synthetic Curator");
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/selected_by|"selectedBy":"[0-9a-f]{8}-|@|translationId|mutation/);
  // Signed in (a cookie) is the same answer; the handler never reads it. An Authorization header is refused as uncacheable.
  const signedIn = await h.call("/api/public/discussions?reading=lech-lecha", { headers: { cookie: "better-auth.session_token=synthetic" } });
  expect(await signedIn.text()).toBe(text);
  expect((await h.call("/api/public/discussions?reading=lech-lecha", { headers: { authorization: "Bearer synthetic" } })).status).toBe(400);
  // A canonical passage with its kind.
  const byRef = await h.call("/api/public/discussions?ref=Genesis+12%3A1-3&kind=torah");
  expect(byRef.status).toBe(200);
  expect(h.asked.at(-1)).toEqual(["Genesis 12:1", "Genesis 12:2", "Genesis 12:3"]);
  expect((await byRef.json())).toMatchObject({ ref: "Genesis 12:1-3", kind: "torah" });
});

test("the answer carries the rabbi's display name as plain text and no email, user or membership field", async () => {
  const read: PublicDiscussionsRead = { productName: "Synthetic Torah", rabbiName: "Rabbi Synthetic", truncated: false, rows: [row("only", 1, "Genesis 12:1")] };
  const body = await (await harness(read).call("/api/public/discussions?reading=lech-lecha")).json();
  expect(body.rabbiName).toBe("Rabbi Synthetic");
  expect(typeof body.rabbiName).toBe("string");
  // Top level and every nested key: nothing that names a person's account.
  const keys = (value: unknown): string[] => value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]) : [];
  expect(keys(body).filter(key => /e-?mail|user|member|account|actor/i.test(key))).toEqual([]);
  expect(JSON.stringify(body)).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
});

test("a bad query never opens the runtime, and a source Sefaria cannot give is served without text and kept a minute only", async () => {
  const h = harness({ productName: "Synthetic Torah", truncated: false, rows: [row("only", 1, "Genesis 12:1")] }, Object.assign(async () => { throw new SourceTextUnavailable("upstream"); }, { calls: [] }));
  for (const path of ["/api/public/discussions", "/api/public/discussions?reading=not-a-reading", "/api/public/discussions?reading=noach&kind=torah",
    "/api/public/discussions?ref=Genesis+1%3A1-99&kind=torah", "/api/public/discussions?ref=Genesis+1%3A1&kind=megillah", "/api/public/discussions?kind=torah&ref=Genesis+1%3A1"]) {
    const response = await h.call(path);
    expect(response.status, path).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(h.opens()).toBe(0);
  expect((await h.call("/api/public/discussions?reading=noach", { method: "POST" })).status).toBe(405);
  const response = await h.call("/api/public/discussions?reading=lech-lecha");
  expect(response.status).toBe(200);
  expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=60");
  const body = await response.json();
  expect(body.complete).toBe(false);
  expect(body.discussions[0].sources[0]).toMatchObject({ text: null, credit: null, sefariaUrl: expect.stringContaining("sefaria.org") });
  // Nothing anchored here: an empty list, still cacheable.
  const empty = harness({ productName: "", truncated: false, rows: [] });
  const none = await empty.call("/api/public/discussions?reading=noach");
  expect(await none.json()).toEqual({ reading: "noach", productName: null, discussions: [], complete: true, truncated: false });
});

test("through the real view: a withdrawn discussion is hidden, another congregation's never appears, and no curator id leaves the database", async () => {
  const f = await accessFixture(); opened.push(f);
  const otherMember = (await f.owner(async () => (await f.client.query<{ id: string }>("select id from membership where tenant_id='other' limit 1")).rows[0])).id;
  await f.owner(async () => {
    for (const [tenant, slug, member, withdrawn] of [["crc", "kept", f.adminMember.id, false], ["crc", "gone", f.adminMember.id, true], ["other", "elsewhere", otherMember, false]] as const) {
      const id = randomUUID();
      // One transaction, as the service writes it: sources only in the transaction that made the revision.
      await f.client.query("begin");
      await f.client.query("insert into curated_discussion(id,tenant_id,slug,title,kind,status,selected_by,mutation_id,request_digest) values($1,$2,$3,'Synthetic question','torah','published',$4,$5,$6)", [id, tenant, slug, member, randomUUID(), "b".repeat(64)]);
      await f.client.query("insert into curated_discussion_source(tenant_id,discussion_id,revision,position,ref,anchor_ref,edition,selected_by,selected_by_name) values($1,$2,1,1,$3,'Genesis 12:1',$4,$5,'Synthetic Curator')", [tenant, id, REFS[0], EN, member]);
      await f.client.query("commit");
      if (withdrawn) await f.client.query("update curated_discussion set status='withdrawn', revision=2 where id=$1", [id]);
    }
  });
  const read = await withTenantTransaction(f.db, { tenantId: "crc" }, tx => readPublicDiscussions(tx as never, "crc", versesFor({ reading: namedReading("lech-lecha")! })));
  expect(read.rows.map(r => r.slug)).toEqual(["kept"]);
  expect(read.rows[0].selectedByName).toBe("Synthetic Curator");
  // The rabbi's name comes from the congregation's settings (the neutral default here), as a plain display string.
  expect(read.rabbiName).toBe("the rabbi");
  const h = harness(read);
  const text = await (await h.call("/api/public/discussions?reading=lech-lecha")).text();
  expect(JSON.parse(text).discussions.map((d: { slug: string }) => d.slug)).toEqual(["kept"]);
  for (const id of [f.adminMember.id, otherMember, f.identities.admin.id]) expect(text).not.toContain(id);
  expect(text).not.toMatch(/@|elsewhere|"gone"/);
});

test("pinned reads are shared and kept a while per instance, failures are not kept, and an oversized answer drops what does not fit instead of failing", async () => {
  let calls = 0, time = 0, fail = false;
  const inner = syntheticPinned();
  const counted = async (ref: string, edition: { language: "he" | "en"; title: string }) => { calls++; if (fail) throw new SourceTextUnavailable("upstream"); return inner(ref, edition); };
  const memo = memoPinnedSource(counted, { ttlMs: 1000, now: () => time });
  await Promise.all([memo(REFS[0], { language: "en", title: EN }), memo(REFS[0], { language: "en", title: EN })]);
  await memo(REFS[0], { language: "en", title: EN });
  expect(calls).toBe(1);
  time = 2000; fail = true;
  await expect(memo(REFS[0], { language: "en", title: EN })).rejects.toThrow();
  await expect(memo(REFS[0], { language: "en", title: EN })).rejects.toThrow();
  expect(calls).toBe(3);
  // Eight discussions of twenty-four 16 KB translations each would be about 3 MB: the answer stays under its budget.
  const body = "Synthetic translation line. ".repeat(580).trim();
  const rows = Array.from({ length: 8 }, (_, d) => Array.from({ length: 24 }, (_, p) => row(`discussion-${d}`, p + 1, "Genesis 12:1",
    { ref: REFS[2], edition: null, translationId: randomUUID(), translationEdition: HE, translationBody: body }))).flat();
  const h = harness({ productName: "Synthetic Torah", truncated: false, rows });
  const response = await h.call("/api/public/discussions?reading=lech-lecha");
  expect(response.status).toBe(200);
  const text = await response.text(), answer = JSON.parse(text);
  expect(Buffer.byteLength(text)).toBeLessThan(PUBLIC_DISCUSSION_LIMITS.answerBytes + 64 * 1024);
  expect(answer.truncated).toBe(true);
  expect(answer.discussions.length).toBeGreaterThan(0);
  expect(answer.discussions.length).toBeLessThan(8);
  expect(response.headers.get("vercel-cdn-cache-control")).toContain("s-maxage");
});
