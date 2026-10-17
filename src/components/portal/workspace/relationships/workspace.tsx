"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RequireRole, statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { AdminNav } from "../admin-nav";
import { identityLabels, makeReview, relationshipApi, type Action, type Relationships, type Review, type Tutor } from "./api";
import { AccessReview } from "./review";

type Snapshot = { relationships: Relationships | null; tutors: Tutor[] };
export function AdminAccessWorkspace({ studentId }: { studentId?: string }) { return <RequireRole role="admin"><Access key={studentId ?? "tutors"} studentId={studentId} /></RequireRole>; }
function Access({ studentId }: { studentId?: string }) {
  const { registerReload } = useWorkspace();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), cursor = cursors[cursors.length - 1];
  const [selected, setSelected] = useState(""), [review, setReview] = useState<Review | null>(null), [pending, setPending] = useState(false), [blocked, setBlocked] = useState(false), [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null), sequence = useRef(0), alive = useRef(true), latch = useRef(false), mutation = useRef<Promise<void> | null>(null);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(), turn = ++sequence.current; request.current = controller; setLoading(true); setFailed(false);
    try {
      const [relationships, tutors] = await Promise.all([studentId ? relationshipApi.inspect(studentId, controller.signal) : Promise.resolve(null), relationshipApi.tutors(cursor, controller.signal)]);
      if (controller.signal.aborted || turn !== sequence.current || !alive.current) throw new Error("Access read replaced");
      const next = { relationships, tutors }; setSnapshot(next); return next;
    } catch (error) { if (!controller.signal.aborted && turn === sequence.current && alive.current) { setSnapshot(null); setReview(null); setFailed(true); } throw error; }
    finally { if (!controller.signal.aborted && turn === sequence.current && alive.current) setLoading(false); }
  }, [studentId, cursor]);
  useEffect(() => registerReload(async () => { if (mutation.current) await mutation.current; await load(); }), [registerReload, load]);
  useEffect(() => { alive.current = true; void load().catch(() => undefined); return () => { alive.current = false; sequence.current++; request.current?.abort(); }; }, [load]);
  useEffect(() => {
    if (!review || !snapshot || loading) return;
    try { if (makeReview(review.action, snapshot.relationships, snapshot.tutors).fingerprint === review.fingerprint) return; } catch { /* Reviewed identity left the authorized view. */ }
    setReview(null); setMessage("The reviewed identity or access state changed. Review the current record again.");
  }, [snapshot, review, loading]);
  function choose(action: Action) {
    if (!snapshot || pending || blocked || loading) return;
    try { setReview(makeReview(action, snapshot.relationships, snapshot.tutors)); setMessage(""); }
    catch { setReview(null); setMessage("This action is unavailable for the current record. Reload access to check it."); }
  }
  function confirm() {
    if (latch.current || !review || blocked) return;
    latch.current = true; setPending(true); setMessage(""); const checked = review;
    const operation = (async () => {
      let posted = false;
      try {
        const fresh = await load(); if (!alive.current) return;
        let current: Review; try { current = makeReview(checked.action, fresh.relationships, fresh.tutors); } catch { throw new Error("Reviewed target changed"); }
        if (current.fingerprint !== checked.fingerprint) { setReview(null); setMessage("The reviewed identity or access state changed. Review the current record again."); return; }
        posted = true; await relationshipApi.mutate(current); if (!alive.current) return;
        setReview(null); setSelected("");
        try { await load(); if (alive.current) setMessage("Access change saved. The current access records have been refreshed."); }
        catch { if (alive.current) { setBlocked(true); setMessage("Access change saved. Current records could not be refreshed; reload access before another action."); } }
      } catch (error) {
        if (!alive.current) return; setReview(null); setBlocked(true);
        const status = statusOf(error);
        if ([401, 403, 404].includes(status)) { setSnapshot(null); setFailed(true); setMessage("This action is no longer permitted. Reload access or check your account and sign in again."); }
        else if (status === 409 || !posted) setMessage("Current identity or access state could not be confirmed. Reload access and review again before saving.");
        else setMessage("The access-change outcome is unknown. Reload access and inspect the current records before reviewing another action. No automatic retry will occur.");
      } finally { latch.current = false; if (alive.current) setPending(false); }
    })(); mutation.current = operation; void operation.finally(() => { if (mutation.current === operation) mutation.current = null; });
  }
  async function reload() { if (pending) return; setReview(null); try { await load(); if (alive.current) { setBlocked(false); setMessage("Current access records reloaded. Review any new action before confirming it."); } } catch { /* Load supplies the unavailable state. */ } }
  const data = snapshot?.relationships, disabled = pending || blocked || loading || failed;
  const available = snapshot?.tutors.filter(row => !data?.tutors.some(link => link.tutorGrantId === row.id)) ?? [];
  const tutorLabels = identityLabels(snapshot?.tutors ?? []), pickerLabels = identityLabels(available);
  const linkedTutorLabels = identityLabels(data?.tutors.map(row => ({ id: row.tutorGrantId, displayName: row.displayName })) ?? []);
  const parentLabels = identityLabels(data?.guardians.map(row => ({ id: row.parentGrantId, displayName: row.displayName })) ?? []);
  const studentLabels = identityLabels(data?.identities.map(row => ({ id: row.studentGrantId, displayName: row.displayName })) ?? []);
  return <section className="role-workspace access-workspace admin-workspace"><AdminNav />{studentId && <div className="admin-crumbs"><WorkspaceLink href={`/workspace/admin/students/${studentId}/reading`}>Student page</WorkspaceLink></div>}<h1>{studentId ? "People and access" : "Tutors"}</h1>
    <p>{studentId ? "Manage the people linked to this student. A student link and a congregation role have different effects." : "Active, verified tutor identities in this congregation. Invitations create access only after acceptance."}</p>
    {message && <p className={blocked || !message.startsWith("Access change saved") ? "request-error" : "workspace-notice"} role={blocked ? "alert" : "status"}>{message}</p>}
    {review && <AccessReview review={review} pending={pending} confirm={confirm} cancel={() => setReview(null)} />}
    {loading ? <p role="status">Checking current access records…</p> : failed ? <p role="alert">Access records are unavailable. No previous identity list is being shown.</p> : snapshot && <>
      {data ? <>
        <div className="access-student"><h2><bdi dir="auto">{data.student.firstName} {data.student.lastName}</bdi></h2><p><time>{data.student.ceremonyDate}</time> · {data.student.disabled ? "Disabled student — access is unavailable; existing links can be removed." : "Active student"}</p></div>
        <section className="access-section"><h2>Tutors</h2><p>Assignments give tutors access to this student's work.</p>
          <ul className="access-records">{data.tutors.map(row => <li key={row.id}><h3><bdi dir="auto">{linkedTutorLabels.get(row.tutorGrantId)}</bdi></h3><p>{row.effectiveRead ? "Reading access available" : "Access currently unavailable"}{row.isCantor ? " · Cantor" : ""}</p>
            <div className="access-actions"><button className="button-secondary" disabled={disabled} onClick={() => choose({ kind: "link", group: "tutors", linkId: row.id })}>Review assignment removal</button><button className="button-text" disabled={disabled} onClick={() => choose({ kind: "grant", group: "tutors", linkId: row.id, grantId: row.tutorGrantId })}>Review tutor role revocation</button></div></li>)}</ul>
          {!data.tutors.length && <p>No tutor is assigned.</p>}
          <div className="access-assign"><label htmlFor="access-tutor">Tutor to assign</label><select id="access-tutor" disabled={disabled || data.student.disabled} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose an eligible tutor</option>{available.map(row => <option key={row.id} value={row.id}>{pickerLabels.get(row.id)}{row.isCantor ? " · Cantor" : ""}</option>)}</select>
            {!available.length && <p className="field-help">No unassigned eligible tutor on this page. Check another page or manage invitations.</p>}<button className="button-secondary" disabled={disabled || data.student.disabled || !selected} onClick={() => choose({ kind: "assign", grantId: selected })}>Review tutor assignment</button></div>
        </section>
        <section className="access-section"><h2>Parents</h2><p>Parent reading access and permission to practice as this child are separate.</p><ul className="access-records">{data.guardians.map(row => <li key={row.id}><h3><bdi dir="auto">{parentLabels.get(row.parentGrantId)}</bdi></h3><p>{row.effectiveRead ? "Parent reading available" : "Access currently unavailable"} · {row.effectivePractice ? "Child practice available" : "Child practice unavailable"}</p><p className="field-help">Practice permission: {row.practiceEnabled ? "Allowed" : "Stopped"}.</p><div className="access-actions">
          <button className="button-secondary" disabled={disabled || !row.practiceEnabled && (!row.effectiveRead || data.student.disabled)} onClick={() => choose({ kind: "practice", linkId: row.id, enabled: !row.practiceEnabled })}>{row.practiceEnabled ? "Review stopping practice" : "Review allowing practice"}</button>
          <button className="button-secondary" disabled={disabled} onClick={() => choose({ kind: "link", group: "guardians", linkId: row.id })}>Review parent link removal</button><button className="button-text" disabled={disabled} onClick={() => choose({ kind: "grant", group: "guardians", linkId: row.id, grantId: row.parentGrantId })}>Review parent role revocation</button></div></li>)}</ul>{!data.guardians.length && <p>No parent links. Use an explicit parent invitation to establish one.</p>}</section>
        <section className="access-section"><h2>Student sign-in</h2><ul className="access-records">{data.identities.map(row => <li key={row.id}><h3><bdi dir="auto">{studentLabels.get(row.studentGrantId)}</bdi></h3><p>{row.effectivePractice ? "Student practice available" : "Access currently unavailable"}</p><div className="access-actions"><button className="button-secondary" disabled={disabled} onClick={() => choose({ kind: "link", group: "identities", linkId: row.id })}>Review student sign-in removal</button><button className="button-text" disabled={disabled} onClick={() => choose({ kind: "grant", group: "identities", linkId: row.id, grantId: row.studentGrantId })}>Review student role revocation</button></div></li>)}</ul>{!data.identities.length && <p>No independent student sign-in is linked. Parent child-practice access is separate.</p>}</section>
      </> : <ul className="access-records">{snapshot.tutors.map(row => <li key={row.id}><h2><bdi dir="auto">{tutorLabels.get(row.id)}</bdi></h2><p>{row.isCantor ? "Cantor" : "Tutor"}</p><div className="access-actions"><button className="button-secondary" disabled={disabled} onClick={() => choose({ kind: "cantor", grantId: row.id, enabled: !row.isCantor })}>{row.isCantor ? "Review removing cantor flag" : "Review cantor flag"}</button><button className="button-text" disabled={disabled} onClick={() => choose({ kind: "grant", grantId: row.id })}>Review tutor role revocation</button></div></li>)}</ul>}
      {!data && !snapshot.tutors.length && <p>No eligible tutors on this page.</p>}
      <nav className="access-pages" aria-label="Eligible tutor pages"><button className="button-secondary" disabled={disabled || cursors.length === 1} onClick={() => { setReview(null); setSelected(""); setCursors(previous => previous.slice(0, -1)); }}>Previous tutor page</button><button className="button-secondary" disabled={disabled || snapshot.tutors.length !== 100} onClick={() => { setReview(null); setSelected(""); setCursors(previous => [...previous, snapshot.tutors[snapshot.tutors.length - 1].id]); }}>Next tutor page</button></nav>
    </>}
    <button className="button-text" disabled={pending || loading} onClick={() => void reload()}>Reload access</button><p className="field-help"><Link href="/">Check account and sign in again</Link></p>
  </section>;
}
