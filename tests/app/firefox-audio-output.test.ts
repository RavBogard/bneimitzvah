import { afterEach, expect, test, vi } from "vitest";
import { ownFirefoxAudioOutput, ownedPulseReady, stopOwnedAudioProcess, ownedAudioToolchain, type AudioOutputDriver } from "../http-browser/firefox-audio-output";
afterEach(() => vi.useRealTimers());
function driver() {
  const events: string[] = [], server = {};
  const actions: AudioOutputDriver<object> = {
    create: vi.fn(async () => { events.push("create"); return { home: "/tmp/owned", socket: "/tmp/owned/pulse.sock" }; }),
    launch: vi.fn(async () => { events.push("launch"); return server; }),
    ready: vi.fn(async () => { events.push("ready"); }),
    stop: vi.fn(async value => { expect(value).toBe(server); events.push("stop"); }),
    cleanup: vi.fn(async () => { events.push("cleanup"); }),
  };
  return { actions, events };
}
test("non-Linux creates no output server or environment override", async () => {
  const f = driver(), output = await ownFirefoxAudioOutput("win32", f.actions);
  expect(output.environment).toEqual({}); await output.close(); expect(f.events).toEqual([]);
});
test("only the owned Unix server enters browser env and close stops before removing HOME", async () => {
  const f = driver(), output = await ownFirefoxAudioOutput("linux", f.actions);
  expect(output.environment).toEqual({ PULSE_SERVER: "unix:/tmp/owned/pulse.sock" });
  expect(Object.isFrozen(output.environment)).toBe(true); expect(f.events).toEqual(["create", "launch", "ready"]);
  await output.close(); await output.close(); expect(f.events).toEqual(["create", "launch", "ready", "stop", "cleanup"]);
});
test("readiness denial stops the partially started owned server and removes HOME", async () => {
  const f = driver(); f.actions.ready = async () => { throw Error("private daemon details"); };
  await expect(ownFirefoxAudioOutput("linux", f.actions)).rejects.toThrow("details withheld");
  expect(f.events).toEqual(["create", "launch", "stop", "cleanup"]);
});
test("launch denial cleans the workspace without attempting to kill another process", async () => {
  const f = driver(); f.actions.launch = async () => { throw Error("private launch details"); };
  await expect(ownFirefoxAudioOutput("linux", f.actions)).rejects.toThrow("details withheld"); expect(f.events).toEqual(["create", "cleanup"]);
});
test("failed stop retains ownership evidence instead of deleting underneath a running daemon", async () => {
  const f = driver(), output = await ownFirefoxAudioOutput("linux", f.actions);
  f.actions.stop = async () => { f.events.push("stop-held"); throw Error("held"); };
  await expect(output.close()).rejects.toThrow(); expect(f.events).not.toContain("cleanup");
});
test("readiness requires exactly the Unix protocol and one null sink, refusing hardware and TCP", () => {
  const sinks = "1\tbneimitzvah_test\tmodule-null-sink.c\tfloat32le 2ch 48000Hz\tIDLE\n";
  const modules = "0\tmodule-native-protocol-unix\tsocket=/tmp/owned\n1\tmodule-null-sink\tsink_name=bneimitzvah_test\n";
  expect(ownedPulseReady(sinks, modules)).toBe(true); expect(ownedPulseReady("", modules.split("\n")[0])).toBe(false);
  for (const invalid of [modules + "2\tmodule-alsa-card\n", modules.replace("module-native-protocol-unix", "module-native-protocol-tcp"), modules.replace("module-null-sink", "module-udev-detect"), modules.replace("module-null-sink", "module-native-protocol-unix")]) expect(() => ownedPulseReady(sinks, invalid)).toThrow();
  expect(() => ownedPulseReady(sinks + sinks, modules)).toThrow(); expect(() => ownedPulseReady(sinks.replace("bneimitzvah_test", "other"), modules)).toThrow();
});
function processHandle(ending: "term" | "kill" | "never") {
  let finished = false, resolve!: () => void;
  const ended = new Promise<void>(yes => { resolve = yes; });
  const kill = vi.fn((signal: string) => { if (ending === "term" || ending === "kill" && signal === "SIGKILL") { finished = true; resolve(); } return true; });
  return { child: { kill } as unknown as Parameters<typeof stopOwnedAudioProcess>[0]["child"], ended, finished: () => finished, kill };
}
test("shutdown signals only its stored child handle and clears the grace timer", async () => {
  vi.useFakeTimers(); const server = processHandle("term"); await stopOwnedAudioProcess(server);
  expect(server.kill.mock.calls).toEqual([["SIGTERM"]]); expect(vi.getTimerCount()).toBe(0);
});
test("a held daemon is escalated only through its owned handle and cannot silently pass cleanup", async () => {
  vi.useFakeTimers(); const server = processHandle("kill"), stopping = stopOwnedAudioProcess(server); await vi.advanceTimersByTimeAsync(1000); await stopping;
  expect(server.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]); expect(vi.getTimerCount()).toBe(0);
  const retained = processHandle("never"), held = expect(stopOwnedAudioProcess(retained)).rejects.toThrow("details withheld"); await vi.advanceTimersByTimeAsync(2000); await held;
});
test("local overrides cannot select a non-owned toolchain; CI defaults remain fixed", async () => {
  expect(await ownedAudioToolchain()).toEqual({ pulse: "/usr/bin/pulseaudio", pactl: "/usr/bin/pactl" });
  for (const path of ["/etc/toolchain.json", "/tmp/arbitrary/toolchain.json", "/tmp/finkel-audio-toolchain-0000000000000000/other.json"]) await expect(ownedAudioToolchain(path)).rejects.toThrow();
});
