"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createSavedReading, fetchSavedReadings, type SavedKind } from "./api";
import { parseSession, requestPortal } from "../api";
import { rememberSignedIn, signedInHint, signInPending } from "../signed-in-hint";
import { ReturnSignInLink } from "../return-sign-in-link";
import { savedReadingHref } from "../mine/own-readings";
import styles from "./saved.module.css";

/** The passage on screen, as /read knows it: the page's title (a parashah, a named reading or a range; absent on a
 * Shabbat with no weekly portion), the passage's own label (Torah, Haftarah, or a named reading's), and its Shabbat when it has one. */
export type SavablePassage = Readonly<{ title: string | null; label: string | null; kind: SavedKind; ranges: readonly string[]; date: string | null }>;
export type SaveStep = "idle" | "checking" | "signed-out" | "not-eligible" | "form" | "saving" | "saved" | "unavailable";
export type SaveProblem = null | "invalid" | "limit" | "unavailable";

const kindName = (kind: SavedKind) => kind === "torah" ? "Torah" : "Haftarah";
/** "{title} · {label}" ("Noach · Torah"), within the 80-character name the server keeps. */
export function suggestedName(passage: SavablePassage): string {
  return Array.from(`${passage.title ?? "Shabbat reading"} · ${passage.label ?? kindName(passage.kind)}`).slice(0, 80).join("");
}
/** What a signed-in student sees on pressing Save (1.9 N20-1 and N20-2; Daniel, 2026-10-25, "Keep it"): why, and where their own reading is. */
export const STUDENT_LINE = "Student accounts don’t save other readings. Your assigned reading is always under Reading.";
const problems: Record<Exclude<SaveProblem, null>, string> = {
  invalid: "Use a name of 1 to 80 characters and a real date, or leave the date empty.",
  limit: "You have 100 saved readings, the most an account keeps. Remove one to save another.",
  unavailable: "The reading didn’t save. Try again.",
};

/**
 * The quiet Save beside the passage, in each of its states. Everything opens inline; nothing is a dialog. Signed out, Save is
 * "Sign in to save" (F4), a link that comes back to this reading (`back`, N20) and offers Save there.
 */
export function SaveReadingView({ step, problem, name, date, panelId, savedId = null, student = false, back, onSave, onName, onDate, onSubmit, onCancel }: {
  step: SaveStep; problem: SaveProblem; name: string; date: string; panelId: string; savedId?: string | null; student?: boolean; back?: () => string | null;
  onSave: () => void; onName: (value: string) => void; onDate: (value: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  const open = step === "form" || step === "saving";
  return <div className={styles.save} data-save-step={step}>
    {step === "signed-out" ? <ReturnSignInLink className="button-hero-secondary" back={back}>Sign in to save</ReturnSignInLink>
      : step !== "saved" && <button type="button" className="button-hero-secondary" aria-expanded={open} aria-controls={open ? panelId : undefined}
      disabled={step === "checking" || step === "saving"} onClick={onSave}>Save</button>}
    {step === "not-eligible" && (student
      ? <p className={styles.line} data-save-student="">{STUDENT_LINE} <a href="/workspace/student?tab=reading">Open your reading</a></p>
      : <p className={styles.line}><a href="/account">Ask for an account to save readings</a></p>)}
    {step === "unavailable" && <p className={styles.line} role="status">Saving isn’t available right now. Try again.</p>}
    {step === "saved" && <p className={styles.line} role="status">Saved to <a href="/mine">My Readings</a>.{savedId && <> <a href={savedReadingHref(savedId)}>Open your reading</a></>}</p>}
    {open && <form id={panelId} className={styles.panel} aria-label="Save this reading" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <div><label htmlFor={`${panelId}-name`}>Name</label>
        <input id={`${panelId}-name`} name="name" value={name} maxLength={80} required autoComplete="off" onChange={event => onName(event.target.value)} /></div>
      <div><label htmlFor={`${panelId}-date`}>Date <span className={styles.optional}>(optional)</span></label>
        <input id={`${panelId}-date`} name="date" type="date" value={date} onChange={event => onDate(event.target.value)} /></div>
      {problem && <p className="request-error" role="alert">{problems[problem]}</p>}
      <div className={styles.actions}>
        <button type="submit" className="button-primary" disabled={step === "saving"}>Save reading</button>
        <button type="button" className="button-secondary" disabled={step === "saving"} onClick={onCancel}>Cancel</button>
      </div>
    </form>}
  </div>;
}

/**
 * Save on the signed-out reading (accounts plan §5). It asks about the account only when pressed:
 * signed out it offers sign-in, an account without saved readings is pointed to /account, and a
 * member gets an inline form pre-filled with the passage's name and its Shabbat.
 * A browser not seen signed in here starts on "Sign in to save" without asking (F4, N20). `back` is the way back from
 * sign-in; `offer`, once true, is the return from it: Save asks at once, as if pressed, and the offer is spent.
 */
export function SaveReading({ passage, onSaved, back, offer }: { passage: SavablePassage; onSaved?(): void; back?: () => string | null; offer?: { current: boolean } }) {
  const [step, setStep] = useState<SaveStep>("idle"), [problem, setProblem] = useState<SaveProblem>(null), [savedId, setSavedId] = useState<string | null>(null);
  const [name, setName] = useState(() => suggestedName(passage)), [date, setDate] = useState(passage.date ?? ""), [student, setStudent] = useState(false);
  const panelId = useId(), live = useRef<AbortController | null>(null);
  // Another passage on screen starts over; nothing typed for the last one carries across.
  const key = JSON.stringify([passage.kind, passage.ranges, passage.date, passage.title, passage.label]);
  useLayoutEffect(() => { live.current?.abort(); setStep(signedInHint() ? "idle" : "signed-out"); setProblem(null); setName(suggestedName(passage)); setDate(passage.date ?? ""); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => live.current?.abort(), []);
  // An account that cannot save is told why only when it is a student's (G20: a student already has an account to ask for); any other keeps the way to ask.
  useEffect(() => {
    if (step !== "not-eligible") { setStudent(false); return; }
    const request = new AbortController();
    requestPortal("/api/session", undefined, request.signal).then(value => { if (!request.signal.aborted) setStudent(parseSession(value).roles.includes("student")); }, () => { /* The way to ask stays. */ });
    return () => request.abort();
  }, [step]);
  const begin = () => { live.current?.abort(); const controller = new AbortController(); live.current = controller; return controller; };
  const check = (spend?: { current: boolean }) => {
    const controller = begin(); setStep("checking");
    fetchSavedReadings(controller.signal).then(list => {
      if (controller.signal.aborted) return;
      if (spend) spend.current = false;
      rememberSignedIn(list.state !== "signed-out");
      setStep(list.state === "signed-out" ? "signed-out" : list.state === "not-eligible" ? "not-eligible" : "form");
    }, () => { if (!controller.signal.aborted) setStep("unavailable"); });
  };
  const onSave = () => {
    if (step === "form") { setStep("idle"); setProblem(null); return; }
    check();
  };
  // Back from "Sign in to save": ask straight away; the first answer spends the offer. Back from a Google sign-in that
  // went straight to this reading (no offer, no hint yet): ask once, so a session that is here shows Save.
  useEffect(() => { if (offer?.current) check(offer); else if (!signedInHint() && signInPending()) check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onSubmit = () => {
    const trimmed = name.trim(), length = Array.from(trimmed).length;
    if (length < 1 || length > 80 || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) { setProblem("invalid"); return; }
    const controller = begin(); setStep("saving"); setProblem(null);
    createSavedReading({ name: trimmed, date: date || null, kind: passage.kind, ranges: passage.ranges.join("; ") }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) { setSavedId(result.reading.id); setStep("saved"); onSaved?.(); return; }
      if (result.code === "signed-out" || result.code === "not-eligible") { rememberSignedIn(result.code !== "signed-out"); setStep(result.code); return; }
      setStep("form"); setProblem(result.code);
    });
  };
  return <SaveReadingView step={step} problem={problem} name={name} date={date} panelId={panelId} savedId={savedId} student={student} back={back} onSave={onSave} onName={setName} onDate={setDate} onSubmit={onSubmit}
    onCancel={() => { live.current?.abort(); setStep("idle"); setProblem(null); }} />;
}
