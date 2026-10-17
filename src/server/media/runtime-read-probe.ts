import "server-only";
import type { RuntimeReadFacts } from "./private-transport";

export const RUNTIME_READ_PROBE = Object.freeze({
  schema: "private-media-runtime-read/v1", mode: "runtime-read-v1", storeId: "store_UOU7eX3fTuUHAs7G",
  projectId: "prj_LaqPZuHk6W5XLlDpw29lUyyij3Sq", route: "/api/internal/private-media-runtime-probe", totalMs: 20000,
});
type Environment = Record<string, string | undefined>;
const names = ["MODE", "STORE_ID", "RUN_ID"].map(value => `PRIVATE_MEDIA_RUNTIME_READ_PROBE_${value}`);
const cache = Object.freeze({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
export const runtimeReadNotFound = () => new Response(null, { status: 404, headers: cache });

/** Selection is nonsecret metadata only. No credential or transport import. */
export function selectRuntimeReadProbe(url: string, env: Environment): string | null {
  try {
    if (!names.every(name => Object.hasOwn(env, name))) return null;
    if (Object.keys(env).some(key => key.startsWith("PRIVATE_MEDIA_") && key.includes("PROBE_") && !names.includes(key))) return null;
    if (env[names[0]] !== RUNTIME_READ_PROBE.mode || env[names[1]] !== RUNTIME_READ_PROBE.storeId) return null;
    const run = env[names[2]];
    if (typeof run !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(run)) return null;
    if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production" || env.VERCEL_PROJECT_ID !== RUNTIME_READ_PROBE.projectId || env.VERCEL_TARGET_ENV !== undefined && env.VERCEL_TARGET_ENV !== "production") return null;
    if (typeof env.VERCEL_DEPLOYMENT_ID !== "string" || !/^dpl_[A-Za-z0-9]{16,64}$/.test(env.VERCEL_DEPLOYMENT_ID)) return null;
    const host = env.VERCEL_URL;
    if (typeof host !== "string" || !/^bneimitzvah-[a-z0-9]{5,80}-ravbogards-projects\.vercel\.app$/.test(host)) return null;
    const requested = new URL(url);
    if (requested.protocol !== "https:" || requested.host !== host || requested.username || requested.password || requested.hash || requested.pathname !== RUNTIME_READ_PROBE.route) return null;
    return run;
  } catch { return null; }
}

type Acceptance = { verify(options?: { signal?: AbortSignal; deadline?: number }): Promise<RuntimeReadFacts> };
type ProbeOptions = { env?: Environment; acceptance?: () => Promise<Acceptance>; budgetMs?: number };
const empty = (): RuntimeReadFacts["checks"] => Object.freeze({ contextProfile: false, metadata: false, exactBody: false });
function closedFacts(facts: RuntimeReadFacts) {
  if (!facts || typeof facts !== "object") throw 0;
  const fields = Object.getOwnPropertyDescriptors(facts);
  if (Reflect.ownKeys(facts).length !== 3 || !["ok", "phase", "checks"].every(key => fields[key] && Object.hasOwn(fields[key], "value"))) throw 0;
  const ok: unknown = fields.ok.value, phase: unknown = fields.phase.value, checks: unknown = fields.checks.value;
  if (typeof ok !== "boolean" || typeof phase !== "string" || !["context", "metadata", "body", "complete"].includes(phase) || !checks || typeof checks !== "object") throw 0;
  const values = Object.getOwnPropertyDescriptors(checks), names = ["contextProfile", "metadata", "exactBody"];
  if (Reflect.ownKeys(checks).length !== 3 || !names.every(key => values[key] && Object.hasOwn(values[key], "value") && typeof values[key].value === "boolean")) throw 0;
  return Object.freeze({ ok, phase: phase as RuntimeReadFacts["phase"], checks: Object.freeze({ contextProfile: values.contextProfile.value as boolean, metadata: values.metadata.value as boolean, exactBody: values.exactBody.value as boolean }) });
}

/** Fixed GET proof only. Injected factories/time limits are internal offline
 * test seams; request fields never select provider bytes or credentials. */
export async function runRuntimeReadProbe(request: Request, options: ProbeOptions = {}): Promise<Response> {
  if (request.method !== "GET") return runtimeReadNotFound();
  const run = selectRuntimeReadProbe(request.url, options.env ?? process.env);
  if (!run) return runtimeReadNotFound();
  let phase: RuntimeReadFacts["phase"] | "deadline" = "context", checks = empty(), ok = false;
  const controller = new AbortController(), started = performance.now();
  const cancel = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false;
  try {
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) controller.abort();
    const budget = options.budgetMs ?? RUNTIME_READ_PROBE.totalMs;
    if (!Number.isInteger(budget) || budget <= 0 || budget > RUNTIME_READ_PROBE.totalMs) throw 0;
    const deadline = started + budget;
    const live = () => { if (closed || controller.signal.aborted || performance.now() >= deadline) throw 0; };
    live();
    const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { phase = "deadline"; closed = true; controller.abort(); reject(0); }, budget); });
    const load = options.acceptance ?? (async () => (await import("./private-transport")).createRuntimeReadAcceptance());
    const acceptance = await Promise.race([load(), expired]); live();
    const facts = await Promise.race([acceptance.verify({ signal: controller.signal, deadline }), expired]); live();
    const value = closedFacts(facts);
    phase = value.phase; checks = value.checks; ok = value.ok;
    if (ok && (phase !== "complete" || !checks.contextProfile || !checks.metadata || !checks.exactBody)) throw 0;
  } catch { ok = false; if (performance.now() - started >= (options.budgetMs ?? RUNTIME_READ_PROBE.totalMs)) phase = "deadline"; }
  finally { closed = true; clearTimeout(timer); request.signal.removeEventListener("abort", cancel); controller.abort(); }
  return Response.json(Object.freeze({ schema: RUNTIME_READ_PROBE.schema, mode: RUNTIME_READ_PROBE.mode, run, ok, phase, outcome: ok ? "observed" : "failed", checks }), { status: ok ? 200 : checks.contextProfile ? 502 : 404, headers: cache });
}
