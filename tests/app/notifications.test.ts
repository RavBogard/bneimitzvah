import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createStudentWorkService } from "../../src/server/student-work/service";
import { createNotificationDelivery, createNotificationPreferences } from "../../src/server/notifications/service";
import { createNotificationTransport, type NotificationMessage, type NotificationOutcome } from "../../src/server/mail/transport";
import { openUnsubscribe, signUnsubscribe } from "../../src/server/notifications/tokens";
import { addDays, chicagoDay, dueOccurrence } from "../../src/server/notifications/schedule";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { validateSettings, type NotificationSettings } from "../../src/server/settings/validation";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import { describeEmailOption } from "../../src/components/portal/workspace/email/describe";
import { unsubscribe as pageUnsubscribe, unsubscribeBody } from "../../src/components/portal/workspace/email/api";

const ORIGIN = "http://localhost:3000";
const DAY = 86_400_000;
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

/** The next instant at 15:00 UTC (a morning in Chicago) that falls on `weekday` there, today included. */
function nextMorning(weekday: number) {
  const start = new Date(); start.setUTCHours(15, 0, 0, 0);
  for (let i = 0; i < 7; i++) { const at = start.getTime() + i * DAY; if (chicagoDay(at).weekday === weekday) return at; }
  throw new Error("Synthetic clock unavailable");
}

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const sent: NotificationMessage[] = []; const outcome = { next: "sent" as NotificationOutcome };
  const clock = { now: Date.now() };
  const secret = randomBytes(48).toString("base64url"), cronSecret = randomBytes(32).toString("base64url");
  const make = (enabled: boolean) => createNotificationDelivery({ db: f.db, origin: ORIGIN, secret, enabled, cronSecret,
    send: async message => { sent.push(message); return outcome.next; }, now: () => clock.now, pause: async () => {} });
  const env = { enabled: true };
  const delivery = () => make(env.enabled);
  const work = createStudentWorkService({ access: f.service, practice: f.runtime.practice, authorityBindingSecret: "synthetic-work-authority-binding-secret",
    notify: { queue: (tx, target) => delivery().queueTutorDraft(tx as never, target), dispatch: async tenantId => { await delivery().deliverPending(tenantId); } } });
  const runtime = (): HttpRuntime => ({ ...f.runtime, studentWork: work, notifications: delivery(), notificationPreferences: createNotificationPreferences({ access: f.service, enabled: env.enabled }) });
  const dispatch = (request: Request) => createHttpDispatcher(async action => action(runtime()))(request);
  let version = 0;
  async function switches(n: NotificationSettings | null, extra: Record<string, unknown> = {}) {
    await f.owner(async () => {
      version++;
      await f.db.insert(s.tenantSettings).values({ tenantId: "crc", version, baseVersion: version - 1, previousVersion: version === 1 ? null : version - 1, body: { ...extra, ...(n ? { notifications: n } : {}) },
        actorUserId: f.identities.admin.id, actorMembershipId: f.adminMember.id, roleGrantId: f.adminGrant.id, role: "admin", mode: "admin", channel: "web", mutationId: randomUUID(), requestDigest: "a".repeat(64) });
    });
  }
  // Distinct first names so a message can be checked for any other student's data.
  const ceremony = addDays(chicagoDay(Date.now()).date, 70), rehearsal = addDays(ceremony, -2);
  await f.owner(async () => {
    for (const [i, firstName] of ["Ada", "Ben", "Cy"].entries())
      await f.db.update(s.student).set({ firstName, ceremonyDate: ceremony, rehearsal1: i === 0 ? rehearsal : null }).where(eq(s.student.id, f.students[i].id));
  });
  // A second family (parent of Cy only) and a second tutor (Cy's), so each recipient's projection can be checked.
  const extra = await f.owner(async () => {
    const people: Record<string, { userId: string; membershipId: string; grantId: string }> = {};
    for (const [who, role] of [["cy-parent", "parent"], ["cy-tutor", "tutor"]] as const) {
      const userId = `synthetic-${who}`;
      await f.db.insert(s.user).values({ id: userId, name: `Synthetic ${role}`, email: `${who}@example.test`, emailVerified: true });
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId }).returning();
      const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role }).returning();
      people[who] = { userId, membershipId: member.id, grantId: grant.id };
    }
    await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: f.students[2].id, parentGrantId: people["cy-parent"].grantId, linkProvenance: "synthetic" });
    await f.db.insert(s.tutorStudent).values({ tenantId: "crc", studentId: f.students[2].id, tutorGrantId: people["cy-tutor"].grantId });
    const [assignment] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-12", status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values(Array.from({ length: 12 }, (_, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: assignment.id, ordinal: i + 1, verseRef: `Genesis 1:${i + 1}` })));
    return { people, assignment };
  });
  const emailOf = async (userId: string) => (await f.owner(() => f.db.select({ email: s.user.email }).from(s.user).where(eq(s.user.id, userId))))[0].email;
  const draft = (text = "Synthetic draft", verse = 1) => work.append(f.request("/", { who: "learner", method: "POST" }),
    { mode: "student", studentId: f.students[0].id, kind: "torah", assignmentId: extra.assignment.id, assignmentRevision: 1 }, "draft",
    { verseRef: `Genesis 1:${verse}`, text, expectedVersion: 0, mutationId: randomUUID() });
  const ledger = () => f.owner(() => f.db.select().from(s.notificationDelivery));
  const asRequest = (who: "multi" | "learner" | "admin", path: string, body?: unknown) => f.request(path, { who, body });
  return { ...f, sent, outcome, clock, secret, cronSecret, env, delivery, dispatch, switches, extra, emailOf, draft, ledger, asRequest, ceremony, rehearsal };
}
/** PGlite owner maintenance: make a statement on notification_delivery fail, to force an error inside a send. */
async function failDeliveries(f: Awaited<ReturnType<typeof setup>>, name: string, timing: "INSERT" | "UPDATE", when: string) {
  await f.owner(() => f.client.exec(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
    CREATE TRIGGER ${name} BEFORE ${timing} ON notification_delivery FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${name}();`));
  return () => f.owner(() => f.client.exec(`DROP TRIGGER ${name} ON notification_delivery; DROP FUNCTION ${name}();`));
}
const noOtherData = (message: NotificationMessage, ...forbidden: string[]) => {
  // Random token characters could spell a short name by chance; compare the words around them.
  const text = message.text.replace(/[#?]t=[tdr]\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/g, "");
  for (const value of ["Sibling A", "Sibling B", "Unrelated", ...forbidden]) { expect(message.subject).not.toContain(value); expect(text).not.toContain(value); }
};

describe("notification transport", () => {
  const apiKey = `re_${randomBytes(24).toString("hex")}`, from = ["portal", "example.test"].join("@"), to = ["family", "example.test"].join("@");
  const token = `d.${randomUUID()}.${"A".repeat(43)}`, unsubscribeUrl = `${ORIGIN}/api/notifications/unsubscribe?t=${token}`;
  it("posts plain text with one-click unsubscribe headers and the ledger id as the idempotency key", async () => {
    const calls: RequestInit[] = [];
    const send = createNotificationTransport({ origin: ORIGIN, apiKey, from, fetch: async (_url, init) => { calls.push(init!); return new Response("provider", { status: 200 }); } });
    const key = randomUUID();
    expect(await send({ email: to, subject: "Your weekly Beit Mitzvah update", text: "Hello,\n\nBody", unsubscribeUrl, idempotencyKey: key })).toBe("sent");
    const body = JSON.parse(String(calls[0].body));
    expect(Object.keys(body).sort()).toEqual(["from", "headers", "subject", "text", "to"]);
    expect(body.headers).toEqual({ "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect((calls[0].headers as Record<string, string>)["idempotency-key"]).toBe(key);
  });
  it("says rejected for a refusal or a malformed message (never fetched) and unknown when no answer came", async () => {
    let calls = 0;
    const refused = createNotificationTransport({ origin: ORIGIN, apiKey, from, fetch: async () => { calls++; return new Response("x", { status: 429 }); } });
    const ok = { email: to, subject: "Subject", text: "Text", unsubscribeUrl, idempotencyKey: randomUUID() };
    expect(await refused(ok)).toBe("rejected"); expect(calls).toBe(1);
    for (const bad of [{ ...ok, email: `${to}\r\nBcc: x` }, { ...ok, subject: "Line\nbreak" }, { ...ok, unsubscribeUrl: unsubscribeUrl.replace(ORIGIN, "https://foreign.example.test") },
      { ...ok, unsubscribeUrl: `${ORIGIN}/api/notifications/unsubscribe?t=forged` }, { ...ok, idempotencyKey: "x" }, { ...ok, text: "" }]) expect(await refused(bad)).toBe("rejected");
    expect(calls).toBe(1);
    const silent = createNotificationTransport({ origin: ORIGIN, apiKey, from, timeoutMs: 5, fetch: async () => new Promise<Response>(() => {}) });
    expect(await silent(ok)).toBe("unknown");
    const thrown = createNotificationTransport({ origin: ORIGIN, apiKey, from, fetch: async () => { throw new TypeError("network"); } });
    expect(await thrown(ok)).toBe("unknown");
    // A provider error may have accepted the message: never treated as a definite refusal.
    for (const status of [500, 502, 503]) expect(await createNotificationTransport({ origin: ORIGIN, apiKey, from, fetch: async () => new Response("x", { status }) })(ok)).toBe("unknown");
  });
});

describe("switches and settings", () => {
  it("the deployment switch is on only for exactly \"true\", and nothing else takes the portal down", () => {
    const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
    database.username = "synthetic_login"; database.password = randomBytes(24).toString("hex"); database.searchParams.set("sslmode", "require");
    const env = { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-mail", BETTER_AUTH_URL: ORIGIN, "DATABASE_URL": database.href,
      "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: ["synthetic", "example.test"].join("@") } as Record<string, string>;
    expect(loadRuntimeConfig(env).notificationsEnabled).toBe(false);
    expect(loadRuntimeConfig({ ...env, PORTAL_NOTIFICATIONS_ENABLED: "true" }).notificationsEnabled).toBe(true);
    for (const value of ["false", "TRUE", "1", "yes", " true", ""]) expect(loadRuntimeConfig({ ...env, PORTAL_NOTIFICATIONS_ENABLED: value }).notificationsEnabled).toBe(false);
  });
  it("the congregation setting is a closed object of three switches and a weekday", () => {
    for (const ok of [{ tutorDraft: true }, { weeklyDigest: false, digestWeekday: 0 }, { tutorDraft: true, weeklyDigest: true, studentReminder: true, digestWeekday: 6 }]) expect(validateSettings({ notifications: ok }).ok).toBe(true);
    for (const bad of [{}, { tutorDraft: "true" }, { digestWeekday: 7 }, { digestWeekday: 1.5 }, { digestWeekday: -1 }, { recordings: true }, [], null])
      expect(validateSettings({ notifications: bad })).toEqual({ ok: false, problems: ["notifications"] });
  });
  it("a scheduled day is due on the day and for two catch-up days, never later", () => {
    const sunday = "2026-10-25";
    expect(dueOccurrence(sunday, 0)).toBe(sunday); expect(dueOccurrence("2026-10-27", 0)).toBe(sunday); expect(dueOccurrence("2026-10-28", 0)).toBeNull(); expect(dueOccurrence("2026-10-24", 0)).toBeNull();
  });
});

describe("tutor draft notices", () => {
  it("send nothing unless both the deployment switch and the congregation switch are on", async () => {
    const f = await setup();
    await f.draft("Synthetic draft one", 1);
    await f.switches({ tutorDraft: false, weeklyDigest: true, studentReminder: true });
    await f.draft("Synthetic draft two", 2);
    f.env.enabled = false; await f.switches({ tutorDraft: true });
    await f.draft("Synthetic draft three", 3);
    expect(f.sent).toEqual([]); expect(await f.ledger()).toEqual([]);
    // Even a morning run with the deployment switch off sends nothing.
    expect(await f.delivery().run("crc")).toMatchObject({ ok: true, enabled: false, sent: 0 });
    expect(f.sent).toEqual([]);
  });

  it("go to the student's assigned tutor only, once per student per day, with a sign-in link and no bearer link", async () => {
    const f = await setup(); await f.switches({ tutorDraft: true });
    expect(await f.draft("Synthetic draft one", 1)).toMatchObject({ ok: true });
    expect(f.sent).toHaveLength(1);
    const [message] = f.sent;
    expect(message.email).toBe(await f.emailOf(f.identities.multi.id));
    expect(message.subject).toBe("A new translation draft to read");
    expect(message.text).toContain("Ada saved a translation draft"); expect(message.text).toContain(`${ORIGIN}/\n`);
    expect(message.text).not.toContain("Synthetic draft one"); expect(message.text).not.toMatch(/token=|#token|\/workspace\/tutor/);
    expect(message.text).toContain(`${ORIGIN}/unsubscribe#t=t.`);
    noOtherData(message, "Ben", "Cy");
    // The second draft the same day is coalesced; the second tutor (Cy's) never hears about Ada.
    await f.draft("Synthetic draft two", 2); expect(f.sent).toHaveLength(1);
    expect((await f.ledger()).map(r => [r.kind, r.status, r.membershipId])).toEqual([["tutor-draft", "sent", f.multiMember.id]]);
    f.clock.now += DAY; await f.draft("Synthetic draft three", 3); expect(f.sent).toHaveLength(2);
    expect(f.sent.map(m => m.idempotencyKey)).toEqual((await f.ledger()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(r => r.id));
  });

  it("respect the tutor's own choice, a revoked assignment and a disabled student, and never cost the student the draft", async () => {
    const f = await setup(); await f.switches({ tutorDraft: true });
    const off = await f.dispatch(f.asRequest("multi", "/api/notifications/preferences", { kind: "tutor-draft", enabled: false }));
    expect(off.status).toBe(200);
    expect(await f.draft("Synthetic draft one", 1)).toMatchObject({ ok: true }); expect(f.sent).toEqual([]); expect(await f.ledger()).toEqual([]);
    await f.dispatch(f.asRequest("multi", "/api/notifications/preferences", { kind: "tutor-draft", enabled: true }));
    // Queued, then the assignment is revoked before the morning run sends it: the row is skipped, not sent.
    const later = f.delivery();
    const queue = createStudentWorkService({ access: f.service, practice: f.runtime.practice, authorityBindingSecret: "synthetic-work-authority-binding-secret",
      notify: { queue: (tx, target) => later.queueTutorDraft(tx as never, target), dispatch: async () => {} } });
    await queue.append(f.request("/", { who: "learner", method: "POST" }), { mode: "student", studentId: f.students[0].id, kind: "torah", assignmentId: f.extra.assignment.id, assignmentRevision: 1 }, "draft",
      { verseRef: "Genesis 1:5", text: "Synthetic", expectedVersion: 0, mutationId: randomUUID() });
    expect((await f.ledger()).map(r => r.status)).toEqual(["pending"]);
    await f.owner(() => f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id)));
    expect(await later.run("crc")).toMatchObject({ sent: 0, skipped: 1 }); expect(f.sent).toEqual([]);
    expect(await f.owner(() => f.db.select().from(s.translationDraft))).toHaveLength(2);
  });
  it("a notice queue that throws inside the draft save still leaves the student's draft committed", async () => {
    const f = await setup(); await f.switches({ tutorDraft: true });
    // Every ledger insert fails, so the queue throws inside the student's own write.
    const restore = await failDeliveries(f, "synthetic_queue_failure", "INSERT", "true");
    try {
      const saved = await f.draft("Synthetic draft kept", 1);
      expect(saved).toMatchObject({ ok: true, committedVersion: 1 });
    } finally { await restore(); }
    const drafts = await f.owner(() => f.db.select().from(s.translationDraft));
    expect(drafts.map(d => [d.verseRef, d.version])).toEqual([["Genesis 1:1", 1]]);
    expect(await f.ledger()).toEqual([]); expect(f.sent).toEqual([]);
    // The next draft, with the ledger healthy again, notifies as usual.
    await f.draft("Synthetic draft two", 2); expect(f.sent).toHaveLength(1);
  });

  it("retry refused notices that still have attempts left, even behind many spent ones", async () => {
    const f = await setup(); await f.switches({ tutorDraft: true });
    const today = chicagoDay(f.clock.now).date, student = f.students[0].id;
    const row = (back: number, attempts: number, minutesAgo: number) => ({ tenantId: "crc", membershipId: f.multiMember.id, userId: f.identities.multi.id, roleGrantId: f.tutorGrant.id, role: "tutor" as const,
      kind: "tutor-draft" as const, periodKey: `${student}:${addDays(today, -back)}`, studentId: student, status: "failed" as const, attempts, createdAt: new Date(f.clock.now - minutesAgo * 60_000) });
    // Five spent rows, all older than the one that may still be retried.
    await f.owner(() => f.db.insert(s.notificationDelivery).values([...[1, 2, 3, 4, 5].map(i => row(i, 3, 120 - i)), row(0, 1, 30)]));
    const tight = createNotificationDelivery({ db: f.db, origin: ORIGIN, secret: f.secret, enabled: true, send: async m => { f.sent.push(m); return "sent"; },
      now: () => f.clock.now, pause: async () => {}, limits: { perRun: 2 } });
    expect(await tight.run("crc")).toMatchObject({ sent: 1, failed: 0 });
    expect(f.sent).toHaveLength(1); expect(f.sent[0].email).toBe(await f.emailOf(f.identities.multi.id));
    const rows = await f.ledger();
    expect(rows.filter(r => r.status === "sent").map(r => [r.periodKey, r.attempts])).toEqual([[`${student}:${today}`, 2]]);
    expect(rows.filter(r => r.status === "failed").every(r => r.attempts === 3)).toBe(true);
  });
});

describe("weekly digests", () => {
  async function digestDay() {
    const f = await setup(), sunday = nextMorning(0);
    f.clock.now = sunday;
    const today = chicagoDay(sunday).date;
    await f.owner(async () => {
      // Ada practised on three of the last seven days (and once before that window); Cy on one.
      for (const back of [1, 3, 7, 9]) await f.db.insert(s.practiceDay).values({ tenantId: "crc", studentId: f.students[0].id, practiceDay: addDays(today, -back) });
      await f.db.insert(s.practiceDay).values({ tenantId: "crc", studentId: f.students[2].id, practiceDay: addDays(today, -2) });
      await f.db.insert(s.lessonLog).values([
        { tenantId: "crc", studentId: f.students[0].id, entryId: randomUUID(), creatorMembershipId: f.multiMember.id, creatorUserId: f.identities.multi.id, lessonDate: addDays(today, -2), summary: "Synthetic Ada lesson: first aliyah blessings.", version: 1 },
        { tenantId: "crc", studentId: f.students[0].id, entryId: randomUUID(), creatorMembershipId: f.multiMember.id, creatorUserId: f.identities.multi.id, lessonDate: addDays(today, -30), summary: "Synthetic old lesson.", version: 1 },
        { tenantId: "crc", studentId: f.students[2].id, entryId: randomUUID(), creatorMembershipId: f.extra.people["cy-tutor"].membershipId, creatorUserId: f.extra.people["cy-tutor"].userId, lessonDate: addDays(today, -1), summary: "Synthetic Cy private lesson.", version: 1 },
      ]);
    });
    await f.switches({ weeklyDigest: true, digestWeekday: 0 });
    return { ...f, today };
  }

  it("give each parent only their own children: days practiced, lesson notes since the last update, ceremony, slot and rehearsals", async () => {
    const f = await digestDay();
    expect(await f.delivery().run("crc")).toMatchObject({ ok: true, enabled: true, sent: 2, failed: 0 });
    const byEmail = new Map(f.sent.map(m => [m.email, m]));
    const multi = byEmail.get(await f.emailOf(f.identities.multi.id))!, cy = byEmail.get(await f.emailOf(f.extra.people["cy-parent"].userId))!;
    expect(multi.subject).toBe("Your weekly Beit Mitzvah update"); expect(cy.subject).toBe(multi.subject);
    expect(multi.text).toContain("Ada\n- Practiced on 3 days of the last 7.");
    expect(multi.text).toContain("Ben\n- No practice was recorded in the last 7 days.");
    expect(multi.text).toContain("Synthetic Ada lesson: first aliyah blessings."); expect(multi.text).not.toContain("Synthetic old lesson");
    expect(multi.text).toContain("· Morning service\n"); expect(multi.text).toMatch(/- Rehearsal: \w+day, /);
    expect(multi.text).toContain("because you're a parent of a student");
    noOtherData(multi, "Cy", "Synthetic Cy private lesson");
    expect(cy.text).toContain("Cy\n- Practiced on 1 day of the last 7."); expect(cy.text).toContain("Synthetic Cy private lesson.");
    noOtherData(cy, "Ada", "Ben", "Synthetic Ada lesson");
    // The learner signs in as Ada, a child: no digest of their own, and parents' digests never go to them.
    expect(byEmail.has(await f.emailOf(f.identities.learner.id))).toBe(false);
  });

  it("are idempotent: a retried, repeated or concurrent run sends nothing twice, and a weekday change cannot send a second one that week", async () => {
    const f = await digestDay();
    await Promise.all([f.delivery().run("crc"), f.delivery().run("crc")]);
    await f.delivery().run("crc");
    f.clock.now += DAY; await f.delivery().run("crc");
    await f.switches({ weeklyDigest: true, digestWeekday: 1 }); await f.delivery().run("crc");
    expect(f.sent).toHaveLength(2);
    const rows = await f.ledger();
    expect(rows.map(r => [r.kind, r.status, r.periodKey]).sort()).toEqual([["weekly-digest", "sent", f.today], ["weekly-digest", "sent", f.today]]);
    // The next scheduled week sends again.
    f.clock.now += 7 * DAY; await f.delivery().run("crc"); expect(f.sent).toHaveLength(4);
    expect((await f.ledger()).filter(r => r.periodKey === addDays(f.today, 8))).toHaveLength(2);
  });

  it("skip disabled students, revoked links, disabled members and parents who turned it off; retry only definite refusals", async () => {
    const f = await digestDay();
    await f.owner(async () => {
      await f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, f.students[1].id));
      await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.extra.people["cy-parent"].membershipId));
    });
    f.outcome.next = "rejected";
    expect(await f.delivery().run("crc")).toMatchObject({ sent: 0, failed: 1 });
    expect(f.sent[0].text).not.toMatch(/^Ben$/m); expect(f.sent[0].text).toMatch(/^Ada$/m);
    f.outcome.next = "sent"; f.clock.now += 60_000;
    expect(await f.delivery().run("crc")).toMatchObject({ sent: 1 });
    expect(f.sent[1].idempotencyKey).toBe(f.sent[0].idempotencyKey);
    // A send with no answer is never retried automatically: it may have been delivered.
    const g = await digestDay(); g.outcome.next = "unknown";
    expect(await g.delivery().run("crc")).toMatchObject({ unknown: 2 }); g.outcome.next = "sent";
    expect(await g.delivery().run("crc")).toMatchObject({ sent: 0 }); expect(g.sent).toHaveLength(2);
    // Revoked guardian link and the parent's own choice.
    const h = await digestDay();
    await h.owner(() => h.db.update(s.guardian).set({ revokedAt: new Date() }).where(and(eq(s.guardian.studentId, h.students[2].id))));
    expect((await h.dispatch(h.asRequest("multi", "/api/notifications/preferences", { kind: "weekly-digest", enabled: false }))).status).toBe(200);
    expect(await h.delivery().run("crc")).toMatchObject({ sent: 0 }); expect(h.sent).toEqual([]);
  });

  it("name the service as the congregation does, with its start time", async () => {
    const f = await digestDay();
    await f.switches({ weeklyDigest: true, digestWeekday: 0 }, { services: { morning: { label: "Shabbat morning", start: "10:30" } } });
    await f.delivery().run("crc");
    expect(f.sent.find(m => m.email === "multi@example.test")!.text).toContain("· Shabbat morning · 10:30 AM\n");
  });

  it("leave past classes out of the candidates and carry what one run cannot reach to the next morning", async () => {
    const f = await digestDay();
    // Cy's ceremony has passed: Cy's parent is not even a candidate, so past classes never crowd out current families.
    await f.owner(() => f.db.update(s.student).set({ ceremonyDate: addDays(f.today, -3) }).where(eq(s.student.id, f.students[2].id)));
    const tight = createNotificationDelivery({ db: f.db, origin: ORIGIN, secret: f.secret, enabled: true, send: async m => { f.sent.push(m); return "sent"; },
      now: () => f.clock.now, pause: async () => {}, limits: { perRun: 1 } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await f.owner(() => f.db.insert(s.guardian).values({ tenantId: "crc", studentId: f.students[1].id, parentGrantId: f.extra.people["cy-parent"].grantId, linkProvenance: "synthetic" }));
      expect(await tight.run("crc")).toMatchObject({ sent: 1, deferred: 1 });
      f.clock.now += DAY; expect(await tight.run("crc")).toMatchObject({ sent: 1, deferred: 0 });
      f.clock.now += DAY; expect(await tight.run("crc")).toMatchObject({ sent: 0, deferred: 0 });
      expect(String(error.mock.calls[0][0])).toBe("notifications run: 1 sent, 0 refused, 0 unanswered, 1 deferred");
    } finally { error.mockRestore(); }
    expect(new Set(f.sent.map(m => m.email)).size).toBe(2);
    const cyParent = f.sent.find(m => m.email === "cy-parent@example.test")!.text; expect(cyParent).toMatch(/^Ben$/m); expect(cyParent).not.toMatch(/^Cy$|Synthetic Cy/m);
  });

  it("go to an adult student about themselves only when they opt in, and not on other days", async () => {
    const f = await digestDay();
    await f.owner(() => f.db.update(s.student).set({ studentKind: "adult", ownEmail: ["adult", "example.test"].join("@") }).where(eq(s.student.id, f.students[0].id)));
    await f.delivery().run("crc");
    expect(f.sent.map(m => m.email)).not.toContain(await f.emailOf(f.identities.learner.id));
    // Multi's update no longer covers Ada: parents' updates cover child students.
    expect(f.sent.find(m => m.email === "multi@example.test")?.text ?? "").not.toMatch(/^Ada$/m);
    const g = await digestDay();
    await g.owner(() => g.db.update(s.student).set({ studentKind: "adult", ownEmail: ["adult", "example.test"].join("@") }).where(eq(s.student.id, g.students[0].id)));
    expect((await g.dispatch(g.asRequest("learner", "/api/notifications/preferences", { kind: "weekly-digest", enabled: true }))).status).toBe(200);
    await g.delivery().run("crc");
    const own = g.sent.find(m => m.email === "learner@example.test")!;
    expect(own.text).toContain("Ada\n- Practiced on 3 days"); expect(own.text).toContain("because you turned on weekly updates");
    noOtherData(own, "Ben", "Cy");
    const h = await digestDay(); h.clock.now += 3 * DAY; await h.delivery().run("crc"); expect(h.sent).toEqual([]);
  });
  it("show a parent who is also an adult student their own part off until they turn it on, as it is sent", async () => {
    const f = await digestDay();
    // Multi (parent of Ada and Ben) is also Cy, an adult student with their own sign-in.
    await f.owner(async () => {
      await f.db.update(s.student).set({ studentKind: "adult", ownEmail: ["cy", "example.test"].join("@") }).where(eq(s.student.id, f.students[2].id));
      const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.multiMember.id, role: "student" }).returning();
      await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.students[2].id, roleGrantId: grant.id });
    });
    const digestOption = async () => (await (await f.dispatch(f.asRequest("multi", "/api/notifications/preferences"))).json()).view.options.find((o: { kind: string }) => o.kind === "weekly-digest");
    const before = await digestOption();
    expect(before).toEqual({ kind: "weekly-digest", enabled: false, offered: true, weekday: 0, audience: "both" });
    expect(describeEmailOption(before)).toBe("Each Sunday morning: your child’s days practiced, new lesson notes and upcoming dates. Turn it on to include your own as well.");
    // As shown: the children's update comes, their own part does not.
    await f.delivery().run("crc");
    const first = f.sent.find(m => m.email === "multi@example.test")!.text;
    expect(first).toMatch(/^Ada$/m); expect(first).toMatch(/^Ben$/m); expect(first).not.toMatch(/^Cy$/m);
    expect((await f.dispatch(f.asRequest("multi", "/api/notifications/preferences", { kind: "weekly-digest", enabled: true }))).status).toBe(200);
    const after = await digestOption();
    expect(after).toMatchObject({ enabled: true, audience: "both" });
    expect(describeEmailOption(after)).toBe("Each Sunday morning: your child’s and your own days practiced, new lesson notes and upcoming dates.");
    f.clock.now += 7 * DAY; f.sent.length = 0; await f.delivery().run("crc");
    const second = f.sent.find(m => m.email === "multi@example.test")!.text;
    expect(second).toMatch(/^Ada$/m); expect(second).toMatch(/^Ben$/m); expect(second).toMatch(/^Cy$/m);
  });

  it("carry on past an item that throws, never send a claimed row twice, and log only counts", async () => {
    const f = await digestDay();
    const cyParent = f.extra.people["cy-parent"].membershipId;
    // Multi's row cannot be written (nothing goes out); Cy's parent's message goes out but its result cannot be recorded.
    const restoreInsert = await failDeliveries(f, "synthetic_claim_failure", "INSERT", `NEW.membership_id = '${f.multiMember.id}'`);
    const restoreUpdate = await failDeliveries(f, "synthetic_finish_failure", "UPDATE", `NEW.membership_id = '${cyParent}' AND NEW.status = 'sent'`);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(name => vi.spyOn(console, name).mockImplementation(() => {}));
    try {
      expect(await f.delivery().run("crc")).toMatchObject({ ok: true, sent: 1, failed: 1, unknown: 0, deferred: 0 });
      const lines = spies.flatMap(spy => spy.mock.calls.map(call => call.map(String).join(" ")));
      expect(lines).toEqual(["notifications run: 1 sent, 1 refused, 0 unanswered, 0 deferred"]);
    } finally { for (const spy of spies) spy.mockRestore(); await restoreInsert(); await restoreUpdate(); }
    expect(f.sent.map(m => m.email)).toEqual(["cy-parent@example.test"]);
    expect((await f.ledger()).map(r => [r.membershipId, r.status])).toEqual([[cyParent, "sending"]]);
    // The next run sends Multi's update; the claimed row for Cy's parent is never sent again.
    f.clock.now += 60_000; expect(await f.delivery().run("crc")).toMatchObject({ sent: 1, failed: 0 });
    expect(f.sent.map(m => m.email).sort()).toEqual(["cy-parent@example.test", "multi@example.test"]);
  });
});

describe("practice reminders", () => {
  it("are off by default, opt-in by a student with their own sign-in, on the day they pick", async () => {
    const f = await setup(), wednesday = nextMorning(3);
    f.clock.now = wednesday; await f.switches({ studentReminder: true });
    expect(await f.delivery().run("crc")).toMatchObject({ sent: 0 });
    const view = await (await f.dispatch(f.asRequest("learner", "/api/notifications/preferences"))).json();
    expect(view.view.options).toEqual([{ kind: "practice-reminder", enabled: false, offered: true, weekday: null }]);
    // A day is required to turn it on; parents and tutors cannot set a student's reminder.
    expect((await f.dispatch(f.asRequest("learner", "/api/notifications/preferences", { kind: "practice-reminder", enabled: true }))).status).toBe(403);
    expect((await f.dispatch(f.asRequest("multi", "/api/notifications/preferences", { kind: "practice-reminder", enabled: true, weekday: 3 }))).status).toBe(403);
    expect((await f.dispatch(f.asRequest("learner", "/api/notifications/preferences", { kind: "practice-reminder", enabled: true, weekday: 3 }))).status).toBe(200);
    expect(await f.delivery().run("crc")).toMatchObject({ sent: 1 });
    const [message] = f.sent;
    expect(message.email).toBe(await f.emailOf(f.identities.learner.id)); expect(message.subject).toBe("Your weekly practice reminder");
    expect(message.text).toContain("Hi Ada,"); expect(message.text).toContain("every Wednesday"); noOtherData(message, "Ben", "Cy");
    await f.delivery().run("crc"); f.clock.now += DAY; await f.delivery().run("crc"); expect(f.sent).toHaveLength(1);
    // A revoked student sign-in ends reminders.
    f.clock.now = wednesday + 7 * DAY;
    await f.owner(() => f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)));
    await f.delivery().run("crc"); expect(f.sent).toHaveLength(1);
  });
});

describe("unsubscribe", () => {
  it("one click turns that kind off for that member only; forged, altered or foreign tokens do nothing", async () => {
    const f = await setup(); await f.switches({ tutorDraft: true });
    await f.draft(); const header = f.sent[0].unsubscribeUrl, token = new URL(header).searchParams.get("t")!;
    expect(openUnsubscribe(f.secret, "crc", token)).toEqual({ membershipId: f.multiMember.id, kind: "tutor-draft" });
    const post = (t: string, headers: Record<string, string> = {}) => f.dispatch(new Request(`${ORIGIN}/api/notifications/unsubscribe?t=${encodeURIComponent(t)}`,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: "List-Unsubscribe=One-Click" }));
    const mac = token.split(".")[2];
    for (const forged of [`t.${f.adminMember.id}.${mac}`, `d.${f.multiMember.id}.${mac}`, `t.${f.multiMember.id}.${"A".repeat(43)}`, signUnsubscribe(randomBytes(48).toString("base64url"), "crc", f.multiMember.id, "tutor-draft"),
      signUnsubscribe(f.secret, "other", f.multiMember.id, "tutor-draft"), "t.nope", ""]) expect((await post(forged)).status).toBe(404);
    expect(await f.owner(() => f.db.select().from(s.notificationPreference))).toEqual([]);
    const response = await post(token); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, kind: "tutor-draft" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await post(token)).status).toBe(200);
    const prefs = await f.owner(() => f.db.select().from(s.notificationPreference));
    expect(prefs.map(p => [p.membershipId, p.kind, p.enabled, p.updatedVia])).toEqual([[f.multiMember.id, "tutor-draft", false, "unsubscribe"]]);
    const audits = await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "notification.unsubscribe")));
    expect(audits.map(a => [a.actorMembershipId, a.mode, a.targetId])).toEqual([[f.multiMember.id, "tutor", "tutor-draft"]]);
    f.clock.now += DAY; await f.draft("Synthetic later", 4); expect(f.sent).toHaveLength(1);
    // The header link opened in a browser goes to the confirmation page, keeping the token in the fragment.
    const opened = await f.dispatch(new Request(`${ORIGIN}/api/notifications/unsubscribe?t=${token}`));
    expect(opened.status).toBe(303); expect(opened.headers.get("location")).toBe(`/unsubscribe#t=${token}`);
    expect((await f.dispatch(new Request(`${ORIGIN}/api/notifications/unsubscribe?t=${token}&x=1`))).status).toBe(400);
  });
  it("the unsubscribe page sends the token in the body, never the URL; the header link keeps the query form", async () => {
    const f = await setup(); await f.switches({ tutorDraft: true });
    await f.draft(); const token = new URL(f.sent[0].unsubscribeUrl).searchParams.get("t")!;
    // The page's own request, captured from fetch: no query string, the token only in the body.
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return f.dispatch(new Request(`${ORIGIN}${url}`, { method: init.method, headers: init.headers, body: init.body as string }));
    });
    try { expect(await pageUnsubscribe(token)).toBe("tutor-draft"); } finally { vi.unstubAllGlobals(); }
    expect(calls).toHaveLength(1); expect(calls[0].url).toBe("/api/notifications/unsubscribe"); expect(calls[0].url).not.toContain(token);
    expect(calls[0].init.body).toBe(unsubscribeBody(token)); expect(String(calls[0].init.body)).toContain(token);
    expect((await f.owner(() => f.db.select().from(s.notificationPreference))).map(p => [p.kind, p.enabled, p.updatedVia])).toEqual([["tutor-draft", false, "unsubscribe"]]);
    const body = (text: string, type = "application/x-www-form-urlencoded") => f.dispatch(new Request(`${ORIGIN}/api/notifications/unsubscribe`, { method: "POST", headers: { "content-type": type }, body: text }));
    expect((await body(unsubscribeBody(token))).status).toBe(200);
    // The body form is closed: exactly the one-click field and one token.
    for (const bad of [`t=${token}`, `List-Unsubscribe=One-Click`, `List-Unsubscribe=One-Click&t=${token}&t=${token}`, `List-Unsubscribe=Other&t=${token}`, `List-Unsubscribe=One-Click&t=${token}&x=1`])
      expect((await body(bad)).status).toBe(400);
    expect((await body(unsubscribeBody(token), "application/json")).status).toBe(415);
    expect((await body(unsubscribeBody(`t.${f.adminMember.id}.${"A".repeat(43)}`))).status).toBe(404);
    // A mail provider's RFC 8058 POST to the header link still works.
    const header = await f.dispatch(new Request(f.sent[0].unsubscribeUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
    expect(header.status).toBe(200); expect(await header.json()).toEqual({ ok: true, kind: "tutor-draft" });
  });
});

describe("the morning run route", () => {
  it("answers only the cron bearer, without a cookie, and reports counts without addresses", async () => {
    const f = await setup();
    const call = (headers: Record<string, string>, path = "/api/internal/notifications/run", method = "GET") => f.dispatch(new Request(`${ORIGIN}${path}`, { method, headers }));
    const ok = await call({ authorization: `Bearer ${f.cronSecret}` }); expect(ok.status).toBe(200);
    expect(Object.keys(await ok.json()).sort()).toEqual(["at", "deferred", "enabled", "failed", "ok", "sent", "skipped", "unknown"]);
    expect((await call({ authorization: `Bearer ${f.cronSecret}`, cookie: "a=b" })).status).toBe(403);
    expect((await call({ authorization: `Bearer ${"x".repeat(43)}` })).status).toBe(401);
    expect((await call({})).status).toBe(401);
    expect((await call({ authorization: `Bearer ${f.cronSecret}` }, "/api/internal/notifications/run?now=1")).status).toBe(400);
    expect((await call({ authorization: `Bearer ${f.cronSecret}` }, "/api/internal/notifications/run", "POST")).status).toBe(405);
  });

  it("logs only counts: no address, token or name reaches the console", async () => {
    const f = await setup(); f.clock.now = nextMorning(0);
    await f.switches({ tutorDraft: true, weeklyDigest: true, studentReminder: true, digestWeekday: 0 });
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(name => vi.spyOn(console, name).mockImplementation(() => {}));
    try {
      await f.draft(); f.outcome.next = "rejected"; await f.delivery().run("crc"); f.outcome.next = "unknown"; await f.delivery().run("crc");
      const lines = spies.flatMap(spy => spy.mock.calls.map(call => call.map(String).join(" ")));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toMatch(/^notifications run: \d+ sent, \d+ refused, \d+ unanswered, \d+ deferred$/);
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
});

describe("member preferences", () => {
  it("show each member only the kinds their live roles receive, and need a same-origin POST", async () => {
    const f = await setup(); await f.switches({ tutorDraft: true, weeklyDigest: true, digestWeekday: 5 });
    const view = async (who: "multi" | "learner" | "admin") => (await (await f.dispatch(f.asRequest(who, "/api/notifications/preferences"))).json()).view.options;
    expect(await view("multi")).toEqual([{ kind: "tutor-draft", enabled: true, offered: true, weekday: null }, { kind: "weekly-digest", enabled: true, offered: true, weekday: 5, audience: "parent" }]);
    expect(await view("admin")).toEqual([]);
    expect(await view("learner")).toEqual([{ kind: "practice-reminder", enabled: false, offered: false, weekday: null }]);
    f.env.enabled = false; expect((await view("multi")).every((o: { offered: boolean }) => !o.offered)).toBe(true);
    const foreign = await f.dispatch(f.request("/api/notifications/preferences", { who: "multi", body: { kind: "weekly-digest", enabled: false }, headers: { origin: "https://evil.example.test" } }));
    expect(foreign.status).toBe(403);
    for (const bad of [{ kind: "recording", enabled: false }, { kind: "weekly-digest", enabled: "no" }, { kind: "weekly-digest", enabled: true, weekday: 2 }])
      expect((await f.dispatch(f.asRequest("multi", "/api/notifications/preferences", bad))).status).toBe(403);
    expect((await f.dispatch(f.asRequest("multi", "/api/notifications/preferences", { kind: "weekly-digest", enabled: false, extra: 1 }))).status).toBe(400);
    expect((await f.dispatch(f.request("/api/notifications/preferences", { who: "anonymous" }))).status).toBe(401);
    expect((await f.dispatch(f.asRequest("multi", "/api/notifications/preferences", { kind: "weekly-digest", enabled: false }))).status).toBe(200);
    const audits = await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "notification-preference.set")));
    expect(audits.map(a => [a.mode, a.targetId])).toEqual([["parent", "weekly-digest"]]);
  });
});
