import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

test("fresh SDK import and explicit OIDC requests never read CLI credentials, mint tokens or spawn", async () => {
  const isolated = await isolatedEnv();
  try {
    const source = String.raw`
      import assert from "node:assert/strict";
      import fs from "node:fs";
      import fsp from "node:fs/promises";
      import childProcess from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      import { env } from "node:process";
      import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

      let privateIo = 0, spawned = 0, minted = 0, requests = 0;
      const privatePath = value => /[\\/](?:com\.vercel\.[^\\/]+|\.now)(?:[\\/]|$)|[\\/]auth\.json$|[\\/]\.vercel[\\/]project\.json$/i.test(String(value));
      for (const name of ["readFileSync", "readFile", "statSync", "lstatSync", "existsSync", "writeFileSync", "mkdirSync", "renameSync"]) {
        const original = fs[name];
        fs[name] = function (...args) {
          if (privatePath(args[0])) { privateIo++; throw Error("blocked private credential path"); }
          return original.apply(this, args);
        };
      }
      const originalRead = fsp.readFile;
      fsp.readFile = function (...args) {
        if (privatePath(args[0])) { privateIo++; throw Error("blocked private credential path"); }
        return originalRead.apply(this, args);
      };
      for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
        childProcess[name] = () => { spawned++; throw Error("blocked process launch"); };
      }
      globalThis.fetch = () => { minted++; throw Error("blocked non-SDK request"); };
      syncBuiltinESMExports();
      const previous = getGlobalDispatcher(), agent = new MockAgent();
      agent.disableNetConnect(); setGlobalDispatcher(agent);
      try {
        // Import the probe and its actual pinned SDK only after installing
        // tripwires. Every identity and response below is synthetic.
        const { PRIVATE_MEDIA_PROBE: p, runPrivateMediaOidcProbe: probe } = await import("./scripts/private-media-oidc-probe.mjs");
        const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
        const run = "87654321-4321-4321-8321-cba987654321";
        const now = Date.now(), seconds = Math.floor(now / 1000);
        const pool = agent.get("https://vercel.com");
        for (const [mode, environment] of [["production-allow", "production"], ["preview-deny", "preview"], ["development-deny", "development"]]) {
          const claims = { iss: "https://oidc.vercel.com/" + p.teamSlug, aud: "https://vercel.com/" + p.teamSlug,
            sub: "owner:" + p.teamSlug + ":project:" + p.projectName + ":environment:" + environment,
            owner: p.teamSlug, owner_id: p.teamId, project: p.projectName, project_id: p.projectId,
            environment, iat: seconds - 1, nbf: seconds - 1, exp: seconds + 120 };
          const token = encode({typ:"JWT",alg:"RS256",kid:"synthetic-review"}) + "." + encode(claims) + "." + encode("synthetic-signature");
          Object.assign(env, { PRIVATE_MEDIA_OIDC_PROBE_MODE:mode, PRIVATE_MEDIA_OIDC_PROBE_STORE_ID:p.storeId,
            PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:run, VERCEL_ENV:environment, VERCEL:"1", VERCEL_OIDC_TOKEN:token,
            BLOB_READ_WRITE_TOKEN:"unused" });
          pool.intercept({ method:"GET", path:value => {
            const url = new URL(value, "https://vercel.com");
            return url.pathname === "/api/blob" && url.searchParams.size === 2 && url.searchParams.get("limit") === "1"
              && url.searchParams.get("prefix") === "acceptance/" + run + "/";
          }, headers:headers => {
            // Boolean assertions never echo even these synthetic headers.
            assert.ok(headers.authorization === "Bearer " + token, "explicit OIDC header required");
            assert.ok(headers["x-vercel-blob-store-id"] === p.storeId.slice(6), "exact normalized store required");
            return true;
          }}).reply(() => {
            requests++;
            return { statusCode:environment === "production" ? 200 : 403,
              data:environment === "production" ? {blobs:[],hasMore:false} : {error:{code:"oidc_environment_not_allowed"}},
              responseOptions:{headers:{"content-type":"application/json"}} };
          });
          const result = await probe(env);
          assert.ok(result.ok === true, "actual SDK result must meet selected expectation");
          assert.ok(result.outcome === (environment === "production" ? "allowed" : "denied"), "mode result required");
          assert.ok(env.BLOB_READ_WRITE_TOKEN === undefined, "static credential removed");
          assert.ok(env.VERCEL_BLOB_RETRIES === "0", "SDK retries disabled");
          agent.assertNoPendingInterceptors();
        }
        assert.equal(requests, 3); assert.equal(privateIo, 0); assert.equal(spawned, 0); assert.equal(minted, 0);
        console.log(JSON.stringify({ok:true,requests,privateIo,spawned,minted}));
      } finally { setGlobalDispatcher(previous); await agent.close(); }
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      env: { ...isolated.env, LOCALAPPDATA: isolated.home, APPDATA: isolated.home },
      encoding: "utf8", timeout: 20000, maxBuffer: 8192, windowsHide: true,
    });
    assert.deepEqual(JSON.parse(output), { ok: true, requests: 3, privateIo: 0, spawned: 0, minted: 0 });
  } finally { await isolated.cleanup(); }
});
