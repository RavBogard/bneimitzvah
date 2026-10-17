/** Local microphone capture only. No authority, upload, URLs or persistent cache. */
export const RECORDING_CAPTURE_LIMITS = Object.freeze({ sampleRate: 24_000, maxFrames: 14_400_000,
  maxBytes: 32 * 1024 * 1024, chunkFrames: 4096, setupMs: 10_000, flushMs: 500, closeMs: 1000 });
export type RecordingCaptureError = "permission-denied" | "unsupported" | "interrupted" | "aborted" | "limit-reached" | "invalid-capture" | "empty-capture" | "flush-timeout" | "invalid-state";
export type RecordingCaptureFailure = Readonly<{ ok: false; error: RecordingCaptureError }>;
export type RecordingCaptureStart = Readonly<{ ok: true }> | RecordingCaptureFailure;
export type RecordingCaptureResult = Readonly<{ ok: true; blob: Blob; byteLength: number; frameCount: number; durationMs: number }> | RecordingCaptureFailure;
export type RecordingCaptureState = "idle" | "starting" | "recording" | "stopping" | "completed" | "failed" | "disposed";
const failed = (error: RecordingCaptureError): RecordingCaptureFailure => Object.freeze({ ok: false, error });
const interrupted = Symbol("capture-ended");
function wavHeader(frames: number) {
  const bytes = new ArrayBuffer(44), view = new DataView(bytes), ascii = (at: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + frames * 2, true); ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, frames * 2, true); return bytes;
}
function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

/** One take per controller. The future owner must abort/dispose on unmount or a
 * rightful-context change. Returned blobs stay local; metadata is not proof. */
export function createRecordingCapture({ signal }: { signal: AbortSignal }) {
  let phase: RecordingCaptureState = "idle", error: RecordingCaptureError | undefined;
  let stream: MediaStream | undefined, context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, node: AudioWorkletNode | undefined;
  let frames = 0, sequence = 0, buffers: ArrayBuffer[] = [], captureTimer: ReturnType<typeof setTimeout> | undefined, flushTimer: ReturnType<typeof setTimeout> | undefined, setupTimer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<boolean> | undefined, finishReady: (() => void) | undefined, ready = false, finishFlush: (() => void) | undefined, stopTask: Promise<RecordingCaptureResult> | undefined;
  let end!: () => void; const ended = new Promise<void>(resolve => { end = resolve; });
  const tracks = new Set<MediaStreamTrack>();
  const stopTracks = (value: MediaStream) => { for (const track of value.getTracks()) { try { track.stop(); } catch { /* No source details escape. */ } } };
  const onTrackEnded = () => terminate("interrupted");
  const onVisibility = () => { if (document.visibilityState !== "visible") terminate("interrupted"); };
  const onAbort = () => terminate("aborted");
  function detachLifecycle() { signal.removeEventListener("abort", onAbort); document.removeEventListener("visibilitychange", onVisibility); }
  function releaseResources() {
    if (captureTimer !== undefined) clearTimeout(captureTimer); if (flushTimer !== undefined) clearTimeout(flushTimer); if (setupTimer !== undefined) clearTimeout(setupTimer);
    captureTimer = flushTimer = setupTimer = undefined;
    for (const track of tracks) track.removeEventListener("ended", onTrackEnded); tracks.clear();
    if (stream) { stopTracks(stream); stream = undefined; }
    try { source?.disconnect(); } catch { /* Already disconnected. */ } source = undefined;
    if (node) { node.onprocessorerror = null; node.port.onmessage = null; node.port.onmessageerror = null; try { node.disconnect(); node.port.close(); } catch { /* Already closed. */ } node = undefined; }
    if (closing) return closing;
    const current = context; context = undefined;
    if (!current) return Promise.resolve(true);
    current.onstatechange = null;
    closing = new Promise<boolean>(resolve => {
      let settled = false; const timer = setTimeout(() => finish(false), RECORDING_CAPTURE_LIMITS.closeMs);
      const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve(ok); };
      try { void current.close().then(() => finish(true), () => finish(false)); } catch { finish(false); }
    });
    return closing;
  }
  function terminate(reason: RecordingCaptureError) {
    if (phase === "completed" || phase === "disposed" || phase === "failed") return;
    error = reason; phase = reason === "aborted" ? "disposed" : "failed"; buffers.length = 0; frames = sequence = 0;
    finishReady = finishFlush = undefined; detachLifecycle(); void releaseResources(); end();
  }
  function guard() { if (error || signal.aborted || document.visibilityState !== "visible") { if (!error) terminate(signal.aborted ? "aborted" : "interrupted"); throw interrupted; } }
  async function live<T>(pending: Promise<T>): Promise<T> { const value = await Promise.race([pending, ended.then(() => { throw interrupted; })]); guard(); return value; }
  function message(event: MessageEvent<unknown>) {
    if (!["starting", "recording", "stopping"].includes(phase)) return;
    const raw = event.data;
    if (!raw || typeof raw !== "object" || !("v" in raw) || raw.v !== 1) { terminate("invalid-capture"); return; }
    const value: Record<string, unknown> = raw as Record<string, unknown>;
    if (object(value, ["v", "type", "error"]) && value.type === "error") { terminate(value.error === "unsupported" ? "unsupported" : value.error === "limit-reached" ? "limit-reached" : "invalid-capture"); return; }
    if (object(value, ["v", "type", "sampleRate"]) && value.type === "ready" && value.sampleRate === 24_000 && phase === "starting" && !ready) { ready = true; finishReady?.(); return; }
    if (ready && object(value, ["v", "type", "sequence", "frames", "buffer"]) && value.type === "pcm") {
      const count = value.frames;
      if (value.sequence !== sequence || !Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > RECORDING_CAPTURE_LIMITS.chunkFrames
        || !(value.buffer instanceof ArrayBuffer) || value.buffer.byteLength !== (count as number) * 2
        || frames + (count as number) > RECORDING_CAPTURE_LIMITS.maxFrames || 44 + (frames + (count as number)) * 2 > RECORDING_CAPTURE_LIMITS.maxBytes) { terminate("invalid-capture"); return; }
      frames += count as number; sequence++; buffers.push(value.buffer); return;
    }
    if (ready && object(value, ["v", "type", "chunks", "frames"]) && value.type === "done" && phase === "stopping" && value.chunks === sequence && value.frames === frames) { finishFlush?.(); return; }
    terminate("invalid-capture");
  }
  async function start(): Promise<RecordingCaptureStart> {
    if (phase !== "idle") return failed(error ?? "invalid-state");
    phase = "starting"; signal.addEventListener("abort", onAbort, { once: true }); document.addEventListener("visibilitychange", onVisibility);
    let permission = true;
    try {
      guard(); if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) { terminate("unsupported"); throw interrupted; }
      const permissionRequest = navigator.mediaDevices.getUserMedia({ video: false, audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 24_000 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      void permissionRequest.then(value => { if (error || phase === "disposed" || phase === "failed") stopTracks(value); else stream = value; }, () => undefined);
      stream = await live(permissionRequest); permission = false;
      setupTimer = setTimeout(() => terminate("interrupted"), RECORDING_CAPTURE_LIMITS.setupMs);
      for (const track of stream.getTracks()) { tracks.add(track); track.addEventListener("ended", onTrackEnded, { once: true }); if (track.readyState !== "live") { terminate("interrupted"); throw interrupted; } }
      context = new AudioContext({ sampleRate: 24_000 });
      if (context.sampleRate !== RECORDING_CAPTURE_LIMITS.sampleRate || !context.audioWorklet) { terminate("unsupported"); throw interrupted; }
      const selectedContext = context;
      await live(selectedContext.audioWorklet.addModule(new URL("/recording-capture-worklet.js", location.origin).href));
      const processorReady = new Promise<void>(resolve => { finishReady = resolve; });
      node = new AudioWorkletNode(selectedContext, "canonical-recording-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.onprocessorerror = () => terminate("interrupted"); node.port.onmessage = message; node.port.onmessageerror = () => terminate("invalid-capture");
      source = selectedContext.createMediaStreamSource(stream); source.connect(node); node.connect(selectedContext.destination);
      await live(selectedContext.resume()); await live(processorReady); finishReady = undefined;
      if (selectedContext.state !== "running") { terminate("interrupted"); throw interrupted; }
      if (setupTimer !== undefined) clearTimeout(setupTimer); setupTimer = undefined;
      phase = "recording"; selectedContext.onstatechange = () => { if ((phase === "recording" || phase === "stopping") && selectedContext.state !== "running") terminate("interrupted"); };
      captureTimer = setTimeout(() => terminate("limit-reached"), 600_000); return Object.freeze({ ok: true });
    } catch (reason) {
      if (!error) terminate(permission && reason instanceof DOMException && reason.name === "NotAllowedError" ? "permission-denied" : permission && reason instanceof DOMException && reason.name === "SecurityError" ? "permission-denied" : permission ? "interrupted" : "unsupported");
      return failed(error ?? "interrupted");
    }
  }
  async function finish(): Promise<RecordingCaptureResult> {
    if (phase !== "recording") { if (phase === "starting") terminate("aborted"); return failed(error ?? "invalid-state"); }
    phase = "stopping"; if (captureTimer !== undefined) clearTimeout(captureTimer); captureTimer = undefined;
    const flushed = new Promise<void>(resolve => { finishFlush = resolve; });
    flushTimer = setTimeout(() => terminate("flush-timeout"), RECORDING_CAPTURE_LIMITS.flushMs);
    try {
      node?.port.postMessage({ v: 1, type: "stop" }); await live(flushed); finishFlush = undefined;
      if (flushTimer !== undefined) clearTimeout(flushTimer); flushTimer = undefined;
      if (!frames) { terminate("empty-capture"); throw interrupted; }
      const frameCount = frames, byteLength = 44 + frameCount * 2, blob = new Blob([wavHeader(frameCount), ...buffers], { type: "audio/wav" }); buffers.length = 0;
      if (!await releaseResources()) { terminate("interrupted"); throw interrupted; }
      guard(); phase = "completed"; detachLifecycle();
      return Object.freeze({ ok: true, blob, frameCount, byteLength, durationMs: Math.ceil(frameCount / 24) });
    } catch { if (!error) terminate("interrupted"); return failed(error ?? "interrupted"); }
  }
  return Object.freeze({
    state: () => phase,
    start,
    stop(): Promise<RecordingCaptureResult> { if (stopTask) return stopTask; const task = finish(); stopTask = task; void task.finally(() => { if (stopTask === task) stopTask = undefined; }); return task; },
    dispose() { if (phase === "completed") { phase = "disposed"; detachLifecycle(); } else terminate("aborted"); },
  });
}
