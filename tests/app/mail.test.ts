import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createMailTransport, SIGN_IN_CODE_LINES } from "../../src/server/mail/transport";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";

const origin = "https://synthetic.example.test";
const apiKey = `re_${randomBytes(24).toString("hex")}`;
const email = "synthetic@example.test";
const productName = "CRC Torah";
function link(kind: "invitation" | "magic-link") {
  const url = new URL(kind === "invitation" ? "/invitations/open" : "/auth/email", origin);
  url.hash = `token=${kind === "invitation" ? randomBytes(32).toString("base64url") : "A".repeat(32)}`;
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
  const code = "048213";
  for (const kind of ["invitation", "magic-link"] as const) {
    const url = link(kind);
    expect(await send(kind, kind === "magic-link" ? { email, productName, url, code } : { email, productName, url })).toBeUndefined();
    const capture = captured.at(-1)!;
    const body = JSON.parse(String(capture.init.body));
    expect(capture.endpoint).toBe("https://api.resend.com/emails");
    expect(capture.init.redirect).toBe("error");
    expect(capture.init.credentials).toBe("omit");
    expect(Object.keys(body).sort()).toEqual(["from", "subject", "text", "to"]);
    expect(body.text.includes(url)).toBe(true);
    // The sign-in email carries its code in the body only, after the link; never in the subject.
    expect(body.subject.includes(code)).toBe(false);
    expect(body.text.includes(code)).toBe(kind === "magic-link");
    // No digits at all in either subject.
    expect(body.subject).not.toMatch(/\d/);
    if (kind === "magic-link") {
      // Daniel's wording (2026-10-23), in order, with the code alone on the line after its label.
      expect(body.subject).toBe("Sign in to CRC Torah");
      expect(body.text).toBe([`Open this link to sign in:`, ``, url, ``, `Or enter this code in the CRC Torah app:`, code, ``,
        `The link and the code work once, for 5 minutes.`, ``,
        `No one from CRC will ever ask you for this code. Don’t read it to anyone or type it anywhere but CRC Torah.`, ``,
        `If you did not request this message, you can ignore it.`].join("\n"));
      expect(body.text.split("\n").filter((line: string) => line === code)).toHaveLength(1);
      expect(body.text.match(/\d{6,}/g)).toEqual([code]);
      expect(body.text.includes(SIGN_IN_CODE_LINES.never(productName))).toBe(true);
      // No WebOTP origin-bound line (`@host #code`): it is defined for SMS only.
      expect(body.text).not.toMatch(/@\S+\s+#\d/);
      expect(body.text.includes(`#${code}`)).toBe(false);
    } else {
      expect(body.subject).toBe("Your Beit Mitzvah invitation from CRC Torah");
      expect(body.text).toBe(`Open this link to review your invitation:\n\n${url}\n\nIf you did not request this message, you can ignore it.`);
    }
    expect((capture.init.headers as Record<string, string>).authorization === `Bearer ${apiKey}`).toBe(true);
  }
});

test("mail rejects foreign, ambiguous, duplicated-token, header-injection and unsafe callback links before fetch", async () => {
  let calls = 0;
  const send = createMailTransport({ origin, apiKey, from: email, fetch: async () => { calls++; return new Response(); } });
  const good = link("invitation");
  for (const url of [good.replace(origin, "https://foreign.example.test"), `${good}#fragment`, `${good}&token=duplicate`, `${good}&email=synthetic`,
    good.replace("/invitations/open", "/invitations/%6fpen"), good.replace("https://", "https://user@"), good + "\n", good.replace("open", "open/"),
    link("magic-link") + "&callbackURL=https%3A%2F%2Fforeign.example.test"]) {
    expect(await safeFailure(() => send(url.includes("magic-link") ? "magic-link" : "invitation", { email, productName, url }))).toBe(true);
  }
  expect(await safeFailure(() => send("invitation", { email: email + "\r\nBcc: bad", productName, url: good }))).toBe(true);
  // A sign-in email never goes out without a well-formed code, and an invitation never carries one.
  for (const code of [undefined, "", "12345", "1234567", "12a456", " 123456", "123456\n", "１２３４５６"]) {
    expect(await safeFailure(() => send("magic-link", { email, productName, url: link("magic-link"), code }))).toBe(true);
  }
  expect(await safeFailure(() => send("invitation", { email, productName, url: good, code: "123456" }))).toBe(true);
  // The code must be the only run of 6 or more digits in the email; an address that adds one sends nothing.
  const digits = "https://torah123456.example.test";
  const digitSend = createMailTransport({ origin: digits, apiKey, from: email, fetch: async () => { calls++; return new Response(); } });
  const digitLink = new URL("/auth/email", digits); digitLink.hash = `token=${"A".repeat(32)}`;
  expect(await safeFailure(() => digitSend("magic-link", { email, productName, url: digitLink.href, code: "048213" }))).toBe(true);
  expect(calls).toBe(0);
});

test("a capped address's sign-in email (an explicit null code) leaves out only the code's line; an omitted code is still refused", async () => {
  const sent: { subject: string; text: string }[] = [];
  const send = createMailTransport({ origin, apiKey, from: email, fetch: async (_url, init) => { sent.push(JSON.parse(String(init!.body))); return new Response(); } });
  const url = link("magic-link");
  await send("magic-link", { email, productName, url, code: null });
  expect(sent[0].subject).toBe("Sign in to CRC Torah");
  expect(sent[0].text).toBe(["Open this link to sign in:", "", url, "", SIGN_IN_CODE_LINES.linkOnce, "", SIGN_IN_CODE_LINES.never(productName), "",
    "If you did not request this message, you can ignore it."].join("\n"));
  expect(sent[0].text.includes(SIGN_IN_CODE_LINES.code(productName))).toBe(false);
  expect(await safeFailure(() => send("magic-link", { email, productName, url }))).toBe(true);
  expect(await safeFailure(() => send("invitation", { email, productName, url: link("invitation"), code: null }))).toBe(true);
  // Link-only mail may hold no 6-digit run at all.
  const digits = "https://torah123456.example.test";
  const digitLink = new URL("/auth/email", digits); digitLink.hash = `token=${"A".repeat(32)}`;
  const digitSend = createMailTransport({ origin: digits, apiKey, from: email, fetch: async () => { throw new Error("Not sent"); } });
  expect(await safeFailure(() => digitSend("magic-link", { email, productName, url: digitLink.href, code: null }))).toBe(true);
  expect(sent).toHaveLength(1);
});

test("an invitation whose random token happens to hold six digits in a row is still sent", async () => {
  let calls = 0;
  const send = createMailTransport({ origin, apiKey, from: email, fetch: async () => { calls++; return new Response(); } });
  const url = new URL("/invitations/open", origin); url.hash = `token=${Buffer.from(randomBytes(32)).toString("base64url").replace(/^.{9}/, "AAA123456")}`;
  // Keep it a canonical base64url token: re-encode the decoded bytes, then confirm the run survived.
  const token = Buffer.from(url.hash.slice("#token=".length), "base64url").toString("base64url"); url.hash = `token=${token}`;
  expect(token).toMatch(/\d{6}/);
  expect(await send("invitation", { email, productName, url: url.href })).toBeUndefined();
  expect(calls).toBe(1);
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
      expect(await safeFailure(() => send("invitation", { email, productName, url: link("invitation") }))).toBe(true);
    }
    expect(log.mock.calls.length).toBe(0);
  } finally { log.mockRestore(); }
});

test("the product name is the congregation's own, and one with any number, control or invisible character sends nothing", async () => {
  const sent: { subject: string; text: string }[] = [];
  let calls = 0;
  const send = createMailTransport({ origin, apiKey, from: email, fetch: async (_url, init) => { calls++; sent.push(JSON.parse(String(init!.body))); return new Response(); } });
  // Another congregation's name is used as given, in the subject and in both code lines.
  await send("magic-link", { email, productName: "Temple Torah", url: link("magic-link"), code: "048213" });
  expect(sent[0].subject).toBe("Sign in to Temple Torah");
  expect(sent[0].text.includes("Or enter this code in the Temple Torah app:\n048213\n")).toBe(true);
  expect(sent[0].text.includes("type it anywhere but Temple Torah.")).toBe(true);
  await send("invitation", { email, productName: "Temple Torah", url: link("invitation") });
  expect(sent[1].subject).toBe("Your Beit Mitzvah invitation from Temple Torah");
  for (const name of ["Torah 2", "Torah ٢", "Torah ２", "Torah ²", "Torah ①", "Torah‏", "Torah\u0007", "", " Torah", undefined]) {
    expect(await safeFailure(() => send("magic-link", { email, productName: name as string, url: link("magic-link"), code: "048213" }))).toBe(true);
    expect(await safeFailure(() => send("invitation", { email, productName: name as string, url: link("invitation") }))).toBe(true);
  }
  expect(calls).toBe(2);
});
