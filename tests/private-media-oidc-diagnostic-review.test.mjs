import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIVATE_MEDIA_PROBE as P, runPrivateMediaOidcProbe as probe } from "../scripts/private-media-oidc-probe.mjs";

const now = Date.UTC(2026, 9, 17, 12), seconds = now / 1000;
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function environment(claims = {}, header = {}, labels = {}) {
  const body = { iss: `https://oidc.vercel.com/${P.teamSlug}`, aud: `https://vercel.com/${P.teamSlug}`,
    sub: `owner:${P.teamSlug}:project:${P.projectName}:environment:production`, owner: P.teamSlug, owner_id: P.teamId,
    project: P.projectName, project_id: P.projectId, environment: "production", iat: seconds - 1, nbf: seconds - 1,
    exp: seconds + 300, ...claims };
  return { PRIVATE_MEDIA_OIDC_PROBE_MODE: "production-allow", PRIVATE_MEDIA_OIDC_PROBE_STORE_ID: P.storeId,
    PRIVATE_MEDIA_OIDC_PROBE_RUN_ID: "22222222-2222-4222-8222-222222222222", VERCEL: "1", VERCEL_ENV: "production",
    VERCEL_OIDC_TOKEN: `${encode({ typ: "JWT", alg: "RS256", kid: "synthetic-review", ...header })}.${encode(body)}.${encode("synthetic-signature")}`,
    ...labels };
}
class BlobError extends Error {}
const closed = value => {
  assert.deepEqual(Object.keys(value).sort(), ["environmentMatch", "expectation", "mode", "ok", "outcome"]);
  assert.equal(value.ok, false); assert.equal(value.outcome, "failed");
  assert.ok(!JSON.stringify(value).includes("synthetic-sensitive"));
};

test("diagnostics preserve the original first failing predicate when several values are invalid", async () => {
  const cases = [
    [environment({}, { typ: "other", alg: "other", kid: "" }), "identity", "header-type"],
    [environment({ owner: "other", environment: "other", aud: "other" }), "identity", "owner-name"],
    [environment({ sub: "other", iss: "other", aud: "other", custom_environment_id: "other" }), "identity", "subject"],
    [environment({ aud: "other", custom_environment_id: "other" }), "identity", "audience"],
    // Original conjunction checks nbf>=0 before checking iat<=current time.
    [environment({ iat: seconds + 1, nbf: -1 }), "identity", "not-before"],
    [environment({ iat: -1, nbf: -1 }), "identity", "issued-at"],
    [environment({}, {}, { VERCEL_ENV: "other", VERCEL_TARGET_ENV: "other", VERCEL: undefined }), "identity", "native-environment"],
  ];
  for (const [env, phase, check] of cases) {
    const records = []; let imports = 0;
    const result = await probe(env, { now: () => now, loadSdk: async () => { imports++; throw 0; }, onDiagnostic: r => records.push(r) });
    closed(result); assert.equal(imports, 0);
    assert.deepEqual(records, [{ schema: "private-media-oidc-diagnostic/v1", phase, check }]);
  }
  let tokenReads = 0; const records = [], env = environment({}, {}, { NODE_OPTIONS: "synthetic-sensitive" });
  Object.defineProperty(env, "VERCEL_OIDC_TOKEN", { get() { tokenReads++; throw Error("must not read identity yet"); } });
  closed(await probe(env, { onDiagnostic: r => records.push(r) }));
  assert.equal(tokenReads, 0);
  assert.deepEqual(records, [{ schema: "private-media-oidc-diagnostic/v1", phase: "environment-guard", check: "node-options" }]);
});

test("diagnostic callback gets one frozen literal record and cannot replace the fixed failure by throwing", async () => {
  let calls = 0;
  const result = await probe(environment({}, {}, { NODE_OPTIONS: "synthetic-sensitive" }), {
    onDiagnostic(...args) {
      calls++; assert.equal(args.length, 1);
      assert.deepEqual(args[0], { schema: "private-media-oidc-diagnostic/v1", phase: "environment-guard", check: "node-options" });
      assert.ok(Object.isFrozen(args[0]));
      assert.throws(() => { args[0].check = "synthetic-sensitive"; }, TypeError);
      throw Error("synthetic-sensitive callback exception");
    },
  });
  closed(result); assert.equal(calls, 1);
  let accesses = 0; const deps = {};
  Object.defineProperty(deps, "onDiagnostic", { get() { accesses++; throw Error("synthetic-sensitive accessor"); } });
  closed(await probe(environment({}, {}, { NODE_OPTIONS: "synthetic-sensitive" }), deps));
  assert.equal(accesses, 1);
});

test("synchronous abort listeners and late stage callbacks cannot replace a deadline snapshot", async () => {
  const records = []; let lateStage, signals = 0;
  const result = await probe(environment(), { now: () => now, timeoutMs: 5, onDiagnostic: r => records.push(r),
    loadSdk: async at => {
      lateStage = at;
      return { BlobError, list: ({ abortSignal }) => new Promise(resolve => {
        abortSignal.addEventListener("abort", () => {
          signals++; at("identity", "issuer");
          resolve({ blobs: [], hasMore: false });
        }, { once: true });
      }) };
    },
  });
  closed(result); assert.equal(signals, 1);
  assert.deepEqual(records, [{ schema: "private-media-oidc-diagnostic/v1", phase: "deadline", check: "sdk-request" }]);
  lateStage("identity", "audience"); lateStage(["identity"], "issuer"); lateStage("identity", ["issuer"]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(records, [{ schema: "private-media-oidc-diagnostic/v1", phase: "deadline", check: "sdk-request" }]);
});
