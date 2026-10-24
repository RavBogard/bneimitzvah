import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createMcpAuthService, type McpActor } from "../../src/server/mcp/service";
import { createMcpSavedReadings } from "../../src/server/saved/mcp";
import { withConnectionOwner } from "../../src/server/saved/access";
import { parseReadAddress } from "../../src/components/portal/public-reading/urls";
import { parsePrintAddress } from "../../src/lib/print/print-address";
import { closeMcpFixtures, mcpFixture, ORIGIN } from "./mcp-fixture";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// Release 1.7 M4 (MISSION 2026-10-23, "Existing MCP users"): a connection reaches the saved readings of the person it acts for,
// and no one else's: not another staff member's, not a tutor's, not the same person's in another congregation. Notes,
// translations and marks never leave through these tools, and a scheduled routine reaches nothing.
const NOTE = `note-canary-${randomUUID()}`, TUTOR = `tutor-canary-${randomUUID()}`, ELSEWHERE = `elsewhere-canary-${randomUUID()}`;
const SAVED = ["list_saved_readings", "open_saved_reading", "create_saved_reading", "revise_saved_reading"];

async function setup() {
  const t = await mcpFixture();
  const seeded = await t.f.owner(async () => {
    const [otherMember] = await t.f.db.select().from(s.membership).where(and(eq(s.membership.tenantId, "other"), eq(s.membership.userId, t.f.identities.multi.id)));
    const seed = async (tenantId: string, membershipId: string, userId: string, name: string, kind: "torah" | "haftarah" = "torah", ranges = "Genesis 1:1-3", verseCount = 3) => {
      const [reading] = await t.f.db.insert(s.savedReading).values({ tenantId, membershipId, userId, name, kind, ranges, verseCount }).returning();
      for (const stream of ["note", "translation"] as const) await t.f.db.insert(s.savedVerseWork).values({ tenantId, membershipId, savedReadingId: reading.id, verseRef: "Genesis 1:1", stream, text: `${stream} ${NOTE}`, version: 1 });
      await t.f.db.insert(s.savedVerseMark).values({ tenantId, membershipId, savedReadingId: reading.id, verseRef: "Genesis 1:1", state: "working", version: 1 });
      return reading;
    };
    return {
      mine: await seed("crc", t.f.adminMember.id, t.f.identities.admin.id, "Admin's own"),
      tutors: await seed("crc", t.f.multiMember.id, t.f.identities.multi.id, `Tutor ${TUTOR}`),
      elsewhere: await seed("other", otherMember.id, t.f.identities.multi.id, `Elsewhere ${ELSEWHERE}`),
    };
  });
  await t.google("admin"); await t.google("multi");
  const admin = (await t.connect("admin")).access_token as string, tutor = (await t.connect("multi")).access_token as string;
  const texts: string[] = [], seen = new Map<string, string[]>([[admin, []], [tutor, []]]);
  const call = async (token: string, name: string, args: Record<string, unknown> = {}) => { const r = await t.call(token, name, args); texts.push(r.text); seen.get(token)?.push(r.text); return r; };
  const row = (id: string) => t.f.owner(async () => (await t.f.db.select().from(s.savedReading).where(eq(s.savedReading.id, id)))[0]);
  return { t, ...seeded, admin, tutor, call, texts, seen, row };
}
const NOT_FOUND = "Not found, or not available to this connection.";

describe("saved readings over the MCP", () => {
  it("lists, opens, creates and revises only the connection's own readings, with links and never notes, translations or marks", async () => {
    const { mine, admin, call, texts, row } = await setup();
    const listed = (await call(admin, "list_saved_readings")).json();
    expect(listed.total).toBe(1);
    expect(listed.readings).toEqual([expect.objectContaining({ id: mine.id, name: "Admin's own", kind: "torah", ranges: "Genesis 1:1-3", verseCount: 3, revision: 1, date: null })]);
    const opened = (await call(admin, "open_saved_reading", { id: mine.id })).json();
    expect(opened.ok).toBe(true);
    expect(opened.reading.statement).toBe("Admin's own: Torah, Genesis 1:1–3 (3 verses).");
    const study = new URL(opened.reading.studyLink), print = new URL(opened.reading.printLink);
    expect([study.origin, study.pathname, print.origin, print.pathname]).toEqual([ORIGIN, "/read", ORIGIN, "/print"]);
    expect(parseReadAddress(study.search)).toEqual({ target: { mode: "saved", id: mine.id }, verse: null, study: true });
    expect(parsePrintAddress(print.search).target).toEqual({ mode: "saved", id: mine.id });
    // Only these keys: nothing a member writes on a verse.
    expect(Object.keys(opened.reading).sort()).toEqual(["createdAt", "date", "id", "kind", "name", "passage", "printLink", "ranges", "revision", "statement", "studyLink", "updatedAt", "verseCount"]);

    // Create is idempotent by mutationId: a resend returns the same reading and saves nothing twice.
    const mutationId = randomUUID(), body = { name: "Lech Lecha, two groups", ranges: "Genesis 12:1-5; Genesis 12:8-9", date: "2026-10-31", mutationId };
    const made = (await call(admin, "create_saved_reading", body)).json();
    expect(made).toMatchObject({ ok: true, reading: { name: "Lech Lecha, two groups", kind: "torah", ranges: "Genesis 12:1-5; Genesis 12:8-9", verseCount: 7, revision: 1, date: "2026-10-31" } });
    expect(made.replayed).toBeUndefined();
    const again = (await call(admin, "create_saved_reading", body)).json();
    expect(again).toMatchObject({ ok: true, replayed: true, reading: { id: made.reading.id } });
    expect((await call(admin, "list_saved_readings")).json().total).toBe(2);
    // The same mutationId with a different reading is refused, not silently answered with the first.
    expect((await call(admin, "create_saved_reading", { ...body, name: "Something else" })).json()).toMatchObject({ ok: false, code: "mutation-reused" });
    expect((await call(admin, "list_saved_readings")).json().total).toBe(2);
    expect((await call(admin, "create_saved_reading", { name: "Isaiah", ranges: "Isaiah 40:1-11", mutationId: randomUUID() })).json().reading).toMatchObject({ kind: "haftarah", verseCount: 11 });
    expect((await call(admin, "create_saved_reading", { name: "Isaiah", ranges: "Isaiah 40:1-11", kind: "torah", mutationId: randomUUID() })).json()).toMatchObject({ ok: false, code: "invalid" });
    // The row is the connection's own person's, whatever anyone sent.
    expect(await row(made.reading.id)).toMatchObject({ tenantId: "crc", membershipId: (await row(mine.id)).membershipId, userId: (await row(mine.id)).userId });

    // Revise: name alone, then the verses (recounted by the server), a stale revision, the other corpus, nothing at all.
    const renamed = (await call(admin, "revise_saved_reading", { id: made.reading.id, revision: 1, name: "Lech Lecha" })).json();
    expect(renamed).toMatchObject({ ok: true, reading: { name: "Lech Lecha", revision: 2, date: "2026-10-31", ranges: "Genesis 12:1-5; Genesis 12:8-9" } });
    const stale = (await call(admin, "revise_saved_reading", { id: made.reading.id, revision: 1, name: "Overwritten" })).json();
    expect(stale).toMatchObject({ ok: false, code: "conflict", current: { name: "Lech Lecha", revision: 2 } });
    expect(stale.hint).toContain("changed since your last read");
    const revised = (await call(admin, "revise_saved_reading", { id: made.reading.id, revision: 2, ranges: "Genesis 12:1-9", date: null })).json();
    expect(revised).toMatchObject({ ok: true, reading: { ranges: "Genesis 12:1-9", verseCount: 9, revision: 3, date: null, name: "Lech Lecha" } });
    expect((await call(admin, "revise_saved_reading", { id: made.reading.id, revision: 3, ranges: "Isaiah 40:1-3" })).json()).toMatchObject({ ok: false, code: "invalid" });
    expect((await call(admin, "revise_saved_reading", { id: made.reading.id, revision: 3 })).json()).toMatchObject({ ok: false, code: "no-change" });
    for (const args of [{ id: made.reading.id, revision: 3, name: " " }, { id: made.reading.id, revision: 3, date: "2026-02-30" }, { id: made.reading.id, revision: 3, ranges: "Genesis 1:1-99" }])
      expect((await call(admin, "revise_saved_reading", args)).json(), JSON.stringify(args)).toMatchObject({ ok: false, code: "invalid" });
    expect(await row(made.reading.id)).toMatchObject({ revision: 3, verseCount: 9 });

    // The seeded notes, translations and marks never appear, nor any verse text.
    const all = texts.join("\n");
    expect(all).not.toContain(NOTE);
    for (const canary of [TUTOR, ELSEWHERE]) expect(all).not.toContain(canary);
    expect(all).not.toMatch(/[֐-׿]|working|"note"|"translation"/);
  });

  it("never reaches another person's readings, even by id: staff to tutor, tutor to staff, or the same person in another congregation", async () => {
    const { t, mine, tutors, elsewhere, admin, tutor, call, texts, seen, row } = await setup();
    // The admin (Daniel's role) guessing the tutor's id: list, open and revise all miss it, and nothing changes.
    expect((await call(admin, "list_saved_readings")).json().readings.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    for (const id of [tutors.id, elsewhere.id, randomUUID()]) {
      const open = await call(admin, "open_saved_reading", { id });
      expect([open.isError, open.text]).toEqual([true, NOT_FOUND]);
      const revise = await call(admin, "revise_saved_reading", { id, revision: 1, name: "Taken" });
      expect([revise.isError, revise.text]).toEqual([true, NOT_FOUND]);
    }
    // The tutor sees their own crc reading only: not the admin's, and not their own membership's reading in another congregation.
    expect((await call(tutor, "list_saved_readings")).json().readings.map((r: { id: string }) => r.id)).toEqual([tutors.id]);
    for (const id of [mine.id, elsewhere.id]) {
      expect((await call(tutor, "open_saved_reading", { id })).isError).toBe(true);
      expect((await call(tutor, "revise_saved_reading", { id, revision: 1, name: "Taken" })).isError).toBe(true);
    }
    expect((await row(tutors.id)).name).toBe(`Tutor ${TUTOR}`);
    expect((await row(mine.id)).name).toBe("Admin's own");
    expect((await row(elsewhere.id)).name).toBe(`Elsewhere ${ELSEWHERE}`);
    // The same mutationId from two people makes two readings, each its own owner's; neither replays the other's.
    const mutationId = randomUUID(), body = { name: "Shared mutation", ranges: "Genesis 2:1-3", mutationId };
    const a = (await call(admin, "create_saved_reading", body)).json(), b = (await call(tutor, "create_saved_reading", body)).json();
    expect(a.ok && b.ok && !a.replayed && !b.replayed && a.reading.id !== b.reading.id).toBe(true);
    expect((await row(b.reading.id)).membershipId).toBe(t.f.multiMember.id);
    expect((await row(a.reading.id)).membershipId).toBe(t.f.adminMember.id);
    // No argument can name an owner, member, user, student or tenant: the closed schemas refuse them before any handler runs.
    for (const extra of ["membershipId", "ownerId", "userId", "studentId", "tenantId", "owner"]) {
      for (const [name, args] of [["list_saved_readings", {}], ["open_saved_reading", { id: tutors.id }], ["create_saved_reading", { ...body, mutationId: randomUUID() }], ["revise_saved_reading", { id: tutors.id, revision: 1, name: "x" }]] as const) {
        const r = await call(admin, name, { ...args, [extra]: extra === "tenantId" ? "crc" : t.f.multiMember.id });
        expect([r.isError, r.text], `${name} ${extra}`).toEqual([true, `unknown argument ${extra}`]);
      }
    }
    expect((await row(tutors.id)).revision).toBe(1);
    // Each person saw only their own: the admin neither the tutor's nor the other congregation's; the tutor neither the admin's nor their own elsewhere.
    expect(texts.join("\n")).not.toContain(NOTE);
    expect(seen.get(admin)!.join("\n")).not.toMatch(new RegExp(`${TUTOR}|${ELSEWHERE}`));
    expect(seen.get(tutor)!.join("\n")).not.toMatch(new RegExp(`${ELSEWHERE}|Admin's own`));
    expect(seen.get(tutor)!.join("\n")).toContain(TUTOR);
  });

  it("does not exist for a scheduled routine, and the binding refuses one even when a caller claims otherwise", async () => {
    const { t, admin } = await setup();
    const routine = (await t.connect("admin", { unattended: true })).access_token as string;
    const names = async (token: string) => (await t.rpc(token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
    expect(await names(admin)).toEqual(expect.arrayContaining(SAVED));
    const annotations = Object.fromEntries(((await t.rpc(admin, "tools/list")).body.result.tools as { name: string; annotations: Record<string, boolean> }[]).map(tool => [tool.name, tool.annotations]));
    expect(SAVED.map(name => [annotations[name].readOnlyHint, annotations[name].destructiveHint])).toEqual([[true, false], [true, false], [false, false], [false, true]]);
    const listed = await names(routine);
    for (const name of SAVED) {
      expect(listed).not.toContain(name);
      expect((await t.rpc(routine, "tools/call", { name, arguments: {} })).body.error.code).toBe(-32602);
    }
    // The binding itself re-reads the connection: an actor that says "attended" for a routine's connection is still refused.
    const [connection] = await t.f.owner(() => t.f.db.select().from(s.mcpConnection).where(eq(s.mcpConnection.unattended, true)));
    const mcp = createMcpAuthService({ db: t.f.db, access: t.f.service, secret: randomBytes(48).toString("base64url") });
    const claimed = { tenantId: "crc", origin: ORIGIN, connectionId: connection.id, membershipId: connection.membershipId, unattended: false, expiresAt: Date.now() + 600_000 } as unknown as McpActor;
    const saved = createMcpSavedReadings(mcp), signal = new AbortController().signal;
    await expect(saved.list(claimed, signal)).rejects.toMatchObject({ status: 403 });
    await expect(saved.create(claimed, signal, { name: "Routine", ranges: "Genesis 1:1", mutationId: randomUUID() })).rejects.toBeInstanceOf(AccessDenied);
    await expect(saved.list({ ...claimed, unattended: true }, signal)).rejects.toMatchObject({ status: 403 });
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.savedReading).where(eq(s.savedReading.name, "Routine"))).length)).toBe(0);
  });

  it("ends with the connection's admin or tutor grant, though a parent grant would still open the cookie route", async () => {
    const { t, tutor, tutors } = await setup();
    expect((await t.call(tutor, "open_saved_reading", { id: tutors.id })).json().ok).toBe(true);
    const [connection] = await t.f.owner(() => t.f.db.select().from(s.mcpConnection).where(eq(s.mcpConnection.role, "tutor")));
    await t.f.owner(async () => { await t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.tutorGrant.id)); });
    expect((await t.rpc(tutor, "tools/call", { name: "list_saved_readings", arguments: {} })).status).toBe(401);
    // Directly, with the connection's id: the re-locked grant is gone, so nothing is bound.
    const mcp = createMcpAuthService({ db: t.f.db, access: t.f.service, secret: randomBytes(48).toString("base64url") });
    const actor = { tenantId: "crc", origin: ORIGIN, connectionId: connection.id, membershipId: connection.membershipId, unattended: false, expiresAt: Date.now() + 600_000 } as unknown as McpActor;
    await expect(createMcpSavedReadings(mcp).list(actor, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a live record for another connection, congregation or person before anything is bound", async () => {
    const actor = { tenantId: "crc", origin: ORIGIN, connectionId: randomUUID(), membershipId: randomUUID(), userId: "user", role: "admin", unattended: false, expiresAt: Date.now() + 600_000 } as unknown as McpActor;
    const signal = new AbortController().signal;
    for (const change of [{ connectionId: randomUUID() }, { tenantId: "other" }, { membershipId: randomUUID() }, { unattended: true }, { role: "parent" }, {}]) {
      const bound: string[] = [];
      // A stand-in withLive that hands over a chosen live record; the transaction is never touched before the refusal.
      const tx = { select: () => { bound.push("tx"); throw new Error("bound"); }, execute: () => { bound.push("tx"); throw new Error("bound"); } };
      const mcp = { withLive: async (_a: McpActor, _i: unknown, action: (tx: never, live: McpActor, alive: () => void) => Promise<unknown>) => action(tx as never, { ...actor, ...change } as McpActor, () => undefined) };
      const outcome = await withConnectionOwner(mcp as never, actor, "read", signal, async () => { bound.push("action"); return "ran"; }).then(value => value, error => error);
      if (Object.keys(change).length === 0) expect(bound, "an agreeing record reaches the binding").toEqual(["tx"]);
      else { expect(outcome, JSON.stringify(change)).toBeInstanceOf(AccessDenied); expect((outcome as AccessDenied).status).toBe(403); expect(bound, JSON.stringify(change)).toEqual([]); }
    }
  });

  it("keeps the per-person cap, and a timed-out or aborted call writes nothing", async () => {
    const { t, admin, call } = await setup();
    await t.f.owner(async () => {
      await t.f.db.insert(s.savedReading).values(Array.from({ length: 99 }, (_, i) => ({ tenantId: "crc", membershipId: t.f.adminMember.id, userId: t.f.identities.admin.id, name: `Seed ${i}`, kind: "torah" as const, ranges: "Genesis 1:1", verseCount: 1 })));
    });
    expect((await call(admin, "create_saved_reading", { name: "Over", ranges: "Genesis 1:1", mutationId: randomUUID() })).json()).toMatchObject({ ok: false, code: "limit" });
    const [connection] = await t.f.owner(() => t.f.db.select().from(s.mcpConnection).where(eq(s.mcpConnection.role, "admin")));
    const mcp = createMcpAuthService({ db: t.f.db, access: t.f.service, secret: randomBytes(48).toString("base64url") });
    const actor = { tenantId: "crc", origin: ORIGIN, connectionId: connection.id, membershipId: connection.membershipId, unattended: false, expiresAt: Date.now() + 600_000 } as unknown as McpActor;
    const aborted = new AbortController(); aborted.abort();
    const listed = (await call(admin, "list_saved_readings")).json();
    const first = listed.readings[0];
    await expect(createMcpSavedReadings(mcp).revise(actor, aborted.signal, { id: first.id, revision: first.revision, name: "Aborted" })).rejects.toMatchObject({ status: 401 });
    expect((await t.f.owner(async () => (await t.f.db.select().from(s.savedReading).where(eq(s.savedReading.id, first.id)))[0])).name).toBe(first.name);
  });
});
