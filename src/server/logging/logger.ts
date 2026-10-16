import "server-only";
import { randomUUID } from "node:crypto";

const hostFrames = ["configured", "incoming", "service"] as const;
const hostStages = ["scope", "url", "url-authority", "scheme", "host", "forwarded", "forwarded-host", "forwarded-proto", "forwarded-port", "directory-query", "directory-missing"] as const;
export type HostFrame = typeof hostFrames[number];
export type HostDenialStage = typeof hostStages[number];
type HostDenialEvent = `host.denied.${HostFrame}.${HostDenialStage}`;
const frames = new Set<string>(hostFrames), stages = new Set<string>(hostStages);
const events = new Set<string>(["runtime.unavailable", "request.complete", "mail.failed", "reading.unavailable",
  ...hostFrames.flatMap(frame => hostStages.map(stage => `host.denied.${frame}.${stage}`))]);
const statuses = new Set([200, 201, 204, 400, 401, 403, 404, 409, 429, 500, 503]);
export type LogEvent = "runtime.unavailable" | "request.complete" | "mail.failed" | "reading.unavailable" | HostDenialEvent;

// Validate unknown runtime callers before interpolation: never coerce objects,
// errors or request-derived strings into a diagnostic event.
export function hostDenialEvent(frame: unknown, stage: unknown): HostDenialEvent | null {
  if (typeof frame !== "string" || !frames.has(frame) || typeof stage !== "string" || !stages.has(stage)) return null;
  return `host.denied.${frame}.${stage}` as HostDenialEvent;
}

// Never serialize an input object, Error, request, provider response or cause.
export function createLogger(sink: (line: string) => void = (line) => console.info(line)) {
  return Object.freeze({
    request() {
      const requestId = randomUUID();
      return Object.freeze({
        requestId,
        emit(event: LogEvent, status: number) {
          if (typeof event !== "string" || !events.has(event) || !statuses.has(status)) return;
          try { sink(JSON.stringify({ event, status, requestId })); } catch { /* Logging cannot change the operation outcome. */ }
        },
      });
    },
  });
}
