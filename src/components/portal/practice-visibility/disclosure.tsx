"use client";
import { useEffect, useState } from "react";
import { PRACTICE_DISCLOSURE } from "../../../lib/practice-visibility/copy";
import { PRACTICE_VISIBILITY_FROM, practiceVisibilityFrom } from "../../../lib/practice-visibility/release";

/**
 * 1.9 N23 (decision 7): the student is told what the tutor sees, on Account and in Learn. Behind the same release gate as every
 * tutor and parent line (the server refuses those reads while the gate is closed), so the disclosure is always present before any
 * line about the student's practice can render for anyone else. `from` is the gate, injectable for tests only.
 */
export function PracticeDisclosure({ place, from = PRACTICE_VISIBILITY_FROM }: { place: "account" | "learn"; from?: string | null }) {
  if (!practiceVisibilityFrom(from)) return null;
  return <p className="field-help" role="note" data-practice-disclosure={place}>{place === "learn" ? PRACTICE_DISCLOSURE.learn : PRACTICE_DISCLOSURE.account}</p>;
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
