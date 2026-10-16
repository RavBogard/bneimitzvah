import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createLogger } from "../../src/server/logging/logger";

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
