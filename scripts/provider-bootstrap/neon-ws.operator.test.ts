import { test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { neonRuntimeProbe, ProbeFailure } from "./neon-ws";

test("explicit operator-only Neon WebSocket acceptance", async () => {
  try {
    if (process.env.PROVIDER_RUNTIME_PROBE_RUN !== "explicit-operator-run"
      || Object.keys(process.env).some(key => /^(?:DATABASE_|POSTGRES_|PG(?:HOST|USER|PASSWORD|DATABASE|SERVICE)|BOOTSTRAP_|RESEND_|GOOGLE_|BETTER_AUTH_)/i.test(key))) throw new ProbeFailure("configuration");
    await neonRuntimeProbe(process.env.PROVIDER_RUNTIME_DATABASE_URL);
    console.log('PROVIDER_PROBE_RESULT:{"status":"passed","phase":"close"}');
  } catch (error) {
    const phase = error instanceof ProbeFailure ? error.phase : "runner";
    console.log(`PROVIDER_PROBE_RESULT:${JSON.stringify({ status: "failed", phase })}`);
    // No actual error, cause, driver row, query or connection enters Vitest output.
    throw new Error(`Provider probe failed (${phase}); private details withheld`);
  }
});
