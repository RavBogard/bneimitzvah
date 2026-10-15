import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, delimiter } from "node:path";
import { parseRenderArgs, parseRefList, findModal, modalInvocation, UsageError } from "../trope/render-cli.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { concatWavs, readWav, writeWav } from "../trope/wav.mjs";

const parse = (...a) => parseRenderArgs(a, { readFile: p => "I Samuel 20:18-42\n# comment\n\nIsaiah 54:1-10 # trailing\nI Samuel 20:18-42\n" });
const bad = (re, ...a) => assert.throws(() => parse(...a), e => e instanceof UsageError && re.test(e.message));

test("the default backend is local and a single ref is not a batch", () => {
  const o = parse("--ref", "I Samuel 20:18");
  assert.equal(o.backend, "local");
  assert.deepEqual(o.refs, ["I Samuel 20:18"]);
  assert.equal(o.batch, false);
  assert.equal(o.key, "D4");
  assert.equal(o.tempo, 96);
});

test("--backend modal carries gpu, concurrency cap, per-call and fp16 with defaults", () => {
  const d = parse("--ref", "X 1:1", "--backend", "modal").modal;
  assert.deepEqual({ gpu: d.gpu, maxContainers: d.maxContainers, perCall: d.perCall, fp16: d.fp16 }, { gpu: "L4", maxContainers: 10, perCall: 3, fp16: true });
  const o = parse("--ref", "X 1:1", "--backend", "modal", "--gpu", "A10", "--max-containers", "25", "--per-call", "1", "--no-fp16", "--dry-run");
  assert.deepEqual({ gpu: o.modal.gpu, maxContainers: o.modal.maxContainers, perCall: o.modal.perCall, fp16: o.modal.fp16, dry: o.dryRun }, { gpu: "A10", maxContainers: 25, perCall: 1, fp16: false, dry: true });
});

test("bad backend and mismatched flags are usage errors", () => {
  bad(/--backend must be/, "--ref", "X 1:1", "--backend", "gcp");
  bad(/only applies with --backend modal/, "--ref", "X 1:1", "--gpu", "L4");
  bad(/only applies with --backend modal/, "--ref", "X 1:1", "--max-containers", "5");
  bad(/local-only/, "--ref", "X 1:1", "--backend", "modal", "--cpu");
  bad(/positive integer/, "--ref", "X 1:1", "--backend", "modal", "--max-containers", "0");
  bad(/positive integer/, "--ref", "X 1:1", "--backend", "modal", "--per-call", "abc");
  bad(/unknown argument/, "--ref", "X 1:1", "--bogus");
  bad(/needs a value/, "--ref");
  bad(/needs a value/, "--ref", "X 1:1", "--backend");
});

test("a reading source is required, exclusive, and --prompt needs --prompt-meta", () => {
  bad(/give --ref/, "--backend", "modal");
  bad(/alternatives/, "--ref", "X 1:1", "--refs", "Y 1:1");
  bad(/--prompt-meta/, "--ref", "X 1:1", "--prompt", "a.wav");
  assert.equal(parse("--ref", "X 1:1", "--prompt", "a.wav", "--prompt-meta", "a.json").prompt, "a.wav");
});

test("batch: --refs, --refs-file (comments, blanks, duplicates) and --year", () => {
  assert.deepEqual(parse("--refs", "A 1:1;B 2:2; ;A 1:1").refs, ["A 1:1", "B 2:2"]);
  const f = parse("--refs-file", "refs.txt", "--backend", "modal");
  assert.deepEqual(f.refs, ["I Samuel 20:18-42", "Isaiah 54:1-10"]);
  assert.equal(f.batch, true);
  const y = parse("--year", "2027");
  assert.equal(y.year, 2027);
  assert.equal(y.refs, null);
  assert.equal(y.batch, true);
  bad(/Gregorian year/, "--year", "27");
  bad(/--full names one file/, "--refs", "A 1:1;B 2:2", "--full", "x.wav");
  assert.throws(() => parseRenderArgs(["--refs-file", "nope.txt"], { readFile: () => { throw new Error("ENOENT"); } }), /cannot read --refs-file/);
  assert.deepEqual(parseRefList("a;b\nc"), ["a", "b", "c"]);
});

test("findModal prefers --modal, then HAFTARAH_MODAL, then a venv, then PATH", () => {
  const present = new Set([join("C:", "tools", "modal.exe"), join("C:", "audio", "modal-env", "Scripts", "modal.exe"), join("C:", "bin", "modal.exe")]);
  const exists = p => present.has(p);
  const env = { PATH: ["C:/nowhere", "C:/bin"].join(delimiter) };
  assert.equal(findModal({ explicit: join("C:", "tools", "modal.exe"), env, audioRoot: "C:/audio", platform: "win32", exists }).path, join("C:", "tools", "modal.exe"));
  assert.equal(findModal({ env, audioRoot: join("C:", "audio"), platform: "win32", exists }).path, join("C:", "audio", "modal-env", "Scripts", "modal.exe"));
  assert.equal(findModal({ env, audioRoot: join("C:", "elsewhere"), platform: "win32", exists }).path, join("C:/bin", "modal.exe"));
  const none = findModal({ env: { PATH: "" }, audioRoot: "C:/x", platform: "win32", exists: () => false });
  assert.equal(none.path, null);
  assert.ok(none.tried.length > 0);
});

test("modalInvocation builds `modal run trope/modal_render.py::render` with the knobs in the environment", () => {
  const modal = { gpu: "A100-40GB", maxContainers: 8, perCall: 2, fp16: false };
  const inv = modalInvocation({ modalPath: "modal", script: "/r/trope/modal_render.py", jobsPath: "/o/jobs.json", modal, env: {} });
  assert.deepEqual(inv.args, ["run", "/r/trope/modal_render.py::render", "--jobs", "/o/jobs.json", "--per-call", "2", "--no-fp16"]);
  assert.equal(inv.env.SOULX_MODAL_GPU, "A100-40GB");
  assert.equal(inv.env.SOULX_MODAL_CONCURRENCY, "8");
  assert.equal(inv.env.SOULX_MODAL_FP16, "0");
  assert.ok(!modalInvocation({ modalPath: "modal", script: "s", jobsPath: "j", modal: { ...modal, fp16: true }, env: {} }).args.includes("--no-fp16"));
});

test("the script exits 2 with usage on a bad --backend, before any network", async () => {
  const iso = await isolatedEnv();
  const script = fileURLToPath(new URL("../scripts/trope-render.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [script, "--ref", "I Samuel 20:18", "--backend", "gcp"], { encoding: "utf8", env: iso.env });
  await iso.cleanup();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--backend must be/);
  assert.match(r.stderr, /usage: node scripts\/trope-render\.mjs/);
});

test("concatWavs joins mono WAVs with a silent gap (int16 and float32)", () => {
  const tone = (n, v) => new Float32Array(n).fill(v);
  for (const float of [false, true]) {
    const a = writeWav({ rate: 1000, float, samples: tone(500, 0.5) });
    const b = writeWav({ rate: 1000, float, samples: tone(250, -0.25) });
    const { wav, seconds } = concatWavs([a, b], 0.1);
    assert.equal(seconds, 0.85);
    const r = readWav(wav);
    assert.equal(r.float, float);
    assert.equal(r.samples.length, 850);
    assert.ok(Math.abs(r.samples[0] - 0.5) < 1e-3);
    assert.equal(r.samples[550], 0);
    assert.ok(Math.abs(r.samples[849] + 0.25) < 1e-3);
  }
  assert.throws(() => concatWavs([writeWav({ rate: 1000, samples: tone(1, 0) }), writeWav({ rate: 2000, samples: tone(1, 0) })]), /sample rate/);
});
