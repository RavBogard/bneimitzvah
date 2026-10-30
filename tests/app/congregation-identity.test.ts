import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CRC_IDENTITY, isProductionOrigin, resolveIdentity } from "../../src/lib/site/identity";
import { canonicalNavigation, selectedCanonicalOrigin } from "../../src/lib/navigation/canonical";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { IdentityProvider, markImage } from "../../src/components/site/identity-context";
import { BrandMark, SiteBarView } from "../../src/components/site/site-bar";
import { webManifest } from "../../src/lib/offline/manifest";
import { proxy } from "../../src/proxy";
import { NextRequest } from "next/server";

import { randomBytes } from "node:crypto";
const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic"); database.username = "synthetic_login"; database.password = randomBytes(32).toString("hex"); database.searchParams.set("sslmode", "require");
const FORK = "https://torah.fork-congregation.example";
const forkEnv = { PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: FORK, CANONICAL_ORIGIN: FORK };
const ARTWORK = /brand\/(?:mural|icon|maskable|apple|favicon)/;

describe("congregation identity", () => {
  it("is CRC's exactly on CRC's origins and in an unconfigured local run, with no settings", () => {
    for (const env of [{ BETTER_AUTH_URL: "https://beitmitzvah.centralreform.org", PORTAL_ENVIRONMENT: "production" }, { BETTER_AUTH_URL: "https://bneimitzvah.vercel.app" },
      { BETTER_AUTH_URL: "http://localhost:3000", PORTAL_ENVIRONMENT: "local" }, {}]) {
      expect(resolveIdentity(env)).toBe(CRC_IDENTITY);
    }
    expect(CRC_IDENTITY).toMatchObject({ productName: "CRC Torah", name: "Central Reform Congregation", logo: { kind: "crc" } });
  });

  it("settings never change CRC's identity on a CRC origin", () => {
    expect(resolveIdentity({ BETTER_AUTH_URL: "https://torah.centralreform.org", CONGREGATION_NAME: "Other", CONGREGATION_LOGO: "x.png" })).toBe(CRC_IDENTITY);
  });

  it("falls back to the generic name with no logo anywhere else", () => {
    for (const env of [{ BETTER_AUTH_URL: FORK, PORTAL_ENVIRONMENT: "production" }, { BETTER_AUTH_URL: "https://preview-123.vercel.app", PORTAL_ENVIRONMENT: "preview" }, { PORTAL_ENVIRONMENT: "production" }]) {
      expect(resolveIdentity(env)).toMatchObject({ crc: false, name: "Beit Mitzvah", productName: "Beit Mitzvah", logo: { kind: "none" } });
    }
  });

  it("reads a fork's name, short name, aliases and its own logo", () => {
    const id = resolveIdentity({ ...forkEnv, CONGREGATION_NAME: "Temple Example", CONGREGATION_SHORT_NAME: "TE", ORIGIN_ALIASES: "Old.Example.org, torah.fork-congregation.example, bad host", CONGREGATION_LOGO: "logo.webp" });
    expect(id).toMatchObject({ crc: false, name: "Temple Example", shortName: "TE", productName: "TE Torah", canonicalOrigin: FORK, aliasHosts: ["old.example.org"], logo: { kind: "custom", src: "/logo.webp" } });
  });

  it("never lets a logo setting name the CRC artwork or anything but a bare image file", () => {
    for (const logo of ["brand/mural-512.png", "/brand/mural-64.webp", "../brand/mural-512.png", "public/brand/mural-512.png", "logo.svg", "logo", "..png", "https://x.example/a.png", "a b.png"]) {
      expect(resolveIdentity({ ...forkEnv, CONGREGATION_LOGO: logo }).logo).toEqual({ kind: "none" });
    }
  });

  it("the CRC artwork cannot appear on a non-CRC origin, with a missing, misconfigured or hostile logo setting", () => {
    for (const logo of [undefined, "", "brand/mural-512.png", "mural-512.png", "logo.png"]) {
      const identity = resolveIdentity({ ...forkEnv, CONGREGATION_LOGO: logo });
      expect(identity.crc).toBe(false);
      for (const size of ["small", "large"] as const) expect(JSON.stringify(markImage(identity.logo, size) ?? {})).not.toMatch(ARTWORK);
      expect(renderToStaticMarkup(createElement(IdentityProvider, { identity, children: createElement(BrandMark) }))).not.toMatch(ARTWORK);
      expect(renderToStaticMarkup(createElement(IdentityProvider, { identity, children: createElement(SiteBarView, { signedIn: false, pathname: "/" }) }))).not.toMatch(/\/brand\/|CRC/);
    }
    expect(renderToStaticMarkup(createElement(BrandMark))).toContain("/brand/mural-64.webp"); // CRC by default
    expect(JSON.stringify(webManifest("Beit Mitzvah", false))).not.toMatch(ARTWORK);
  });

  it("serves no /brand file off CRC's origins and still serves it on CRC's", () => {
    const keys = ["BETTER_AUTH_URL", "CANONICAL_ORIGIN", "CONGREGATION_NAME", "PORTAL_ENVIRONMENT"] as const;
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    try {
      Object.assign(process.env, { BETTER_AUTH_URL: FORK, PORTAL_ENVIRONMENT: "production", CANONICAL_ORIGIN: FORK });
      expect(proxy(new NextRequest(`${FORK}/brand/mural-512.png`)).status).toBe(404);
      process.env.BETTER_AUTH_URL = "https://torah.centralreform.org";
      expect(proxy(new NextRequest("https://torah.centralreform.org/brand/mural-512.png")).status).toBe(200);
    } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  });
});

describe("origin allowlists with a configured canonical origin", () => {
  it("production accepts CRC's list plus exactly the configured origin, and nothing else", () => {
    expect(isProductionOrigin(FORK, forkEnv)).toBe(true);
    expect(isProductionOrigin("https://torah.centralreform.org", {})).toBe(true);
    expect(isProductionOrigin(FORK, {})).toBe(false);
    for (const other of ["https://evil.example", `${FORK}/`, "https://www.fork-congregation.example", "http://torah.fork-congregation.example"]) expect(isProductionOrigin(other, forkEnv)).toBe(false);
    // An alias is never an origin, and an unusable canonical setting admits nothing.
    expect(isProductionOrigin("https://old.example.org", { ...forkEnv, ORIGIN_ALIASES: "old.example.org" })).toBe(false);
    expect(isProductionOrigin("http://localhost:3000", { CANONICAL_ORIGIN: "http://localhost:3000" })).toBe(false);
    expect(isProductionOrigin("https://x.example:8443", { CANONICAL_ORIGIN: "https://x.example:8443" })).toBe(false);
  });

  const runtime = (origin: string, extra: Record<string, string> = {}) => ({
    PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: origin,
    "DATABASE_URL": database.href, "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"),
    "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test", ...extra,
  });
  it("runtime configuration takes the fork's origin only when it is the configured one", () => {
    expect(loadRuntimeConfig(runtime(FORK, { CANONICAL_ORIGIN: FORK })).origin).toBe(FORK);
    expect(() => loadRuntimeConfig(runtime(FORK))).toThrow();
    expect(() => loadRuntimeConfig(runtime("https://other.fork-congregation.example", { CANONICAL_ORIGIN: FORK }))).toThrow();
    expect(loadRuntimeConfig(runtime("https://beitmitzvah.centralreform.org")).origin).toBe("https://beitmitzvah.centralreform.org");
    // A preview may never claim the configured production origin.
    expect(() => loadRuntimeConfig({ ...runtime(FORK, { CANONICAL_ORIGIN: FORK }), PORTAL_ENVIRONMENT: "preview", PORTAL_DEPLOYMENT: "preview" })).toThrow();
  });

  it("navigation selects the configured origin and its aliases redirect pages only", () => {
    const env = { ...forkEnv, ORIGIN_ALIASES: "old.example.org" };
    expect(selectedCanonicalOrigin(env)).toBe(FORK);
    expect(selectedCanonicalOrigin({ ...env, BETTER_AUTH_URL: "https://x.example" })).toBeNull();
    const get = (path: string, host: string, method = "GET") => canonicalNavigation({ url: `https://${host}${path}`, method, headers: new Headers({ host }) }, env);
    const page = get("/read?x=1", "old.example.org");
    expect(page?.status).toBe(303);
    expect(page?.headers.get("location")).toBe(`${FORK}/#home`);
    expect(get("/api/auth/session", "old.example.org")?.status).toBe(404);
    expect(get("/read", "old.example.org", "POST")?.status).toBe(404);
    expect(get("/read", "torah.fork-congregation.example")).toBeNull();
    // CRC's old aliases are not a fork's aliases, and a host nobody configured is not an alias.
    expect(get("/read", "bneimitzvah.vercel.app")).toBeNull();
    expect(get("/read", "unknown.example.org")).toBeNull();
  });
});
