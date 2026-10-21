"use client";

import { useState } from "react";

// The rabbi's "update now" for the staff roster Sheet; it also refreshes itself every night.
export function UpdateStaffSheet() {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "done"; text: string }>({ kind: "idle" });
  async function update() {
    setState({ kind: "busy" });
    try {
      const response = await fetch("/api/admin/roster-sheet/sync", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        referrerPolicy: "same-origin", headers: { accept: "application/json", "content-type": "application/json" }, body: "{}" });
      if (response.status === 401 || response.status === 403) { setState({ kind: "done", text: "Only an admin who manages students can update the staff Sheet." }); return; }
      const value = await response.json() as { ok?: boolean; students?: number; reason?: string };
      setState({ kind: "done", text: value.ok ? `Staff Sheet updated with ${value.students} ${value.students === 1 ? "student" : "students"}.`
        : value.reason === "not-configured" ? "The staff Sheet isn’t connected yet." : "Google didn’t accept the update. Try again in a minute." });
    } catch { setState({ kind: "done", text: "The update didn’t go through. Try again." }); }
  }
  return <>
    <button type="button" className="button-secondary admin-pill" disabled={state.kind === "busy"} onClick={() => void update()}>{state.kind === "busy" ? "Updating…" : "Update staff Sheet"}</button>
    {state.kind === "done" && <span className="field-help" role="status">{state.text}</span>}
  </>;
}
