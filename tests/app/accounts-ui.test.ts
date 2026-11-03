import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountRequestView, parseRequestResult, parseRequestView, type RequestView } from "../../src/components/portal/account-request";
import { parseApprovers, parseDecision, parseMembers, parsePeople, parseRequests, parseStudentOptions, parseSummary, type Person } from "../../src/components/portal/workspace/accounts/api";
import { ADMIN_REAPPROVAL_LINE, ALREADY_LINKED_LINE, IDENTITY_TAKEN_LINE, PeopleWithAccessCard } from "../../src/components/portal/workspace/accounts/workspace";
import { PortalRequestError } from "../../src/components/portal/api";

const ID = "00000000-0000-4000-8000-000000000001", stamp = "2026-10-23T00:00:00.000Z";
const view = (state: RequestView, problem: Parameters<typeof AccountRequestView>[0]["problem"] = null, level: 3 | 4 = 3) => renderToStaticMarkup(createElement(AccountRequestView, {
  view: state, level, name: "Ruth", purpose: "", problem, sending: false, formId: "req", onName: () => {}, onPurpose: () => {}, onSubmit: () => {}, onRetry: () => {} }));

describe("asking to be linked, on screen", () => {
  // The one wording test for the request form (plan D6; the strings are the spec's and the lead's).
  it("offers the link request with the person's name filled in and asks who they are, word for word", () => {
    const form = view({ status: "ready", state: "requestable", suggestedName: "Ruth", productName: "CRC Torah" });
    expect(form).toContain(">Ask to be linked</h3>");
    expect(form).toContain("<p>Preparing a Beit Mitzvah at CRC? Ask the rabbi to connect this account to your student record.</p>");
    expect(form).not.toMatch(/translation and notes|keeps your saved readings|Ask for an account/);
    expect(form).toContain('<label for="req-name">Your name</label>');
    expect(form).toContain('value="Ruth"');
    expect(form).toContain('<label for="req-purpose">Who you are (the student’s name and ceremony date, or whose parent you are)</label>');
    expect(form).toContain(">Send request</button>");
    expect(view({ status: "ready", state: "requestable", suggestedName: "", productName: "CRC Torah" }, null, 4)).toContain(">Ask to be linked</h4>");
    expect(view({ status: "ready", state: "requestable", suggestedName: "", productName: "CRC Torah" }, "rate-limited")).toContain("You’ve asked several times today. Try again tomorrow.");
  });
  it("says plainly when the request is in, and shows nothing for an approved Member role", () => {
    const pending = view({ status: "ready", state: "pending", suggestedName: "", productName: "CRC Torah" });
    expect(pending).toContain("Your request is in");
    expect(pending).toContain("You’ll get one email when it’s been linked.");
    expect(pending).not.toContain("<form");
    // Readings for everyone: the shelf is everyone's, so the Member role leaves nothing to ask for here.
    expect(view({ status: "ready", state: "member", suggestedName: "", productName: "CRC Torah" })).toBe("");
    expect(view({ status: "failed" })).toContain(">Try again</button>");
    for (const state of ["requestable", "pending", "member"] as const) expect(view({ status: "ready", state, suggestedName: "", productName: "CRC Torah" })).not.toMatch(/!/);
  });
  it("the staff accounts page names the same things an account keeps", () => {
    const source = readFileSync("src/components/portal/workspace/accounts/workspace.tsx", "utf8");
    expect(source).toContain('An account keeps a person’s saved readings, place in Learn to lein, preferred commentaries and settings. Everything else on <bdi dir="auto">{productName}</bdi> is open without one.');
    expect(source).not.toMatch(/translation and notes/);
  });
  it("reads the server's answers strictly", () => {
    expect(parseRequestView(200, { ok: true, state: "pending", suggestedName: "", productName: "CRC Torah" })).toEqual({ status: "ready", state: "pending", suggestedName: "", productName: "CRC Torah" });
    for (const [status, value] of [[200, { ok: true, state: "owner", suggestedName: "", productName: "CRC Torah" }], [200, { ok: true, state: "pending" }], [200, { ok: true, state: "pending", suggestedName: "A\u202eB", productName: "CRC Torah" }], [200, { ok: true, state: "pending", suggestedName: "" }],
      [200, { ok: true, state: "pending", suggestedName: "", productName: "" }], [200, { ok: true, state: "pending", suggestedName: "", productName: " CRC Torah" }], [200, { ok: true, state: "pending", suggestedName: "", productName: "A\u202eB" }], [401, {}], [503, null]] as const)
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
    expect(parseRequests({ ok: true, requests: [{ id: ID, name: "Ruth", purpose: null, email: "ruth@example.test", requestedAt: stamp, student: null }], productName: "CRC Torah" }).requests).toHaveLength(1);
    // Plan D6: a request may name the student record it asks for; the approver's student list is the portal's own.
    expect(parseRequests({ ok: true, requests: [{ id: ID, name: "Ruth", purpose: null, email: null, requestedAt: stamp, student: { id: ID, firstName: "Synthetic", lastName: "Student" } }], productName: "CRC Torah" }).requests[0].student).toEqual({ id: ID, firstName: "Synthetic", lastName: "Student" });
    expect(parseStudentOptions({ students: [{ id: ID, firstName: "Synthetic", lastName: "Student", ceremonyDate: "2027-01-02", revision: 1, rehearsal1: null, rehearsal2: null, serviceSlot: "morning", ownAdultHonors: false }] })).toEqual([{ id: ID, firstName: "Synthetic", lastName: "Student", ceremonyDate: "2027-01-02" }]);
    expect(() => parseStudentOptions({ students: [{ id: "nope", firstName: "X", lastName: "Y", ceremonyDate: "2027-01-02" }] })).toThrow(PortalRequestError);
    expect(parseDecision(200, { ok: true, memberId: ID, linked: true })).toEqual({ ok: true });
    expect(parseDecision(409, { ok: false, code: "identity-taken" })).toEqual({ ok: false, code: "identity-taken" });
    expect(parseDecision(409, { ok: false, code: "already-linked" })).toEqual({ ok: false, code: "already-linked" });
    for (const line of [IDENTITY_TAKEN_LINE, ALREADY_LINKED_LINE]) { expect(line).toMatch(/The request is kept\.$/); expect(line).not.toMatch(/!/); }
    expect(parseMembers({ ok: true, members: [{ id: ID, name: "Ruth", since: stamp }] })).toEqual([{ id: ID, name: "Ruth", since: stamp }]);
    expect(parseApprovers({ ok: true, admins: ["Rabbi"], designated: [{ id: ID, name: "Tutor" }], candidates: [{ tutorGrantId: ID, name: "Other" }] }).designated).toHaveLength(1);
    expect(parseSummary({ ok: true, requests: 3 })).toBe(3);
    expect(parseDecision(200, { ok: true, memberId: ID, linked: false })).toEqual({ ok: true });
    expect(() => parseDecision(200, { ok: true, memberId: ID })).toThrow(PortalRequestError);
    expect(parseDecision(409, { ok: false, code: "disabled" })).toEqual({ ok: false, code: "disabled" });
    expect(parseDecision(409, { ok: false, code: "admin-only" })).toEqual({ ok: false, code: "admin-only" });
    expect(() => parseDecision(409, { ok: false, code: "other" })).toThrow(PortalRequestError);
    expect(parseDecision(409, { ok: false, code: "own-request" })).toEqual({ ok: false, code: "own-request" });
    // The tutor's refusal keeps the request and names who can act, in the house tone.
    expect(ADMIN_REAPPROVAL_LINE).toMatch(/only an admin can approve them again. The request is kept.$/); expect(ADMIN_REAPPROVAL_LINE).not.toMatch(/!/);
    for (const bad of [() => parseRequests({ ok: true, requests: [{ id: ID, name: "A\u202eB", purpose: null, email: null, requestedAt: stamp, student: null }], productName: "CRC Torah" }),
      () => parseRequests({ ok: true, requests: [{ id: ID, name: "Ruth", purpose: null, email: null, requestedAt: stamp, student: null, extra: 1 }], productName: "CRC Torah" }),
      () => parseRequests({ ok: true, requests: [{ id: ID, name: "Ruth", purpose: null, email: null, requestedAt: stamp }], productName: "CRC Torah" }),
      () => parseRequests({ ok: true, requests: [{ id: ID, name: "Ruth", purpose: null, email: null, requestedAt: stamp, student: { id: ID, firstName: "A\u202eB", lastName: "S" } }], productName: "CRC Torah" }),
      () => parseRequests({ ok: true, requests: [] }), () => parseRequests({ ok: true, requests: [], productName: "" }), () => parseRequests({ ok: true, requests: [], productName: "   " }), () => parseRequests({ ok: true, requests: [], productName: "A\u202eB" }),
      () => parseMembers({ ok: true, members: [{ id: ID, name: "Ruth", since: stamp, email: "x@example.test" }] }),
      () => parseApprovers({ ok: true, admins: [], designated: [], candidates: [{ tutorGrantId: "nope", name: "X" }] }),
      () => parseSummary({ ok: true, requests: -1 })]) expect(bad).toThrow(PortalRequestError);
  });
});

// People with access and Make tutor (docs/planning/2026-11-03-people-tutor/SPEC.md).
describe("people with access", () => {
  const ID2 = "00000000-0000-4000-8000-000000000002", ID3 = "00000000-0000-4000-8000-000000000003";
  const rows: Person[] = [
    { id: ID, memberId: ID3, name: "Ruth", roles: ["member", "parent"], since: stamp },
    { id: ID2, memberId: null, name: "Naomi", roles: ["tutor"], since: stamp },
    { id: ID3, memberId: null, name: "Boaz", roles: ["student"], since: stamp },
  ];
  type Props = Parameters<typeof PeopleWithAccessCard>[0];
  const props = (over: Partial<Props> = {}): Props => ({ people: rows, confirming: null, pending: false, onConfirming: () => {}, onMakeTutor: () => {}, onEnd: () => {}, ...over });
  const card = (over: Partial<Props> = {}) => renderToStaticMarkup(createElement(PeopleWithAccessCard, props(over)));
  const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  /** The buttons of the rendered tree, by aria-label (the card is a plain function of its props). */
  function buttons(node: ReactNode, out = new Map<string, { onClick: () => void; disabled: boolean; text: string }>()) {
    if (Array.isArray(node)) { for (const child of node) buttons(child, out); return out; }
    if (!isValidElement(node)) return out;
    const element = node as { type: unknown; props: Record<string, unknown> };
    if (typeof element.type === "function") return buttons((element.type as (p: unknown) => ReactNode)(element.props), out);
    if (element.type === "button") out.set(String(element.props["aria-label"]), { onClick: element.props.onClick as () => void, disabled: Boolean(element.props.disabled), text: String(element.props.children) });
    buttons(element.props.children as ReactNode, out);
    return out;
  }

  it("says the card's words exactly: heading, intro, chips, since, buttons and the empty list", () => {
    const html = card();
    expect(html).toContain("<h2 id=\"accounts-people\">People with access</h2>");
    expect(plain(html)).toContain("Everyone with an account here. Make someone a tutor to give them the tutor view, then assign their students on each student’s page.");
    expect(plain(html)).toMatch(/Ruth Member Parent Since /);
    expect(html).toContain("aria-label=\"Make tutor: Ruth\"");
    expect(html).toContain(">Make tutor</button>");
    expect(html).toContain("aria-label=\"End membership: Ruth\"");
    expect(plain(card({ people: [] }))).toContain("No one has an account here yet.");
    const confirm = card({ confirming: `tutor:${ID}` });
    expect(confirm).toContain("aria-label=\"Make tutor now: Ruth\"");
    expect(confirm).toContain(">Make tutor now</button>");
    expect(confirm).toContain("aria-label=\"Keep as is: Ruth\"");
    expect(confirm).toContain(">Cancel</button>");
    expect(html).not.toContain("@");
  });

  it("offers Make tutor only to someone neither tutor nor student, in two steps; End membership only on a Member row", () => {
    const first = buttons(PeopleWithAccessCard(props()));
    expect([...first.keys()].sort()).toEqual(["End membership: Ruth", "Make tutor: Ruth"]);
    const asked: (string | null)[] = [], made: string[] = [];
    first.get("Make tutor: Ruth")!.onClick();
    expect(asked).toEqual([]);
    const tracked = props({ onConfirming: next => asked.push(next), onMakeTutor: row => made.push(row.id) });
    buttons(PeopleWithAccessCard(tracked)).get("Make tutor: Ruth")!.onClick();
    expect(asked).toEqual([`tutor:${ID}`]);
    expect(made).toEqual([]);
    // The second step: Make tutor now acts, Cancel steps back, and nothing else on the card is open meanwhile.
    const second = buttons(PeopleWithAccessCard({ ...tracked, confirming: `tutor:${ID}` }));
    expect([...second.keys()].sort()).toEqual(["Keep as is: Ruth", "Make tutor now: Ruth"]);
    second.get("Make tutor now: Ruth")!.onClick();
    expect(made).toEqual([ID]);
    second.get("Keep as is: Ruth")!.onClick();
    expect(asked).toEqual([`tutor:${ID}`, null]);
    const busy = buttons(PeopleWithAccessCard({ ...tracked, confirming: `tutor:${ID}`, pending: true }));
    expect(busy.get("Make tutor now: Ruth")!.disabled).toBe(true);
  });

  it("reads the people list strictly", () => {
    expect(parsePeople({ ok: true, people: [{ id: ID, memberId: null, name: "Ruth", roles: ["parent", "tutor"], since: stamp }] })).toEqual([{ id: ID, memberId: null, name: "Ruth", roles: ["tutor", "parent"], since: stamp }]);
    for (const bad of [{ ok: true, people: [{ id: ID, memberId: null, name: "Ruth", roles: ["owner"], since: stamp }] },
      { ok: true, people: [{ id: ID, memberId: null, name: "Ruth", roles: ["tutor", "tutor"], since: stamp }] },
      { ok: true, people: [{ id: ID, memberId: null, name: "Ruth", roles: [], since: stamp, email: "x@example.test" }] },
      { ok: true, people: [{ id: ID, memberId: "nope", name: "Ruth", roles: [], since: stamp }] }]) expect(() => parsePeople(bad)).toThrow(PortalRequestError);
  });
});
