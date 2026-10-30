import "server-only";
import { createHash } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { canonical } from "../study-guides/service";
import { portionSummaryCredit } from "../../lib/portion-summary/credit";
import * as data from "./data";
import { parashahOf, validateSummary } from "./validation";

/**
 * Portion summaries (1.9 N6, decision 4: "Claude drafts, you approve"). Writes come only through the admin MCP tools
 * (mcp/portion-summary-tools.ts), which supply a `SummaryAuthority`: the connection and the admin grant re-locked inside the
 * write transaction. Claude drafts (a scheduled routine may draft too); only the rabbi or an administrator, in a conversation
 * they attend, approves or withdraws. A draft is a new revision whose words never change, so an approval approves exactly the
 * text that was listed. Nothing here is ever shown publicly until approved, and nothing returned names a membership.
 */
export type SummaryWriter = Readonly<{ tenantId: string; membershipId: string; roleGrantId: string; attended: boolean }>;
export type SummaryAuthority<Q extends PgQueryResultHKT> = {
  run<T>(action: (tx: AccessTransaction<Q>, writer: SummaryWriter, live: () => void) => Promise<T>): Promise<T>;
};
type FailureCode = "invalid" | "conflict" | "no-change" | "not-found" | "withdrawn" | "not-draft" | "attended-only" | "no-credit";
export type SummaryFailure = Readonly<{ ok: false; code: FailureCode; problems?: readonly string[] }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: FailureCode, problems?: readonly string[]): SummaryFailure => Object.freeze({ ok: false, code, ...(problems ? { problems: Object.freeze([...problems]) } : {}) });
const digest = (parts: unknown) => createHash("sha256").update(canonical(parts)).digest("hex");
const LIST_LIMIT = 50;
/** Until N7 renders summaries on the reader (and N24 packs them), an approval is public data that no page shows yet: say so. */
const APPROVED_NOTE = "Approved. It is the parashah's public portion summary and shows atop Study on the reading page, on /read and on a student's own reading, within about ten minutes.";
const revisionOf = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) < 2147483647 ? value as number : null;
const view = (row: data.SummaryRow) => Object.freeze({ reading: row.readingKey, revision: row.revision, status: row.status,
  summary: row.summary, outline: Object.freeze(row.outline.map((line, i) => Object.freeze({ aliyah: i + 1, line }))),
  ...(row.credit !== null ? { credit: row.credit } : {}), ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
  ...(row.withdrawnAt ? { withdrawnAt: row.withdrawnAt.toISOString() } : {}), draftedAt: row.createdAt.toISOString() });

/** A draft: a new revision of one parashah's summary and outline, shown to no one until approved. Idempotent per mutationId. */
export async function draftSummary<Q extends PgQueryResultHKT>(authority: SummaryAuthority<Q>, supplied: Record<string, unknown>) {
  const { reading: rawReading, mutationId: rawMutation, ...rest } = supplied;
  const parashah = parashahOf(rawReading), problems: string[] = [];
  if (!parashah) problems.push("reading: a parashah from the portal's reading list, e.g. \"Vayera\" (not a special Shabbat, festival or fast)");
  if (typeof rawMutation !== "string" || !UUID.test(rawMutation)) problems.push("mutationId: a fresh UUID");
  const checked = validateSummary(rest);
  if (!checked.ok) problems.push(...checked.problems);
  if (problems.length || !parashah || !checked.ok) return fail("invalid", problems);
  const readingKey = parashah.slug, value = checked.value, mutationId = (rawMutation as string).toLowerCase();
  const requestDigest = digest(["portion-summary/v1", readingKey, value]);
  return authority.run(async (tx, writer, live) => {
    const replay = (row: data.SummaryRow) => row.requestDigest === requestDigest
      ? Object.freeze({ ok: true as const, replayed: true, reading: row.readingKey, revision: row.revision, status: row.status }) : fail("conflict");
    const prior = await data.summaryReceipt(tx, writer.tenantId, mutationId);
    if (prior) return replay(prior);
    const revisions = await data.revisionsOf(tx, writer.tenantId, readingKey, true);
    const same = revisions.find(row => row.status !== "withdrawn" && row.summary === value.summary && row.outline.length === value.outline.length
      && row.outline.every((line, i) => line === value.outline[i]));
    if (same) return fail("no-change", [`Revision ${same.revision} (${same.status}) already has exactly this text.`]);
    live();
    const row = await data.insertDraft(tx, { tenantId: writer.tenantId, membershipId: writer.membershipId, readingKey, revision: (revisions[0]?.revision ?? 0) + 1,
      summary: value.summary, outline: value.outline, mutationId, requestDigest });
    live();
    if (!row) { const raced = await data.summaryReceipt(tx, writer.tenantId, mutationId); return raced ? replay(raced) : fail("conflict"); }
    return Object.freeze({ ok: true as const, replayed: false, reading: readingKey, revision: row.revision, status: "draft" as const });
  });
}

/** The rabbi's working list: one parashah's every revision, or every revision in one state (drafts by default). */
export async function listSummaries<Q extends PgQueryResultHKT>(authority: SummaryAuthority<Q>, supplied: Record<string, unknown>) {
  const unknown = Object.keys(supplied).filter(key => key !== "reading" && key !== "status");
  if (unknown.length) return fail("invalid", [`List takes reading and status only; not ${unknown.join(", ")}`]);
  const status = supplied.status ?? "draft";
  if (status !== "draft" && status !== "approved" && status !== "withdrawn" && status !== "all") return fail("invalid", ["status: draft, approved, withdrawn or all"]);
  const parashah = supplied.reading === undefined ? null : parashahOf(supplied.reading);
  if (supplied.reading !== undefined && !parashah) return fail("invalid", ["reading: a parashah from the portal's reading list"]);
  return authority.run(async (tx, writer) => {
    const rows = parashah ? (await data.revisionsOf(tx, writer.tenantId, parashah.slug)).filter(row => status === "all" || row.status === status).slice(0, LIST_LIMIT + 1)
      : await data.summariesIn(tx, writer.tenantId, status === "all" ? null : status, LIST_LIMIT + 1);
    return Object.freeze({ ok: true as const, summaries: Object.freeze(rows.slice(0, LIST_LIMIT).map(view)), truncated: rows.length > LIST_LIMIT });
  });
}

const target = (supplied: Record<string, unknown>, verb: string) => {
  const unknown = Object.keys(supplied).filter(key => key !== "reading" && key !== "revision");
  if (unknown.length) return fail("invalid", [`${verb} takes reading and revision only; not ${unknown.join(", ")}`]);
  const parashah = parashahOf(supplied.reading), revision = revisionOf(supplied.revision);
  if (!parashah || revision === null) return fail("invalid", ["reading and revision, from list_portion_summaries"]);
  return { readingKey: parashah.slug, revision };
};

/**
 * Approve one draft revision: from now on it is what every reader sees, credited with the congregation's credit. The rabbi or
 * an administrator only, in a conversation they attend; a revision approved before it for the same parashah is withdrawn in the
 * same transaction, so at most one is ever shown.
 */
export async function approveSummary<Q extends PgQueryResultHKT>(authority: SummaryAuthority<Q>, supplied: Record<string, unknown>) {
  const wanted = target(supplied, "Approve");
  if ("ok" in wanted) return wanted;
  return authority.run(async (tx, writer, live) => {
    if (!writer.attended) return fail("attended-only");
    const rows = await data.revisionsOf(tx, writer.tenantId, wanted.readingKey, true), row = rows.find(r => r.revision === wanted.revision);
    if (!row) return fail("not-found");
    if (row.status === "withdrawn") return fail("withdrawn");
    if (row.status !== "draft") return fail("not-draft");
    // A summary that arrived by import keeps its original author; any other carries the congregation's own credit.
    const credit = row.importCredit ?? portionSummaryCredit(writer.tenantId);
    if (!credit) return fail("no-credit");
    const current = rows.find(r => r.status === "approved");
    live();
    if (current && !await data.withdraw(tx, writer.tenantId, current.id, "approved")) return fail("conflict");
    const approved = await data.approveDraft(tx, { tenantId: writer.tenantId, membershipId: writer.membershipId, roleGrantId: writer.roleGrantId }, row.id, credit);
    live();
    if (!approved || !approved.approvedAt) return fail("conflict");
    return Object.freeze({ ok: true as const, reading: wanted.readingKey, revision: approved.revision, status: "approved" as const, credit: approved.credit,
      approvedAt: approved.approvedAt.toISOString(), replaced: current ? current.revision : null, note: APPROVED_NOTE });
  });
}

/** Withdraw a draft (it is never shown) or the approved revision (it stops being shown). Final; draft a new revision instead. */
export async function withdrawSummary<Q extends PgQueryResultHKT>(authority: SummaryAuthority<Q>, supplied: Record<string, unknown>) {
  const wanted = target(supplied, "Withdraw");
  if ("ok" in wanted) return wanted;
  return authority.run(async (tx, writer, live) => {
    if (!writer.attended) return fail("attended-only");
    const rows = await data.revisionsOf(tx, writer.tenantId, wanted.readingKey, true), row = rows.find(r => r.revision === wanted.revision);
    if (!row) return fail("not-found");
    if (row.status === "withdrawn") return fail("withdrawn");
    live();
    const done = await data.withdraw(tx, writer.tenantId, row.id, row.status);
    live();
    return done ? Object.freeze({ ok: true as const, reading: wanted.readingKey, revision: done.revision, status: "withdrawn" as const, wasApproved: row.status === "approved" })
      : fail("conflict");
  });
}
