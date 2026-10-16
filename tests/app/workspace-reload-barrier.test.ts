import { expect, it, vi } from "vitest";
import { reloadWorkspaceScopes, type ReloadRegistration } from "../../src/components/portal/workspace/reload-barrier";

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it("allows a removed student's aborted reload only after checking the live session", async () => {
  const reading = deferred(), session = deferred(), verify = vi.fn(() => session.promise);
  const registration = { reload: () => reading.promise }, active = new Set([registration]);
  let revealed = false;
  const barrier = reloadWorkspaceScopes(active, verify).then(() => { revealed = true; });
  active.delete(registration); reading.reject(new Error("Aborted removed reading"));
  await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());
  expect(revealed).toBe(false); session.resolve(); await barrier;
  expect(revealed).toBe(true);
});

it.each([401, 403, 404, 503])("preserves an active scope's %s failure", async status => {
  const error = Object.assign(new Error("Active scope denied or unavailable"), { status });
  const verify = vi.fn(), active = new Set([{ reload: async () => { throw error; } }]);
  await expect(reloadWorkspaceScopes(active, verify)).rejects.toBe(error);
  expect(verify).not.toHaveBeenCalled();
});

it("waits for a replacement registration even when it reuses the same callback", async () => {
  const first = deferred(), replacement = deferred(), verify = vi.fn(async () => {});
  let calls = 0, revealed = false;
  const reload = () => ++calls === 1 ? first.promise : replacement.promise;
  const old = { reload }, current = { reload }, active = new Set([old]);
  const barrier = reloadWorkspaceScopes(active, verify).then(() => { revealed = true; });
  active.delete(old); active.add(current); first.reject(new Error("Old scope aborted"));
  await vi.waitFor(() => expect(calls).toBe(2));
  expect(revealed).toBe(false); expect(verify).not.toHaveBeenCalled();
  replacement.resolve(); await barrier;
  expect(verify).toHaveBeenCalledOnce(); expect(revealed).toBe(true);
});

it("drains a replacement registered during the final session check", async () => {
  const first = deferred(), replacement = deferred(), session = deferred();
  const old = { reload: () => first.promise }, next = { reload: vi.fn(() => replacement.promise) }, active = new Set<ReloadRegistration>([old]);
  let revealed = false;
  const verify = vi.fn(() => session.promise);
  const barrier = reloadWorkspaceScopes(active, verify).then(() => { revealed = true; });
  active.delete(old); first.reject(new Error("Removed scope"));
  await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());
  active.add(next); session.resolve();
  await vi.waitFor(() => expect(next.reload).toHaveBeenCalledOnce());
  expect(revealed).toBe(false); replacement.resolve(); await barrier;
  expect(revealed).toBe(true);
});

it("fails closed when post-removal session verification fails", async () => {
  const first = deferred(), old = { reload: () => first.promise }, active = new Set([old]);
  const denied = Object.assign(new Error("Session changed"), { status: 401 });
  const barrier = reloadWorkspaceScopes(active, async () => { throw denied; });
  active.delete(old); first.reject(new Error("Removed reading"));
  await expect(barrier).rejects.toBe(denied);
});

it("fails closed on endless replacement churn", async () => {
  const active = new Set<ReloadRegistration>();
  const replace = (): ReloadRegistration => ({ reload: async () => { active.clear(); active.add(replace()); } });
  active.add(replace());
  await expect(reloadWorkspaceScopes(active, async () => {})).rejects.toThrow("did not settle");
});
