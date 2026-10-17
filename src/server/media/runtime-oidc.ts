import "server-only";
import { getContext } from "@vercel/oidc";

export const MEDIA_IDENTITY = Object.freeze({
  projectId: "prj_LaqPZuHk6W5XLlDpw29lUyyij3Sq", projectName: "bneimitzvah",
  teamId: "team_AyFDvnGV3IHjAY32PlW1tltN", teamSlug: "ravbogards-projects",
  storeId: "store_UOU7eX3fTuUHAs7G",
});
type Context = { headers?: Record<string, string> };
export type MediaCredential = Readonly<{ token: string; assertFresh(): void }>;
const invalid = () => { throw new Error("media-credential-unavailable"); };
function part(value: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return invalid();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) return invalid();
  const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!result || typeof result !== "object" || Array.isArray(result)) return invalid();
  return result as Record<string, unknown>;
}
/** Context acquisition only. Decoding is not signature verification; the provider
 * validates authority. No environment, refresh, CLI, cache or static fallback. */
export function createRuntimeMediaOidc({ context = getContext, now = Date.now }: { context?: () => Context; now?: () => number } = {}) {
  function current(minimumLife: number) {
    const token = context()?.headers?.["x-vercel-oidc-token"];
    if (typeof token !== "string" || token.length > 16384) return invalid();
    const pieces = token.split(".");
    if (pieces.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(pieces[2])) return invalid();
    if (Buffer.from(pieces[2], "base64url").toString("base64url") !== pieces[2]) return invalid();
    const h = part(pieces[0]), c = part(pieces[1]), p = MEDIA_IDENTITY, instant = now(), time = Math.floor(instant / 1000);
    if (h.typ !== "JWT" || h.alg !== "RS256" || typeof h.kid !== "string" || !h.kid.length || h.kid.length > 256
      || c.owner !== p.teamSlug || c.owner_id !== p.teamId || c.project !== p.projectName || c.project_id !== p.projectId
      || c.environment !== "production" || c.custom_environment_id !== undefined
      || c.sub !== `owner:${p.teamSlug}:project:${p.projectName}:environment:production`
      || !["https://oidc.vercel.com", `https://oidc.vercel.com/${p.teamSlug}`].includes(c.iss as string)
      || c.aud !== `https://vercel.com/${p.teamSlug}`
      || ![c.iat, c.nbf, c.exp].every(Number.isSafeInteger) || !Number.isSafeInteger(time)) return invalid();
    const issued = c.iat as number, before = c.nbf as number, expires = c.exp as number;
    if (issued < 0 || before < 0 || issued > time || before > time || expires <= issued || expires - issued > 7200 || expires * 1000 - instant < minimumLife * 1000 || expires * 1000 <= instant) return invalid();
    return token;
  }
  return Object.freeze({ acquire(): MediaCredential {
    try {
      const token = current(15);
      return Object.freeze({ token, assertFresh() { try { if (current(0) !== token) invalid(); } catch { invalid(); } } });
    } catch { return invalid(); }
  } });
}
