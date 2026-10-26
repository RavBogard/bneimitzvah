"use client";
import { Fragment, useEffect, useState } from "react";
import { PRACTICE_DISCLOSURE } from "../../../lib/practice-visibility/copy";
import { PRACTICE_VISIBILITY_FROM, practiceVisibilityFrom } from "../../../lib/practice-visibility/release";

/**
 * 1.9 N23 (decision 7): the student is told what the tutor sees, on Account, in Learn and in child practice, and a parent is told on
 * Account. Behind the same release gate as every tutor and parent line (the server refuses those reads while the gate is closed), so
 * the disclosure is always present before any line about the student's practice can render for anyone else. `from` is the gate,
 * injectable for tests only.
 */
export function PracticeDisclosure({ place, from = PRACTICE_VISIBILITY_FROM }: { place: "account" | "learn"; from?: string | null }) {
  if (!practiceVisibilityFrom(from)) return null;
  return <p className="field-help" role="note" data-practice-disclosure={place}>{place === "learn" ? PRACTICE_DISCLOSURE.learn : PRACTICE_DISCLOSURE.account}</p>;
}

/** The parent line for one child, named (never a pronoun). In child practice the child sits with the parent and reads it too. */
export function ChildPracticeDisclosure({ name, place, from = PRACTICE_VISIBILITY_FROM }: { name: string; place: "child-practice" | "parent-account"; from?: string | null }) {
  if (!practiceVisibilityFrom(from) || !name) return null;
  const parts = PRACTICE_DISCLOSURE.parent.split("{name}");
  return <p className="field-help" role="note" data-practice-disclosure={place}>
    {parts.map((part, index) => <Fragment key={index}>{index > 0 && <bdi dir="auto">{name}</bdi>}{part}</Fragment>)}
  </p>;
}

/**
 * The parent's Account: one line per linked child, from the parent's own children list (the workspace API the parent's screens
 * already use). Nothing is asked while the gate is closed.
 */
export function ParentAccountDisclosure({ load, from = PRACTICE_VISIBILITY_FROM }: { load: () => Promise<readonly { id: string; firstName: string }[]>; from?: string | null }) {
  const [children, setChildren] = useState<readonly { id: string; firstName: string }[]>([]);
  const open = practiceVisibilityFrom(from) !== null;
  useEffect(() => {
    if (!open) { setChildren([]); return; }
    let live = true;
    void load().then(rows => { if (live) setChildren(rows); }, () => { if (live) setChildren([]); });
    return () => { live = false; };
  }, [open, load]);
  return open ? <ParentAccountDisclosureList names={children} from={from} /> : null;
}
export function ParentAccountDisclosureList({ names, from = PRACTICE_VISIBILITY_FROM }: { names: readonly { id: string; firstName: string }[]; from?: string | null }) {
  if (!practiceVisibilityFrom(from)) return null;
  return <>{names.map(child => <ChildPracticeDisclosure key={child.id} name={child.firstName} place="parent-account" from={from} />)}</>;
}

/**
 * Learn's disclosure for a signed-in student: Learn asks the student's own workspace API (as 1.9 N17's own reading does) only when
 * its progress sync says this browser is signed in, so a visitor, a parent, a tutor or an admin never sees it.
 */
export function LearnPracticeDisclosure({ signedIn, isStudent, from = PRACTICE_VISIBILITY_FROM }: { signedIn: boolean; isStudent: () => Promise<boolean>; from?: string | null }) {
  const [student, setStudent] = useState(false);
  const open = practiceVisibilityFrom(from) !== null;
  useEffect(() => {
    if (!open || !signedIn) { setStudent(false); return; }
    let live = true;
    void isStudent().then(value => { if (live) setStudent(value); }, () => { if (live) setStudent(false); });
    return () => { live = false; };
  }, [open, signedIn, isStudent]);
  return open && signedIn && student ? <PracticeDisclosure place="learn" from={from} /> : null;
}
