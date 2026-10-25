import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";

// 1.9 N19, staff blindness for a student's own verse cards, on Learn progress's canary (course-progress-canary.test.ts): the
// cards never reach any admin, tutor or parent read, any MCP tool, or the audit log. Cards hold no free text, so the canary
// is a verse and a due date no other row carries (decision 7 does not cover run-throughs: tutors see nothing new).
const CANARY_REF = "Job 42:17", CANARY_DUE = "2031-07-19";
const doc = { schema: "learn-verses/v1", cards: { [`haftarah|${CANARY_REF}`]: { box: 4, due: CANARY_DUE } } };
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); await closeMcpFixtures(); });

describe("verse cards: staff blindness canary", () => {
  it("no admin, tutor or parent read returns a student's cards, and keeping them writes no audit row", async () => {
    const f = await portalRoutesFixture(); opened.push(f);
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const audits = await f.owner(async () => (await f.db.select().from(s.auditEvent)).length);
    const read = await dispatch(new Request(`${ORIGIN}/api/learn/verses`, { headers: { cookie: f.identities.learner.cookie } }));
    const owner = (await read.json() as { owner: string }).owner;
    const written = await dispatch(new Request(`${ORIGIN}/api/learn/verses/put`, { method: "POST",
      headers: { cookie: f.identities.learner.cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ review: doc, expectedVersion: 0, expectedOwner: owner }) }));
    expect(written.status).toBe(200);
    expect(await f.owner(async () => (await f.db.select().from(s.auditEvent)).length)).toBe(audits);
    const ids = f.students.slice(0, 3).map(student => student.id);
    const paths = ["/api/session", "/api/admin/students", "/api/admin/tutors", "/api/admin/invitations", "/api/admin/congregation-settings", "/api/admin/study-voice", "/api/admin/maven-link",
      "/api/staff/claude-connections", "/api/notifications/preferences", "/api/congregation/links", "/api/invitations/pending", "/api/reference-review/batches", "/api/saved/readings",
      "/api/learn/progress", "/api/learn/verses"];
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
      for (const needle of [CANARY_REF, CANARY_DUE, "learn-verses", "verse_review"]) expect(text, `${who} ${path}`).not.toContain(needle);
    }
    expect(ok).toBeGreaterThan(40);
    // Findable where it belongs: the student's own route.
    expect(await (await dispatch(new Request(`${ORIGIN}/api/learn/verses`, { headers: { cookie: f.identities.learner.cookie } }))).text()).toContain(CANARY_REF);
  }, 180_000);

  it("no MCP tool, attended or not, returns a student's cards", async () => {
    const t = await mcpFixture();
    await t.f.owner(async () => {
      await t.f.db.insert(s.verseReviewTable).values({ tenantId: "crc", membershipId: t.f.learnerMember.id, userId: t.f.identities.learner.id, review: doc });
    });
    await t.google("admin");
    const tokens = await t.connect("admin");
    const tools = (await t.rpc(tokens.access_token, "tools/list")).body.result.tools as { name: string; inputSchema: { properties?: Record<string, { type?: string; enum?: unknown[] }> } }[];
    expect(tools.length).toBeGreaterThan(10);
    const student = t.f.students[0].id;
    let answered = 0;
    for (const tool of tools) {
      const args: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        if (/studentId$/.test(key)) args[key] = student;
        else if (key === "kind") args[key] = "torah";
        else if (schema.enum?.length) args[key] = schema.enum[0];
        else if (schema.type === "integer" || schema.type === "number") args[key] = 0;
        else if (schema.type === "boolean") args[key] = false;
      }
      for (const input of [{}, args]) {
        const answer = await t.rpc(tokens.access_token, "tools/call", { name: tool.name, arguments: input });
        const text = JSON.stringify(answer.body);
        expect(text, tool.name).not.toContain(CANARY_DUE); expect(text, tool.name).not.toContain("learn-verses");
        if (answer.status === 200 && !answer.body?.result?.isError) answered++;
      }
    }
    expect(answered).toBeGreaterThan(5);
  }, 180_000);
});
