"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RequireRole, statusOf, useWorkspace, useWorkspaceModal, WorkspaceLink } from "../provider";
import { ceremonyCountdown } from "../reading";
import { icons } from "../study/lift";
import { PeopleNav } from "../../shell/people-nav";
import { identityLabels, makeReview, relationshipApi, type Action, type Relationships, type Review, type Tutor } from "./api";
import { AccessReview } from "./review";
import { staffApi, type Teaching } from "../staff/api";
import { teachesLine } from "../staff/model";
import { PageHeader } from "../../../ui";

// teaching: on the Tutors page, each tutor's current students (1.9 N15, G11), or null where it isn't read or couldn't be.
type Snapshot = { relationships: Relationships | null; tutors: Tutor[]; teaching: Map<string, Teaching["students"]> | null };
/** A roster button's visible words, and its accessible name, which begins with them (WCAG 2.5.3) and then says whom it removes. */
export const removeText = (firstName: string) => `Remove from ${firstName}`;
export const removeLabel = (firstName: string, name: string) => `${removeText(firstName)}: ${name}`;
export function AdminAccessWorkspace({ studentId }: { studentId?: string }) { return <RequireRole role="admin"><Access key={studentId ?? "tutors"} studentId={studentId} /></RequireRole>; }
function Access({ studentId }: { studentId?: string }) {
  const { registerReload } = useWorkspace();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), cursor = cursors[cursors.length - 1];
  const [selected, setSelected] = useState(""), [review, setReview] = useState<Review | null>(null), [pending, setPending] = useState(false), [blocked, setBlocked] = useState(false), [message, setMessageText] = useState(""), [messageKind, setMessageKind] = useState("");
  const setMessage = useCallback((text: string, kind = "") => { setMessageText(text); setMessageKind(kind); }, []);
  // G11: the tutor chosen to take over a departing tutor's students, and the students the review listed.
  const [destination, setDestination] = useState(""), [handOverIds, setHandOverIds] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null), sequence = useRef(0), alive = useRef(true), latch = useRef(false), mutation = useRef<Promise<void> | null>(null);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(), turn = ++sequence.current; request.current = controller; setLoading(true); setFailed(false);
    try {
      const [relationships, tutors, teaching] = await Promise.all([studentId ? relationshipApi.inspect(studentId, controller.signal) : Promise.resolve(null), relationshipApi.tutors(cursor, controller.signal),
        studentId ? Promise.resolve(null) : staffApi.teaching(controller.signal).catch(() => null)]);
      if (controller.signal.aborted || turn !== sequence.current || !alive.current) throw new Error("Access read replaced");
      const next = { relationships, tutors, teaching: teaching ? new Map(teaching.map(row => [row.tutorGrantId, row.students])) : null }; setSnapshot(next); return next;
    } catch (error) { if (!controller.signal.aborted && turn === sequence.current && alive.current) { setSnapshot(null); setReview(null); setFailed(true); } throw error; }
    finally { if (!controller.signal.aborted && turn === sequence.current && alive.current) setLoading(false); }
  }, [studentId, cursor]);
  useEffect(() => registerReload(async () => { if (mutation.current) await mutation.current; await load(); }), [registerReload, load]);
  useEffect(() => { alive.current = true; void load().catch(() => undefined); return () => { alive.current = false; sequence.current++; request.current?.abort(); }; }, [load]);
  useEffect(() => {
    if (!review || !snapshot || loading) return;
    try { if (makeReview(review.action, snapshot.relationships, snapshot.tutors).fingerprint === review.fingerprint) return; } catch { /* Reviewed identity left the authorized view. */ }
    setReview(null); setMessage("Something changed for this person since you opened the review. Check the current access and try again.", "changed");
  }, [snapshot, review, loading]);
  function choose(action: Action) {
    if (!snapshot || pending || blocked || loading) return;
    try { setReview(makeReview(action, snapshot.relationships, snapshot.tutors)); setMessage(""); setDestination(""); setHandOverIds(departing(action, snapshot).map(row => row.id)); }
    catch { setReview(null); setMessage("That change isn’t available for the current access. Reload access to check it.", "unavailable"); }
  }
  function confirm() {
    if (latch.current || !review || blocked) return;
    latch.current = true; setPending(true); setMessage(""); const checked = review;
    const operation = (async () => {
      let posted = false;
      try {
        const fresh = await load(); if (!alive.current) return;
        let current: Review; try { current = makeReview(checked.action, fresh.relationships, fresh.tutors); } catch { throw new Error("Reviewed target changed"); }
        if (current.fingerprint !== checked.fingerprint) { setReview(null); setMessage("Something changed for this person since you opened the review. Check the current access and try again.", "changed"); return; }
        // G11: the reviewed students must still be exactly the tutor's students; the server checks the same in its transaction.
        const moving = destination && handOverIds.length ? departing(checked.action, fresh).map(row => row.id) : [];
        if (moving.length && (moving.length !== handOverIds.length || moving.some((id, i) => id !== handOverIds[i]) || !fresh.tutors.some(row => row.id === destination))) {
          setReview(null); setMessage("Something changed for this person since you opened the review. Check the current access and try again.", "changed"); return;
        }
        posted = true;
        if (moving.length) await staffApi.handOver({ id: current.grantId, revision: Number(current.body.expectedRevision) }, destination, moving);
        else await relationshipApi.mutate(current);
        if (!alive.current) return;
        setReview(null); setSelected("");
        try { await load(); if (alive.current) setMessage("Saved. Access is up to date.", "saved"); }
        catch { if (alive.current) { setBlocked(true); setMessage("Saved, but the current access couldn’t be refreshed. Reload access before another change.", "saved-stale"); } }
      } catch (error) {
        if (!alive.current) return; setReview(null); setBlocked(true);
        const status = statusOf(error);
        if ([401, 403, 404].includes(status)) { setSnapshot(null); setFailed(true); setMessage("This change isn’t allowed any more. Reload access, or check your account and sign in again.", "denied"); }
        else if (status === 409 || !posted) setMessage("The current access couldn’t be confirmed. Reload access and review again before saving.", "unchecked");
        else setMessage("We couldn’t confirm whether this change saved. Reload access and check before trying again.", "unconfirmed");
      } finally { latch.current = false; if (alive.current) setPending(false); }
    })(); mutation.current = operation; void operation.finally(() => { if (mutation.current === operation) mutation.current = null; });
  }
  async function reload() { if (pending) return; setReview(null); try { await load(); if (alive.current) { setBlocked(false); setMessage("Access reloaded.", "reloaded"); } } catch { /* Load supplies the unavailable state. */ } }
  const data = snapshot?.relationships, disabled = pending || blocked || loading || failed;
  const available = snapshot?.tutors.filter(row => !data?.tutors.some(link => link.tutorGrantId === row.id)) ?? [];
  const tutorLabels = identityLabels(snapshot?.tutors ?? []), pickerLabels = identityLabels(available);
  const linkedTutorLabels = identityLabels(data?.tutors.map(row => ({ id: row.tutorGrantId, displayName: row.displayName })) ?? []);
  const parentLabels = identityLabels(data?.guardians.map(row => ({ id: row.parentGrantId, displayName: row.displayName })) ?? []);
  const studentLabels = identityLabels(data?.identities.map(row => ({ id: row.studentGrantId, displayName: row.displayName })) ?? []);
  // The confirm step is a sheet over the page; the action that opened it gets focus back.
  const sheet = useRef<HTMLDialogElement>(null), origin = useRef<HTMLElement | null>(null);
  const sheetShown = useWorkspaceModal(sheet, Boolean(review));
  // showModal focuses the close button, so the heading is focused here, after the hook has shown the sheet.
  useLayoutEffect(() => { if (sheetShown) document.getElementById("access-review-heading")?.focus(); }, [sheetShown, review]);
  // Once the change and its reload settle, focus returns to the action that opened the review, or to the page heading if it is gone or disabled.
  const pageHeading = useRef<HTMLHeadingElement>(null);
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
  const shown = useRef({ sheetShown, pending }); shown.current = { sheetShown, pending };
  function sheetClosed() { const now = shown.current; if (!now.sheetShown) return; if (now.pending || latch.current) sheet.current?.showModal(); else setReview(null); }
  const open = (action: Action) => (event: { currentTarget: HTMLElement }) => { origin.current = event.currentTarget; choose(action); };
  // Row actions say whose access they change, so the visible verb is never ambiguous to a screen reader.
  const act = (label: string, name: string, action: Action, danger = false, off = false) => <button className={`roster-action${danger ? " people-danger" : ""}`} aria-label={`${label} ${name}`} disabled={disabled || off} onClick={open(action)}>{label}</button>;
  // Removing someone from this student is the ordinary row action; it names the student so its scope is visible before the review.
  const remove = (name: string, action: Action) => <button className="roster-action" aria-label={removeLabel(data!.student.firstName, name)} disabled={disabled} onClick={open(action)}>{removeText(data!.student.firstName)}</button>;
  const person = (name: string, status: ReactNode, actions: ReactNode, key: string) => <li key={key} className="people-row">
    <span className="people-avatar" aria-hidden="true">{initial(name)}</span>
    <div className="people-body"><h3><bdi dir="auto">{name}</bdi></h3><p className="people-status">{status}</p></div>
    <div className="people-actions">{actions}</div>
  </li>;
  const calm = message === "Saved. Access is up to date." || message === "Access reloaded.";
  return <section className="role-workspace access-workspace admin-workspace">{!studentId && <PeopleNav />}{studentId && <div className="admin-crumbs"><WorkspaceLink href={`/workspace/admin/students/${studentId}/reading`}>Student page</WorkspaceLink></div>}
    <PageHeader title={studentId ? "People and access" : "Tutors"} titleRef={pageHeading}
      description={data ? <><bdi dir="auto">{data.student.firstName} {data.student.lastName}</bdi> · <time dateTime={data.student.ceremonyDate}>{ceremonyCountdown(data.student.ceremonyDate).label}</time>{data.student.disabled && <> <span className="roster-chip">Disabled</span></>}</>
        : !studentId ? "Tutors join by invitation. Assign them to students from each student’s People page." : undefined}
      actions={!failed ? <button type="button" className="hero-icon roster-reload" aria-label="Reload access" disabled={pending || loading} onClick={() => void reload()}>{reloadIcon}</button> : undefined} />
    {data?.student.disabled && <p className="people-note">This student is disabled. Nobody can use their access; existing links can still be removed.</p>}
    {message && !review && <p data-testid="access-message" data-message-kind={messageKind} className={calm ? "workspace-notice roster-message" : "request-error roster-message"} role={blocked ? "alert" : "status"}>{message}</p>}
    {loading ? <p role="status" data-testid="access-loading">Checking current access…</p> : failed ? <div className="admin-state" role="alert"><h2>Access unavailable</h2><p>Current access couldn’t be loaded, so none of it is shown.</p><div className="form-actions"><button className="button-secondary admin-pill" disabled={pending || loading} onClick={() => void reload()}>Reload access</button><WorkspaceLink className="button-text" href="/">Check account and sign in again</WorkspaceLink></div></div> : snapshot && <>
      {data ? <>
        {!data.student.disabled && <SetupSummary data={data} />}
        <section className="people-card" data-testid="people-tutors" aria-labelledby="people-tutors"><div className="people-card-head"><h2 id="people-tutors">Tutors</h2><p>Can open this student’s reading, service parts and lessons.</p></div>
          {data.tutors.length ? <ul className="people-list">{data.tutors.map(row => person(linkedTutorLabels.get(row.tutorGrantId)!, <>{row.effectiveRead ? "Can teach this student" : "Access paused"}{row.isCantor && <span className="roster-chip">Cantor</span>}</>,
            remove(linkedTutorLabels.get(row.tutorGrantId)!, { kind: "link", group: "tutors", linkId: row.id }), row.id))}</ul>
            : <p className="people-empty">No tutor assigned yet.</p>}
          <div className="people-assign"><label htmlFor="access-tutor">Tutor to assign</label><div className="people-assign-row"><select id="access-tutor" disabled={disabled || data.student.disabled} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a tutor</option>{available.map(row => <option key={row.id} value={row.id}>{pickerLabels.get(row.id)}{row.isCantor ? " · Cantor" : ""}</option>)}</select>
            <button className="button-secondary admin-pill" disabled={disabled || data.student.disabled || !selected} onClick={open({ kind: "assign", grantId: selected })}>Assign</button></div>
            {!available.length && <p className="field-help">Every tutor on this page is already assigned. Invite a new tutor from Invitations.</p>}</div>
        </section>
        <section className="people-card" data-testid="people-parents" aria-labelledby="people-parents"><div className="people-card-head"><h2 id="people-parents">Parents</h2><p>Can read this student’s work. Practicing as the child is a separate permission.</p></div>
          {data.guardians.length ? <ul className="people-list">{data.guardians.map(row => person(parentLabels.get(row.parentGrantId)!, <>{row.effectiveRead ? "Can read" : "Access paused"} · {row.practiceEnabled ? (row.effectivePractice ? "Can practice as the child" : "Child practice allowed but unavailable") : "Child practice stopped"}</>,
            <>{act(row.practiceEnabled ? "Stop child practice" : "Allow child practice", parentLabels.get(row.parentGrantId)!, { kind: "practice", linkId: row.id, enabled: !row.practiceEnabled }, false, !row.practiceEnabled && (!row.effectiveRead || data.student.disabled))}
              {remove(parentLabels.get(row.parentGrantId)!, { kind: "link", group: "guardians", linkId: row.id })}</>, row.id))}</ul>
            : <p className="people-empty">No parent linked yet.</p>}
          {!data.student.disabled && <WorkspaceLink className="button-secondary admin-pill people-invite" href={`/workspace/admin/invitations?student=${encodeURIComponent(data.student.id)}&role=parent`}>Invite a parent</WorkspaceLink>}
        </section>
        <section className="people-card" data-testid="people-students" aria-labelledby="people-students"><div className="people-card-head"><h2 id="people-students">Student sign-in</h2><p>The student’s own account. A parent practicing as the child doesn’t need one.</p></div>
          {data.identities.length ? <ul className="people-list">{data.identities.map(row => person(studentLabels.get(row.studentGrantId)!, row.effectivePractice ? "Can sign in and practice" : "Access paused",
            remove(studentLabels.get(row.studentGrantId)!, { kind: "link", group: "identities", linkId: row.id }), row.id))}</ul>
            : <p className="people-empty">No student sign-in linked.</p>}
          {!data.student.disabled && <WorkspaceLink className="button-secondary admin-pill people-invite" href={`/workspace/admin/invitations?student=${encodeURIComponent(data.student.id)}&role=student`}>Invite the student</WorkspaceLink>}
        </section>
        {data.tutors.length + data.guardians.length + data.identities.length > 0 && <details className="people-card people-wider">
          <summary data-testid="congregation-removal-toggle">Remove someone across the congregation</summary>
          <p>Only for someone who should stop being a tutor, parent or student here altogether. They lose access to every student, not just <bdi dir="auto">{data.student.firstName}</bdi>. To change only <bdi dir="auto">{data.student.firstName}</bdi>’s access, use the buttons above.</p>
          <section aria-label="Congregation-wide removal" data-testid="people-congregation"><ul className="people-list">
            {data.tutors.map(row => person(linkedTutorLabels.get(row.tutorGrantId)!, "Tutor", act("Remove as a tutor", linkedTutorLabels.get(row.tutorGrantId)!, { kind: "grant", group: "tutors", linkId: row.id, grantId: row.tutorGrantId }, true), `wider-${row.id}`))}
            {data.guardians.map(row => person(parentLabels.get(row.parentGrantId)!, "Parent", act("Remove as a parent", parentLabels.get(row.parentGrantId)!, { kind: "grant", group: "guardians", linkId: row.id, grantId: row.parentGrantId }, true), `wider-${row.id}`))}
            {data.identities.map(row => person(studentLabels.get(row.studentGrantId)!, "Student sign-in", act("Remove as a student", studentLabels.get(row.studentGrantId)!, { kind: "grant", group: "identities", linkId: row.id, grantId: row.studentGrantId }, true), `wider-${row.id}`))}
          </ul></section>
        </details>}
      </> : snapshot.tutors.length ? <section className="people-card" data-testid="people-tutors" aria-labelledby="tutors-list-heading"><h2 id="tutors-list-heading" className="sr-only">Tutors</h2><ul className="people-list">{snapshot.tutors.map(row => person(tutorLabels.get(row.id)!, <>{row.isCantor ? <span className="roster-chip">Cantor</span> : "Tutor"}{snapshot.teaching ? <span className="tutor-teaches" data-testid="tutor-teaches">{snapshot.teaching.get(row.id)?.length ? <bdi dir="auto">{teachesLine(snapshot.teaching.get(row.id)!.map(student => student.firstName))}</bdi> : "No students yet."}</span> : null}</>,
          <>{act(row.isCantor ? "Remove cantor flag" : "Mark as cantor", tutorLabels.get(row.id)!, { kind: "cantor", grantId: row.id, enabled: !row.isCantor })}{act("Remove as a tutor", tutorLabels.get(row.id)!, { kind: "grant", grantId: row.id }, true)}</>, row.id))}</ul></section>
        : <div className="admin-empty" data-testid="tutors-empty"><p className="admin-empty-title">No tutors yet</p><p>Invite a tutor from Invitations. They appear here once they accept.</p></div>}
      {(cursors.length > 1 || snapshot.tutors.length === 100) && <nav className="roster-pages" aria-label="Tutor pages"><button className="button-secondary admin-pill" disabled={disabled || cursors.length === 1} onClick={() => { setReview(null); setSelected(""); setCursors(previous => previous.slice(0, -1)); }}>Previous tutor page</button><button className="button-secondary admin-pill" disabled={disabled || snapshot.tutors.length !== 100} onClick={() => { setReview(null); setSelected(""); setCursors(previous => [...previous, snapshot.tutors[snapshot.tutors.length - 1].id]); }}>Next tutor page</button></nav>}
    </>}
    <dialog ref={sheet} className="roster-sheet access-sheet" aria-labelledby="access-review-heading" closedby={pending ? "none" : "closerequest"} onCancel={event => { event.preventDefault(); if (!pending) setReview(null); }} onClose={sheetClosed}>
      <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close access review" disabled={pending} onClick={() => setReview(null)}>{icons.close}</button></div>
      {review && <AccessReview review={review} pending={pending} confirm={confirm} cancel={() => setReview(null)}
        handOver={snapshot && handOverIds.length ? { names: departing(review.action, snapshot).map(student => student.firstName), value: destination, onChange: setDestination,
          options: snapshot.tutors.filter(row => row.id !== review.grantId).map(row => ({ id: row.id, label: tutorLabels.get(row.id) ?? row.displayName })) } : undefined} />}
    </dialog>
  </section>;
}

// What is set up for this student and what still needs doing. Saved contact emails are not access:
// a person has access only after they accept an invitation and appear on this page.
function SetupSummary({ data }: { data: Relationships }) {
  const first = data.student.firstName, id = encodeURIComponent(data.student.id);
  const teaching = data.tutors.filter(row => row.effectiveRead).length, reading = data.guardians.filter(row => row.effectiveRead).length, signIn = data.identities.some(row => row.effectivePractice);
  const focus = (target: string) => () => document.getElementById(target)?.focus();
  const items: { title: string; state: "Done" | "To do" | "Optional"; text: string; next?: ReactNode }[] = [
    { title: "Tutor", state: teaching ? "Done" : "To do", text: teaching ? `${teaching} ${teaching === 1 ? "tutor teaches" : "tutors teach"} ${first}.` : "Nobody teaches yet.",
      next: !teaching && <button type="button" className="button-text" onClick={focus("access-tutor")}>Choose a tutor</button> },
    { title: "Family access", state: reading ? "Done" : "To do", text: reading ? `${reading} ${reading === 1 ? "parent has" : "parents have"} accepted access.` : "No parent has accepted access yet. A parent email on the student record doesn’t give access by itself.",
      next: !reading && <WorkspaceLink className="button-text" href={`/workspace/admin/invitations?student=${id}&role=parent`}>Send a parent invitation</WorkspaceLink> },
    { title: "Student sign-in", state: signIn ? "Done" : "Optional", text: signIn ? `${first} signs in with their own account.` : "Not linked. A child can practice through a parent; an adult needs their own sign-in.",
      next: !signIn && <WorkspaceLink className="button-text" href={`/workspace/admin/invitations?student=${id}&role=student`}>Send the student an invitation</WorkspaceLink> },
  ];
  return <section className="people-card people-setup" aria-labelledby="people-setup"><div className="people-card-head"><h2 id="people-setup">Setup</h2>
    <p>An invitation gives access only once it is accepted; until then it stays under <WorkspaceLink href="/workspace/admin/invitations">Invitations</WorkspaceLink>. The reading is assigned on the <WorkspaceLink href={`/workspace/admin/students/${id}/reading`}>student page</WorkspaceLink>.</p></div>
    <ul className="people-setup-list">{items.map(item => <li key={item.title} data-state={item.state}><span className="people-setup-state">{item.state}</span><div><h3>{item.title}</h3><p>{item.text}</p>{item.next}</div></li>)}</ul>
  </section>;
}

/** The students a "Remove as a tutor" on the Tutors page would leave without this tutor (G11), in id order. */
function departing(action: Action, snapshot: Snapshot) {
  return action.kind === "grant" && !action.group && snapshot.teaching ? [...snapshot.teaching.get(action.grantId) ?? []].sort((a, b) => a.id.localeCompare(b.id)) : [];
}
const initial = (name: string) => (name.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "?").toLocaleUpperCase();
const reloadIcon = <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
