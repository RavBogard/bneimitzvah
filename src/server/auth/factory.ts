import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createHmac } from "node:crypto";
import { emailOTP, magicLink } from "better-auth/plugins";

// Only the private HTTP adapter constructs this header. Never trust a caller's
// value or mount the unprojected SDK handler as an application route.
export const AUTH_RATE_LIMIT_HEADER = "x-portal-auth-bucket";

export type AuthStackInput = {
  origin: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  sendMagicLink: (message: { email: string; url: string; token: string }) => Promise<void>;
  /** Purpose key for the typed sign-in code at rest (an HMAC, never plain SHA-256: a 6-digit hash is trivially reversed). */
  codeSecret: string;
};
/** The typed sign-in code (1.5): 6 digits, 5 minutes like the link, 3 tries per issued code. */
export const SIGN_IN_CODE = Object.freeze({ digits: 6, expiresIn: 300, attempts: 3 });
/** Sign-up parity: a code signs in exactly the addresses a link does (both create the account on first use). */
export const SIGN_IN_DISABLE_SIGN_UP = false;

// No environment access, singleton, app handler, test bypass or mail sender here.
// Callers must first resolve an exact trusted origin and supply a private transport.
export function createAuthStack(
  db: Parameters<typeof drizzleAdapter>[0],
  schema: Record<string, unknown>,
  input: AuthStackInput,
) {
  const origin = new URL(input.origin);
  if (origin.origin !== input.origin || !["http:", "https:"].includes(origin.protocol)) {
    throw new Error("Invalid authentication origin");
  }
  if (typeof input.codeSecret !== "string" || input.codeSecret.length < 32) throw new Error("Invalid sign-in code secret");
  return betterAuth({
    appName: "CRC Torah",
    baseURL: input.origin,
    secret: input.secret,
    trustedOrigins: [input.origin],
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    emailAndPassword: { enabled: false },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    socialProviders: input.google ? { google: input.google } : {},
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60, freshAge: 15 * 60, cookieCache: { enabled: false },
      additionalFields: { googleAuthenticatedAt: { type: "date", required: false, input: false, returned: false } },
    },
    databaseHooks: { session: { create: { before: async (_session, context) => {
      // Only a session Google just created carries the marker: the ID-token POST (the SDK verified the
      // token and resolved its user) or the redirect-mode callback below. A magic link, a linked account
      // or an older session never inherits it; the portal MCP consents only from a Google-created session.
      const googleProvider = Boolean(input.google && context?.context.socialProviders.some(provider => provider.id === "google"));
      const idTokenFlow = context?.path === "/sign-in/social" && context.method === "POST" && context.body?.provider === "google"
        && typeof context.body.idToken?.token === "string" && context.body.idToken.token.length > 0;
      // Redirect mode: the SDK's GET /callback/:id (here id "google") creates a session only after it checked the
      // state (signed cookie and stored verification), exchanged the code with PKCE and the client
      // secret at Google's token endpoint, and resolved the Google user. Linking creates no session.
      const callbackFlow = context?.path === "/callback/:id" && context.method === "GET" && context.params?.id === "google";
      const googleAuthenticated = googleProvider && (idTokenFlow || callbackFlow);
      // Always replace any supplied marker. Undefined (column omitted, so NULL) for every other
      // creation path, which also keeps magic-link sign-in working on a schema before 0028.
      return { data: { googleAuthenticatedAt: googleAuthenticated ? new Date() : undefined } };
    } } } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    advanced: { ipAddress: { ipAddressHeaders: [AUTH_RATE_LIMIT_HEADER], ipv6Subnet: 128 }, crossSubDomainCookies: { enabled: false }, useSecureCookies: origin.protocol === "https:" },
    // Provider/adapter diagnostics can contain identities or credentials. The app's
    // eventual allowlisted logger must never forward arbitrary library messages.
    logger: { disabled: true },
    plugins: [magicLink({ expiresIn: 300, storeToken: "hashed", disableSignUp: SIGN_IN_DISABLE_SIGN_UP, sendMagicLink: input.sendMagicLink }),
      // Codes are created server-side inside the magic-link email (createVerificationOTP) and checked only through the
      // portal's /api/auth/sign-in/code route; every other email-otp endpoint is unreachable (the dispatcher routes an allowlist).
      emailOTP({ otpLength: SIGN_IN_CODE.digits, expiresIn: SIGN_IN_CODE.expiresIn, allowedAttempts: SIGN_IN_CODE.attempts, disableSignUp: SIGN_IN_DISABLE_SIGN_UP,
        storeOTP: { hash: async otp => createHmac("sha256", input.codeSecret).update(`sign-in-code:v1:${otp}`).digest("base64url") },
        sendVerificationOTP: async () => { throw new Error("Unused: sign-in codes travel inside the magic-link email"); } })],
  });
}
