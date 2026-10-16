import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, AccessRequest, DeploymentScope } from "../../src/server/access/types";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";
import { AccessDenied } from "../../src/server/access/errors";
import type { HostDenialStage, HostFrame } from "../../src/server/logging/logger";
import * as logging from "../../src/server/logging/logger";

const origin = "https://bneimitzvah.vercel.app";
const scope: DeploymentScope = { environment: "production", deployment: "production" };
function database(read: () => Promise<unknown> = async () => [{ tenantId: "crc" }]) {
  const select = vi.fn(() => ({ from: () => ({ where: read }) }));
  return { db: { select } as unknown as AccessDatabase<PgQueryResultHKT>, select };
}
const request = (headers: Record<string, string> = {}, url = `${origin}/api/session`): AccessRequest => ({ url, headers: new Headers(headers) });
afterEach(() => vi.restoreAllMocks());

test("host denial stages remain fixed while all existing rejection decisions remain404", async () => {
  const lines: string[] = []; vi.spyOn(console, "info").mockImplementation(line => { lines.push(String(line)); });
  const cases: { stage: HostDenialStage; scope?: DeploymentScope; url?: string; headers?: Record<string, string> }[] = [
    { stage: "scope", scope: { ...scope, deployment: " invalid " } },
    { stage: "url", url: `${origin}/synthetic private` },
    { stage: "url-authority", url: "https://user:synthetic-private@example.test/api/session" },
    { stage: "scheme", url: "http://bneimitzvah.vercel.app/api/session" },
    { stage: "host", headers: { host: "synthetic-private.example.test" } },
    { stage: "forwarded", headers: { forwarded: "for=192.0.2.1;host=synthetic-private.example.test;proto=https" } },
    { stage: "forwarded-host", headers: { "x-forwarded-host": "synthetic-private.example.test" } },
    { stage: "forwarded-proto", headers: { "x-forwarded-proto": "http" } },
    { stage: "forwarded-port", headers: { "x-forwarded-port": "3000" } },
  ];
  for (const value of cases) {
    const f = database();
    await expect(resolveTenantHost(f.db, request(value.headers, value.url), value.scope ?? scope, "incoming")).rejects.toMatchObject({ name: "AccessDenied", status: 404, message: "Not found" });
    expect(f.select).not.toHaveBeenCalled();
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ event: `host.denied.incoming.${value.stage}`, status: 404 });
  }
  expect(lines.length).toBe(cases.length);
  expect(lines.every(line => !line.includes("synthetic-private") && !line.includes(origin) && !line.includes("192.0.2.1"))).toBe(true);
});

test("configured directory query errors and incoming missing rows are distinct without serializing the error", async () => {
  const lines: string[] = []; vi.spyOn(console, "info").mockImplementation(line => { lines.push(String(line)); });
  let touched = false;
  const hostile = Object.defineProperties({}, { message: { get() { touched = true; throw new Error("synthetic-private"); } },
    stack: { get() { touched = true; return "synthetic-private"; } }, toJSON: { value() { touched = true; return "synthetic-private"; } } });
  const broken = database(async () => { throw hostile; });
  await expect(resolveTenantHost(broken.db, request(), scope, "configured")).rejects.toBeInstanceOf(AccessDenied);
  const absent = database(async () => []);
  await expect(resolveTenantHost(absent.db, request(), scope, "incoming")).rejects.toBeInstanceOf(AccessDenied);
  expect(lines.map(line => JSON.parse(line).event)).toEqual(["host.denied.configured.directory-query", "host.denied.incoming.directory-missing"]);
  expect(touched).toBe(false);
  const getter = request(); Object.defineProperty(getter, "url", { get() { throw hostile; } });
  await expect(resolveTenantHost(database().db, getter, scope)).rejects.toBeInstanceOf(AccessDenied);
  expect(JSON.parse(lines.at(-1)!).event).toBe("host.denied.service.url");
  expect(touched).toBe(false);
  expect(lines.every(line => Object.keys(JSON.parse(line)).sort().join() === "event,requestId,status" && !line.includes("synthetic-private"))).toBe(true);
});

test("successful exact mapping is unchanged and sink failures cannot change a denial", async () => {
  const sink = vi.spyOn(console, "info").mockImplementation(() => { throw new Error("synthetic-private-sink"); });
  expect(await resolveTenantHost(database().db, request({ host: "bneimitzvah.vercel.app", "x-forwarded-host": "bneimitzvah.vercel.app", "x-forwarded-proto": "https", "x-forwarded-port": "443" }), scope, "incoming")).toEqual({ tenantId: "crc", origin });
  expect(sink).not.toHaveBeenCalled();
  await expect(resolveTenantHost(database().db, request({ forwarded: "synthetic-private" }), scope, "incoming")).rejects.toMatchObject({ status: 404, message: "Not found" });
  expect(sink).toHaveBeenCalledTimes(1);
  let coerced = false;
  const hostileFrame = { toString() { coerced = true; throw new Error("synthetic-private"); } } as unknown as HostFrame;
  await expect(resolveTenantHost(database().db, request({ forwarded: "synthetic-private" }), scope, hostileFrame)).rejects.toMatchObject({ status: 404 });
  expect(coerced).toBe(false); expect(sink).toHaveBeenCalledTimes(1);
  vi.spyOn(logging, "createLogger").mockImplementationOnce(() => { throw new Error("synthetic-private-construction"); });
  await expect(resolveTenantHost(database().db, request({ forwarded: "synthetic-private" }), scope, "incoming")).rejects.toMatchObject({ name: "AccessDenied", status: 404, message: "Not found" });
  expect(sink).toHaveBeenCalledTimes(1);
});
