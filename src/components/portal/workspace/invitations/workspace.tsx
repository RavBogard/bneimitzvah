"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { workspaceApi, type RosterStudent } from "../api";
import { RequireRole, statusOf, useWorkspace, useWorkspaceModal, WorkspaceLink } from "../provider";
import { icons } from "../study/lift";
import { PeopleNav } from "../../shell/people-nav";
import { invitationApi, invitationTargetFingerprint, issueReview, INVITATION_PAGE_SIZE, type CopiedLink, type InviteDraft, type Invitation, type Receipt } from "./api";
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
  const [outcome, setOutcome] = useState<{ kind: "issue" | "reissue" | "revoke" | "copy"; receipt?: Receipt; unknown?: boolean; copied?: boolean } | null>(null);
  // A copied link the clipboard refused, shown once so it can be copied by hand; any other action clears it.
  const [manualCopy, setManualCopy] = useState<string | null>(null);
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
    if (review && snapshot && !loading && !matches(review, snapshot)) { setReview(null); setMessage("The person or student changed since you reviewed this, so nothing was sent. Reload and review again."); setBlocked(true); }
  }, [review, snapshot, loading]);
  // "Invite a parent" from a student's People page arrives with ?student=…&role=…. The draft is filled once,
  // only for an active student in the loaded roster, with that record's contact email. Nothing is sent until reviewed.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !snapshot) return; prefilled.current = true;
    const query = new URLSearchParams(window.location.search), role = query.get("role"), row = snapshot.students.find(value => value.id === query.get("student") && !value.disabledAt && !value.ceremonyDoneAt);
    if (!row || (role !== "parent" && role !== "student")) return;
    // Never replace anything the admin has already started.
    setDraft(current => current.email || current.studentId || current.role !== "parent" ? current : { role, studentId: row.id, email: (role === "parent" ? row.parentEmail : row.ownEmail) ?? "" });
  }, [snapshot]);
  function change(value: InviteDraft) { setDraft(value); setReview(null); if (!blocked) setMessage(""); }
  function reviewIssue() {
    if (!snapshot || loading || gate.current || blocked) return false;
    try { setReview({ kind: "issue", draft: { ...draft }, target: issueReview(draft, snapshot.students) }); setMessage(""); return true; }
    catch { setMessage("Choose an active student and a valid email for this role. A student’s invitation needs their own email, not their parent’s.");  return false; }
  }
  function reviewRow(kind: "reissue" | "revoke", row: Invitation, opener: HTMLElement) {
    if (gate.current || blocked || loading || !snapshot) return; origin.current = opener; setReview({ kind, row, fingerprint: invitationTargetFingerprint(row, snapshot.students) }); setMessage("");
  }
  async function reloadExplicitly() {
    if (gate.current) return; gate.current = true; setReview(null); setPending(true);
    try { await load(); if (alive.current) { setBlocked(false); setAccessError(false); setMessage("Invitations reloaded. Nothing was resent."); } }
    catch { if (alive.current) setMessage("Invitations couldn’t be loaded. Nothing was resent."); }
    finally { gate.current = false; if (alive.current) setPending(false); }
  }
  /**
   * "Copy link" (decision 12): tokens are stored hashed, so copying asks the server for a new link, and the old one
   * stops working. The clipboard is given the request's promise so the click still counts as the user's gesture.
   */
  async function copy(row: Invitation) {
    if (gate.current || blocked || loading || !snapshot || review) return;
    gate.current = true; setPending(true); setMessage(""); setAccessError(false); setOutcome(null); setManualCopy(null);
    let link: CopiedLink | undefined;
    try {
      const requested = invitationApi.copyLink(row.id);
      let clipboard: Promise<void> | null = null;
      try {
        clipboard = typeof ClipboardItem === "function" && navigator.clipboard?.write
          ? navigator.clipboard.write([new ClipboardItem({ "text/plain": requested.then(value => new Blob([value.url], { type: "text/plain" })) })]) : null;
      } catch { clipboard = null; }
      link = await requested;
      let copied = false;
      try { if (clipboard) await clipboard; else await navigator.clipboard.writeText(link.url); copied = true; } catch { copied = false; }
      if (!alive.current) return;
      setOutcome({ kind: "copy", copied }); if (!copied) setManualCopy(link.url);
      try { await load(); } catch { if (alive.current) { setBlocked(true); setMessage("Done, but the list couldn’t be refreshed. Reload before anything else."); } }
    } catch (error) {
      if (!alive.current) return;
      const status = statusOf(error); setBlocked(true);
      if ([400, 401, 403, 404, 409, 429].includes(status)) {
        setAccessError(status === 401 || status === 403);
        setMessage(status === 401 || status === 403 ? "This isn’t allowed right now. You may need to sign in again, or the person may not be eligible. Check your account, then reload and review again."
          : "The invitation was rejected or has changed. Reload before reviewing again.");
      } else { setOutcome({ kind: "copy", unknown: true }); setMessage("We couldn’t confirm whether this went through. It may have. Reload before trying again; nothing is retried automatically."); }
    } finally { gate.current = false; if (alive.current) setPending(false); }
  }
  async function confirm() {
    if (gate.current || !review || !snapshot || !valid || blocked) return;
    gate.current = true; const action = review; let submitted = false;
    setPending(true); setMessage(""); setAccessError(false); setOutcome(null); setManualCopy(null);
    try {
      const fresh = await load();
      if (!alive.current) return;
      if (!matches(action, fresh)) { setBlocked(true); setReview(null); setMessage("The person or student changed since you reviewed this, so nothing was sent. Reload and review again."); return; }
      submitted = true;
      let result: Receipt | undefined;
      if (action.kind === "revoke") await invitationApi.revoke(action.row.id);
      else result = action.kind === "issue" ? await invitationApi.issue(action.target.selection) : await invitationApi.reissue(action.row.id);
      if (!alive.current) return;
      setReview(null); setOutcome({ kind: action.kind, receipt: result });
      if (result?.delivery === "unknown") setBlocked(true);
      try { await load(); } catch { if (alive.current) { setBlocked(true); setMessage("Done, but the list couldn’t be refreshed. Reload before anything else."); } }
    } catch (error) {
      if (!alive.current) return;
      const status = statusOf(error); setReview(null); setBlocked(true);
      if (!submitted) setMessage("This couldn’t be checked, so nothing was sent. Reload before reviewing again.");
      else if ([400, 401, 403, 404, 409, 429].includes(status)) {
        setAccessError(status === 401 || status === 403);
        setMessage(status === 401 || status === 403 ? "This isn’t allowed right now. You may need to sign in again, or the person may not be eligible. Check your account, then reload and review again."
          : "The invitation was rejected or has changed. Reload before reviewing again.");
      } else { setOutcome({ kind: action.kind, unknown: true }); setMessage("We couldn’t confirm whether this went through. It may have. Reload before trying again; nothing is retried automatically."); }
    } finally { gate.current = false; if (alive.current) setPending(false); }
  }
  function page(next: boolean) {
    if (pending || loading || blocked || !snapshot) return; setReview(null);
    if (next && snapshot.rows.length === INVITATION_PAGE_SIZE) setCursors(previous => [...previous, snapshot.rows[snapshot.rows.length - 1].id]);
    else if (!next && cursors.length > 1) setCursors(previous => previous.slice(0, -1));
  }
  // The review is a sheet over the page; the button that opened it gets focus back once the action and its reload settle.
  const sheet = useRef<HTMLDialogElement>(null), origin = useRef<HTMLElement | null>(null), pageHeading = useRef<HTMLHeadingElement>(null);
  const sheetShown = useWorkspaceModal(sheet, Boolean(review));
  const shown = useRef({ sheetShown, pending }); shown.current = { sheetShown, pending };
  useLayoutEffect(() => { if (sheetShown) document.getElementById("invite-action-title")?.focus(); }, [sheetShown, review]);
  useEffect(() => {
    if (review || pending || loading || !origin.current) return;
    const opener = origin.current; origin.current = null;
    (opener.isConnected && !(opener as HTMLButtonElement).disabled ? opener : pageHeading.current)?.focus();
  }, [review, pending, loading]);
  useLayoutEffect(() => {
    if (!pending) return;
    const block = (event: KeyboardEvent) => { if (event.key === "Escape" && sheet.current?.open) event.preventDefault(); };
    document.addEventListener("keydown", block, true); return () => document.removeEventListener("keydown", block, true);
  }, [pending]);
  // A second Escape can close a dialog without a cancel event: keep it open while sending, otherwise drop the review.
  function sheetClosed() { const now = shown.current; if (!now.sheetShown) return; if (now.pending || gate.current) sheet.current?.showModal(); else setReview(null); }
  // Remember the opener only when a review actually opens, so a refused draft never pulls focus later.
  function openIssue() { if (reviewIssue()) origin.current = document.querySelector<HTMLElement>(".invitation-review-button"); }
  const outcomeText = outcome && (outcome.unknown ? "We couldn’t confirm whether the last action went through. Reload to see what was recorded; don’t treat it as a resend."
    : outcome.kind === "revoke" ? "Invitation revoked. The link no longer works."
    // Daniel, N22: shown once the clipboard has the new link.
    : outcome.kind === "copy" && outcome.copied ? "Link copied."
    : outcome.kind === "reissue" || outcome.kind === "copy" ? "A new invitation replaced the old one. The old link no longer works; the new one may be on another page."
    : "Invitation created. It may be on another page of the list.");
  const mailText = outcome?.receipt && (outcome.receipt.delivery === "sent" ? "The email went to the mail service. We can’t see whether it reached their inbox."
    : outcome.receipt.delivery === "failed" ? "The email failed to send. Nothing is resent automatically; use Send again if you want to try once more."
    : "We couldn’t confirm whether the email went out. Nothing is resent automatically.");
  return <section className="role-workspace invitation-workspace admin-workspace"><PeopleNav />
    <div className="admin-head"><h1 ref={pageHeading} tabIndex={-1}>Invitations</h1>{!blocked && <button type="button" className="hero-icon roster-reload" aria-label="Reload invitations" disabled={pending || loading} onClick={() => void reloadExplicitly()}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}</div>
    <InvitationForm draft={draft} change={change} students={snapshot?.students ?? []} ready={Boolean(snapshot && !loading && !failure)} pending={pending} blocked={blocked} review={openIssue} />
    {message && !review && <p className={blocked ? "request-error roster-message" : "workspace-notice roster-message"} role={blocked ? "alert" : "status"}>{message}</p>}
    {blocked && <button type="button" className="button-secondary admin-pill roster-reload-inline" disabled={pending || loading} onClick={() => void reloadExplicitly()}>Reload invitations</button>}
    {accessError && <p><WorkspaceLink href="/">Check account and sign in again</WorkspaceLink></p>}
    {outcome && <section className={`invitation-outcome${outcome.unknown || outcome.receipt?.delivery === "failed" ? " invitation-outcome-warn" : ""}`} aria-label="Latest invitation action" role="status"><p className="invitation-outcome-title">{outcomeText}</p>{mailText && <p>{mailText}</p>}{manualCopy && <label className="field invitation-copied-link">Copy link<input data-testid="invite-copied-link" readOnly value={manualCopy} onFocus={event => event.currentTarget.select()} /></label>}</section>}
    <section className="invitation-list-section" aria-labelledby="invite-list-title"><div className="people-card-head invitation-list-head"><h2 id="invite-list-title">Sent invitations</h2><p>An invitation isn’t access. Once someone accepts, they appear on the student’s People page, or under Tutors.</p></div>
      {loading ? <p role="status">Checking current invitation records…</p> : failure ? <div className="admin-state" role="alert"><p>The invitations or the student list couldn’t be loaded, so none of it is shown.</p><button className="button-secondary admin-pill" disabled={pending} onClick={() => void reloadExplicitly()}>Reload</button></div>
        : snapshot && <>{snapshot.rows.length ? <div className="people-card"><InvitationList rows={snapshot.rows} pending={pending} blocked={blocked} select={reviewRow} copy={row => void copy(row)} /></div> : <div className="admin-empty"><p className="admin-empty-title">No invitations{cursors.length > 1 ? " on this page" : " yet"}</p><p>Invitations you send appear here with their status.</p></div>}
          {(cursors.length > 1 || snapshot.rows.length === INVITATION_PAGE_SIZE) && <nav className="roster-pages" aria-label="Invitation pages"><span className="roster-count">Page {cursors.length}</span><button className="button-secondary admin-pill" disabled={pending || blocked || cursors.length === 1} onClick={() => page(false)}>Previous invitations</button><button className="button-secondary admin-pill" disabled={pending || blocked || snapshot.rows.length < INVITATION_PAGE_SIZE} onClick={() => page(true)}>Next invitations</button></nav>}</>}
    </section>
    <dialog ref={sheet} className="roster-sheet access-sheet" aria-labelledby="invite-action-title" closedby={pending ? "none" : "closerequest"} onCancel={event => { event.preventDefault(); if (!pending) setReview(null); }} onClose={sheetClosed}>
      <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close invitation review" disabled={pending} onClick={() => setReview(null)}>{icons.close}</button></div>
      {review && <InvitationActionReview review={review} valid={valid && !blocked} pending={pending} confirm={() => void confirm()} cancel={() => setReview(null)} />}
    </dialog>
  </section>;
}
