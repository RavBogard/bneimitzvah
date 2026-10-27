"use client";
import { useEffect, useRef, useState } from "react";
import { fetchMyTutor, removeMyTutor, type MyTutor } from "./api";
import styles from "./shelf.module.css";

/** The learner's line (decision 15): "Tutor: {name}", with "Not my tutor" when the tutor is a claim (a rabbi's assignment has no undo here). */
export const MY_TUTOR_STRINGS = Object.freeze({ label: "Tutor: ", undo: "Not my tutor", removed: "Your tutor was removed.", failed: "The tutor wasn’t removed. Try again." });
type State = Readonly<{ status: "loading" } | { status: "ready"; tutor: MyTutor | null } | { status: "removed" } | { status: "hidden" }>;

export function MyTutorView({ state, pending, notice, onRemove }: { state: State; pending: boolean; notice: string | null; onRemove: () => void }) {
  if (state.status === "removed") return <p className={styles.tutorLine} role="status" data-testid="mine-tutor">{MY_TUTOR_STRINGS.removed}</p>;
  if (state.status !== "ready" || !state.tutor) return null;
  return <p className={styles.tutorLine} data-testid="mine-tutor">
    <span>{MY_TUTOR_STRINGS.label}<bdi dir="auto">{state.tutor.name}</bdi></span>
    {state.tutor.claimed && <> <button type="button" className={styles.tutorUndo} disabled={pending} onClick={onRemove}>{MY_TUTOR_STRINGS.undo}</button></>}
    {notice && <span role="alert"> {notice}</span>}
  </p>;
}

/** The live line for the signed-in person. A refusal on the way hides it. */
export function MyTutorLine() {
  const [state, setState] = useState<State>({ status: "loading" }), [pending, setPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchMyTutor(controller.signal).then(tutor => { if (!controller.signal.aborted) setState({ status: "ready", tutor }); }, () => { if (!controller.signal.aborted) setState({ status: "hidden" }); });
    return () => controller.abort();
  }, []);
  const remove = async () => {
    if (gate.current) return;
    gate.current = true; setPending(true); setNotice(null);
    try {
      const result = await removeMyTutor();
      if (result.ok) setState({ status: "removed" }); else setNotice(MY_TUTOR_STRINGS.failed);
    } catch { setNotice(MY_TUTOR_STRINGS.failed); }
    finally { gate.current = false; setPending(false); }
  };
  return <MyTutorView state={state} pending={pending} notice={notice} onRemove={() => void remove()} />;
}
