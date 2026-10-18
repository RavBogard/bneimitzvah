import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { honoreeFixture } from "./honoree-fixture";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import * as data from "../../src/server/data/honoree";
import * as runtimeData from "../../src/server/db/runtime";
const fixtures: Awaited<ReturnType<typeof honoreeFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() { const f = await honoreeFixture(); fixtures.push(f); return f; }
const origin = "http://localhost:3000";
type RequestOptions = { path?: string; method?: string; headers?: Record<string,string>; body?: string };
function request(token: string, options: RequestOptions = {}) {
  const method = options.method ?? "POST";
  return new Request(origin + (options.path ?? "/api/honoree/read"), { method, headers: { origin, "content-type": "application/json", ...options.headers },
    ...(method === "GET" || method === "HEAD" ? {} : { body: options.body ?? JSON.stringify({ token }) }) });
}
async function denied(response: Response) {
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "not-found" });
  for (const name of ["set-cookie", "location", "allow", "X-Honoree-Remaining-Ms"]) expect(response.headers.get(name)).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

test("guest dispatch serves the unchanged minimal DTO and authoritative positive lifetime without session authority", async () => {
  const f = await fixture(), issued = await f.issue();
  const identity = vi.fn();
  const access = new Proxy(f.runtime.access, { get(target, key, receiver) { if (key === "withStudentCapability") identity(); return Reflect.get(target, key, receiver); } });
  const dispatch = createHttpDispatcher(action => action({ ...f.runtime, access, honoree: f.honoree }));
  const before = Date.now(), response = await dispatch(request(issued.token));
  expect(response.status).toBe(200); expect(identity).not.toHaveBeenCalled();
  const header = response.headers.get("X-Honoree-Remaining-Ms")!;
  expect(header).toMatch(/^[1-9][0-9]*$/); expect(Number.isSafeInteger(Number(header))).toBe(true);
  expect(Number(header)).toBeLessThanOrEqual(Math.min(90 * 86400000, Date.parse(issued.result.expiresAt!) - before));
  const dto = await response.json();
  expect(Object.keys(dto).sort()).toEqual(["aliyah", "expiresAt", "material", "ok", "schemaVersion", "student"]);
  expect(Object.keys(dto.student).sort()).toEqual(["ceremonyDate", "firstName"]);
  expect(dto.aliyah).toEqual({ startVerse: "Genesis 1:1", endVerse: "Genesis 1:1" });
  expect(Object.keys(dto.material).sort()).toEqual(["after", "before", "credits", "version"]);
  expect(response.headers.get("set-cookie")).toBeNull(); expect(response.headers.get("location")).toBeNull();
});

test("unsupported guest methods, queries and every cookie stay uniform404 before runtime; management aliases stay unowned", async () => {
  const scope = vi.fn<HttpRuntimeScope>(async () => { throw Error("No runtime expected"); }), dispatch = createHttpDispatcher(scope);
  const cases: RequestOptions[] = [
    { method: "GET" }, { method: "HEAD" }, { method: "OPTIONS" }, { method: "DELETE" }, { path: "/api/honoree/read?token=synthetic" },
    { headers: { cookie: "unknown=synthetic" } }, { headers: { cookie: "" } }, { headers: { cookie: "better-auth.session_token=synthetic" } },
    { headers: { cookie: "x=" + "x".repeat(17000) } }, { headers: { authorization: "synthetic" } }, { headers: { "X-Practice-Context": "synthetic" } },
    ...["/other", "/receipt/", "/status/"].map(suffix => ({ path: "/api/students/00000000-0000-0000-0000-000000000000/honoree-links" + suffix })),
    { path: "/api/honoree/read/" }, { path: "/api/honoree/other" },
  ];
  for (const options of cases) await denied(await dispatch(request("synthetic", options)));
  expect(scope).not.toHaveBeenCalled();
});

test("strict guest payload/origin failures, unavailable runtime and absent material mapping share the same denial", async () => {
  const f = await fixture(), issued = await f.issue(), read = vi.fn(f.honoree.readForTransport);
  const dispatch = createHttpDispatcher(action => action({ ...f.runtime, honoree: { ...f.honoree, readForTransport: read } }));
  const cases: RequestOptions[] = [
    { headers: { origin: "https://foreign.example.test" } }, { headers: { origin: "" } }, { headers: { "content-type": "text/plain" } },
    { headers: { "content-encoding": "gzip" } }, { headers: { "content-length": "1" } }, { body: "{" },
    { body: JSON.stringify({ token: issued.token, studentId: f.selected.studentId }) }, { body: JSON.stringify({ token: "x".repeat(1025) }) },
  ];
  for (const options of cases) await denied(await dispatch(request(issued.token, options)));
  expect(read).not.toHaveBeenCalled();
  await denied(await dispatch(request("invalid")));
  await denied(await createHttpDispatcher(async () => { throw Error("Synthetic private runtime failure"); })(request(issued.token)));
  await denied(await createHttpDispatcher(action => action({ ...f.runtime, honoree: f.noProjector }))(request(issued.token)));
});

test("remaining-life metadata floors the final authoritative database/wall/monotonic maximum without changing JSON", async () => {
  const f = await fixture(), issued = await f.issue(), expiry = Date.parse(issued.result.expiresAt!);
  const transaction = runtimeData.withTenantTransaction;
  for (const wallDominates of [false, true]) {
    let completed = false;
    vi.spyOn(Date, "now").mockReturnValue(expiry - (wallDominates ? 5000 : 20000));
    vi.spyOn(data, "now").mockResolvedValue(expiry - 10001);
    vi.spyOn(performance, "now").mockImplementation(() => completed ? 100.75 : 100);
    vi.spyOn(runtimeData, "withTenantTransaction").mockImplementation(async (...args) => { const result = await transaction(...args); completed = true; return result; });
    const result = await f.honoree.readForTransport(f.guest(), issued.token);
    expect(completed).toBe(true); expect(result.remainingMs).toBe(wallDominates ? 5000 : 10000);
    expect(Object.keys(result.dto).sort()).toEqual(["aliyah", "expiresAt", "material", "ok", "schemaVersion", "student"]);
    vi.restoreAllMocks();
  }
});

test("guest dispatch conservatively subtracts the full scoped-runtime wait and rejects corrupted lifetime metadata", async () => {
  const f = await fixture(), issued = await f.issue(), expiry = Date.parse(issued.result.expiresAt!);
  let completed = false;
  vi.spyOn(Date, "now").mockReturnValue(expiry - 20000);
  vi.spyOn(data, "now").mockResolvedValue(expiry - 10001);
  vi.spyOn(performance, "now").mockImplementation(() => completed ? 115.75 : 100);
  const dispatch = createHttpDispatcher(async action => { const response = await action({ ...f.runtime, honoree: f.honoree }); completed = true; return response; });
  const response = await dispatch(request(issued.token));
  expect(response.status).toBe(200); expect(response.headers.get("X-Honoree-Remaining-Ms")).toBe("9985");
  vi.restoreAllMocks();
  for (const invalid of [null, "0", "01", "1e5", "NaN", String(90 * 86400000 + 1)]) {
    const corrupt = createHttpDispatcher(async action => {
      const response = await action({ ...f.runtime, honoree: f.honoree });
      if (invalid === null) response.headers.delete("X-Honoree-Remaining-Ms");
      else response.headers.set("X-Honoree-Remaining-Ms", invalid);
      return response;
    });
    await denied(await corrupt(request(issued.token)));
  }
});

test("transport withholds success when cancellation or expiry crosses COMMIT or runtime cleanup", async () => {
  const f = await fixture(), issued = await f.issue(), expiry = Date.parse(issued.result.expiresAt!);
  for (const failure of ["abort", "wall", "monotonic"] as const) {
    const control = new AbortController(), transaction = runtimeData.withTenantTransaction;
    vi.spyOn(runtimeData, "withTenantTransaction").mockImplementation(async (...args) => {
      const result = await transaction(...args);
      if (failure === "abort") control.abort();
      if (failure === "wall") vi.spyOn(Date, "now").mockReturnValue(expiry);
      if (failure === "monotonic") vi.spyOn(performance, "now").mockReturnValue(performance.now() + 91 * 86400000);
      return result;
    });
    await expect(f.honoree.readForTransport(f.guest(control.signal), issued.token)).rejects.toMatchObject({ status: 404 });
    vi.restoreAllMocks();
  }
  for (const failure of ["abort", "wall", "monotonic"] as const) {
    const control = new AbortController(); let completed = false;
    vi.spyOn(performance, "now").mockImplementation(() => completed && failure === "monotonic" ? 91 * 86400000 : 100);
    const dispatch = createHttpDispatcher(async action => {
      const response = await action({ ...f.runtime, honoree: f.honoree });
      expect(response.status).toBe(200); completed = true;
      if (failure === "abort") control.abort();
      if (failure === "wall") vi.spyOn(Date, "now").mockReturnValue(expiry);
      return response;
    });
    const req = request(issued.token);
    await denied(await dispatch(new Request(req, { signal: control.signal })));
    vi.restoreAllMocks();
  }
});
