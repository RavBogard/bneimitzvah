import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { format } from "node:url";
import { CANONICAL_DESTINATION, CANONICAL_ORIGIN, canonicalNavigation } from "../../src/lib/navigation/canonical";

const enabled = { PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: CANONICAL_ORIGIN };
const aliases = ["barmitzvah.centralreform.org", "batmitzvah.centralreform.org", "bnaimitzvah.centralreform.org", "bneimitzvah.centralreform.org", "bneimitzvah.vercel.app"];
const require = createRequire(import.meta.url);
function request(host: string, path = "/auth/email?token=synthetic-private#token=synthetic-fragment", method = "GET", extra: Record<string, string> = {}, origin = `https://${host}`) {
  return { url: origin + path, method, headers: new Headers({ host, ...extra }) };
}
function privateResponse(response: Response | null, status: number) {
  expect(response?.status).toBe(status);
  expect(response?.headers.get("cache-control")).toBe("private, no-store");
  expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response?.headers.has("set-cookie")).toBe(false);
}

test("alias navigation uses one fixed private destination and clears path, query and fragment", () => {
  for (const host of aliases) for (const method of ["GET", "HEAD"]) {
    for (const path of ["/?state=synthetic-private#synthetic-fragment", "/auth/email/?token=synthetic-private", "/invitations/open#token=synthetic-fragment", "/workspace/student?returnTo=https://foreign.example.test"]) {
      const response = canonicalNavigation(request(host, path, method), enabled);
      privateResponse(response, 303);
      expect(response?.headers.get("location")).toBe(CANONICAL_DESTINATION);
    }
    const internal = canonicalNavigation(request(host, "/account?code=synthetic-private", method, {}, "http://127.0.0.1:3192"), enabled);
    expect(internal?.headers.get("location")).toBe(CANONICAL_DESTINATION);
  }
});

test("all alias APIs and mutations are rejected before body, cookie or SDK processing", () => {
  for (const host of aliases) for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    for (const path of ["/api", "/api/session", "/api/auth/google/challenge", "/api/auth/sign-in/social?token=synthetic-private"]) {
      const input = request(host, path, method);
      Object.defineProperty(input, "body", { get() { throw new Error("Body must not be accessed"); } });
      const response = canonicalNavigation(input, enabled);
      privateResponse(response, 404); expect(response?.headers.has("location")).toBe(false);
    }
    if (!["GET", "HEAD"].includes(method)) {
      const response = canonicalNavigation(request(host, "/auth/email?token=synthetic-private", method), enabled);
      privateResponse(response, 404); expect(response?.headers.has("location")).toBe(false);
    }
  }
});

test("navigation classification never trusts forwarded aliases, conflicting public authority or foreign Origin", () => {
  const alias = aliases[0];
  for (const extra of [{ "x-forwarded-host": "foreign.example.test" }, { "x-forwarded-host": `${alias},foreign.example.test` },
    { "x-forwarded-proto": "http" }, { "x-forwarded-port": "80" }, { origin: "https://foreign.example.test" }, { origin: CANONICAL_ORIGIN }, { origin: "null" }] as Record<string, string>[]) {
    const response = canonicalNavigation(request(alias, "/account", "GET", extra), enabled);
    privateResponse(response, 404); expect(response?.headers.has("location")).toBe(false);
  }
  privateResponse(canonicalNavigation(request(alias, "/account", "GET", {}, CANONICAL_ORIGIN), enabled), 404);
  for (const host of ["foreign.example.test", `${alias}.foreign.example.test`, `${alias}:443`, alias.toUpperCase(), ""]) {
    expect(canonicalNavigation(request(host, "/account", "GET", { "x-forwarded-host": alias, forwarded: `host=${alias}`, origin: `https://${alias}` }, "https://foreign.example.test"), enabled)).toBeNull();
  }
  expect(canonicalNavigation(request("beitmitzvah.centralreform.org"), enabled)).toBeNull();
});

test("stable preactivation and rollback are inert; exact production canonical configuration alone activates", () => {
  for (const env of [{}, { ...enabled, BETTER_AUTH_URL: "https://bneimitzvah.vercel.app" }, { ...enabled, BETTER_AUTH_URL: CANONICAL_ORIGIN + "/" },
    { ...enabled, PORTAL_ENVIRONMENT: "preview" }, { ...enabled, PORTAL_DEPLOYMENT: "other" }]) {
    for (const host of aliases) expect(canonicalNavigation(request(host), env)).toBeNull();
  }
});

test("the pinned Next redirect serializer preserves the fixed harmless fragment instead of dropping it", () => {
  // These are the actual parse/format operations in resolve-routes/router-server.
  const { parseUrl } = require("next/dist/shared/lib/router/utils/parse-url");
  const { getRelativeURL } = require("next/dist/shared/lib/router/utils/relativize-url");
  const serialize = (location: string) => format(parseUrl(getRelativeURL(location, "https://barmitzvah.centralreform.org/auth/email?token=synthetic-private")));
  expect(serialize(CANONICAL_ORIGIN + "/#")).toBe(CANONICAL_ORIGIN + "/");
  expect(serialize(CANONICAL_DESTINATION)).toBe(CANONICAL_ORIGIN + "/#home");
});
