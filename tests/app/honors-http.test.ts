import { afterEach, test, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { honorsFixture, emptyForm } from "./honors-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { LIMITS, form } from "../../src/server/honors/validation";
import { view } from "../../src/server/honors/context";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { randomUUID } from "node:crypto";
import type { HonorPerson, HonorsContext } from "../../src/lib/honors/types";
import { privateJson, type JsonValue } from "../../src/server/http/responses";
const fixtures: Awaited<ReturnType<typeof honorsFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() { const f = await honorsFixture(); fixtures.push(f); return { ...f, dispatch: createHttpDispatcher(async action => action(f.runtime)) }; }

test("actual SDK guardian GET/replace/receipt transport is closed, private and method/origin protected", async () => {
  const f = await fixture(), write = await f.intent();
  const get = await f.dispatch(f.request(f.path + "?mode=parent")); expect(get.status).toBe(200); expect(get.headers.get("cache-control")).toBe("private, no-store");
  const replace = await f.dispatch(f.request(f.path, { body: { mode: "parent", ...write } })); expect(replace.status).toBe(200); expect(await replace.json()).toMatchObject({ ok: true, committedVersion: 1 });
  const receipt = await f.dispatch(f.request(f.path + "/receipt", { body: { mode: "parent", ...write } })); expect(await receipt.json()).toMatchObject({ outcome: "committed", committedVersion: 1 });
  for (const [request, status] of [ [f.request(f.path + "?mode=parent&mode=admin"), 400], [f.request(f.path, { method: "PUT" }), 405],
    [f.request(f.path, { body: { mode: "parent", ...write, guardianId: "forbidden" } }), 400], [f.request(f.path, { body: { mode: "parent", ...write }, headers: { origin: "https://foreign.invalid" } }), 403],
    [f.request(f.path + "?mode=parent", { handle: "synthetic" }), 403], [f.request(f.path + "?mode=parent", { who: "anonymous" }), 401],
    [f.request(f.path, { body: { mode: "parent", ...write }, headers: { "content-length": String(66 * 1024 + 1) } }), 413] ] as const) {
    const response = await f.dispatch(request); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(JSON.stringify(await response.json())).not.toContain("Synthetic Person");
  }
});

test("response budget covers max draft and both historical/current 1000-start context/span envelopes", async () => {
  const verses: string[] = [];
  for (const [chapter, count] of TANAKH_VERSE_COUNTS.Genesis.entries()) for (let v = 1; v <= count && verses.length < 1000; v++) verses.push(`Genesis ${chapter + 1}:${v}`);
  const snapshot: HonorsContext = { schemaVersion: 1, tenantId: "crc", studentId: randomUUID(), ceremonyDate: "2027-01-02", serviceSlot: "morning", torah: { id: randomUUID(), revision: 1, ref: `${verses[0]}-${verses.at(-1)!.split(" ")[1]}`, basis: "custom", confirmation: { confirmationDate: "2027-01-02", serviceSlot: "morning", slotProvenance: 1, needsReview: false }, verses, cuts: verses.slice(1) } };
  const lists: HonorPerson[][] = [[], [], [], []], draft = { ...emptyForm(), openingArk: lists[0], undressingTorah: lists[1], redressingTorah: lists[2], closingArk: lists[3], aliyot: verses.map(startVerse => ({ startVerse, participants: [] })) };
  for (const list of lists) for (let i = 0; i < 32; i++) { const candidate = { id: randomUUID(), englishName: "a".repeat(256) }; list.push(candidate); if (Buffer.byteLength(JSON.stringify(draft)) > LIMITS.payloadBytes) { list.pop(); break; } }
  const normalized = form(draft); expect(Buffer.byteLength(JSON.stringify(normalized))).toBeGreaterThan(LIMITS.payloadBytes - 512);
  const previous = view(snapshot), current = view({ ...snapshot, ceremonyDate: "2027-02-06", serviceSlot: "havdalah" });
  expect(previous.spans).toHaveLength(1000); expect(current.spans).toHaveLength(1000);
  // Independent pessimistic bound: two max-sized snapshots and two 1000-span vectors with 100-byte refs, form, plus 16KiB fixed metadata.
  const worstCase = 2 * (LIMITS.contextBytes + LIMITS.aliyot * (2 * 100 + 40)) + LIMITS.payloadBytes + 16384;
  expect(worstCase).toBeLessThan(LIMITS.responseBytes);
  const result = { ok: true, currentVersion: 1, currentContext: current, needsReview: true, saved: { version: 1, createdAt: new Date(0).toISOString(), form: normalized, reviewedContext: previous } };
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(LIMITS.responseBytes); expect(privateJson(result as unknown as JsonValue).status).toBe(200);
});
