"use client";

import { courseDone, emptyProgress } from "../../../lib/learn/progress";
import { recommendedLesson } from "../../../lib/learn/recommendation";
import { useProgress } from "../../learn/services";
import { ButtonLink, List, ListRow, PageHeader } from "../../ui";
import { AccountRequest } from "../account-request";
import { useWorkspace } from "../workspace/provider";
import { shelfModel, type LearnRowState, type PinnedState, type ShelfSection } from "./model";
import { OwnReadings, useOwnReadings } from "./own-readings";
import styles from "./shelf.module.css";

/** My Readings (decision 7): the one place every non-admin role lands. Area D adds its sections as components beside these, each drawn from `shelfModel`'s list. */
export const SHELF_STRINGS = Object.freeze({
  title: "My Readings",
  add: "Add",
  foot: "Your tutor and the rabbi can see the readings you keep.",
  emptyHeading: "Add your first reading",
  thisShabbat: "This Shabbat",
  find: "Find a reading",
  linkTitle: "Preparing a Beit Mitzvah at CRC?",
  learnTitle: "Learn to lein",
  learnStart: "Start the course",
  account: "Account",
  accountMeta: " · roles, email, sign out",
});

/** The student's pinned reading, first on the shelf. Task E1 fills `pinned`; until then the section is never drawn. */
export function PinnedSection({ pinned }: { pinned: PinnedState }) {
  return <section className={styles.section} aria-label="Your assigned reading" data-testid="mine-pinned">
    <List><ListRow title={pinned.name} meta={[pinned.ceremony, pinned.total ? `${pinned.done} of ${pinned.total} verses` : null].filter(Boolean).join(" · ") || undefined} href={pinned.href} /></List>
  </section>;
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
  return <section className={styles.empty} aria-labelledby="shelf-empty-title" data-testid="mine-empty">
    {line && <p className={styles.emptyLine}>{line}</p>}
    <h2 id="shelf-empty-title" className={styles.emptyTitle}>{SHELF_STRINGS.emptyHeading}</h2>
    {/* Until the calendar of Task B1 exists the chips are the two fixed ones; B4 names this Shabbat's and the next two parashiyot. */}
    <div className={styles.chips}>
      <ButtonLink href="/read">{SHELF_STRINGS.thisShabbat}</ButtonLink>
      <ButtonLink href="/readings">{SHELF_STRINGS.find}</ButtonLink>
    </div>
    {linkable && <section className={styles.card} aria-labelledby="shelf-link-title">
      <h3 id="shelf-link-title" className={styles.cardTitle}>{SHELF_STRINGS.linkTitle}</h3>
      <AccountRequest level={4} />
    </section>}
  </section>;
}

export function ShelfFoot() { return <p className={styles.foot}>{SHELF_STRINGS.foot}</p>; }

/** Where the person is in the course, read from the same stored progress Learn uses; no network. */
function useLearnRow(): LearnRowState {
  const { progress: loaded } = useProgress(), progress = loaded ?? emptyProgress();
  if (courseDone(progress)) return { meta: null };
  const next = recommendedLesson(progress), started = Object.keys(progress.lessons).length > 0;
  return { meta: started && next ? next.title : SHELF_STRINGS.learnStart };
}

export function Shelf() {
  const { summary } = useWorkspace(), { state: own, retry } = useOwnReadings(), learn = useLearnRow();
  // The pinned reading arrives with Task E1.
  const pinned: PinnedState | null = null;
  const view = shelfModel({ summary, own, pinned, learn });
  const part = (section: ShelfSection) => section === "pinned" ? (pinned && <PinnedSection key={section} pinned={pinned} />)
    : section === "own" ? <OwnReadings key={section} state={own} onRetry={retry} />
      : section === "learn" ? <LearnSection key={section} learn={learn} /> : <AccountSection key={section} />;
  return <section className="role-workspace" data-testid="shelf" aria-busy={own.status === "loading"}>
    <PageHeader title={SHELF_STRINGS.title} actions={<ButtonLink href="/readings?add=1">{SHELF_STRINGS.add}</ButtonLink>} />
    {view.empty && <EmptyShelf line={view.empty.line} linkable={summary.roles.length === 0} />}
    {view.sections.map(part)}
    <ShelfFoot />
  </section>;
}
