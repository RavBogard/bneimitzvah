import type { BrowserContext, Route } from "playwright";

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
      if (closing && error instanceof Error && (error.message === closed || error.message === `route.${action}: ${closed}`)) return;
      // Retain every unexpected failure until teardown, without SDK messages
      // that may include private request URLs or credentials.
      failures.add(`Reading UI route ${action} failed while ${closing ? "closing" : "active"}`);
    }
  }
  return {
    close() {
      if (!closeTask) {
        closing = true;
        closeTask = (async () => {
          try { await context.close(); } catch { failures.add("Reading UI context close failed"); }
          while (pending.size) await Promise.allSettled([...pending]);
          if (failures.size) throw new Error([...failures].join("; "));
        })();
      }
      return closeTask;
    },
  };
}
