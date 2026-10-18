import type { BrowserContext, Route } from "playwright";

const failureLabels = new Set([
  "Reading UI route handler failed",
  "Reading UI context close failed",
  ...["continue", "abort"].flatMap(action => ["active", "closing"].flatMap(phase =>
    ["known-close", "formatted-close", "already-handled", "other"].map(kind => `Reading UI route ${action} failed while ${phase} (${kind})`))),
]);
class ReadingRouteGuardFailure extends Error {
  readonly labels: readonly string[];
  constructor(labels: Iterable<string>) {
    const safe = [...labels].map(label => failureLabels.has(label) ? label : "Unclassified reading cleanup failure");
    super(safe.join("; ")); this.labels = Object.freeze(safe);
  }
}
// Only labels created by this guard may cross the suite's privacy boundary.
// Arbitrary rejection messages (including context.close errors) are never copied.
export function readingRouteCleanupError(results: readonly PromiseSettledResult<unknown>[]): Error | undefined {
  const failures = results.filter(result => result.status === "rejected");
  if (!failures.length) return;
  const labels = failures.flatMap(result => result.reason instanceof ReadingRouteGuardFailure
    ? result.reason.labels.map(label => failureLabels.has(label) ? label : "Unclassified reading cleanup failure")
    : ["Unclassified reading cleanup failure"]);
  return new Error(`Reading UI route/context cleanup failed: ${[...new Set(labels)].join("; ")}; private details withheld`);
}

// Keep this guard installed until the context has closed. An action that has
// started must never be followed by another terminal action on the same route.
export async function installReadingRouteGuard(context: Pick<BrowserContext, "route" | "close">, origin: string) {
  const pending = new Set<Promise<void>>(), failures = new Set<string>();
  let closing = false, closeTask: Promise<void> | undefined;
  await context.route("**/*", route => {
    const task = handle(route);
    pending.add(task);
    // Both branches settle tracking; do not create a rejected finally promise.
    void task.then(() => pending.delete(task), () => {
      failures.add("Reading UI route handler failed"); pending.delete(task);
    });
    return task;
  });
  async function handle(route: Route) {
    let allowed = false;
    try { allowed = new URL(route.request().url()).origin === origin; } catch { /* Invalid URLs are denied. */ }
    const action = allowed ? "continue" : "abort";
    try { await route[action](); }
    catch (error) {
      const closed = "Target page, context or browser has been closed";
      const knownClose = error instanceof Error && (error.message === closed || error.message === `route.${action}: ${closed}`);
      if (closing && knownClose) return;
      const formattedClose = error instanceof Error && [closed, `route.${action}: ${closed}`]
        .some(prefix => error.message.startsWith(`${prefix}\n`) || error.message.startsWith(`${prefix}\r\n`));
      const alreadyHandled = error instanceof Error && (error.message === "Route is already handled!" || error.message.startsWith(`route.${action}: Route is already handled!`));
      // Retain every unexpected failure until teardown, without SDK messages
      // that may include private request URLs or credentials.
      failures.add(`Reading UI route ${action} failed while ${closing ? "closing" : "active"} (${knownClose ? "known-close" : formattedClose ? "formatted-close" : alreadyHandled ? "already-handled" : "other"})`);
    }
  }
  return {
    close() {
      if (!closeTask) {
        closing = true;
        closeTask = (async () => {
          try { await context.close(); } catch { failures.add("Reading UI context close failed"); }
          while (pending.size) await Promise.allSettled([...pending]);
          if (failures.size) throw new ReadingRouteGuardFailure(failures);
        })();
      }
      return closeTask;
    },
  };
}
