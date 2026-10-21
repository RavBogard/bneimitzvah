import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessTransaction } from "../access/types";
import * as data from "../data/roster";
import { insertSourceIdentity, lockRosterIntake, MAVEN_NAMESPACE, sourceIdentities } from "../data/roster-source";
import { lockRabbi } from "../study-guides/authority";
import { decodeMavenRosterContacts, mavenRosterQuery, type MavenContactFacts, type MavenRosterIssue } from "../students/maven-roster";
import {
  contactPresence, defaultMavenWindow, factsDigest, newStudentValues, planMavenIntake, rowDigests, ROW_DIGEST_LENGTH, updatedStudentValues,
  type IntakeRow, type IntakeStudent, type StudentKind,
} from "../students/maven-intake";
import { writeNewStudent, writeStudentEdit } from "../students/service";
import type { Tool, ToolContext } from "./tools";
import { SCOPES } from "./oauth";
import type { McpActor } from "./service";

// The Maven roster intake (Daniel, 2026-10-21): Claude reads Maven with Daniel's own Maven connector
// and proposes roster changes here. The portal stores no Maven credential and never calls Maven.
// Nothing here sends an invitation or an e-mail: inviting families stays a separate step in the portal.

const DATE_PATTERN = "^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const date = (description: string) => ({ type: "string", description, pattern: DATE_PATTERN });
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const start = date("First ceremony date of the window, YYYY-MM-DD, exactly as get_maven_roster_query returned it.");
const end = date("Last ceremony date of the window, YYYY-MM-DD, exactly as get_maven_roster_query returned it.");
const mavenResult = { type: "object", description: "The Maven connector's maven_run_soql structured result for that exact query, passed unchanged: not summarized, filtered or reformatted." };
const SLOTS = ["morning", "havdalah", "unknown"] as const;

const MAVEN_HINTS: Record<string, string> = {
  "invalid-window": "start and end are YYYY-MM-DD, start on or before end, at most 1830 days apart.",
  "source-denied": "Maven refused the query for this account.",
  "incomplete-response": "Maven returned a partial or truncated result. Run the query again so that it returns every row, and pass the whole result.",
  "unexpected-source": "The result is not from the exact query get_maven_roster_query gave for this window. Run that query unchanged.",
  "invalid-response": "This is not maven_run_soql's structured result. Pass the connector's result unchanged.",
  "too-many-contacts": "More than 500 contacts: narrow the window.",
  "invalid-row": "A Maven row is malformed; the listed rows were refused.", "duplicate-contact-id": "Maven listed the same Contact twice.",
  "outside-window": "A row's ceremony date is outside the window.",
};
const refusedMaven = (issues: readonly MavenRosterIssue[]) => ({ ok: false, code: "maven-result-refused", issues: issues.slice(0, 50),
  hint: [...new Set(issues.map(i => MAVEN_HINTS[i.code]).filter(Boolean))].join(" ") || "The Maven result was refused." });
const nameOf = (fact: MavenContactFacts) => [fact.firstName?.trim(), fact.lastName?.trim()].filter(Boolean).join(" ") || "(no name in Maven)";
const notesOf = (fact: MavenContactFacts) => fact.notHavingBeitMitzvah ? ["maven-records-no-ceremony"] : [];

async function snapshot<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string) {
  const rows = await data.roster(tx, tenantId), identities = await sourceIdentities(tx, tenantId, MAVEN_NAMESPACE);
  if (rows.length > 5000 || identities.length > 5000) throw new AccessDenied(403);
  const students: IntakeStudent[] = rows.map(r => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, ceremonyDate: r.ceremonyDate, studentKind: r.studentKind, serviceSlot: r.serviceSlot,
    parentEmail: r.parentEmail, ownEmail: r.ownEmail, hebrewName: r.hebrewName, secondParentEmail: r.secondParentEmail, rehearsal1: r.rehearsal1, rehearsal2: r.rehearsal2, disabledAt: r.disabledAt, revision: r.revision }));
  return { students, identities };
}
const requireAdmin = (actor: McpActor) => { if (actor.role !== "admin") throw new AccessDenied(403); };

/** The reviewable row: names, dates, the kind of change and field names. Contacts only as presence, never an address. */
function reviewRow(row: IntakeRow, fact: MavenContactFacts, byId: ReadonlyMap<string, IntakeStudent>) {
  const portal = (id: string) => { const st = byId.get(id); return st ? { name: `${st.firstName} ${st.lastName}`, ceremonyDate: st.ceremonyDate } : null; };
  const base = { row: row.row, name: nameOf(fact), ceremonyDate: fact.ceremonyDate, change: row.kind };
  const extra = row.kind === "update" ? { studentId: row.studentId, expectedRevision: row.expectedRevision, changedFields: row.changedFields, portal: portal(row.studentId), ...(row.rehearsalsFit ? {} : { blocked: "rehearsal-after-new-ceremony-date" }) }
    : row.kind === "new" ? { canCreateAs: row.canCreateAs }
    : row.kind === "reconcile" ? { canCreateAs: row.canCreateAs, suggestions: row.suggestions.map(s => ({ studentId: s.studentId, ...portal(s.studentId), changedFields: s.changedFields,
      ...(s.disabled ? { blocked: "student-disabled" } : s.linkedElsewhere ? { blocked: "linked-to-another-maven-contact" } : !s.rehearsalsFit ? { blocked: "rehearsal-after-new-ceremony-date" } : {}) })) }
    : row.kind === "linked-student-disabled" ? { studentId: row.studentId, portal: portal(row.studentId) }
    : row.kind === "not-importable" ? { reason: row.reason } : {};
  const notes = notesOf(fact);
  return { ...base, ...extra, contacts: contactPresence(fact), ...(notes.length ? { notes } : {}) };
}

type Choice = Readonly<{ row: number; action: "update" } | { row: number; action: "create"; studentKind: StudentKind; serviceSlot: (typeof SLOTS)[number] } | { row: number; action: "link"; studentId: string }>;
/** Strict per-row choices: every key closed and required for its action; each row at most once. */
function parseChoices(value: unknown, rows: number): { choices: Choice[] } | { problems: string[] } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return { problems: ["choices must be a list of 1 to 500 rows"] };
  const problems: string[] = [], seen = new Set<number>(), choices: Choice[] = [];
  value.forEach((raw, i) => {
    const at = `choices[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) { problems.push(`${at} must be an object`); return; }
    const c = raw as Record<string, unknown>, keys = Object.keys(c).sort().join(",");
    if (!Number.isSafeInteger(c.row) || (c.row as number) < 1 || (c.row as number) > rows) { problems.push(`${at}.row must be a row number from the proposal`); return; }
    if (seen.has(c.row as number)) { problems.push(`${at}: row ${c.row} is chosen twice`); return; }
    seen.add(c.row as number);
    if (c.action === "update" && keys === "action,row") choices.push({ row: c.row as number, action: "update" });
    else if (c.action === "create" && keys === "action,row,serviceSlot,studentKind" && (c.studentKind === "child" || c.studentKind === "adult") && SLOTS.includes(c.serviceSlot as never))
      choices.push({ row: c.row as number, action: "create", studentKind: c.studentKind, serviceSlot: c.serviceSlot as (typeof SLOTS)[number] });
    else if (c.action === "link" && keys === "action,row,studentId" && typeof c.studentId === "string" && UUID.test(c.studentId)) choices.push({ row: c.row as number, action: "link", studentId: c.studentId });
    else problems.push(`${at} must be {row, action:"update"}, {row, action:"create", studentKind:"child"|"adult", serviceSlot:"morning"|"havdalah"|"unknown"} or {row, action:"link", studentId}`);
  });
  return problems.length ? { problems } : { choices: choices.sort((a, b) => a.row - b.row) };
}
/** Why a choice does not fit its (unchanged) proposed row, or null when it does. */
function misfit(choice: Choice, row: IntakeRow): string | null {
  const creatable = (kinds: readonly StudentKind[]) => choice.action === "create" && !kinds.includes(choice.studentKind) ? (choice.studentKind === "child" ? "no-parent-email-on-file-for-a-child" : "no-own-email-on-file-for-an-adult") : null;
  if (row.kind === "update") return choice.action !== "update" ? "action-does-not-fit-row" : row.rehearsalsFit ? null : "rehearsal-after-new-ceremony-date";
  if (row.kind === "new") return choice.action !== "create" ? "action-does-not-fit-row" : creatable(row.canCreateAs);
  if (row.kind === "reconcile") {
    if (choice.action === "create") return creatable(row.canCreateAs);
    if (choice.action !== "link") return "action-does-not-fit-row";
    const s = row.suggestions.find(x => x.studentId === choice.studentId);
    return !s ? "not-a-suggested-student" : s.disabled ? "student-disabled" : s.linkedElsewhere ? "linked-to-another-maven-contact" : s.rehearsalsFit ? null : "rehearsal-after-new-ceremony-date";
  }
  return "nothing-to-apply";
}
class Rollback extends Error { constructor(readonly result: Record<string, unknown>) { super("rollback"); } }

export function createRosterTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  return Object.freeze([
    {
      name: "get_maven_roster_query", roles: ["admin"], scope: SCOPES.read, annotations: readOnly,
      description: "Step 1 of the Maven roster intake. Returns the exact SOQL for the ceremony-date window (default: today through two years ahead). Run it with the Maven connector's maven_run_soql exactly as given, then pass its structured result unchanged to propose_roster_changes with the same start and end. The portal never calls Maven itself.",
      inputSchema: closed({ start: date("Optional first ceremony date, YYYY-MM-DD; give both or neither."), end: date("Optional last ceremony date, YYYY-MM-DD; at most 1830 days after start.") }),
      handler: async (input, ctx) => {
        requireAdmin(ctx.actor);
        if ((input.start === undefined) !== (input.end === undefined)) return { ok: false, code: "invalid-window", hint: "Give both start and end, or neither." };
        const window = input.start === undefined ? defaultMavenWindow(ctx.mcp.now()) : { start: input.start as string, end: input.end as string };
        const built = mavenRosterQuery(window);
        if (!built.ok) return { ok: false, code: "invalid-window", hint: MAVEN_HINTS["invalid-window"] };
        return { ok: true, window, connector: "Maven (CRC Salesforce)", tool: built.query.tool, arguments: built.query.arguments,
          next: "Run maven_run_soql with exactly these arguments. Then call propose_roster_changes with this start and end and the tool's structured result as mavenResult, unchanged." };
      },
    },
    {
      name: "propose_roster_changes", roles: ["admin"], scope: SCOPES.read, annotations: readOnly, deadlineMs: 55_000,
      description: "Step 2 of the Maven roster intake: compare Maven's result with the portal roster and propose, row by row, what would change. Writes nothing. Maven's Contact id is the identity; a matching name and date only suggests a student to link. Each row gives the name, ceremony date, kind of change (update, new, reconcile, linked-student-disabled, not-importable) and changed field names; contacts appear only as whether an address is on file. Unchanged rows are listed by number only. Returns planToken (30 minutes) for apply_roster_changes. Show the rabbi the table and ask which rows to apply.",
      inputSchema: closed({ start, end, mavenResult }, ["start", "end", "mavenResult"]),
      handler: async (input, ctx) => {
        requireAdmin(ctx.actor);
        const decoded = decodeMavenRosterContacts({ start: input.start, end: input.end }, input.mavenResult);
        if (!decoded.ok) return refusedMaven(decoded.issues);
        const facts = decoded.contacts;
        return ctx.mcp.withLive(ctx.actor, "read", async (tx, live) => {
          requireAdmin(live);
          const { students, identities } = await snapshot(tx, live.tenantId);
          const plan = planMavenIntake({ tenantId: live.tenantId, facts, students, identities });
          if (!plan.ok) return { ok: false, code: "roster-unreadable", hint: "A portal student record does not pass the roster's validation; fix it in the portal, then propose again." };
          const byId = new Map(students.map(st => [st.id, st])), counts: Record<string, number> = {};
          for (const row of plan.rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
          const sealed = facts.length ? ctx.mcp.sealRosterPlan(live, { v: 1, start: input.start, end: input.end, facts: factsDigest(facts), rows: rowDigests(plan.rows) }) : null;
          return { ok: true, window: { start: input.start, end: input.end }, mavenRows: facts.length, counts,
            rows: plan.rows.filter(row => row.kind !== "unchanged").map(row => reviewRow(row, facts[row.row - 1], byId)),
            unchangedRows: plan.rows.filter(row => row.kind === "unchanged").map(row => row.row),
            planToken: sealed?.token ?? null, expiresAt: sealed ? new Date(sealed.expiresAt).toISOString() : null,
            next: "Show the rabbi these rows as a table (row, name, ceremony date, change, changed fields, blocked). Apply nothing until the rabbi says which rows; for each new student ask child or adult and the service slot (morning, havdalah, or unknown to set later); for a reconcile row ask which suggested student it is, or new. Applying sends no invitations or e-mail.",
            legend: { "maven-records-no-ceremony": "Maven records that this student is not having a Beit Mitzvah.", "householdPrimaryIsStudent": "The household's primary contact is the student." } };
        });
      },
    },
    {
      name: "apply_roster_changes", roles: ["admin"], scope: SCOPES.study, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, deadlineMs: 55_000,
      description: "Step 3 of the Maven roster intake, only after the rabbi has said which rows to apply. Pass the same start, end and Maven result, the planToken, and one choice per row: {row, action:\"update\"} for an update; {row, action:\"create\", studentKind:\"child\"|\"adult\", serviceSlot:\"morning\"|\"havdalah\"|\"unknown\"} for a new student (or a reconcile row the rabbi says is new); {row, action:\"link\", studentId} to link a reconcile row to a suggested student. Everything is rechecked live and applied in one transaction: if any chosen row changed since the proposal, nothing is written and each row says why. Re-applying is safe: rows already applied are reported, not written twice. Sends NO invitations or e-mail; the rabbi invites families separately in the portal. A scheduled routine cannot apply.",
      inputSchema: closed({ start, end, mavenResult, planToken: { type: "string", maxLength: 8192, description: "planToken from propose_roster_changes, unchanged." },
        choices: { type: "array", maxItems: 500, description: "The rows the rabbi chose, one entry per row.", items: closed({ row: { type: "integer", minimum: 1, maximum: 500 }, action: { type: "string", enum: ["update", "create", "link"] },
          studentKind: { type: "string", enum: ["child", "adult"] }, serviceSlot: { type: "string", enum: [...SLOTS] }, studentId: { type: "string", pattern: UUID.source } }, ["row", "action"]) } },
      ["start", "end", "mavenResult", "planToken", "choices"]),
      handler: async (input, ctx) => applyRosterChanges(input, ctx),
    },
  ] satisfies Tool<Q>[]);
}

async function applyRosterChanges<Q extends PgQueryResultHKT>(input: Record<string, unknown>, ctx: ToolContext<Q>) {
  if (ctx.actor.role !== "admin" || !ctx.actor.scopes.has(SCOPES.study)) throw new AccessDenied(403);
  // Roster writes are the rabbi's decision in a conversation, never an unattended routine's.
  if (ctx.actor.unattended) return { ok: false, code: "channel-not-permitted", hint: "A scheduled routine cannot change the roster; the rabbi applies roster changes in a conversation." };
  const decoded = decodeMavenRosterContacts({ start: input.start, end: input.end }, input.mavenResult);
  if (!decoded.ok) return refusedMaven(decoded.issues);
  const facts = decoded.contacts, claim = ctx.mcp.openRosterPlan(ctx.actor, input.planToken);
  if (!claim || claim.v !== 1 || claim.start !== input.start || claim.end !== input.end || claim.facts !== factsDigest(facts)
    || typeof claim.rows !== "string" || claim.rows.length !== facts.length * ROW_DIGEST_LENGTH)
    return { ok: false, code: "plan-token-refused", hint: "The plan token has expired, or it is not for this connection, this window or this Maven result. Call propose_roster_changes again and show the rabbi the new table." };
  const parsed = parseChoices(input.choices, facts.length);
  if ("problems" in parsed) return { ok: false, code: "invalid-choices", problems: parsed.problems.slice(0, 50), hint: "Fix the listed choices and resend; nothing was written." };
  const proposed = claim.rows as string;
  try {
    return await ctx.mcp.withLive(ctx.actor, "data-write", async (tx, live, alive) => {
      if (live.role !== "admin" || !live.scopes.has(SCOPES.study) || live.unattended) throw new AccessDenied(403);
      await lockRabbi(tx, live.tenantId, live.membershipId, { roleGrantId: live.roleGrantId, roleGrantRevision: live.roleGrantRevision, authorityRevision: live.authorityRevision });
      await lockRosterIntake(tx, live.tenantId, MAVEN_NAMESPACE);
      const { students, identities } = await snapshot(tx, live.tenantId);
      const plan = planMavenIntake({ tenantId: live.tenantId, facts, students, identities });
      if (!plan.ok) return { ok: false, code: "roster-unreadable", hint: "A portal student record does not pass the roster's validation; fix it in the portal, then propose again." };
      type Outcome = { row: number; name: string; outcome: string; studentId?: string; revision?: number; reason?: string; readingsSentToReview?: boolean };
      const outcomes: Outcome[] = [], work: { choice: Choice; row: IntakeRow; outcome: Outcome; target?: { studentId: string; expectedRevision: number; changed: boolean } }[] = [];
      const linkTargets = new Set<string>();
      for (const choice of parsed.choices) {
        const row = plan.rows[choice.row - 1], fact = facts[choice.row - 1], outcome: Outcome = { row: choice.row, name: nameOf(fact), outcome: "not-applied" };
        outcomes.push(outcome);
        if (row.digest !== proposed.slice((choice.row - 1) * ROW_DIGEST_LENGTH, choice.row * ROW_DIGEST_LENGTH)) {
          // Identities are insert-only: a row now unchanged and linked as chosen was applied before.
          if (row.kind === "unchanged" && (choice.action !== "link" || choice.studentId === row.studentId)) Object.assign(outcome, { outcome: "already-applied", studentId: row.studentId, revision: row.expectedRevision });
          else Object.assign(outcome, { outcome: "conflict", reason: "changed-since-proposal" });
          continue;
        }
        const reason = misfit(choice, row) ?? (choice.action === "link" && linkTargets.has(choice.studentId) ? "student-chosen-twice" : null);
        if (reason) { Object.assign(outcome, { outcome: "invalid-choice", reason }); continue; }
        if (choice.action === "link") linkTargets.add(choice.studentId);
        const target = row.kind === "update" ? { studentId: row.studentId, expectedRevision: row.expectedRevision, changed: row.changedFields.length > 0 }
          : row.kind === "reconcile" && choice.action === "link" ? (s => ({ studentId: s.studentId, expectedRevision: s.expectedRevision, changed: s.changedFields.length > 0 }))(row.suggestions.find(s => s.studentId === choice.studentId)!)
          : undefined;
        work.push({ choice, row, outcome, target });
      }
      const refuse = (code: string) => ({ ok: false, code, rows: outcomes,
        hint: code === "conflict" ? "Nothing was written. Some rows changed since the proposal: call propose_roster_changes again and show the rabbi the new table." : "Nothing was written. Fix the listed choices and resend with the same planToken." });
      if (outcomes.some(o => o.outcome === "conflict")) return refuse("conflict");
      if (outcomes.some(o => o.outcome === "invalid-choice")) return refuse("invalid-choices");
      // Lock every student to be changed (in id order) and recheck it before the first write.
      const current = new Map<string, NonNullable<Awaited<ReturnType<typeof data.editableStudent>>>>();
      for (const item of [...work].filter(w => w.target).sort((a, b) => a.target!.studentId < b.target!.studentId ? -1 : 1)) {
        const st = await data.editableStudent(tx, live.tenantId, item.target!.studentId);
        if (!st || st.disabledAt || st.revision !== item.target!.expectedRevision) Object.assign(item.outcome, { outcome: "conflict", reason: "changed-since-proposal" });
        else current.set(st.id, st);
      }
      if (outcomes.some(o => o.outcome === "conflict")) return refuse("conflict");
      const portal = ctx.mcp.portalActor(live), at = ctx.mcp.now();
      const live_ = () => { alive(); if (ctx.signal.aborted) throw new AccessDenied(401); };
      const identity = (sourceRecordId: string, studentId: string) => insertSourceIdentity(tx, { tenantId: live.tenantId, sourceNamespace: MAVEN_NAMESPACE, sourceRecordId, studentId,
        createdAt: new Date(at), createdByUserId: live.userId, createdByMembershipId: live.membershipId, roleGrantId: live.roleGrantId, role: "admin", mcpConnectionId: live.connectionId });
      for (const { choice, row, outcome, target } of work) {
        live_();
        const fact = facts[choice.row - 1];
        if (target) {
          let revision = target.expectedRevision, readingsSentToReview = false;
          if (target.changed) {
            const updated = await writeStudentEdit(tx, portal, target.studentId, target.expectedRevision, updatedStudentValues(fact, current.get(target.studentId)!), at);
            if (!updated) throw new Rollback(refuse("conflict"));
            revision = updated.revision; readingsSentToReview = updated.readingNeedsReview;
          }
          if (choice.action === "link") await identity(row.sourceRecordId, target.studentId);
          Object.assign(outcome, { outcome: choice.action === "link" ? "linked" : "updated", studentId: target.studentId, revision, readingsSentToReview });
        } else if (choice.action === "create") {
          const student = await writeNewStudent(tx, portal, newStudentValues(fact, choice.studentKind, choice.serviceSlot), "student.import", at);
          await identity(row.sourceRecordId, student.id);
          Object.assign(outcome, { outcome: "created", studentId: student.id, revision: student.revision });
        } else throw new AccessDenied(403);
      }
      live_();
      return { ok: true, applied: work.length, alreadyApplied: outcomes.filter(o => o.outcome === "already-applied").length, rows: outcomes,
        invitationsSent: 0, next: "Nothing was sent to anyone. Invite families from the portal's roster when the rabbi is ready; set any unknown service slots there." };
    });
  } catch (error) { if (error instanceof Rollback) return error.result; throw error; }
}
