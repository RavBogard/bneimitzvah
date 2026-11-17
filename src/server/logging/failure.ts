import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { causeChain, describeError, methodForLog, OWN_REASON, routeForLog, siteForLog } from "./redact";

// One structured line per unexpected server failure, to stderr (Vercel collects it). Every value that reaches the
// line passes through redact.ts; read that module for what may and may not be logged. Expected outcomes (401, 403,
// 404, 409, validation refusals, rate limits) are not failures and are never written here.
//
// The line: {"event":"server.failure","requestId","method","route","site","status"?,"error":{name,message?,code?,
// reason?,constraint?,table?,schema?,column?,routine?,stack?,cause?}|null}

type Context = { requestId: string; method: string; route: string; recorded: boolean };
const context = new AsyncLocalStorage<Context>();
// Errors already written, so a wrapper rethrown further up (RuntimeUnavailable with this as its cause) is not
// written a second time.
const written = new WeakSet<object>();
let sink: (line: string) => void = line => console.error(line);

/** Tests only: capture lines instead of writing to stderr. Returns a restore function. */
export function setFailureSinkForTests(next: (line: string) => void): () => void {
  const previous = sink; sink = next; return () => { sink = previous; };
}

/** Runs one request with a generated id, its method and its redacted route, for every line it writes. */
export function runWithRequestContext<T>(request: { method?: unknown; url?: unknown }, action: () => Promise<T>): Promise<T> {
  let method = "OTHER", route = "[unreadable]";
  try { method = methodForLog(request.method); route = routeForLog(request.url); } catch { /* Logging cannot change the outcome. */ }
  return context.run({ requestId: randomUUID(), method, route, recorded: false }, action);
}

/** The current request's id, when inside runWithRequestContext. */
export function currentRequestId(): string | undefined {
  try { return context.getStore()?.requestId; } catch { return undefined; }
}

/** Whether a failure has already been written during the current request. */
export function failureRecorded(): boolean {
  try { return context.getStore()?.recorded === true; } catch { return false; }
}

function write(site: string, error: unknown, status: number | undefined, describe: boolean) {
  try {
    const store = context.getStore();
    // `next build` prerenders public pages whose name reader falls back by design when no runtime is configured
    // (src/server/public-site/names.ts); those are not runtime failures. Outside a request during the build phase,
    // nothing is written.
    if (!store && process.env.NEXT_PHASE === "phase-production-build") return;
    if (store) store.recorded = true;
    const line: Record<string, unknown> = { event: "server.failure", requestId: store?.requestId ?? randomUUID(),
      method: store?.method ?? "NONE", route: store?.route ?? "[no-request]", site: siteForLog(site) };
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) line.status = status;
    line.error = describe ? describeError(error) : null;
    sink(JSON.stringify(line));
  } catch { /* Logging cannot change the operation outcome. */ }
}

/**
 * Writes one line for an unexpected failure, once: an error (or any error in its cause chain) already written is
 * skipped. `site` is a static code naming where it was caught ("reading-cache/get"). Never throws.
 */
export function recordFailure(error: unknown, site: string, status?: number): void {
  try {
    const chain = causeChain(error);
    if (chain.some(item => typeof item === "object" && item !== null && written.has(item))) return;
    for (const item of chain) if (typeof item === "object" && item !== null) written.add(item);
  } catch { /* Logging cannot change the operation outcome. */ }
  write(site, error, status, true);
}

/** A 5xx left the dispatcher with no failure written for it: record the route and status, so it is still visible. */
export function recordUnexplainedStatus(site: string, status: number): void {
  write(site, undefined, status, false);
}

/**
 * Attaches the original error as a non-enumerable `cause` to a fixed error a catch rethrows, so the boundary's
 * line names the real failure. Never changes the error's name, message or status, and JSON.stringify skips it.
 *
 * The cause is the raw, unredacted original (a driver error with row values in `detail`, a fetch error with a
 * signed URL). An error carrying one must never be passed whole to console.error/log, util.inspect, structuredClone
 * or a response: only recordFailure (through redact.ts) may read it. tests/app/failure-logging.test.ts pins the
 * console calls in src/server.
 */
export function causedBy<T extends Error>(error: T, cause: unknown): T {
  try { if (cause !== undefined) Object.defineProperty(error, "cause", { value: cause, enumerable: false, configurable: true, writable: true }); }
  catch { /* A frozen error keeps no cause. */ }
  return error;
}

/**
 * A deliberate "unavailable" signal from our own code. `reason` is a static string literal naming the site
 * ("config/database-url"); tests/app/failure-logging.test.ts checks that every construction site in src passes a
 * unique literal.
 */
export class Unavailable extends Error {
  constructor(readonly reason: string, options?: { cause?: unknown }) {
    super(reason);
    this.name = "Unavailable";
    Object.defineProperty(this, OWN_REASON, { value: true, enumerable: false });
    if (options && "cause" in options) causedBy(this, options.cause);
  }
}
