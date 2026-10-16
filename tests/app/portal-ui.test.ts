import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAcceptance, parseAcknowledgement, parseGoogleDestination, parseInvitation, parseSession, PortalRequestError, requestPortal } from "../../src/components/portal/api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const review = () => ({ role: "parent", student: { firstName: "Synthetic", lastName: "Student" }, requiresConfirmation: true,
  expiresAt: new Date(Date.now() + 60_000).toISOString(), reviewBinding: `${Date.now() + 60_000}.${"x".repeat(43)}` });

describe("portal entry client trust and transport contracts", () => {
  it("loads only a minimal session role summary and rejects unexpected identity/provider fields", () => {
    const sessionBinding = "a".repeat(43);
    expect(parseSession({ membershipAvailable: false, roles: [], sessionBinding })).toEqual({ membershipAvailable: false, roles: [], sessionBinding });
    expect(parseSession({ membershipAvailable: true, roles: ["parent", "tutor"], sessionBinding }).roles).toEqual(["parent", "tutor"]);
    for (const value of [{ membershipAvailable: false, roles: ["admin"] }, { membershipAvailable: true, roles: ["admin", "admin"] },
      { membershipAvailable: true, roles: ["owner"] }, { membershipAvailable: true, roles: [], user: {} }, { membershipAvailable: "true", roles: [] }])
      expect(() => parseSession({ ...value, sessionBinding })).toThrow(PortalRequestError);
    expect(() => parseSession({ membershipAvailable: true, roles: [], sessionBinding: "untrusted-readable-claims" })).toThrow(PortalRequestError);
  });

  it("requires a reviewed invitation DTO without raw token/mailbox/session claims and enforces role-target shape", () => {
    expect(parseInvitation(review()).role).toBe("parent");
    expect(parseInvitation({ ...review(), role: "tutor", student: null }).student).toBe(null);
    for (const value of [{ ...review(), token: "untrusted" }, { ...review(), sessionId: "untrusted" }, { ...review(), role: "admin" }, { ...review(), role: "tutor" },
      { ...review(), student: null }, { ...review(), reviewBinding: "readable-untrusted-claims" }, { ...review(), expiresAt: "invalid" }, { ...review(), requiresConfirmation: false }])
      expect(() => parseInvitation(value)).toThrow(PortalRequestError);
  });

  it("uses same-origin cookie transport, no-store and no referrer, with binding-only acceptance", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response({ ok: true }))); vi.stubGlobal("fetch", fetch);
    await requestPortal("/api/session"); await requestPortal("/api/invitations/accept", { reviewBinding: review().reviewBinding });
    expect(fetch.mock.calls[0][0]).toBe("/api/session");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    const options = fetch.mock.calls[1][1];
    expect(options.method).toBe("POST"); expect(Object.keys(JSON.parse(options.body))).toEqual(["reviewBinding"]);
    expect(Object.keys(options.headers).sort()).toEqual(["accept", "content-type"]);
    expect(!JSON.stringify(options).includes("X-Practice-Context") && !JSON.stringify(options).includes("authorization")).toBe(true);
    const before = fetch.mock.calls.length;
    await expect(requestPortal("https://evil.example.test" as Parameters<typeof requestPortal>[0])).rejects.toThrow(PortalRequestError);
    expect(fetch.mock.calls.length).toBe(before);
  });

  it("discards private diagnostics on denied, failed, malformed and oversized responses", async () => {
    const diagnostic = "synthetic-private-diagnostic";
    for (const reply of [response({ error: diagnostic }, 403), response({ error: diagnostic }, 500), new Response(diagnostic, { status: 200 }),
      new Response(diagnostic, { headers: { "content-type": "application/json" } }), response({ large: "x".repeat(17_000) })]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply));
      let caught: unknown;
      try { await requestPortal("/api/session"); } catch (error) { caught = error; }
      expect(caught instanceof PortalRequestError && !String(caught).includes(diagnostic) && !(caught as Error).cause).toBe(true);
    }
  });

  it("bounds network waits and copies no original error details", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("synthetic-private-network-details")));
    })));
    const result = requestPortal("/api/session").then(() => false, error => error instanceof PortalRequestError && error.status === 503 && !String(error).includes("network-details"));
    await vi.advanceTimersByTimeAsync(12_000); expect(await result).toBe(true);
  });

  it("permits only the validated Google navigation destination", () => {
    expect(parseGoogleDestination({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic" }).startsWith("https://accounts.google.com/")).toBe(true);
    for (const url of ["javascript:alert(1)", "https://accounts.google.com.evil.example.test/o/oauth2/v2/auth", "https://accounts.google.com/other", "http://accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com/o/oauth2/v2/auth#private"])
      expect(() => parseGoogleDestination({ url })).toThrow(PortalRequestError);
  });

  it("accepts only fixed acknowledgements and constrained acceptance results", () => {
    expect(() => parseAcknowledgement({ requested: true }, "requested")).not.toThrow();
    expect(() => parseAcknowledgement({ requested: true, session: {} }, "requested")).toThrow(PortalRequestError);
    const inviteId = "10000000-0000-4000-8000-000000000001", studentId = "10000000-0000-4000-8000-000000000002";
    expect(() => parseAcceptance({ inviteId, role: "parent", studentId })).not.toThrow();
    expect(() => parseAcceptance({ inviteId, role: "tutor", studentId: null })).not.toThrow();
    expect(() => parseAcceptance({ inviteId, role: "admin", studentId: null })).toThrow(PortalRequestError);
    expect(() => parseAcceptance({ inviteId, role: "parent", studentId: null })).toThrow(PortalRequestError);
  });
});
