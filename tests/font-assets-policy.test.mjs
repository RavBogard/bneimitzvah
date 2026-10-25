import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FONT_ASSETS, matchesAssetPin, reviewedFontAsset } from "../scripts/font-assets.mjs";
import { entryProblems, inspectRepository, repositoryRead } from "../scripts/repo-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

const fontPath = "public/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf";
const licensePath = "public/fonts/noto-serif-hebrew/OFL.txt";
const brandFontPath = "public/fonts/bricolage-grotesque/BricolageGrotesque.ttf";
const brandSubsetPath = "public/fonts/bricolage-grotesque/BricolageGrotesque-latin.woff2";
const brandLicensePath = "public/fonts/bricolage-grotesque/OFL.txt";
const stamFontPath = "public/fonts/stam-ashkenaz-clm/StamAshkenazCLM.ttf";
const stamLicensePath = "public/fonts/stam-ashkenaz-clm/LICENSE.txt";
const stamSourcePath = "public/fonts/stam-ashkenaz-clm/StamAshkenazCLM.sfd";
const familyAssets = family => FONT_ASSETS.filter(asset => asset.family === family);
async function officialPair(family = "noto-serif-hebrew") {
  const result = new Map();
  for (const asset of familyAssets(family)) {
    const bytes = await readFile(new URL(`../${asset.path}`, import.meta.url));
    assert.ok(matchesAssetPin(bytes, asset), "official asset must match its immutable pin"); result.set(asset.path, bytes);
  }
  return result;
}
async function fixture(action) {
  const { env, cleanup } = await isolatedEnv(), root = await mkdtemp(join(tmpdir(), "portal-font-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
  const put = async (path, bytes) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), bytes); };
  try {
    git("init", "-b", "main"); await put("README.md", "Synthetic font-policy repository\n"); git("add", "README.md");
    await action({ root, env, git, put });
  } finally { await rm(root, { recursive: true, force: true }); await cleanup(); }
}

test("font manifest is a fixed immutable pair and byte comparison has no repository override", () => {
  assert.equal(FONT_ASSETS.length, 8);
  assert.deepEqual(FONT_ASSETS.map(asset => [asset.family, asset.kind]), [["noto-serif-hebrew", "font"], ["noto-serif-hebrew", "license"], ["bricolage-grotesque", "font"], ["bricolage-grotesque", "font"], ["bricolage-grotesque", "license"], ["stam-ashkenaz-clm", "font"], ["stam-ashkenaz-clm", "license"], ["stam-ashkenaz-clm", "source"]]);
  assert.equal(reviewedFontAsset("public/fonts/stam-ashkenaz-clm/StamAshkenazCLM.ttf").sha256, "18aec29cd0f3e2f31049224712e740468fc893344289ceb1c86b02b619854ca6");
  assert.equal(reviewedFontAsset("public/fonts/stam-ashkenaz-clm/LICENSE.txt").sha256, "8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643");
  assert.equal(reviewedFontAsset(brandFontPath).sha256, "413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682");
  assert.equal(reviewedFontAsset(brandSubsetPath).sha256, "6a051c984a4fc560ee3045cbf604cd905396ce53cdc3b8ebe08cc11f44315d59");
  assert.equal(reviewedFontAsset(brandSubsetPath).size, 109576);
  assert.equal(reviewedFontAsset(brandLicensePath).sha256, "4b5a7d8f37f5602621c8a8d7358a6a2e71317e6c231c661e15aef0275d3e07ba");
  assert.equal(reviewedFontAsset(fontPath).size, 183600);
  assert.equal(reviewedFontAsset(licensePath).size, 4382);
  assert.equal(reviewedFontAsset(fontPath).sha256, "93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165");
  assert.equal(reviewedFontAsset(licensePath).sha256, "9b9fe028b5ba74d231659a1bbaf0ed09b11e759d1ca6a070999e16d151616b47");
  for (const path of [fontPath.toLowerCase(), fontPath.replaceAll("/", "\\"), `./${fontPath}`, fontPath.replace(".ttf", ".woff2"), "../" + fontPath]) assert.equal(reviewedFontAsset(path), null);
  assert.throws(() => { FONT_ASSETS.push({}); }, TypeError);
  assert.throws(() => { reviewedFontAsset(fontPath).sha256 = "0".repeat(64); }, TypeError);
  // Known SHA-256 vector tests only the pure comparator. These bytes are NOT a
  // substitute for an official-font acceptance test against the real manifest.
  const pin = { size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" };
  assert.equal(matchesAssetPin(Buffer.from("abc"), pin), true);
  assert.equal(matchesAssetPin(Buffer.from("abd"), pin), false);
  assert.equal(matchesAssetPin(Buffer.from("abc\0"), pin), false);
  assert.equal(matchesAssetPin("abc", pin), false);
});

test("font-looking paths cannot gain an extension, empty-file, case or text-payload exemption", () => {
  for (const path of ["font.ttf", "font.OTF", "font.woff", "font.woff2", "font.ttc", "font.eot", fontPath.toLowerCase(), fontPath.replace(".ttf", ".woff2"), `other/${fontPath}`]) {
    assert.ok(entryProblems(path).includes("unlisted font asset"));
    assert.ok(entryProblems(path, "synthetic harmless text").includes("unlisted font asset"));
  }
  assert.ok(entryProblems(fontPath).includes("font asset requires exact byte verification"));
  const sentinel = "vercel_blob_" + "rw_" + "syntheticFontCredential";
  for (const path of [fontPath, licensePath]) assert.ok(entryProblems(path, sentinel).includes("credential pattern"));
});

test("worktree rejects wrong-hash, truncated, empty and non-font bytes with a missing paired notice", async () => {
  await fixture(async ({ root, env, put }) => {
    assert.deepEqual((await inspectRepository(root, env)).findings, [], "no installed assets is allowed");
    for (const bytes of [Buffer.alloc(183600), Buffer.alloc(183599), Buffer.alloc(0), Buffer.from("synthetic non-font payload")]) {
      await put(fontPath, bytes); const result = await inspectRepository(root, env);
      assert.ok(result.findings.includes(`${fontPath}: reviewed font asset integrity mismatch`));
      assert.ok(result.findings.includes(`${licensePath}: required paired font asset missing`));
    }
  });
});

test("a purported font and notice pair both need exact pins; license privacy checks remain active", async () => {
  await fixture(async ({ root, env, put }) => {
    const sentinel = "vercel_blob_" + "rw_" + "uniqueSyntheticFontSentinel";
    await put(fontPath, Buffer.alloc(183600, 1)); await put(licensePath, sentinel);
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${fontPath}: reviewed font asset integrity mismatch`));
    assert.ok(result.findings.includes(`${licensePath}: reviewed font asset integrity mismatch`));
    assert.ok(result.findings.includes(`${licensePath}: credential pattern`));
    assert.ok(!JSON.stringify(result).includes(sentinel));
    await rm(join(root, fontPath));
    assert.ok((await inspectRepository(root, env)).findings.includes(`${fontPath}: required paired font asset missing`));
  });
});

test("indexed font and license failures are not hidden by deletion or replacement in the worktree", async () => {
  await fixture(async ({ root, env, git, put }) => {
    await put(fontPath, Buffer.alloc(183600, 2)); await put(licensePath, "Synthetic incorrect license\n"); git("add", fontPath, licensePath);
    await put(fontPath, "worktree replacement"); await put(licensePath, "worktree notice replacement");
    let result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${fontPath} (index): reviewed font asset integrity mismatch`));
    assert.ok(result.findings.includes(`${licensePath} (index): reviewed font asset integrity mismatch`));
    await rm(join(root, fontPath)); await rm(join(root, licensePath)); result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${fontPath} (index): reviewed font asset integrity mismatch`));
    assert.ok(result.findings.includes(`${licensePath} (index): reviewed font asset integrity mismatch`));
    git("rm", "--cached", licensePath); result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${licensePath} (index): required paired font asset missing`));
  });
});

test("index-only unlisted font and symlink entries are refused before their blobs are opened", async () => {
  await fixture(async ({ root, env, git }) => {
    const absent = "a".repeat(40), unlisted = "public/fonts/renamed.woff2";
    git("update-index", "--add", "--cacheinfo", `100644,${absent},${unlisted}`);
    git("update-index", "--add", "--cacheinfo", `120000,${absent},${fontPath}`);
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${unlisted} (index): unlisted font asset`));
    assert.ok(result.findings.includes(`${fontPath} (index): symlink or non-file requires review`));
  });
});

test("font-license presence is coupled independently in the candidate filesystem and index", async () => {
  await fixture(async ({ root, env, git, put }) => {
    await put(fontPath, Buffer.alloc(183600)); git("add", fontPath);
    await put(licensePath, "Synthetic candidate-only notice\n");
    let result = await inspectRepository(root, env);
    assert.ok(!result.findings.includes(`${licensePath}: required paired font asset missing`));
    assert.ok(result.findings.includes(`${licensePath} (index): required paired font asset missing`));
    git("add", licensePath); await rm(join(root, licensePath)); result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${licensePath}: required paired font asset missing`));
    assert.ok(!result.findings.includes(`${licensePath} (index): required paired font asset missing`));
    assert.ok(result.findings.includes(`${licensePath} (index): reviewed font asset integrity mismatch`));
  });
});

test("file-read failures discard the original error, private path and attached diagnostics", async () => {
  await fixture(async ({ root }) => {
    const sentinel = "synthetic-private-read-target";
    await assert.rejects(repositoryRead(join(root, sentinel)), error => {
      assert.equal(error.message, "Repository policy: file read failed; details withheld");
      assert.equal(error.cause, undefined); assert.equal(error.path, undefined); assert.equal(error.code, undefined);
      assert.ok(!String(error.stack).includes(sentinel)); return true;
    });
  });
});

test("font worktree parent links and directory substitutions cannot be followed as approved assets", async () => {
  await fixture(async ({ root, env, git, put }) => {
    await put(fontPath, "Synthetic staged placeholder"); git("add", fontPath);
    await rm(join(root, "public", "fonts"), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "portal-font-outside-"));
    try {
      await mkdir(join(outside, "noto-serif-hebrew")); await writeFile(join(outside, "noto-serif-hebrew", "NotoSerifHebrew.ttf"), Buffer.alloc(183600));
      await symlink(outside, join(root, "public", "fonts"), process.platform === "win32" ? "junction" : "dir");
      assert.ok((await inspectRepository(root, env)).findings.includes(`${fontPath}: symlink or non-file requires review`));
      await rm(join(root, "public", "fonts")); await mkdir(join(root, fontPath), { recursive: true });
      assert.ok((await inspectRepository(root, env)).findings.includes(`${fontPath}: symlink or non-file requires review`));
    } finally { await rm(join(root, "public", "fonts"), { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
});

test("official unchanged font and full notice pass the whole policy in candidates and index", async () => {
  const pair = await officialPair();
  await fixture(async ({ root, env, git, put }) => {
    for (const [path, bytes] of pair) await put(path, bytes);
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    git("add", fontPath, licensePath);
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    for (const asset of familyAssets("noto-serif-hebrew")) assert.ok(matchesAssetPin(git("show", `:${asset.path}`), asset), "indexed bytes must retain the official pin");
  });
});

test("real official pair keeps staged tampering and candidate tampering independent", async () => {
  const pair = await officialPair();
  await fixture(async ({ root, env, git, put }) => {
    for (const [path, bytes] of pair) await put(path, bytes); git("add", fontPath, licensePath);
    for (const path of [fontPath, licensePath]) {
      const altered = Buffer.from(pair.get(path)); altered[0] ^= 1;
      await put(path, altered); git("add", path); await put(path, pair.get(path));
      let result = await inspectRepository(root, env);
      assert.ok(result.findings.includes(`${path} (index): reviewed font asset integrity mismatch`));
      assert.ok(!result.findings.includes(`${path}: reviewed font asset integrity mismatch`));
      git("add", path); await put(path, altered); result = await inspectRepository(root, env);
      assert.ok(result.findings.includes(`${path}: reviewed font asset integrity mismatch`));
      assert.ok(!result.findings.includes(`${path} (index): reviewed font asset integrity mismatch`));
      await put(path, pair.get(path)); assert.deepEqual((await inspectRepository(root, env)).findings, []);
    }
    git("rm", "--cached", licensePath); let result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${licensePath} (index): required paired font asset missing`));
    assert.ok(!result.findings.includes(`${licensePath}: required paired font asset missing`));
    git("add", licensePath); await rm(join(root, licensePath)); result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${licensePath}: required paired font asset missing`));
    assert.ok(!result.findings.includes(`${licensePath} (index): required paired font asset missing`));
  });
});

test("exact-path byte attributes preserve real font and OFL through autocrlf checkout", async () => {
  const pair = await officialPair(), attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
  const rules = attributes.split(/\r?\n/).filter(line => line && !line.startsWith("#"));
  assert.deepEqual(rules, [
    `/${fontPath} -text`, `/${licensePath} -text`, `/${brandFontPath} -text`, `/${brandSubsetPath} -text`, `/${brandLicensePath} -text`, `/${stamFontPath} -text`, `/${stamLicensePath} -text`, `/${stamSourcePath} -text`,
    "/src/server/db/migrations/** text eol=lf",
    "/scripts/db-migrate.mjs text eol=lf",
    "/scripts/release-migrate*.mjs text eol=lf",
    "/tests/fixtures/portal/release-*-reference.json text eol=lf",
    "/tests/release-*.test.mjs text eol=lf",
    "/tests/helpers/release-*-fixture.mjs text eol=lf",
    "/tests/postgres/release-*.acceptance.mjs text eol=lf",
  ]);
  await fixture(async ({ root, env, git, put }) => {
    git("config", "core.autocrlf", "true"); await put(".gitattributes", attributes);
    for (const [path, bytes] of pair) await put(path, bytes); git("add", ".gitattributes", fontPath, licensePath);
    const declared = git("check-attr", "text", "--", fontPath, licensePath).toString("utf8");
    for (const path of pair.keys()) assert.ok(declared.includes(`${path}: text: unset`));
    for (const path of pair.keys()) await rm(join(root, path));
    git("checkout-index", "--force", "--", fontPath, licensePath);
    for (const asset of familyAssets("noto-serif-hebrew")) {
      assert.ok(matchesAssetPin(await readFile(join(root, asset.path)), asset), "checked-out bytes must match the original official pin");
      assert.ok(matchesAssetPin(git("show", `:${asset.path}`), asset), "indexed bytes must match the original official pin");
    }
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
  });
});

test("official font bytes cannot be accepted at an unlisted renamed path", async () => {
  const pair = await officialPair();
  await fixture(async ({ root, env, put }) => {
    const renamed = "public/fonts/noto-serif-hebrew/Renamed.ttf";
    await put(renamed, pair.get(fontPath)); await put(licensePath, pair.get(licensePath));
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${renamed}: unlisted font asset`));
    assert.ok(result.findings.includes(`${fontPath}: required paired font asset missing`));
  });
});

test("each reviewed font family pairs with its own notice and never borrows another family's", async () => {
  const brand = await officialPair("bricolage-grotesque"), hebrew = await officialPair();
  await fixture(async ({ root, env, git, put }) => {
    for (const [path, bytes] of brand) await put(path, bytes);
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    git("add", brandFontPath, brandSubsetPath, brandLicensePath);
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    await rm(join(root, brandLicensePath)); git("rm", "--cached", "--quiet", brandLicensePath);
    await put(licensePath, hebrew.get(licensePath));
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${brandLicensePath}: required paired font asset missing`));
    assert.ok(result.findings.includes(`${brandLicensePath} (index): required paired font asset missing`));
    assert.ok(result.findings.includes(`${fontPath}: required paired font asset missing`));
  });
});

test("exact-path byte attributes also preserve the Bricolage pair through autocrlf checkout", async () => {
  const pair = await officialPair("bricolage-grotesque"), attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
  await fixture(async ({ root, env, git, put }) => {
    git("config", "core.autocrlf", "true"); await put(".gitattributes", attributes);
    for (const [path, bytes] of pair) await put(path, bytes); git("add", ".gitattributes", brandFontPath, brandSubsetPath, brandLicensePath);
    for (const path of pair.keys()) await rm(join(root, path));
    git("checkout-index", "--force", "--", brandFontPath, brandSubsetPath, brandLicensePath);
    for (const asset of familyAssets("bricolage-grotesque")) {
      assert.ok(matchesAssetPin(await readFile(join(root, asset.path)), asset), "checked-out bytes must match the original official pin");
      assert.ok(matchesAssetPin(git("show", `:${asset.path}`), asset), "indexed bytes must match the original official pin");
    }
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
  });
});

test("the Stam Ashkenaz CLM pair passes the whole policy alone and survives autocrlf checkout byte for byte", async () => {
  const pair = await officialPair("stam-ashkenaz-clm"), attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
  await fixture(async ({ root, env, git, put }) => {
    git("config", "core.autocrlf", "true"); await put(".gitattributes", attributes);
    for (const [path, bytes] of pair) await put(path, bytes);
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    git("add", ".gitattributes", stamFontPath, stamLicensePath, stamSourcePath);
    for (const path of pair.keys()) await rm(join(root, path));
    git("checkout-index", "--force", "--", stamFontPath, stamLicensePath, stamSourcePath);
    for (const asset of familyAssets("stam-ashkenaz-clm")) {
      assert.ok(matchesAssetPin(await readFile(join(root, asset.path)), asset), "checked-out bytes must match the original official pin");
      assert.ok(matchesAssetPin(git("show", `:${asset.path}`), asset), "indexed bytes must match the original official pin");
    }
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    await rm(join(root, stamLicensePath)); git("rm", "--cached", "--quiet", stamLicensePath);
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${stamLicensePath}: required paired font asset missing`));
    assert.ok(result.findings.includes(`${stamLicensePath} (index): required paired font asset missing`));
  });
});

test("the pinned Stam Ashkenaz source is accepted only byte for byte, and is required beside its font", async () => {
  const pair = await officialPair("stam-ashkenaz-clm");
  assert.equal(reviewedFontAsset(stamSourcePath).sha256, "ff23748b1b9df2bb1f5e26b8928342eee87ead160bdff535a505aed0f7294c45");
  // Unpinned, the same upstream text is refused like any file carrying an author address.
  assert.ok(entryProblems("public/fonts/stam-ashkenaz-clm/Other.sfd", pair.get(stamSourcePath).toString("utf8")).includes("non-synthetic email address"));
  await fixture(async ({ root, env, put }) => {
    for (const [path, bytes] of pair) await put(path, bytes);
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    const altered = Buffer.from(pair.get(stamSourcePath)); altered[0] ^= 1; await put(stamSourcePath, altered);
    let result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${stamSourcePath}: reviewed font asset integrity mismatch`));
    assert.ok(result.findings.includes(`${stamSourcePath}: non-synthetic email address`), "an unverified source loses the exception");
    await rm(join(root, stamSourcePath)); result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${stamSourcePath}: required paired font asset missing`));
  });
});
