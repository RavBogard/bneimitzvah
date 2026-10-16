import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, AccessRequest } from "../../src/server/access/types";
import { AccessDenied } from "../../src/server/access/errors";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";

const origin = "https://bneimitzvah.vercel.app", host = "bneimitzvah.vercel.app";
const scope = { environment: "production" as const, deployment: "production" };
function fixture() {
  const select = vi.fn(() => ({ from: () => ({ where: async () => [{ tenantId: "crc" }] }) }));
  return { db: { select } as unknown as AccessDatabase<PgQueryResultHKT>, select };
}
function request(forwarded: string, extra: Record<string, string> = {}, url = `${origin}/api/session`): AccessRequest {
  const headers = new Headers({ host, ...extra });
  const get = headers.get.bind(headers);
  // Allows parser tests to include hostile control bytes which a real Fetch
  // Headers constructor would reject before the resolver could see them.
  vi.spyOn(headers, "get").mockImplementation(key => key.toLowerCase() === "forwarded" ? forwarded : get(key));
  return { url, headers };
}
afterEach(() => vi.restoreAllMocks());

test("single-hop Forwarded accepts only consistent optional authority parameters and bounded opaque nodes", async () => {
  const sink = vi.spyOn(console, "info").mockImplementation(() => {});
  for (const forwarded of [
    `host=${host}`, "proto=https", "for=192.0.2.43", "for=unknown", "by=_proxy", "for=_opaque;by=unknown",
    `for=192.0.2.43;host=${host};proto=https`,
    ` For="[2001:db8:cafe::17]:4711" ; HOST="BNEIMITZVAH.VERCEL.APP:443";Proto="https";by=_edge `,
  ]) {
    const f = fixture();
    expect(await resolveTenantHost(f.db, request(forwarded), scope, "incoming")).toEqual({ tenantId: "crc", origin });
    expect(f.select).toHaveBeenCalledTimes(1);
  }
  expect(sink).not.toHaveBeenCalled();
});

test("ambiguous multi-hop, duplicate, extension, malformed, mismatching and oversized Forwarded values fail closed", async () => {
  const lines: string[] = []; vi.spyOn(console, "info").mockImplementation(line => { lines.push(String(line)); });
  const invalid = ["", " \t ", "synthetic-private", `host=synthetic-private.example.test`, "proto=http", "proto=HTTPS",
    `host="${host}:444"`, `host=${host};host=${host}`, `HOST=${host};host=${host}`, "proto=https;proto=https",
    "for=192.0.2.43,for=198.51.100.17", 'for="node,proxy"', "for=192.0.2.43;extension=synthetic-private",
    "for=192.0.2.43;", "for=192.0.2.43;;proto=https", `host =${host}`, "for=", 'for=""', 'for="[2001:db8::1]',
    'for=[2001:db8::1]', 'for="[2001:db8::1]"trailing', 'for="[2001:db8::1]\\"', 'for="node;host=synthetic-private.example.test"',
    "for=\u0000synthetic-private", "for=synthetic-private\r\nproto=https", "for=synthetic-privateé", `for=${"a".repeat(257)}`, `for=${"a".repeat(1025)}`];
  for (const forwarded of invalid) {
    const f = fixture();
    await expect(resolveTenantHost(f.db, request(forwarded), scope, "incoming")).rejects.toMatchObject({ name: "AccessDenied", status: 404, message: "Not found" });
    expect(f.select).not.toHaveBeenCalled();
  }
  const duplicate = new Headers(); duplicate.append("forwarded", `host=${host}`); duplicate.append("forwarded", `host=${host}`);
  await expect(resolveTenantHost(fixture().db, { url: origin, headers: duplicate }, scope, "incoming")).rejects.toBeInstanceOf(AccessDenied);
  expect(lines.every(line => JSON.parse(line).event === "host.denied.incoming.forwarded" && !line.includes("synthetic-private") && !line.includes("192.0.2.43"))).toBe(true);
});

test("matching Forwarded never replaces URL, Host or X-Forwarded authority and consistency checks", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  for (const input of [
    request(`host=${host};proto=https`, { host: "synthetic-private.example.test" }),
    request(`host=${host};proto=https`, { "x-forwarded-host": "synthetic-private.example.test" }),
    request(`host=${host};proto=https`, { "x-forwarded-proto": "http" }),
    request(`host=${host};proto=https`, { "x-forwarded-port": "3000" }),
    request(`host=${host};proto=https`, { host: "synthetic-private.example.test" }, "https://synthetic-private.example.test/api/session"),
    request(`host=${host};proto=https`, {}, "http://bneimitzvah.vercel.app/api/session"),
  ]) {
    const f = fixture();
    await expect(resolveTenantHost(f.db, input, scope, "incoming")).rejects.toMatchObject({ status: 404 });
    expect(f.select).not.toHaveBeenCalled();
  }
});
