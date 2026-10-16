import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, link, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { ownerAdminDigest, readOwnerAdminFile, writeOwnerAdminReview, OwnerAdminError, type OwnerAdminReview } from "../../scripts/manage-admin.mjs";

const folders: string[] = [];
afterEach(async () => { for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true }); });
async function folder() { const path = await mkdtemp(join(tmpdir(), "owner-admin-files-")); folders.push(path); return path; }
function prepared() {
  const timestamp = "2026-10-16T00:00:00.000000Z";
  const review: OwnerAdminReview = { version: 1, selection: { operation: "grant", tenantId: "crc", bootstrapId: "00000000-0000-4000-8000-000000000001",
    ownerUserId: "synthetic-owner", targetUserId: "synthetic-target", targetGrantId: null },
    snapshot: { owner: { user: { id: "synthetic-owner", verified: true, updatedAt: timestamp },
      membership: { id: "00000000-0000-4000-8000-000000000002", authorityRevision: 1, disabledAt: null },
      grant: { id: "00000000-0000-4000-8000-000000000003", revision: 1, createdAt: timestamp, revokedAt: null } },
    target: { user: { id: "synthetic-target", verified: true, updatedAt: timestamp }, membership: null, grants: [] } },
    preparedAt: 1_700_000_000_000, expiresAt: 1_700_000_600_000 };
  return { review, digest: ownerAdminDigest(review) };
}
async function denied(action: () => Promise<unknown>) {
  try { await action(); return false; } catch (error) { return error instanceof OwnerAdminError && error.message === "Owner admin operation failed" && !("cause" in error); }
}
test("private review creation is exclusive and bounded reads preserve canonical descriptor/digest", async () => {
  const path = join(await folder(), "review.json"), review = prepared();
  await writeOwnerAdminReview(path, review);
  expect(await readOwnerAdminFile(path)).toEqual(review);
  const original = await readFile(path, "utf8");
  expect(await denied(() => writeOwnerAdminReview(path, review))).toBe(true);
  expect(await readFile(path, "utf8")).toBe(original);
});
test("checkout output, symbolic/junction ancestors, final symlinks and hardlinked inputs deny", async () => {
  expect(await denied(() => writeOwnerAdminReview(resolve(".local-logs", "forbidden-owner-review.json"), prepared()))).toBe(true);
  const dotted = resolve("..review.json");
  expect(await denied(() => readOwnerAdminFile(dotted))).toBe(true);
  let wroteDotted = false;
  try {
    const refused = await denied(async () => { await writeOwnerAdminReview(dotted, prepared()); wroteDotted = true; });
    expect(refused).toBe(true);
  } finally { if (wroteDotted) await unlink(dotted); } // Only our exclusively created synthetic file.
  const root = await folder(), actual = join(root, "actual"); await mkdir(actual);
  const junction = join(root, "junction"); await symlink(actual, junction, "junction");
  expect(await denied(() => writeOwnerAdminReview(join(junction, "review.json"), prepared()))).toBe(true);
  const file = join(actual, "review.json"); await writeOwnerAdminReview(file, prepared());
  const hardlink = join(root, "hardlink.json"); await link(file, hardlink);
  expect(await denied(() => readOwnerAdminFile(hardlink))).toBe(true);
  const directoryLink = join(root, "checkout"); await symlink(resolve("."), directoryLink, "junction");
  expect(await denied(() => writeOwnerAdminReview(join(directoryLink, ".local-logs", "forbidden-owner-review.json"), prepared()))).toBe(true);
});
test("oversized, malformed Unicode, invalid JSON and nonregular input files deny with fixed diagnostics", async () => {
  const root = await folder();
  for (const [name, data] of [["large", Buffer.alloc(16 * 1024 + 1, 65)], ["utf8", Buffer.from([0xff])], ["json", Buffer.from("{")]] as const) {
    const path = join(root, name); await writeFile(path, data); expect(await denied(() => readOwnerAdminFile(path))).toBe(true);
  }
  expect(await denied(() => readOwnerAdminFile(root))).toBe(true);
  expect(await denied(() => readOwnerAdminFile(join(root, "absent")))).toBe(true);
});
test("CLI imports do nothing and isolated failures never print identities, connection values or driver causes", async () => {
  const isolated = await isolatedEnv();
  try {
    const imported = spawnSync(process.execPath, ["-e", "import('./scripts/manage-admin.mjs')"], { env: isolated.env, encoding: "utf8" });
    expect(imported.status === 0 && imported.stdout === "" && imported.stderr === "").toBe(true);
    const input = join(isolated.home, "input.json"); await writeFile(input, JSON.stringify(prepared().review.selection));
    for (const args of [[], ["prepare", "--input", input, "--review", join(isolated.home, "review.json")], ["apply", "--review", input, "--confirm-digest", "invalid"]]) {
      const result = spawnSync(process.execPath, ["scripts/manage-admin.mjs", ...args], { env: isolated.env, encoding: "utf8" });
      expect(result.status === 1 && result.stdout === "" && result.stderr.trim() === "Owner admin operation failed; verify private operator configuration and review").toBe(true);
    }
  } finally { await isolated.cleanup(); }
});

test.skipIf(process.platform === "win32")("POSIX FIFO input is refused before open can block", async () => {
  const isolated = await isolatedEnv();
  try {
    const fifo = join(isolated.home, "input-fifo");
    const result = spawnSync("mkfifo", [fifo], { env: isolated.env, encoding: "utf8" });
    expect(result.status === 0).toBe(true);
    expect(await denied(() => readOwnerAdminFile(fifo))).toBe(true);
  } finally { await isolated.cleanup(); }
});
