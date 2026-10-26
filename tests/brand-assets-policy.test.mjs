import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BRAND_IMAGE_MAX_SIDE, FONT_ASSETS, brandImageProblem, imagePixelSizes, matchesAssetPin, reviewedFontAsset } from "../scripts/font-assets.mjs";
import { inspectRepository } from "../scripts/repo-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

// The CRC Torah logo (Siona Benjamin's floor mural at CRC), admitted through the same exact-byte registry as the fonts.
const notice = "public/brand/PROVENANCE.md";
const images = ["mural-64.webp", "mural-128.webp", "mural-512.png", "icon-192.png", "icon-512.png", "maskable-512.png", "apple-180.png", "favicon-48.png", "favicon.ico"].map(name => `public/brand/${name}`);
const brand = () => FONT_ASSETS.filter(asset => asset.family === "brand-mural");
async function officialBrand() {
  const result = new Map();
  for (const asset of brand()) {
    const bytes = await readFile(new URL(`../${asset.path}`, import.meta.url));
    assert.ok(matchesAssetPin(bytes, asset), `${asset.path} must match its immutable pin`); result.set(asset.path, bytes);
  }
  return result;
}
async function fixture(action) {
  const { env, cleanup } = await isolatedEnv(), root = await mkdtemp(join(tmpdir(), "portal-brand-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
  const put = async (path, bytes) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), bytes); };
  try {
    git("init", "-b", "main"); await put("README.md", "Synthetic brand-policy repository\n"); git("add", "README.md");
    await action({ root, env, git, put });
  } finally { await rm(root, { recursive: true, force: true }); await cleanup(); }
}

// Synthetic headers only: enough bytes for the dimension reader, not real images.
function png(width, height) {
  const bytes = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12, "latin1"); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}
function webp(chunk, width, height) {
  const bytes = Buffer.alloc(40); bytes.write("RIFF", 0, "latin1"); bytes.writeUInt32LE(32, 4); bytes.write("WEBP", 8, "latin1"); bytes.write(chunk, 12, "latin1");
  if (chunk === "VP8X") { bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3); }
  if (chunk === "VP8L") { bytes[20] = 0x2f; bytes.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21); }
  if (chunk === "VP8 ") { bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a; bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28); }
  return bytes;
}
function ico(entryWidth, payload) {
  const head = Buffer.alloc(22); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head[6] = entryWidth; head[7] = entryWidth; head.writeUInt32LE(payload.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, payload]);
}

test("the brand registry pins exactly the nine reviewed images and their notice, immutably and by exact path", () => {
  assert.deepEqual(brand().map(asset => asset.path), [...images, notice]);
  assert.deepEqual(brand().map(asset => asset.kind), [...images.map(() => "image"), "license"]);
  assert.equal(reviewedFontAsset("public/brand/mural-512.png").sha256, "c08a20644f9516806b876e959b881c83476dea1eaa195f140a85319846142735");
  assert.equal(reviewedFontAsset("public/brand/mural-512.png").size, 169331);
  assert.equal(reviewedFontAsset("public/brand/favicon.ico").sha256, "e22679cbb4bb9123aeb9eb9249c80f84a2a521a5fb3f4c53f7a83f4917c32f7b");
  for (const path of ["public/brand/MURAL-512.png", "public\\brand\\mural-512.png", "./public/brand/mural-512.png", "public/brand/mural-512.webp", "public/mural-512.png", "public/brand/mural-1024.png"]) assert.equal(reviewedFontAsset(path), null);
  assert.throws(() => { reviewedFontAsset("public/brand/icon-512.png").size = 1; }, TypeError);
});

test("the nine committed images match their pins, and each header declares no side larger than 512 px", async () => {
  const official = await officialBrand();
  for (const path of images) {
    assert.equal(brandImageProblem(path, official.get(path)), undefined, path);
    assert.ok(imagePixelSizes(path, official.get(path)).every(({ width, height }) => width <= BRAND_IMAGE_MAX_SIDE && height <= BRAND_IMAGE_MAX_SIDE));
  }
  assert.deepEqual(imagePixelSizes("public/brand/mural-512.png", official.get("public/brand/mural-512.png")), [{ width: 512, height: 512 }]);
  assert.deepEqual(imagePixelSizes("public/brand/mural-64.webp", official.get("public/brand/mural-64.webp")), [{ width: 64, height: 64 }]);
});

test("the size guard reads PNG, WebP and ICO headers and refuses anything over 512 px or unreadable", () => {
  assert.equal(BRAND_IMAGE_MAX_SIDE, 512);
  const larger = "reviewed brand image larger than 512 px", unreadable = "reviewed brand image dimensions unreadable";
  assert.equal(brandImageProblem("a.png", png(512, 512)), undefined);
  assert.equal(brandImageProblem("a.png", png(513, 512)), larger);
  assert.equal(brandImageProblem("a.png", png(512, 1335)), larger);
  for (const chunk of ["VP8X", "VP8L", "VP8 "]) {
    assert.equal(brandImageProblem("a.webp", webp(chunk, 128, 512)), undefined, chunk);
    assert.equal(brandImageProblem("a.webp", webp(chunk, 1024, 128)), larger, chunk);
  }
  assert.equal(brandImageProblem("a.ico", ico(48, png(48, 48))), undefined);
  assert.equal(brandImageProblem("a.ico", ico(0, png(1335, 1335))), larger, "an ICO directory entry cannot hide a larger embedded PNG");
  for (const [path, bytes] of [["a.png", png(0, 64)], ["a.png", Buffer.from("not an image")], ["a.webp", png(64, 64)], ["a.ico", png(64, 64)], ["a.gif", png(64, 64)], ["a.png", "text"]]) assert.equal(brandImageProblem(path, bytes), unreadable);
});

test("the nine images and their notice pass the whole policy in candidates and index, and survive autocrlf checkout byte for byte", async () => {
  const official = await officialBrand(), attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
  await fixture(async ({ root, env, git, put }) => {
    git("config", "core.autocrlf", "true"); await put(".gitattributes", attributes);
    for (const [path, bytes] of official) await put(path, bytes);
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    git("add", ".gitattributes", ...official.keys());
    for (const path of official.keys()) await rm(join(root, path));
    git("checkout-index", "--force", "--", ...official.keys());
    for (const asset of brand()) {
      assert.ok(matchesAssetPin(await readFile(join(root, asset.path)), asset), "checked-out bytes must match the pin");
      assert.ok(matchesAssetPin(git("show", `:${asset.path}`), asset), "indexed bytes must match the pin");
    }
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
  });
});

test("a tenth unlisted image under public/brand is refused in the worktree and in the index", async () => {
  const official = await officialBrand();
  await fixture(async ({ root, env, git, put }) => {
    for (const [path, bytes] of official) await put(path, bytes);
    const tenth = "public/brand/mural-1024.png";
    await put(tenth, png(1024, 1024));
    let result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${tenth}: unreviewed binary content`));
    assert.equal(result.findings.length, 1);
    git("add", tenth); await rm(join(root, tenth)); result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${tenth} (index): unreviewed binary content`));
  });
});

test("one flipped byte or extra bytes in a listed image is refused, and a staged change is not hidden by a clean worktree", async () => {
  const official = await officialBrand();
  await fixture(async ({ root, env, git, put }) => {
    for (const [path, bytes] of official) await put(path, bytes);
    for (const path of [...images, notice]) {
      const flipped = Buffer.from(official.get(path)); flipped[Math.floor(flipped.length / 2)] ^= 1;
      for (const altered of [flipped, Buffer.concat([official.get(path), Buffer.from([0])])]) {
        await put(path, altered);
        assert.ok((await inspectRepository(root, env)).findings.includes(`${path}: reviewed brand asset integrity mismatch`), path);
      }
      await put(path, official.get(path));
    }
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    const path = "public/brand/icon-512.png", flipped = Buffer.from(official.get(path)); flipped[100] ^= 1;
    git("add", ...official.keys()); await put(path, flipped); git("add", path); await put(path, official.get(path));
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${path} (index): reviewed brand asset integrity mismatch`));
    assert.ok(!result.findings.includes(`${path}: reviewed brand asset integrity mismatch`));
  });
});

test("listed image bytes at another path are refused, and a listed path holding a larger image is refused", async () => {
  const official = await officialBrand();
  await fixture(async ({ root, env, put }) => {
    for (const [path, bytes] of official) await put(path, bytes);
    for (const copy of ["public/brand/logo.png", "public/icon-512.png", "public/brand/icon-512-copy.png","public/brand/icon-512.png.bak"]) {
      await put(copy, official.get("public/brand/icon-512.png"));
      assert.ok((await inspectRepository(root, env)).findings.includes(`${copy}: unreviewed binary content`), copy);
      await rm(join(root, copy));
    }
    const larger = png(1335, 1335); await put("public/brand/mural-512.png", larger);
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes("public/brand/mural-512.png: reviewed brand asset integrity mismatch"));
  });
});

test("the brand images never ship without their notice, and a listed path cannot be an index symlink", async () => {
  const official = await officialBrand();
  await fixture(async ({ root, env, git, put }) => {
    for (const [path, bytes] of official) await put(path, bytes);
    git("add", ...official.keys()); await rm(join(root, notice)); git("rm", "--cached", "--quiet", notice);
    let result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${notice}: required paired brand asset missing`));
    assert.ok(result.findings.includes(`${notice} (index): required paired brand asset missing`));
    git("update-index", "--add", "--cacheinfo", `120000,${"a".repeat(40)},${notice}`);
    result = await inspectRepository(root, env);
    assert.ok(result.findings.includes(`${notice} (index): symlink or non-file requires review`));
  });
});
