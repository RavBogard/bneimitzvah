import { execFile } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";
import { promisify } from "node:util";
import { extname, join } from "node:path";
import { FONT_ASSETS, matchesAssetPin, reviewedFontAsset } from "./font-assets.mjs";
import { privateBenchmarkProblem } from "./private-benchmark-policy.mjs";

const run = promisify(execFile);
const DATA = new Set([".json", ".csv", ".tsv", ".txt", ".jsonl", ".ndjson"]);
// The Learn to lein course content: reviewed text and engine word ranges only. Fields derived from the
// private PocketTorah index (alignment scores, recording keys, index word counts) never enter it.
const COURSE_DATA = "src/lib/learn/lessons.json";
const COURSE_PRIVATE_FIELDS = /"(?:alignScore|recording|indexWords)"\s*:|[A-Za-z]:[\\/]+private[\\/]/i;
// The service course (release 2.0): structure and the congregation's approved teaching only. course.json may hold Hebrew
// nowhere but its alphabet table (single letters and vowel marks); a congregation file holds no Hebrew at all. Both are
// refused if they carry any, escaped or not, so prayer text, licensed or public, cannot enter the repo through them.
const SERVICE_COURSE_FILE = "src/lib/service-course/course.json";
const SERVICE_COURSE_TENANT = /^src\/lib\/service-course\/tenants\/[a-z][a-z0-9-]{1,30}\.json$/;
function serviceCourseProblem(file, text) {
  let value;
  try { value = JSON.parse(text); } catch { return "service course data is not valid JSON"; }
  // Parsed and raw both: an escaped Hebrew letter is Hebrew once decoded, and a shadowed duplicate key would hide it from the parse.
  // The alphabet table is the one exemption, so the raw Hebrew count must equal the table's own.
  const hebrew = string => (string.match(/[\u0590-\u05FF]/g) ?? []).length;
  if (/\u05[0-9a-f]{2}/i.test(text)) return "escaped Hebrew in service course data";
  if (file === SERVICE_COURSE_FILE) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "service course data is not an object";
    const { alphabet, ...rest } = value;
    return hebrew(JSON.stringify(rest)) || hebrew(text) !== hebrew(JSON.stringify(alphabet ?? null)) ? "Hebrew outside the service course alphabet table" : undefined;
  }
  return hebrew(JSON.stringify(value)) || hebrew(text) ? "Hebrew in a service course congregation file" : undefined;
}
const CONFIGS = new Set(["package.json", "package-lock.json", "tsconfig.json", ".impeccable/config.json", ".impeccable/design.json", COURSE_DATA]);
const DRIZZLE_METADATA = /^src\/server\/db\/migrations\/meta\/(?:_journal|[0-9]{4}_snapshot)\.json$/;
function reviewedServiceCron(text) {
  try {
    if (Buffer.byteLength(text) > 2048) return false;
    const value = JSON.parse(text), keys = text.match(/"(?:[^"\\]|\\.)*"\s*:/g) ?? [];
    // Exactly these reviewed jobs, in order; the key count also refuses hidden duplicate JSON members.
    const reviewed = [["/api/internal/service-ecosystem/drain", "17 10 * * *"], ["/api/internal/roster-sheet/sync", "40 9 * * *"], ["/api/internal/notifications/run", "5 14 * * *"]];
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.crons) || value.crons.length !== reviewed.length || keys.length !== 1 + 2 * reviewed.length) return false;
    return value.crons.every((cron, i) => cron && !Array.isArray(cron) && Object.keys(cron).length === 2 && cron.path === reviewed[i][0] && cron.schedule === reviewed[i][1]);
  } catch { return false; }
}
const MEDIA = /\.(?:mp3|wav|webm|m4a|ogg|flac|aac|mp4|mov|aiff|aif|opus|ckpt|pt|pth|safetensors|onnx|h5|bin)$/i;
const KEYS = /(?:\.(?:pem|key|p12|pfx|jks|keystore)$|(?:^|\/)(?:id_rsa|id_ed25519|credentials(?:\.json)?|service-account[^/]*\.json)$)/i;
const REMOTE_ATTACHMENTS = /(?:^|\/)\.codex-remote-attachments(?:\/|$)/i;
const LOCAL_DATA = /(?:^|\/)\.local-data(?:\/|$)/i;
const FONT_FILE = /\.(?:ttf|otf|woff2?|ttc|otc|eot)$/i;
const ATTACHMENT_REASON = "private remote attachment directory";
const LOCAL_DATA_REASON = "private local data directory";
const CREDENTIALS = [
  /\bvercel_blob_rw_[A-Za-z0-9_-]+/,
  /\bGOCSPX-[A-Za-z0-9_-]+/,
  /\bre_[A-Za-z0-9]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
  /\bsk-ant-[A-Za-z0-9_-]+/,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bpostgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
  /\b(?:BETTER_AUTH_SECRET|GOOGLE_CLIENT_SECRET|RESEND_API_KEY|BLOB_READ_WRITE_TOKEN|CHANT_BLOB_TOKEN|DATABASE_URL)[ \t]*[=:][ \t]*["']?(?!["' \t]*(?:$|[,;}]))[^\s"',;}]{8,}/im,
];
const LICENSE_MARKERS = /\b(?:JPS|Koren|Jewish Publication Society|THE JPS TANAKH|Gender-Sensitive Edition)\b/i;

export async function repositoryGit(args, options) {
  try {
    return await run("git", args, options);
  } catch {
    // execFile errors may retain stdout, stderr and arguments containing secrets.
    // A fresh fixed error must be the only object crossing this boundary.
    throw new Error(`Repository policy: git ${args[0]} failed; output withheld`);
  }
}

export async function repositoryRead(file, encoding) {
  try { return await readFile(file, encoding); }
  catch { throw new Error("Repository policy: file read failed; details withheld"); }
}

function syntheticEmail(address) {
  const domain = address.toLowerCase().split("@")[1];
  return domain === "example.test" || domain === "example.com";
}

function privateDirectoryReason(file) {
  if (REMOTE_ATTACHMENTS.test(file)) return ATTACHMENT_REASON;
  if (LOCAL_DATA.test(file)) return LOCAL_DATA_REASON;
}

export function entryProblems(path, content = "") {
  const file = path.replaceAll("\\", "/");
  // Path alone is sufficient. Do not inspect or echo private local directories,
  // including otherwise allowed source extensions or empty/binary files.
  const privateDirectory = privateDirectoryReason(file);
  if (privateDirectory) return [privateDirectory];
  const problems = [];
  const text = String(content);
  const data = DATA.has(extname(file).toLowerCase());
  const migrationMetadata = DRIZZLE_METADATA.test(file);
  if (MEDIA.test(file)) problems.push("audio, video, or model artifact");
  if (FONT_FILE.test(file)) problems.push(reviewedFontAsset(path)?.kind === "font" ? "font asset requires exact byte verification" : "unlisted font asset");
  if (KEYS.test(file) || /\.local\.json$/i.test(file)) problems.push("credential/config file");
  if (/(?:^|\/)\.env[^/]*$/i.test(file) && file !== ".env.example") problems.push("environment file");
  if (file === ".env.example" && text.split(/\r?\n/).some(line => !/^\s*(?:#|$)/.test(line) && !/^[A-Z][A-Z0-9_]*=\s*$/.test(line))) problems.push("environment example must contain names only");
  if (data && !CONFIGS.has(file) && file !== "vercel.json" && !migrationMetadata && file !== SERVICE_COURSE_FILE && !SERVICE_COURSE_TENANT.test(file) && !/^(?:trope\/|tests\/fixtures\/(?:trope|portal)\/)/.test(file) && !/(?:^|\/)(?:LICENSE|OFL|PROVENANCE)(?:\.txt)?$/i.test(file)) problems.push("data file outside reviewed allow-list");
  if (data && (file === SERVICE_COURSE_FILE || SERVICE_COURSE_TENANT.test(file))) { const problem = serviceCourseProblem(file, text); if (problem) problems.push(problem); }
  if (file === COURSE_DATA && COURSE_PRIVATE_FIELDS.test(text)) problems.push("private index field in course data");
  if (file === "vercel.json" && !reviewedServiceCron(text)) problems.push("deployment config must contain only the reviewed daily service drain cron");
  if (migrationMetadata) {
    try {
      const metadata = JSON.parse(text);
      const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
      const validType = file.endsWith("/_journal.json")
        ? Array.isArray(metadata.entries)
        : typeof metadata.id === "string" && typeof metadata.prevId === "string" && record(metadata.tables);
      if (metadata.dialect !== "postgresql" || metadata.version !== "7" || !validType) throw new Error();
    } catch { problems.push("invalid Drizzle migration metadata shape"); }
  }
  if (CREDENTIALS.some(pattern => pattern.test(text))) problems.push("credential pattern");
  // Markdown backticks delimit code; they must not become a fabricated local
  // part for standalone decorators such as `@spaces.GPU`.
  for (const match of text.matchAll(/[A-Z0-9.!#$%&'*+\/=?^_{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi)) {
    const email = match[0].toLowerCase().replace(/^`+/, "");
    // Existing planning contact is permitted only in prose, never fixture/data files.
    const documentedContact = ["daniel", "centralreform.org"].join("@");
    if (!syntheticEmail(email) && !(file.endsWith(".md") && (email === documentedContact || /^[a-z0-9+_-]+@users\.noreply\.github\.com$/.test(email)))) {
      problems.push("non-synthetic email address");
      break;
    }
  }
  if (data && LICENSE_MARKERS.test(text)) problems.push("licensed-text publisher/version marker; manual licence review required");
  const privateBenchmark = privateBenchmarkProblem(text, data);
  if (privateBenchmark) problems.push(privateBenchmark);
  if (text.includes("\u0000")) problems.push("unreviewed binary content");
  return problems;
}

async function fontWorktreeState(root, file) {
  const parts = file.split("/");
  for (let index = 0; index < parts.length; index++) {
    let stat;
    try { stat = await lstat(join(root, ...parts.slice(0, index + 1))); }
    catch (error) { if (error.code === "ENOENT") return { exists: false }; throw new Error("Repository policy: file inspection failed; details withheld"); }
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) return { exists: true, regular: false };
    if (index === parts.length - 1) return { exists: true, regular: true, size: stat.size };
  }
}

function missingFontPair(present, findings, suffix = "") {
  for (const family of new Set(FONT_ASSETS.map(asset => asset.family))) {
    const members = FONT_ASSETS.filter(asset => asset.family === family);
    if (!members.some(asset => present.has(asset.path))) continue;
    for (const asset of members) if (!present.has(asset.path)) findings.push(`${asset.path}${suffix}: required paired font asset missing`);
  }
}

function inspectFontBytes(asset, content, findings, suffix = "") {
  const verified = matchesAssetPin(content, asset);
  if (!verified) findings.push(`${asset.path}${suffix}: reviewed font asset integrity mismatch`);
  // The narrow binary exception applies only to the pinned font. Its notice
  // still receives every ordinary privacy/credential/publisher/binary check.
  if (asset.kind === "license" || !verified) for (const reason of entryProblems(asset.path, content.toString("utf8"))) findings.push(`${asset.path}${suffix}: ${reason}`);
}

// Include untracked publish candidates and the index, not only committed files.
// Ignored local .env/cache/build files stay local; a force-staged one is still checked.
// Index and worktree are both inspected to prevent a safe edit hiding a staged secret.
export async function inspectRepository(root, env) {
  const options = { cwd: root, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 };
  const git = (...args) => repositoryGit(args, options);
  const [{ stdout: indexed }, { stdout: candidates }] = await Promise.all([
    git("ls-files", "--stage", "-z"),
    git("ls-files", "--cached", "--others", "--exclude-standard", "-z"),
  ]);
  const paths = [...new Set(candidates.split("\0").filter(Boolean))];
  if (!paths.length) throw new Error("Repository policy has no files to inspect");
  const findings = [], worktreeFonts = new Set(), indexedFonts = new Set();
  for (const file of paths) {
    const privateDirectory = privateDirectoryReason(file.replaceAll("\\", "/"));
    if (privateDirectory) {
      findings.push(`${privateDirectory}: prohibited publish candidate`);
      continue;
    }
    const asset = reviewedFontAsset(file);
    if (asset) {
      const state = await fontWorktreeState(root, file);
      if (!state.exists) continue;
      worktreeFonts.add(file);
      if (!state.regular) { findings.push(`${file}: symlink or non-file requires review`); continue; }
      if (asset.kind === "font" && state.size !== asset.size) { findings.push(`${file}: reviewed font asset integrity mismatch`); continue; }
      inspectFontBytes(asset, await repositoryRead(join(root, file)), findings);
      continue;
    }
    let stat;
    try { stat = await lstat(join(root, file)); }
    catch (error) { if (error.code === "ENOENT") continue; throw new Error("Repository policy: file inspection failed; details withheld"); }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      findings.push(`${file}: symlink or non-file requires review`);
      continue;
    }
    const pathProblems = entryProblems(file);
    if (MEDIA.test(file) || KEYS.test(file) || FONT_FILE.test(file)) {
      for (const reason of pathProblems) findings.push(`${file}: ${reason}`);
      continue;
    }
    const content = await repositoryRead(join(root, file), "utf8");
    for (const reason of entryProblems(file, content)) findings.push(`${file}: ${reason}`);
  }
  for (const record of indexed.split("\0").filter(Boolean)) {
    // Only the first tab separates index metadata from the pathname. Tabs in
    // the pathname itself must remain intact for the private-directory gate.
    const separator = record.indexOf("\t");
    if (separator < 0) throw new Error("Repository policy: invalid index record; details withheld");
    const meta = record.slice(0, separator), file = record.slice(separator + 1);
    const privateDirectory = privateDirectoryReason(file.replaceAll("\\", "/"));
    if (privateDirectory) {
      findings.push(`${privateDirectory} (index): prohibited publish candidate`);
      continue;
    }
    const [mode, hash] = meta.split(" ");
    const asset = reviewedFontAsset(file);
    if (asset) indexedFonts.add(file);
    if (mode !== "100644" && mode !== "100755") {
      findings.push(`${file} (index): symlink or non-file requires review`);
      continue;
    }
    if (asset) {
      const { stdout: content } = await repositoryGit(["cat-file", "blob", hash], { ...options, encoding: null });
      inspectFontBytes(asset, content, findings, " (index)");
      continue;
    }
    if (MEDIA.test(file) || KEYS.test(file) || FONT_FILE.test(file)) {
      for (const reason of entryProblems(file)) findings.push(`${file} (index): ${reason}`);
      continue;
    }
    const { stdout: content } = await git("cat-file", "blob", hash);
    for (const reason of entryProblems(file, content)) findings.push(`${file} (index): ${reason}`);
  }
  missingFontPair(worktreeFonts, findings);
  missingFontPair(indexedFonts, findings, " (index)");
  return { count: paths.length, findings: [...new Set(findings)] };
}
