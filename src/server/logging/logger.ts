import "server-only";
import { randomUUID } from "node:crypto";

const events = new Set(["runtime.unavailable", "request.complete", "mail.failed", "reading.unavailable"]);
const statuses = new Set([200, 201, 204, 400, 401, 403, 404, 409, 429, 500, 503]);
export type LogEvent = "runtime.unavailable" | "request.complete" | "mail.failed" | "reading.unavailable";

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
