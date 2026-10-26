"use client";
import { useEffect, useState } from "react";
import type { Assigned, Reading } from "../api";
import { statusOf } from "../provider";
import { staffApi, type Family } from "./api";
import { familyLine, waitingForDivisions, waitingLine } from "./model";

/**
 * The lines under a student's name on the staff page (1.9 N14/N15):
 * - for a tutor, "Family: Dana Levin (joined)" or "Family: invitation sent, not yet accepted" (G7, TP-12): joined parents'
 *   display names only, never an address;
 * - for a tutor, the honors status (G12, TP-05): the family is waiting for aliyah divisions. Status only: it is worked out from
 *   the reading the tutor already sees (a Torah reading with no divisions) and the student's kind; honors are never read, so no
 *   honoree name can reach it. "Set divisions." opens the verse editor, where the divisions are set;
 * - for a tutor or an admin, each reading that needs review, with "Confirm reading is still right" (AD-05).
 */
export function StaffStudentLines({ mode, baseline, onSetDivisions, reload }: { mode: "tutor" | "admin"; baseline: Assigned; onSetDivisions(event: { currentTarget: HTMLElement }): void; reload(): Promise<unknown> }) {
  const studentId = baseline.student.id, firstName = baseline.student.firstName;
  const [family, setFamily] = useState<{ id: string; value: Family } | null>(null);
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "tutor") return;
    const request = new AbortController();
    staffApi.family("tutor", studentId, request.signal).then(value => { if (!request.signal.aborted) setFamily({ id: studentId, value }); }, () => undefined);
    return () => request.abort();
  }, [mode, studentId]);
  const known = family?.id === studentId ? family.value : null;
  const waiting = mode === "tutor" && waitingForDivisions(known?.kind, baseline.readings);
  const review = baseline.readings.filter(row => row.needsReview);
  async function confirm(reading: Reading) {
    if (pending) return;
    setPending(reading.id); setError("");
    try { await staffApi.reconfirm(mode, studentId, reading); await reload().catch(() => undefined); }
    catch (failure) { if (statusOf(failure) === 409) { setError("The reading changed. Refresh it to continue."); await reload().catch(() => undefined); } }
    finally { setPending(null); }
  }
  const lines = known ? familyLine(known) : [];
  if (!lines.length && !waiting && !review.length && !error) return null;
  return <div className="staff-lines" data-testid="staff-student-lines">
    {lines.map(line => <p key={line} data-testid="family-line"><bdi dir="auto">{line}</bdi></p>)}
    {waiting && <p data-testid="honors-status"><bdi dir="auto">{waitingLine(firstName)}</bdi> <button type="button" className="button-text" onClick={onSetDivisions}>Set divisions.</button></p>}
    {review.map(reading => <p key={reading.id} className="reading-review-clear" data-testid="reading-review"><span className="roster-chip">Reading needs review</span>
      {baseline.readings.length > 1 && <span>{reading.kind === "torah" ? "Torah" : "Haftarah"}</span>}
      <button type="button" className="button-secondary" disabled={pending !== null} onClick={() => void confirm(reading)}>Confirm reading is still right</button></p>)}
    {error && <p role="status">{error}</p>}
  </div>;
}
