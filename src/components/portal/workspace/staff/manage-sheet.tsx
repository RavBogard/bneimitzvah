"use client";
import { useState } from "react";
import { List, ListRow, Sheet } from "../../../ui";
import type { Assigned, Reading } from "../api";
import { statusOf } from "../provider";
import { staffApi } from "./api";
import { bookletHref } from "../../print/booklet-href";

/**
 * The staff Manage sheet (Readings for everyone E3): every action a tutor or admin takes on a student's reading, in one place, so the page's
 * title block carries two pills and one button. The rows, in order: Confirm reading is still right (one for each reading that needs review,
 * named Torah or Haftarah when there are two), Set divisions, Change verses, Print practice sheet, Print the whole reading, Print booklet, Write a lesson note and
 * Refresh reading; an admin also gets People and access and All students. The owner decides what each row does; this component owns the
 * confirmation, which is the one row that writes.
 */
export const MANAGE_STRINGS = Object.freeze({
  title: "Manage", close: "Close", confirm: "Confirm reading is still right", divisions: "Set divisions", change: "Change verses",
  printPractice: "Print practice sheet", printWhole: "Print the whole reading", printBooklet: "Print booklet", writeNote: "Write a lesson note", refresh: "Refresh reading",
  people: "People and access", students: "All students", changed: "The reading changed. Refresh it to continue.", failed: "Couldn't confirm the reading. Try again.",
});

export type ManageActions = Readonly<{
  open: boolean;
  onClose(): void;
  /** The row's action; the sheet closes first, then the owner runs it. */
  setDivisions(): void;
  changeVerses(): void;
  printPractice(): void;
  printDisabled: boolean;
  /** The reader's print address for the whole reading, or null when there is nothing to print. */
  printWholeHref: string | null;
  writeNote(): void;
  refresh(): void;
  /** Reloads the reading after a confirmation. */
  reload(): Promise<unknown>;
}>;

/** The rows a mode shows, by name, in order. Pure, so the order is tested without a browser. */
export function manageRows(mode: "tutor" | "admin", reviewKinds: readonly Reading["kind"][], twoReadings: boolean): string[] {
  const rows = reviewKinds.map(kind => twoReadings ? `${MANAGE_STRINGS.confirm}:${kind === "torah" ? "Torah" : "Haftarah"}` : MANAGE_STRINGS.confirm);
  rows.push(MANAGE_STRINGS.divisions, MANAGE_STRINGS.change, MANAGE_STRINGS.printPractice, MANAGE_STRINGS.printWhole, MANAGE_STRINGS.printBooklet, MANAGE_STRINGS.writeNote, MANAGE_STRINGS.refresh);
  if (mode === "admin") rows.push(MANAGE_STRINGS.people, MANAGE_STRINGS.students);
  return rows;
}

export function ManageSheet({ mode, student, baseline, actions }: { mode: "tutor" | "admin"; student: { id: string; firstName: string; lastName: string }; baseline: Assigned | null; actions: ManageActions }) {
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState("");
  const readings = baseline?.readings ?? [], review = readings.filter(row => row.needsReview), twoReadings = readings.length > 1;
  async function confirm(reading: Reading) {
    if (pending) return;
    setPending(reading.id); setError("");
    try { await staffApi.reconfirm(mode, student.id, reading); await actions.reload().catch(() => undefined); }
    catch (failure) { if (statusOf(failure) === 409) { setError(MANAGE_STRINGS.changed); await actions.reload().catch(() => undefined); } else setError(MANAGE_STRINGS.failed); }
    finally { setPending(null); }
  }
  // A row that opens something closes the sheet first; the owner's action runs once it has gone.
  const then = (run: () => void) => () => { actions.onClose(); run(); };
  return <Sheet open={actions.open} onClose={actions.onClose} title={MANAGE_STRINGS.title} closeLabel={MANAGE_STRINGS.close} dismissible={pending === null}>
    <div data-manage-sheet="">
      {error && <p role="status">{error}</p>}
      <List>
        {review.map(reading => <ListRow key={reading.id} title={MANAGE_STRINGS.confirm} meta={twoReadings ? (reading.kind === "torah" ? "Torah" : "Haftarah") : undefined} onClick={pending === null ? () => void confirm(reading) : undefined} />)}
        <ListRow title={MANAGE_STRINGS.divisions} onClick={then(actions.setDivisions)} />
        <ListRow title={MANAGE_STRINGS.change} onClick={then(actions.changeVerses)} />
        <ListRow title={MANAGE_STRINGS.printPractice} onClick={actions.printDisabled ? undefined : then(actions.printPractice)} />
        {actions.printWholeHref ? <ListRow title={MANAGE_STRINGS.printWhole} href={actions.printWholeHref} /> : <ListRow title={MANAGE_STRINGS.printWhole} />}
        <ListRow title={MANAGE_STRINGS.printBooklet} href={bookletHref(student.id)} />
        <ListRow title={MANAGE_STRINGS.writeNote} onClick={then(actions.writeNote)} />
        <ListRow title={MANAGE_STRINGS.refresh} onClick={then(actions.refresh)} />
        {mode === "admin" && <ListRow title={MANAGE_STRINGS.people} href={`/workspace/admin/students/${encodeURIComponent(student.id)}/access`} />}
        {mode === "admin" && <ListRow title={MANAGE_STRINGS.students} href="/workspace/admin/students" />}
      </List>
    </div>
  </Sheet>;
}
