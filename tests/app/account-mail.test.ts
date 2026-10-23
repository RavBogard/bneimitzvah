import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFile } from "node:fs/promises";
import { accountMailText, createAccountMailTransport } from "../../src/server/mail/transport";

// The two account emails. A recording fetch stands in for the provider; nothing leaves the process.
const ORIGIN = "https://torah.centralreform.org", KEY = "11111111-2222-4333-8444-555555555555";
const tenant = { name: "Central Reform Congregation", productName: "CRC Torah" };
function transport(enabled: boolean, answer = () => new Response("{}", { status: 200 })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer(); }) as unknown as typeof globalThis.fetch;
  return { send: createAccountMailTransport({ origin: ORIGIN, apiKey: "re_synthetic_key_123", from: "torah@example.test", fetch, enabled }), calls };
}

describe("the account mail transport", () => {
  it("outside production hands nothing to the provider", async () => {
    const { send, calls } = transport(false);
    for (const kind of ["account-request", "account-approved"] as const) expect(await send(kind, "approver@example.test", tenant, KEY)).toBe("skipped");
    expect(calls).toEqual([]);
  });
  it("in production sends only its own words: a fixed link on this origin, the congregation's names, and the idempotency key", async () => {
    const { send, calls } = transport(true);
    expect(await send("account-request", "approver@example.test", tenant, KEY)).toBe("sent");
    expect(await send("account-approved", "member@example.test", tenant, KEY)).toBe("sent");
    expect(calls).toHaveLength(2);
    const [request, approval] = calls.map(call => ({ url: call.url, headers: call.init.headers as Record<string, string>, body: JSON.parse(call.init.body as string) }));
    expect(request.url).toBe("https://api.resend.com/emails");
    expect(request.headers["idempotency-key"]).toBe(KEY);
    expect(request.body).toEqual({ from: "torah@example.test", to: ["approver@example.test"], subject: "An account request for CRC Torah",
      text: "Someone has asked for a CRC Torah account.\n\nReview account requests: https://torah.centralreform.org/workspace/accounts\n\nYou receive this because you approve accounts for Central Reform Congregation." });
    expect(approval.body).toEqual({ from: "torah@example.test", to: ["member@example.test"], subject: "Your CRC Torah account is ready",
      text: "Your account request was approved. Sign in with this email address to save readings and keep your own translation and notes.\n\nhttps://torah.centralreform.org/\n\nIf you did not ask for an account, you can ignore this email." });
    expect(accountMailText("account-request", ORIGIN, tenant).text.match(/https?:\/\/\S+/g)).toEqual([`${ORIGIN}/workspace/accounts`]);
  });
  it("refuses any other kind, recipient, name or key before the provider", async () => {
    const { send, calls } = transport(true);
    for (const [kind, to, names, key] of [["account-invite", "a@example.test", tenant, KEY], ["account-request", "not an address", tenant, KEY], ["account-request", "a@example.test", { ...tenant, name: "Evil <a href>" }, KEY],
      ["account-request", "a@example.test", { ...tenant, productName: "Line\nbreak" }, KEY], ["account-request", "a@example.test", { ...tenant, name: "A\u202eB" }, KEY], ["account-request", "a@example.test", tenant, "not-a-uuid"]] as const)
      expect(await send(kind as "account-request", to, names, key), String(kind) + to).toBe("rejected");
    expect(calls).toEqual([]);
  });
  it("reads a definite refusal as rejected and an unclear answer as unknown, and never throws", async () => {
    expect(await transport(true, () => new Response("{}", { status: 422 })).send("account-request", "a@example.test", tenant, KEY)).toBe("rejected");
    expect(await transport(true, () => new Response("{}", { status: 503 })).send("account-request", "a@example.test", tenant, KEY)).toBe("unknown");
    expect(await transport(true, () => { throw new TypeError("offline"); }).send("account-request", "a@example.test", tenant, KEY)).toBe("unknown");
  });
  it("is enabled only in production, in the runtime composition", async () => {
    const composition = await readFile("src/server/runtime/composition.ts", "utf8");
    expect(composition).toContain("createAccountMailTransport({ ...config.mail, origin: config.origin, fetch, enabled: config.deployment.environment === \"production\" })");
    expect(composition.match(/createAccountMailTransport\(/g)).toHaveLength(1);
  });
});
