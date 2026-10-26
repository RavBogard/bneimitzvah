import { afterEach, expect, it, vi } from "vitest";
import { invitationApi, parseInvitationPage, issueReview, invitationTargetFingerprint } from "../../src/components/portal/workspace/invitations/api";
import { PortalRequestError } from "../../src/components/portal/api";
import type { RosterStudent } from "../../src/components/portal/workspace/api";

const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const created = "2026-10-16T00:00:00.000Z", expires = "2026-10-19T00:00:00.000Z", attempted = "2026-10-16T00:00:01.000Z";
const student: RosterStudent = { id: id(10), firstName: "Synthetic", lastName: "Student", ceremonyDate: "2027-01-02", studentKind: "child" as const, serviceSlot: "unknown" as const, revision: 1, parentEmail: "parent@example.test", ownEmail: null, disabledAt: null };
const row = (n = 1) => ({ id: id(n), role: "parent", recipientEmail: "parent@example.test", student: { id: student.id, firstName: student.firstName, lastName: student.lastName }, status: "pending", createdAt: created, expiresAt: expires, expiresTomorrow: false, acceptedAt: null, revokedAt: null, delivery: { status: "pending", attemptedAt: null } });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("projects lifecycle separately from durable mail outcomes with normalized private-admin contacts", () => {
  const values = [row(1), { ...row(2), status: "accepted", acceptedAt: attempted, delivery: { status: "sent", attemptedAt: attempted } }, { ...row(3), status: "revoked", revokedAt: attempted, delivery: { status: "failed", attemptedAt: attempted } }, { ...row(4), role: "tutor", student: null, status: "expired" }];
  const parsed = parseInvitationPage({ invitations: values });
  expect(parsed.map(row => row.status)).toEqual(["pending", "accepted", "revoked", "expired"]);
  expect(parsed.map(row => row.delivery.status)).toEqual(["pending", "sent", "failed", "pending"]);
  expect(parsed[0].recipientEmail === values[0].recipientEmail && parsed[3].student === null).toBe(true);
});

it("rejects malformed or leaking pages atomically, unsupported durable unknown, invalid timestamps and role targets", () => {
  for (const changed of [{ ...row(), token: "private-sentinel" }, { ...row(), recipientEmail: "PARENT@example.test" }, { ...row(), role: "admin" }, { ...row(), student: null }, { ...row(), expiresAt: created }, { ...row(), status: "accepted" }, { ...row(), delivery: { status: "sent", attemptedAt: null } }, { ...row(), delivery: { status: "unknown", attemptedAt: null } }, { ...row(), createdAt: "invalid" }, { ...row(), expiresTomorrow: "yes" }, { ...row(), status: "expired", expiresTomorrow: true }])
    expect(() => parseInvitationPage({ invitations: [changed] })).toThrow(PortalRequestError);
  expect(() => parseInvitationPage({ invitations: [row(1), { ...row(2), diagnostic: "private-sentinel" }] })).toThrow(PortalRequestError);
});

it("enforces bounded ordered cursor pages without duplicates, earlier rows or arbitrary profile fields", () => {
  expect(parseInvitationPage({ invitations: [row(2)] }, id(1))).toHaveLength(1);
  // A copied link (N22) is its own final delivery state, with its copy time.
  expect(parseInvitationPage({ invitations: [{ ...row(3), delivery: { status: "copied", attemptedAt: attempted } }] })[0].delivery.status).toBe("copied");
  expect(() => parseInvitationPage({ invitations: [{ ...row(3), delivery: { status: "copied", attemptedAt: null } }] })).toThrow(PortalRequestError);
  for (const values of [[row(1)], [row(3), row(2)], [row(2), row(2)], Array.from({ length: 26 }, (_, n) => row(n + 2))])
    expect(() => parseInvitationPage({ invitations: values }, id(1))).toThrow(PortalRequestError);
});

it("requires explicit supported role and active selected child; siblings sharing a parent mailbox remain distinct", () => {
  const sibling = { ...student, id: id(11), firstName: "Sibling" };
  const a = issueReview({ role: "parent", email: " PARENT@example.test ", studentId: student.id }, [student, sibling]);
  const b = issueReview({ role: "parent", email: "parent@example.test", studentId: sibling.id }, [student, sibling]);
  expect(a.selection.email === "parent@example.test" && a.fingerprint !== b.fingerprint).toBe(true);
  expect(issueReview({ role: "tutor", email: "tutor@example.test", studentId: student.id }, [student]).selection).toEqual({ role: "tutor", email: "tutor@example.test" });
  for (const draft of [{ role: "student" as const, email: "parent@example.test", studentId: student.id }, { role: "parent" as const, email: "parent@example.test", studentId: id(12) }])
    expect(() => issueReview(draft, [student])).toThrow(PortalRequestError);
  expect(() => issueReview({ role: "parent", email: "parent@example.test", studentId: student.id }, [{ ...student, disabledAt: attempted }])).toThrow(PortalRequestError);
});

it("adult null parent contact does not become a mailbox match, and supplied malformed contacts still fail closed", () => {
  const adult: RosterStudent = { ...student, studentKind: "adult", parentEmail: null, ownEmail: "adult@example.test" };
  expect(issueReview({ role: "student", email: "adult@example.test", studentId: adult.id }, [adult]).selection.email).toBe("adult@example.test");
  expect(() => issueReview({ role: "student", email: "adult@example.test", studentId: adult.id }, [{ ...adult, parentEmail: "malformed-contact" }])).toThrow(PortalRequestError);
});

it("invalidates review fingerprints on displayed identity/date/contact/revision, lifecycle or delivery changes", () => {
  const draft = { role: "parent" as const, email: "parent@example.test", studentId: student.id }, original = issueReview(draft, [student]);
  for (const changed of [{ ...student, firstName: "Renamed" }, { ...student, ceremonyDate: "2027-01-09" }, { ...student, parentEmail: "changed@example.test" }, { ...student, revision: 2 }])
    expect(issueReview(draft, [changed]).fingerprint === original.fingerprint).toBe(false);
  const invitation = parseInvitationPage({ invitations: [row()] })[0], key = invitationTargetFingerprint(invitation, [student]);
  expect(invitationTargetFingerprint({ ...invitation, delivery: { status: "sent", attemptedAt: attempted } }, [student]) === key).toBe(false);
  expect(invitationTargetFingerprint(invitation, [{ ...student, disabledAt: attempted }]) === key).toBe(false);
});

it("uses fixed private endpoints with no token, cookie, context, mode or actor claims in request bodies", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ invitations: [row(2)] })).mockResolvedValueOnce(reply({ inviteId: id(3), delivery: "unknown" })).mockResolvedValueOnce(reply({ inviteId: id(4), delivery: "failed" })).mockResolvedValueOnce(reply({ inviteId: id(4) })); vi.stubGlobal("fetch", fetch);
  await invitationApi.list(id(1)); await invitationApi.issue({ role: "tutor", email: "tutor@example.test" }); await invitationApi.reissue(id(3)); await invitationApi.revoke(id(4));
  expect(fetch.mock.calls[0][0]).toBe(`/api/admin/invitations?limit=25&afterId=${id(1)}`);
  expect(Object.keys(JSON.parse(fetch.mock.calls[1][1].body)).sort()).toEqual(["email", "role"]);
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({}); expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({});
  for (const [path, options] of fetch.mock.calls) expect(!path.includes("email") && !path.includes("token") && !options.headers["X-Practice-Context"] && options.credentials === "same-origin" && options.cache === "no-store" && options.redirect === "error").toBe(true);
});

it("does not retry rejected or uncertain mutations and cannot expose diagnostics or oversized payloads", async () => {
  const fetch = vi.fn().mockResolvedValue(reply({ privateDiagnostic: "withheld" }, 503)); vi.stubGlobal("fetch", fetch);
  await expect(invitationApi.reissue(id(1))).rejects.toMatchObject({ status: 503 }); expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(reply({ diagnostic: "withheld" }, 403)); await expect(invitationApi.revoke(id(1))).rejects.toMatchObject({ status: 403 }); expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValue(reply({ payload: "x".repeat(128 * 1024) })); await expect(invitationApi.list()).rejects.toMatchObject({ status: 503 }); expect(fetch).toHaveBeenCalledTimes(3);
});
