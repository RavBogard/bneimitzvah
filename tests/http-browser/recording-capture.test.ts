import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { installLoopbackFetchGuard } from "./egress";
import type { createRecordingCapture } from "../../src/components/portal/workspace/recordings/capture";
vi.mock("server-only", () => ({}));
import { verifyCanonicalRecordingWav } from "../../src/server/recordings/media-wav";

type Capture = ReturnType<typeof createRecordingCapture>;
declare global {
  interface Window {
    makeCapture: typeof createRecordingCapture;
    capture: Capture;
    controller: AbortController;
    starting: ReturnType<Capture["start"]>;
    instrumentation: { calls: number; streams: MediaStream[]; contexts: AudioContext[]; nodes: AudioWorkletNode[]; messages: { type: string; frames?: number }[]; portCloses: number; disconnects: number };
    releasePermission?: () => void;
  }
}
let server: Server, origin: string, browser: Browser, worklet: string;
let isolated: Awaited<ReturnType<typeof isolatedEnv>>, restore: () => void;
const contexts: BrowserContext[] = [];
const modules = new Map<string, string>();

beforeAll(async () => {
  isolated = await isolatedEnv(); restore = installLoopbackFetchGuard();
  worklet = await readFile("public/recording-capture-worklet.js", "utf8");
  // The pinned TypeScript7 CLI emits the one owned module into the isolated
  // temporary home. No package install, Next server or production environment.
  const output = join(isolated.home, "capture-module");
  await promisify(execFile)(process.execPath, ["node_modules/typescript/bin/tsc", "--ignoreConfig", "--target", "es2022", "--module", "esnext", "--lib", "dom,es2022", "--skipLibCheck", "--outDir", output,
    "src/components/portal/workspace/recordings/capture.ts"], { env: isolated.env });
  const javascript = await readFile(join(output, "capture.js"), "utf8");
  // This fixture has no app, database, authority, uploads or filesystem routes.
  const resources = new Map([
    ["/", { type: "text/html", body: '<!doctype html><title>Synthetic capture fixture</title><script type="module" src="/boot.js"></script>' }],
    ["/boot.js", { type: "text/javascript", body: 'import {createRecordingCapture} from "/capture.js"; window.makeCapture=createRecordingCapture;' }],
    ["/capture.js", { type: "text/javascript", body: javascript }],
    ["/recording-capture-worklet.js", { type: "text/javascript", body: worklet }],
  ]);
  server = createServer((request, response) => {
    let resource = request.method === "GET" ? resources.get(request.url ?? "") : undefined;
    // Chromium's worklet fetch bypasses Playwright route.fulfill. Select the
    // synthetic module on this owned server using a context-local test cookie.
    if (resource && request.url === "/recording-capture-worklet.js") {
      const key = /(?:^|;\s*)captureVariant=(\d+)(?:;|$)/.exec(request.headers.cookie ?? "")?.[1];
      if (key && modules.has(key)) resource = { type: "text/javascript", body: modules.get(key)! };
    }
    response.writeHead(resource ? 200 : 404, { "content-type": resource?.type ?? "text/plain", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'" });
    response.end(resource?.body ?? "Not found");
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Synthetic capture server unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  // Full Chromium's headless mode supports synthetic microphone capture. The
  // separate minimal headless-shell binary rejects getUserMedia on Windows.
  browser = await chromium.launch({ channel: "chromium", headless: true, env: isolated.env, args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
});
afterAll(async () => {
  try { await Promise.all(contexts.map(context => context.close())); await browser?.close(); }
  finally { restore?.(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await isolated?.cleanup(); }
});

async function page(options: { denied?: boolean; late?: boolean; module?: string; sampleRate?: number } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.grantPermissions(options.denied ? [] : ["microphone"], { origin });
  if (options.module) { const key = String(modules.size + 1); modules.set(key, options.module); await context.addCookies([{ name: "captureVariant", value: key, url: origin, sameSite: "Strict" }]); }
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { await route.abort(); return; }
    await route.continue();
  });
  await context.addInitScript(({ late, sampleRate }) => {
    const stats: Window["instrumentation"] = { calls: 0, streams: [], contexts: [], nodes: [], messages: [], portCloses: 0, disconnects: 0 };
    window.instrumentation = stats;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      stats.calls++; const stream = await original(constraints); stats.streams.push(stream);
      if (late) await new Promise<void>(resolve => { window.releasePermission = resolve; });
      return stream;
    };
    const NativeContext = window.AudioContext, NativeWorklet = window.AudioWorkletNode;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super(sampleRate ? { ...options, sampleRate } : options); stats.contexts.push(this); }
      createMediaStreamSource(stream: MediaStream) {
        const source = super.createMediaStreamSource(stream), disconnect = source.disconnect.bind(source);
        source.disconnect = (() => { stats.disconnects++; disconnect(); }) as typeof source.disconnect;
        return source;
      }
    };
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options); stats.nodes.push(this);
        this.port.addEventListener("message", event => { stats.messages.push({ type: event.data.type, frames: event.data.frames }); }); this.port.start();
        const close = this.port.close.bind(this.port); this.port.close = () => { stats.portCloses++; close(); };
      }
    };
  }, { late: options.late ?? false, sampleRate: options.sampleRate });
  const tab = await context.newPage(); await tab.goto(origin); await tab.waitForFunction(() => !!window.makeCapture);
  return tab;
}
async function begin(tab: Page) {
  return tab.evaluate(async () => { window.controller = new AbortController(); window.capture = window.makeCapture({ signal: window.controller.signal }); return window.capture.start(); });
}
async function released(tab: Page, expectedContexts = 1) {
  await tab.waitForFunction(count => window.instrumentation.streams.every(stream => stream.getTracks().every(track => track.readyState === "ended"))
    && window.instrumentation.contexts.length === count && window.instrumentation.contexts.every(context => context.state === "closed"), expectedContexts);
  return tab.evaluate(() => ({ calls: window.instrumentation.calls, closes: window.instrumentation.portCloses, disconnects: window.instrumentation.disconnects, state: window.capture.state() }));
}

test("explicit synthetic Chromium capture uses real 24000 Hz worklet, flushes PCM tail and passes the independent server verifier", async () => {
  const tab = await page();
  expect(await tab.evaluate(() => { window.controller = new AbortController(); window.capture = window.makeCapture({ signal: window.controller.signal }); return { calls: window.instrumentation.calls, contexts: window.instrumentation.contexts.length, state: window.capture.state() }; })).toEqual({ calls: 0, contexts: 0, state: "idle" });
  expect(await tab.evaluate(() => window.capture.start())).toEqual({ ok: true });
  await tab.waitForFunction(() => window.instrumentation.messages.some(message => message.type === "pcm"));
  // Finish between block boundaries; the protocol's final frame total includes
  // the partial block, not only the already-transferred 4096-frame chunks.
  await tab.waitForTimeout(45);
  const result = await tab.evaluate(async () => {
    const value = await window.capture.stop();
    if (!value.ok) return value;
    return { ok: true as const, bytes: Array.from(new Uint8Array(await value.blob.arrayBuffer())), type: value.blob.type, frameCount: value.frameCount, durationMs: value.durationMs,
      sampleRate: window.instrumentation.contexts[0].sampleRate, messages: window.instrumentation.messages };
  });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.sampleRate).toBe(24_000); expect(result.type).toBe("audio/wav");
  expect(result.messages.at(-1)?.type).toBe("done");
  expect(result.messages.filter(message => message.type === "pcm").at(-1)?.frames).toBeLessThan(4096);
  const bytes = Uint8Array.from(result.bytes), verified = await verifyCanonicalRecordingWav(new Blob([bytes]).stream(), { signal: new AbortController().signal });
  expect(verified).toEqual({ ok: true, value: { mediaType: "audio/wav", byteLength: bytes.length, frameCount: result.frameCount, durationMs: result.durationMs, contentSha256: createHash("sha256").update(bytes).digest("hex") } });
  expect(bytes.length).toBe(44 + result.frameCount * 2); expect(result.frameCount).toBeGreaterThan(4096);
  expect(await released(tab)).toMatchObject({ calls: 1, closes: 1, disconnects: 1, state: "completed" });
  expect(await tab.evaluate(async () => ({ stop: await window.capture.stop(), start: await window.capture.start(), calls: window.instrumentation.calls }))).toEqual({ stop: { ok: false, error: "invalid-state" }, start: { ok: false, error: "invalid-state" }, calls: 1 });
});

test("actual browser microphone denial returns only a fixed error without starting an audio context", async () => {
  const tab = await page({ denied: true });
  expect(await tab.evaluate(async () => (await navigator.permissions.query({ name: "microphone" as PermissionName })).state)).toBe("denied");
  expect(await begin(tab)).toEqual({ ok: false, error: "permission-denied" });
  expect(await released(tab, 0)).toMatchObject({ calls: 1, closes: 0, state: "failed" });
});

test("abort while actual fake-microphone permission is held cannot resurrect late tracks or PCM", async () => {
  const tab = await page({ late: true });
  await tab.evaluate(() => { window.controller = new AbortController(); window.capture = window.makeCapture({ signal: window.controller.signal }); window.starting = window.capture.start(); });
  await tab.waitForFunction(() => !!window.releasePermission);
  expect(await tab.evaluate(async () => { window.controller.abort(); return window.starting; })).toEqual({ ok: false, error: "aborted" });
  await tab.evaluate(() => window.releasePermission?.());
  expect(await released(tab, 0)).toMatchObject({ calls: 1, closes: 0, state: "disposed" });
  expect(await tab.evaluate(() => window.capture.stop())).toEqual({ ok: false, error: "aborted" });
});

for (const reason of ["abort", "hidden", "track-ended", "dispose"] as const) test(`active capture ${reason} cleans the real tracks/context/port and cannot yield a blob`, async () => {
  const tab = await page(); expect(await begin(tab)).toEqual({ ok: true });
  const expected = reason === "abort" || reason === "dispose" ? "aborted" : "interrupted";
  expect(await tab.evaluate(async reason => {
    if (reason === "abort") window.controller.abort();
    else if (reason === "dispose") window.capture.dispose();
    else if (reason === "hidden") { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }
    else { const track = window.instrumentation.streams[0].getTracks()[0]; track.stop(); track.dispatchEvent(new Event("ended")); }
    return window.capture.stop();
  }, reason)).toEqual({ ok: false, error: expected });
  expect(await released(tab)).toMatchObject({ closes: 1, disconnects: 1 });
});

test("actual mismatched AudioContext rate is unsupported and stopped, without pretending to resample", async () => {
  const tab = await page({ sampleRate: 48_000 }); expect(await begin(tab)).toEqual({ ok: false, error: "unsupported" });
  expect(await released(tab)).toMatchObject({ closes: 0, disconnects: 0, state: "failed" });
});

for (const [label, body] of [
  ["wrong protocol", 'this.port.postMessage({v:2,type:"ready",sampleRate:24000});'],
  ["noncontiguous sequence", 'this.port.postMessage({v:1,type:"ready",sampleRate:24000});this.port.postMessage({v:1,type:"pcm",sequence:1,frames:1,buffer:new ArrayBuffer(2)});'],
  ["oversized chunk", 'this.port.postMessage({v:1,type:"ready",sampleRate:24000});this.port.postMessage({v:1,type:"pcm",sequence:0,frames:4097,buffer:new ArrayBuffer(8194)});'],
  ["aggregate frame overflow", 'this.port.postMessage({v:1,type:"ready",sampleRate:24000});for(let sequence=0;sequence<3516;sequence++){const buffer=new ArrayBuffer(8192);this.port.postMessage({v:1,type:"pcm",sequence,frames:4096,buffer},[buffer]);}'],
] as const) test(`real AudioWorklet ${label} fails closed and releases microphone resources`, async () => {
  const module = `registerProcessor("canonical-recording-capture",class extends AudioWorkletProcessor{constructor(){super();${body}}process(_i,o){for(const a of o)for(const c of a)c.fill(0);return true;}});`;
  const tab = await page({ module }); const result = await begin(tab);
  if (result.ok) await tab.waitForFunction(() => window.capture.state() === "failed");
  expect(await tab.evaluate(() => window.capture.stop())).toEqual({ ok: false, error: "invalid-capture" });
  expect(await released(tab)).toMatchObject({ closes: 1, disconnects: 1, state: "failed" });
});

for (const malformed of ["nonfinite", "channel-length", "channel-count", "wrong-stop-version", "frame-limit"] as const) test(`worklet source rejects ${malformed} and clears its pending PCM`, () => {
  let Processor: new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean; port: { onmessage: (event: { data: unknown }) => void }; frames: number; pcm: unknown };
  const messages: { type: string; error?: string }[] = [];
  runInNewContext(worklet, { sampleRate: 24_000, ArrayBuffer, DataView, Math, Number, Object,
    AudioWorkletProcessor: class { port = { onmessage: undefined, postMessage(value: { type: string }) { messages.push(structuredClone(value)); } }; },
    registerProcessor(_name: string, value: typeof Processor) { Processor = value; } });
  const processor = new Processor!(), output = new Float32Array(2).fill(0.4);
  if (malformed === "wrong-stop-version") processor.port.onmessage({ data: { v: 2, type: "stop" } });
  else {
    if (malformed === "frame-limit") processor.frames = 14_399_999;
    const channels = malformed === "nonfinite" ? [Float32Array.from([0, NaN])] : malformed === "channel-length" ? [new Float32Array(2), new Float32Array(1)]
      : malformed === "channel-count" ? Array.from({ length: 33 }, () => new Float32Array(2)) : [new Float32Array(2)];
    expect(processor.process([channels], [[output]])).toBe(false);
    expect(Array.from(output)).toEqual([0, 0]);
  }
  expect(messages).toEqual([{ v: 1, type: "ready", sampleRate: 24_000 }, { v: 1, type: "error", error: malformed === "frame-limit" ? "limit-reached" : "invalid-capture" }]);
  expect(processor.pcm).toBeNull(); expect(processor.process([], [[output]])).toBe(false);
});

test("nonresponsive actual AudioWorklet flush has a bounded deadline and never returns partial success", async () => {
  const module = 'registerProcessor("canonical-recording-capture",class extends AudioWorkletProcessor{constructor(){super();this.port.postMessage({v:1,type:"ready",sampleRate:24000});}process(_i,o){for(const a of o)for(const c of a)c.fill(0);return true;}});';
  const tab = await page({ module }); expect(await begin(tab)).toEqual({ ok: true });
  expect(await tab.evaluate(() => window.capture.stop())).toEqual({ ok: false, error: "flush-timeout" });
  expect(await released(tab)).toMatchObject({ closes: 1, disconnects: 1, state: "failed" });
});

test("abort during a held flush ends immediately rather than waiting for a worklet response", async () => {
  const module = 'registerProcessor("canonical-recording-capture",class extends AudioWorkletProcessor{constructor(){super();this.port.postMessage({v:1,type:"ready",sampleRate:24000});}process(_i,o){for(const a of o)for(const c of a)c.fill(0);return true;}});';
  const tab = await page({ module }); expect(await begin(tab)).toEqual({ ok: true });
  expect(await tab.evaluate(async () => { const stopped = window.capture.stop(); window.controller.abort(); return stopped; })).toEqual({ ok: false, error: "aborted" });
  expect(await released(tab)).toMatchObject({ closes: 1, disconnects: 1, state: "disposed" });
});

test("main-thread ten-minute deadline stops actual tracks and discards the take without an automatic blob", async () => {
  const tab = await page(); await tab.clock.install(); expect(await begin(tab)).toEqual({ ok: true });
  await tab.clock.fastForward(600_001);
  expect(await tab.evaluate(() => window.capture.stop())).toEqual({ ok: false, error: "limit-reached" });
  expect(await released(tab)).toMatchObject({ closes: 1, disconnects: 1, state: "failed" });
});

test("a never-settled close acknowledgement is bounded after real tracks and context have been closed", async () => {
  const tab = await page(); expect(await begin(tab)).toEqual({ ok: true });
  await tab.waitForFunction(() => window.instrumentation.messages.some(message => message.type === "pcm"));
  expect(await tab.evaluate(async () => {
    const context = window.instrumentation.contexts[0], close = context.close.bind(context);
    context.close = () => { void close(); return new Promise<void>(() => {}); };
    return window.capture.stop();
  })).toEqual({ ok: false, error: "interrupted" });
  expect(await released(tab)).toMatchObject({ closes: 1, disconnects: 1, state: "failed" });
});

test("worklet source independently downmixes/clamps finite stereo into exact little-endian PCM and emits only silence", () => {
  let Processor: new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean; port: { onmessage: (event: { data: unknown }) => void }; frames: number };
  const messages: { type: string; buffer?: ArrayBuffer; frames?: number; error?: string }[] = [];
  runInNewContext(worklet, { sampleRate: 24_000, ArrayBuffer, DataView, Math, Number, Object,
    AudioWorkletProcessor: class { port = { onmessage: undefined, postMessage(value: { type: string }) { messages.push(structuredClone(value)); } }; },
    registerProcessor(_name: string, value: typeof Processor) { Processor = value; } });
  const processor = new Processor!(), output = new Float32Array(6).fill(0.8);
  expect(processor.process([[Float32Array.from([-1, 1, 0.5, -0.5, 4, -4]), Float32Array.from([-1, 1, -0.5, 0.5, 2, -2])]], [[output]])).toBe(true);
  expect(Array.from(output)).toEqual([0, 0, 0, 0, 0, 0]);
  processor.port.onmessage({ data: { v: 1, type: "stop" } });
  expect(messages.map(message => message.type)).toEqual(["ready", "pcm", "done"]);
  const pcm = messages[1].buffer!; expect(Array.from(new Uint8Array(pcm))).toEqual([0, 128, 255, 127, 0, 0, 0, 0, 255, 127, 0, 128]);
  expect(messages[2].frames).toBe(6); expect(processor.process([], [[output.fill(1)]])).toBe(false); expect(Array.from(output)).toEqual([0, 0, 0, 0, 0, 0]);
});
