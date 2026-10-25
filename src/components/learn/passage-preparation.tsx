"use client";
import { useEffect, useRef, useState } from "react";
import type { Melody } from "../../lib/learn/course";
import { analyseVerse, type AnalysedVerse } from "../../lib/learn/verse";
import { passageBoundary, passageReference, passageRunEnd, preparationHref, referencePassageFlags, selectedPassage } from "../../lib/learn/passage-preparation";
import { isRateLimited } from "../portal/public-reading/rate-limited";
import { AudioError, LoadFailure, phraseRequest, PlayTile, UnitsText } from "./bits";
import { GuidedPreparation } from "./guided-preparation";
import { LearnAppBar } from "./home";
import { leinHref } from "./lein-link";
import { LearnServices, useLearnServices } from "./services";
import { useWeekVerses, type WeekVerses } from "./week-data";
import styles from "./passage-preparation.module.css";

type Target = { ref: string | null; kind: Melody };
type PassageData = { status: "ready"; verses: readonly AnalysedVerse[]; label: string; reading: string };
type Stage = "choose" | "preview" | "verse" | "boundary" | "boundary-attempt" | "boundary-check" | "attempt" | "compare" | "recover" | "summary";

/** This page only accepts a public reference. Account assignments and progress never enter this flow. */
export function PassagePreparation({ target }: { target: Target | null }) {
  return <div className={`portal-shell ${styles.shell}`}><a className="skip-link" href="#passage-main">Skip to passage preparation</a><LearnAppBar />
    <main id="passage-main" className={styles.main}><a href="/learn">Learn to lein</a><h1>Prepare a passage</h1>
      <p>Choose a short section. Learn its parts, connect the verses, then try without the recording.</p>
      <LearnServices>{target ? <PassageSource key={`${target.kind}:${target.ref}`} target={target} /> : <div role="status"><p>This reference cannot be opened. Choose a Torah or haftarah reading.</p><a href="/learn/prepare">Use this week's Torah reading</a><p><a href="/read">Choose a reading in Lein</a></p></div>}</LearnServices>
    </main></div>;
}

function PassageSource({ target }: { target: Target }) {
  const [retry, setRetry] = useState(0), { player } = useLearnServices();
  const retryLoad = () => { player.stop(); setRetry(value => value + 1); };
  return <><nav className={styles.actions} aria-label="Preparation reading"><a href="/learn/prepare" aria-current={target.kind === "torah" && !target.ref ? "page" : undefined}>This week's Torah</a><a href="/learn/prepare?kind=haftarah" aria-current={target.kind === "haftarah" && !target.ref ? "page" : undefined}>This week's haftarah</a><a href="/read">Choose another reading in Lein</a></nav>
    {target.ref ? <ReferencePassage target={{ ...target, ref: target.ref }} retry={retry} onRetry={retryLoad} /> : <WeekPassage kind={target.kind} retry={retry} onRetry={retryLoad} />}
    <details className={styles.help}><summary>Open a different public passage</summary><form action="/learn/prepare" method="get" className={styles.form}>
      <label>Reference <input name="ref" required placeholder="Genesis 12:1-3" defaultValue={target.ref ?? ""} /></label>
      <label>Melody <select name="kind" defaultValue={target.kind}><option value="torah">Torah</option><option value="haftarah">Haftarah</option></select></label>
      <button className="button-secondary" type="submit">Open passage</button>
    </form></details></>;
}

function WeekPassage({ kind, retry, onRetry }: { kind: Melody; retry: number; onRetry(): void }) {
  const week = useWeekVerses(kind, retry);
  if (week.status === "loading") return <p role="status">Loading the reading…</p>;
  if (week.status === "error") return <><LoadFailure rateLimited={week.rateLimited} onRetry={onRetry} /><p><a href={`/read${kind === "haftarah" ? "?kind=haftarah" : ""}`}>Open the reading in Lein</a></p></>;
  if (week.status === "none") return <div role="status"><p>No {kind === "haftarah" ? "haftarah" : "Torah"} passage is available for these weeks.</p><button type="button" className="button-secondary" onClick={onRetry}>Try again</button><p><a href="/read">Choose another reading in Lein</a></p></div>;
  return <LoadedPassage key={`${kind}:${week.date}:${retry}`} data={weekData(week, kind)} onRetry={onRetry} />;
}

function weekData(week: Extract<WeekVerses, { status: "ready" }>, kind: Melody): PassageData {
  return { status: "ready", verses: week.verses, label: `${week.shifted ? "The coming Shabbat's" : "This week's"} ${kind === "torah" ? "Torah" : "haftarah"} reading`, reading: leinHref({ date: week.date, kind, verse: 1 }) };
}

function ReferencePassage({ target, retry, onRetry }: { target: { ref: string; kind: Melody }; retry: number; onRetry(): void }) {
  const { loader, audio } = useLearnServices(), [data, setData] = useState<PassageData | { status: "loading" } | { status: "error"; rateLimited: boolean }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setData({ status: "loading" });
    (async () => {
      const loaded = await loader.passage(target.ref, target.kind);
      const assets = loaded.map(verse => verse.short?.verse.playback.status === "ready" ? verse.short.verse.playback.asset : null);
      const verses = (await Promise.all(loaded.map(async (verse, index) => analyseVerse({ ref: verse.ref, kind: target.kind, hebrew: verse.hebrew,
        ...referencePassageFlags(assets, index),
        wordReady: !!verse.short?.source && await audio.wordReady(verse.ref, target.kind, controller.signal), passage: { ref: target.ref, index, count: loaded.length } }))))
        .filter((verse): verse is AnalysedVerse => verse !== null);
      if (!controller.signal.aborted) setData({ status: "ready", verses, label: target.ref, reading: leinHref({ ref: target.ref, kind: target.kind, verse: 1 }) });
    })().catch(error => { if (!controller.signal.aborted) setData({ status: "error", rateLimited: isRateLimited(error) }); });
    return () => controller.abort();
  }, [target.ref, target.kind, retry, loader, audio]);
  if (data.status === "loading") return <p role="status">Loading the reading…</p>;
  if (data.status === "error") return <><LoadFailure rateLimited={data.rateLimited} onRetry={onRetry} /><p><a href={leinHref({ ref: target.ref, kind: target.kind, verse: 1 })}>Open this passage in Lein</a></p></>;
  return <LoadedPassage key={`${target.ref}:${retry}`} data={data} onRetry={onRetry} />;
}

function LoadedPassage({ data, onRetry }: { data: PassageData; onRetry(): void }) {
  const { player } = useLearnServices();
  const first = data.verses.findIndex(verse => verse.wordReady);
  const [start, setStart] = useState(Math.max(0, first)), [end, setEnd] = useState(Math.min(Math.max(0, first) + 1, passageRunEnd(data.verses, Math.max(0, first))));
  const [stage, setStage] = useState<Stage>("choose"), [verseIndex, setVerseIndex] = useState(0), [boundaryIndex, setBoundaryIndex] = useState(0), [restart, setRestart] = useState(0);
  const [colors, setColors] = useState(true), heading = useRef<HTMLHeadingElement>(null), lastStage = useRef(stage);
  useEffect(() => {
    if (lastStage.current !== stage) { lastStage.current = stage; heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "nearest" }); }
  }, [stage]);
  useEffect(() => () => player.stop(), [player]);
  const go = (next: Stage) => { player.stop(); setStage(next); };
  const selected = selectedPassage(data.verses, start, end), ref = passageReference(selected), kind = selected[0]?.kind;
  const wholeRequests = selected.map(verse => phraseRequest(verse, [0, verse.units.length - 1]));
  const activeVerse = selected[verseIndex] ?? selected[0], left = selected[boundaryIndex], right = selected[boundaryIndex + 1], boundary = left && right ? passageBoundary(left, right) : null;
  const lein = ref && kind ? leinHref({ ref, kind, verse: 1 }) : data.reading;
  const nextPassageStart = data.verses.findIndex((verse, index) => index > end && verse.wordReady);
  const otherPassageStart = nextPassageStart >= 0 ? nextPassageStart : data.verses.findIndex((verse, index) => index < start && verse.wordReady);
  const repairVerse = (index: number) => { setVerseIndex(index); go("verse"); };
  const repairBoundary = (index: number) => { setBoundaryIndex(index); go("boundary"); };
  const title: Record<Stage, string> = { choose: "Choose a manageable section", preview: "Listen through and choose a part", verse: `Prepare ${activeVerse?.ref ?? "a verse"}`, boundary: "Connect two verses", "boundary-attempt": "Try across the boundary", "boundary-check": "Compare and choose what helps", attempt: "Chant the section without the recording", compare: "Listen afterward and choose one repair", recover: "Find a known place and continue", summary: "A passage practised" };
  const passageText = (playback: string | null) => <div className={styles.score}>{selected.map((verse, index) => <div key={verse.ref}><p className={styles.reference}>{verse.ref}</p><UnitsText verse={verse} card={stage !== "attempt"} look={() => colors ? "inked" : "plain"} playback={playback ? [{ id: playback, part: index }] : []} /></div>)}</div>;
  const choices = <div className={styles.repair}><h3>Choose anything uncertain</h3><p>Work on words or tune in a verse, or reconnect two verses. “I'm not sure” is a useful reason to revisit a part.</p><div className={styles.actions}>{selected.map((verse, index) => <button key={verse.ref} type="button" className="button-secondary" onClick={() => repairVerse(index)}>Revisit {verse.ref}</button>)}{selected.slice(1).map((verse, index) => <button key={verse.ref} type="button" className="button-secondary" onClick={() => repairBoundary(index)}>Boundary: {selected[index].ref} → {verse.ref}</button>)}</div></div>;
  return <section className={styles.preparation} data-passage-stage={stage} aria-labelledby="passage-step">
    <p className={styles.reference}>{data.label}</p><h2 ref={heading} tabIndex={-1} id="passage-step">{title[stage]}</h2>
    {stage === "choose" ? <>
      <p>Start with an amount you can work on today, considering unfamiliar words, length and how much of the tune you know. You can change the section whenever you need.</p>
      {first < 0 ? <div role="status"><p>A practice recording isn't available for this passage yet. Open the reading in Lein or try again.</p><button type="button" className="button-secondary" onClick={onRetry}>Try again</button><p><a href={data.reading}>Read this passage in Lein</a></p></div> : <>
        {data.verses.some(verse => !verse.wordReady) && <p role="status">Some verses don't have a practice recording yet. Select an available section below, or <a href={data.reading}>keep the full reading open in Lein</a>.</p>}
        <div className={styles.form}><label>Start at <select value={start} onChange={event => { player.stop(); const n = Number(event.target.value); setStart(n); setEnd(Math.min(n + 1, passageRunEnd(data.verses, n))); }}>{data.verses.map((verse, index) => <option key={verse.ref} value={index} disabled={!verse.wordReady}>{verse.ref}{verse.wordReady ? "" : " — text only"}</option>)}</select></label>
          <label>Through <select value={end} onChange={event => { player.stop(); setEnd(Number(event.target.value)); }}>{data.verses.slice(start, passageRunEnd(data.verses, start) + 1).map((verse, index) => <option key={verse.ref} value={start + index}>{verse.ref}</option>)}</select></label></div>
        {ref && <><p>{ref} · {selected.reduce((total, verse) => total + verse.wordCount, 0)} words</p>{passageText(null)}<button type="button" className="button-start" onClick={() => { setVerseIndex(0); setBoundaryIndex(0); setRestart(0); go("preview"); }}>Prepare this section</button></>}
      </>}
    </> : <>
      <p className={styles.reference}>{ref}</p>
      {stage === "verse" && activeVerse ? <><GuidedPreparation key={activeVerse.ref} verse={activeVerse} lein={leinHref({ ref: ref!, kind: kind!, verse: verseIndex + 1 })} onDone={() => {
        if (verseIndex + 1 < selected.length) { player.stop(); setVerseIndex(value => value + 1); } else go(selected.length > 1 ? "boundary" : "attempt");
      }} /><div className={styles.actions}>{selected.map((verse, index) => <button key={verse.ref} type="button" className="button-secondary" onClick={() => repairVerse(index)} aria-pressed={index === verseIndex}>{verse.ref}</button>)}</div></> : null}
      {stage === "preview" && <><p>Listen through, then choose the first useful part to prepare. You can start with any verse or try the section first.</p>{passageText("passage-model")}<PlayTile id="passage-model" requests={wholeRequests} label="Hear the section's verse models" /><AudioError id="passage-model" /><p className={styles.note}>Separate verse models play with a short gap. Their spacing or a change of reader is not a model of a natural transition.</p><div className={styles.actions}>{selected.map((verse, index) => <button key={verse.ref} type="button" className="button-secondary" onClick={() => repairVerse(index)}>Prepare {verse.ref}</button>)}</div></>}
      {["boundary", "boundary-attempt", "boundary-check"].includes(stage) && boundary && <>
        <p>The last complete phrase of {left.ref}, then the first complete phrase of {right.ref}. Find the new verse's opening before you continue.</p>
        <div className={styles.score}><p className={styles.reference}>{left.ref} · final phrase</p><UnitsText verse={left} units={boundary.left} card={stage !== "boundary-attempt"} look={() => colors ? "inked" : "plain"} playback={[{ id: "boundary-model", part: 0 }, { id: "boundary-context", part: 0 }]} /><p className={styles.reference}>{right.ref} · opening phrase</p><UnitsText verse={right} units={boundary.right} card={stage !== "boundary-attempt"} look={() => colors ? "inked" : "plain"} playback={[{ id: "boundary-model", part: 1 }, { id: "boundary-context", part: 1 }]} /></div>
        {stage === "boundary-attempt" ? <><p>Connect the phrases aloud, then continue through both verses. The recording is stopped.</p><button type="button" className="button-start" onClick={() => go("boundary-check")}>Compare this boundary</button></> : <>
          <div className={styles.actions}><PlayTile id="boundary-model" requests={[phraseRequest(left, boundary.left), phraseRequest(right, boundary.right)]} label="Hear the two phrase models" /><PlayTile id="boundary-context" requests={[phraseRequest(left, [0, left.units.length - 1]), phraseRequest(right, [0, right.units.length - 1])]} label="Hear both surrounding verse models" /></div><AudioError id={["boundary-model", "boundary-context"]} />
          <p className={styles.note}>These are separate verse models with a short gap, not a continuous transition recording. Use them to recall the ending and opening; then connect the text yourself.</p>
          <div className={styles.actions}><button type="button" className="button-start" onClick={() => go("boundary-attempt")}>Try this boundary without the recording</button><button type="button" className="button-secondary" onClick={() => repairVerse(boundaryIndex + 1)}>Revisit the new verse's opening</button>{boundaryIndex + 2 < selected.length && <button type="button" className="button-secondary" onClick={() => repairBoundary(boundaryIndex + 1)}>Connect the next verses</button>}</div>
        </>}
      </>}
      {stage === "attempt" && <><p>The reference is stopped: use the text to chant the whole section. Replay anything you want to check afterward.</p>{passageText(null)}<button type="button" className="button-start" onClick={() => go("compare")}>Compare after my attempt</button></>}
      {stage === "compare" && <><p>Replay if useful. Choose an uncertain verse or boundary below, repair it, then try the section again.</p>{passageText("passage-compare")}<PlayTile id="passage-compare" requests={wholeRequests} label="Compare with the section's verse models" /><AudioError id="passage-compare" /><p className={styles.note}>Separate verse models play with a short gap.</p>{choices}<div className={styles.actions}><button type="button" className="button-secondary" onClick={() => go("recover")}>Practise finding my place</button><button type="button" className="button-secondary" onClick={() => go("summary")}>Choose a return point</button></div></>}
      {stage === "recover" && <><p>If you lose your place, return to a part you know, find the next words, and continue. Choose a familiar verse below, read its opening, chant it and carry on into what follows.</p><label>Restart at <select value={restart} onChange={event => { player.stop(); setRestart(Number(event.target.value)); }}>{selected.map((verse, index) => <option key={verse.ref} value={index}>{verse.ref}</option>)}</select></label><div className={styles.score}>{selected.slice(restart).map(verse => <div key={verse.ref}><p className={styles.reference}>{verse.ref}</p><UnitsText verse={verse} card={false} look={() => colors ? "inked" : "plain"} /></div>)}</div><div className={styles.actions}><button type="button" className="button-start" onClick={() => go("attempt")}>Try the section again</button><button type="button" className="button-secondary" onClick={() => repairVerse(restart)}>Prepare this restart verse</button></div></>}
      {stage === "summary" && <><p>You've practised a way to prepare: work on the parts, connect them, try without the recording, and return to anything uncertain.</p><p>When you return, try this section before replay. Notice what faded and choose one useful repair.</p>{choices}<p><a href={preparationHref(ref!, kind!)}>Return later to {ref}</a></p><p className={styles.note}>This link reopens the public text. It doesn't save your practice step.</p>
        {otherPassageStart >= 0 ? <button type="button" className="button-start" onClick={() => { const n = otherPassageStart; setStart(n); setEnd(Math.min(n + 1, passageRunEnd(data.verses, n), n < start ? start - 1 : data.verses.length - 1)); go("choose"); }}>Prepare another passage</button>
          : <form action="/learn/prepare" method="get" className={styles.form}><label>Different passage reference <input name="ref" required placeholder={kind === "haftarah" ? "Isaiah 40:3-5" : "Genesis 12:3-5"} /></label><input type="hidden" name="kind" value={kind} /><button type="submit" className="button-start">Prepare another passage</button></form>}
        <p>Choose different material and use the same preparation steps. The reading tools remain available.</p></>}
      <nav className={styles.actions} aria-label="Passage practice">{stage !== "attempt" && <button type="button" className="button-secondary" onClick={() => go("attempt")}>Try the whole section without the recording</button>}{selected.length > 1 && !stage.startsWith("boundary") && <button type="button" className="button-secondary" onClick={() => repairBoundary(0)}>Practise a verse boundary</button>}<button type="button" className="button-secondary" onClick={() => go("choose")}>Change the section</button></nav>
      <details className={styles.help}><summary>Use fewer cues or try Tikkun</summary><label><input type="checkbox" checked={colors} onChange={event => setColors(event.target.checked)} /> Show phrase colors</label><p>For familiar text, try fewer cues. Lein's Tikkun menu shows the same words side by side or in letters only, with the pointed text whenever you need it.</p><a href={lein}>Open this exact section in Lein / Tikkun</a></details>
    </>}
  </section>;
}
