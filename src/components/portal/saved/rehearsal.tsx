"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { practiceAgain, verseCardId, type VerseCardId } from "../../../lib/learn/verse-review";
import { useVerseTexts, VerseRunView } from "../../learn/verse-run";
import learnStyles from "../../learn/learn.module.css";
import { longDate } from "../mine/own-readings";
import { useWorkspace, WorkspaceLink } from "../workspace/provider";
import { answerSavedRehearsal, fetchSavedRehearsal, type RehearsalMark, type SavedRehearsal } from "./api";
import styles from "./saved.module.css";

const back = <WorkspaceLink href="/mine" className={learnStyles.backLink}>My Readings</WorkspaceLink>;
type Frame = (body: ReactNode, answers?: ReactNode) => ReactElement;

export function SavedRehearsalPage({ id }: { id: string }) {
  const { epoch } = useWorkspace();
  return <RehearsalOwner key={`${id}:${epoch}`} id={id} />;
}

function RehearsalOwner({ id }: { id: string }) {
  const { serviceAuthorityFailed } = useWorkspace();
  const [state, setState] = useState<SavedRehearsal | "loading" | "missing" | "failed">("loading");
  const [attempt, setAttempt] = useState(0), [changed, setChanged] = useState(false);
  const reload = () => { setState("loading"); setAttempt(n => n + 1); };
  function refused(status: number) {
    setState("missing");
    if (status !== 404) serviceAuthorityFailed(status);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetchSavedRehearsal(id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) setState(result.value);
      else if (result.code === "signed-out") refused(401);
      else if (result.code === "not-eligible") refused(403);
      else setState(result.code === "missing" ? "missing" : "failed");
    });
    return () => controller.abort();
  }, [id, attempt, serviceAuthorityFailed]);
  const ready = typeof state !== "string" ? state : null;
  const frame: Frame = (body, answers) => <article className={learnStyles.lesson}>
    <header className={styles.rehearsalHeader}>{back}<h1>Run-through</h1>
      {ready && <p><bdi>{ready.reading.name}</bdi> · <time dateTime={ready.reading.date!}>{longDate(ready.reading.date!)}</time></p>}
    </header>
    {changed && <p role="status">This reading changed. Run-through now uses the current verses.</p>}
    {body}
    {answers && <div className={learnStyles.footer}><div className={learnStyles.footerInner}>{answers}</div></div>}
  </article>;
  if (!ready) return frame(state === "loading" ? <p role="status">Loading the reading…</p> : state === "missing"
    ? <p role="status">This saved reading is unavailable for Run-through.</p>
    : <div role="status"><p>The saved reading didn’t load.</p><button type="button" className="button-secondary" onClick={reload}>Try again</button></div>);
  return <PrivateRehearsal snapshot={ready} frame={frame} onChanged={() => { setChanged(true); reload(); }} onRefused={refused} />;
}

function PrivateRehearsal({ snapshot, frame, onChanged, onRefused }: {
  snapshot: SavedRehearsal; frame: Frame; onChanged(): void; onRefused(status: number): void;
}) {
  const { registerDeparture } = useWorkspace();
  const { reading, verses } = snapshot;
  const [marks, setMarks] = useState(() => new Map(snapshot.marks.map(mark => [mark.ref, mark])));
  const [selected, setSelected] = useState<readonly VerseCardId[] | null>(null), [done, setDone] = useState(false), [notice, setNotice] = useState("");
  const pending = useRef<Promise<boolean> | null>(null), request = useRef<AbortController | null>(null);
  useEffect(() => registerDeparture(() => pending.current ?? Promise.resolve(true)), [registerDeparture]);
  useEffect(() => () => request.current?.abort(), []);

  const remaining = verses.filter(ref => marks.get(ref)?.retry);
  function begin(refs: readonly string[]) {
    setNotice("");
    setDone(false);
    setSelected(refs.map(ref => verseCardId(reading.kind, ref)));
  }
  const updateMark = (mark: RehearsalMark) => setMarks(current => new Map(current).set(mark.ref, mark));
  const answer = (ref: string, clean: boolean) => {
    if (pending.current) return Promise.resolve(false);
    const controller = new AbortController();
    request.current = controller;
    setNotice("Saving…");
    const work = answerSavedRehearsal({ readingId: reading.id, readingRevision: reading.revision, verseRef: ref, retry: !clean,
      expectedVersion: marks.get(ref)?.version ?? 0 }, controller.signal).then(result => {
      if (controller.signal.aborted) return false;
      if (result.ok) { updateMark(result.value); setNotice(""); return true; }
      if (result.code === "reading-changed") onChanged();
      else if (result.code === "signed-out" || result.code === "not-eligible" || result.code === "missing")
        onRefused(result.code === "signed-out" ? 401 : result.code === "not-eligible" ? 403 : 404);
      else if (result.code === "conflict" && result.current) {
        updateMark(result.current);
        setNotice("This verse was updated elsewhere. Choose Clean or Stumbled again.");
      } else setNotice("This answer couldn’t be saved. Try again.");
      return false;
    }).finally(() => { pending.current = null; request.current = null; });
    pending.current = work;
    return work;
  };
  if (!selected || done) {
    const again = practiceAgain(remaining);
    return frame(<>
      {done ? <p role="status">{again || "Run-through complete."}</p> : <p>Only you can see the verses you mark here.</p>}
      <div className={styles.actions}>
        {remaining.length > 0 && <button type="button" className="button-primary" onClick={() => begin(remaining)}>Resume with marked verses</button>}
        <button type="button" className={remaining.length ? "button-secondary" : "button-primary"} onClick={() => begin(verses)}>
          {remaining.length || done ? "Run through all verses" : "Start Run-through"}
        </button>
      </div>
    </>);
  }
  return <RehearsalRun ids={selected} frame={(body, answers) => frame(body, answers && <><div role="status">{notice}</div>{answers}</>)} onAnswer={answer} onDone={() => setDone(true)} />;
}

function RehearsalRun({ ids, frame, onAnswer, onDone }: { ids: readonly VerseCardId[]; frame: Frame; onAnswer(ref: string, clean: boolean): Promise<boolean>; onDone(): void }) {
  const [retry, setRetry] = useState(0), text = useVerseTexts(ids, retry);
  if (text.status === "loading") return frame(<p role="status">Loading the reading…</p>);
  if (text.status !== "ready" || text.verses.length !== ids.length) return frame(<div role="status"><p>The text of this reading did not load.</p>
    <button type="button" className="button-secondary" onClick={() => setRetry(n => n + 1)}>Try again</button></div>);
  const refs = new Map(text.verses.map(verse => [verse.id, verse.ref]));
  return <VerseRunView verses={text.verses} mode="run-through" review={null} frame={frame}
    onAnswer={(id, clean) => onAnswer(refs.get(id)!, clean)} onDone={onDone} />;
}
