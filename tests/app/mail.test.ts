import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createMailTransport } from "../../src/server/mail/transport";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";

const origin = "https://synthetic.example.test";
const apiKey = `re_${randomBytes(24).toString("hex")}`;
const email = "synthetic@example.test";
function link(kind: "invitation" | "magic-link") {
  const url = new URL(kind === "invitation" ? "/invitations/accept" : "/api/auth/magic-link/verify", origin);
  url.searchParams.set("token", kind === "invitation" ? randomBytes(32).toString("base64url") : "A".repeat(32));
  if (kind === "magic-link") url.searchParams.set("callbackURL", "/");
  return url.href;
}
async function safeFailure(action: () => Promise<unknown>) {
  try { await action(); return false; }
  catch (error) { return error instanceof RuntimeUnavailable && error.message === "Service temporarily unavailable" && !("cause" in error); }
}

test("both mail kinds use the fixed Resend endpoint and plain text with no tracking payload or returned token", async () => {
  const captured: { endpoint: string; init: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => { captured.push({ endpoint: String(url), init: init! }); return new Response("provider-details", { status: 200 }); };
  const send = createMailTransport({ origin, apiKey, from: email, fetch });
  for (const kind of ["invitation", "magic-link"] as const) {
    const url = link(kind);
    expect(await send(kind, { email, url })).toBeUndefined();
    const capture = captured.at(-1)!;
    const body = JSON.parse(String(capture.init.body));
    expect(capture.endpoint).toBe("https://api.resend.com/emails");
    expect(capture.init.redirect).toBe("error");
    expect(capture.init.credentials).toBe("omit");
    expect(Object.keys(body).sort()).toEqual(["from", "subject", "text", "to"]);
    expect(body.text.includes(url)).toBe(true);
    expect((capture.init.headers as Record<string, string>).authorization === `Bearer ${apiKey}`).toBe(true);
  }
});

test("mail rejects foreign, ambiguous, duplicated-token, header-injection and unsafe callback links before fetch", async () => {
  let calls = 0;
  const send = createMailTransport({ origin, apiKey, from: email, fetch: async () => { calls++; return new Response(); } });
  const good = link("invitation");
  for (const url of [good.replace(origin, "https://foreign.example.test"), `${good}#fragment`, `${good}&token=duplicate`, `${good}&email=synthetic`,
    good.replace("/invitations/accept", "/invitations/%61ccept"), good.replace("https://", "https://user@"), good + "\n", good.replace("accept", "accept/"),
    link("magic-link").replace("callbackURL=%2F", "callbackURL=https%3A%2F%2Fforeign.example.test")]) {
    expect(await safeFailure(() => send(url.includes("magic-link") ? "magic-link" : "invitation", { email, url }))).toBe(true);
  }
  expect(await safeFailure(() => send("invitation", { email: email + "\r\nBcc: bad", url: good }))).toBe(true);
  expect(calls).toBe(0);
});

test("provider failures, private error causes, oversized bodies and stalled fetches stay sanitized and bounded", async () => {
  const privateValue = randomBytes(32).toString("hex");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const fetch of [
      async () => { throw new Error(privateValue, { cause: { cookie: privateValue } }); },
      async () => new Response(privateValue.repeat(1000), { status: 429 }),
      async () => new Promise<Response>(() => {}),
    ] satisfies (typeof globalThis.fetch)[]) {
      const send = createMailTransport({ origin, apiKey, from: email, fetch, timeoutMs: 5 });
      expect(await safeFailure(() => send("invitation", { email, url: link("invitation") }))).toBe(true);
    }
    expect(log.mock.calls.length).toBe(0);
  } finally { log.mockRestore(); }
});
