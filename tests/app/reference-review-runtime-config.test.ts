import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";

function base() {
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login"; database.password = randomBytes(24).toString("hex"); database.searchParams.set("sslmode", "require");
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-review", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
}
const selected = { FINKEL_REVIEW_TENANT_ID: "crc", FINKEL_REVIEW_REVIEWER_USER_ID: "11111111-1111-4111-8111-111111111111", BLOB_STORE_ID: "store_SYNTHETIC123" };
test("private review is disabled without reviewer configuration and has no student playback dependency", () => {
  expect(loadRuntimeConfig(base()).referenceReview).toBeUndefined();
  const result = loadRuntimeConfig({ ...base(), ...selected });
  expect(result.referenceReview).toEqual({ reviewer: { tenantId: "crc", userId: selected.FINKEL_REVIEW_REVIEWER_USER_ID }, storeId: selected.BLOB_STORE_ID });
  expect(result.referenceAudio).toBeUndefined();
  const opaque = loadRuntimeConfig({ ...base(), ...selected, FINKEL_REVIEW_REVIEWER_USER_ID: "Synthetic_Reviewer-1" });
  expect(opaque.referenceReview?.reviewer.userId).toBe("Synthetic_Reviewer-1");
  const withCatalog = loadRuntimeConfig({ ...base(), ...selected, REFERENCE_AUDIO_CATALOG_SHA256: "a".repeat(64) });
  expect(withCatalog.referenceAudio?.studentRelease).toBe(false);
  expect(withCatalog.referenceReview?.storeId).toBe(withCatalog.referenceAudio?.storeId);
});
test("partial reviewer configuration, unknown tenant, malformed user and missing private store fail closed", () => {
  for (const extra of [
    { FINKEL_REVIEW_TENANT_ID: "crc" }, { FINKEL_REVIEW_REVIEWER_USER_ID: selected.FINKEL_REVIEW_REVIEWER_USER_ID },
    { ...selected, FINKEL_REVIEW_TENANT_ID: "other" }, { ...selected, FINKEL_REVIEW_REVIEWER_USER_ID: "synthetic@example.test" },
    { ...selected, FINKEL_REVIEW_REVIEWER_USER_ID: selected.FINKEL_REVIEW_REVIEWER_USER_ID + " " },
    { ...selected, BLOB_STORE_ID: undefined }, { ...selected, BLOB_STORE_ID: "https://synthetic.invalid/private" },
    { ...selected, VERCEL_BLOB_API_URL: "https://synthetic.invalid" }, { ...selected, NEXT_PUBLIC_VERCEL_BLOB_API_URL: "" },
  ]) {
    try { loadRuntimeConfig({ ...base(), ...extra }); expect.fail("Expected closed configuration rejection"); }
    catch (error) { expect(error).toBeInstanceOf(RuntimeUnavailable); expect((error as Error).message).toBe("Service temporarily unavailable"); expect(error).not.toHaveProperty("cause"); }
  }
});
test("the composed dispatcher returns a private unavailable response while reviewer configuration is absent", async () => {
  const f = await portalRoutesFixture();
  try {
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const response = await dispatch(f.request("/api/reference-review/batches", { who: "admin" }));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const unknown = await dispatch(f.request("/api/reference-review/batches/admit", { who: "admin", body: {} }));
    expect(unknown.status).toBe(404);
  } finally { await f.client.close(); }
});
