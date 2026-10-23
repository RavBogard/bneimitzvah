import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";

// Staff blindness (accounts plan §7, threat 3): a member's private words never reach any staff,
// tutor or parent read, any MCP tool, or the audit log, whatever those code paths query.
const CANARY = `canary-${randomUUID()}`;
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); await closeMcpFixtures(); });

describe("staff blindness canary", () => {
  it("no admin, tutor or parent read returns a member's saved words, and saving writes no audit row", async () => {
    const f = await portalRoutesFixture(); opened.push(f);
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const post = (who: "admin" | "multi", path: string, body: unknown) => dispatch(new Request(`${ORIGIN}${path}`, { method: "POST",
      headers: { cookie: f.identities[who].cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) }));
    const audits = await f.owner(async () => (await f.db.select().from(s.auditEvent)).length);
    // Both the admin (the MCP and staff actor) and a parent-and-tutor member keep canary words.
    for (const who of ["admin", "multi"] as const) {
      const made = await (await post(who, "/api/saved/readings/create", { name: `Mine ${CANARY}`, date: "2026-10-17", kind: "torah", ranges: "Genesis 1:1-5" })).json();
      expect(made.ok).toBe(true);
      for (const stream of ["translation", "note"]) expect((await post(who, "/api/saved/work", { readingId: made.reading.id, verseRef: "Genesis 1:1", stream, expectedVersion: 0, text: `${stream} ${CANARY}` })).status).toBe(200);
      expect((await post(who, "/api/saved/mark", { readingId: made.reading.id, verseRef: "Genesis 1:1", expectedVersion: 0, state: "working" })).status).toBe(200);
      expect((await post(who, "/api/saved/star", { work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true })).status).toBe(200);
    }
    expect(await f.owner(async () => (await f.db.select().from(s.auditEvent)).length)).toBe(audits);
    const ids = f.students.slice(0, 3).map(student => student.id);
    const paths = ["/api/session", "/api/admin/students", "/api/admin/tutors", "/api/admin/invitations", "/api/admin/congregation-settings", "/api/admin/study-voice", "/api/admin/maven-link",
      "/api/staff/claude-connections", "/api/notifications/preferences", "/api/congregation/links", "/api/invitations/pending", "/api/reference-review/batches"];
    for (const mode of ["admin", "tutor", "parent"]) {
      paths.push(`/api/students?mode=${mode}`, `/api/admin/students?mode=${mode}`);
      for (const id of ids) for (const tail of ["", "/reading", "/progress", "/lesson-log", "/practice-calendar", "/practice-events", "/honors", "/study-guide", "/source-assignments",
        "/service-plan", "/my-service", "/recordings", "/honoree-links/status", "/study-text", "/study-sources", "/work"]) paths.push(`/api/students/${id}${tail}?mode=${mode}`);
    }
    for (const id of ids) paths.push(`/api/admin/students/${id}/relationships`);
    let ok = 0;
    for (const who of ["admin", "multi"] as const) for (const path of paths) {
      const response = await dispatch(new Request(`${ORIGIN}${path}`, { headers: { cookie: f.identities[who].cookie } }));
      const text = await response.text();
      if (response.status === 200) ok++;
      expect(text, `${who} ${path}`).not.toContain(CANARY);
      expect(text, `${who} ${path}`).not.toContain("saved_reading");
    }
    // The sweep reached real staff and family reads, not only refusals; and the canary is findable where it belongs (the owner's own route).
    expect(ok).toBeGreaterThan(40);
    expect(await (await dispatch(new Request(`${ORIGIN}/api/saved/readings`, { headers: { cookie: f.identities.multi.cookie } }))).text()).toContain(CANARY);
  }, 180_000);

  it("no MCP tool, attended or not, returns a member's saved words", async () => {
    const t = await mcpFixture();
    // Saved rows for the connected admin themself and for a tutor-and-parent member.
    await t.f.owner(async () => {
      for (const [member, user] of [[t.f.adminMember.id, t.f.identities.admin.id], [t.f.multiMember.id, t.f.identities.multi.id]]) {
        const [reading] = await t.f.db.insert(s.savedReading).values({ tenantId: "crc", membershipId: member, userId: user, name: `Mine ${CANARY}`, kind: "torah", ranges: "Genesis 1:1-3", verseCount: 3 }).returning();
        await t.f.db.insert(s.savedVerseWork).values({ tenantId: "crc", membershipId: member, savedReadingId: reading.id, verseRef: "Genesis 1:1", stream: "note", text: `note ${CANARY}`, version: 1 });
      }
    });
    await t.google("admin");
    const tokens = await t.connect("admin");
    const tools = (await t.rpc(tokens.access_token, "tools/list")).body.result.tools as { name: string; inputSchema: { properties?: Record<string, { type?: string; enum?: unknown[] }> } }[];
    expect(tools.length).toBeGreaterThan(10);
    const student = t.f.students[0].id;
    // Each tool once with no arguments and once with plausible ones; every answer is checked, errors included.
    let answered = 0;
    for (const tool of tools) {
      const args: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        if (/studentId$/.test(key)) args[key] = student;
        else if (key === "kind") args[key] = "torah";
        else if (schema.enum?.length) args[key] = schema.enum[0];
        else if (/mutationId$/.test(key)) args[key] = randomUUID();
        else if (schema.type === "integer" || schema.type === "number") args[key] = 0;
        else if (schema.type === "boolean") args[key] = false;
      }
      for (const input of [{}, args]) {
        const answer = await t.rpc(tokens.access_token, "tools/call", { name: tool.name, arguments: input });
        expect(JSON.stringify(answer.body), tool.name).not.toContain(CANARY);
        if (answer.status === 200 && !answer.body?.result?.isError) answered++;
      }
    }
    expect(answered).toBeGreaterThan(5);
    for (const method of ["resources/list", "prompts/list", "initialize"]) expect(JSON.stringify((await t.rpc(tokens.access_token, method, { protocolVersion: "2025-06-18" })).body)).not.toContain(CANARY);
  }, 180_000);
});
