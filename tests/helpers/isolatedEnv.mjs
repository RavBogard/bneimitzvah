// The one way a test runs another program. The child's environment is built from an allow-list:
// HOME and USERPROFILE point into a fresh temp folder (on Windows os.homedir() reads USERPROFILE,
// which is how a 2026-10-14 test delivered the fixture to the real Drive and Blob), the drop-box and
// web config paths point at files that do not exist, and no token variable is passed on. A test that
// needs one (for a local fake server) passes it in `extra`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Kept from the parent, matched case-insensitively: what Node and Chrome need to start, and the browser pin.
const PASS = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "HAFTARAH_BROWSER"]);
// Never passed on, whatever the parent has.
export const CLEARED = ["HAFTARAH_BLOB_TOKEN", "HAFTARAH_DROPBOX_URL", "HAFTARAH_DROPBOX_TOKEN", "BLOB_READ_WRITE_TOKEN", "DATABASE_URL", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_SECRET", "RESEND_API_KEY", "CHANT_BLOB_TOKEN", "GOOGLE_CLIENT_ID", "BETTER_AUTH_URL"];

export async function isolatedEnv(extra = {}) {
  const home = await mkdtemp(join(tmpdir(), "bneimitzvah-home-"));
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (PASS.has(k.toUpperCase())) env[k] = v;
  Object.assign(env, {
    HOME: home, USERPROFILE: home,
    HAFTARAH_DROPBOX_CONFIG: join(home, "no-dropbox.json"),
    HAFTARAH_WEB_CONFIG: join(home, "no-web.json"),
  }, extra);
  return { env, home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

// The lint every test file passes (tests/isolation.test.mjs): a file that starts a program must use
// isolatedEnv and must not touch process.env. A tripwire, not a proof: it reads the source.
const SPAWNS = /from\s+["'](?:node:)?child_process["']|require\(\s*["'](?:node:)?child_process["']\s*\)|\bbuildFixture\s*\(/;
export function isolationProblems(src) {
  const s = String(src);
  if (!SPAWNS.test(s)) return [];
  const problems = [];
  if (!/from\s+["'](?:\.\.\/)*\.?\/?helpers\/isolatedEnv\.mjs["']/.test(s)) problems.push("spawns a process but does not import ./helpers/isolatedEnv.mjs");
  if (!/\bisolatedEnv\s*\(/.test(s)) problems.push("spawns a process but never calls isolatedEnv()");
  if (/\bprocess\.env\b/.test(s)) problems.push("reads process.env; a spawned child must get isolatedEnv's env only");
  return problems;
}
