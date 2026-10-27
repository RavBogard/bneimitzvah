"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { PeopleNav } from "../../shell/people-nav";
import { Button, PageHeader } from "../../../ui";
import { DocumentTitle } from "../document-title";
import { accountsApi, type AccountRequest, type ApproverMode, type ApproversView, type Member, type StudentOption } from "./api";

/** Daniel's approved approver help line (F1, wording approved 2026-10-23). */
export const APPROVER_HELP_LINE = "Anyone who asks in good faith can have an account, member or not. Decline only spam or abuse.";
/** Daniel's approved approver line (G13, TP-06): an account is never a parent's access; the office sends a parent invitation. */
export const APPROVER_PARENT_LINE = "Asking about a child? Approve, then ask the office to send a parent invitation.";
/** Proposed wording, not yet approved by Daniel: a designated tutor approving someone an admin ended (Decided here, 2026-10-23). */
export const ADMIN_REAPPROVAL_LINE = "An admin ended this person’s membership, so only an admin can approve them again. The request is kept.";
/** Proposed wording, not yet approved by Daniel: an approver's own request is approved by another approver (Decided here, 2026-10-23). */
export const OWN_REQUEST_LINE = "This is your own request, so another approver needs to approve it. You can decline it yourself.";
/** Lead's wording (plan D6), listed as gaps: the two link refusals, and the lines after linking. */
export const IDENTITY_TAKEN_LINE = "That student record is already linked to another account. The request is kept.";
export const ALREADY_LINKED_LINE = "This account is already linked to a student record. The request is kept.";
const studentLabel = (student: Pick<StudentOption, "firstName" | "lastName">) => `${student.firstName} ${student.lastName}`;
const initial = (name: string) => Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "A";
const day = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
type Message = { text: string; tone: "status" | "alert"; signIn?: boolean } | null;
const failure = (status: number, action: string): Message => status === 401 ? { text: `You’re signed out. Sign in again, then ${action}.`, tone: "alert", signIn: true }
  : status === 403 ? { text: "This account can’t do that right now. Reload to check your access.", tone: "alert" }
  : status === 404 ? { text: "That isn’t there any more. The list has been reloaded.", tone: "alert" }
  : { text: "We couldn’t confirm the change. Reload to check.", tone: "alert" };

/** Link requests for the people who approve them (release 1.4 account requests, repurposed by plan D6): admins, and tutors an admin designated. */
export function AccountsWorkspace() {
  const { summary } = useWorkspace();
  const admin = summary.roles.includes("admin");
  if (!summary.approver) return <section className="workspace-state" data-testid="role-unavailable"><h1>Role unavailable</h1><p>Link requests are for administrators and the tutors they choose to approve them.</p><a href="/workspace">Choose a role</a></section>;
  return <AccountsPage mode={admin ? "admin" : "tutor"} />;
}

function AccountsPage({ mode }: { mode: ApproverMode }) {
  const { registerReload } = useWorkspace();
  const admin = mode === "admin";
  const [requests, setRequests] = useState<readonly AccountRequest[] | null>(null), [productName, setProductName] = useState<string | null>(null), [members, setMembers] = useState<readonly Member[] | null>(null), [approvers, setApprovers] = useState<ApproversView | null>(null);
  // The students an approver may link to, and the one chosen per request (the request's own named student first).
  const [students, setStudents] = useState<readonly StudentOption[]>([]), [chosen, setChosen] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true), [broken, setBroken] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState<Message>(null);
  const [confirming, setConfirming] = useState<string | null>(null), [candidate, setCandidate] = useState("");
  const request = useRef<AbortController | null>(null), alive = useRef(true), gate = useRef(false), selectId = useId();
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setBroken(false);
    try {
      const [queue, people, chooser, options] = await Promise.all([accountsApi.requests(mode, controller.signal), admin ? accountsApi.members(controller.signal) : null, admin ? accountsApi.approvers(controller.signal) : null,
        accountsApi.students(mode, controller.signal).catch((): readonly StudentOption[] => [])]);
      if (controller.signal.aborted) return;
      setRequests(queue.requests); setProductName(queue.productName); setMembers(people); setApprovers(chooser); setStudents(options);
      setChosen(current => Object.fromEntries(queue.requests.map(row => [row.id, options.some(option => option.id === current[row.id]) ? current[row.id] : options.some(option => option.id === row.student?.id) ? row.student!.id : ""])));
      setCandidate(current => chooser?.candidates.some(row => row.tutorGrantId === current) ? current : chooser?.candidates[0]?.tutorGrantId ?? "");
    } catch { if (!controller.signal.aborted) { setRequests(null); setBroken(true); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [mode, admin]);
  useEffect(() => registerReload(async () => { setConfirming(null); await load(); }), [registerReload, load]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current?.abort(); }; }, [load]);

  async function act(run: () => Promise<Message>, action: string) {
    if (gate.current) return;
    gate.current = true; setPending(true); setMessage(null);
    try { const next = await run(); if (alive.current) { setConfirming(null); setMessage(next); await load(); } }
    catch (error) { if (!alive.current) return; const status = statusOf(error); setConfirming(null); setMessage(failure(status, action)); if (status === 404) await load(); }
    finally { gate.current = false; if (alive.current) setPending(false); }
  }
  const approve = (row: AccountRequest, studentId?: string) => act(async () => {
    const result = await accountsApi.approve(mode, row.id, studentId);
    const student = studentId ? students.find(option => option.id === studentId) : undefined;
    return result.ok ? { text: student ? `${row.name} is now linked to ${studentLabel(student)}. They’ll get one email saying so.` : `${row.name} now has an account. They’ll get one email saying so.`, tone: "status" }
      : { text: result.code === "admin-only" ? ADMIN_REAPPROVAL_LINE : result.code === "own-request" ? OWN_REQUEST_LINE : result.code === "identity-taken" ? IDENTITY_TAKEN_LINE : result.code === "already-linked" ? ALREADY_LINKED_LINE
        : "That person’s account is turned off here, so it can’t be approved. The request is kept.", tone: "alert" };
  }, "approve the request");
  const decline = (row: AccountRequest) => act(async () => { await accountsApi.decline(mode, row.id); return { text: "Request declined. Nothing was sent.", tone: "status" }; }, "decline the request");
  const end = (row: Member) => act(async () => { await accountsApi.endMember(row.id); return { text: `${row.name}’s membership has ended.`, tone: "status" }; }, "end the membership");
  const remove = (id: string, name: string) => act(async () => { await accountsApi.removeApprover(id); return { text: `${name} no longer approves account requests.`, tone: "status" }; }, "remove the approver");
  async function add() {
    if (!candidate) return;
    if (gate.current) return;
    gate.current = true; setPending(true); setMessage(null);
    try {
      const result = await accountsApi.addApprover(candidate);
      if (!alive.current) return;
      setMessage(result.ok ? { text: "Approver added.", tone: "status" } : { text: result.code === "admin" ? "Admins already approve requests." : "That tutor already approves requests.", tone: "alert" });
      await load();
    } catch (error) {
      if (!alive.current) return;
      const status = statusOf(error);
      setMessage(status === 403 ? { text: "Sign in again to change approvers.", tone: "alert", signIn: true } : failure(status, "add the approver"));
    } finally { gate.current = false; if (alive.current) setPending(false); }
  }

  return <section className="role-workspace admin-workspace accounts-workspace">{admin && <PeopleNav />}
    <PageHeader title={admin ? "Members" : "Link requests"} />{!admin && <DocumentTitle heading="Link requests" />}
    {productName && <p className="people-note">An account keeps a person’s saved readings, place in Learn to lein, preferred commentaries and settings. Everything else on <bdi dir="auto">{productName}</bdi> is open without one.</p>}
    {message && <p className={message.tone === "alert" ? "request-error roster-message" : "workspace-notice roster-message"} role={message.tone}>{message.text}</p>}
    {message?.signIn && <p><WorkspaceLink href="/">Check account and sign in again</WorkspaceLink></p>}
    {loading && !requests ? <p role="status">Loading link requests…</p>
      : broken || !requests ? <div className="admin-state" role="alert"><p>Link requests couldn’t be loaded.</p><Button onClick={() => void load()}>Reload</Button></div>
      : <>
        <section className="people-card" aria-labelledby="accounts-requests"><div className="people-card-head"><h2 id="accounts-requests">Link requests</h2>
          <p>Approving gives the person an account and sends them one email. Declining removes the request and sends nothing.</p>
          <p>{APPROVER_HELP_LINE}</p>
          <p data-testid="approver-parent-line">{APPROVER_PARENT_LINE}</p></div>
          {requests.length ? <ul className="people-list">{requests.map(row => <li key={row.id} className="people-row account-request-row">
            <span className="people-avatar" aria-hidden="true">{initial(row.name)}</span>
            <div className="people-body">
              <h3><bdi dir="auto">{row.name}</bdi></h3>
              {row.purpose && <p className="people-status"><bdi dir="auto">{row.purpose}</bdi></p>}
              <p className="people-status">{row.email && <><bdi dir="ltr">{row.email}</bdi> · </>}asked <time dateTime={row.requestedAt}>{day(row.requestedAt)}</time>{row.student && <> · asked for <bdi dir="auto">{studentLabel(row.student)}</bdi></>}</p>
            </div>
            <div className="people-actions">
              {confirming === `decline:${row.id}` ? <>
                <p className="field-help">Decline removes this request and sends nothing.</p>
                <button type="button" className="roster-action roster-danger" aria-label={`Decline request: ${row.name}`} disabled={pending} onClick={() => void decline(row)}>Decline request</button>
                <button type="button" className="roster-action" aria-label={`Keep request: ${row.name}`} disabled={pending} onClick={() => setConfirming(null)}>Keep</button>
              </> : <>
                {students.length > 0 && <label className="accounts-link-target"><span className="field-help">Student</span>
                  <select aria-label={`Student for: ${row.name}`} value={chosen[row.id] ?? ""} disabled={pending || confirming !== null} onChange={event => setChosen(current => ({ ...current, [row.id]: event.target.value }))}>
                    <option value="">Choose a student</option>
                    {students.map(option => <option key={option.id} value={option.id}>{studentLabel(option)} · {option.ceremonyDate}</option>)}
                  </select></label>}
                <button type="button" className="roster-action" aria-label={`Approve and link: ${row.name}`} disabled={pending || confirming !== null || !chosen[row.id]} onClick={() => void approve(row, chosen[row.id])}>Approve and link</button>
                <button type="button" className="roster-action" aria-label={`Approve without linking: ${row.name}`} disabled={pending || confirming !== null} onClick={() => void approve(row)}>Approve without linking</button>
                <button type="button" className="roster-action people-danger" aria-label={`Decline: ${row.name}`} disabled={pending || confirming !== null} onClick={() => { setMessage(null); setConfirming(`decline:${row.id}`); }}>Decline</button>
              </>}
            </div>
          </li>)}</ul> : <p className="people-empty">No link requests are waiting.</p>}
        </section>
        {admin && members && <section className="people-card" aria-labelledby="accounts-members"><div className="people-card-head"><h2 id="accounts-members">Members</h2>
          <p>Approved accounts. Ending one stops that person’s saved readings here; what they saved is kept.</p></div>
          {members.length ? <ul className="people-list">{members.map(row => <li key={row.id} className="people-row">
            <span className="people-avatar" aria-hidden="true">{initial(row.name)}</span>
            <div className="people-body"><h3><bdi dir="auto">{row.name}</bdi></h3><p className="people-status">Member since <time dateTime={row.since}>{day(row.since)}</time></p></div>
            <div className="people-actions">
              {confirming === `end:${row.id}` ? <>
                <button type="button" className="roster-action roster-danger" aria-label={`End membership now: ${row.name}`} disabled={pending} onClick={() => void end(row)}>End membership</button>
                <button type="button" className="roster-action" aria-label={`Keep membership: ${row.name}`} disabled={pending} onClick={() => setConfirming(null)}>Keep</button>
              </> : <button type="button" className="roster-action people-danger" aria-label={`End membership: ${row.name}`} disabled={pending || confirming !== null} onClick={() => { setMessage(null); setConfirming(`end:${row.id}`); }}>End membership</button>}
            </div>
          </li>)}</ul> : <p className="people-empty">No approved accounts yet.</p>}
        </section>}
        {admin && approvers && <section className="people-card" aria-labelledby="accounts-approvers"><div className="people-card-head"><h2 id="accounts-approvers">Approvers</h2>
          <p>Admins approve requests. You can also choose tutors to approve them.</p></div>
          {approvers.designated.length ? <ul className="people-list">{approvers.designated.map(row => <li key={row.id} className="people-row">
            <span className="people-avatar" aria-hidden="true">{initial(row.name)}</span>
            <div className="people-body"><h3><bdi dir="auto">{row.name}</bdi></h3><p className="people-status">Tutor · approves account requests</p></div>
            <div className="people-actions"><button type="button" className="roster-action people-danger" aria-label={`Remove approver: ${row.name}`} disabled={pending} onClick={() => void remove(row.id, row.name)}>Remove</button></div>
          </li>)}</ul> : <p className="people-empty">No tutor approves requests yet.</p>}
          {approvers.candidates.length > 0 && <form className="accounts-add" onSubmit={event => { event.preventDefault(); void add(); }}>
            <label htmlFor={selectId}>Add an approver</label>
            <div className="accounts-add-row">
              <select id={selectId} value={candidate} disabled={pending} onChange={event => setCandidate(event.target.value)}>
                {approvers.candidates.map(row => <option key={row.tutorGrantId} value={row.tutorGrantId}>{row.name}</option>)}
              </select>
              <Button type="submit" disabled={pending || !candidate}>Add</Button>
            </div>
          </form>}
        </section>}
      </>}
  </section>;
}

/** "Link requests (n) · Review" for approvers, only while some wait. Quiet when none do or when it can't tell. */
export function AccountRequestsLine({ mode }: { mode: ApproverMode }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    accountsApi.summary(mode, controller.signal).then(value => { if (!controller.signal.aborted) setCount(value); }, () => { if (!controller.signal.aborted) setCount(0); });
    return () => controller.abort();
  }, [mode]);
  return count > 0 ? <p className="accounts-line"><WorkspaceLink href="/workspace/accounts">Link requests ({count}) · Review</WorkspaceLink></p> : null;
}
