import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  SHORT_PUBLICATION as P,
  partitionPublicationBodies,
  publicationRecord,
  publicationSnapshot,
  publicationSHA256 as sha,
  cohortInventory,
  parseCohortSnapshot,
  validatePublicationReceipts,
  validatePublicationCoverage,
  verifyPublicationBytes,
  preparePublication,
} from "../scripts/reference-short-publication.mjs";
const row = (n, bytes = 1024 * 1024) => {
  const h = n.toString(16).padStart(64, "0");
  return { sha256: h, bytes, key: `reference-audio/short-v1/${h}.mp3` };
};
const enc = (v) => Buffer.from(JSON.stringify(v) + "\n");
test("deterministic packing enforces both actual byte and object budgets", () => {
  const input = Array.from({ length: 6984 }, (_, n) => row(n + 1, 100000));
  const a = partitionPublicationBodies(input),
    b = partitionPublicationBodies(input.toReversed());
  assert.deepEqual(a, b);
  assert.equal(a.flat().length, 6984);
  assert.equal(a.length, 14);
  for (const c of a) {
    assert.ok(c.length <= 512);
    assert.ok(c.reduce((n, v) => n + v.bytes, 0) <= P.cohortBytes);
  }
  const max = partitionPublicationBodies(
    Array.from({ length: 129 }, (_, n) => row(n + 1)),
  );
  assert.deepEqual(
    max.map((c) => c.length),
    [64, 64, 1],
  );
  assert.throws(() => partitionPublicationBodies([row(1), row(1)]));
  assert.throws(() => partitionPublicationBodies([row(1, P.bodyBytes + 1)]));
  assert.throws(() =>
    partitionPublicationBodies(
      Array.from({ length: 6984 }, (_, n) => row(n + 1)),
    ),
  );
});
test("closed metadata refuses accessors, extra authority and alternative keys", () => {
  let calls = 0;
  assert.throws(() =>
    publicationRecord(
      {
        get a() {
          calls++;
          return 1;
        },
      },
      ["a"],
    ),
  );
  assert.equal(calls, 0);
  assert.throws(() => publicationRecord({ a: 1, b: 2 }, ["a"]));
  assert.throws(() =>
    partitionPublicationBodies([
      { ...row(1), key: "https://unselected.invalid/file" },
    ]),
  );
  assert.throws(() =>
    partitionPublicationBodies([{ ...row(1), token: "secret" }]),
  );
});
test("owned snapshots resist post-hash mutation and refuse shared memory", () => {
  const b = Buffer.from([1, 2, 3]),
    copy = publicationSnapshot(b, 3);
  b.fill(8);
  assert.deepEqual([...copy], [1, 2, 3]);
  assert.throws(() =>
    publicationSnapshot(new Uint8Array(new SharedArrayBuffer(1)), 3),
  );
  assert.throws(() => publicationSnapshot(new Uint8Array(4), 3));
});
test("cohort pins and identities are exact and have no caller URL escape", () => {
  const objects = [row(1)],
    v = {
      schema: "reference-short-publication-cohort/v1",
      runId: randomUUID(),
      producerCommit: P.producerCommit,
      parentCatalogSHA256: P.parentSHA256,
      manifestSHA256: "a".repeat(64),
      manifestBytes: 100,
      libraryBodies: 6984,
      capacityHeld: 9,
      parents: 428,
      cohortIndex: 0,
      cohortCount: 1,
      cohortSHA256: sha(enc(objects)),
      objects,
      mode: "body",
    };
  assert.equal(cohortInventory(v).objects.length, 1);
  const raw = enc(v);
  assert.equal(parseCohortSnapshot(raw, sha(raw)).runId, v.runId);
  assert.throws(() => parseCohortSnapshot(raw, "b".repeat(64)));
  for (const change of [
    { capacityHeld: 7 },
    { producerCommit: "b".repeat(40) },
    { libraryBodies: 6986 },
    { parents: 427 },
    { objects: [{ ...row(1), key: "/arbitrary" }] },
    { mode: "manifest" },
  ])
    assert.throws(() => cohortInventory({ ...v, ...change }));
});
test("exact disjoint coverage rejects overlapping plans even when total counts match", () => {
  const objects = Array.from({ length: 6984 }, (_, n) => row(n + 1, 100));
  const plans = partitionPublicationBodies(objects).map((objects) => ({
    objects,
  }));
  assert.equal(validatePublicationCoverage(objects, plans), true);
  const overlap = plans.map((p) => ({ objects: [...p.objects] }));
  overlap[1].objects[0] = overlap[0].objects[0];
  assert.equal(
    overlap.reduce((n, p) => n + p.objects.length, 0),
    6984,
  );
  assert.throws(() => validatePublicationCoverage(objects, overlap));
  assert.throws(() => validatePublicationCoverage(objects, plans.slice(1)));
  assert.throws(() => validatePublicationReceipts({}, plans, []));
});
test("forged library and miniature candidate grant no publication authority", async () => {
  assert.throws(() => verifyPublicationBytes({}, row(1), new Uint8Array(1)));
  await assert.rejects(preparePublication({ root: "unselected" }, {}));
});
