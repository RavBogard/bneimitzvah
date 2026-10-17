import { execFile } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";
import { promisify } from "node:util";
import { extname, join } from "node:path";
import { FONT_ASSETS, matchesAssetPin, reviewedFontAsset } from "./font-assets.mjs";

const run = promisify(execFile);
const DATA = new Set([".json", ".csv", ".tsv", ".txt", ".jsonl", ".ndjson"]);
const CONFIGS = new Set(["package.json", "package-lock.json", "tsconfig.json", ".impeccable/config.json", ".impeccable/design.json"]);
const DRIZZLE_METADATA = /^src\/server\/db\/migrations\/meta\/(?:_journal|[0-9]{4}_snapshot)\.json$/;
const MEDIA = /\.(?:mp3|wav|webm|m4a|ogg|flac|aac|mp4|mov|aiff|aif|opus|ckpt|pt|pth|safetensors|onnx|h5|bin)$/i;
const KEYS = /(?:\.(?:pem|key|p12|pfx|jks|keystore)$|(?:^|\/)(?:id_rsa|id_ed25519|credentials(?:\.json)?|service-account[^/]*\.json)$)/i;
const REMOTE_ATTACHMENTS = /(?:^|\/)\.codex-remote-attachments(?:\/|$)/i;
const FONT_FILE = /\.(?:ttf|otf|woff2?|ttc|otc|eot)$/i;
const ATTACHMENT_REASON = "private remote attachment directory";
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

export function entryProblems(path, content = "") {
  const file = path.replaceAll("\\", "/");
  // Path alone is sufficient. Do not inspect or echo private attachments,
  // including otherwise allowed source extensions or empty/binary files.
  if (REMOTE_ATTACHMENTS.test(file)) return [ATTACHMENT_REASON];
  const problems = [];
  const text = String(content);
  const data = DATA.has(extname(file).toLowerCase());
  const migrationMetadata = DRIZZLE_METADATA.test(file);
  if (MEDIA.test(file)) problems.push("audio, video, or model artifact");
  if (FONT_FILE.test(file)) problems.push(reviewedFontAsset(path)?.kind === "font" ? "font asset requires exact byte verification" : "unlisted font asset");
  if (KEYS.test(file) || /\.local\.json$/i.test(file)) problems.push("credential/config file");
  if (/(?:^|\/)\.env[^/]*$/i.test(file) && file !== ".env.example") problems.push("environment file");
  if (file === ".env.example" && text.split(/\r?\n/).some(line => !/^\s*(?:#|$)/.test(line) && !/^[A-Z][A-Z0-9_]*=\s*$/.test(line))) problems.push("environment example must contain names only");
  if (data && !CONFIGS.has(file) && !migrationMetadata && !/^(?:trope\/|tests\/fixtures\/(?:trope|portal)\/)/.test(file) && !/(?:^|\/)(?:LICENSE|OFL|PROVENANCE)(?:\.txt)?$/i.test(file)) problems.push("data file outside reviewed allow-list");
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
    if (REMOTE_ATTACHMENTS.test(file.replaceAll("\\", "/"))) {
      findings.push(`${ATTACHMENT_REASON}: prohibited publish candidate`);
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
    if (REMOTE_ATTACHMENTS.test(file.replaceAll("\\", "/"))) {
      findings.push(`${ATTACHMENT_REASON} (index): prohibited publish candidate`);
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
