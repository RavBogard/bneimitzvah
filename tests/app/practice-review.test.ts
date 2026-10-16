import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { practiceFixture } from "./practice-fixture";
import { createAccessService } from "../../src/server/access/service";
import { createPracticeService } from "../../src/server/practice/service";
import { AccessDenied } from "../../src/server/access/errors";

const fixtures: Awaited<ReturnType<typeof practiceFixture>>[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.client.close())); });

test("a genuine session proof obtained before a completed sibling switch cannot authorize a late old-context write", async () => {
  const f = await practiceFixture(); fixtures.push(f);
  const old = await f.practice.enter(f.request(), { studentId: f.students[0].id });
  let successor: Awaited<ReturnType<typeof f.practice.switch>> | undefined;
  let sawProof = false;
  const api = new Proxy(f.auth.api, { get(target, key, receiver) {
    if (key !== "getSession") return Reflect.get(target, key, receiver);
    return async (options: Parameters<typeof f.auth.api.getSession>[0]) => {
      const proof = await target.getSession(options);
      sawProof = Boolean(proof);
      successor = await f.practice.switch(f.request("multi", old.handle), { studentId: f.students[1].id });
      return proof;
    };
  } });
  const service = createPracticeService({ access: createAccessService({ db: f.db, auth: { api }, deployment: { environment: "test", deployment: "suite" } }) });
  let called = false;
  let denied = false;
  try {
    await service.withPracticeCapability(f.request("multi", old.handle), { mode: "child-practice", studentId: f.students[0].id, capability: "practice-write" }, async () => { called = true; });
  } catch (error) { denied = error instanceof AccessDenied && error.status === 404; }
  expect(sawProof && Boolean(successor) && denied && !called).toBe(true);
  const current = await f.practice.read(f.request("multi", successor!.handle), { mode: "child-practice", studentId: f.students[1].id });
  expect(current.context?.id === successor!.context.id && current.student.id === f.students[1].id).toBe(true);
});
