import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PgDialect, type PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, AccessRequest } from "../../src/server/access/types";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";

const origin = "https://bneimitzvah.vercel.app", host = "bneimitzvah.vercel.app";
const scope = { environment: "production" as const, deployment: "production" };
function fixture(present = true) {
  const where = vi.fn(async (..._args: unknown[]) => present ? [{ tenantId: "crc" }] : []);
  const select = vi.fn(() => ({ from: () => ({ where }) }));
  return { db: { select } as unknown as AccessDatabase<PgQueryResultHKT>, select, where };
}
function request(forwarded: string, extra: Record<string, string> = {}, url = `${origin}/api/session`): AccessRequest {
  return { url, headers: new Headers({ host, forwarded, ...extra }) };
}
afterEach(() => vi.restoreAllMocks());

test("arbitrary RFC Forwarded claims are ignored without parsing, logging or selecting authority", async () => {
  const sink = vi.spyOn(console, "info").mockImplementation(() => {});
  for (const forwarded of ["", "synthetic-private", "host=foreign.example.test;proto=http", "for=unknown, for=198.51.100.17",
    'for="[2001:db8::1]:4711";extension=synthetic-private', 'host="unterminated', "host=a;host=b", "a".repeat(4096)]) {
    const f = fixture();
    expect(await resolveTenantHost(f.db, request(forwarded), scope, "incoming")).toEqual({ tenantId: "crc", origin });
    const predicate = f.where.mock.calls[0][0] as Parameters<PgDialect["sqlToQuery"]>[0];
    expect(new PgDialect().sqlToQuery(predicate).params).toEqual([host, origin, "production", "production"]);
  }
  const unread = request("synthetic-private");
  const get = unread.headers.get.bind(unread.headers);
  vi.spyOn(unread.headers, "get").mockImplementation(key => {
    if (key.toLowerCase() === "forwarded") throw new Error("RFC metadata must never be read");
    return get(key);
  });
  expect(await resolveTenantHost(fixture().db, unread, scope)).toEqual({ tenantId: "crc", origin });
  expect(sink).not.toHaveBeenCalled();
});

test("discarded RFC claims cannot override URL, Host or existing X-Forwarded consistency checks", async () => {
  const lines: string[] = []; vi.spyOn(console, "info").mockImplementation(line => { lines.push(String(line)); });
  for (const input of [
    request(`host=${host};proto=https`, { host: "synthetic-private.example.test" }),
    request(`host=${host}`, { "x-forwarded-host": "synthetic-private.example.test" }),
    request(`host=${host}`, { "x-forwarded-host": `${host},synthetic-private.example.test` }),
    request(`host=${host}`, { "x-forwarded-proto": "http" }),
    request(`host=${host}`, { "x-forwarded-port": "3000" }),
    request(`host=${host}`, {}, "https://synthetic-private.example.test/api/session"),
    request(`host=${host};proto=https`, {}, "http://bneimitzvah.vercel.app/api/session"),
  ]) {
    const f = fixture();
    await expect(resolveTenantHost(f.db, input, scope, "incoming")).rejects.toMatchObject({ status: 404 });
    expect(f.select).not.toHaveBeenCalled();
  }
  const absent = fixture(false);
  await expect(resolveTenantHost(absent.db, request(`host=${host}`), scope, "incoming")).rejects.toMatchObject({ status: 404 });
  expect(lines.every(line => !line.includes("synthetic-private") && !line.includes(host) && Object.keys(JSON.parse(line)).sort().join() === "event,requestId,status")).toBe(true);
});
