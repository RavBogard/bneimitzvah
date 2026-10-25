"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import type { AnalysedVerse } from "../../lib/learn/verse";
import { independentPreparation, preparationJoin, preparationParts, preparationStep, startPreparation, type PreparationAction, type PreparationStage } from "../../lib/learn/preparation";
import { AudioError, FamilyChip, phraseRequest, PlayTile, UnitsText } from "./bits";
import { useLearnServices, usePlayerState } from "./services";
import styles from "./learn.module.css";

const prompts: Record<PreparationStage, string> = {
  model: "Listen once and follow the words.", words: "Read these words aloud. Open any word you want help with.",
  echo: "Listen to this phrase. When it stops, chant it back.", attempt: "Try it without the recording.",
  check: "Replay it and follow the words. What would help?", "word-repair": "Choose a word to work on.",
  "tune-repair": "Listen to the ending. Try the ending, then the whole phrase.",
  unsure: "Listen to a smaller part, then return to the phrase.", "join-model": "Now connect the two parts. Listen across the join, then try it.",
  "join-attempt": "Connect the parts without the recording.", "join-check": "How did the join feel?",
  "whole-attempt": "Chant the whole verse without the recording.", "whole-check": "Then listen and choose what to work on.", "choose-part": "Choose a part to practise.",
  recover: "If you lose your place, return to a part you know, find the next words, and continue.", summary: "A verse practised",
};
/** A learner-paced preparation loop. Only explicit model buttons start sound; attempts always stop it. */
export function GuidedPreparation({ verse, lein, onDone, onAnother }: { verse: AnalysedVerse; lein: string | null; onDone(): void; onAnother?: () => void }) {
  const [state, dispatch] = useReducer(preparationStep, undefined, startPreparation), [rate, setRate] = useState(1), [colors, setColors] = useState(true);
  const [repairTarget, setRepairTarget] = useState<"words" | "tune-repair" | "unsure">("words");
  const [comparisonFailed, setComparisonFailed] = useState(false);
  const { player } = useLearnServices(), playback = usePlayerState(), heading = useRef<HTMLHeadingElement>(null);
  const lastPrompt = useRef(`${state.stage}:${state.part}:${state.join}`);
  const parts = preparationParts(verse), part = parts[state.part], whole = [0, verse.units.length - 1] as const;
  const joinStage = state.stage.startsWith("join-"), wholeStage = ["model", "whole-attempt", "whole-check", "summary", "recover", "choose-part"].includes(state.stage) || state.stage === "word-repair" && state.repairScope === "whole";
  const range = wholeStage ? whole : joinStage ? preparationJoin(parts, state.join) : part;
  const id = `prepare:${verse.kind}:${verse.ref}:${state.stage}:${state.part}:${state.join}`;
  const independent = independentPreparation(state.stage), showModel = !independent && !["summary", "recover", "choose-part"].includes(state.stage);
  const go = (action: PreparationAction) => { player.stop(); dispatch(action); };
  const stage = (next: PreparationStage) => go({ type: "stage", stage: next });
  useEffect(() => {
    const node = heading.current; if (!node) return;
    node.focus({ preventScroll: true });
    const key = `${state.stage}:${state.part}:${state.join}`;
    if (lastPrompt.current === key) return; // Keep the initial page position, including Strict Mode's extra effect.
    lastPrompt.current = key;
    const bar = node.closest("main")?.previousElementSibling;
    // The mobile rail and safe-area padding make the sticky bar taller than on desktop.
    node.style.scrollMarginBlockStart = `${Math.ceil(bar?.getBoundingClientRect().height ?? 0) + 16}px`;
    node.scrollIntoView({ block: "start", behavior: "instant" });
  }, [state.stage, state.part, state.join]);
  useEffect(() => () => player.stop(), [player]);
  useEffect(() => {
    if (state.stage === "whole-check" && playback.status === "error" && playback.id === `${id}:model`) setComparisonFailed(true);
  }, [state.stage, playback, id]);
  const play = (words: readonly [number, number], label: string, suffix: string) => <PlayTile id={`${id}:${suffix}`} requests={[phraseRequest(verse, words)]} label={label} rate={rate}
    onPlayed={() => { if (state.stage === "whole-check" && suffix === "model") setComparisonFailed(false); }} />;
  const bindings = ["model", "ending", "word", "smaller"].map(suffix => `${id}:${suffix}`);
  const nextPart = () => go({ type: "next-part", count: parts.length });
  const chooseRepair = (target: "tune-repair" | "unsure") => { if (state.stage !== "whole-check") { stage(target); return; } setRepairTarget(target); stage("choose-part"); };
  const partPicker = (target: "words" | "tune-repair" | "unsure") => <label className={styles.preparationSpeed}>Choose a part to practise <select value="" onChange={event => go({ type: "part", part: Number(event.target.value), stage: target })}>
    <option value="" disabled>Choose a part</option>{parts.map((_, n) => <option key={n} value={n}>Part {n + 1}</option>)}</select></label>;
  const repairChoices = <div className={styles.preparationActions}>
    <button type="button" className="button-secondary" onClick={() => stage("word-repair")}>Work on a word</button>
    <button type="button" className="button-secondary" onClick={() => chooseRepair("tune-repair")}>Work on the tune</button>
    <button type="button" className="button-secondary" onClick={() => chooseRepair("unsure")}>I’m not sure</button>
  </div>;
  return <section className={styles.preparation} data-preparation-stage={state.stage}>
    <h2 ref={heading} tabIndex={-1} className={styles.sectionTitle}>{prompts[state.stage]}</h2>
    {state.stage === "model" && <p>You’ll learn this verse in short parts, then try it without the recording.</p>}
    {!wholeStage && !joinStage && <p className={styles.muted}>Part {state.part + 1} of {parts.length}</p>}
    {joinStage && <p className={styles.muted}>Parts {state.join + 1} and {state.join + 2}</p>}
    {state.stage !== "summary" && <div className={styles.stage}>
      <UnitsText verse={verse} units={range} playback={bindings} className={styles.phraseLarge}
        look={() => colors ? "inked" : "plain"} onUnit={state.stage === "word-repair" ? word => go({ type: "word", word, part: parts.findIndex(([a, b]) => a <= word && word <= b) }) : undefined}
        unitLabel={word => `Work on word ${word + 1}`} unitClass={word => state.stage === "word-repair" && word === state.word ? styles.underlined : undefined} />
      {showModel && play(range, wholeStage ? "Hear the whole verse" : joinStage ? "Hear the join" : "Hear the phrase", "model")}
      {playback.id?.startsWith(`${id}:`) && (playback.status === "playing" || playback.status === "paused") && <button type="button" className={styles.textButton}
        onClick={() => { if (playback.status === "paused") void player.resume(); else player.pause(); }}>{playback.status === "paused" ? "Resume recording" : "Pause recording"}</button>}
      <AudioError id={bindings} />
      <p className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></p>
    </div>}
    {showModel && <label className={styles.preparationSpeed}>Model speed <select value={rate} onChange={event => { player.stop(); setRate(Number(event.target.value)); }}>
      {[0.5, 0.75, 1].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>}
    {independent && <p>The recording is off. Use a comfortable voice. When you’re ready, open the model to compare.</p>}
    {state.stage === "words" && <p>Take the words at your own pace. Open a word for syllables and stress.</p>}
    {state.stage === "echo" && <p>Use a comfortable voice. Follow the tune and the words.</p>}
    {(state.stage === "check" || state.stage === "whole-check") && repairChoices}
    {state.stage === "whole-check" && partPicker("words")}
    {state.stage === "choose-part" && partPicker(repairTarget)}
    {state.stage === "recover" && partPicker("words")}
    {state.stage === "word-repair" && state.word !== null && <div className={styles.preparationRepair}>
      {/* The sounding outline stays in its phrase above; this duplicate is only the word-help target. */}
      <UnitsText verse={verse} units={[state.word, state.word]} className={styles.phraseStandard} />
      <p>Open this word for syllables and stress. Hear it, try it, then put it back in the phrase.</p>
      {play([state.word, state.word], "Hear this word", "word")}
    </div>}
    {state.stage === "tune-repair" && <div className={styles.preparationRepair}>
      {play([part[1], part[1]], "Hear the ending", "ending")}
      <details><summary>See the mark for this ending</summary><FamilyChip family={verse.units[part[1]].family} melody={verse.kind} /><p>Follow this ending in the phrase above. The name is optional for this practice.</p></details>
    </div>}
    {state.stage === "unsure" && <div className={styles.preparationRepair}>
      <p>You don’t have to decide what was wrong. Start with one word, replay the phrase, and try it again. A tutor or another experienced reader can help if you want.</p>
      {play([part[0], part[0]], "Hear the first word", "smaller")}
    </div>}
    {state.stage === "join-check" && <div className={styles.preparationActions}>
      <button type="button" className="button-secondary" onClick={() => stage("join-model")}>Practise the join again</button>
      <button type="button" className="button-secondary" onClick={() => go({ type: "part", part: state.join })}>Practise the first part</button>
    </div>}
    {state.stage === "whole-check" && <div className={styles.preparationActions}>
      <button type="button" className="button-start" disabled={comparisonFailed} onClick={() => go({ type: "self-report", same: true })}>Same as the reader</button>
      <button type="button" className="button-secondary" onClick={() => { setRepairTarget("words"); go({ type: "self-report", same: false }); }}>Not yet</button>
      {parts.length > 1 && <button type="button" className="button-secondary" onClick={() => stage("join-model")}>Practise the join</button>}
      <button type="button" className="button-secondary" onClick={() => stage("whole-attempt")}>Try the whole verse again</button>
    </div>}
    {state.stage === "whole-check" && comparisonFailed && <p>The comparison recording needs a successful retry. Replay the whole verse, work on a part, or return later.</p>}
    {state.stage === "recover" && <p>Choose a familiar part below. Try from there, then connect it to the next part. This is a practice strategy; ask your congregation about public-reading customs.</p>}
    {state.stage === "summary" ? <>
      {state.selfComparison === "same" && <><p>You can lein this verse.</p><p>Based on your comparison with the reader. This app hasn’t assessed your voice.</p></>}
      {/* Daniel 2026-10-24, answer 1 ("Keep ours, gated"): the only ending line is "You can lein this verse.", after "Same as the reader". */}
      <p>Return later: try the part you prepared before replay. Revisit anything uncertain.</p>
      <div className={styles.preparationActions}>
        <button type="button" className="button-secondary" onClick={() => stage("whole-attempt")}>Try this verse before replay</button>
        {onAnother && <button type="button" className="button-secondary" onClick={() => { player.stop(); onAnother(); }}>Prepare another verse</button>}
        {lein && <a className="button-secondary" href={lein}>Open in Lein</a>}
        <button type="button" className="button-start" onClick={() => { player.stop(); onDone(); }}>Finish practice</button>
      </div>
    </> : <>
      <div className={styles.preparationActions}>
        {state.stage === "model" && <><button type="button" className="button-start" onClick={() => stage("words")}>Prepare the first part</button><button type="button" className="button-secondary" onClick={() => stage("whole-attempt")}>Go straight to a whole-verse attempt</button></>}
        {state.stage === "words" && <button type="button" className="button-start" onClick={() => stage("echo")}>Hear and echo</button>}
        {state.stage === "echo" && <button type="button" className="button-start" onClick={() => stage("attempt")}>Try without the recording</button>}
        {state.stage === "attempt" && <button type="button" className="button-start" onClick={() => stage("check")}>Compare with the model</button>}
        {state.stage === "check" && <button type="button" className="button-start" onClick={nextPart}>{state.part + 1 < parts.length ? "Prepare the next part" : parts.length > 1 ? "Connect the parts" : "Try the whole verse"}</button>}
        {["word-repair", "tune-repair", "unsure"].includes(state.stage) && <button type="button" className="button-start" onClick={() => stage("echo")}>Return to the whole phrase</button>}
        {state.stage === "join-model" && <button type="button" className="button-start" onClick={() => stage("join-attempt")}>Try the join without the recording</button>}
        {state.stage === "join-attempt" && <button type="button" className="button-start" onClick={() => stage("join-check")}>Compare the join</button>}
        {state.stage === "join-check" && <button type="button" className="button-start" onClick={() => go({ type: "next-join", count: parts.length })}>{state.join + 1 < parts.length - 1 ? "Connect the next parts" : "Try the whole verse"}</button>}
        {state.stage === "whole-attempt" && <button type="button" className="button-start" onClick={() => stage("whole-check")}>Compare the whole verse</button>}
      </div>
      <details className={styles.preparationHelp}><summary>Choose a part or use less help</summary>
        <label>Practise part <select value={state.part} onChange={event => go({ type: "part", part: Number(event.target.value) })}>{parts.map((_, n) => <option key={n} value={n}>Part {n + 1}</option>)}</select></label>
        <button type="button" className={styles.textButton} onClick={() => go({ type: "part", part: state.part })}>Open this part</button>
        <label><input type="checkbox" checked={colors} onChange={event => setColors(event.target.checked)} /> Show phrase colors</label>
        <p>Try familiar words with less help. In Lein, the Tikkun menu offers pointed text, side by side, or letters only. Open the pointed text wherever you need it.</p>
        {lein && <a href={lein}>Practise this verse in Lein</a>}
        <button type="button" className={styles.textButton} onClick={() => stage("recover")}>Find a starting point after a stumble</button>
      </details>
      <button type="button" className={styles.textButton} onClick={() => stage("summary")}>Return later</button>
    </>}
  </section>;
}
