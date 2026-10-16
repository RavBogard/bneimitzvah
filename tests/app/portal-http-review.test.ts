import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { authFixture } from "./auth-stack-helper";
import { accessFixture } from "./access-fixture";
import { createInvitationService } from "../../src/server/invitations/service";
import { createPendingInvitations } from "../../src/server/http/pending-invitations";
import { appendSdkCookies, errorResponse, privateJson } from "../../src/server/http/responses";
import { createPortalService } from "../../src/server/portal/service";
import { createPracticeService } from "../../src/server/practice/service";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";

const origin = "http://localhost:3000";
test("review: actual SDK magic-link and logout cookies project without relaying SDK bodies or locations", async () => {
  const f = await authFixture();
  try {
    const signedIn = await f.signIn("review-cookie@example.test");
    const output = privateJson({ ok: true });
    appendSdkCookies(output.headers, signedIn.response.headers, origin);
    expect(output.headers.getSetCookie().length > 0).toBe(true);
    expect(output.headers.getSetCookie().every((value, index) => value === signedIn.response.headers.getSetCookie()[index])).toBe(true);
    expect(output.headers.get("location")).toBeNull();
    expect(await output.json()).toEqual({ ok: true });
    const logout = await f.request("/sign-out", {}, signedIn.cookie);
    expect(logout.status).toBe(200);
    const cleared = privateJson({ ok: true });
    appendSdkCookies(cleared.headers, logout.headers, origin);
    expect(cleared.headers.getSetCookie().some(value => value.startsWith("better-auth.session_token=;") && value.includes("Max-Age=0"))).toBe(true);
    expect(await f.auth.api.getSession({ headers: new Headers({ cookie: signedIn.cookie }), query: { disableRefresh: true, disableCookieCache: true } }) === null).toBe(true);
  } finally { await f.client.close(); }
});

test("review: replacement encrypted cookie cannot redirect a reviewed sibling acceptance or consume either invite", async () => {
  const f = await accessFixture();
  try {
    const transport: { url: string }[] = [];
    const invitations = createInvitationService({ db: f.db, access: f.service, throttleSecret: randomBytes(48).toString("base64url"),
      transport: async message => { transport.push({ url: message.url }); } });
    const pending = createPendingInvitations({ origin, environment: "local", secret: randomBytes(48).toString("base64url") });
    const request = (method: "GET" | "POST", cookie: string) => new Request(`${origin}/api/invitations/${method === "GET" ? "pending" : "accept"}`, {
      method, headers: { origin, cookie },
    });
    const admin = { ...f.request("admin"), method: "POST" as const };
    admin.headers.set("origin", origin);
    const cookies: string[] = [];
    for (const child of f.students.slice(0, 2)) {
      await invitations.issue(admin, { mode: "admin", role: "parent", studentId: child.id, email: "multi@example.test" });
      cookies.push(pending.exchange(new Request(transport.at(-1)!.url)).headers.getSetCookie()[0].split(";")[0]);
    }
    const authCookie = f.identities.multi.cookie;
    const first = request("GET", `${authCookie}; ${cookies[0]}`);
    const reviewed = await invitations.preview(first, { token: pending.read(first) });
    const replaced = request("POST", `${authCookie}; ${cookies[1]}`);
    let denied = false;
    try { await invitations.acceptReviewed(replaced, { token: pending.read(replaced), reviewBinding: reviewed.reviewBinding }); }
    catch (error) { denied = error instanceof AccessDenied && error.status === 404; }
    expect(denied).toBe(true);
    await f.owner(async () => {
      const rows = await f.db.select().from(s.invite);
      expect(rows.length === 2 && rows.every(row => row.acceptedAt === null)).toBe(true);
      expect((await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "invite.accept"))).length).toBe(0);
    });
    const restored = request("POST", `${authCookie}; ${cookies[0]}`);
    const accepted = await invitations.acceptReviewed(restored, { token: pending.read(restored), reviewBinding: reviewed.reviewBinding });
    expect(accepted.studentId === f.students[0].id).toBe(true);
    // Pending encryption is a carrier, never evidence that an already consumed token is usable.
    let replayDenied = false;
    try { await invitations.preview(first, { token: pending.read(first) }); }
    catch (error) { replayDenied = error instanceof AccessDenied && error.status === 404; }
    expect(replayDenied).toBe(true);
  } finally { await f.client.close(); }
});

test("review: inconsistent persisted confirmed verses fail closed rather than exposing a partial reading or database snapshot", async () => {
  const f = await accessFixture();
  try {
    const portal = createPortalService({ access: f.service, practice: createPracticeService({ access: f.service }), sessionBindingSecret: randomBytes(48).toString("base64url") });
    let assignmentId = "";
    await f.owner(async () => {
      const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom",
        status: "confirmed", ref: "Genesis 1:1-2", setByMembershipId: f.adminMember.id,
        proposalSnapshot: { privateDiagnostic: "SYNTHETIC_PRIVATE_REVIEW_SENTINEL", needsReview: false, confirmationDate: "2027-01-02" } }).returning();
      assignmentId = row.id;
      await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.students[0].id, assignmentId, ordinal: 1, verseRef: "Genesis 1:1" });
    });
    let failure: unknown;
    try { await portal.assignedReading(f.request("multi"), { mode: "parent", studentId: f.students[0].id }); }
    catch (error) { failure = error; }
    expect(failure instanceof AccessUnavailable).toBe(true);
    const response = errorResponse(failure);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    await f.owner(async () => { await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.students[0].id, assignmentId, ordinal: 2, verseRef: "Genesis 1:2" }); });
    const repaired = await portal.assignedReading(f.request("multi"), { mode: "parent", studentId: f.students[0].id });
    expect(repaired.readings.length === 1 && repaired.readings[0].verses.length === 2).toBe(true);
    expect(JSON.stringify(repaired).includes("SYNTHETIC_PRIVATE_REVIEW_SENTINEL")).toBe(false);
  } finally { await f.client.close(); }
});
