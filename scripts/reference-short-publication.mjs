// Offline publication preparation. Importing this module never calls a provider.
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  open,
  lstat,
  stat,
  realpath,
  readdir,
  mkdir,
  statfs,
} from "node:fs/promises";
import { resolve, join, dirname, relative, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { insideGitWorkingTree } from "./private-paths.mjs";
export const SHORT_PUBLICATION = Object.freeze({
  schema: "reference-short-publication/v1",
  bodies: 6984,
  held: 9,
  parents: 428,
  children: 30,
  producerCommit: "eab443c6a99232d768e2be194c94e4a3175e308a",
  parentSHA256:
    "48c8147becc417690de2f8546ae63870d34422f5d95668671ea1a9f5d7c7efdf",
  holdsSHA256:
    "4156d918e793480b947ba0d406f9c65f4b85a96e64fae8a7cd88aa07e991afd9",
  recipe: "pockettorah-mp3-64k-gapless/v2",
  bodyBytes: 1048576,
  metadataBytes: 8388608,
  cohortBytes: 67108864,
  cohortObjects: 512,
  contextBytes: 100663296,
  maxCohorts: 32,
  projectId: "prj_LaqPZuHk6W5XLlDpw29lUyyij3Sq",
  project: "bneimitzvah",
  teamId: "team_AyFDvnGV3IHjAY32PlW1tltN",
  team: "ravbogards-projects",
  storeId: "store_UOU7eX3fTuUHAs7G",
});
const P = SHORT_PUBLICATION,
  libraries = new WeakMap(),
  sha = (b) => createHash("sha256").update(b).digest("hex");
export const publicationSHA256 = sha;
export function publicationRefuse(code = "refused") {
  throw Object.assign(Error("Short publication refused"), { safeCode: code });
}
const need = (v, c) => {
    if (!v) publicationRefuse(c);
  },
  digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
  integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
export function publicationRecord(value, keys) {
  need(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).length === keys.length,
    "shape",
  );
  const out = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    need(d && Object.hasOwn(d, "value") && d.enumerable, "shape");
    out[k] = d.value;
  }
  return out;
}
export function publicationSnapshot(value, cap) {
  need(value instanceof Uint8Array, "bytes");
  const p = Object.getPrototypeOf(Uint8Array.prototype),
    size = Object.getOwnPropertyDescriptor(p, "byteLength").get.call(value),
    buffer = Object.getOwnPropertyDescriptor(p, "buffer").get.call(value),
    offset = Object.getOwnPropertyDescriptor(p, "byteOffset").get.call(value);
  need(integer(size, 1, cap) && buffer instanceof ArrayBuffer, "bytes");
  return new Uint8Array(new Uint8Array(buffer, offset, size));
}
const encode = (v) => Buffer.from(JSON.stringify(v) + "\n");
const bodyKey = (hash) => `reference-audio/short-v1/${hash}.mp3`,
  manifestKey = (hash) => `reference-audio/short-v1/manifests/${hash}.json`;
function object(value) {
  const v = publicationRecord(value, ["sha256", "bytes", "key"]);
  need(
    digest(v.sha256) &&
      integer(v.bytes, 1, P.bodyBytes) &&
      v.key === bodyKey(v.sha256),
    "object",
  );
  return Object.freeze(v);
}
/** Pure packing only; this creates no genuine library or publication authority. */
export function partitionPublicationBodies(values) {
  need(
    Array.isArray(values) && values.length > 0 && values.length <= P.bodies,
    "body-count",
  );
  const rows = values
    .map(object)
    .sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1));
  need(new Set(rows.map((v) => v.sha256)).size === rows.length, "duplicate");
  const cohorts = [];
  let list = [],
    bytes = 0;
  for (const row of rows) {
    if (list.length === P.cohortObjects || bytes + row.bytes > P.cohortBytes) {
      cohorts.push(Object.freeze(list));
      list = [];
      bytes = 0;
    }
    list.push(row);
    bytes += row.bytes;
  }
  if (list.length) cohorts.push(Object.freeze(list));
  need(cohorts.length <= P.maxCohorts, "cohort-budget");
  return Object.freeze(cohorts);
}
export async function publicationNoLinks(path) {
  for (let p = resolve(path); ; p = dirname(p)) {
    need(!(await lstat(p)).isSymbolicLink(), "path");
    if (dirname(p) === p) break;
  }
}
/** Check the supplied lexical path before canonicalizing it. An otherwise
 * pinned target does not authorize a symlink/junction alias as a root. */
export async function publicationDirectory(value) {
  const path = resolve(value);
  await publicationNoLinks(path);
  need(
    (await realpath(path)) === path && (await lstat(path)).isDirectory(),
    "path",
  );
  return path;
}
async function file(path, cap, allowEmpty = false) {
  path = resolve(path);
  await publicationNoLinks(path);
  const s = await lstat(path);
  need(
    s.isFile() &&
      s.size >= (allowEmpty ? 0 : 1) &&
      s.size <= cap &&
      (await realpath(path)) === path,
    "path",
  );
  return { path, size: s.size, ino: s.ino, mtimeMs: s.mtimeMs };
}
async function readPinned(path, expected, cap) {
  need(digest(expected), "pin");
  const before = await file(path, cap),
    h = await open(before.path, "r"),
    b = Buffer.alloc(before.size + 1);
  let n = 0;
  try {
    while (n < b.length) {
      const r = await h.read(b, n, b.length - n, n);
      if (!r.bytesRead) break;
      n += r.bytesRead;
    }
    const after = await h.stat();
    need(
      n === before.size &&
        after.size === before.size &&
        after.ino === before.ino &&
        after.mtimeMs === before.mtimeMs,
      "changed",
    );
  } finally {
    await h.close();
  }
  const bytes = b.subarray(0, n);
  need(sha(bytes) === expected, "pin");
  return Buffer.from(bytes);
}
function safeRelative(path) {
  need(
    typeof path === "string" &&
      path.length > 0 &&
      path.length < 512 &&
      !isAbsolute(path) &&
      !path.includes("\\") &&
      path.split("/").every((p) => p && p !== "." && p !== "..") &&
      !/[\x00-\x1f\x7f]/.test(path),
    "path",
  );
  return path;
}
async function tree(root, prefix = "") {
  const out = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    safeRelative(path);
    need(!entry.isSymbolicLink(), "path");
    if (entry.isDirectory()) {
      need(path.split("/").length < 20, "path");
      out.push(...(await tree(root, path)));
    } else {
      need(entry.isFile(), "path");
      out.push(path);
    }
  }
  return out.sort();
}
/** Runtime selection is operator-owned code, not a transport/user parameter.
 * A separate root-pinned launcher selects its exact hashes before execution. */
async function verifierRuntime(value) {
  const c = publicationRecord(value, [
    "root",
    "compiledDir",
    "compiledPins",
    "cliSHA256",
    "serverOnly",
  ]);
  const root = await publicationDirectory(c.root),
    compiled = await publicationDirectory(c.compiledDir);
  need(
    Array.isArray(c.compiledPins) &&
      c.compiledPins.length > 0 &&
      c.compiledPins.length <= 2048,
    "code",
  );
  const names = await tree(compiled),
    pins = new Map();
  let total = 0;
  for (const raw of c.compiledPins) {
    const p = publicationRecord(raw, ["path", "sha256"]);
    safeRelative(p.path);
    need(
      /\.(?:js|mjs|json)$/.test(p.path) &&
        digest(p.sha256) &&
        !pins.has(p.path),
      "code",
    );
    const bytes = await readPinned(
      join(compiled, p.path),
      p.sha256,
      32 * 1024 ** 2,
    );
    total += bytes.length;
    need(total <= 64 * 1024 ** 2, "code");
    pins.set(p.path, p.sha256);
  }
  need(names.length === pins.size && names.every((n) => pins.has(n)), "code");
  const cli = join(root, "scripts/reference-short-build.mjs");
  await readPinned(cli, c.cliSHA256, 1024 ** 2);
  const mod = await import(pathToFileURL(cli).href);
  need(typeof mod.verifyShortBuildServerOnly === "function", "code");
  const importers = [
    "short-source-body",
    "short-source-gapless",
    "short-source-manifest",
    "catalog",
  ].map((n) => join(compiled, "src/server/reference-audio", n + ".js"));
  need(
    importers.every((p) =>
      pins.has(relative(compiled, p).replaceAll("\\", "/")),
    ),
    "code",
  );
  await mod.verifyShortBuildServerOnly(importers, c.serverOnly);
  const require = createRequire(import.meta.url),
    at = (p) => join(compiled, p);
  return {
    root,
    compiled,
    catalog: require(at("src/server/reference-audio/catalog.js")),
    manifest: require(
      at("src/server/reference-audio/short-source-manifest.js"),
    ),
    body: require(at("src/server/reference-audio/short-source-body.js")),
    source: require(at("src/lib/reference-audio/source.js")),
    selection: c,
  };
}
/** Genuine parser/manifest/entry/body functions are used directly, never cloned. */
export async function openPublicationLibrary(input) {
  const c = publicationRecord(input, ["runtime", "parent", "manifest"]),
    parent = publicationRecord(c.parent, ["path", "sha256"]),
    manifest = publicationRecord(c.manifest, ["path", "sha256"]),
    r = await verifierRuntime(c.runtime),
    parentBytes = await readPinned(parent.path, parent.sha256, P.metadataBytes),
    manifestBytes = await readPinned(
      manifest.path,
      manifest.sha256,
      P.metadataBytes,
    ),
    catalog = r.catalog.parseReferenceCatalog(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(parentBytes)),
    );
  need(catalog, "catalog");
  const loaded = await r.manifest.createShortSourceManifestLoader({
    sha256: manifest.sha256,
    parentCatalogSHA256: parent.sha256,
    parentCatalogBytes: parentBytes,
    get: async () =>
      new ReadableStream({
        start(s) {
          s.enqueue(new Uint8Array(manifestBytes));
          s.close();
        },
      }),
  })();
  need(
    r.manifest.shortSourceManifestMatches(
      loaded,
      parent.sha256,
      manifest.sha256,
    ),
    "manifest",
  );
  const raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
    ),
    objects = [];
  for (const v of raw.entries) {
    const entry = r.manifest.lookupShortSource(loaded, v.id);
    need(entry, "entry");
    const source = r.manifest.readShortSourceEntry(entry).source;
    objects.push(
      object({
        sha256: source.sha256,
        bytes: source.bytes,
        key: source.path.slice(1),
      }),
    );
  }
  need(
    objects.length > 0 &&
      new Set(objects.map((v) => v.sha256)).size === objects.length,
    "coverage",
  );
  const handle = Object.freeze({});
  libraries.set(handle, {
    r,
    catalog,
    loaded,
    parentBytes,
    manifestBytes,
    parent,
    manifest,
    objects: Object.freeze(objects),
  });
  return handle;
}
export function publicationObjects(handle) {
  const lib = libraries.get(handle);
  need(lib, "genuine-library");
  return Object.freeze(lib.objects.map((v) => Object.freeze({ ...v })));
}
export function verifyPublicationBytes(handle, expected, value) {
  const lib = libraries.get(handle);
  need(lib, "genuine-library");
  const o = publicationRecord(expected, ["sha256", "bytes", "key"]),
    bytes = publicationSnapshot(
      value,
      o.key === manifestKey(lib.manifest.sha256)
        ? P.metadataBytes
        : P.bodyBytes,
    );
  need(
    digest(o.sha256) && bytes.length === o.bytes && sha(bytes) === o.sha256,
    "body",
  );
  if (o.key === manifestKey(lib.manifest.sha256)) {
    need(
      o.sha256 === lib.manifest.sha256 && o.bytes === lib.manifestBytes.length,
      "manifest",
    );
    return new Uint8Array(bytes);
  }
  const member = lib.objects.find((v) => v.sha256 === o.sha256);
  need(
    member && member.bytes === o.bytes && member.key === o.key,
    "membership",
  );
  const entry = lib.r.manifest.lookupShortSource(lib.loaded, `rs_${o.sha256}`),
    receipt = lib.r.body.verifyShortSourceBody(entry, bytes);
  return lib.r.body.readVerifiedShortSourceBody(receipt).bytes;
}
export function cohortInventory(input) {
  const c = publicationRecord(input, [
    "schema",
    "runId",
    "producerCommit",
    "parentCatalogSHA256",
    "manifestSHA256",
    "manifestBytes",
    "libraryBodies",
    "capacityHeld",
    "parents",
    "cohortIndex",
    "cohortCount",
    "cohortSHA256",
    "objects",
    "mode",
  ]);
  need(
    c.schema === "reference-short-publication-cohort/v1" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        c.runId,
      ) &&
      c.producerCommit === P.producerCommit &&
      digest(c.parentCatalogSHA256) &&
      digest(c.manifestSHA256) &&
      integer(c.manifestBytes, 1, P.metadataBytes) &&
      c.libraryBodies === P.bodies &&
      c.capacityHeld === P.held &&
      c.parents === P.parents &&
      integer(c.cohortCount, 1, P.maxCohorts) &&
      integer(c.cohortIndex, 0, c.cohortCount - 1) &&
      ["body", "manifest"].includes(c.mode),
    "selection",
  );
  need(Array.isArray(c.objects), "objects");
  const rows =
    c.mode === "body"
      ? c.objects.map(object)
      : c.objects.map((v) => {
          const o = publicationRecord(v, ["sha256", "bytes", "key"]);
          need(
            o.sha256 === c.manifestSHA256 &&
              o.bytes === c.manifestBytes &&
              o.key === manifestKey(c.manifestSHA256),
            "manifest",
          );
          return Object.freeze(o);
        });
  need(
    rows.length > 0 &&
      rows.length <= (c.mode === "body" ? P.cohortObjects : 1) &&
      rows.reduce((n, v) => n + v.bytes, 0) <=
        (c.mode === "body" ? P.cohortBytes : P.metadataBytes) &&
      new Set(rows.map((v) => v.sha256)).size === rows.length &&
      digest(c.cohortSHA256) &&
      sha(encode(rows)) === c.cohortSHA256,
    "objects",
  );
  return Object.freeze({ ...c, objects: Object.freeze(rows) });
}
export function parseCohortSnapshot(value, expected) {
  const bytes = publicationSnapshot(value, P.metadataBytes);
  need(digest(expected) && sha(bytes) === expected, "selection-pin");
  return cohortInventory(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
}
/** Pure set arithmetic; this is not a manifest seal or authority. */
export function validatePublicationCoverage(objects, plans) {
  const expected = new Map(objects.map(object).map((o) => [o.sha256, o]));
  need(
    expected.size === P.bodies && objects.length === P.bodies,
    "receipt-coverage",
  );
  const seen = new Set();
  for (const plan of plans) {
    need(
      Array.isArray(plan.objects) &&
        plan.objects.length > 0 &&
        plan.objects.length <= P.cohortObjects,
      "receipt-coverage",
    );
    for (const raw of plan.objects) {
      const o = object(raw),
        member = expected.get(o.sha256);
      need(
        member &&
          member.bytes === o.bytes &&
          member.key === o.key &&
          !seen.has(o.sha256),
        "receipt-coverage",
      );
      seen.add(o.sha256);
    }
  }
  need(seen.size === expected.size, "receipt-coverage");
  return true;
}
export function assertPublicationCohort(handle, inventory) {
  const lib = libraries.get(handle);
  need(lib, "genuine-library");
  need(
    inventory.parentCatalogSHA256 === lib.parent.sha256 &&
      inventory.manifestSHA256 === lib.manifest.sha256 &&
      inventory.manifestBytes === lib.manifestBytes.length,
    "library-binding",
  );
  for (const o of inventory.objects) {
    if (inventory.mode === "manifest") {
      need(
        o.sha256 === lib.manifest.sha256 &&
          o.bytes === lib.manifestBytes.length &&
          o.key === manifestKey(lib.manifest.sha256),
        "library-binding",
      );
    } else {
      const match = lib.objects.find((v) => v.sha256 === o.sha256);
      need(
        match && match.bytes === o.bytes && match.key === o.key,
        "library-binding",
      );
    }
  }
  return true;
}
export function assertProductionPublicationLibrary(handle) {
  const lib = libraries.get(handle);
  need(
    lib &&
      lib.parent.sha256 === P.parentSHA256 &&
      lib.objects.length === P.bodies,
    "genuine-library",
  );
  return true;
}
/** Receipts are root-bound native build evidence, not signed provider tokens.
 * Every plan object must be a disjoint member of this exact genuine library. */
export function validatePublicationReceipts(handle, plan, receipts) {
  const lib = libraries.get(handle);
  need(lib, "genuine-library");
  need(
    Array.isArray(plan) &&
      plan.length > 0 &&
      plan.length <= P.maxCohorts &&
      Array.isArray(receipts) &&
      receipts.length === plan.length,
    "receipt-coverage",
  );
  validatePublicationCoverage(lib.objects, plan);
  const seen = new Set();
  for (const selected of plan) {
    const rows = selected.objects.map(object);
    need(
      selected.parentCatalogSHA256 === lib.parent.sha256 &&
        selected.manifestSHA256 === lib.manifest.sha256 &&
        selected.recipe === P.recipe &&
        selected.cohortSHA256 === sha(encode(rows)),
      "receipt-binding",
    );
  }
  for (const raw of receipts) {
    const r = publicationRecord(raw, [
      "schema",
      "cohortSHA256",
      "inventorySHA256",
      "manifestSHA256",
      "deploymentId",
      "contextSHA256",
      "sourceSHA256",
      "ok",
      "verifiedObjects",
      "unknownWrites",
      "publication",
    ]);
    need(
      r.schema === "reference-short-publication-receipt/v1" &&
        r.ok === true &&
        r.unknownWrites === 0 &&
        r.publication === false &&
        typeof r.deploymentId === "string" &&
        /^dpl_[A-Za-z0-9]+$/.test(r.deploymentId) &&
        digest(r.contextSHA256) &&
        digest(r.sourceSHA256) &&
        !seen.has(r.cohortSHA256),
      "receipt",
    );
    const selected = plan.find((p) => p.cohortSHA256 === r.cohortSHA256);
    need(
      selected &&
        r.inventorySHA256 === selected.inventorySHA256 &&
        r.manifestSHA256 === selected.manifestSHA256 &&
        r.contextSHA256 === selected.contextSHA256 &&
        r.sourceSHA256 === selected.sourceSHA256 &&
        r.deploymentId === selected.deploymentId &&
        r.verifiedObjects === selected.objects.length,
      "receipt-binding",
    );
    seen.add(r.cohortSHA256);
  }
  return true;
}
async function freshExternal(path) {
  path = resolve(path);
  await publicationNoLinks(dirname(path));
  need(
    (await realpath(dirname(path))) === dirname(path) &&
      !(await insideGitWorkingTree(path)),
    "path",
  );
  try {
    await lstat(path);
    publicationRefuse("exists");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return path;
}
async function writeCopy(root, path, value) {
  safeRelative(path);
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await publicationNoLinks(dirname(target));
  need((await realpath(dirname(target))) === dirname(target), "path");
  await writeFile(target, value, { flag: "wx", mode: 0o600 });
}
/** Real staging requires the full accepted candidate, never a miniature profile.
 * Native SDK/retention/time behavior remains unknown until the reviewed pilot. */
export async function preparePublication(candidateValue, selectionValue) {
  const candidate = publicationRecord(candidateValue, [
      "root",
      "sourceCommit",
      "manifestSHA256",
      "provenanceSHA256",
      "reportSHA256",
      "acceptance",
      "capacityReceipt",
      "parent",
    ]),
    selection = publicationRecord(selectionValue, [
      "runtime",
      "contextRoot",
      "contextFiles",
      "stageRoot",
      "runIds",
    ]);
  need(
    candidate.sourceCommit === P.producerCommit &&
      digest(candidate.manifestSHA256) &&
      digest(candidate.provenanceSHA256) &&
      digest(candidate.reportSHA256),
    "candidate",
  );
  const root = await publicationDirectory(candidate.root);
  need(!(await insideGitWorkingTree(root)), "path");
  const manifest = await readPinned(
      join(root, "manifest.json"),
      candidate.manifestSHA256,
      P.metadataBytes,
    ),
    provRaw = await readPinned(
      join(root, "private-provenance.json"),
      candidate.provenanceSHA256,
      128 * 1024 ** 2,
    ),
    reportRaw = await readPinned(
      join(dirname(root), "corpus-report.json"),
      candidate.reportSHA256,
      1024 ** 2,
    ),
    prov = JSON.parse(provRaw),
    report = JSON.parse(reportRaw);
  need(
    report.schema === "reference-short-corpus-build/v1" &&
      report.ok === false &&
      report.code === "candidate-set" &&
      report.phase === "candidate" &&
      report.completedChildren === 30 &&
      report.targetCuts === P.bodies &&
      report.capacityHeld === P.held &&
      report.manifestSHA256 === null &&
      report.cleanup?.runtime === true &&
      report.cleanup?.work === true &&
      report.cleanup?.home === true &&
      report.publication === false,
    "candidate-report",
  );
  need(
    prov.sourceCommit === candidate.sourceCommit &&
      prov.parentCatalogSHA256 === P.parentSHA256 &&
      prov.nativeEvidenceSHA256 === P.holdsSHA256 &&
      prov.manifestSHA256 === candidate.manifestSHA256 &&
      prov.bodyVerifiedCount === P.bodies &&
      prov.childCount === 30 &&
      prov.originalsPreserved === true &&
      prov.publication === false &&
      Array.isArray(prov.cuts) &&
      prov.cuts.length === P.bodies,
    "candidate-provenance",
  );
  const approval = publicationRecord(candidate.acceptance, ["path", "sha256"]),
    a = publicationRecord(
      JSON.parse(await readPinned(approval.path, approval.sha256, 1024 ** 2)),
      [
        "schema",
        "sourceCommit",
        "parentCatalogSHA256",
        "manifestSHA256",
        "provenanceSHA256",
        "reportSHA256",
        "capacityReceiptSHA256",
        "bodyCount",
        "parents",
        "capacityHeld",
        "nativeVerified",
        "independentAccepted",
        "originalDriverOk",
        "finalizationSHA256",
        "publication",
      ],
    );
  need(
    a.schema === "reference-short-publication-acceptance/v1" &&
      a.sourceCommit === candidate.sourceCommit &&
      a.parentCatalogSHA256 === P.parentSHA256 &&
      a.manifestSHA256 === candidate.manifestSHA256 &&
      a.provenanceSHA256 === candidate.provenanceSHA256 &&
      a.reportSHA256 === candidate.reportSHA256 &&
      a.capacityReceiptSHA256 === P.holdsSHA256 &&
      a.bodyCount === P.bodies &&
      a.parents === P.parents &&
      a.capacityHeld === P.held &&
      a.nativeVerified === true &&
      a.independentAccepted === true &&
      a.originalDriverOk === false &&
      digest(a.finalizationSHA256) &&
      a.publication === false,
    "independent-acceptance",
  );
  const finalizationPath = join(
    dirname(resolve(approval.path)),
    a.finalizationSHA256 + ".json",
  );
  await readPinned(finalizationPath, a.finalizationSHA256, 8 * 1024 ** 2);
  const holdsPin = publicationRecord(candidate.capacityReceipt, [
    "path",
    "sha256",
  ]);
  need(holdsPin.sha256 === P.holdsSHA256, "holds");
  const holds = JSON.parse(
    await readPinned(holdsPin.path, holdsPin.sha256, 1024 ** 2),
  );
  need(
    holds.facts?.length === P.held && holds.selectedCuts === P.bodies,
    "holds",
  );
  const parent = publicationRecord(candidate.parent, ["path", "sha256"]);
  need(parent.sha256 === P.parentSHA256, "parent");
  const library = await openPublicationLibrary({
      runtime: selection.runtime,
      parent,
      manifest: {
        path: join(root, "manifest.json"),
        sha256: candidate.manifestSHA256,
      },
    }),
    lib = libraries.get(library),
    objects = publicationObjects(library);
  need(
    objects.length === P.bodies &&
      new Set(prov.cuts.map((c) => c.fact?.parentAsset)).size === P.parents &&
      new Set(prov.cuts.map((c) => c.body?.sha256)).size === P.bodies &&
      objects.every((o) =>
        prov.cuts.some(
          (c) =>
            c.body?.sha256 === o.sha256 &&
            c.fact?.encoded?.bytes === o.bytes &&
            c.fact?.encoded?.sha256 === o.sha256 &&
            c.fact?.encoded?.recipe === P.recipe,
        ),
      ),
    "coverage",
  );
  const names = await readdir(root),
    wanted = new Set([
      ...objects.map((o) => `${o.sha256}.mp3`),
      "manifest.json",
      "private-provenance.json",
    ]);
  need(
    names.length === wanted.size && names.every((n) => wanted.has(n)),
    "bodyset",
  );
  for (const h of holds.facts) {
    const asset = lib.catalog.assets.find((a) => a.id === h.asset),
      verse = asset?.verses.find((v) => v.ref === h.ref);
    need(
      verse &&
        lib.r.manifest.findShortSource(lib.loaded, {
          verse,
          source: lib.r.source.parseReferenceSource({
            schema: "reference-source/v1",
            asset: asset.id,
            sha256: asset.sha256,
            bytes: asset.bytes,
            url: lib.r.source.REFERENCE_ARCHIVE_PREFIX + asset.archiveFile,
          }),
        }) === null,
      "held-coverage",
    );
  }
  const cohorts = partitionPublicationBodies(objects);
  need(
    Array.isArray(selection.runIds) &&
      selection.runIds.length === cohorts.length,
    "run-ids",
  );
  const contextRoot = await publicationDirectory(selection.contextRoot);
  need(
    Array.isArray(selection.contextFiles) &&
      selection.contextFiles.length > 0 &&
      selection.contextFiles.length <= 4096,
    "source-context",
  );
  const code = [],
    codeNames = new Set();
  let codeBytes = 0;
  for (const value of selection.contextFiles) {
    const pin = publicationRecord(value, ["path", "sha256"]);
    safeRelative(pin.path);
    need(
      !codeNames.has(pin.path) &&
        !pin.path.startsWith("publication-input/") &&
        !/(?:^|\/)\.env(?:\.|$)/.test(pin.path) &&
        !pin.path.includes("node_modules/") &&
        !/\.(?:mp3|wav|flac|pcm|f32|f64)$/i.test(pin.path),
      "source-context",
    );
    const bytes = await readPinned(
      join(contextRoot, pin.path),
      pin.sha256,
      32 * 1024 ** 2,
    );
    codeBytes += bytes.length;
    need(codeBytes <= P.contextBytes, "source-context");
    code.push({ ...pin, bytes });
    codeNames.add(pin.path);
  }
  const stage = await freshExternal(selection.stageRoot),
    disk = await statfs(dirname(stage));
  need(disk.bavail * disk.bsize >= 4 * 1024 ** 3, "disk");
  await mkdir(stage, { mode: 0o700 });
  const contexts = [];
  for (let index = 0; index < cohorts.length; index++) {
    const list = cohorts[index],
      dir = join(stage, `cohort-${String(index).padStart(3, "0")}`);
    await mkdir(dir, { mode: 0o700 });
    let total = codeBytes + manifest.length + lib.parentBytes.length;
    for (const f of code) await writeCopy(dir, f.path, f.bytes);
    await writeCopy(dir, "publication-input/manifest.json", manifest);
    await writeCopy(dir, "publication-input/parent.json", lib.parentBytes);
    for (const o of list) {
      const raw = await readPinned(
          join(root, `${o.sha256}.mp3`),
          o.sha256,
          P.bodyBytes,
        ),
        verified = verifyPublicationBytes(library, o, raw);
      total += verified.length;
      need(total <= P.contextBytes, "context-budget");
      await writeCopy(
        dir,
        `publication-input/bodies/${o.sha256}.mp3`,
        verified,
      );
    }
    const inventory = cohortInventory({
        schema: "reference-short-publication-cohort/v1",
        runId: selection.runIds[index],
        producerCommit: P.producerCommit,
        parentCatalogSHA256: P.parentSHA256,
        manifestSHA256: candidate.manifestSHA256,
        manifestBytes: manifest.length,
        libraryBodies: P.bodies,
        capacityHeld: P.held,
        parents: P.parents,
        cohortIndex: index,
        cohortCount: cohorts.length,
        cohortSHA256: sha(encode(list)),
        objects: list,
        mode: "body",
      }),
      inventoryBytes = encode(inventory);
    total += inventoryBytes.length;
    need(total <= P.contextBytes, "context-budget");
    await writeCopy(dir, "publication-input/cohort.json", inventoryBytes);
    const files = [];
    for (const path of await tree(dir)) {
      const bytes = await readFile(join(dir, path));
      files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
    }
    contexts.push({
      index,
      cohortSHA256: inventory.cohortSHA256,
      inventorySHA256: sha(inventoryBytes),
      contextSHA256: sha(encode(files)),
      contextBytes: total,
      objects: list.length,
      files,
    });
  }
  for (const o of objects)
    await readPinned(join(root, `${o.sha256}.mp3`), o.sha256, P.bodyBytes);
  for (const f of code)
    await readPinned(join(contextRoot, f.path), f.sha256, 32 * 1024 ** 2);
  await readPinned(
    join(root, "manifest.json"),
    candidate.manifestSHA256,
    P.metadataBytes,
  );
  await readPinned(
    join(root, "private-provenance.json"),
    candidate.provenanceSHA256,
    128 * 1024 ** 2,
  );
  const plan = {
    schema: P.schema,
    sourceCommit: P.producerCommit,
    manifestSHA256: candidate.manifestSHA256,
    provenanceSHA256: candidate.provenanceSHA256,
    reportSHA256: candidate.reportSHA256,
    acceptanceSHA256: approval.sha256,
    capacityReceiptSHA256: P.holdsSHA256,
    bodyCount: P.bodies,
    capacityHeld: P.held,
    parents: P.parents,
    totalBodyBytes: objects.reduce((n, o) => n + o.bytes, 0),
    contexts,
    nativeProfile: "UNPROVEN",
    manifestPublicationSelected: false,
    publication: false,
  };
  await writeFile(join(stage, "publication-plan.json"), encode(plan), {
    flag: "wx",
    mode: 0o600,
  });
  return Object.freeze({
    ok: true,
    preparedOnly: true,
    planSHA256: sha(encode(plan)),
    bodyCount: P.bodies,
    capacityHeld: P.held,
    parents: P.parents,
    cohorts: contexts.length,
    totalBodyBytes: plan.totalBodyBytes,
    contextBytes: contexts.map((c) => c.contextBytes),
    nativeProfile: "UNPROVEN",
    publication: false,
  });
}
