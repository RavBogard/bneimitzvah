"use client";
import { useEffect, useState } from "react";
import type { Assigned } from "../api";
import { staffApi, type Family } from "./api";
import { familyLine, waitingForDivisions, waitingLine } from "./model";

/**
 * The lines under a student's name on the staff page (1.9 N14/N15):
 * - for a tutor, "Family: Dana Levin (joined)" or "Family: invitation sent, not yet accepted" (G7, TP-12): joined parents'
 *   display names only, never an address;
 * - for a tutor, the honors status (G12, TP-05): the family is waiting for aliyah divisions. Status only: it is worked out from
 *   the reading the tutor already sees (a Torah reading with no divisions) and the student's kind; honors are never read, so no
 *   honoree name can reach it. The way to set divisions is the Manage sheet's "Set divisions" row;
 * - for a tutor or an admin, each reading that needs review is named here; "Confirm reading is still right" (AD-05) is a Manage row.
 */
export function StaffStudentLines({ mode, baseline }: { mode: "tutor" | "admin"; baseline: Assigned }) {
  const studentId = baseline.student.id, firstName = baseline.student.firstName;
  const [family, setFamily] = useState<{ id: string; value: Family } | null>(null);
  useEffect(() => {
    if (mode !== "tutor") return;
    const request = new AbortController();
    staffApi.family("tutor", studentId, request.signal).then(value => { if (!request.signal.aborted) setFamily({ id: studentId, value }); }, () => undefined);
    return () => request.abort();
  }, [mode, studentId]);
  const known = family?.id === studentId ? family.value : null;
  const waiting = mode === "tutor" && waitingForDivisions(known?.kind, baseline.readings);
  const review = baseline.readings.filter(row => row.needsReview);
  const lines = known ? familyLine(known) : [];
  if (!lines.length && !waiting && !review.length) return null;
  return <div className="staff-lines" data-testid="staff-student-lines">
    {lines.map(line => <p key={line} data-testid="family-line"><bdi dir="auto">{line}</bdi></p>)}
    {waiting && <p data-testid="honors-status"><bdi dir="auto">{waitingLine(firstName)}</bdi></p>}
    {review.map(reading => <p key={reading.id} className="reading-review-clear" data-testid="reading-review"><span className="roster-chip">Reading needs review</span>
      {baseline.readings.length > 1 && <span>{reading.kind === "torah" ? "Torah" : "Haftarah"}</span>}</p>)}
  </div>;
}
