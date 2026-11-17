"use client";
// Student gaps A3 and A5 (2026-11-16 review): the student's own reading reaches what Learn already built for it. The pinned card's next step opens Up close at a
// verse by address; Up close offers the step-by-step preparation of the verse on screen; the foot offers the Run-through. Nothing here reads or records anything:
// each is a link to an existing route, and the Run-through and preparation read the student's reading the way they always have.
import { useEffect, useRef, type MutableRefObject } from "react";
import { LearnReviewAction } from "../../learn/hero-actions";
import { preparationHref } from "../../../lib/learn/passage-preparation";
import type { Reading } from "./api";
import type { StudyKind } from "./study/api";
import { NEXT_STEP, runThroughHref, upCloseTarget } from "./today/model";

export const PREPARE_VERSE = "Learn this verse step by step";

/** Under the marks in Up close: the guided preparation (1.9 N17) of the verse on screen, not only the first verse. */
export function PrepareVerseLink({ kind, verseRef }: { kind: StudyKind; verseRef: string }) {
  return <a className="button-secondary" href={preparationHref(verseRef, kind)} data-testid="prepare-verse">{PREPARE_VERSE}</a>;
}

/** The student's rows in the reading's foot: the Run-through of the reading (1.9 N19), then the course review line when anything is due. */
export function StudentFootLinks({ readings }: { readings: readonly Pick<Reading, "kind">[] }) {
  return <><a href={runThroughHref(readings)} data-testid="reading-run-through">{NEXT_STEP.runThrough}</a><LearnReviewAction /></>;
}

/**
 * Arriving at /mine/reading#up-close (the pinned card's or the front door's next step): once the text is ready, Up close opens at the verse the address names,
 * or at the first verse on the page not marked Got it. Once per page load; an address that names no Up close does nothing.
 */
export function useUpCloseAddress(ready: boolean, upClose: MutableRefObject<((kind: StudyKind, ref: string) => boolean) | null>, openFirst: () => void) {
  const asked = useRef(false), first = useRef(openFirst); first.current = openFirst;
  useEffect(() => {
    if (asked.current || !ready) return;
    asked.current = true;
    const target = upCloseTarget(window.location.hash); if (!target) return;
    if (target === "first" || !upClose.current?.(target.kind, target.ref)) first.current();
  }, [ready, upClose]);
}
