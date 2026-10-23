import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { format } from "node:url";
import { CANONICAL_ORIGINS, canonicalNavigation, canonicalNavigationEnabled, selectedCanonicalOrigin } from "../../src/lib/navigation/canonical";

const BEIT = "https://beitmitzvah.centralreform.org", TORAH = "https://torah.centralreform.org";
const fixedAliases = ["barmitzvah.centralreform.org", "batmitzvah.centralreform.org", "bnaimitzvah.centralreform.org", "bneimitzvah.centralreform.org", "bneimitzvah.vercel.app"];
const production = { PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production" };
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

test("exactly two hard-coded CRC origins can be canonical, and the list is frozen", () => {
  expect(CANONICAL_ORIGINS).toEqual([BEIT, TORAH]);
  expect(Object.isFrozen(CANONICAL_ORIGINS)).toBe(true);
  expect(() => (CANONICAL_ORIGINS as unknown as string[]).push("https://foreign.example.test")).toThrow();
});

for (const selected of [BEIT, TORAH]) {
  const other = selected === BEIT ? TORAH : BEIT;
  const enabled = { ...production, BETTER_AUTH_URL: selected };
  const destination = `${selected}/#home`;
  const aliases = [...fixedAliases, new URL(other).host];

  describe(`BETTER_AUTH_URL selects ${selected}`, () => {
    test("the selection is exactly that origin", () => {
      expect(selectedCanonicalOrigin(enabled)).toBe(selected);
      expect(canonicalNavigationEnabled(enabled)).toBe(true);
    });

    test("the selected canonical is never its own alias, whatever the path or method", () => {
      const host = new URL(selected).host;
      for (const method of ["GET", "HEAD", "POST"]) for (const path of ["/", "/api/session", "/auth/email?token=synthetic-private"]) {
        expect(canonicalNavigation(request(host, path, method), enabled)).toBeNull();
      }
    });

    test("the other canonical redirects with exactly the selected origin's fixed destination", () => {
      const host = new URL(other).host;
      for (const method of ["GET", "HEAD"]) for (const path of ["/", "/read?x=1", "/auth/email?token=synthetic-private#token=synthetic-fragment"]) {
        const response = canonicalNavigation(request(host, path, method), enabled);
        privateResponse(response, 303);
        expect(response?.headers.get("location")).toBe(destination);
      }
      privateResponse(canonicalNavigation(request(host, "/api/session"), enabled), 404);
      privateResponse(canonicalNavigation(request(host, "/", "POST"), enabled), 404);
    });

    test("alias navigation uses one fixed private destination and clears path, query and fragment", () => {
      for (const host of aliases) for (const method of ["GET", "HEAD"]) {
        for (const path of ["/?state=synthetic-private#synthetic-fragment", "/auth/email/?token=synthetic-private", "/invitations/open#token=synthetic-fragment", "/workspace/student?returnTo=https://foreign.example.test"]) {
          const response = canonicalNavigation(request(host, path, method), enabled);
          privateResponse(response, 303);
          expect(response?.headers.get("location")).toBe(destination);
        }
        const internal = canonicalNavigation(request(host, "/account?code=synthetic-private", method, {}, "http://127.0.0.1:3192"), enabled);
        expect(internal?.headers.get("location")).toBe(destination);
      }
    });

    test("all alias APIs and mutations are rejected before body, cookie or SDK processing", () => {
      for (const host of aliases) for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        for (const path of ["/api", "/api/session", "/API/session", "/api/auth/google/challenge", "/api/auth/sign-in/social?token=synthetic-private", "/api/mcp"]) {
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
      for (const alias of [aliases[0], new URL(other).host]) {
        for (const extra of [{ "x-forwarded-host": "foreign.example.test" }, { "x-forwarded-host": `${alias},foreign.example.test` }, { "x-forwarded-host": new URL(selected).host },
          { "x-forwarded-proto": "http" }, { "x-forwarded-port": "80" }, { origin: "https://foreign.example.test" }, { origin: selected }, { origin: "null" }] as Record<string, string>[]) {
          const response = canonicalNavigation(request(alias, "/account", "GET", extra), enabled);
          privateResponse(response, 404); expect(response?.headers.has("location")).toBe(false);
        }
        // A request URL naming a different known host than the wire Host is conflicting authority.
        privateResponse(canonicalNavigation(request(alias, "/account", "GET", {}, selected), enabled), 404);
        for (const host of ["foreign.example.test", `${alias}.foreign.example.test`, `${alias}:443`, alias.toUpperCase(), ""]) {
          expect(canonicalNavigation(request(host, "/account", "GET", { "x-forwarded-host": alias, forwarded: `host=${alias}`, origin: `https://${alias}` }, "https://foreign.example.test"), enabled)).toBeNull();
        }
      }
      // Forwarded headers never turn the selected canonical into an alias.
      const host = new URL(selected).host;
      expect(canonicalNavigation(request(host, "/account", "GET", { "x-forwarded-host": new URL(other).host }), enabled)).toBeNull();
    });
  });
}

test("BETTER_AUTH_URL = beitmitzvah keeps today's behaviour: beitmitzvah serves, torah and every alias redirect to beitmitzvah", () => {
  const enabled = { ...production, BETTER_AUTH_URL: BEIT };
  expect(canonicalNavigation(request("beitmitzvah.centralreform.org", "/"), enabled)).toBeNull();
  for (const host of [...fixedAliases, "torah.centralreform.org"]) {
    const response = canonicalNavigation(request(host, "/"), enabled);
    privateResponse(response, 303);
    expect(response?.headers.get("location")).toBe("https://beitmitzvah.centralreform.org/#home");
  }
});

test("stable preactivation and rollback are inert; only an exact production selection of a hard-coded canonical activates", () => {
  const allHosts = [...fixedAliases, "beitmitzvah.centralreform.org", "torah.centralreform.org"];
  const inert = [{}, { ...production }, { ...production, BETTER_AUTH_URL: "https://bneimitzvah.vercel.app" }, { ...production, BETTER_AUTH_URL: "https://bneimitzvah.centralreform.org" },
    { ...production, BETTER_AUTH_URL: "https://foreign.example.test" }, { ...production, BETTER_AUTH_URL: "" },
    ...[BEIT, TORAH].flatMap(origin => [
      { ...production, BETTER_AUTH_URL: origin + "/" }, { ...production, BETTER_AUTH_URL: origin.toUpperCase() }, { ...production, BETTER_AUTH_URL: ` ${origin}` },
      { ...production, BETTER_AUTH_URL: origin.replace("https:", "http:") }, { ...production, BETTER_AUTH_URL: origin + ":443" }, { ...production, BETTER_AUTH_URL: new URL(origin).host },
      { ...production, BETTER_AUTH_URL: origin, PORTAL_ENVIRONMENT: "preview" }, { ...production, BETTER_AUTH_URL: origin, PORTAL_DEPLOYMENT: "other" },
      { ...production, BETTER_AUTH_URL: origin, PORTAL_ENVIRONMENT: "local" }, { PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: origin },
    ])];
  for (const env of inert) {
    expect(selectedCanonicalOrigin(env)).toBeNull();
    for (const host of allHosts) expect(canonicalNavigation(request(host), env)).toBeNull();
  }
});

test("the pinned Next redirect serializer preserves the fixed harmless fragment instead of dropping it", () => {
  // These are the actual parse/format operations in resolve-routes/router-server.
  const { parseUrl } = require("next/dist/shared/lib/router/utils/parse-url");
  const { getRelativeURL } = require("next/dist/shared/lib/router/utils/relativize-url");
  for (const origin of CANONICAL_ORIGINS) {
    const serialize = (location: string) => format(parseUrl(getRelativeURL(location, "https://barmitzvah.centralreform.org/auth/email?token=synthetic-private")));
    expect(serialize(origin + "/#")).toBe(origin + "/");
    expect(serialize(`${origin}/#home`)).toBe(origin + "/#home");
  }
});
