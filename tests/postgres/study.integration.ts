import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createStudyService, type StudySelection } from "../../src/server/study/service";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { createPublicStudyCoalescer } from "../../src/server/study/coalescing";
import { createPersistentStudyCache } from "../../src/server/data/study-cache";
import { createPracticeService } from "../../src/server/practice/service";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { AccessDenied } from "../../src/server/access/errors";
import { syntheticRequest, syntheticResponse } from "../helpers/study";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";

type Fixture = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
type Change = "assignment" | "relationship" | "grant" | "logout" | "context" | "student";
async function seedAssignment(f: Fixture) {
  return f.ownerDb.transaction(async tx => {
    const [row] = await tx.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", basis: "custom",
      ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: (await tx.select().from(s.membership).where(eq(s.membership.userId, f.admin.id)))[0].id,
      proposalSnapshot: { confirmationDate: f.student.ceremonyDate, needsReview: false } }).returning();
    await tx.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: f.student.id, assignmentId: row.id, ordinal: verse, verseRef: `Genesis 1:${verse}` })));
    return row;
  }).catch(() => { throw new Error("Synthetic study assignment setup failed"); });
}
async function race(change: Change, cacheHit = false) {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const assignment = await seedAssignment(f);
  const entered = deferred(), release = deferred();
  let returned = false, committedWhileHeld = false, responseReleased = false;
  const cache = createPersistentStudyCache(f.aDb);
  if (cacheHit) await createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS, cache })(syntheticRequest());
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { entered.resolve(); await release.promise; return syntheticResponse(); });
  const reader = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS, coalescer: createPublicStudyCoalescer(),
    cache: cacheHit ? { ...cache, get: async binding => { const value = await cache.get(binding); entered.resolve(); await release.promise; return value; } } : cache });
  const practice = change === "context" ? await f.practice() : null;
  const old = practice ? await practice.a.enter(practice.request(), { studentId: f.student.id }) : null;
  const service = createStudyService({ access: f.a, practice: practice?.a ?? createPracticeService({ access: f.a }), load: reader });
  const selection: StudySelection = { mode: practice ? "child-practice" : "tutor", studentId: f.student.id,
    kind: "torah", assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023", offset: 0 };
  const operation = service.read(practice && old ? practice.request(old.handle) : f.request("tutor"), selection)
    .then(value => { returned = true; return { status: value.ok ? 200 : 409 }; }, error => {
      returned = true; return { status: error instanceof AccessDenied ? error.status : 503 };
    });
  try {
    await waitForEntry(entered.promise, operation);
    const mutation = (async () => {
      if (change === "assignment") {
        await f.ownerDb.transaction(async tx => {
          await tx.update(s.assignment).set({ revision: 2, ref: "Genesis 1:2-3" }).where(eq(s.assignment.id, assignment.id));
          await tx.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, assignment.id));
          await tx.insert(s.assignmentVerse).values([2, 3].map((verse, index) => ({ tenantId: "crc", studentId: f.student.id, assignmentId: assignment.id, ordinal: index + 1, verseRef: `Genesis 1:${verse}` })));
        });
      } else if (change === "relationship") await f.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.link.id));
      else if (change === "grant") await f.ownerDb.update(s.roleGrant).set({ revokedAt: new Date(), revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.tutorGrant.id));
      else if (change === "logout") await f.ownerDb.delete(s.session).where(eq(s.session.id, f.tutor.sessionId));
      else if (change === "student") await f.ownerDb.update(s.student).set({ revision: sql`${s.student.revision}+1`, firstName: "Synthetic edited" }).where(eq(s.student.id, f.student.id));
      else if (practice && old) await practice.b.switch(practice.request(old.handle), { studentId: practice.sibling.id });
      committedWhileHeld = !returned && !responseReleased;
    })().catch(() => { throw new Error("Synthetic study mutation failed"); });
    // Requiring COMMIT before releasing the actual fetch/cache barrier proves
    // the old capability transaction is no longer holding authority locks.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([mutation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Study mutation could not commit while public work was held")), 5000); })]); }
    finally { if (timer) clearTimeout(timer); }
    expect(committedWhileHeld).toBe(true);
    responseReleased = true; release.resolve();
    const result = await operation;
    const status = { assignment: 409, relationship: 404, grant: 403, logout: 401, context: 404, student: 409 }[change];
    expect(result.status).toBe(status);
    expect(fetch.mock.calls.length).toBe(cacheHit ? 0 : 1);
  } finally { release.resolve(); await operation; }
}

test.each(["assignment", "relationship", "grant", "logout", "context", "student"] as const)("committed %s change while actual synthetic fetch is held discards delivery", async change => { await race(change); });
test.each(["assignment", "context", "student"] as const)("committed %s change while actual persistent cache hit is held discards delivery", async change => { await race(change, true); });

test.each(["session", "context"] as const)("natural %s expiry while final assignment read is blocked suppresses projection", async kind => {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const assignment = await seedAssignment(f), practice = kind === "context" ? await f.practice() : null;
  const child = practice ? await practice.a.enter(practice.request(), { studentId: f.student.id }) : null;
  const session = (await f.ownerDb.select({ expiresAt: s.session.expiresAt }).from(s.session).where(eq(s.session.id, f.tutor.sessionId)))[0];
  const expiry = kind === "context" ? Date.parse(child!.context.expiresAt) : session.expiresAt.getTime();
  const entered = deferred(), release = deferred(); let reads = 0;
  const restore = await f.intercept("a", text => text.includes('from "assignment"') && ++reads === 2, async proceed => {
    entered.resolve(); await release.promise; return proceed();
  });
  const service = createStudyService({ access: f.a, practice: practice?.a ?? createPracticeService({ access: f.a }),
    load: createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS }) });
  const operation = service.read(practice && child ? practice.request(child.handle) : f.request("tutor"), {
    mode: practice ? "child-practice" : "tutor", studentId: f.student.id, assignmentId: assignment.id, assignmentRevision: 1,
    kind: "torah", translation: "jps2023", offset: 0,
  }).then(value => value.ok ? 200 : 409, error => error instanceof AccessDenied ? error.status : 503);
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await waitForEntry(entered.promise, operation);
    // Both live capability checks happened before this exact final SQL barrier.
    // Advance the clock while that read is pending, then allow its real result.
    clock = vi.spyOn(Date, "now").mockReturnValue(expiry + 1);
    release.resolve();
    expect(await operation).toBe(kind === "session" ? 401 : 404);
  } finally { release.resolve(); clock?.mockRestore(); restore(); await operation; }
});
