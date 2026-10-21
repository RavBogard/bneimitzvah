import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join, dirname, basename, sep } from "node:path";
import { tmpdir } from "node:os";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

const unavailable = () => new Error("Owned Firefox audio output unavailable; details withheld");
const need: (value: unknown) => asserts value = value => { if (!value) throw unavailable(); };
const pause = (ms: number) => new Promise<void>(yes => setTimeout(yes, ms));
type Workspace = { home: string; socket: string };
export type AudioOutput = { environment: Readonly<Record<string, string>>; close(): Promise<void> };
export type AudioOutputDriver<T> = {
  create(): Promise<Workspace>; launch(workspace: Workspace): Promise<T>;
  ready(server: T, workspace: Workspace): Promise<void>; stop(server: T): Promise<void>;
  cleanup(workspace: Workspace): Promise<void>;
};

/** Lifecycle shared with fault tests. A running server's ownership evidence is
 * retained when stopping fails; cleanup never removes it underneath the daemon. */
export async function ownFirefoxAudioOutput<T>(platform: string, driver: AudioOutputDriver<T>): Promise<AudioOutput> {
  if (platform !== "linux") return { environment: Object.freeze({}), close: async () => {} };
  let workspace: Workspace | undefined, server: T | undefined, closed = false;
  const close = async () => {
    if (closed) return;
    try {
      if (server !== undefined) { await driver.stop(server); server = undefined; }
      if (workspace) { await driver.cleanup(workspace); workspace = undefined; }
      closed = true;
    } catch { throw unavailable(); }
  };
  try {
    workspace = await driver.create(); server = await driver.launch(workspace); await driver.ready(server, workspace);
    return { environment: Object.freeze({ PULSE_SERVER: "unix:" + workspace.socket }), close };
  } catch {
    try { await close(); } catch { throw unavailable(); }
    throw unavailable();
  }
}

/** No hardware discovery or TCP module is permitted, including during startup. */
export function ownedPulseReady(sinkText: string, moduleText: string): boolean {
  need(Buffer.byteLength(sinkText) <= 16384 && Buffer.byteLength(moduleText) <= 16384);
  const rows = (s: string) => s.trim().split("\n").filter(Boolean).map(line => line.split("\t"));
  const sinks = rows(sinkText), modules = rows(moduleText);
  need(sinks.length <= 1 && modules.length <= 2);
  need(sinks.every(r => r[1] === "bneimitzvah_test"));
  need(modules.every(r => ["module-native-protocol-unix", "module-null-sink"].includes(r[1])));
  need(new Set(modules.map(r => r[1])).size === modules.length);
  return sinks.length === 1 && modules.length === 2;
}

type OwnedProcess = { child: ChildProcess; ended: Promise<void>; finished(): boolean };
function launch(command: string, args: string[], environment: Record<string, string>): OwnedProcess {
  const child = spawn(command, args, { env: { ...environment, NODE_ENV: "test" }, stdio: "ignore", windowsHide: true });
  let finished = false;
  const ended = new Promise<void>(yes => {
    const end = () => { finished = true; yes(); };
    child.once("error", end); child.once("close", end);
  });
  return { child, ended, finished: () => finished };
}
export async function stopOwnedAudioProcess(server: OwnedProcess): Promise<void> {
  if (server.finished()) return;
  const wait = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([server.ended, new Promise<void>(yes => { timer = setTimeout(yes, 1000); })]); }
    finally { clearTimeout(timer); }
  };
  // Kill this exact ChildProcess handle only, never a discovered or supplied PID.
  server.child.kill("SIGTERM");
  await wait();
  if (!server.finished()) { server.child.kill("SIGKILL"); await wait(); }
  need(server.finished());
}
async function commandText(command: string, args: string[], environment: Record<string, string>): Promise<string> {
  const child = spawn(command, args, { env: { ...environment, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let finished = false;
  const ended = new Promise<void>(yes => { const end = () => { finished = true; yes(); }; child.once("error", end); child.once("close", end); });
  const owned = { child, ended, finished: () => finished };
  return new Promise((yes, no) => {
    let text = "", bytes = 0, settled = false;
    const finish = (ok: boolean) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (ok) yes(text);
      else void stopOwnedAudioProcess(owned).then(() => no(unavailable()), () => no(unavailable()));
    };
    const timer = setTimeout(() => finish(false), 1000);
    child.stdout.on("data", b => { bytes += b.length; if (bytes > 16384) finish(false); else text += b.toString(); });
    child.stderr.on("data", b => { bytes += b.length; if (bytes > 16384) finish(false); });
    child.once("error", () => finish(false)); child.once("close", code => finish(code === 0));
  });
}

type Toolchain = { pulse: string; pactl: string; libraries?: string };
/** Optional local native-lane tools are confined to an owned temporary extract.
 * CI uses the normal installed binaries. No browser receives library overrides. */
export async function ownedAudioToolchain(file?: string): Promise<Toolchain> {
  if (file === undefined) return { pulse: "/usr/bin/pulseaudio", pactl: "/usr/bin/pactl" };
  const root = dirname(resolve(file));
  need(file === join(root, "toolchain.json") && dirname(root) === resolve(tmpdir()) && /^finkel-audio-toolchain-[a-f0-9]{16}$/.test(basename(root)));
  const directory = await lstat(root), marker = await lstat(file);
  need(directory.isDirectory() && !directory.isSymbolicLink() && await realpath(root) === root && (directory.mode & 0o077) === 0 && directory.uid === process.getuid?.());
  need(marker.isFile() && !marker.isSymbolicLink() && marker.size > 0 && marker.size <= 8192 && await realpath(file) === file);
  const selected = JSON.parse(await readFile(file, "utf8"));
  need(selected && Object.keys(selected).sort().join("|") === "libraryDirs|pactlSha256|pulseSha256|schema" && selected.schema === "firefox-owned-audio-toolchain/v1");
  need(Array.isArray(selected.libraryDirs) && selected.libraryDirs.length > 0 && selected.libraryDirs.length <= 64);
  const libraries: string[] = [];
  for (const rel of selected.libraryDirs) {
    need(typeof rel === "string" && /^[A-Za-z0-9_.+/-]+$/.test(rel) && !rel.startsWith("/") && !rel.split("/").some(p => !p || p === "." || p === ".."));
    const path = resolve(root, rel), stat = await lstat(path); need(path.startsWith(root + sep) && stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path); libraries.push(path);
  }
  const tools = { pulse: join(root, "usr/bin/pulseaudio"), pactl: join(root, "usr/bin/pactl") };
  for (const [key, path] of Object.entries(tools)) {
    const expected = selected[key + "Sha256"], stat = await lstat(path); need(typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected) && stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 4 * 1024 * 1024 && await realpath(path) === path);
    need(createHash("sha256").update(await readFile(path)).digest("hex") === expected);
  }
  return { ...tools, libraries: libraries.join(":") };
}

export async function startFirefoxAudioOutput(toolchainFile?: string): Promise<AudioOutput> {
  let owned: Awaited<ReturnType<typeof isolatedEnv>> | undefined, toolchain: Toolchain | undefined;
  let serverEnvironment: Record<string, string> | undefined;
  return ownFirefoxAudioOutput(process.platform, {
    async create() {
      toolchain = await ownedAudioToolchain(toolchainFile); owned = await isolatedEnv();
      try {
        const home = await realpath(owned.home), runtime = join(home, "pulse-runtime"), socket = join(home, "pulse.sock");
        need(home === resolve(owned.home) && /^[A-Za-z0-9/_.-]+$/.test(socket));
        await mkdir(runtime, { mode: 0o700 });
        await writeFile(join(home, "pulse.pa"), "load-module module-native-protocol-unix socket=" + socket + " auth-anonymous=1\nload-module module-null-sink sink_name=bneimitzvah_test rate=48000 channels=2\nset-default-sink bneimitzvah_test\n", { flag: "wx", mode: 0o600 });
        serverEnvironment = { ...owned.env, XDG_RUNTIME_DIR: runtime, ...(toolchain.libraries ? { LD_LIBRARY_PATH: toolchain.libraries } : {}) };
        return { home, socket };
      } catch { await owned.cleanup(); owned = undefined; throw unavailable(); }
    },
    async launch(workspace) {
      need(toolchain && serverEnvironment);
      const args = ["-n", "--daemonize=no", "--use-pid-file=no", "--exit-idle-time=-1", "--disable-shm=yes", "--realtime=no", "--high-priority=no", "--log-target=stderr", "--file=" + join(workspace.home, "pulse.pa")];
      if (toolchain.libraries) {
        const directories = toolchain.libraries.split(":");
        const modules = directories.filter(path => basename(path) === "modules"); need(modules.length === 1); args.push("--dl-search-path=" + modules[0]);
      }
      return launch(toolchain.pulse, args, serverEnvironment);
    },
    async ready(server, workspace) {
      need(toolchain && serverEnvironment); const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        need(!server.finished()); let present = false;
        try { const stat = await lstat(workspace.socket); present = stat.isSocket(); } catch { /* Startup has not created its owned socket yet. */ }
        if (present) {
          const args = ["--server=unix:" + workspace.socket, "list", "short"];
          const sinks = await commandText(toolchain.pactl, [...args, "sinks"], serverEnvironment);
          const modules = await commandText(toolchain.pactl, [...args, "modules"], serverEnvironment);
          need(performance.now() < deadline); if (ownedPulseReady(sinks, modules)) return;
        }
        await pause(25);
      }
      throw unavailable();
    },
    stop: stopOwnedAudioProcess,
    async cleanup() { await owned?.cleanup(); owned = undefined; },
  });
}
