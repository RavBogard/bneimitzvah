import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const reads: string[] = [];
vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readFile: ((path: unknown, ...rest: unknown[]) => { reads.push(String(path)); return (original.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest); }) as typeof original.readFile };
});

const KEYS = ["BETTER_AUTH_URL", "CANONICAL_ORIGIN", "CONGREGATION_NAME", "CONGREGATION_LOGO", "PORTAL_ENVIRONMENT"] as const;
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } reads.length = 0; });
const brandReads = () => reads.filter(path => /[\\/]brand[\\/]/.test(path));

// /learn, /read and /trope-chart prerender their opengraph-image and twitter-image through renderShareCard at build time, in the build's environment.
describe("the prerendered share cards", () => {
  it("never read the CRC artwork when the build is not a CRC build, whatever the logo setting says", async () => {
    const { renderShareCard } = await import("../../src/server/public-site/share-card");
    for (const settings of [{}, { CONGREGATION_LOGO: "brand/mural-512.png" }, { BETTER_AUTH_URL: "https://torah.fork-congregation.example", CANONICAL_ORIGIN: "https://torah.fork-congregation.example" }]) {
      for (const k of KEYS) delete process.env[k];
      Object.assign(process.env, { PORTAL_ENVIRONMENT: "production" }, settings);
      reads.length = 0;
      const response = await renderShareCard("This week", "Beit Mitzvah");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
      expect(brandReads()).toEqual([]);
    }
  });

  it("reads the CRC floor on CRC's own build", async () => {
    const { renderShareCard } = await import("../../src/server/public-site/share-card");
    process.env.BETTER_AUTH_URL = "https://torah.centralreform.org";
    await (await renderShareCard("This week", "CRC Torah")).arrayBuffer();
    expect(brandReads().length).toBeGreaterThan(0);
  });
});
