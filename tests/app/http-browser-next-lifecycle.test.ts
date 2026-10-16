import { afterEach, expect, it, vi } from "vitest";
import { closeNextDevelopment } from "../http-browser/next-lifecycle";

afterEach(() => vi.unstubAllEnvs());

it("requests pinned native shutdown through the entire awaited close and restores the exact prior environment", async () => {
  for (const previous of [undefined, "0", "1", "synthetic-previous"] as const) {
    vi.stubEnv("__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN", previous);
    let finish!: () => void, entered = false, returned = false;
    const close = closeNextDevelopment(async () => { entered = true; expect(process.env.__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN).toBe("1"); await new Promise<void>(resolve => { finish = resolve; }); });
    void close.then(() => { returned = true; });
    await Promise.resolve(); expect(entered && !returned && process.env.__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN === "1").toBe(true);
    finish(); await close; expect(process.env.__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN).toBe(previous);
  }
});

it("propagates an observed close failure and restores the flag without claiming successful internal cleanup", async () => {
  vi.stubEnv("__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN", "synthetic-previous");
  const failure = new Error("Synthetic shutdown failure");
  await expect(closeNextDevelopment(async () => { throw failure; })).rejects.toBe(failure);
  expect(process.env.__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN).toBe("synthetic-previous");
});
