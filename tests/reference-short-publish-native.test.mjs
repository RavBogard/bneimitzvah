import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  mkdtemp,
  rm,
  realpath,
  symlink,
  unlink,
} from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { shortBuildCompilerArgs } from "../scripts/reference-short-build.mjs";
import {
  SHORT_PUBLICATION as P,
  openPublicationLibrary,
  publicationObjects,
  verifyPublicationBytes,
  publicationSHA256 as sha,
  publicationDirectory,
  preparePublication,
} from "../scripts/reference-short-publication.mjs";
import {
  publishCohort,
  collectPublicationResponse,
  isolatePublicationEnvironment,
  NATIVE_PUBLICATION_PROFILE,
  removePublicationPayload,
} from "../scripts/reference-short-publish-native.mjs";
const ROOT = resolve("."),
  enc = (v) => Buffer.from(JSON.stringify(v) + "\n");
let home, compiled, library, fixture, object, runtimeSelection;
if (!process.execArgv.includes("--conditions=react-server")) {
  test("genuine verifier controls run in an isolated actual react-server child", async () => {
    const isolated = await isolatedEnv({ CI: "1" });
    try {
      await promisify(execFile)(
        process.execPath,
        [
          "--conditions=react-server",
          "--test",
          "tests/reference-short-publish-native.test.mjs",
        ],
        {
          cwd: ROOT,
          env: isolated.env,
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch {
      throw Error(
        "Isolated synthetic publication controls failed; details withheld",
      );
    } finally {
      await isolated.cleanup();
    }
  });
} else {
  before(async () => {
    home = await isolatedEnv({ CI: "1" });
    await mkdir(join(ROOT, ".local-logs"), { recursive: true });
    compiled = await realpath(
      await mkdtemp(join(ROOT, ".local-logs/publication-code-")),
    );
    try {
      await promisify(execFile)(
        process.execPath,
        [
          "node_modules/typescript/bin/tsc",
          ...shortBuildCompilerArgs(compiled),
          "tests/app/reference-public-short-fixture.ts",
        ],
        {
          cwd: ROOT,
          env: home.env,
          windowsHide: true,
          timeout: 60000,
          maxBuffer: 2 * 1024 ** 2,
        },
      );
      const pins = [];
      async function walk(dir) {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, e.name);
          assert.equal(e.isSymbolicLink(), false);
          if (e.isDirectory()) await walk(path);
          else
            pins.push({
              path: relative(compiled, path).replaceAll("\\", "/"),
              sha256: sha(await readFile(path)),
            });
        }
      }
      await walk(compiled);
      const require = createRequire(import.meta.url);
      fixture = require(
        join(compiled, "tests/app/reference-public-short-fixture.js"),
      ).publicShortFixture();
      const parent = join(home.home, "parent.json"),
        manifest = join(home.home, "manifest.json");
      await writeFile(parent, fixture.parent, { flag: "wx" });
      await writeFile(manifest, fixture.manifest, { flag: "wx" });
      const emptyFile = await realpath("node_modules/server-only/empty.js"),
        packageFile = await realpath("node_modules/server-only/package.json");
      library = await openPublicationLibrary({
        runtime: (runtimeSelection = {
          root: ROOT,
          compiledDir: compiled,
          compiledPins: pins,
          cliSHA256: sha(await readFile("scripts/reference-short-build.mjs")),
          serverOnly: {
            emptyFile,
            packageFile,
            emptySHA256: sha(await readFile(emptyFile)),
            packageSHA256: sha(await readFile(packageFile)),
          },
        }),
        parent: { path: parent, sha256: fixture.parentCatalogSHA256 },
        manifest: { path: manifest, sha256: fixture.manifestSHA256 },
      });
      object = publicationObjects(library)[0];
    } catch {
      throw Error(
        "Synthetic genuine-verifier setup refused; private output withheld",
      );
    }
  });
  after(async () => {
    if (compiled) await rm(compiled, { recursive: true, force: true });
    await home?.cleanup();
  });
  function selection(mode = "create") {
    const objects = [object],
      v = {
        schema: "reference-short-publication-cohort/v1",
        runId: randomUUID(),
        producerCommit: P.producerCommit,
        parentCatalogSHA256: fixture.parentCatalogSHA256,
        manifestSHA256: fixture.manifestSHA256,
        manifestBytes: fixture.manifest.length,
        libraryBodies: 6984,
        capacityHeld: 9,
        parents: 428,
        cohortIndex: 0,
        cohortCount: 1,
        cohortSHA256: sha(enc(objects)),
        objects,
        mode: "body",
      },
      raw = enc(v);
    return {
      inventoryBytes: raw,
      inventorySHA256: sha(raw),
      library,
      mode,
      manifestPlan: null,
      manifestReceipts: null,
    };
  }
  function io(changes = {}) {
    return {
      now: () => 1000,
      checkContext() {},
      readLocal: async () => fixture.body,
      get: async () => fixture.body,
      put: async () => {
        throw Error("unexpected");
      },
      ...changes,
    };
  }
  test("lexical root aliases refuse even with exact genuine target bytes", async () => {
    const roots = [
      { alias: join(home.home, "root-alias"), target: ROOT },
      { alias: join(home.home, "compiled-alias"), target: compiled },
      {
        alias: join(home.home, "external-alias"),
        target: await realpath(home.home),
      },
    ];
    const failPath = (error) => error?.safeCode === "path";
    try {
      for (const { alias, target } of roots)
        await symlink(target, alias, "junction");
      const parent = {
        path: join(home.home, "parent.json"),
        sha256: fixture.parentCatalogSHA256,
      };
      const manifest = {
        path: join(home.home, "manifest.json"),
        sha256: fixture.manifestSHA256,
      };
      // Without the lexical check both code aliases select identical genuine bytes.
      for (const runtime of [
        { ...runtimeSelection, root: roots[0].alias },
        { ...runtimeSelection, compiledDir: roots[1].alias },
      ])
        await assert.rejects(
          openPublicationLibrary({ runtime, parent, manifest }),
          failPath,
        );
      assert.equal(
        await publicationDirectory(home.home),
        await realpath(home.home),
      );
      await assert.rejects(publicationDirectory(roots[2].alias), failPath);
      // This external alias is not rejected merely because the target is in Git.
      await assert.rejects(
        preparePublication(
          {
            root: roots[2].alias,
            sourceCommit: P.producerCommit,
            manifestSHA256: "a".repeat(64),
            provenanceSHA256: "b".repeat(64),
            reportSHA256: "c".repeat(64),
            acceptance: {},
            capacityReceipt: {},
            parent: {},
          },
          {
            runtime: {},
            contextRoot: ROOT,
            contextFiles: [],
            stageRoot: join(home.home, "never-created"),
            runIds: [],
          },
        ),
        failPath,
      );
    } finally {
      for (const { alias } of roots) {
        try {
          await unlink(alias);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  });
  test("real genuine entry/body verifies; copies and resealed CRC-corrupt bytes do not", async () => {
    assert.deepEqual(
      Buffer.from(verifyPublicationBytes(library, object, fixture.body)),
      Buffer.from(fixture.body),
    );
    assert.throws(() =>
      verifyPublicationBytes({ ...library }, object, fixture.body),
    );
    const bad = new Uint8Array(fixture.body);
    bad[bad.length - 1] ^= 1;
    assert.throws(() => verifyPublicationBytes(library, object, bad));
    const require = createRequire(import.meta.url),
      f = require(
        join(compiled, "tests/app/reference-public-short-fixture.js"),
      ).publicShortFixture((b) => {
        b[b.length - 1] ^= 1;
      });
    assert.notEqual(f.hash, fixture.hash);
    const badManifest = join(home.home, "resealed-manifest.json");
    await writeFile(badManifest, f.manifest, { flag: "wx" });
    const badLibrary = await openPublicationLibrary({
      runtime: runtimeSelection,
      parent: {
        path: join(home.home, "parent.json"),
        sha256: f.parentCatalogSHA256,
      },
      manifest: { path: badManifest, sha256: f.manifestSHA256 },
    });
    const [badObject] = publicationObjects(badLibrary);
    assert.equal(sha(f.body), badObject.sha256);
    assert.throws(() => verifyPublicationBytes(badLibrary, badObject, f.body));
  });
  test("verified GET is idempotent and never writes", async () => {
    let puts = 0;
    const r = await publishCohort(selection(), io({ put: async () => puts++ }));
    assert.equal(r.ok, true);
    assert.equal(r.verifiedObjects, 1);
    assert.equal(puts, 0);
  });
  test("actual absence writes once then verifies a full GET", async () => {
    let gets = 0,
      puts = 0;
    const r = await publishCohort(
      selection(),
      io({
        get: async () => (++gets === 1 ? null : fixture.body),
        put: async (o, b) => {
          puts++;
          assert.deepEqual(Buffer.from(b), Buffer.from(fixture.body));
          return {
            pathname: o.key,
            url:
              "https://uou7ex3ftuuhas7g.private.blob.vercel-storage.com/" +
              o.key,
          };
        },
      }),
    );
    assert.equal(r.ok, true);
    assert.equal(gets, 2);
    assert.equal(puts, 1);
    assert.equal(r.unknownWrites, 0);
  });
  test("corruption and GET errors are not absence; credentials never appear in result", async () => {
    for (const get of [
      async () => new Uint8Array([1]),
      async () => {
        throw Error("secret-token https://private.invalid/raw");
      },
    ]) {
      let puts = 0;
      const r = await publishCohort(
        selection(),
        io({ get, put: async () => puts++ }),
      );
      assert.equal(r.ok, false);
      assert.equal(puts, 0);
      assert.equal(JSON.stringify(r).includes("secret"), false);
    }
  });
  test("uncertain PUT stops with no automatic retry and requires GET-only reconciliation", async () => {
    let puts = 0;
    const r = await publishCohort(
      selection(),
      io({
        get: async () => null,
        put: async () => {
          puts++;
          throw Error("network");
        },
      }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.unknownWrites, 1);
    assert.equal(puts, 1);
    const missing = await publishCohort(
      selection("reconcile"),
      io({ get: async () => null, put: async () => puts++ }),
    );
    assert.equal(missing.code, "reconcile-missing");
    assert.equal(puts, 1);
    const found = await publishCohort(selection("reconcile"), io());
    assert.equal(found.ok, true);
    assert.equal(puts, 1);
  });
  test("late context or abort prevents write or success after an awaited operation", async () => {
    let live = true,
      puts = 0;
    const r = await publishCohort(
      selection(),
      io({
        checkContext() {
          if (!live) throw Error("private reason");
        },
        get: async () => {
          live = false;
          return null;
        },
        put: async () => puts++,
      }),
    );
    assert.equal(r.ok, false);
    assert.equal(puts, 0);
    const ac = new AbortController();
    const aborted = await publishCohort(
      selection(),
      io({
        signal: ac.signal,
        readLocal: async () => {
          ac.abort();
          return fixture.body;
        },
      }),
    );
    assert.equal(aborted.code, "abort");
  });
  test("manifest selection requires all body evidence before any provider activity", async () => {
    const s = selection(),
      v = JSON.parse(s.inventoryBytes),
      objects = [
        {
          sha256: fixture.manifestSHA256,
          bytes: fixture.manifest.length,
          key: fixture.manifestKey,
        },
      ];
    v.mode = "manifest";
    v.objects = objects;
    v.cohortSHA256 = sha(enc(objects));
    s.inventoryBytes = enc(v);
    s.inventorySHA256 = sha(s.inventoryBytes);
    s.manifestPlan = [];
    s.manifestReceipts = [];
    let calls = 0;
    await assert.rejects(publishCohort(s, io({ get: async () => calls++ })));
    assert.equal(calls, 0);
  });
  test("SDK-facing response reader bounds/truncation/cancellation and never accepts 304", async () => {
    let cancelled = false;
    const ac = new AbortController(),
      response = {
        statusCode: 200,
        stream: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1, 2]));
            c.enqueue(new Uint8Array([3]));
          },
          cancel() {
            cancelled = true;
          },
        }),
      };
    await assert.rejects(
      collectPublicationResponse(response, { bytes: 2 }, ac.signal),
    );
    assert.equal(cancelled, true);
    await assert.rejects(
      collectPublicationResponse(
        { statusCode: 304, stream: null },
        { bytes: 2 },
        ac.signal,
      ),
    );
    const good = await collectPublicationResponse(
      {
        statusCode: 200,
        stream: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1, 2]));
            c.close();
          },
        }),
      },
      { bytes: 2 },
      ac.signal,
    );
    assert.deepEqual([...good], [1, 2]);
  });
  test("closed SDK environment removes protocol/auth overrides and forces retry zero", () => {
    const env = {
      Path: "native",
      SYSTEMROOT: "system",
      VERCEL_BLOB_API_URL: "evil",
      VERCEL_BLOB_API_VERSION_OVERRIDE: "evil",
      NEXT_PUBLIC_VERCEL_BLOB_PROXY_THROUGH_ALTERNATIVE_API: "1",
      BLOB_READ_WRITE_TOKEN: "secret",
      NODE_OPTIONS: "--require bad",
      VERCEL_BLOB_RETRIES: "10",
    };
    isolatePublicationEnvironment(env);
    assert.deepEqual(env, {
      Path: "native",
      SYSTEMROOT: "system",
      VERCEL_BLOB_RETRIES: "0",
    });
    assert.equal(NATIVE_PUBLICATION_PROFILE.nativePilot, "UNPROVEN");
  });
  test("wrong genuine-library manifest binding refuses before provider work", async () => {
    const s = selection(),
      v = JSON.parse(s.inventoryBytes);
    v.manifestSHA256 = "f".repeat(64);
    s.inventoryBytes = enc(v);
    s.inventorySHA256 = sha(s.inventoryBytes);
    let calls = 0;
    await assert.rejects(publishCohort(s, io({ get: async () => calls++ })));
    assert.equal(calls, 0);
  });
  test("cleanup requires the exact full payload inventory and confirms nothing remains", async () => {
    const root = await realpath(await mkdtemp(join(home.home, "payload-")));
    await mkdir(join(root, "publication-input/bodies"), { recursive: true });
    const files = [];
    for (const [path, data] of [
      ["parent.json", fixture.parent],
      ["manifest.json", fixture.manifest],
      ["cohort.json", Buffer.from("{}")],
      ["bodies/" + object.sha256 + ".mp3", fixture.body],
    ]) {
      const name = "publication-input/" + path;
      await writeFile(join(root, name), data, { flag: "wx" });
      files.push({ path: name, sha256: sha(data) });
    }
    await assert.rejects(removePublicationPayload(root, []));
    await assert.rejects(removePublicationPayload(root, files.slice(0, 3)));
    assert.equal(
      (await readdir(join(root, "publication-input/bodies"))).length,
      1,
    );
    await assert.rejects(
      removePublicationPayload(root, [
        ...files.slice(0, 3),
        { ...files[3], sha256: "f".repeat(64) },
      ]),
    );
    assert.equal(await removePublicationPayload(root, files), true);
    assert.deepEqual(await readdir(join(root, "publication-input/bodies")), []);
    assert.deepEqual(await readdir(join(root, "publication-input")), [
      "bodies",
    ]);
  });
  test("unselected native command makes no provider request and cannot be enabled by arguments", async () => {
    let result;
    try {
      await promisify(execFile)(
        process.execPath,
        ["scripts/reference-short-publish-native.mjs", "--upload"],
        {
          cwd: ROOT,
          env: home.env,
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 4096,
        },
      );
    } catch (e) {
      result = e;
    }
    assert.equal(result?.code, 1);
    assert.match(String(result.stderr), /native-selection-unselected/);
  });
}
