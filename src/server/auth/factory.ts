import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins";

// Only the private HTTP adapter constructs this header. Never trust a caller's
// value or mount the unprojected SDK handler as an application route.
export const AUTH_RATE_LIMIT_HEADER = "x-portal-auth-bucket";

export type AuthStackInput = {
  origin: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  sendMagicLink: (message: { email: string; url: string; token: string }) => Promise<void>;
};

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
  return betterAuth({
    appName: "CRC B'nei Mitzvah",
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
      // In the pinned SDK this INSERT is reached only after the configured provider verified the
      // idToken and resolved its user. A magic link, a linked account or an older session never
      // inherits the marker; the portal MCP consents only from a Google-created session.
      const googleAuthenticated = Boolean(input.google && context?.path === "/sign-in/social"
        && context.method === "POST" && context.body?.provider === "google"
        && typeof context.body.idToken?.token === "string" && context.body.idToken.token.length > 0
        && context.context.socialProviders.some(provider => provider.id === "google"));
      // Always replace any supplied marker. Undefined (column omitted, so NULL) for every other
      // creation path, which also keeps magic-link sign-in working on a schema before 0028.
      return { data: { googleAuthenticatedAt: googleAuthenticated ? new Date() : undefined } };
    } } } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    advanced: { ipAddress: { ipAddressHeaders: [AUTH_RATE_LIMIT_HEADER], ipv6Subnet: 128 }, crossSubDomainCookies: { enabled: false }, useSecureCookies: origin.protocol === "https:" },
    // Provider/adapter diagnostics can contain identities or credentials. The app's
    // eventual allowlisted logger must never forward arbitrary library messages.
    logger: { disabled: true },
    plugins: [magicLink({ expiresIn: 300, storeToken: "hashed", sendMagicLink: input.sendMagicLink })],
  });
}
