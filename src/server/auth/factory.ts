import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins";

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
    session: { expiresIn: 7 * 24 * 60 * 60, freshAge: 15 * 60, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    advanced: { crossSubDomainCookies: { enabled: false }, useSecureCookies: origin.protocol === "https:" },
    // Provider/adapter diagnostics can contain identities or credentials. The app's
    // eventual allowlisted logger must never forward arbitrary library messages.
    logger: { disabled: true },
    plugins: [magicLink({ expiresIn: 300, storeToken: "hashed", sendMagicLink: input.sendMagicLink })],
  });
}
