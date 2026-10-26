import { describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { inflateSync } from "node:zlib";
import { unavailableExtras } from "../helpers/translations";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { AccessDenied } from "../../src/server/access/errors";
import { webManifest } from "../../src/lib/offline/manifest";
import { ICON_SIZES } from "../../src/lib/offline/icon";
import { GET as iconRoute } from "../../src/app/icons/[name]/route";
import { GET as appleRoute } from "../../src/app/apple-touch-icon.png/route";
import { GET as faviconRoute } from "../../src/app/favicon.ico/route";
import { GET as workerRoute } from "../../src/app/sw.js/route";
import { workerEnvironment } from "../../src/lib/offline/worker-source";

const ORIGIN = "https://torah.centralreform.org";
function runtime(productName?: () => Promise<string>, tenant: () => Promise<void> = async () => undefined): PublicRuntime {
  return { resolveTenant: tenant, reading: {} as PublicRuntime["reading"], commentary: (async () => { throw new Error("unused"); }) as unknown as PublicRuntime["commentary"], ...unavailableExtras, ...(productName ? { productName } : {}) };
}
const call = (r: PublicRuntime, path = "/api/public/manifest", init: RequestInit = {}) => handlePublicReadingRequest(new Request(ORIGIN + path, init), async action => action(r));

describe("the web app manifest", () => {
  test("names the app from the congregation's productName (E1), standalone at the root, lake on canvas, no push fields", async () => {
    for (const name of ["CRC Torah", "Synthetic Torah"]) {
      const response = await call(runtime(async () => name));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
      expect(response.headers.get("set-cookie")).toBeNull(); expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=3600");
      const body = await response.json();
      expect(body).toEqual(JSON.parse(JSON.stringify(webManifest(name))));
      expect(body).toMatchObject({ id: "/", name, short_name: name, start_url: "/", scope: "/", display: "standalone", theme_color: "#1d5ba6", background_color: "#ebf2fa" });
      expect(body.icons.map((icon: { purpose: string; sizes: string }) => `${icon.purpose}:${icon.sizes}`)).toEqual(["any:192x192", "any:512x512", "maskable:512x512"]);
      expect(Object.keys(body).some(key => /push|gcm|notification|share_target|related/i.test(key))).toBe(false);
    }
  });
  test("is refused without a product name, with a query or body, for another host, or for any method but GET", async () => {
    expect((await call(runtime(async () => { throw new Error("Congregation unavailable"); }))).status).toBe(503);
    for (const bad of ["", " CRC Torah", "CRC\nTorah", "x".repeat(121)]) expect((await call(runtime(async () => bad))).status, JSON.stringify(bad)).toBe(503);
    expect((await call(runtime(async () => "CRC Torah"), "/api/public/manifest?x=1")).status).toBe(400);
    expect((await call(runtime(async () => "CRC Torah"), "/api/public/manifest/")).status).toBe(404);
    expect((await call(runtime(async () => "CRC Torah", async () => { throw new AccessDenied(404); }))).status).toBe(404);
    expect((await call(runtime(async () => "CRC Torah"), "/api/public/manifest", { method: "POST", body: "{}" })).status).toBe(405);
  });
});

/** Width, height and whether every pixel is opaque, from the PNG itself. */
function png(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], type = bytes[25];
  const chunks: Buffer[] = [];
  for (let at = 8; at < bytes.length;) { const length = bytes.readUInt32BE(at), name = bytes.toString("latin1", at + 4, at + 8); if (name === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length)); at += 12 + length; }
  const raw = inflateSync(Buffer.concat(chunks)), channels = type === 6 ? 4 : type === 2 ? 3 : 0, stride = width * channels;
  expect(depth).toBe(8); expect(channels).toBeGreaterThan(0);
  const rows: Buffer[] = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
    rows.push(line); previous = line;
  }
  const pixel = (x: number, y: number) => [...rows[y].subarray(x * channels, x * channels + channels)];
  const opaque = channels === 3 || rows.every(line => { for (let x = 3; x < stride; x += 4) if (line[x] !== 255) return false; return true; });
  return { width, height, opaque, pixel };
}

describe("the yad icons", () => {
  test("every size is a PNG of its size, fully opaque, lake at the corner, with white and marigold in the drawing", async () => {
    for (const [name, size] of Object.entries(ICON_SIZES)) {
      const response = await iconRoute(new Request(`${ORIGIN}/icons/${name}`), { params: Promise.resolve({ name }) });
      expect(response.status, name).toBe(200); expect(response.headers.get("content-type")).toBe("image/png");
      const image = png(Buffer.from(await response.arrayBuffer()));
      expect([image.width, image.height], name).toEqual([size, size]);
      expect(image.opaque, name).toBe(true);
      expect(image.pixel(0, 0).slice(0, 3), name).toEqual([0x1d, 0x5b, 0xa6]);
      const colors = new Set<string>();
      for (let y = 0; y < size; y += Math.max(1, Math.floor(size / 64))) for (let x = 0; x < size; x += Math.max(1, Math.floor(size / 64))) colors.add(image.pixel(x, y).slice(0, 3).join(","));
      expect(colors.has("255,255,255"), name).toBe(true); expect(colors.has("247,181,0"), name).toBe(true);
    }
    expect((await iconRoute(new Request(`${ORIGIN}/icons/other.png`), { params: Promise.resolve({ name: "other.png" }) })).status).toBe(404);
  });
  test("/apple-touch-icon.png is an opaque 180 px PNG and /favicon.ico the yad at 48 px", async () => {
    const apple = png(Buffer.from(await (await appleRoute()).arrayBuffer()));
    expect([apple.width, apple.height, apple.opaque]).toEqual([180, 180, true]);
    const favicon = png(Buffer.from(await (await faviconRoute()).arrayBuffer()));
    expect([favicon.width, favicon.height, favicon.opaque]).toEqual([48, 48, true]);
  });
});

describe("/sw.js", () => {
  test("is plain JavaScript, revalidated on every check, with the deploy's build and the rollback flag", async () => {
    const response = await workerRoute();
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect((await response.text()).startsWith('"use strict";\nconst POLICY = Object.freeze(')).toBe(true);
    const both = ["https://torah.centralreform.org", "https://beitmitzvah.centralreform.org"];
    expect(workerEnvironment({ VERCEL_GIT_COMMIT_SHA: "0123abcd", PORTAL_OFFLINE_ENABLED: "false" })).toEqual({ build: "0123abcd", enabled: false, origins: both });
    expect(workerEnvironment({ VERCEL_GIT_COMMIT_SHA: "nope;x" })).toEqual({ build: "dev", enabled: true, origins: both });
    // N24 review F1: production with a selected canonical origin names it alone, so the other origin's /sw.js is the tombstone.
    for (const selected of both) expect(workerEnvironment({ PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: selected }).origins).toEqual([selected]);
    expect(workerEnvironment({ PORTAL_ENVIRONMENT: "preview", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: both[0] }).origins).toEqual(both);
  });
});
