import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPendingInvitations } from "../../src/server/http/pending-invitations";
import { HttpBoundaryError, errorResponse } from "../../src/server/http/responses";

const origin = "http://localhost:3000";
function fixture(selectedOrigin = origin, environment: "local" | "preview" | "production" = "local") {
  let time = 1800000000000;
  const input = { secret: randomBytes(48).toString("base64url"), origin: selectedOrigin, environment, now: () => time };
  const pending = createPendingInvitations(input);
  const token = randomBytes(32).toString("base64url");
  const landing = new URL("/invitations/accept", selectedOrigin); landing.searchParams.set("token", token);
  const issue = () => pending.exchange(new Request(landing));
  const cookie = () => issue().headers.getSetCookie()[0].split(";")[0];
  const read = (cookieValue: string, url = `${selectedOrigin}/api/invitations/pending`, headers: Record<string, string> = {}) => pending.read(new Request(url, { headers: { cookie: cookieValue, ...headers } }));
  return { input, pending, token, landing, issue, cookie, read, advance: (delta: number) => { time += delta; } };
}
async function denied(action: () => unknown) {
  try { action(); return false; }
  catch (error) { return error instanceof HttpBoundaryError && error.status === 404 && error.message === "Request rejected" && !("cause" in error); }
}

test("landing GET seals a confidential randomized pending cookie and clean redirect without identity/grant work", async () => {
  const f = fixture();
  const response = f.issue();
  const setCookie = response.headers.getSetCookie()[0];
  const cookie = setCookie.split(";")[0];
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/invitations/accept");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect((await response.text()).includes(f.token)).toBe(false);
  expect(setCookie.includes(f.token) || setCookie.includes(f.input.secret) || setCookie.includes("expiresAt")).toBe(false);
  expect(setCookie.startsWith("portal_pending_invitation=v1.")).toBe(true);
  expect(setCookie.includes("Path=/; HttpOnly; SameSite=Lax; Max-Age=600")).toBe(true);
  expect(setCookie.includes("Secure") || setCookie.includes("Domain=")).toBe(false);
  expect(f.read(cookie) === f.token).toBe(true);
  expect(f.cookie() !== cookie).toBe(true);
  expect(f.pending.clear()).toBe("portal_pending_invitation=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
});

test("deployed cookies use host-only secure prefix and cannot cross origin, environment or secret", async () => {
  const f = fixture("https://bneimitzvah.centralreform.org", "production");
  const cookie = f.cookie();
  const header = f.issue().headers.getSetCookie()[0];
  expect(header.startsWith("__Host-portal_pending_invitation=") && header.endsWith("; Secure") && !header.includes("Domain=")).toBe(true);
  expect(f.read(cookie) === f.token).toBe(true);
  expect(f.pending.clear().endsWith("; Secure")).toBe(true);
  const preview = createPendingInvitations({ ...f.input, origin: "https://synthetic-preview.example.test", environment: "preview" });
  expect(await denied(() => preview.read(new Request("https://synthetic-preview.example.test/api/invitations/pending", { headers: { cookie } })))).toBe(true);
  const differentSecret = createPendingInvitations({ ...f.input, secret: randomBytes(48).toString("base64url") });
  expect(await denied(() => differentSecret.read(new Request("https://bneimitzvah.centralreform.org/api/invitations/pending", { headers: { cookie } })))).toBe(true);
  expect(await denied(() => f.read(cookie, "https://foreign.example.test/api/invitations/pending"))).toBe(true);
});

test("pending cookie expiry/future clock, ciphertext tamper and oversized/duplicate cookie names deny without diagnostics", async () => {
  const f = fixture(); const cookie = f.cookie();
  f.advance(599999); expect(f.read(cookie) === f.token).toBe(true);
  f.advance(1); expect(await denied(() => f.read(cookie))).toBe(true);
  f.advance(-600001); expect(await denied(() => f.read(cookie))).toBe(true);
  f.advance(1);
  const equal = cookie.indexOf("="); const name = cookie.slice(0, equal);
  const packed = Buffer.from(cookie.slice(equal + 4), "base64url"); packed[15] ^= 1;
  const tampered = `${name}=v1.${packed.toString("base64url")}`;
  for (const invalid of [tampered, `${cookie}; ${cookie}`, `${name}=; ${cookie}`, `${cookie}; __Host-portal_pending_invitation=x`, `${cookie}; unrelated=a; unrelated=b`,
    `${name}=v1.${"a".repeat(3000)}`, `${name}=v1.invalid!`, `${name}=v1.A`, `${cookie}; ${"a".repeat(17000)}=x`, "unrelated=x"]) {
    expect(await denied(() => f.read(invalid))).toBe(true);
  }
  let response: Response | undefined;
  try { f.read(tampered); } catch (error) { response = errorResponse(error); }
  expect(response?.status).toBe(404);
  const text = await response!.text();
  expect(text.includes(f.token) || text.includes(tampered) || text.includes(f.input.secret)).toBe(false);
});

test("invitation token exists only on exact landing GET; URL practice contexts, duplicate token and unsupported read paths deny", async () => {
  const f = fixture();
  for (const request of [new Request(f.landing, { method: "POST" }), new Request(f.landing.href + "&token=duplicate"), new Request(f.landing.href + "&handle=opaque"),
    new Request(f.landing.href + "&context=opaque"), new Request(f.landing.href + "#fragment"), new Request(f.landing, { headers: { "X-Practice-Context": "" } }),
    new Request(f.landing, { headers: { host: "foreign.example.test" } }), new Request(f.landing.href.replace("/invitations/accept", "/invitations/%61ccept")),
    new Request(f.landing.href.replace(f.token, "A".repeat(42))), new Request(f.landing.href.replace(f.token, "A".repeat(42) + "B"))]) {
    expect(await denied(() => f.pending.exchange(request))).toBe(true);
  }
  const cookie = f.cookie();
  for (const path of ["/api/invitations/pending?token=opaque", "/api/invitations/pending?handle=opaque", "/api/invitations/accept", "/api/students", "/invitations/accept"]) {
    expect(await denied(() => f.read(cookie, origin + path))).toBe(true);
  }
  expect(await denied(() => f.read(cookie, origin + "/api/invitations/pending", { "X-Practice-Context": "opaque" }))).toBe(true);
  expect(f.pending.read(new Request(origin + "/api/invitations/accept", { method: "POST", headers: { cookie } })) === f.token).toBe(true);
});

test("pending primitives reject bad configured origins and keep their captured configuration stable", async () => {
  const f = fixture();
  for (const change of [{ origin: "https://bneimitzvah.vercel.app", environment: "production" }, { origin: "http://localhost:3000", environment: "preview" },
    { origin: "https://bneimitzvah.centralreform.org", environment: "preview" }, { secret: "short" }, { origin: origin + "/" }]) {
    let safe = false;
    try { createPendingInvitations({ ...f.input, ...change } as typeof f.input); }
    catch (error) { safe = error instanceof Error && error.message === "Pending invitation configuration unavailable" && !("cause" in error); }
    expect(safe).toBe(true);
  }
  f.input.origin = "http://localhost:3100";
  const cookie = f.cookie();
  expect(f.read(cookie) === f.token).toBe(true);
});
