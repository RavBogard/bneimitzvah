// The congregation's identity: name, canonical address, aliases and logo.
// Navigation and presentation only; this module grants no session, tenant or API authority.
//
// CRC's identity (and Siona Benjamin's floor artwork, licensed to CRC only) applies on CRC's own origins and, with no settings at all,
// in local development and tests. Anywhere else the identity comes from settings and falls back to a generic name with NO logo.
// A fork sets CONGREGATION_NAME, CONGREGATION_SHORT_NAME, CANONICAL_ORIGIN, ORIGIN_ALIASES and CONGREGATION_LOGO (see .env.example).
type Environment = Readonly<Record<string, string | undefined>>;

/** The only origins production accepts for CRC itself. */
export const CRC_ORIGINS: readonly string[] = Object.freeze([
  "https://beitmitzvah.centralreform.org", "https://bneimitzvah.centralreform.org", "https://bneimitzvah.vercel.app",
  "https://torah.centralreform.org",
]);
export const CRC_ALIAS_HOSTS: readonly string[] = Object.freeze([
  "barmitzvah.centralreform.org", "batmitzvah.centralreform.org", "bnaimitzvah.centralreform.org", "bneimitzvah.centralreform.org", "bneimitzvah.vercel.app",
]);
export const GENERIC_NAME = "Beit Mitzvah";

export type Logo = Readonly<{ kind: "crc" } | { kind: "custom"; src: string } | { kind: "none" }>;
export type Identity = Readonly<{
  /** True only when the CRC identity (and its licensed artwork) applies. */
  crc: boolean;
  name: string;
  shortName: string;
  /** The product's name in titles, the app bar and e-mails ("CRC Torah" for CRC). */
  productName: string;
  canonicalOrigin: string | null;
  aliasHosts: readonly string[];
  logo: Logo;
}>;

export const CRC_IDENTITY: Identity = Object.freeze({
  crc: true, name: "Central Reform Congregation", shortName: "CRC", productName: "CRC Torah",
  canonicalOrigin: null, aliasHosts: Object.freeze([...CRC_ALIAS_HOSTS]), logo: Object.freeze({ kind: "crc" as const }),
});

const NONE: Logo = Object.freeze({ kind: "none" as const });
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const text = (value: string | undefined) => {
  const v = value?.trim();
  return v && v.length <= 80 && !/[\x00-\x1f\x7f<>&"]/.test(v) ? v : null;
};
/** A fork's canonical address: an https origin, exactly, with a real DNS name (never a port, address, loopback or credentials). */
export function configuredOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== value || url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (!HOST.test(url.hostname) || /^\d+(?:\.\d+){3}$/.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
/** A fork's navigation aliases: bare DNS host names, comma separated. */
export function configuredAliases(value: string | undefined): string[] {
  const hosts: string[] = [];
  for (const part of (value ?? "").split(",")) {
    const host = part.trim().toLowerCase();
    if (HOST.test(host) && !/^\d+(?:\.\d+){3}$/.test(host) && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}
/** A fork's own logo: a bare file name in public/ (no path), so it can never name the CRC artwork under public/brand. */
export function configuredLogo(value: string | undefined): Logo {
  const file = value?.trim();
  return file && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(?:png|webp|jpe?g)$/.test(file) && !file.includes("..") ? { kind: "custom", src: `/${file}` } : NONE;
}

/** Whether the CRC identity applies to this environment: exactly CRC's origins, or an unconfigured local run. */
export function isCrcEnvironment(env: Environment): boolean {
  const origin = env.BETTER_AUTH_URL;
  if (origin && CRC_ORIGINS.includes(origin)) return true;
  if (env.CONGREGATION_NAME || env.CANONICAL_ORIGIN) return false;
  if (!origin) return !env.PORTAL_ENVIRONMENT || env.PORTAL_ENVIRONMENT === "local";
  return env.PORTAL_ENVIRONMENT !== "production" && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
}

export function resolveIdentity(env: Environment = process.env): Identity {
  if (isCrcEnvironment(env)) return CRC_IDENTITY;
  const name = text(env.CONGREGATION_NAME) ?? GENERIC_NAME;
  const short = text(env.CONGREGATION_SHORT_NAME);
  const canonicalOrigin = configuredOrigin(env.CANONICAL_ORIGIN);
  const canonicalHost = canonicalOrigin ? new URL(canonicalOrigin).host : null;
  return Object.freeze({
    crc: false, name, shortName: short ?? name, productName: short ? `${short} Torah` : name,
    canonicalOrigin,
    aliasHosts: Object.freeze(canonicalOrigin ? configuredAliases(env.ORIGIN_ALIASES).filter(host => host !== canonicalHost) : []),
    logo: configuredLogo(env.CONGREGATION_LOGO),
  });
}

/** Production's allowed origins: CRC's list plus the one configured canonical origin. Nothing else, and never an alias. */
export function isProductionOrigin(origin: string, env: Environment = process.env): boolean {
  if (CRC_ORIGINS.includes(origin)) return true;
  const configured = configuredOrigin(env.CANONICAL_ORIGIN);
  return configured !== null && configured === origin;
}
