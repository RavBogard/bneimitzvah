import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";
import { syntheticServiceCatalog } from "../helpers/service-learning";

// Release 2.0 SC5 (A4 9): no route, MCP tool or export returns the per-part finished mark to anyone but the student's assigned
// tutors and admins, through GET /api/students/{id}/service-finished. The canary is a finished day no other row carries.
const CANARY = "2019-03-14", INSTANT = "2019-03-14T18:09:26.535Z";
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); await closeMcpFixtures(); });

describe("the per-part finished mark: no other reader", () => {
  it("no other route, in any mode, returns a mark; only the staff route does, to the assigned tutor and the admin", async () => {
    const f = await portalRoutesFixture(); opened.push(f);
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const content = syntheticServiceCatalog("canary", { standard: true }), catalogId = randomUUID(), ids = f.students.slice(0, 3).map(student => student.id);
    await f.owner(async () => {
      await f.db.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
      await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
      for (const studentId of ids) {
        await f.db.insert(s.studentServicePlan).values({ tenantId: "crc", studentId, catalogId, catalogIdentity: content.identity, selectedIds: [content.standard.vahavta],
          reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: f.adminMember.id });
        await f.db.insert(s.servicePartFinished).values({ tenantId: "crc", studentId, lessonId: "vahavta", finishedAt: new Date(INSTANT) });
      }
    });
    const paths = ["/api/session", "/api/admin/students", "/api/admin/tutors", "/api/admin/invitations", "/api/admin/congregation-settings", "/api/admin/study-voice", "/api/admin/maven-link",
      "/api/staff/claude-connections", "/api/notifications/preferences", "/api/congregation/links", "/api/invitations/pending", "/api/reference-review/batches", "/api/saved/readings",
      "/api/learn/progress", "/api/learn/service/progress", "/api/learn/service/path", "/api/learn/verses"];
    for (const mode of ["admin", "tutor", "parent", "student"]) {
      paths.push(`/api/students?mode=${mode}`, `/api/admin/students?mode=${mode}`);
      for (const id of ids) for (const tail of ["", "/reading", "/progress", "/lesson-log", "/practice-calendar", "/practice-events", "/honors", "/study-guide", "/source-assignments",
        "/service-plan", "/my-service", "/recordings", "/honoree-links/status", "/study-text", "/study-sources", "/work"]) paths.push(`/api/students/${id}${tail}?mode=${mode}`);
    }
    for (const id of ids) paths.push(`/api/admin/students/${id}/relationships`);
    let ok = 0;
    for (const who of ["admin", "multi", "learner"] as const) for (const path of paths) {
      const response = await dispatch(new Request(`${ORIGIN}${path}`, { headers: { cookie: f.identities[who].cookie } }));
      const text = await response.text();
      if (response.status === 200) ok++;
      expect(text, `${who} ${path}`).not.toContain(CANARY);
      expect(text, `${who} ${path}`).not.toContain("service_part_finished");
    }
    expect(ok).toBeGreaterThan(40);
    // The finished route itself: only the assigned tutor and the admin, never the parent, the student or another student's tutor.
    const finished = async (who: "admin" | "multi" | "learner", id: string, mode: string) => {
      const response = await dispatch(new Request(`${ORIGIN}/api/students/${id}/service-finished?mode=${mode}`, { headers: { cookie: f.identities[who].cookie } }));
      return { status: response.status, text: await response.text() };
    };
    expect((await finished("admin", ids[0], "admin")).text).toContain(CANARY);
    expect((await finished("multi", ids[0], "tutor")).text).toContain(CANARY);
    for (const [who, id, mode] of [["multi", ids[1], "tutor"], ["multi", ids[2], "tutor"], ["multi", ids[0], "parent"], ["learner", ids[0], "student"], ["learner", ids[0], "tutor"], ["multi", ids[1], "parent"]] as const) {
      const answer = await finished(who, id, mode);
      expect(answer.status, `${who} ${mode}`).not.toBe(200);
      expect(answer.text, `${who} ${mode}`).not.toContain(CANARY);
    }
  }, 240_000);

  it("no MCP tool, attended or not, returns a mark", async () => {
    const t = await mcpFixture();
    await t.f.owner(async () => {
      for (const student of t.f.students.filter(row => row.tenantId === "crc"))
        await t.f.db.insert(s.servicePartFinished).values({ tenantId: "crc", studentId: student.id, lessonId: "vahavta", finishedAt: new Date(INSTANT) });
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
