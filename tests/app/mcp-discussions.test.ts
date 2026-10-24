import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";
import { EN, HE, REFS, syntheticPinned } from "../helpers/discussions";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// Curated discussions through the MCP (1.7 M6): admin and attended only, closed inputs, idempotent adds, revision checks.
// Sefaria is the synthetic pinned reader; nothing here reaches the network.
const TOOLS = ["add_discussion", "revise_discussion", "withdraw_discussion", "list_discussions", "add_source_translation"];
async function setup(who: "admin" | "multi" = "admin", options: { unattended?: boolean; scope?: string } = {}) {
  const pinned = syntheticPinned();
  const t = await mcpFixture(true, undefined, { pinnedSource: pinned });
  await t.google(who);
  const token = (await t.connect(who, options)).access_token as string;
  const texts: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => { const r = await t.call(token, name, args); texts.push(r.text); return r; };
  const json = async (name: string, args: Record<string, unknown>) => (await call(name, args)).json();
  const rows = (table: string) => t.f.owner(async () => (await t.f.client.query(`select count(*)::int as n from ${table}`)).rows[0] as { n: number });
  return { t, token, call, json, texts, pinned, rows };
}
const source = (i: number, anchorRef = "Genesis 12:1") => ({ ref: REFS[i], anchorRef, edition: EN });

describe("curated discussion tools", () => {
  it("exist only for an admin, and refuse a scheduled routine outright", async () => {
    const admin = await setup();
    const listed = (await admin.t.rpc(admin.token, "tools/list")).body.result.tools.map((tool: { name: string }) => tool.name);
    for (const name of TOOLS) expect(listed).toContain(name);
    const tutor = await setup("multi");
    const tutorTools = (await tutor.t.rpc(tutor.token, "tools/list")).body.result.tools.map((tool: { name: string }) => tool.name);
    for (const name of TOOLS) expect(tutorTools).not.toContain(name);
    expect((await tutor.t.rpc(tutor.token, "tools/call", { name: "add_discussion", arguments: { title: "x", kind: "torah", sources: [source(0)], mutationId: randomUUID() } })).body.error.message).toBe("Unknown tool");
    const routine = await setup("admin", { unattended: true });
    for (const [name, args] of [["add_discussion", { title: "A question", kind: "torah", sources: [source(0)], mutationId: randomUUID() }],
      ["add_source_translation", { originalRef: REFS[2], originalEdition: HE, body: "Synthetic translation.", mutationId: randomUUID() }],
      ["list_discussions", { verse: "Genesis 12:1" }], ["withdraw_discussion", { slug: "a-question", revision: 1 }], ["revise_discussion", { slug: "a-question", revision: 1, title: "B" }]] as const) {
      const answer = await routine.json(name, args);
      expect(answer, name).toMatchObject({ ok: false, code: "attended-only" });
    }
    expect(await routine.rows("curated_discussion")).toEqual({ n: 0 });
    expect(await routine.rows("source_translation")).toEqual({ n: 0 });
    expect(routine.pinned.calls).toEqual([]);
  });

  it("adds a credited Claude translation once per mutationId, checked on Sefaria, with the guide prose rules", async () => {
    const { json, rows, t, token, texts } = await setup();
    const mutationId = randomUUID(), args = { originalRef: REFS[2], originalEdition: HE, body: "Synthetic translation, line one.\n\nLine *two*.", mutationId };
    const added = await json("add_source_translation", args);
    const [{ product_name: productName }] = await t.f.owner(async () => (await t.f.client.query("select product_name from tenant where id='crc'")).rows as { product_name: string }[]);
    expect(added).toMatchObject({ ok: true, replayed: false, originalRef: REFS[2], originalEdition: HE, credit: `Claude translation for ${productName}` });
    expect(await json("add_source_translation", args)).toMatchObject({ ok: true, replayed: true, translationId: added.translationId });
    expect(await json("add_source_translation", { ...args, body: "Something else." })).toMatchObject({ ok: false, code: "conflict" });
    expect(await rows("source_translation")).toEqual({ n: 1 });
    for (const body of ["See https://example.test/x", "A [link](somewhere)", "<b>bold</b>", `Hidden${String.fromCharCode(0x200b)}mark`, "www.example.test", ""]) {
      expect(await json("add_source_translation", { ...args, body, mutationId: randomUUID() }), body).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(await json("add_source_translation", { ...args, originalEdition: "Not An Edition", mutationId: randomUUID() })).toMatchObject({ ok: false, code: "invalid" });
    expect(await json("add_source_translation", { ...args, originalRef: "Not a ref", mutationId: randomUUID() })).toMatchObject({ ok: false, code: "invalid" });
    expect(await rows("source_translation")).toEqual({ n: 1 });
    // An unknown argument (an introduction, a student, a saved reading) is refused by the closed schema before anything runs.
    for (const extra of [{ intro: "x" }, { studentId: randomUUID() }, { savedReadingId: randomUUID() }]) expect((await t.call(token, "add_source_translation", { ...args, ...extra })).isError).toBe(true);
    expect(texts.join("")).not.toMatch(/@|selected_by|selectedBy":"[0-9a-f]{8}-/);
  });

  it("publishes a discussion at once, idempotently, and refuses intros, bad refs and editions, and anchors outside a real reading", async () => {
    const { json, rows, t, token, pinned } = await setup();
    const mutationId = randomUUID(), args = { title: "What does it mean to go forth?", kind: "torah", sources: [source(0), source(1, "Genesis 12:2")], mutationId };
    const added = await json("add_discussion", args);
    expect(added).toEqual({ ok: true, replayed: false, slug: "what-does-it-mean-to-go-forth", revision: 1 });
    expect(await json("add_discussion", args)).toEqual({ ok: true, replayed: true, slug: added.slug, revision: 1, status: "published" });
    expect(await rows("curated_discussion")).toEqual({ n: 1 });
    expect(await rows("curated_discussion_source")).toEqual({ n: 2 });
    expect(pinned.calls.filter(call => call.startsWith(REFS[0])).every(call => call.endsWith(`|en|${EN}`))).toBe(true);
    // The same title again is a second discussion with its own slug.
    expect(await json("add_discussion", { ...args, mutationId: randomUUID() })).toMatchObject({ ok: true, slug: "what-does-it-mean-to-go-forth-2" });
    // No introduction or essay anywhere: refused by the schema (top level) or the service (inside a source).
    for (const extra of [{ intro: "An introduction." }, { essay: "x" }, { summary: "x" }]) expect((await t.call(token, "add_discussion", { ...args, ...extra, mutationId: randomUUID() })).isError).toBe(true);
    const refuse = async (changes: Record<string, unknown>, text: RegExp) => {
      const answer = await json("add_discussion", { ...args, mutationId: randomUUID(), ...changes });
      expect(answer.ok, JSON.stringify(changes)).toBe(false);
      expect((answer.problems ?? []).join(" "), JSON.stringify(changes)).toMatch(text);
    };
    await refuse({ sources: [{ ...source(0), note: "An essay." }] }, /only ref, anchorRef/);
    await refuse({ sources: [{ ...source(0), ref: "Not a ref" }] }, /ref/);
    await refuse({ sources: [{ ...source(0), ref: "Synthetic Unknown 1:1" }] }, /Sefaria has no text/);
    await refuse({ sources: [{ ...source(0), edition: "Some Other Edition" }] }, /Sefaria has no text/);
    await refuse({ sources: [source(0, "Job 1:1")] }, /not a verse of any Torah reading/);
    await refuse({ sources: [source(0, "Genesis 51:1")] }, /not a verse of any Torah reading/);
    await refuse({ kind: "haftarah", sources: [source(0, "Genesis 12:1")] }, /not a verse of any haftarah/);
    await refuse({ sources: [source(0), source(0)] }, /same source twice/);
    await refuse({ sources: [] }, /1 to 24/);
    await refuse({ sources: Array.from({ length: 25 }, () => source(0)) }, /1 to 24/);
    await refuse({ title: "Line\none" }, /title/);
    await refuse({ title: "<b>Bold</b>" }, /title/);
    await refuse({ sources: [{ ref: REFS[0], anchorRef: "Genesis 12:1", edition: EN, translationId: randomUUID() }] }, /exactly one/);
    await refuse({ sources: [{ ref: REFS[2], anchorRef: "Genesis 12:1", translationId: randomUUID() }] }, /no such translation/);
    // A translation names exactly the ref it was made from.
    const translation = await json("add_source_translation", { originalRef: REFS[2], originalEdition: HE, body: "Synthetic translation.", mutationId: randomUUID() });
    await refuse({ sources: [{ ref: REFS[0], anchorRef: "Genesis 12:1", translationId: translation.translationId }] }, /that translation is of/);
    expect(await json("add_discussion", { ...args, title: "With a translation", sources: [{ ref: REFS[2], anchorRef: "Genesis 12:3", translationId: translation.translationId }, source(0)], mutationId: randomUUID() }))
      .toMatchObject({ ok: true, slug: "with-a-translation" });
    expect(await rows("curated_discussion")).toEqual({ n: 3 });
  });

  it("revises under the current revision only, withdraws for good, and lists withdrawn ones with their current sources", async () => {
    const { json, texts, t } = await setup();
    // The person who selects is named from their own account name, kept with each source; an address never is.
    const rename = (name: string) => t.f.owner(() => t.f.client.query("update \"user\" set name = $1 where id = $2", [name, t.f.identities.admin.id]));
    await rename(["synthetic-admin", "example.test"].join("@"));
    const firstMutation = randomUUID(), firstArgs = { title: "A synthetic question", kind: "torah", sources: [source(0)], mutationId: firstMutation };
    const added = await json("add_discussion", firstArgs);
    expect((await json("list_discussions", { verse: "Genesis 12:1" })).discussions[0].sources[0].selectedBy).toBe("Portal member");
    await rename("Synthetic Selector");
    expect(await json("revise_discussion", { slug: added.slug, revision: 2, title: "Changed" })).toMatchObject({ ok: false, code: "conflict" });
    expect(await json("revise_discussion", { slug: added.slug, revision: 1, title: "A synthetic question" })).toMatchObject({ ok: false, code: "no-change" });
    expect(await json("revise_discussion", { slug: added.slug, revision: 1 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await json("revise_discussion", { slug: added.slug, revision: 1, title: "A clearer synthetic question" })).toEqual({ ok: true, slug: added.slug, revision: 2 });
    expect(await json("revise_discussion", { slug: added.slug, revision: 1, title: "Stale" })).toMatchObject({ ok: false, code: "conflict" });
    expect(await json("revise_discussion", { slug: added.slug, revision: 2, sources: [source(1, "Genesis 12:2"), source(0)] })).toEqual({ ok: true, slug: added.slug, revision: 3 });
    expect(await json("revise_discussion", { slug: added.slug, revision: 3, sources: [source(1, "Genesis 12:2"), source(0)] })).toMatchObject({ ok: false, code: "no-change" });
    expect(await json("revise_discussion", { slug: added.slug, revision: 3, sources: [source(0, "Psalms 1:1")] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await json("revise_discussion", { slug: "no-such-discussion", revision: 1, title: "X" })).toMatchObject({ ok: false, code: "not-found" });
    const listed = await json("list_discussions", { reading: "Lech Lecha" });
    expect(listed.ok).toBe(true);
    expect(listed.discussions).toHaveLength(1);
    expect(listed.discussions[0]).toMatchObject({ slug: added.slug, title: "A clearer synthetic question", kind: "torah", status: "published", revision: 3,
      sources: [{ position: 1, ref: REFS[1], anchorRef: "Genesis 12:2", edition: EN, selectedBy: "Synthetic Selector" }, { position: 2, ref: REFS[0], anchorRef: "Genesis 12:1", edition: EN, selectedBy: "Synthetic Selector" }] });
    const before = await json("list_discussions", { verse: "Genesis 12:1" });
    expect(before.discussions[0].revision).toBe(3);
    // A replayed add reports the discussion as it stands now, not revision 1.
    expect(await json("add_discussion", firstArgs)).toEqual({ ok: true, replayed: true, slug: added.slug, revision: 3, status: "published" });
    expect(await json("withdraw_discussion", { slug: added.slug, revision: 2 })).toMatchObject({ ok: false, code: "conflict" });
    expect(await json("withdraw_discussion", { slug: added.slug, revision: 3 })).toEqual({ ok: true, slug: added.slug, revision: 4, status: "withdrawn" });
    expect(await json("withdraw_discussion", { slug: added.slug, revision: 4 })).toMatchObject({ ok: false, code: "withdrawn" });
    expect(await json("revise_discussion", { slug: added.slug, revision: 4, title: "Back again" })).toMatchObject({ ok: false, code: "withdrawn" });
    const byVerse = await json("list_discussions", { verse: "Genesis 12:2" });
    expect(byVerse.discussions.map((d: { slug: string; status: string }) => [d.slug, d.status])).toEqual([[added.slug, "withdrawn"]]);
    expect((await json("list_discussions", { verse: "Genesis 1:1" })).discussions).toEqual([]);
    expect(await json("list_discussions", {})).toMatchObject({ ok: false, code: "invalid" });
    expect(await json("list_discussions", { verse: "Job 1:1" })).toMatchObject({ ok: false, code: "invalid" });
    // Nothing returned names a membership or an address.
    expect(texts.join("")).not.toMatch(/@|selected_?[bB]y"\s*:\s*"[0-9a-f]{8}-/);
  });
});
