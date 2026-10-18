import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createReadingExplorationService } from "../../src/server/study/exploration";
import { createPracticeService } from "../../src/server/practice/service";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { AccessDenied } from "../../src/server/access/errors";
import { syntheticResponse } from "../helpers/study";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";

type Fixture = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function fixture(load?: Parameters<typeof createReadingExplorationService>[0]["loadText"]) {
  const f = await postgresAccessFixture(); fixtures.push(f);
  await f.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, f.student.id));
  const reader = createSefariaStudyReader({ fetch: async url => syntheticResponse(decodeURIComponent(new URL(String(url)).pathname.split("/").at(-1)!)), verseCounts: TANAKH_VERSE_COUNTS });
  const service = createReadingExplorationService({ access: f.a, practice: createPracticeService({ access: f.a }), signingSecret: randomBytes(48).toString("base64url"),
    loadReading: async (date, calendar) => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(date), calendar, classification: "regular", reading: {
      parashah: "Synthetic", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1, ref: "Genesis 1:1-6:8" }], triennial: null }, haftarah: null } }), loadText: load ?? reader });
  const original = f.request("tutor"), request = { ...original, method: "POST", headers: new Headers(original.headers) }; request.headers.set("origin", "http://localhost:3000");
  const selection = { mode: "tutor" as const, studentId: f.student.id };
  return { ...f, service, request, selection };
}

test("restricted real LOGIN can explore full parashah without creating an assignment", async () => {
  const f = await fixture(), prepared = await f.service.prepare(f.request, f.selection);
  expect(prepared).toMatchObject({ ok: true, status: "prepared", verseCount: 146 });
  if (!prepared.ok || prepared.status !== "prepared") throw new Error("Synthetic exploration was not prepared");
  for (const page of prepared.pages) {
    const result = await f.service.page(f.request, { ...f.selection, binding: prepared.binding, offset: page.offset });
    expect(result.ok).toBe(true); if (result.ok) { expect(result.page.verses.length).toBeLessThanOrEqual(100); expect(result.page.chapters.length).toBeLessThanOrEqual(8); }
  }
  expect(await f.ownerDb.select().from(s.assignment).where(eq(s.assignment.studentId, f.student.id))).toHaveLength(0);
});

test.each(["relationship", "assignment"] as const)("committed %s change during public text work withholds exploration delivery", async change => {
  const entered = deferred(), release = deferred();
  const f = await fixture(async request => { entered.resolve(); await release.promise;
    return createSefariaStudyReader({ fetch: async url => syntheticResponse(decodeURIComponent(new URL(String(url)).pathname.split("/").at(-1)!)), verseCounts: TANAKH_VERSE_COUNTS })(request); });
  const prepared = await f.service.prepare(f.request, f.selection);
  if (!prepared.ok || prepared.status !== "prepared") throw new Error("Synthetic exploration was not prepared");
  let returned = false;
  const operation = f.service.page(f.request, { ...f.selection, binding: prepared.binding, offset: 0 }).then(result => { returned = true; return result.ok ? 200 : 409; }, error => {
    returned = true; return error instanceof AccessDenied ? error.status : 503;
  });
  try {
    await waitForEntry(entered.promise, operation);
    const mutation = change === "relationship"
      ? f.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.link.id))
      : f.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", status: "confirmed", basis: "custom", ref: "Genesis 1:1-3",
        setByMembershipId: (await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id)))[0].id });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([mutation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic exploration mutation could not commit outside public work")), 5000); })]); }
    finally { if (timer) clearTimeout(timer); }
    expect(returned).toBe(false); release.resolve();
    expect(await operation).toBe(change === "relationship" ? 404 : 409);
  } finally { release.resolve(); await operation; }
});
