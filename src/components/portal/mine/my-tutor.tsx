"use client";
import { useEffect, useRef, useState } from "react";
import { fetchMyTutor, removeMyTutor, type MyTutor } from "./api";
import styles from "./shelf.module.css";

export const MY_TUTOR_STRINGS = Object.freeze({ label: "Tutor: ", undo: "Not my tutor", removed: "Your tutor was removed.", failed: "The tutor wasn't removed. Try again." });
type State = Readonly<{ status: "loading" } | { status: "ready"; tutors: readonly MyTutor[] } | { status: "hidden" }>;

export function MyTutorView({ state, pending, notice, onRemove }: { state: State; pending: boolean; notice: string | null; onRemove: (claimId: string) => void }) {
  if (state.status !== "ready" || (!state.tutors.length && !notice)) return null;
  return <div data-testid="mine-tutors">
    {state.tutors.map((tutor, index) => <p className={styles.tutorLine} key={tutor.claimId ?? `assigned-${index}`} data-testid="mine-tutor">
      <span>{MY_TUTOR_STRINGS.label}<bdi dir="auto">{tutor.name}</bdi></span>
      {tutor.claimId && <button type="button" className={styles.tutorUndo} disabled={pending} aria-label={`${MY_TUTOR_STRINGS.undo}: ${tutor.name}`} onClick={() => onRemove(tutor.claimId!)}>{MY_TUTOR_STRINGS.undo}</button>}
    </p>)}
    {notice && <p role="status">{notice}</p>}
  </div>;
}

export function MyTutorLine() {
  const [state, setState] = useState<State>({ status: "loading" }), [pending, setPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchMyTutor(controller.signal).then(tutors => { if (!controller.signal.aborted) setState({ status: "ready", tutors }); }, () => { if (!controller.signal.aborted) setState({ status: "hidden" }); });
    return () => controller.abort();
  }, []);
  const remove = async (claimId: string) => {
    if (gate.current) return;
    gate.current = true; setPending(true); setNotice(null);
    try {
      const result = await removeMyTutor(claimId);
      if (result.ok) { setState(current => current.status === "ready" ? { ...current, tutors: current.tutors.filter(tutor => tutor.claimId !== claimId) } : current); setNotice(MY_TUTOR_STRINGS.removed); }
      else setNotice(MY_TUTOR_STRINGS.failed);
    } catch { setNotice(MY_TUTOR_STRINGS.failed); }
    finally { gate.current = false; setPending(false); }
  };
  return <MyTutorView state={state} pending={pending} notice={notice} onRemove={claimId => void remove(claimId)} />;
}
