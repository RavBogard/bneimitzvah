import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";

// Release 2.0 SC4: staff blindness for the service course's progress, on Learn to lein's canary (course-progress-canary.test.ts): a member's
// progress never reaches any staff, tutor or parent read, any MCP tool, or the audit log. Progress holds no free
// text, so the canary is a lesson's done instant no other row carries.
const CANARY = "2019-03-14T15:09:26.535Z";
const doc = { schema: "service-course-progress/v1", lessons: { shma: { done: CANARY } }, cards: { "word:shma:read": { box: 4, due: "2019-03-15" } } };
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); await closeMcpFixtures(); });

describe("service-course progress: staff blindness canary", () => {
  it("no admin, tutor or parent read returns a member's progress, and keeping it writes no audit row", async () => {
    const f = await portalRoutesFixture(); opened.push(f);
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const audits = await f.owner(async () => (await f.db.select().from(s.auditEvent)).length);
    for (const who of ["admin", "multi", "learner"] as const) {
      const owner = (await (await dispatch(new Request(`${ORIGIN}/api/learn/service/progress`, { headers: { cookie: f.identities[who].cookie } }))).json() as { owner: string }).owner;
      const response = await dispatch(new Request(`${ORIGIN}/api/learn/service/progress/merge`, { method: "POST",
        headers: { cookie: f.identities[who].cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ progress: doc, owner }) }));
      expect(response.status, who).toBe(200);
    }
    expect(await f.owner(async () => (await f.db.select().from(s.auditEvent)).length)).toBe(audits);
    const ids = f.students.slice(0, 3).map(student => student.id);
    const paths = ["/api/session", "/api/admin/students", "/api/admin/tutors", "/api/admin/invitations", "/api/admin/congregation-settings", "/api/admin/study-voice", "/api/admin/maven-link",
      "/api/staff/claude-connections", "/api/notifications/preferences", "/api/congregation/links", "/api/invitations/pending", "/api/reference-review/batches", "/api/saved/readings",
      "/api/learn/progress", "/api/learn/service/path"];
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
      expect(text, `${who} ${path}`).not.toContain("service_course_progress");
    }
    expect(ok).toBeGreaterThan(40);
    // Findable where it belongs: the owner's own route.
    expect(await (await dispatch(new Request(`${ORIGIN}/api/learn/service/progress`, { headers: { cookie: f.identities.learner.cookie } }))).text()).toContain(CANARY);
    // Learn to lein's own route never carries it either.
    expect(await (await dispatch(new Request(`${ORIGIN}/api/learn/progress`, { headers: { cookie: f.identities.learner.cookie } }))).text()).not.toContain(CANARY);
  }, 180_000);

  it("no MCP tool, attended or not, returns a member's progress", async () => {
    const t = await mcpFixture();
    await t.f.owner(async () => {
      for (const [member, user] of [[t.f.adminMember.id, t.f.identities.admin.id], [t.f.learnerMember.id, t.f.identities.learner.id]])
        await t.f.db.insert(s.serviceCourseProgressTable).values({ tenantId: "crc", membershipId: member, userId: user, progress: doc });
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
        expect(JSON.stringify(answer.body), tool.name).not.toContain(CANARY);
        if (answer.status === 200 && !answer.body?.result?.isError) answered++;
      }
    }
    expect(answered).toBeGreaterThan(5);
  }, 180_000);
});
