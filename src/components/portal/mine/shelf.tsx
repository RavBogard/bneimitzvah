"use client";

import { useEffect, useState } from "react";
import { browserProgressStore, courseDone, emptyProgress, type Progress } from "../../../lib/learn/progress";
import { recommendedLesson } from "../../../lib/learn/recommendation";
import { ButtonLink, List, ListRow, PageHeader } from "../../ui";
import { useIdentity } from "../../site/identity-context";
import { ChildrenSection } from "./children";
import { AccountRequest } from "../account-request";
import { AccountRequestsLine } from "../workspace/accounts/workspace";
import { useWorkspace } from "../workspace/provider";
import { PINNED_HREF, pinnedOf, PinnedReadingCard, useStudentToday, type TodaySlices } from "../workspace/today/today";
import { shelfModel, type LearnRowState, type PinnedState, type ShelfSection } from "./model";
import { OwnReadings, useOwnReadings } from "./own-readings";
import { YourStudents } from "./your-students";
import { FindALearner } from "./find-a-learner";
import { MyTutorLine } from "./my-tutor";
import styles from "./shelf.module.css";

/** My Readings (decision 7): the one place every non-admin role lands. Area D adds its sections as components beside these, each drawn from `shelfModel`'s list. */
export const SHELF_STRINGS = Object.freeze({
  title: "My Readings",
  add: "Add",
  foot: "Tutors and the rabbi can see the readings you keep.",
  records: "What the site records about you",
  recordsHref: "/about#accounts",
  emptyHeading: "Add your first reading",
  thisShabbat: "This Shabbat",
  find: "Find a reading",
  linkTitle: (shortName: string) => `Preparing a Beit Mitzvah at ${shortName}?`,
  learnTitle: "Learn to lein",
  learnStart: "Start the course",
  account: "Account",
  accountMeta: " · roles, email, sign out",
});

/** The student's pinned reading, first on the shelf (E1). */
export function PinnedSection({ slices }: { slices: TodaySlices }) {
  return <section className={styles.section} aria-label="Your reading" data-testid="mine-pinned"><PinnedReadingCard slices={slices} /></section>;
}

/** The Learn row: the course, with where the person is in it. */
export function LearnSection({ learn }: { learn: LearnRowState }) {
  return <section className={styles.section} aria-label={SHELF_STRINGS.learnTitle} data-testid="mine-learn">
    <List><ListRow title={SHELF_STRINGS.learnTitle} meta={learn.meta ?? undefined} href="/learn" /></List>
  </section>;
}

/** The muted way to Account, which no longer has a place in the bar. */
export function AccountSection() {
  return <p className={styles.account}><a href="/account" data-testid="mine-account">{SHELF_STRINGS.account}</a><span>{SHELF_STRINGS.accountMeta}</span></p>;
}

/** The first sign-in: how to add a reading, and, for an account with no role, how to ask to be linked to a Beit Mitzvah. */
export function EmptyShelf({ line, linkable }: { line: string | null; linkable: boolean }) {
  const identity = useIdentity();
  return <section className={styles.empty} aria-labelledby="shelf-empty-title" data-testid="mine-empty">
    {line && <p className={styles.emptyLine}>{line}</p>}
    <h2 id="shelf-empty-title" className={styles.emptyTitle}>{SHELF_STRINGS.emptyHeading}</h2>
    {/* Until the calendar of Task B1 exists the chips are the two fixed ones; B4 names this Shabbat's and the next two parashiyot. */}
    <div className={styles.chips}>
      <ButtonLink href="/read">{SHELF_STRINGS.thisShabbat}</ButtonLink>
      <ButtonLink href="/readings">{SHELF_STRINGS.find}</ButtonLink>
    </div>
    {linkable && <section className={styles.card} aria-labelledby="shelf-link-title">
      <h3 id="shelf-link-title" className={styles.cardTitle}>{SHELF_STRINGS.linkTitle(identity.shortName)}</h3>
      <AccountRequest level={4} />
    </section>}
  </section>;
}

/** The foot line (decision 9), with the way to what the site records (plan D8, decision 16). */
export function ShelfFoot() { return <p className={styles.foot}>{SHELF_STRINGS.foot} <a href={SHELF_STRINGS.recordsHref}>{SHELF_STRINGS.records}</a></p>; }

/** Where the person is in the course, read from this browser's stored progress only: the shelf never syncs or writes Learn progress. */
function useLearnRow(): LearnRowState {
  const [loaded, setLoaded] = useState<Progress | null>(null);
  useEffect(() => { try { setLoaded(browserProgressStore().load()); } catch { setLoaded(null); } }, []);
  const progress = loaded ?? emptyProgress();
  if (courseDone(progress)) return { meta: null };
  const next = recommendedLesson(progress), started = Object.keys(progress.lessons).length > 0;
  return { meta: started && next ? next.title : SHELF_STRINGS.learnStart };
}

export function Shelf() {
  const { summary } = useWorkspace(), { state: own, retry } = useOwnReadings(), learn = useLearnRow();
  const slices = useStudentToday(summary.roles.includes("student")), found = pinnedOf(slices);
  const pinned: PinnedState | null = found && { name: found.name, ceremony: found.ceremony, done: found.done, total: found.total, href: PINNED_HREF };
  const student = summary.roles.includes("student"), tutor = summary.roles.includes("tutor");
  // A claim or removal in Find a learner refreshes Your students (tutor walk 2026-10-28, finding 6).
  const [studentsRound, setStudentsRound] = useState(0);
  const view = shelfModel({ summary, own, pinned, learn });
  const part = (section: ShelfSection) => section === "students" ? <YourStudents key={section} round={studentsRound} /> : section === "find" ? <FindALearner key={section} roles={summary.roles} onChange={() => setStudentsRound(value => value + 1)} />
    : section === "pinned" ? <PinnedSection key={section} slices={slices} />
    : section === "children" ? <ChildrenSection key={section} />
    : section === "own" ? <OwnReadings key={section} state={own} onRetry={retry} />
      : section === "learn" ? <LearnSection key={section} learn={learn} /> : <AccountSection key={section} />;
  return <section className="role-workspace" data-testid="shelf" aria-busy={own.status === "loading"}>
    <PageHeader title={SHELF_STRINGS.title} actions={student ? undefined : <ButtonLink href="/readings?add=1">{SHELF_STRINGS.add}</ButtonLink>} />
    {/* A tutor an admin chose to approve accounts sees waiting requests here (they were above the tutor's list, which is Your students now), as admins do on This week. */}
    {summary.approver && summary.roles.includes("tutor") && !summary.roles.includes("admin") && <AccountRequestsLine mode="tutor" />}
    {/* A tutor arrives to see students (finding 3): the first-reading prompt is for people with no roster, so staff (tutor or admin) never see it (re-walk 2026-10-28). */}
    {view.empty && !tutor && !summary.roles.includes("admin") && <EmptyShelf line={view.empty.line} linkable={summary.roles.length === 0} />}
    {view.sections.map(part)}
    <MyTutorLine />
    {student && <p className={styles.addQuiet}><a href="/readings?add=1">{SHELF_STRINGS.add}</a></p>}
    <ShelfFoot />
  </section>;
}
