import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountRequestView, parseRequestResult, parseRequestView, type RequestView } from "../../src/components/portal/account-request";
import { parseApprovers, parseMembers, parseRequests, parseSummary } from "../../src/components/portal/workspace/accounts/api";
import { PortalRequestError } from "../../src/components/portal/api";

const ID = "00000000-0000-4000-8000-000000000001", stamp = "2026-10-23T00:00:00.000Z";
const view = (state: RequestView, problem: Parameters<typeof AccountRequestView>[0]["problem"] = null, level: 3 | 4 = 3) => renderToStaticMarkup(createElement(AccountRequestView, {
  view: state, level, name: "Ruth", purpose: "", problem, sending: false, formId: "req", onName: () => {}, onPurpose: () => {}, onSubmit: () => {}, onRetry: () => {} }));

describe("asking for an account, on screen", () => {
  it("offers the form with the person's name filled in, and an optional purpose", () => {
    const form = view({ status: "ready", state: "requestable", suggestedName: "Ruth" });
    expect(form).toContain(">Ask for an account</h3>");
    expect(form).toContain("An account keeps your own readings, translation and notes. Everything else on CRC Torah is open without one.");
    expect(form).toContain('<label for="req-name">Your name</label>');
    expect(form).toContain('value="Ruth"');
    expect(form).toContain("What would you like to work on? <span class=\"field-help\">(optional)</span>");
    expect(form).toContain(">Send request</button>");
    expect(view({ status: "ready", state: "requestable", suggestedName: "" }, null, 4)).toContain(">Ask for an account</h4>");
    expect(view({ status: "ready", state: "requestable", suggestedName: "" }, "rate-limited")).toContain("You’ve asked several times today. Try again tomorrow.");
  });
  it("says plainly when the request is in, or when the account can already save readings", () => {
    const pending = view({ status: "ready", state: "pending", suggestedName: "" });
    expect(pending).toContain("Your request is in");
    expect(pending).toContain("You’ll get one email when it’s approved.");
    expect(pending).not.toContain("<form");
    const member = view({ status: "ready", state: "member", suggestedName: "" });
    expect(member).toContain("Your account can save readings");
    expect(member).toContain('href="/read">This week’s reading</a>');
    expect(view({ status: "failed" })).toContain(">Try again</button>");
    for (const state of ["requestable", "pending", "member"] as const) expect(view({ status: "ready", state, suggestedName: "" })).not.toMatch(/!/);
  });
  it("reads the server's answers strictly", () => {
    expect(parseRequestView(200, { ok: true, state: "pending", suggestedName: "" })).toEqual({ status: "ready", state: "pending", suggestedName: "" });
    for (const [status, value] of [[200, { ok: true, state: "owner", suggestedName: "" }], [200, { ok: true, state: "pending" }], [200, { ok: true, state: "pending", suggestedName: "A\u202eB" }], [401, {}], [503, null]] as const)
      expect(parseRequestView(status, value)).toEqual({ status: "failed" });
    expect(parseRequestResult(200, { ok: true, state: "pending" })).toBe("pending");
    expect(parseRequestResult(200, { ok: true, state: "member" })).toBe("member");
    expect(parseRequestResult(429, { ok: false, code: "rate-limited" })).toBe("rate-limited");
    expect(parseRequestResult(429, { ok: false, code: "busy" })).toBe("busy");
    expect(parseRequestResult(400, {})).toBe("invalid");
    expect(parseRequestResult(200, { ok: true, state: "requestable" })).toBe("unavailable");
  });
});

describe("the approvers' client", () => {
  it("accepts exactly the queue, members and approvers shapes", () => {
    expect(parseRequests({ ok: true, requests: [{ id: ID, name: "Ruth", purpose: null, email: "ruth@example.test", requestedAt: stamp }] })).toHaveLength(1);
    expect(parseMembers({ ok: true, members: [{ id: ID, name: "Ruth", since: stamp }] })).toEqual([{ id: ID, name: "Ruth", since: stamp }]);
    expect(parseApprovers({ ok: true, admins: ["Rabbi"], designated: [{ id: ID, name: "Tutor" }], candidates: [{ tutorGrantId: ID, name: "Other" }] }).designated).toHaveLength(1);
    expect(parseSummary({ ok: true, requests: 3 })).toBe(3);
    for (const bad of [() => parseRequests({ ok: true, requests: [{ id: ID, name: "A\u202eB", purpose: null, email: null, requestedAt: stamp }] }),
      () => parseRequests({ ok: true, requests: [{ id: ID, name: "Ruth", purpose: null, email: null, requestedAt: stamp, extra: 1 }] }),
      () => parseMembers({ ok: true, members: [{ id: ID, name: "Ruth", since: stamp, email: "x@example.test" }] }),
      () => parseApprovers({ ok: true, admins: [], designated: [], candidates: [{ tutorGrantId: "nope", name: "X" }] }),
      () => parseSummary({ ok: true, requests: -1 })]) expect(bad).toThrow(PortalRequestError);
  });
});
