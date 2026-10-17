"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceApi, type RosterStudent } from "../api";
import { RequireRole, statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { AdminNav } from "../admin-nav";
import { invitationApi, invitationTargetFingerprint, issueReview, INVITATION_PAGE_SIZE, type InviteDraft, type Invitation, type Receipt } from "./api";
import { InvitationForm } from "./form";
import { InvitationList } from "./list";
import { InvitationActionReview, type InvitationReview } from "./review";

type Snapshot = { rows: Invitation[]; students: RosterStudent[] };
function matches(review: InvitationReview, data: Snapshot): boolean {
  if (review.kind === "issue") { try { return issueReview(review.draft, data.students).fingerprint === review.target.fingerprint; } catch { return false; } }
  const row = data.rows.find(row => row.id === review.row.id);
  return Boolean(row && invitationTargetFingerprint(row, data.students) === review.fingerprint && (row.status === "pending" || row.status === "expired"));
}
export function AdminInvitationsWorkspace() { return <RequireRole role="admin"><Invitations /></RequireRole>; }
function Invitations() {
  const { registerReload } = useWorkspace();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(true), [failure, setFailure] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), cursor = cursors[cursors.length - 1];
  const [draft, setDraft] = useState<InviteDraft>({ role: "parent", email: "", studentId: "" }), [review, setReview] = useState<InvitationReview | null>(null);
  const [pending, setPending] = useState(false), [blocked, setBlocked] = useState(false), [message, setMessage] = useState(""), [accessError, setAccessError] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: "issue" | "reissue" | "revoke"; receipt?: Receipt; unknown?: boolean } | null>(null);
  const request = useRef<AbortController | null>(null), generation = useRef(0), gate = useRef(false), alive = useRef(true);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; const turn = ++generation.current;
    setLoading(true); setFailure(false);
    try {
      const [rows, students] = await Promise.all([invitationApi.list(cursor, controller.signal), workspaceApi.roster(controller.signal)]);
      if (controller.signal.aborted || turn !== generation.current) throw new Error("Invitation read replaced");
      const data = { rows, students }; setSnapshot(data); return data;
    } catch (error) { if (!controller.signal.aborted && turn === generation.current) { setSnapshot(null); setFailure(true); } throw error; }
    finally { if (!controller.signal.aborted && turn === generation.current) setLoading(false); }
  }, [cursor]);
  useEffect(() => registerReload(async () => { await load(); }), [registerReload, load]);
  useEffect(() => { alive.current = true; void load().catch(() => undefined); return () => { alive.current = false; generation.current++; request.current?.abort(); }; }, [load]);
  const valid = Boolean(review && snapshot && !loading && !failure && matches(review, snapshot));
  useEffect(() => {
    if (review && snapshot && !loading && !matches(review, snapshot)) { setReview(null); setMessage("The reviewed target changed or left this page. Reload the records and review the current target again."); setBlocked(true); }
  }, [review, snapshot, loading]);
  // "Invite a parent" from a student's People page arrives with ?student=…&role=…. The draft is filled once,
  // only for an active student in the loaded roster, with that record's contact email. Nothing is sent until reviewed.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !snapshot) return; prefilled.current = true;
    const query = new URLSearchParams(window.location.search), role = query.get("role"), row = snapshot.students.find(value => value.id === query.get("student") && !value.disabledAt);
    if (!row || (role !== "parent" && role !== "student")) return;
    // Never replace anything the admin has already started.
    setDraft(current => current.email || current.studentId || current.role !== "parent" ? current : { role, studentId: row.id, email: (role === "parent" ? row.parentEmail : row.ownEmail) ?? "" });
  }, [snapshot]);
  function change(value: InviteDraft) { setDraft(value); setReview(null); if (!blocked) setMessage(""); }
  function reviewIssue() {
    if (!snapshot || loading || gate.current || blocked) return;
    try { setReview({ kind: "issue", draft: { ...draft }, target: issueReview(draft, snapshot.students) }); setMessage(""); }
    catch { setMessage("Choose an active student and a valid recipient for this role. Student invitations require a separate mailbox from the parent."); }
  }
  function reviewRow(kind: "reissue" | "revoke", row: Invitation) {
    if (gate.current || blocked || loading || !snapshot) return; setReview({ kind, row, fingerprint: invitationTargetFingerprint(row, snapshot.students) }); setMessage("");
  }
  async function reloadExplicitly() {
    if (gate.current) return; gate.current = true; setReview(null); setPending(true);
    try { await load(); if (alive.current) { setBlocked(false); setAccessError(false); setMessage("Current records reloaded. Review the current target before another action; no action was repeated."); } }
    catch { if (alive.current) setMessage("Current records could not be loaded. No invitation action was repeated."); }
    finally { gate.current = false; if (alive.current) setPending(false); }
  }
  async function confirm() {
    if (gate.current || !review || !snapshot || !valid || blocked) return;
    gate.current = true; const action = review; let submitted = false;
    setPending(true); setMessage(""); setAccessError(false); setOutcome(null);
    try {
      const fresh = await load();
      if (!alive.current) return;
      if (!matches(action, fresh)) { setBlocked(true); setReview(null); setMessage("The reviewed target changed or left this page. Reload the records and review the current target again."); return; }
      submitted = true;
      let result: Receipt | undefined;
      if (action.kind === "revoke") await invitationApi.revoke(action.row.id);
      else result = action.kind === "issue" ? await invitationApi.issue(action.target.selection) : await invitationApi.reissue(action.row.id);
      if (!alive.current) return;
      setReview(null); setOutcome({ kind: action.kind, receipt: result });
      if (result?.delivery === "unknown") setBlocked(true);
      try { await load(); } catch { if (alive.current) { setBlocked(true); setMessage("The server acknowledged the action, but current records could not be reloaded. Reload before another action."); } }
    } catch (error) {
      if (!alive.current) return;
      const status = statusOf(error); setReview(null); setBlocked(true);
      if (!submitted) setMessage("The reviewed target could not be verified. No invitation action was sent. Reload before reviewing again.");
      else if ([400, 401, 403, 404, 409, 429].includes(status)) {
        setAccessError(status === 401 || status === 403);
        setMessage(status === 401 || status === 403 ? "The action is not permitted. A fresh sign-in, current admin access or recipient eligibility may be required. Check your account, then reload and review again."
          : "The action was rejected or the invitation changed. Reload the current records before reviewing again.");
      } else { setOutcome({ kind: action.kind, unknown: true }); setMessage("The action outcome is unknown. It may have completed. Reload the records before another explicit review; no automatic retry will occur."); }
    } finally { gate.current = false; if (alive.current) setPending(false); }
  }
  function page(next: boolean) {
    if (pending || loading || blocked || !snapshot) return; setReview(null);
    if (next && snapshot.rows.length === INVITATION_PAGE_SIZE) setCursors(previous => [...previous, snapshot.rows[snapshot.rows.length - 1].id]);
    else if (!next && cursors.length > 1) setCursors(previous => previous.slice(0, -1));
  }
  return <section className="role-workspace invitation-workspace admin-workspace"><AdminNav /><h1>Invitations</h1>
    <p>Private congregation invitations. Lifecycle and mail outcome are separate: pending does not prove an invitation is currently redeemable. Acceptance always rechecks live recipient and student access.</p>
    <InvitationForm draft={draft} change={change} students={snapshot?.students ?? []} ready={Boolean(snapshot && !loading && !failure)} pending={pending} blocked={blocked} review={reviewIssue} />
    {message && <p className={blocked ? "request-error" : "field-help"} role={blocked ? "alert" : "status"}>{message}</p>}
    {accessError && <WorkspaceLink href="/">Check account and sign in again</WorkspaceLink>}
    {outcome && <section className="invitation-outcome" aria-label="Latest invitation action" role="status"><h2>Latest action</h2><p>{outcome.unknown ? "Request outcome unconfirmed. A reload may show a recorded change, but must not be treated as a resend."
      : outcome.kind === "revoke" ? "Revocation acknowledged by the server. Use the refreshed lifecycle below for the current record."
      : outcome.kind === "reissue" ? "Replacement invitation acknowledged by the server. Only the refreshed records establish the old invitation’s current lifecycle; the replacement may be on another page."
      : "Invitation creation acknowledged by the server. The new record may be on another page."}</p>
      {outcome.receipt && <p>{outcome.receipt.delivery === "sent" ? "Mail request accepted by the mail service; inbox receipt is not verified." : outcome.receipt.delivery === "failed" ? "Mail failure recorded. No resend will happen automatically; review a reissue if appropriate." : "Mail outcome unknown. The invitation was recorded, but the message may or may not have been sent. No automatic retry will occur."}</p>}
    </section>}
    {review && <InvitationActionReview review={review} valid={valid && !blocked} pending={pending} confirm={() => void confirm()} cancel={() => setReview(null)} />}
    <section className="invitation-list-section" aria-labelledby="invite-list-title"><div className="workspace-heading-row"><h2 id="invite-list-title">Invitation records</h2><button className="button-secondary" disabled={pending || loading} onClick={() => void reloadExplicitly()}>Reload invitations</button></div>
      {loading ? <p role="status">Checking current invitation records…</p> : failure ? <p role="alert">Invitation records or the complete student roster could not be loaded. No partial list is shown.</p>
        : snapshot && <><p>Page {cursors.length}. Up to {INVITATION_PAGE_SIZE} records ordered by invitation ID. Mail “unconfirmed” is not a background queue.</p>{snapshot.rows.length ? <InvitationList rows={snapshot.rows} pending={pending} blocked={blocked} select={reviewRow} /> : <p>No invitations on this page.</p>}
          <nav className="roster-pages" aria-label="Invitation pages"><button className="button-secondary" disabled={pending || blocked || cursors.length === 1} onClick={() => page(false)}>Previous invitations</button><button className="button-secondary" disabled={pending || blocked || snapshot.rows.length < INVITATION_PAGE_SIZE} onClick={() => page(true)}>Next invitations</button></nav></>}
    </section>
  </section>;
}
