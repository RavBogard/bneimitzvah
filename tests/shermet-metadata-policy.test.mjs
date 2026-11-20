import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { entryProblems } from "../scripts/repo-policy.mjs";
import { SHERMET_LIBRARY_FILE, SHERMET_METADATA_REASON } from "../scripts/shermet-metadata-policy.mjs";
const audio = { sourceId: 123456, sha256: "a".repeat(64), bytes: 1000, duration: 12.5, mimeType: "audio/mpeg" };
function item(patch = {}) {
  const value = { category: "lesson", title: "Torah Trope", label: "Synthetic trope lesson", pageUrl: "https://www.templeisraelomaha.com/torah-trope.html", recordings: [audio], status: "available", ...patch };
  return { id: "sr_" + createHash("sha256").update(value.pageUrl + "\n" + value.label).digest("hex").slice(0, 32), ...value };
}
const text = items => JSON.stringify({ version: 1, items });
const refused = value => assert.ok(entryProblems(SHERMET_LIBRARY_FILE, typeof value === "string" ? value : text([value])).includes(SHERMET_METADATA_REASON));
test("the exact reviewed path admits only bounded public recording metadata", () => {
  assert.deepEqual(entryProblems(SHERMET_LIBRARY_FILE, text([item()])), []);
  assert.deepEqual(entryProblems(SHERMET_LIBRARY_FILE, text([item({ category: "megillah", kind: "megillah", ref: "Esther 1:1" })])), []);
  assert.deepEqual(entryProblems(SHERMET_LIBRARY_FILE, text([item({ category: "source-conflict", reason: "book-mismatch", recordings: [], status: "pending" })])), []);
  for (const path of ["src/server/shermet-audio/other.json", "nested/" + SHERMET_LIBRARY_FILE, SHERMET_LIBRARY_FILE.toUpperCase()]) assert.ok(entryProblems(path, text([item()])).includes("data file outside reviewed allow-list"));
});
test("payloads, Hebrew, URLs in labels, unknown fields and duplicate JSON members stay forbidden", () => {
  for (const patch of [{ text: "Synthetic payload" }, { label: "\u05d0" }, { label: "https://example.test/payload" }, { label: "data:audio/mpeg;base64,AAAA" }, { label: "A".repeat(121) }, { label: "A".repeat(49) }, { title: "Quoted \"payload\"" }, { reason: "freeform details" }, { category: "other" }, { status: "ready" }, { id: "sr_" + "b".repeat(32) }]) refused(item(patch));
  refused(text([item()]).replace('"version":1', '"version":0,"version":1'));
  refused(text([item()]).replace('"version":1', '"version":0,"\\u0076ersion":1'));
  refused(text([item(), item()]));
  refused(JSON.stringify({ version: 1, items: [], text: "Synthetic payload" }));
  refused(" ".repeat(8 * 1024 * 1024 + 1));
});
test("source URLs, canonical corpus refs and verified audio descriptor fields are closed", () => {
  for (const patch of [{ pageUrl: "https://evil.example.test/torah.html" }, { pageUrl: ["https://user:pass", "www.templeisraelomaha.com/torah.html"].join("@") }, { pageUrl: "https://www.templeisraelomaha.com/torah.html?payload=1" }, { pageUrl: "https://www.templeisraelomaha.com/torah.html#payload" }, { pageUrl: "https://www.templeisraelomaha.com/123456.mp3" }, { kind: "torah" }, { ref: "Genesis 1:1" }, { kind: "torah", ref: "Esther 1:1" }, { kind: "megillah", category: "megillah", ref: "Esther 1:999" }, { kind: "torah", ref: "Genesis 1:1-2" }, { kind: "torah", ref: "Genesis 51:1" }, { status: "pending" }, { recordings: [] }]) refused(item(patch));
  for (const patch of [{ sourceId: "123456" }, { sourceId: 0 }, { sourceId: 1.5 }, { sha256: "bad" }, { bytes: 0 }, { bytes: 20 * 1024 * 1024 + 1 }, { duration: 0 }, { duration: 3601 }, { mimeType: "text/html" }, { mimeType: undefined }, { url: "https://example.test/recording.mp3" }, { body: "AAAA" }]) refused(item({ recordings: [{ ...audio, ...patch }] }));
  refused(item({ recordings: [audio, audio] }));
});
test("existing licensed-text and media restrictions still apply at and outside the exception", () => {
  assert.ok(entryProblems(SHERMET_LIBRARY_FILE, text([item({ label: "JPS translation" })])).some(problem => problem.includes("licensed-text")));
  assert.ok(entryProblems("src/server/shermet-audio/recording.mp3", "synthetic").includes("audio, video, or model artifact"));
  refused(item({ label: "credential@example.test" }));
});
