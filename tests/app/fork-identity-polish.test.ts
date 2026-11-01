import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { resolveIdentity } from "../../src/lib/site/identity";
import { IdentityProvider } from "../../src/components/site/identity-context";
import { SiteBarView } from "../../src/components/site/site-bar";
import { SiteFooter } from "../../src/components/site/site-footer";

const FORK = "https://bneimitzvah.example.org";
const forkEnv = { PORTAL_ENVIRONMENT: "production", BETTER_AUTH_URL: FORK, CANONICAL_ORIGIN: FORK, CONGREGATION_NAME: "Example Congregation B'nei Mitzvah", CONGREGATION_SHORT_NAME: "Example" };
const stub = (env: Record<string, string>) => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); };
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("a fork's identity reaches the signed-in shell, the footer and the root layout", () => {
  it("the signed-in site bar names the fork, never the generic product", () => {
    const html = renderToStaticMarkup(createElement(IdentityProvider, { identity: resolveIdentity(forkEnv), children: createElement(SiteBarView, { signedIn: true, pathname: "/workspace" }) }));
    expect(html).toMatch(/data-testid="site-brand"[^>]*>.*Example Torah/);
    expect(html).not.toContain("Beit Mitzvah");
  });

  it("the footer hides the credit line off CRC's origins by default, and CRC keeps its own", () => {
    stub(forkEnv);
    const html = renderToStaticMarkup(createElement(SiteFooter));
    expect(html).not.toContain("danielbogard.com");
    expect(html).not.toContain('data-testid="upstream-credit"');
    expect(html).toContain("Example Congregation B&#x27;nei Mitzvah");
    vi.unstubAllEnvs();
    stub({ BETTER_AUTH_URL: "https://torah.centralreform.org" });
    expect(renderToStaticMarkup(createElement(SiteFooter))).toContain('A project of <a href="https://danielbogard.com"');
  });

  it("CREDIT_UPSTREAM=true, and only that, turns on the upstream credit", () => {
    for (const value of ["TRUE", "1", "yes", ""]) {
      vi.unstubAllEnvs(); stub({ ...forkEnv, CREDIT_UPSTREAM: value });
      expect(renderToStaticMarkup(createElement(SiteFooter))).not.toContain('data-testid="upstream-credit"');
    }
    vi.unstubAllEnvs(); stub({ ...forkEnv, CREDIT_UPSTREAM: "true" });
    const html = renderToStaticMarkup(createElement(SiteFooter));
    expect(html).toContain('data-testid="upstream-credit"');
    expect(html).toContain('href="https://github.com/RavBogard/bneimitzvah"');
    expect(html).not.toContain("danielbogard.com");
    // The one wording test for the line (approved wording).
    expect(html).toContain("Built on the <a");
    expect(html).toContain(">CRC Beit Mitzvah app by Rabbi Daniel Bogard</a>");
  });

  it("the root layout renders per request on a fork (so its settings are read at runtime) and stays static for CRC", async () => {
    const holds = (node: unknown, type: unknown): boolean => {
      if (!node || typeof node !== "object") return false;
      if (Array.isArray(node)) return node.some(n => holds(n, type));
      const el = node as ReactElement<{ children?: unknown }>;
      return el.type === type || holds(el.props?.children, type);
    };
    stub(forkEnv);
    const { PerRequest } = await import("../../src/components/site/per-request");
    const fork = (await import("../../src/app/layout")).default({ children: null });
    expect(holds(fork, PerRequest)).toBe(true);
    vi.unstubAllEnvs(); vi.resetModules(); stub({ BETTER_AUTH_URL: "https://torah.centralreform.org" });
    const crc = (await import("../../src/app/layout")).default({ children: null });
    expect(holds(crc, (await import("../../src/components/site/per-request")).PerRequest)).toBe(false);
  });
});
