"use client";
import { useEffect, useState } from "react";
import type { ChosenSelection } from "../public-reading/choose-verses";

/** The words of a revision's answers. The conflict sentence is Daniel's (2026-10-24); the invalid one is kept as approved. Kept here so each swaps in one place. */
export const CHANGE_STRINGS = Object.freeze({
  save: "Save",
  conflict: "This reading was changed somewhere else. Your verses are still chosen. Save again to keep them.",
  invalid: "Those verses can’t be saved. Check the choice and try again.",
  failed: "The change didn’t save. Try again.",
});

/**
 * Save in the Change verses bar. `revise` sends the chosen groups with the reading's current revision and answers with the message to show,
 * or null when it saved (the page then leaves choosing). A refusal keeps the choice exactly as it was, so Save can be pressed again.
 */
export function ChangeVersesSave({ selection, revise }: { selection: ChosenSelection; revise(selection: ChosenSelection): Promise<string | null> }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const key = selection.ranges.join("; ");
  // Choosing again lets the last refusal go: it was about the choice as it stood.
  useEffect(() => { setMessage(""); }, [key]);
  return <>
    <button type="button" className="button-primary" disabled={busy} onClick={() => {
      setBusy(true); setMessage("");
      revise(selection).then(answer => { setBusy(false); if (answer) setMessage(answer); }, () => { setBusy(false); setMessage(CHANGE_STRINGS.failed); });
    }}>{CHANGE_STRINGS.save}</button>
    {message && <p className="request-error" role="alert" data-change-error="">{message}</p>}
  </>;
}
