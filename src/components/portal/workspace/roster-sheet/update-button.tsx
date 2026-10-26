"use client";

import { useState } from "react";
import { Button } from "../../../ui";

/** G21 (AD-11): how long the update waits for Google before it says so. The Sheet may still finish; the nightly refresh catches up. */
export const SHEET_UPDATE_TIMEOUT_MS = 20_000;

// The rabbi's "update now" for the staff roster Sheet; it also refreshes itself every night.
export function UpdateStaffSheet({ timeoutMs = SHEET_UPDATE_TIMEOUT_MS }: { timeoutMs?: number } = {}) {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "done"; text: string }>({ kind: "idle" });
  async function update() {
    setState({ kind: "busy" });
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch("/api/admin/roster-sheet/sync", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        referrerPolicy: "same-origin", headers: { accept: "application/json", "content-type": "application/json" }, body: "{}", signal });
      if (response.status === 401 || response.status === 403) { setState({ kind: "done", text: "Only an admin who manages students can update the staff Sheet." }); return; }
      const value = await response.json() as { ok?: boolean; students?: number; reason?: string };
      setState({ kind: "done", text: value.ok ? `Staff Sheet updated with ${value.students} ${value.students === 1 ? "student" : "students"}.`
        : value.reason === "not-configured" ? "The staff Sheet isn’t connected yet." : "Google didn’t accept the update. Try again in a minute." });
    } catch {
      setState({ kind: "done", text: signal.aborted ? "This is taking a while. Try again in a minute." : "The update didn’t go through. Try again." });
    }
  }
  return <>
    <Button disabled={state.kind === "busy"} onClick={() => void update()}>{state.kind === "busy" ? "Updating…" : "Update the staff roster Sheet"}</Button>
    <span className="field-help" role="status">{state.kind === "done" ? state.text : ""}</span>
  </>;
}
