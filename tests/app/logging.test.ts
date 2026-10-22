import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createLogger, hostDenialEvent, MCP_BODY_UNREAD, mcpRequestLine } from "../../src/server/logging/logger";

test("logger projects only fixed event/status and generated request UUID, ignoring arbitrary private objects", () => {
  const lines: string[] = [];
  const log = createLogger((line) => lines.push(line));
  const request = log.request();
  const sentinel = "synthetic-private-sentinel";
  let touched = false;
  const privateObject = { toJSON() { touched = true; throw new Error(sentinel); }, headers: { cookie: sentinel }, cause: new Error(sentinel), body: sentinel };
  // Exercise runtime callers bypassing the compile-time API, without serializing
  // a failed assertion containing the private fixture.
  const emit = request.emit as (...args: unknown[]) => void;
  emit("request.complete", 200, privateObject);
  emit(privateObject, 503);
  emit(sentinel, 503);
  emit("mail.failed", privateObject);
  emit("reading.unavailable", 503);
  expect(touched).toBe(false);
  expect(lines.length).toBe(2);
  expect(lines.some((line) => line.includes(sentinel))).toBe(false);
  expect(JSON.parse(lines[0])).toEqual({ event: "request.complete", status: 200, requestId: request.requestId });
  expect(request.requestId).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  expect(log.request().requestId === request.requestId).toBe(false);
});

test("logging sink failures never change the operation outcome", () => {
  expect(() => createLogger(() => { throw new Error("synthetic-private"); }).request().emit("runtime.unavailable", 503)).not.toThrow();
});

test("host diagnostic codes use compile-time vocabulary and reject hostile runtime dimensions without coercion", () => {
  let touched = false;
  const hostile = { toString() { touched = true; throw new Error("synthetic-private"); }, toJSON() { touched = true; return "synthetic-private"; } };
  expect(hostDenialEvent(hostile, "host")).toBeNull();
  expect(hostDenialEvent("incoming", hostile)).toBeNull();
  expect(hostDenialEvent("incoming.synthetic-private", "host")).toBeNull();
  expect(hostDenialEvent("incoming", "synthetic-private")).toBeNull();
  expect(touched).toBe(false);
  const lines: string[] = [], request = createLogger(line => lines.push(line)).request();
  const emit = request.emit as (...args: unknown[]) => void;
  emit("host.denied.incoming.synthetic-private", 404);
  emit("host.denied.synthetic-private.host", 404);
  const event = hostDenialEvent("incoming", "directory-query");
  expect(event).toBe("host.denied.incoming.directory-query");
  if (event) request.emit(event, 404);
  expect(lines.length).toBe(1);
  expect(JSON.parse(lines[0])).toEqual({ event, status: 404, requestId: request.requestId });
});

test("the MCP request line projects only closed fields and never touches or echoes hostile input", () => {
  let touched = false;
  const hostile = { toString() { touched = true; return "synthetic-private"; }, toJSON() { touched = true; return "synthetic-private"; } };
  const allowed = ["https://claude.ai"];
  const line = (input: Partial<Parameters<typeof mcpRequestLine>[0]>) => mcpRequestLine({ origin: null, allowedOrigins: allowed, version: null, body: MCP_BODY_UNREAD, ...input });
  expect(line({})).toEqual({ event: "mcp.request", originPresent: false, origin: "absent", protocolVersion: "absent", method: "unread" });
  expect(line({ origin: "https://claude.ai.synthetic-private.example" }).origin).toBe("other");
  expect(line({ origin: hostile as never }).originPresent).toBe(false);
  expect(line({ version: "2025-06-18\nsynthetic-private" }).protocolVersion).toBe("malformed");
  expect(line({ version: hostile as never }).protocolVersion).toBe("absent");
  expect(line({ body: { jsonrpc: "2.0", id: 1, method: hostile } }).method).toBe("invalid");
  expect(line({ body: { jsonrpc: "2.0", id: 1, method: "synthetic-private" } }).method).toBe("other");
  expect(line({ body: { jsonrpc: "2.0", id: 1, result: {} } }).method).toBe("response");
  expect(line({ body: "synthetic-private" }).method).toBe("invalid");
  expect(line({ body: null }).method).toBe("invalid");
  expect(touched).toBe(false);
  const lines: string[] = [];
  createLogger(value => lines.push(value)).mcpRequest({ origin: "https://claude.ai", allowedOrigins: allowed, version: "2025-11-25", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { arguments: { secret: "synthetic-private" } } } });
  expect(lines).toEqual([JSON.stringify({ event: "mcp.request", originPresent: true, origin: "https://claude.ai", protocolVersion: "2025-11-25", method: "tools/call" })]);
  expect(() => createLogger(() => { throw new Error("synthetic-private"); }).mcpRequest({ origin: null, allowedOrigins: [], version: null, body: null })).not.toThrow();
});
