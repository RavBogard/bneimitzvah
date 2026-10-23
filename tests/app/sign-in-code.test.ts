import { createHash, randomBytes } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/pglite";
import { eq, like } from "drizzle-orm";
import { authFixture } from "./auth-stack-helper";
import * as schema from "../../src/server/db/index";
import { composeRuntime, type HttpRuntime } from "../../src/server/runtime/composition";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { AUTH_RATE_LIMIT_HEADER, SIGN_IN_CODE, SIGN_IN_DISABLE_SIGN_UP } from "../../src/server/auth/factory";
import { SIGN_IN_CODE_LINES } from "../../src/server/mail/transport";

// Synthetic only: every "email" is captured from a stubbed Resend fetch and nothing leaves the process.
type Mail = { email: string; subject: string; text: string; url: string; code: string };
const opened: Awaited<ReturnType<typeof authFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(f => f.client.close())); });
const codeLabel = /^Or enter this code in the .+ app:$/;

async function fixture(origin = "http://localhost:3000", productName?: string) {
  const f = await authFixture(); opened.push(f);
  const db = drizzle(f.client, { schema });
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic"); database.username = "synthetic_login"; database.password = randomBytes(32).toString("hex"); database.searchParams.set("sslmode", "require");
  const production = origin.startsWith("https:");
  const config = loadRuntimeConfig({ PORTAL_ENVIRONMENT: production ? "production" : "local", PORTAL_DEPLOYMENT: production ? "production" : "sign-in-code", BETTER_AUTH_URL: origin,
    "DATABASE_URL": database.href, "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" });
  if (!production) await db.insert(schema.tenantHost).values({ host: new URL(origin).host, origin, tenantId: "crc", environment: "local", deployment: config.deployment.deployment });
  if (productName !== undefined) await db.update(schema.tenant).set({ productName }).where(eq(schema.tenant.id, "crc"));
  await f.client.exec("CREATE ROLE code_login LOGIN; GRANT portal_runtime TO code_login; SET SESSION AUTHORIZATION code_login; SET ROLE portal_runtime");
  const messages: Mail[] = [];
  const runtime = composeRuntime(config, db, async (endpoint, options) => {
    if (String(endpoint) !== "https://api.resend.com/emails") throw new Error("Unexpected synthetic provider");
    const payload = JSON.parse(String(options?.body));
    const text = String(payload.text), url = text.match(/https?:\/\/\S+/)?.[0];
    // The code is alone on the line after its label.
    const lines = text.split("\n"), label = lines.findIndex(value => codeLabel.test(value)), line = label >= 0 ? lines[label + 1] : undefined;
    if (!url || !Array.isArray(payload.to) || !line) throw new Error("Invalid synthetic mail capture");
    messages.push({ email: payload.to[0], subject: String(payload.subject), text, url, code: line });
    return new Response("{}", { status: 200 });
  });
  const sdk = vi.spyOn(runtime.auth, "handler");
  const dispatch = createHttpDispatcher(async action => action(runtime as HttpRuntime));
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(origin + path, body === undefined ? { headers } : {
    method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const bindingName = production ? "__Secure-portal-code" : "portal-code";
  const bindingOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).find(value => value.startsWith(`${bindingName}=`)) ?? "";
  async function ask(email: string, cookie = "") {
    const response = await dispatch(request("/api/auth/sign-in/magic-link", { email }, cookie ? { cookie } : {}));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ requested: true });
    return { response, binding: bindingOf(response), mail: messages.at(-1)! };
  }
  const enter = (code: unknown, cookie: string, headers: Record<string, string> = {}) => dispatch(request("/api/auth/sign-in/code", { code }, { ...(cookie ? { cookie } : {}), ...headers }));
  const codeRows = () => db.select().from(schema.verification).where(like(schema.verification.identifier, "sign-in-otp-%"));
  return { runtime, sdk, dispatch, request, messages, origin, db, ask, enter, bindingName, bindingOf, codeRows };
}
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

test("one sign-in email carries the link and a 6-digit code in its body only, and the right code signs this device in once", async () => {
  for (const origin of ["http://localhost:3000", "https://bneimitzvah.centralreform.org"]) {
    const f = await fixture(origin);
    const { response, binding, mail } = await f.ask("Code-Learner@Example.test");
    expect(f.messages).toHaveLength(1);
    expect(mail.code).toMatch(/^\d{6}$/);
    expect(mail.subject).not.toMatch(/\d/);
    expect(mail.text.indexOf(mail.url)).toBeLessThan(mail.text.indexOf(mail.code));
    expect(mail.text.match(/\d{6,}/g)).toEqual([mail.code]);
    expect(mail.text.includes(SIGN_IN_CODE_LINES.once)).toBe(true);
    expect(mail.text.includes(SIGN_IN_CODE_LINES.never("CRC Torah"))).toBe(true);
    // The binding: sealed, HttpOnly, SameSite=Strict, scoped to the code route only, 5 minutes, Secure on HTTPS.
    const set = response.headers.getSetCookie().find(value => value.startsWith(`${f.bindingName}=`))!;
    expect(set).toMatch(new RegExp(`^${f.bindingName}=[A-Za-z0-9_-]{40,}; Path=/api/auth/sign-in/code; HttpOnly; SameSite=Strict; Max-Age=300${origin.startsWith("https:") ? "; Secure" : ""}$`));
    expect(set.toLowerCase().includes("domain=")).toBe(false);
    expect(binding.toLowerCase().includes("code-learner")).toBe(false);

    const signed = await f.enter(mail.code, binding);
    expect(signed.status).toBe(200);
    expect(await signed.json()).toEqual({ ok: true, next: "/" });
    expect(signed.headers.getSetCookie().some(value => value.startsWith(`${f.bindingName}=;`) && value.includes("Max-Age=0"))).toBe(true);
    const session = cookieOf(signed);
    const proof = await f.runtime.auth.api.getSession({ headers: new Headers({ cookie: session }), query: { disableRefresh: true } });
    expect(proof?.user.email).toBe("code-learner@example.test");
    expect(proof?.user.emailVerified).toBe(true);
    // A code session is not a Google session: the MCP consent marker stays empty.
    const rows = await f.db.select({ at: schema.session.googleAuthenticatedAt }).from(schema.session).where(eq(schema.session.userId, proof!.user.id));
    expect(rows).toHaveLength(1); expect(rows[0].at).toBeNull();
    // Single use: the same code with the same (kept) binding is refused and nothing new is created.
    const replay = await f.enter(mail.code, binding);
    expect(replay.status).toBe(409); expect(await replay.json()).toEqual({ error: "expired" });
    expect(await f.codeRows()).toHaveLength(0);
    // The link from the same email still works on its own during its 5 minutes (two independent credentials).
    const link = await f.dispatch(f.request("/api/auth/email/confirm", { token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token")! }));
    expect(link.status).toBe(200);
  }
});

test("the stored code is a keyed HMAC, never the code or its plain SHA-256", async () => {
  const f = await fixture();
  const { mail } = await f.ask("hmac@example.test");
  const rows = await f.codeRows();
  expect(rows).toHaveLength(1);
  expect(rows[0].identifier).toBe("sign-in-otp-hmac@example.test");
  expect(rows[0].value).toMatch(/^[A-Za-z0-9_-]{43}:0$/);
  const stored = rows[0].value.split(":")[0];
  for (const plain of [mail.code, createHash("sha256").update(mail.code).digest("hex"), createHash("sha256").update(mail.code).digest("base64url"),
    createHash("sha256").update(mail.code).digest("base64"), createHash("sha256").update(`sign-in-code:v1:${mail.code}`).digest("base64url")]) expect(stored === plain).toBe(false);
  expect(rows[0].value.includes(mail.code)).toBe(false);
  expect(rows[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(SIGN_IN_CODE.expiresIn * 1000);
});

test("the body is closed to one 6-digit code; anything else is a 400 that never reaches the auth SDK", async () => {
  const f = await fixture();
  const { binding } = await f.ask("closed@example.test");
  f.sdk.mockClear();
  for (const code of ["12345", "1234567", "12a456", " 123456", "123456 ", "１２３４５６", 123456, null, ["123456"], ""]) {
    const response = await f.enter(code, binding);
    expect(response.status).toBe(400);
  }
  for (const body of [{ code: "123456", email: "closed@example.test" }, {}, { otp: "123456" }, "123456"]) {
    expect((await f.dispatch(f.request("/api/auth/sign-in/code", body, { cookie: binding }))).status).toBe(400);
  }
  expect(f.sdk).not.toHaveBeenCalled();
  expect((await f.dispatch(f.request("/api/auth/sign-in/code", undefined, { cookie: binding }))).status).toBe(405);
});

test("a missing, tampered, foreign-scheme, expired or duplicated binding is refused without trying the code", async () => {
  const f = await fixture();
  const { binding, mail } = await f.ask("binding@example.test");
  f.sdk.mockClear();
  const value = binding.slice(binding.indexOf("=") + 1);
  const flipped = value.slice(0, 20) + (value[20] === "A" ? "B" : "A") + value.slice(21);
  for (const cookie of ["", `portal-code=${flipped}`, `portal-code=${value.slice(0, -2)}`, `__Secure-portal-code=${value}`, `${binding}; __Secure-portal-code=${value}`, "portal-code=" + "A".repeat(60)]) {
    const response = await f.enter(mail.code, cookie);
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "expired" });
    expect(response.headers.getSetCookie().some(set => set.startsWith("portal-code=;") && set.includes("Max-Age=0"))).toBe(true);
  }
  // The dispatcher refuses a duplicated cookie name outright.
  expect((await f.enter(mail.code, `${binding}; ${binding}`)).status).toBe(400);
  // A binding sealed for another origin (key and associated data differ) is refused too.
  const other = await fixture("https://bneimitzvah.centralreform.org");
  const foreign = (await other.ask("binding@example.test")).binding;
  expect((await f.enter(mail.code, `portal-code=${foreign.slice(foreign.indexOf("=") + 1)}`)).status).toBe(409);
  // Past its 5 minutes the binding is dead even though the cookie was kept.
  const now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now + SIGN_IN_CODE.expiresIn * 1000 + 1);
  expect((await f.enter(mail.code, binding)).status).toBe(409);
  vi.mocked(Date.now).mockRestore();
  expect(f.sdk).not.toHaveBeenCalled();
  // The real binding still works afterwards: none of the refusals spent a try.
  expect((await f.enter(mail.code, binding)).status).toBe(200);
});

test("three wrong codes spend the code: the third answers expired and the right code cannot follow, from any binding", async () => {
  const f = await fixture();
  const { binding, mail } = await f.ask("tries@example.test");
  for (let attempt = 1; attempt <= SIGN_IN_CODE.attempts; attempt++) {
    const response = await f.enter(wrong(mail.code), binding);
    if (attempt < SIGN_IN_CODE.attempts) {
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "code" });
      expect(response.headers.getSetCookie()).toHaveLength(0);
    } else {
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "expired" });
      expect(response.headers.getSetCookie().some(set => set.startsWith("portal-code=;") && set.includes("Max-Age=0"))).toBe(true);
    }
  }
  // The spent row stays for the SDK to refuse; the portal never deletes codes itself, so it cannot remove a newer one.
  expect(await f.codeRows()).toHaveLength(1);
  // A fresh binding for the same address (a new limiter bucket) does not bring the spent code back.
  const fresh = f.runtime.signInCodes.issue("tries@example.test").split(";")[0];
  const fourth = await f.enter(mail.code, fresh);
  expect(fourth.status).toBe(409); expect(await fourth.json()).toEqual({ error: "expired" });
  expect(fourth.headers.getSetCookie().some(set => set.startsWith("better-auth"))).toBe(false);
  expect(await f.codeRows()).toHaveLength(0);
  // Asking again after a spent code gives a new code that works.
  const again = await f.ask("tries@example.test");
  expect(again.mail.code).toMatch(/^\d{6}$/);
  expect((await f.enter(again.mail.code, again.binding)).status).toBe(200);
});

test("the attempt limit is the SDK's own: a stale fourth try with the right code is refused as too many attempts", async () => {
  const f = await fixture();
  const { mail } = await f.ask("sdk-tries@example.test");
  // Spend the tries through the SDK itself, each from its own synthetic limiter address, so only the code's own
  // attempt count can refuse the fourth (the portal's early "expired" is a courtesy, not the limit).
  for (let attempt = 0; attempt < SIGN_IN_CODE.attempts; attempt++) {
    const sdk = await f.runtime.auth.handler(new Request(`${f.origin}/api/auth/sign-in/email-otp`, { method: "POST",
      headers: { origin: f.origin, "content-type": "application/json", [AUTH_RATE_LIMIT_HEADER]: `2001:db8::${attempt + 1}` }, body: JSON.stringify({ email: "sdk-tries@example.test", otp: wrong(mail.code) }) }));
    expect(sdk.status).toBe(400);
  }
  const rows = await f.codeRows();
  expect(rows).toHaveLength(1); expect(rows[0].value.endsWith(`:${SIGN_IN_CODE.attempts}`)).toBe(true);
  const fourth = await f.enter(mail.code, f.runtime.signInCodes.issue("sdk-tries@example.test").split(";")[0]);
  expect(fourth.status).toBe(409); expect(await fourth.json()).toEqual({ error: "expired" });
});

test("latest code wins: a second email's code works and the first email's code is refused", async () => {
  const f = await fixture();
  const first = await f.ask("latest@example.test");
  const second = await f.ask("latest@example.test");
  expect(f.messages).toHaveLength(2);
  if (first.mail.code !== second.mail.code) {
    const old = await f.enter(first.mail.code, second.binding);
    expect(old.status).toBe(400); expect(await old.json()).toEqual({ error: "code" });
  }
  const signed = await f.enter(second.mail.code, second.binding);
  expect(signed.status).toBe(200); expect(await signed.json()).toEqual({ ok: true, next: "/" });
});

test("a code binds to the address that asked: another address's binding cannot use it", async () => {
  const f = await fixture();
  const victim = await f.ask("victim@example.test");
  const attacker = await f.ask("attacker@example.test");
  const response = await f.enter(victim.mail.code, attacker.binding);
  if (victim.mail.code !== attacker.mail.code) { expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "code" }); }
  const proof = await f.runtime.auth.api.getSession({ headers: new Headers({ cookie: cookieOf(response) }), query: { disableRefresh: true } });
  expect(proof?.user.email ?? null).not.toBe("victim@example.test");
});

test("sign-up parity with the link: a new address signs in with its code and becomes a verified user with no access", async () => {
  expect(SIGN_IN_DISABLE_SIGN_UP).toBe(false);
  const f = await fixture();
  const plugins = f.runtime.auth.options.plugins as readonly { id: string; options?: { disableSignUp?: boolean } }[];
  expect(plugins.find(plugin => plugin.id === "magic-link")?.options?.disableSignUp).toBe(SIGN_IN_DISABLE_SIGN_UP);
  const { binding, mail } = await f.ask("brand-new@example.test");
  const signed = await f.enter(mail.code, binding);
  expect(signed.status).toBe(200);
  const users = await f.db.select().from(schema.user).where(eq(schema.user.email, "brand-new@example.test"));
  expect(users).toHaveLength(1); expect(users[0].emailVerified).toBe(true);
  expect(await f.db.select().from(schema.membership)).toHaveLength(0);
  const summary = await f.dispatch(f.request("/api/session", undefined, { cookie: cookieOf(signed) }));
  expect((await summary.json()).roles).toEqual([]);
});

test("known and unknown addresses get the same answers to asking and to a wrong code", async () => {
  const f = await fixture();
  const known = await f.ask("known@example.test");
  expect((await f.enter(known.mail.code, known.binding)).status).toBe(200);
  const again = await f.ask("known@example.test"), unknown = await f.ask("nobody@example.test");
  const shape = (response: Response) => ({ status: response.status, cookies: response.headers.getSetCookie().map(value => value.replace(/=[^;]*/, "=")) });
  expect(shape(again.response)).toEqual(shape(unknown.response));
  const a = await f.enter(wrong(again.mail.code), again.binding), b = await f.enter(wrong(unknown.mail.code), unknown.binding);
  expect(shape(a)).toEqual(shape(b));
  expect(await a.json()).toEqual(await b.json());
});

test("a pending invitation only changes where the code sends the person; it never accepts the invitation", async () => {
  const f = await fixture();
  const staged = await f.dispatch(f.request("/api/invitations/open", { token: randomBytes(32).toString("base64url") }));
  expect(await staged.json()).toEqual({ ok: true, next: "/invitations/accept" });
  const pending = cookieOf(staged);
  const { binding, mail } = await f.ask("invited@example.test", pending);
  const signed = await f.enter(mail.code, `${pending}; ${binding}`);
  expect(signed.status).toBe(200); expect(await signed.json()).toEqual({ ok: true, next: "/invitations/accept" });
  expect(await f.db.select().from(schema.membership)).toHaveLength(0);
});

test("the code route keeps the cookie-mutation and practice-context boundaries", async () => {
  const f = await fixture();
  const { binding, mail } = await f.ask("boundary@example.test");
  f.sdk.mockClear();
  expect((await f.enter(mail.code, binding, { "X-Practice-Context": "synthetic" })).status).toBe(403);
  expect((await f.enter(mail.code, binding, { origin: "https://foreign.example.test" })).status).toBe(403);
  expect((await f.dispatch(new Request(`${f.origin}/api/auth/sign-in/code`, { method: "POST", headers: { "content-type": "application/json", cookie: binding }, body: JSON.stringify({ code: mail.code }) }))).status).toBe(403);
  expect((await f.dispatch(new Request(`${f.origin}/api/auth/sign-in/code?code=${mail.code}`, { method: "POST", headers: { origin: f.origin, "content-type": "application/json", cookie: binding }, body: JSON.stringify({ code: mail.code }) }))).status).toBe(400);
  expect(f.sdk).not.toHaveBeenCalled();
  expect((await f.enter(mail.code, binding)).status).toBe(200);
});

test("every email-otp endpoint of the SDK is unreachable through the portal", async () => {
  const f = await fixture();
  const { mail } = await f.ask("unreachable@example.test");
  f.sdk.mockClear();
  for (const path of ["/api/auth/sign-in/email-otp", "/api/auth/email-otp/send-verification-otp", "/api/auth/email-otp/check-verification-otp", "/api/auth/email-otp/verify-email",
    "/api/auth/email-otp/request-password-reset", "/api/auth/email-otp/reset-password", "/api/auth/forget-password/email-otp", "/api/auth/email-otp/request-email-change",
    "/api/auth/email-otp/change-email", "/api/auth/email-otp/create-verification-otp", "/api/auth/email-otp/get-verification-otp?email=unreachable%40example.test&type=sign-in"]) {
    expect((await f.dispatch(f.request(path, { email: "unreachable@example.test", otp: mail.code, type: "sign-in" }))).status).toBe(404);
    expect((await f.dispatch(f.request(path))).status).toBe(404);
  }
  expect(f.sdk).not.toHaveBeenCalled();
  expect(f.messages).toHaveLength(1);
});

test("each binding has its own limiter, apart from the shared sign-in email limiter", async () => {
  const f = await fixture();
  const one = await f.ask("bucket-one@example.test"), two = await f.ask("bucket-two@example.test");
  // Wrong codes on one binding never limit another binding or asking for email.
  expect((await f.enter(wrong(one.mail.code), one.binding)).status).toBe(400);
  expect((await f.enter(wrong(one.mail.code), one.binding)).status).toBe(400);
  expect((await f.enter(wrong(one.mail.code), one.binding)).status).toBe(409);
  const limited = await f.enter(one.mail.code, one.binding);
  expect(limited.status).toBe(429); expect(await limited.json()).toEqual({ error: "rate-limited" });
  expect((await f.ask("bucket-three@example.test")).response.status).toBe(200);
  expect((await f.enter(two.mail.code, two.binding)).status).toBe(200);
  // Filling the shared email limiter never stops a code already on its way.
  const waiting = await f.ask("bucket-four@example.test");
  let refused = false;
  for (let index = 0; index < 8 && !refused; index++) refused = (await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: `flood-${index}@example.test` }))).status === 429;
  expect(refused).toBe(true);
  expect((await f.enter(waiting.mail.code, waiting.binding)).status).toBe(200);
});

test("the code never appears in any console line, response body or response header", async () => {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
  const f = await fixture();
  const { response, binding, mail } = await f.ask("quiet@example.test");
  const texts: string[] = [JSON.stringify([...response.headers])];
  for (const attempt of [wrong(mail.code), mail.code]) {
    const answer = await f.enter(attempt, binding);
    texts.push(JSON.stringify([...answer.headers]), await answer.text());
  }
  expect(lines.some(line => line.includes(mail.code))).toBe(false);
  expect(texts.some(text => text.includes(mail.code))).toBe(false);
  expect(texts.some(text => text.toLowerCase().includes("quiet@example.test"))).toBe(false);
});

test("the email names the product from this congregation's own setting", async () => {
  const f = await fixture("http://localhost:3000", "Temple Torah");
  const { mail, binding } = await f.ask("other-name@example.test");
  expect(mail.subject).toBe("Sign in to Temple Torah");
  expect(mail.text.includes(`${SIGN_IN_CODE_LINES.code("Temple Torah")}\n${mail.code}\n`)).toBe(true);
  expect(mail.text.includes(SIGN_IN_CODE_LINES.never("Temple Torah"))).toBe(true);
  expect(mail.text.includes("CRC Torah")).toBe(false);
  expect((await f.enter(mail.code, binding)).status).toBe(200);
});

test("a stored product name the email refuses leaves no code behind and sends nothing", async () => {
  const f = await fixture("http://localhost:3000", "Torah 2");
  const response = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "refused-name@example.test" }));
  expect(response.status).toBeGreaterThanOrEqual(500);
  expect(f.bindingOf(response)).toBe("");
  expect(f.messages).toHaveLength(0);
  expect(await f.codeRows()).toHaveLength(0);
});

test("if the code cannot be created, no email is sent and the request fails closed", async () => {
  const f = await fixture();
  vi.spyOn(f.runtime.auth.api, "createVerificationOTP").mockRejectedValueOnce(new Error("Synthetic code failure"));
  const response = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "closed-fail@example.test" }));
  expect(response.status).toBeGreaterThanOrEqual(500);
  expect(f.bindingOf(response)).toBe("");
  expect(f.messages).toHaveLength(0);
});
