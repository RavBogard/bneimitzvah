"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Sheet } from "../../ui";
import { createSavedReading, fetchSavedReadings, type SavedKind } from "./api";
import { parseSession, requestPortal } from "../api";
import { rememberSignedIn, signedInHint, signInPending } from "../signed-in-hint";
import { ReturnSignInLink } from "../return-sign-in-link";
import type { Pill } from "../public-reading/reader-title";
import { savedReadingHref } from "./my-readings";
import styles from "./saved.module.css";

/** The passage on screen, as /read knows it: the page's title (a parashah, a named reading or a range; absent on a
 * Shabbat with no weekly portion), the passage's own label (Torah, Haftarah, or a named reading's), and its Shabbat when it has one. */
export type SavablePassage = Readonly<{ title: string | null; label: string | null; kind: SavedKind; ranges: readonly string[]; date: string | null }>;
export type SaveStep = "idle" | "checking" | "signed-out" | "not-eligible" | "form" | "saving" | "saved" | "unavailable";
export type SaveProblem = null | "invalid" | "limit" | "unavailable";
/** Which verses the sheet saves: what is on screen, the whole portion, or (closing the sheet) a selection the reader chooses. */
export type SaveVerses = "screen" | "whole" | "choose";

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
/** The sheet's words (spec 7); "Saved to My Readings." is its status line. */
export const SAVE_STRINGS = Object.freeze({
  title: "Add to My Readings",
  date: "Date you’re reading it (optional)",
  verses: "Verses",
  wholePortion: "Whole portion",
  chooseVerses: "Choose verses",
  add: "Add",
  keeps: "Marks, notes and your translation stay with this reading. Your tutor and the rabbi can see them.",
  open: "Open",
});
const rangeText = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");

/**
 * Save as a sheet, "Add to My Readings" (Readings for everyone C2, spec 7): the name, the date, which verses (what is on screen, the whole
 * portion, or Choose verses, which closes the sheet and starts choosing) and one button, Add. An account that cannot save is told why
 * inside it. `open` is whether it is showing; the state is kept by `useSaveReading`.
 */
export function SaveReadingView({ step, open, problem, name, date, panelId, student = false, verses, screenLine, wholeLine, canChoose, onName, onDate, onVerses, onSubmit, onClose }: {
  step: SaveStep; open: boolean; problem: SaveProblem; name: string; date: string; panelId: string; student?: boolean; verses: SaveVerses;
  /** What is on screen, named with its range; the whole portion's range (null when there is no such choice); whether Choose verses is offered. */
  screenLine: string; wholeLine: string | null; canChoose: boolean;
  onName: (value: string) => void; onDate: (value: string) => void; onVerses: (value: SaveVerses) => void; onSubmit: () => void; onClose: () => void;
}) {
  const form = step === "form" || step === "saving", busy = step === "saving";
  const radio = (value: SaveVerses, label: ReactNode) => <label className={styles.radio}>
    <input type="radio" name={`${panelId}-verses`} value={value} checked={verses === value} disabled={busy} onChange={() => onVerses(value)} /><span>{label}</span></label>;
  return <Sheet open={open} onClose={onClose} title={SAVE_STRINGS.title} closeLabel="Close" dismissible={!busy}>
    <div className={styles.sheetBody} data-save-step={step}>
      {step === "not-eligible" && (student
        ? <p className={styles.line} data-save-student="">{STUDENT_LINE} <a href="/workspace/student?tab=reading">Open your reading</a></p>
        : <p className={styles.line}><a href="/account">Ask for an account to save readings</a></p>)}
      {step === "unavailable" && <p className={styles.line} role="status">Saving isn’t available right now. Try again.</p>}
      {form && <form id={panelId} className={styles.sheetForm} aria-label="Add this reading" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
        <div><label htmlFor={`${panelId}-name`}>Name</label>
          <input id={`${panelId}-name`} name="name" value={name} maxLength={80} required autoComplete="off" disabled={busy} onChange={event => onName(event.target.value)} /></div>
        <div><label htmlFor={`${panelId}-date`}>{SAVE_STRINGS.date}</label>
          <input id={`${panelId}-date`} name="date" type="date" value={date} disabled={busy} onChange={event => onDate(event.target.value)} /></div>
        <fieldset className={styles.verses}><legend>{SAVE_STRINGS.verses}</legend>
          {radio("screen", screenLine)}
          {wholeLine !== null && radio("whole", <>{SAVE_STRINGS.wholePortion} <span className={styles.optional}>{wholeLine}</span></>)}
          {canChoose && radio("choose", SAVE_STRINGS.chooseVerses)}
        </fieldset>
        {problem && <p className="request-error" role="alert">{problems[problem]}</p>}
        <button type="submit" className="button-primary" disabled={busy}>{SAVE_STRINGS.add}</button>
        <p className="field-help">{SAVE_STRINGS.keeps}</p>
      </form>}
    </div>
  </Sheet>;
}

/** What the sheet is about when it is not the passage on screen: a selection from the Choose verses bar, which is then the only choice. */
type Ask = Readonly<{ passage: SavablePassage; saved?: () => void }>;
export type SaveHandle = Readonly<{
  /** The pill for the title block; null once saved (the status line says so). */
  pill: Pill | null;
  /** The sheet, and the "Saved to My Readings." line for under the title. */
  sheet: ReactNode; note: ReactNode;
  step: SaveStep;
  /** Asks about the account and opens the sheet for a selection from the Choose verses bar. `spend` is the return-from-sign-in offer, spent by the first answer. */
  ask(request: Ask, spend?: { current: boolean }): void;
}>;

/**
 * Save on the public reader (accounts plan 5; C2). It asks about the account only when pressed: signed out the pill is "Sign in to save"
 * (a link that comes back to this reading, N20), an account that cannot save is told so in the sheet, and a member gets the sheet filled
 * with the passage's name and its Shabbat. A browser not seen signed in here starts on "Sign in to save" without asking. `offer`, once
 * true, is the return from sign-in: the sheet opens at once, as if pressed, and the offer is spent. `whole` is the whole portion's
 * ranges; `onChoose` starts Choose verses.
 */
export function useSaveReading({ passage, whole, back, offer, onChoose, onSaved }: { passage: SavablePassage | null; whole?: readonly string[] | null; back?: () => string | null;
  offer?: { current: boolean }; onChoose?(): void; onSaved?(): void }): SaveHandle {
  const base: SavablePassage = passage ?? { title: null, label: null, kind: "torah", ranges: [], date: null };
  const [step, setStep] = useState<SaveStep>("idle"), [problem, setProblem] = useState<SaveProblem>(null), [savedId, setSavedId] = useState<string | null>(null), [shown, setShown] = useState(false);
  const [fixed, setFixed] = useState<Ask | null>(null), [verses, setVerses] = useState<SaveVerses>("screen");
  const [name, setName] = useState(() => suggestedName(base)), [date, setDate] = useState(base.date ?? ""), [student, setStudent] = useState(false);
  const panelId = useId(), live = useRef<AbortController | null>(null);
  const subject = fixed?.passage ?? base;
  // Another passage on screen starts over; nothing typed for the last one carries across.
  const key = JSON.stringify([base.kind, base.ranges, base.date, base.title, base.label]);
  useLayoutEffect(() => { live.current?.abort(); setStep(signedInHint() ? "idle" : "signed-out"); setProblem(null); setShown(false); setFixed(null); setVerses("screen"); setName(suggestedName(base)); setDate(base.date ?? ""); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const next: SaveStep = list.state === "signed-out" ? "signed-out" : list.state === "not-eligible" ? "not-eligible" : "form";
      setStep(next); setShown(next !== "signed-out");
    }, () => { if (!controller.signal.aborted) { setStep("unavailable"); setShown(true); } });
  };
  const ask = (request: Ask | null, spend?: { current: boolean }) => {
    const target = request?.passage ?? base;
    setFixed(request); setVerses("screen"); setProblem(null); setName(suggestedName(target)); setDate(target.date ?? "");
    if (step === "form" || step === "not-eligible" || step === "unavailable") { setShown(true); if (spend) spend.current = false; return; }
    check(spend);
  };
  // Back from "Sign in to save": ask straight away; the first answer spends the offer. Back from a Google sign-in that
  // went straight to this reading (no offer, no hint yet): ask once, so a session that is here shows Save.
  useEffect(() => { if (offer?.current && passage) check(offer); else if (!signedInHint() && signInPending()) check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const effective = verses === "whole" && whole && !fixed ? whole : subject.ranges;
  const submit = () => {
    const trimmed = name.trim(), length = Array.from(trimmed).length;
    if (length < 1 || length > 80 || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) { setProblem("invalid"); return; }
    const controller = begin(); setStep("saving"); setProblem(null);
    createSavedReading({ name: trimmed, date: date || null, kind: subject.kind, ranges: effective.join("; ") }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) { setSavedId(result.reading.id); setStep("saved"); setShown(false); fixed?.saved?.(); onSaved?.(); return; }
      if (result.code === "signed-out" || result.code === "not-eligible") { rememberSignedIn(result.code !== "signed-out"); setStep(result.code); setShown(result.code === "not-eligible"); return; }
      setStep("form"); setProblem(result.code);
    });
  };
  const close = () => { live.current?.abort(); setShown(false); setProblem(null); setStep(current => current === "saving" ? "form" : current); };
  const wholeLine = !fixed && whole && whole.length > 0 ? rangeText(whole) : null;
  const open = shown && (step === "form" || step === "saving" || step === "not-eligible" || step === "unavailable");
  const sheet = <SaveReadingView step={step} open={open} problem={problem} name={name} date={date} panelId={panelId} student={student} verses={verses}
    screenLine={`${subject.label ?? kindName(subject.kind)} · ${rangeText(subject.ranges)}`} wholeLine={wholeLine} canChoose={Boolean(onChoose) && !fixed}
    onName={setName} onDate={setDate} onSubmit={submit} onClose={close}
    onVerses={value => { if (value === "choose") { close(); window.setTimeout(() => onChoose?.(), 0); return; } setVerses(value); }} />;
  const pill: Pill | null = !passage || step === "saved" ? null : step === "signed-out"
    ? { key: "save", label: "Sign in to save", icon: "bookmark", onClick: () => {}, signIn: back }
    : { key: "save", label: "Save", accessibleName: "Save to My Readings", icon: "bookmark", haspopup: "dialog", disabled: step === "checking" || step === "saving", onClick: () => ask(null) };
  const note = step === "saved" ? <p className={styles.savedNote} role="status">Saved to <a href="/">My Readings</a>. {savedId && <a href={savedReadingHref(savedId)}>{SAVE_STRINGS.open}</a>}</p> : null;
  return { pill, sheet, note, step, ask };
}

/** The Choose verses bar's Save: it opens the same sheet for the chosen verses (the only choice there), or, signed out, is the way to sign in and come back to them. */
export function SaveSelectionButton({ save, passage, onSaved, back, offer }: { save: SaveHandle; passage: SavablePassage; onSaved(): void; back: () => string | null; offer?: { current: boolean } }) {
  const request = useRef<{ passage: SavablePassage; saved: () => void }>({ passage, saved: onSaved }); request.current = { passage, saved: onSaved };
  // Back from sign-in with a selection: the bar opens already choosing, and Save asks at once.
  useEffect(() => { if (offer?.current) save.ask(request.current, offer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return save.step === "signed-out" ? <ReturnSignInLink className="button-secondary" back={back}>Sign in to save</ReturnSignInLink>
    : <button type="button" className="button-secondary" aria-haspopup="dialog" disabled={save.step === "checking" || save.step === "saving"} onClick={() => save.ask(request.current)}>Save</button>;
}
