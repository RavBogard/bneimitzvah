"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { workspaceApi, type Assigned } from "./api";
import { customReadingRanges, readingBaseline, type ReadingKind, type ReadingProposal, type StaffMode } from "./reading-proposal";
import { statusOf } from "./provider";

export function ReadingEditor({ mode, baseline, reload }: { mode: StaffMode; baseline: Assigned | null; reload(): Promise<Assigned> }) {
  const [kind, setKind] = useState<ReadingKind>("torah"), [method, setMethod] = useState("calendar"), [custom, setCustom] = useState("");
  const [review, setReview] = useState<{ proposal: ReadingProposal; baseline: string; expiresAt: number } | null>(null);
  const [pending, setPending] = useState<"prepare" | "confirm" | "reload" | null>(null), [message, setMessage] = useState(""), [blocked, setBlocked] = useState(false);
  const gate = useRef(false), generation = useRef(0), alive = useRef(true), heading = useRef<HTMLHeadingElement>(null);
  const key = baseline ? readingBaseline(baseline, kind) : null, keyRef = useRef(key); keyRef.current = key;
  const lastKey = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    generation.current++; setReview(null);
    if (review && lastKey.current !== null && key !== lastKey.current) setMessage("The current reading is being checked or has changed. Your draft is retained; prepare a new review before confirming.");
    if (key !== null) lastKey.current = key;
  }, [key]);
  useEffect(() => {
    if (!review || review.proposal.status !== "prepared") return;
    const timer = setTimeout(() => { setReview(null); setMessage("This review expired. Prepare the reading again before confirming."); }, Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  function change(apply: () => void) { generation.current++; setReview(null); setMessage(""); apply(); }
  async function prepare(pick?: string) {
    if (gate.current || !baseline || !key || blocked) return;
    gate.current = true; const turn = ++generation.current, selectedKey = key, startedAt = Date.now();
    setPending("prepare"); setReview(null); setMessage("");
    try {
      const input = pick ? { pick } : method === "custom" ? { ranges: customReadingRanges(custom) } : {};
      const proposal = await workspaceApi.prepareReading(mode, baseline, kind, input);
      if (!alive.current || turn !== generation.current || keyRef.current !== selectedKey) return;
      setReview({ proposal, baseline: selectedKey, expiresAt: startedAt + 5 * 60_000 });
      queueMicrotask(() => heading.current?.focus());
    } catch (error) {
      if (alive.current && turn === generation.current) {
        if (statusOf(error) === 409) { setBlocked(true); setMessage("The student or assignment changed while this proposal was being prepared. Reload the current reading before reviewing it."); }
        else setMessage([400, 403].includes(statusOf(error))
          ? "The reading could not be prepared. Check the references and current access, then try a new review."
          : "The calendar proposal is unavailable. You can retry explicitly or prepare custom references; no assignment was changed.");
      }
    } finally { gate.current = false; if (alive.current) setPending(null); }
  }
  async function confirm() {
    if (gate.current || !review || review.proposal.status !== "prepared" || !baseline || review.baseline !== key || Date.now() >= review.expiresAt || blocked) return;
    gate.current = true; const turn = ++generation.current; setPending("confirm"); setMessage("");
    const prepared = review.proposal; setReview(null);
    try {
      const saved = await workspaceApi.confirmReading(mode, baseline.student.id, prepared.binding);
      if (!alive.current) return;
      if (turn !== generation.current || keyRef.current !== key) { setBlocked(true); setMessage("The confirmation outcome changed while access was being checked. Reload the current reading before preparing again; do not submit automatically."); return; }
      let current: Assigned;
      try { current = await reload(); } catch { setBlocked(true); setMessage("The server confirmed the reading was saved, but its current assignment could not be reloaded. Reload the reading before continuing."); return; }
      if (!alive.current) return;
      const assignment = current.readings.find(row => row.kind === prepared.kind);
      if (!assignment || assignment.id !== saved.assignmentId || assignment.revision !== saved.revision) {
        setBlocked(true); setMessage("The server confirmed this change, but the latest reading differs. Reload and review the current assignment before making another change.");
      } else setMessage("Reading confirmed and reloaded from the server. The assignment above is current.");
    } catch (error) {
      if (!alive.current) return;
      setBlocked(true);
      setMessage(statusOf(error) === 409 ? "The student or assignment changed after this review. Reload the current reading, then prepare a new review."
        : [400, 401, 403, 404].includes(statusOf(error)) ? "This review is no longer valid or permitted. Reload the current reading and check access before preparing again."
        : "The confirmation outcome could not be established. It may have saved. Reload the current reading before preparing again; no automatic retry will occur.");
    } finally { gate.current = false; if (alive.current) setPending(null); }
  }
  async function reloadCurrent() {
    if (gate.current) return; gate.current = true; setPending("reload"); setReview(null); setMessage("");
    try { await reload(); if (alive.current) { setBlocked(false); setMessage("Current reading reloaded. Prepare a new review to make a change."); } }
    catch { if (alive.current) setMessage("The current reading could not be reloaded. Your draft is retained; try reloading again when access is available."); }
    finally { gate.current = false; if (alive.current) setPending(null); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void prepare(); }
  const proposal = review?.baseline === key ? review.proposal : null;
  return <section className="reading-editor" aria-labelledby="reading-editor-title">
    <h2 id="reading-editor-title">Set the assigned reading</h2>
    <p>The confirmed assignment above stays in place until you review and explicitly confirm a replacement. This changes references only.</p>
    <form onSubmit={submit}>
      <div className="reading-editor-fields">
        <div><label htmlFor="reading-kind">Reading</label><select id="reading-kind" value={kind} disabled={pending !== null} onChange={event => change(() => setKind(event.target.value as ReadingKind))}><option value="torah">Torah</option><option value="haftarah">Haftarah</option></select></div>
        <div><label htmlFor="reading-method">Selection method</label><select id="reading-method" value={method} disabled={pending !== null} onChange={event => change(() => setMethod(event.target.value))}><option value="calendar">Congregation calendar proposal</option><option value="custom">Custom references</option></select></div>
      </div>
      {method === "custom" && <div className="reading-custom"><label htmlFor="reading-ranges">Custom verse ranges</label><textarea id="reading-ranges" value={custom} maxLength={3232} rows={4} disabled={pending !== null} aria-describedby="reading-ranges-help" required onChange={event => change(() => setCustom(event.target.value))} /><p id="reading-ranges-help" className="field-help">One reference per line, up to 32 ranges and 1,000 verses. For example: {kind === "torah" ? "Genesis 1:1-3" : "Isaiah 1:1-2"}. The server checks book, order and verse boundaries.</p></div>}
      <button className="button-secondary" disabled={!baseline || pending !== null || blocked}>{pending === "prepare" ? "Preparing review…" : "Prepare reading review"}</button>
    </form>
    {pending === "confirm" && <p role="status">Saving the reviewed assignment and checking its confirmed references…</p>}
    {message && <p className={blocked ? "request-error" : "field-help"} role={blocked ? "alert" : "status"}>{message}</p>}
    {blocked && <button className="button-secondary" disabled={pending !== null} onClick={() => void reloadCurrent()}>{pending === "reload" ? "Reloading current reading…" : "Reload current reading"}</button>}
    {proposal && <section className="reading-proposal" aria-labelledby="reading-review-title">
      <h3 id="reading-review-title" tabIndex={-1} ref={heading}>{proposal.status === "prepared" ? `Review ${kind === "torah" ? "Torah" : "Haftarah"} assignment` : "Choose a reading explicitly"}</h3>
      <p className="field-help">Calendar source: <a href="https://www.hebcal.com/" target="_blank" rel="noopener noreferrer">Hebcal</a>. {proposal.sourceStatus === "available" ? `Fetched ${new Date(proposal.sourceFetchedAt!).toLocaleString()}.` : "Unavailable. These custom references have no available calendar proposal; verify them independently."}</p>
      {proposal.status === "needs-selection" ? <>
        <p>{proposal.parashah ? `${proposal.parashah} · ` : "No Torah calendar reading was returned · "}{proposal.date} · {proposal.calendar === "diaspora" ? "Diaspora" : "Israel"} calendar.</p>
        <p>No assignment has been prepared or changed. Choose an available selection below, or enter custom references.</p>
        {kind === "torah" && proposal.choices.length > 0 && <ul className="reading-calendar-choices">{proposal.choices.map(choice => <li key={choice.pick}><button className="button-secondary" disabled={pending !== null || blocked} onClick={() => void prepare(choice.pick)}>{choice.label}{choice.ref ? `: ${choice.ref}` : ""}</button></li>)}</ul>}
        {kind === "torah" && !proposal.choices.length && <p>No calendar selections are available for this date.</p>}
        {kind === "haftarah" && <p>{proposal.haftarah ? `Calendar reference: ${proposal.haftarah}. Prepare again to check its current availability.` : "No haftarah was returned for this date. Use custom references if appropriate."}</p>}
      </> : <>
        <p className="reading-reference">{proposal.ranges.join("; ")}</p><p>{proposal.verseCount} verses · Selection: {proposal.basis}.</p>
        {proposal.maftir && <p>Calendar maftir, shown separately: {proposal.maftir.ref}{proposal.maftir.reason ? ` (${proposal.maftir.reason})` : ""}. It is not added automatically; only the listed assignment ranges will be saved.</p>}
        <p>Confirm these exact references for the student named above. Any existing {kind === "torah" ? "Torah" : "Haftarah"} assignment will be replaced. Audio and congregation settings are not changed.</p>
        <button className="button-primary" disabled={pending !== null || blocked || !baseline || Date.now() >= review!.expiresAt} onClick={() => void confirm()}>{pending === "confirm" ? "Confirming reading…" : "Confirm assigned reading"}</button>
      </>}
    </section>}
  </section>;
}
