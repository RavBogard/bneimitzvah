import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createShermetLibrary } from "../../src/server/shermet-audio/library";
import { parseShermetLibrary, shermetLibraryTitle, SHERMET_SERVICE_ITEMS, type ShermetLibraryItem } from "../../src/lib/reference-audio/shermet-library";
const sha = createHash("sha256").update("abc").digest("hex");
const item: ShermetLibraryItem = { id: "sr_" + "a".repeat(32), title: "Traditional Blessings", label: "Synthetic blessing", category: "blessing", pageUrl: "https://www.templeisraelomaha.com/traditional-blessings.html", status: "available", recordings: [{ sourceId: 123456, sha256: sha, bytes: 3, duration: 1, mimeType: "audio/wav" }] };
const pending: ShermetLibraryItem = { ...item, id: "sr_" + "b".repeat(32), title: "Torah Trope", label: "Synthetic trope", category: "lesson", recordings: [], status: "pending" };
const request = (query = "", headers?: HeadersInit, method = "GET") => new Request(`http://localhost/api/shermet-library${query}`, { headers, method });
it("identifies a conflicting source by corrected reference and never promotes an unresolved original label", () => {
  const conflict = { ...item, category: "source-conflict" as const, label: "Genesis 23:20", ref: "Genesis 25:20" };
  expect(shermetLibraryTitle(conflict)).toBe("Genesis 25:20");
  expect(shermetLibraryTitle({ ...conflict, ref: undefined })).toBe("Recording identity unconfirmed");
  expect(conflict.label).toBe("Genesis 23:20");
});
it("searches and categorizes original labels while keeping pending sources visible and other sites disabled", async () => {
  const library = createShermetLibrary({ enabled: true, items: [item, pending] });
  expect((await library.catalog(request("?category=lesson")).json()).items).toEqual([pending]);
  expect((await library.catalog(request("?q=BLESSING")).json()).items).toEqual([item]);
  expect((await library.catalog(request("?q=missing")).json()).items).toEqual([]);
  expect(library.catalog(request("?offset=-1")).status).toBe(400);
  expect(createShermetLibrary({ enabled: false, items: [item] }).catalog(request()).status).toBe(404);
  expect(parseShermetLibrary({ version: 1, items: [{ ...item, recordings: [{ ...item.recordings[0], mimeType: "text/html" }] }] })[0].recordings).toEqual([]);
});
it("maps definitive prayer lessons to the exact original item and preserves printed source distinctions", async () => {
  const library = createShermetLibrary({ enabled: true });
  for (const lesson of ["shma", "vahavta", "torah-before", "torah-after", "haftarah-before", "haftarah-after", "aleinu", "mah-tovu", "mourners-kaddish", "oseh-shalom", "ahavah-rabbah", "sim-shalom", "kdushah", "yotzeir-or"]) {
    const answer = await library.catalog(request(`?lesson=${lesson}`)).json();
    expect(answer.items).toHaveLength(1); expect(answer.items[0].id).toBe(SHERMET_SERVICE_ITEMS[lesson]);
    expect(answer.items[0].category).toBe("blessing");
  }
  expect((await library.catalog(request("?lesson=barchu-evening")).json()).items[0].label).toContain("Shabbat Evening");
  expect((await library.catalog(request("?lesson=barchu")).json()).items[0].label).toContain("Shabbat Morning");
  expect((await library.catalog(request("?lesson=unrelated")).json()).items).toEqual([]);
});
it("only serves a selected available recording, pins digest and source URL, and uses verified MIME with byte ranges", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, options) => { calls.push(String(url)); expect(options).toMatchObject({ redirect: "error", credentials: "omit" }); return new Response("abc"); };
  const library = createShermetLibrary({ enabled: true, items: [item, pending], fetch: fetcher });
  const query = (id = item.id, recording = sha) => `/media?${new URLSearchParams({ id, recording })}`;
  const response = await library.media(request(query(), { range: "bytes=0-0" }));
  expect(response.status).toBe(206); expect(response.headers.get("content-type")).toBe("audio/wav"); expect(await response.text()).toBe("a");
  expect(calls).toEqual(["https://images.shulcloud.com/14396/123456.mp3"]);
  expect((await library.media(request(query(), undefined, "HEAD"))).headers.get("content-length")).toBe("3"); expect(calls).toHaveLength(1);
  for (const q of [query(pending.id), query(item.id, "b".repeat(64)), query("../../outside"), query() + "&url=https://evil.example.test"]) expect((await library.media(request(q))).status).toBe(404);
  const bad = createShermetLibrary({ enabled: true, items: [item], fetch: async () => new Response("wrong") });
  expect((await bad.media(request(query()))).status).toBe(404);
});
