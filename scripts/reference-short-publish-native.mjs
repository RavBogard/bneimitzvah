// Unwired native-build publisher. No SDK is imported and no request is made on import.
import { readFile, unlink, lstat, realpath, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  SHORT_PUBLICATION as P,
  publicationSHA256 as sha,
  publicationRefuse as refuse,
  publicationRecord as record,
  publicationSnapshot as snapshot,
  publicationNoLinks,
  parseCohortSnapshot,
  verifyPublicationBytes,
  validatePublicationReceipts,
  assertPublicationCohort,
  assertProductionPublicationLibrary,
} from "./reference-short-publication.mjs";
const need = (v, c) => {
    if (!v) refuse(c);
  },
  digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const ORIGIN = "https://uou7ex3ftuuhas7g.private.blob.vercel-storage.com";
export const NATIVE_PUBLICATION_PROFILE = Object.freeze({
  sdk: "2.8.2",
  nativePilot: "UNPROVEN",
  sourceRetention: "UNPROVEN",
  payloadLimit: "UNPROVEN",
  totalMs: 900000,
  callMs: 10000,
  progressMs: 5000,
  emptyReads: 64,
});
/** Closed environment normalization occurs BEFORE any SDK loader. The existing
 * native identity checker is separately required; this is not authentication. */
export function isolatePublicationEnvironment(env) {
  const keep = new Set([
    "PATH",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "HOME",
  ]);
  for (const key of Object.keys(env))
    if (!keep.has(key.toUpperCase())) delete env[key];
  env.VERCEL_BLOB_RETRIES = "0";
  return env;
}
/** Mockable finite protocol. io is a local composition seam, never HTTP input.
 * Tests using it prove orchestration, NOT OIDC/provider/retention behavior. */
export async function publishCohort(input, io) {
  const c = record(input, [
    "inventoryBytes",
    "inventorySHA256",
    "library",
    "mode",
    "manifestPlan",
    "manifestReceipts",
  ]);
  const inventory = parseCohortSnapshot(c.inventoryBytes, c.inventorySHA256);
  assertPublicationCohort(c.library, inventory);
  need(["create", "reconcile"].includes(c.mode), "mode");
  if (inventory.mode === "manifest")
    validatePublicationReceipts(c.library, c.manifestPlan, c.manifestReceipts);
  else
    need(
      c.manifestPlan === null && c.manifestReceipts === null,
      "manifest-selection",
    );
  const start = io.now(),
    deadline = start + NATIVE_PUBLICATION_PROFILE.totalMs;
  need(Number.isFinite(start), "clock");
  let verified = 0,
    unknown = 0,
    phase = "context",
    code = null,
    active = null;
  const fence = () => {
    need(
      Number.isFinite(io.now()) && io.now() >= start && io.now() < deadline,
      "deadline",
    );
    need(!io.signal?.aborted, "abort");
    io.checkContext();
  };
  const call = async (work) => {
    fence();
    const ac = new AbortController();
    active = ac;
    let timer;
    const onAbort = () => ac.abort();
    io.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => work(ac.signal)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              ac.abort();
              reject(
                Object.assign(Error("Short publication refused"), {
                  safeCode: "deadline",
                }),
              );
            },
            Math.min(NATIVE_PUBLICATION_PROFILE.callMs, deadline - io.now()),
          );
        }),
      ]);
      fence();
      return value;
    } finally {
      clearTimeout(timer);
      io.signal?.removeEventListener("abort", onAbort);
      active = null;
    }
  };
  try {
    fence();
    for (const o of inventory.objects) {
      phase = "local-verification";
      const local = await call(() => io.readLocal(o));
      const owned = verifyPublicationBytes(c.library, o, local);
      fence();
      phase = "get";
      const existing = await call((signal) => io.get(o, signal));
      if (existing !== null) {
        phase = "get-verification";
        verifyPublicationBytes(c.library, o, existing);
        fence();
        verified++;
        continue;
      }
      need(c.mode === "create", "reconcile-missing");
      phase = "put";
      // Any exception after dispatch leaves the write uncertain. Never retry it.
      unknown = 1;
      const result = await call((signal) =>
        io.put(o, new Uint8Array(owned), signal),
      );
      need(result && result.pathname === o.key, "put-result");
      const u = new URL(result.url);
      need(
        u.origin === ORIGIN &&
          u.pathname === "/" + o.key &&
          !u.search &&
          !u.hash &&
          !u.username &&
          !u.password,
        "put-result",
      );
      phase = "postget";
      const stored = await call((signal) => io.get(o, signal));
      need(stored !== null, "postget-missing");
      verifyPublicationBytes(c.library, o, stored);
      fence();
      unknown = 0;
      verified++;
    }
    phase = "complete";
  } catch (e) {
    code = [
      "shape",
      "selection-pin",
      "selection",
      "body",
      "membership",
      "genuine-library",
      "manifest",
      "receipt-coverage",
      "receipt-binding",
      "receipt",
      "abort",
      "deadline",
      "reconcile-missing",
      "postget-missing",
      "put-result",
    ].includes(e?.safeCode)
      ? e.safeCode
      : "operation";
  } finally {
    active?.abort();
  }
  // No raw exception, request path, URL, credential, or payload is returned.
  return Object.freeze({
    schema: "reference-short-native-cohort-result/v1",
    runId: inventory.runId,
    cohortSHA256: inventory.cohortSHA256,
    inventorySHA256: c.inventorySHA256,
    manifestSHA256: inventory.manifestSHA256,
    mode: c.mode,
    phase,
    code,
    ok: code === null && verified === inventory.objects.length,
    verifiedObjects: verified,
    unknownWrites: unknown,
    publication: false,
  });
}
/** A full response is collected into one owned bounded buffer; present-but-bad
 * responses never become absence. Always cancel/release the stream. */
export async function collectPublicationResponse(
  response,
  expected,
  signal,
  now = Date.now,
) {
  need(
    response &&
      response.statusCode === 200 &&
      response.stream instanceof ReadableStream,
    "get-response",
  );
  const reader = response.stream.getReader(),
    out = new Uint8Array(expected.bytes + 1);
  const abortReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abortReader, { once: true });
  let offset = 0,
    empty = 0;
  const started = now();
  try {
    for (;;) {
      need(!signal.aborted, "abort");
      need(
        now() >= started && now() - started < NATIVE_PUBLICATION_PROFILE.callMs,
        "deadline",
      );
      let timer;
      const r = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(Error("Short publication refused"), {
                  safeCode: "deadline",
                }),
              ),
            NATIVE_PUBLICATION_PROFILE.progressMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      need(!signal.aborted, "abort");
      if (r.done) break;
      const b = r.value;
      need(b instanceof Uint8Array, "get-response");
      if (!b.byteLength) {
        need(++empty <= NATIVE_PUBLICATION_PROFILE.emptyReads, "get-response");
        continue;
      }
      empty = 0;
      need(offset + b.byteLength <= expected.bytes, "body");
      out.set(b, offset);
      offset += b.byteLength;
    }
    need(offset === expected.bytes, "body");
    return out.slice(0, offset);
  } finally {
    signal.removeEventListener("abort", abortReader);
    let timer;
    try {
      const cancelled = await Promise.race([
        reader.cancel().then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]);
      need(cancelled, "stream-cleanup");
    } finally {
      clearTimeout(timer);
      try {
        reader.releaseLock();
      } catch {}
    }
  }
}
/** Native adapter is intentionally NOT selected by the command-line entry.
 * A separately reviewed root launcher must pin all code/context and provide the
 * genuine library. No native profile is claimed by these source/pure tests. */
export async function createNativePublicationIO(selection) {
  const c = record(selection, [
    "root",
    "contextSHA256",
    "contextPins",
    "identitySHA256",
    "sdkPins",
    "library",
    "inputRoot",
    "now",
    "signal",
  ]);
  assertProductionPublicationLibrary(c.library);
  need(
    digest(c.contextSHA256) &&
      Array.isArray(c.contextPins) &&
      c.contextPins.length > 0 &&
      c.contextPins.length <= 4096,
    "code",
  );
  const root = resolve(c.root);
  await publicationNoLinks(root);
  need((await realpath(root)) === root, "code");
  const checked = [];
  for (const raw of c.contextPins) {
    const p = record(raw, ["path", "sha256"]);
    need(
      typeof p.path === "string" &&
        !p.path.includes("\\") &&
        !p.path.split("/").some((v) => !v || v === "." || v === "..") &&
        !p.path.startsWith("/") &&
        digest(p.sha256),
      "code",
    );
    const path = join(root, p.path);
    await publicationNoLinks(path);
    const s = await lstat(path);
    need(s.isFile() && s.size <= 32 * 1024 ** 2, "code");
    const bytes = await readFile(path);
    need(sha(bytes) === p.sha256, "code");
    checked.push({ path: p.path, bytes: bytes.length, sha256: p.sha256 });
  }
  need(
    sha(Buffer.from(JSON.stringify(checked) + "\n")) === c.contextSHA256,
    "code",
  );
  const identityPath = join(root, "scripts/private-media-oidc-probe.mjs");
  need(
    c.contextPins.some(
      (p) =>
        p.path === "scripts/private-media-oidc-probe.mjs" &&
        p.sha256 === c.identitySHA256,
    ),
    "code",
  );
  const identity = await import(pathToFileURL(identityPath).href);
  const token = identity.assertPrivateMediaNativeContext(process.env, c.now());
  need(
    process.env.VERCEL_PROJECT_ID === P.projectId &&
      process.env.VERCEL_ORG_ID === P.teamId,
    "context",
  );
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  );
  const expiry = claims.exp * 1000;
  need(expiry > c.now() + 120000, "context");
  // Check SDK physical import resolution and selected source bytes before import.
  const sdkURL = import.meta.resolve("@vercel/blob");
  const sdkPath = fileURLToPath(sdkURL);
  await publicationNoLinks(sdkPath);
  need(
    Array.isArray(c.sdkPins) &&
      c.sdkPins.length > 0 &&
      c.sdkPins.some((p) => resolve(p.path) === sdkPath),
    "sdk",
  );
  for (const raw of c.sdkPins) {
    const p = record(raw, ["path", "sha256"]);
    await publicationNoLinks(p.path);
    const size = await lstat(p.path);
    need(size.isFile() && size.size <= 32 * 1024 ** 2, "sdk");
    need(digest(p.sha256) && sha(await readFile(p.path)) === p.sha256, "sdk");
  }
  const packagePath = fileURLToPath(new URL("../package.json", sdkURL));
  need(
    c.sdkPins.some((p) => resolve(p.path) === packagePath),
    "sdk",
  );
  const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
  need(
    packageMetadata.name === "@vercel/blob" &&
      packageMetadata.version === "2.8.2",
    "sdk",
  );
  isolatePublicationEnvironment(process.env);
  const sdk = await import(sdkURL);
  need(process.env.VERCEL_BLOB_RETRIES === "0", "sdk");
  const checkContext = () => {
    need(
      process.env.VERCEL_BLOB_RETRIES === "0" && c.now() < expiry - 5000,
      "context",
    );
  };
  const inputRoot = resolve(c.inputRoot);
  await publicationNoLinks(inputRoot);
  need((await realpath(inputRoot)) === inputRoot, "path");
  return Object.freeze({
    now: c.now,
    signal: c.signal,
    checkContext,
    async readLocal(o) {
      const path = join(
        inputRoot,
        o.key.includes("/manifests/")
          ? "manifest.json"
          : `bodies/${o.sha256}.mp3`,
      );
      await publicationNoLinks(path);
      const s = await lstat(path);
      need(s.isFile() && s.size === o.bytes, "body");
      return snapshot(await readFile(path), o.bytes);
    },
    async get(o, abortSignal) {
      checkContext();
      const result = await sdk.get(o.key, {
        access: "private",
        storeId: P.storeId,
        oidcToken: token,
        abortSignal,
        useCache: false,
      });
      if (result === null) return null;
      return collectPublicationResponse(result, o, abortSignal, c.now);
    },
    async put(o, bytes, abortSignal) {
      checkContext();
      return sdk.put(o.key, bytes, {
        access: "private",
        storeId: P.storeId,
        oidcToken: token,
        abortSignal,
        contentType: o.key.endsWith(".mp3") ? "audio/mpeg" : "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
        multipart: false,
        cacheControlMaxAge: 60,
      });
    },
  });
}
/** Exact staged files only, after a successful cohort. Canonical offline input
 * is never this root. Source retention still needs the actual native pilot. */
export async function removePublicationPayload(root, files) {
  await publicationNoLinks(root);
  need((await realpath(root)) === resolve(root), "path");
  need(
    Array.isArray(files) &&
      files.length >= 3 &&
      files.length <= P.cohortObjects + 3,
    "payload-set",
  );
  const selected = new Set();
  for (const raw of files) {
    const f = record(raw, ["path", "sha256"]);
    need(
      /^publication-input\/(?:bodies\/[a-f0-9]{64}\.mp3|parent\.json|manifest\.json|cohort\.json)$/.test(
        f.path,
      ) && digest(f.sha256),
      "path",
    );
    need(!selected.has(f.path), "payload-set");
    selected.add(f.path);
    const path = join(root, f.path);
    await publicationNoLinks(path);
    need(sha(await readFile(path)) === f.sha256, "pin");
  }
  for (const name of ["parent.json", "manifest.json", "cohort.json"])
    need(selected.has("publication-input/" + name), "payload-set");
  async function enumerate(folder, prefix) {
    const found = [];
    for (const e of await readdir(folder, { withFileTypes: true })) {
      need(!e.isSymbolicLink(), "path");
      const name = prefix + "/" + e.name;
      if (e.isDirectory()) {
        need(name === "publication-input/bodies", "payload-set");
        found.push(...(await enumerate(join(folder, e.name), name)));
      } else {
        need(e.isFile(), "path");
        found.push(name);
        need(found.length <= P.cohortObjects + 3, "payload-set");
      }
    }
    return found;
  }
  const existing = await enumerate(
    join(root, "publication-input"),
    "publication-input",
  );
  need(
    existing.length === selected.size && existing.every((p) => selected.has(p)),
    "payload-set",
  );
  for (const f of files) await unlink(join(root, f.path));
  need(
    (await enumerate(join(root, "publication-input"), "publication-input"))
      .length === 0,
    "payload-set",
  );
  return true;
}
// Deliberately no environment/CLI override. Root must review a concrete native
// selection and pilot before creating a selected launcher at all.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stderr.write(
    "Short publication refused: native-selection-unselected\n",
  );
  process.exitCode = 1;
}
