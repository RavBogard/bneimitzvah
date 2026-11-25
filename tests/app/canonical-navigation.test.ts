import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { format } from "node:url";
import { CANONICAL_ORIGINS, canonicalNavigation, canonicalNavigationEnabled, FRONT_DOOR_REDIRECT, selectedCanonicalOrigin, STUDY_ORIGIN, STUDY_REDIRECT } from "../../src/lib/navigation/canonical";
import { STUDY_LANDING, TORAH_ORIGIN } from "../../src/lib/offline/policy";
import { webManifest } from "../../src/lib/offline/manifest";

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
  // Daniel 2026-11-25: the torah host's root opens Study; every other arrival keeps the front door, which is at /home once torah is canonical.
  const destination = selected === TORAH ? `${selected}/home#home` : `${selected}/#home`;
  const landing = (host: string, path: string) => host === "torah.centralreform.org" && new URL(path, "https://x.example.test").pathname === "/" ? `${selected}/read?lens=study#home` : destination;
  const aliases = [...fixedAliases, new URL(other).host];

  describe(`BETTER_AUTH_URL selects ${selected}`, () => {
    test("the selection is exactly that origin", () => {
      expect(selectedCanonicalOrigin(enabled)).toBe(selected);
      expect(canonicalNavigationEnabled(enabled)).toBe(true);
    });

    test("the selected canonical is never its own alias, whatever the path or method", () => {
      const host = new URL(selected).host;
      for (const method of ["GET", "HEAD", "POST"]) for (const path of ["/", "/api/session", "/auth/email?token=synthetic-private"]) {
        // The torah host's own root, read only, is the one exception: it answers with Study (tested below).
        if (selected === TORAH && path === "/" && method !== "POST") continue;
        expect(canonicalNavigation(request(host, path, method), enabled)).toBeNull();
      }
    });

    test("the other canonical redirects with exactly the selected origin's fixed destination", () => {
      const host = new URL(other).host;
      for (const method of ["GET", "HEAD"]) for (const path of ["/", "/read?x=1", "/auth/email?token=synthetic-private#token=synthetic-fragment"]) {
        const response = canonicalNavigation(request(host, path, method), enabled);
        privateResponse(response, 303);
        expect(response?.headers.get("location")).toBe(landing(host, path));
      }
      privateResponse(canonicalNavigation(request(host, "/api/session"), enabled), 404);
      privateResponse(canonicalNavigation(request(host, "/", "POST"), enabled), 404);
    });

    test("alias navigation uses one fixed private destination and clears path, query and fragment", () => {
      for (const host of aliases) for (const method of ["GET", "HEAD"]) {
        for (const path of ["/?state=synthetic-private#synthetic-fragment", "/auth/email/?token=synthetic-private", "/invitations/open#token=synthetic-fragment", "/workspace/student?returnTo=https://foreign.example.test"]) {
          const response = canonicalNavigation(request(host, path, method), enabled);
          privateResponse(response, 303);
          expect(response?.headers.get("location")).toBe(landing(host, path));
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

test("BETTER_AUTH_URL = beitmitzvah: beitmitzvah serves its front door at /, every alias redirects to it, and torah's root alone opens Study there", () => {
  const enabled = { ...production, BETTER_AUTH_URL: BEIT };
  expect(canonicalNavigation(request("beitmitzvah.centralreform.org", "/"), enabled)).toBeNull();
  for (const host of fixedAliases) {
    const response = canonicalNavigation(request(host, "/"), enabled);
    privateResponse(response, 303);
    expect(response?.headers.get("location")).toBe("https://beitmitzvah.centralreform.org/#home");
  }
  for (const path of ["/", "/?state=synthetic-private#token=synthetic-fragment"]) {
    const response = canonicalNavigation(request("torah.centralreform.org", path), enabled);
    privateResponse(response, 303);
    expect(response?.headers.get("location")).toBe("https://beitmitzvah.centralreform.org/read?lens=study#home");
  }
  const off = canonicalNavigation(request("torah.centralreform.org", "/read"), enabled);
  expect(off?.headers.get("location")).toBe("https://beitmitzvah.centralreform.org/#home");
});

test("BETTER_AUTH_URL = torah: torah's root opens Study, the rest of torah is served, and beitmitzvah and every alias land on the front door at /home", () => {
  const enabled = { ...production, BETTER_AUTH_URL: TORAH };
  for (const method of ["GET", "HEAD"]) for (const path of ["/", "/?state=synthetic-private#token=synthetic-fragment"]) {
    const response = canonicalNavigation(request("torah.centralreform.org", path, method), enabled);
    privateResponse(response, 307);
    expect(response?.headers.get("location")).toBe("https://torah.centralreform.org/read?lens=study#home");
  }
  // An internally reconstructed request URL still reads its path; the destination never comes from the request.
  expect(canonicalNavigation(request("torah.centralreform.org", "/", "GET", {}, "http://127.0.0.1:3192"), enabled)?.headers.get("location")).toBe("https://torah.centralreform.org/read?lens=study#home");
  for (const path of ["/home", "/read", "/read?lens=study", "/account", "/api/session", "/sw.js", "//"]) expect(canonicalNavigation(request("torah.centralreform.org", path), enabled), path).toBeNull();
  for (const method of ["POST", "PUT"]) expect(canonicalNavigation(request("torah.centralreform.org", "/", method), enabled)).toBeNull();
  for (const host of ["beitmitzvah.centralreform.org", ...fixedAliases]) for (const path of ["/", "/?state=synthetic-private", "/read"]) {
    const response = canonicalNavigation(request(host, path), enabled);
    privateResponse(response, 303);
    expect(response?.headers.get("location")).toBe("https://torah.centralreform.org/home#home");
  }
});

test("a fork's canonical origin never takes the Study landing, and the redirect strings agree with the offline policy and the manifest", () => {
  const fork = "https://torah.fork-congregation.example", enabled = { ...production, BETTER_AUTH_URL: fork, CANONICAL_ORIGIN: fork, ORIGIN_ALIASES: "alias.fork-congregation.example" };
  expect(selectedCanonicalOrigin(enabled)).toBe(fork);
  expect(canonicalNavigation(request("torah.fork-congregation.example", "/"), enabled)).toBeNull();
  expect(canonicalNavigation(request("alias.fork-congregation.example", "/"), enabled)?.headers.get("location")).toBe(`${fork}/#home`);
  expect(STUDY_ORIGIN).toBe(TORAH_ORIGIN);
  expect(STUDY_REDIRECT).toBe(`${STUDY_LANDING}#home`);
  expect(FRONT_DOOR_REDIRECT).toBe("/home#home");
  // The installed app starts at the root: the manifest is linked on beitmitzvah too, whose root is the front door; on torah the root itself leads to Study.
  expect(webManifest("CRC Torah").start_url).toBe("/");
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
    for (const path of [STUDY_REDIRECT, FRONT_DOOR_REDIRECT]) expect(serialize(origin + path)).toBe(origin + path);
  }
});

test("N24 review F1: an alias serves its own /sw.js (exactly that path, read only), so an old worker there can update to the tombstone; every other alias path still redirects", () => {
  for (const selected of [BEIT, TORAH]) {
    const enabled = { ...production, BETTER_AUTH_URL: selected }, other = new URL(selected === BEIT ? TORAH : BEIT).host;
    for (const host of [other, ...fixedAliases]) {
      for (const method of ["GET", "HEAD"]) expect(canonicalNavigation(request(host, "/sw.js", method), enabled), `${host} ${method}`).toBeNull();
      for (const path of ["/", "/sw.js/", "/sw.jsx", "/SW.JS", "/x/sw.js", "/sw.js.map", "/%2Fsw.js", "/offline", "/read"]) privateResponse(canonicalNavigation(request(host, path), enabled), 303);
      for (const method of ["POST", "PUT", "DELETE"]) privateResponse(canonicalNavigation(request(host, "/sw.js", method), enabled), 404);
    }
  }
});
