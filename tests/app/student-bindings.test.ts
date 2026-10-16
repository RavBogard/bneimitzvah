import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { createBindings } from "../../src/server/students/bindings";
import { AccessDenied } from "../../src/server/access/errors";

test("student review bindings encrypt private claims with randomized authenticated purpose-bound envelopes", () => {
  const secret = randomBytes(48).toString("base64url"), now = 1_800_000_000_000;
  const bindings = createBindings(secret, () => now);
  const claims = { purpose: "student-reading", actor: { userId: "PRIVATE_USER_SENTINEL", authSessionId: "PRIVATE_SESSION_SENTINEL" }, ref: "Genesis 1:1" };
  const first = bindings.sign(claims), second = bindings.sign(claims);
  expect(first !== second && /^v1\.[A-Za-z0-9_-]+$/.test(first)).toBe(true);
  const raw = Buffer.from(first.slice(3), "base64url").toString("utf8");
  expect(!raw.includes(claims.actor.userId) && !raw.includes(claims.actor.authSessionId) && !raw.includes(claims.ref)).toBe(true);
  const opened = bindings.verify(first, "student-reading");
  expect(JSON.stringify(opened.actor) === JSON.stringify(claims.actor) && opened.expiresAt === now + 300_000).toBe(true);
  function denied(action: () => unknown) { try { action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === 403 && !("cause" in error); } }
  expect(denied(() => bindings.verify(first, "student-import"))).toBe(true);
  expect(denied(() => createBindings(randomBytes(48).toString("base64url"), () => now).verify(first, "student-reading"))).toBe(true);
  const packed = Buffer.from(first.slice(3), "base64url"); packed[15] ^= 1;
  expect(denied(() => bindings.verify(`v1.${packed.toString("base64url")}`, "student-reading"))).toBe(true);
  expect(denied(() => bindings.verify(`${first}=`, "student-reading"))).toBe(true);
  expect(denied(() => bindings.verify(`${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${"0".repeat(64)}`, "student-reading"))).toBe(true);
  expect(denied(() => createBindings(secret, () => now + 300_000).verify(first, "student-reading"))).toBe(true);
  expect(denied(() => bindings.sign({ purpose: "student-import", huge: "x".repeat(32000) }))).toBe(true);
});
