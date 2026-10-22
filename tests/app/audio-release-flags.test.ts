import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { audioReleases } from "../../src/server/runtime/composition";

const env = () => {
  const url = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic"); url.username = "synthetic_login"; url.password = randomBytes(24).toString("hex"); url.searchParams.set("sslmode", "require");
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": url.href, "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"),
    "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test", REFERENCE_AUDIO_CATALOG_SHA256: "a".repeat(64), BLOB_STORE_ID: "store_synthetic123" } as Record<string, string>;
};
const releases = (extra: Record<string, string>) => audioReleases(loadRuntimeConfig({ ...env(), ...extra }));

test("reference recordings and CRC Music service audio are released by separate flags, each only its own", () => {
  expect(releases({})).toEqual({ reference: false, service: false });
  expect(releases({ REFERENCE_AUDIO_STUDENT_RELEASE: "false", SERVICE_AUDIO_STUDENT_RELEASE: "false" })).toEqual({ reference: false, service: false });
  expect(releases({ REFERENCE_AUDIO_STUDENT_RELEASE: "true" })).toEqual({ reference: true, service: false });
  expect(releases({ SERVICE_AUDIO_STUDENT_RELEASE: "true" })).toEqual({ reference: false, service: true });
  expect(releases({ REFERENCE_AUDIO_STUDENT_RELEASE: "true", SERVICE_AUDIO_STUDENT_RELEASE: "true" })).toEqual({ reference: true, service: true });
});

test("a malformed service-audio flag is off and never takes the portal down", () => {
  for (const value of ["", "1", "TRUE", "True", " true", "true ", "yes", "on", "true\n"]) expect(releases({ SERVICE_AUDIO_STUDENT_RELEASE: value }), JSON.stringify(value)).toEqual({ reference: false, service: false });
  // Without any reference catalog the service flag still stands on its own.
  const base = env(); delete base.REFERENCE_AUDIO_CATALOG_SHA256;
  expect(audioReleases(loadRuntimeConfig({ ...base, SERVICE_AUDIO_STUDENT_RELEASE: "true" }))).toEqual({ reference: false, service: true });
});
