import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";
import { handlePublicReadingRequest, publicReadingRouteMethods, type PublicRuntime } from "../../src/server/http/public-reading";
import { readApprovedPortionSummary } from "../../src/server/portion-summary/public";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { packAssetAllowed } from "../../src/lib/offline/policy";
import { unavailableExtras } from "../helpers/translations";
import { approveSummary, withdrawSummary, type SummaryAuthority } from "../../src/server/portion-summary/service";
import { lockRabbi } from "../../src/server/study-guides/authority";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// Portion summaries through the MCP (1.9 N6, decision 4: "Claude drafts, you approve"), read back through the one public route
// every reader surface uses (/read, Study, print and the offline pack). Synthetic text only; nothing reaches the network.
const ORIGIN = "http://localhost:3000";
const TOOLS = ["draft_portion_summary", "list_portion_summaries", "approve_portion_summary", "withdraw_portion_summary"];
const OUTLINE = Array.from({ length: 7 }, (_, i) => `Synthetic aliyah ${i + 1}: a short line.`);
const SUMMARY = "A synthetic summary of the parashah.\n\nA second *synthetic* paragraph.";

async function setup(who: "admin" | "multi" = "admin", options: { unattended?: boolean; scope?: string } = {}, shared?: Awaited<ReturnType<typeof mcpFixture>>) {
  const t = shared ?? await mcpFixture(true);
  await t.google(who);
  const token = (await t.connect(who, options)).access_token as string;
  const texts: string[] = [];
  const json = async (name: string, args: Record<string, unknown>) => { const r = await t.call(token, name, args); texts.push(r.text); return r.json(); };
  const listed = async () => (await t.rpc(token, "tools/list")).body.result.tools.map((tool: { name: string }) => tool.name) as string[];
  const count = () => t.f.owner(async () => (await t.f.client.query("select count(*)::int as n from portion_summary")).rows[0] as { n: number });
  // The public runtime reads the same database as the signed-out site does: the public tenant, through the view only.
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: {} as PublicRuntime["reading"], commentary: async () => { throw new Error("unused"); }, ...unavailableExtras,
    portionSummary: reading => withTenantTransaction(t.f.db, { tenantId: "crc" }, tx => readApprovedPortionSummary(tx as never, "crc", reading)) };
  const route = async (path: string, init: RequestInit = {}) => handlePublicReadingRequest(new Request(ORIGIN + path, init), async action => action(runtime));
  const shown = async (reading = "vayera") => { const response = await route(`/api/public/portion-summary?reading=${reading}`); expect(response.status).toBe(200); return (await response.json()).summary; };
  return { t, token, json, texts, listed, count, route, shown };
}
const draft = (extra: Record<string, unknown> = {}) => ({ reading: "Vayera", summary: SUMMARY, outline: OUTLINE, mutationId: randomUUID(), ...extra });

describe("portion summary tools", () => {
  it("exist only for an admin; a tutor sees none and cannot write, and a scheduled routine may draft and list but never approve or withdraw", async () => {
    const admin = await setup();
    for (const name of TOOLS) expect(await admin.listed()).toContain(name);
    const tutor = await setup("multi", {}, admin.t);
    const tutorTools = await tutor.listed();
    for (const name of TOOLS) expect(tutorTools).not.toContain(name);
    for (const name of TOOLS) expect((await tutor.t.rpc(tutor.token, "tools/call", { name, arguments: draft() })).body.error, name).toBeDefined();
    expect(await admin.count()).toEqual({ n: 0 });

    const routine = await setup("admin", { unattended: true }, admin.t);
    const routineTools = await routine.listed();
    expect(routineTools).toEqual(expect.arrayContaining(["draft_portion_summary", "list_portion_summaries"]));
    expect(routineTools).not.toContain("approve_portion_summary");
    expect(routineTools).not.toContain("withdraw_portion_summary");
    const drafted = await routine.json("draft_portion_summary", draft());
    expect(drafted).toEqual({ ok: true, replayed: false, reading: "vayera", revision: 1, status: "draft" });
    for (const name of ["approve_portion_summary", "withdraw_portion_summary"]) {
      expect((await routine.t.rpc(routine.token, "tools/call", { name, arguments: { reading: "vayera", revision: 1 } })).body.error, name).toBeDefined();
    }
    expect((await routine.json("list_portion_summaries", {})).summaries.map((s: { status: string }) => s.status)).toEqual(["draft"]);
    expect(await admin.shown()).toBeNull();
    // A read-only consent cannot draft at all.
    const reader = await setup("admin", { scope: "portal:read" }, admin.t);
    const readerTools = await reader.listed();
    for (const name of ["draft_portion_summary", "approve_portion_summary", "withdraw_portion_summary"]) expect(readerTools).not.toContain(name);
    // Called directly anyway, approve and withdraw are refused and change nothing.
    for (const name of ["approve_portion_summary", "withdraw_portion_summary"]) {
      const answer = await reader.t.rpc(reader.token, "tools/call", { name, arguments: { reading: "vayera", revision: 1 } });
      const done = answer.status === 200 && !answer.body.error && !answer.body.result.isError && JSON.parse(answer.body.result.content[0].text).ok === true;
      expect(done, name).toBe(false);
    }
    expect((await admin.json("list_portion_summaries", { reading: "vayera", status: "all" })).summaries.map((s: { status: string }) => s.status)).toEqual(["draft"]);
    expect(await admin.count()).toEqual({ n: 1 });
  });

  it("drafts only a parashah's summary and seven plain lines, idempotently, refusing links, HTML, extra fields and anything but a parashah", async () => {
    const { json, t, token, count } = await setup();
    const args = draft();
    expect(await json("draft_portion_summary", args)).toMatchObject({ ok: true, replayed: false, reading: "vayera", revision: 1, status: "draft" });
    expect(await json("draft_portion_summary", args)).toMatchObject({ ok: true, replayed: true, reading: "vayera", revision: 1, status: "draft" });
    expect(await json("draft_portion_summary", { ...args, summary: "Something else." })).toMatchObject({ ok: false, code: "conflict" });
    expect(await json("draft_portion_summary", { ...args, mutationId: randomUUID() })).toMatchObject({ ok: false, code: "no-change" });
    const refuse = async (changes: Record<string, unknown>, text: RegExp) => {
      const answer = await json("draft_portion_summary", draft(changes));
      expect(answer, JSON.stringify(changes)).toMatchObject({ ok: false, code: "invalid" });
      expect((answer.problems ?? []).join(" "), JSON.stringify(changes)).toMatch(text);
    };
    await refuse({ summary: "See https://example.test/x" }, /links/);
    await refuse({ summary: "<b>bold</b>" }, /HTML/);
    await refuse({ summary: `Hidden${String.fromCharCode(0x200b)}mark` }, /hidden/);
    await refuse({ summary: "x".repeat(4097) }, /4096/);
    await refuse({ outline: ["One line"].concat(Array(5).fill("Another")) }, /exactly 7/);
    await refuse({ outline: [...OUTLINE.slice(0, 6), "Two\nlines"] }, /aliyah 7/);
    await refuse({ outline: [...OUTLINE.slice(0, 6), "<i>x</i>"] }, /aliyah 7/);
    await refuse({ reading: "Shabbat Shekalim" }, /parashah/);
    await refuse({ reading: "Rosh Hashana" }, /parashah/);
    await refuse({ reading: "Not a portion" }, /parashah/);
    // An unknown argument (an introduction, a student, a question for students) is refused by the closed schema before anything runs.
    for (const extra of [{ intro: "x" }, { studentId: randomUUID() }, { questions: ["Think about it"] }, { mutationId: "not-a-uuid" }]) expect((await t.call(token, "draft_portion_summary", { ...draft(), ...extra })).isError).toBe(true);
    expect(await count()).toEqual({ n: 1 });
  });

  it("shows nothing until the rabbi approves; then shows that exact revision credited to Rabbi Daniel Bogard; a new draft stays hidden; withdrawing hides it for good", async () => {
    const { json, texts, route, shown, t } = await setup();
    const first = await json("draft_portion_summary", draft());
    // A draft is invisible on the public route that /read, Study, print and the offline pack read, signed in or out.
    expect(await shown()).toBeNull();
    const signedIn = await route("/api/public/portion-summary?reading=vayera", { headers: { cookie: t.f.identities.admin.cookie } });
    expect((await signedIn.json()).summary).toBeNull();
    expect(await as(await route("/api/public/portion-summary?reading=vayera"))).not.toContain("synthetic summary");
    // The route is GET only, keyed by a parashah slug only, and cacheable; no route writes a summary.
    expect(publicReadingRouteMethods("/api/public/portion-summary")).toEqual(["GET"]);
    expect((await route("/api/public/portion-summary?reading=vayera", { method: "POST" })).status).toBe(405);
    for (const query of ["reading=Vayera", "reading=shabbat-shekalim", "reading=vayera&revision=1", "reading=vayera&status=draft", "ref=Genesis%2018:1"])
      expect((await route(`/api/public/portion-summary?${query}`)).status, query).toBe(400);
    expect((await route("/api/public/portion-summary?reading=vayera")).headers.get("vercel-cdn-cache-control")).toContain("s-maxage=300");
    // N24: the offline pack may hold this same public route (approved revisions only) and no other portion summary route: never the staff route or a draft path.
    expect(packAssetAllowed("/api/public/portion-summary?reading=vayera")).toBe(true);
    for (const path of ["/api/portion-summary?reading=vayera", "/api/portion-summary/drafts?reading=vayera", "/api/public/portion-summary/draft?reading=vayera", "/api/admin/portion-summary?reading=vayera", "/api/public/portion-summary"])
      expect(packAssetAllowed(path), path).toBe(false);

    const listed = await json("list_portion_summaries", {});
    expect(listed.summaries).toEqual([expect.objectContaining({ reading: "vayera", revision: 1, status: "draft", summary: SUMMARY,
      outline: OUTLINE.map((line, i) => ({ aliyah: i + 1, line })) })]);
    expect(await json("approve_portion_summary", { reading: "vayera", revision: 2 })).toMatchObject({ ok: false, code: "not-found" });
    const approved = await json("approve_portion_summary", { reading: "Vayera", revision: first.revision });
    expect(approved).toMatchObject({ ok: true, reading: "vayera", revision: 1, status: "approved", credit: "Rabbi Daniel Bogard", replaced: null });
    // Nothing on the reader renders a summary yet (N7), so the answer never claims readers see it.
    expect(approved).not.toHaveProperty("shown");
    expect(approved.note).toMatch(/shows atop Study on the reading page/);
    expect(await shown()).toEqual({ reading: "vayera", revision: 1, summary: SUMMARY, outline: OUTLINE.map((line, i) => ({ aliyah: i + 1, line })),
      credit: "Rabbi Daniel Bogard", approvedAt: approved.approvedAt });
    expect(await shown("noach")).toBeNull();
    expect(await json("approve_portion_summary", { reading: "vayera", revision: 1 })).toMatchObject({ ok: false, code: "not-draft" });

    // A second draft never shows while the first stays approved; approving it replaces the first, which is withdrawn.
    const second = await json("draft_portion_summary", draft({ summary: "A revised synthetic summary." }));
    expect(second).toMatchObject({ ok: true, revision: 2, status: "draft" });
    expect((await shown()).revision).toBe(1);
    expect(await json("approve_portion_summary", { reading: "vayera", revision: 2 })).toMatchObject({ ok: true, revision: 2, replaced: 1 });
    expect(await shown()).toMatchObject({ revision: 2, summary: "A revised synthetic summary.", credit: "Rabbi Daniel Bogard" });
    expect((await json("list_portion_summaries", { reading: "vayera", status: "all" })).summaries.map((s: { revision: number; status: string }) => [s.revision, s.status]))
      .toEqual([[2, "approved"], [1, "withdrawn"]]);

    // Withdrawing hides it at once, and nothing earlier comes back; withdrawn is final.
    expect(await json("withdraw_portion_summary", { reading: "vayera", revision: 2 })).toEqual({ ok: true, reading: "vayera", revision: 2, status: "withdrawn", wasApproved: true });
    expect(await shown()).toBeNull();
    expect(await json("withdraw_portion_summary", { reading: "vayera", revision: 2 })).toMatchObject({ ok: false, code: "withdrawn" });
    expect(await json("approve_portion_summary", { reading: "vayera", revision: 1 })).toMatchObject({ ok: false, code: "withdrawn" });
    // A draft can be discarded without ever showing.
    const third = await json("draft_portion_summary", draft({ summary: "A third synthetic summary." }));
    expect(await json("withdraw_portion_summary", { reading: "vayera", revision: third.revision })).toMatchObject({ ok: true, wasApproved: false });
    expect(await shown()).toBeNull();
    // Nothing returned names a membership, a grant or an address.
    const ids = [t.f.adminMember.id, t.f.adminGrant.id];
    for (const id of ids) expect(texts.join("")).not.toContain(id);
    expect(texts.join("")).not.toMatch(/@|drafted_?[bB]y|approved_?[bB]y/);
  });

  it("never lets another congregation's admin approve or withdraw a CRC revision through the tools' service", async () => {
    const { json, t, shown } = await setup();
    await json("draft_portion_summary", draft());
    // The other congregation's rabbi, as the MCP would run them: their own tenant, their own live admin grant re-locked.
    const other = await t.f.owner(async () => {
      const member = (await t.f.client.query<{ id: string }>("select id from membership where tenant_id='other' limit 1")).rows[0].id;
      await t.f.client.query("insert into role_grant(tenant_id,membership_id,role) values('other',$1,'admin')", [member]);
      return member;
    });
    const authority: SummaryAuthority<never> = { run: action => withTenantTransaction(t.f.db, { tenantId: "other" }, async tx => {
      const rabbi = await lockRabbi(tx as never, "other", other);
      return action(tx as never, { tenantId: "other", membershipId: rabbi.membershipId, roleGrantId: rabbi.roleGrantId, attended: true }, () => {});
    }) };
    expect(await approveSummary(authority, { reading: "vayera", revision: 1 })).toMatchObject({ ok: false, code: expect.stringMatching(/^(no-credit|not-found)$/) });
    expect(await withdrawSummary(authority, { reading: "vayera", revision: 1 })).toMatchObject({ ok: false, code: "not-found" });
    expect((await json("list_portion_summaries", {})).summaries.map((s: { status: string }) => s.status)).toEqual(["draft"]);
    expect(await shown()).toBeNull();
  });

  it("refuses an approval once the rabbi's admin grant is revoked", async () => {
    const { json, t, token, shown } = await setup();
    await json("draft_portion_summary", draft());
    await t.f.owner(() => t.f.client.query("update role_grant set revoked_at = now() where id = $1", [t.f.adminGrant.id]));
    const answer = await t.rpc(token, "tools/call", { name: "approve_portion_summary", arguments: { reading: "vayera", revision: 1 } });
    const approved = answer.status === 200 && !answer.body.error && !answer.body.result.isError && JSON.parse(answer.body.result.content[0].text).ok === true;
    expect(approved).toBe(false);
    expect(await shown()).toBeNull();
  });
});

async function as(response: Response) { return response.text(); }
