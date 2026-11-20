"use client";
import { useState } from "react";
import { List, ListRow, Sheet } from "../../../ui";
import type { Assigned, Reading } from "../api";
import { statusOf } from "../provider";
import { staffApi } from "./api";
import { bookletHref } from "../../print/booklet-href";
import styles from "./manage-sheet.module.css";

/** The owner runs each reading action. This sheet owns confirmation, the one action that writes. */
export const MANAGE_STRINGS = Object.freeze({
  title: "Manage reading", close: "Close", confirm: "Confirm reading is still right", edit: "Edit verses and aliyot",
  printPractice: "Print practice sheet", printWhole: "Print the whole reading", printBooklet: "Print booklet", writeNote: "Add lesson note", refresh: "Refresh reading",
  changed: "The reading changed. Refresh it to continue.", failed: "Couldn't confirm the reading. Try again.",
});

export type ManageActions = Readonly<{
  open: boolean;
  onClose(): void;
  /** The row's action; the sheet closes first, then the owner runs it. */
  editVerses(): void;
  printPractice(): void;
  printDisabled: boolean;
  /** The reader's print address for the whole reading, or null when there is nothing to print. */
  printWholeHref: string | null;
  writeNote(): void;
  refresh(): void;
  /** Reloads the reading after a confirmation. */
  reload(): Promise<unknown>;
}>;

export function ManageSheet({ mode, student, baseline, actions }: { mode: "tutor" | "admin"; student: { id: string; firstName: string; lastName: string }; baseline: Assigned | null; actions: ManageActions }) {
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState("");
  const busy = pending !== null;
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
  return <Sheet open={actions.open} onClose={actions.onClose} title={MANAGE_STRINGS.title} closeLabel={MANAGE_STRINGS.close} dismissible={!busy}>
    <div className={styles.groups} data-manage-sheet="">
      {error && <p role="status">{error}</p>}
      <List label="Reading">
        <ListRow title={MANAGE_STRINGS.edit} disabled={busy} onClick={then(actions.editVerses)} />
        {review.map(reading => <ListRow key={reading.id} title={MANAGE_STRINGS.confirm} meta={twoReadings ? (reading.kind === "torah" ? "Torah" : "Haftarah") : undefined} disabled={busy} onClick={() => void confirm(reading)} />)}
        <ListRow title={MANAGE_STRINGS.refresh} disabled={busy} onClick={then(actions.refresh)} />
      </List>
      <List label="Lesson notes">
        <ListRow title={MANAGE_STRINGS.writeNote} disabled={busy} onClick={then(actions.writeNote)} />
      </List>
      <List label="Print">
        <ListRow title={MANAGE_STRINGS.printPractice} disabled={busy} onClick={actions.printDisabled ? undefined : then(actions.printPractice)} />
        {actions.printWholeHref ? <ListRow title={MANAGE_STRINGS.printWhole} disabled={busy} href={actions.printWholeHref} /> : <ListRow title={MANAGE_STRINGS.printWhole} />}
        <ListRow title={MANAGE_STRINGS.printBooklet} disabled={busy} href={bookletHref(student.id)} />
      </List>
    </div>
  </Sheet>;
}
