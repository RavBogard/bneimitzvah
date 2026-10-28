"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import { familyName, type Lesson } from "../../lib/learn/course";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import type { AnalysedVerse } from "../../lib/learn/verse";
import { soundAnchors, soundStep, startSound, type SoundExample, type SoundStage } from "../../lib/learn/sound-practice";
import { tropeLabel } from "../../lib/learn/marks";
import { AudioError, FamilyChip, phraseRequest, PlayTile, UnitsText } from "./bits";
import { useLearnServices, usePlayerState } from "./services";
import styles from "./learn.module.css";

const prompts: Record<SoundStage, string> = {
  model: "Listen to this phrase. When it stops, chant it back.", echo: "Chant it back in your own comfortable voice.",
  attempt: "Chant this phrase without the recording.", compare: "Then listen to the reader. What would help?",
  word: "Choose a word to work on.", tune: "Listen to the ending, then try the whole phrase.",
  unsure: "Start with one word, then return to the phrase.", context: "Hear where this phrase belongs in the verse.",
};
/** Production practice records no quiz answer, voice score or new progress state. */
export function SoundPractice({ lesson, verse, words, onExamples, onAnchors, onDone, onModeled }: {
  lesson: Lesson; verse: AnalysedVerse; words: readonly [number, number]; onExamples(): void; onAnchors?: () => void; onDone(): void; onModeled(family: FamilyId): void;
}) {
  const [state, dispatch] = useReducer(soundStep, undefined, startSound), [rate, setRate] = useState(1), [failed, setFailed] = useState(false);
  const { player } = useLearnServices(), playback = usePlayerState(), heading = useRef<HTMLHeadingElement>(null), previous = useRef(state.stage);
  const id = `sound:${lesson.id}:${verse.ref}:${state.stage}`, ids = ["model", "word", "ending", "context"].map(suffix => `${id}:${suffix}`);
  const silent = state.stage === "echo" || state.stage === "attempt";
  const stage = (next: SoundStage) => { player.stop(); dispatch({ type: "stage", stage: next }); };
  useEffect(() => {
    const node = heading.current; if (!node) return;
    node.focus({ preventScroll: true }); if (previous.current === state.stage) return;
    previous.current = state.stage;
    node.style.scrollMarginBlockStart = `${Math.ceil(node.closest("main")?.previousElementSibling?.getBoundingClientRect().height ?? 0) + 16}px`;
    node.scrollIntoView({ behavior: "instant", block: "start" });
  }, [state.stage]);
  useEffect(() => () => player.stop(), [player]);
  useEffect(() => { if (playback.status === "error" && playback.id?.startsWith(`sound:${lesson.id}:${verse.ref}:`)) setFailed(true); }, [playback, lesson.id, verse.ref]);
  const model = (range: readonly [number, number], label: string, suffix: string) => <PlayTile id={`${id}:${suffix}`} requests={[phraseRequest(verse, range)]} label={label} rate={rate}
    onPlayed={() => { if (suffix === "model") { setFailed(false); onModeled(verse.units[words[1]].family); } }} />;
  return <section className={styles.preparation} data-sound-stage={state.stage}>
    <h2 ref={heading} tabIndex={-1} className={styles.prompt}>{prompts[state.stage]}</h2>
    <div className={styles.stage}>
      <UnitsText verse={verse} units={state.stage === "context" ? undefined : words} playback={ids} className={styles.phraseLarge} look={unit => words[0] <= unit && unit <= words[1] ? "inked" : "plain"}
        onUnit={state.stage === "word" ? word => { player.stop(); dispatch({ type: "word", word }); } : undefined} unitLabel={word => `Work on word ${word + 1}`} />
      {!silent && model(state.stage === "context" ? [0, verse.units.length - 1] : words, state.stage === "context" ? "Hear the whole verse" : "Hear this phrase", state.stage === "context" ? "context" : "model")}
      <AudioError id={ids} />
      <p className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></p>
    </div>
    {!silent && <label className={styles.preparationSpeed}>Model speed <select value={rate} onChange={event => { player.stop(); setRate(Number(event.target.value)); }}>
      {[0.5, 0.75, 1].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>}
    {silent && <p>The recording is off. Take your time; listen again when you choose to compare.</p>}
    {state.stage === "model" && <p>Follow the words and the tune. You can open a word for syllables and stress, or try the phrase directly if it is familiar.</p>}
    {state.stage === "compare" && <>
      <p>Compare the words and the pattern you practiced in your own comfortable voice. This is your comparison; the app has not assessed your singing.</p>
      <div className={styles.preparationActions}>
        <button type="button" className="button-secondary" disabled={failed} onClick={() => dispatch({ type: "compare", comparison: "familiar" })}>The words and pattern felt familiar</button>
        <button type="button" className="button-secondary" onClick={() => { dispatch({ type: "compare", comparison: "revisit" }); stage("tune"); }}>I want to revisit the tune</button>
        <button type="button" className="button-secondary" onClick={() => stage("word")}>Work on a word</button>
        <button type="button" className="button-secondary" onClick={() => stage("unsure")}>I'm not sure</button>
      </div>
      {state.comparison === "familiar" && <p>Return to this phrase whenever you need it.</p>}
      {failed && <p>The model needs a successful retry before you compare. Replay the phrase, or work on the words.</p>}
    </>}
    {state.stage === "word" && state.word !== null && <div className={styles.preparationRepair}>
      <UnitsText verse={verse} units={[state.word, state.word]} className={styles.phraseStandard} />
      <p>Open this word for syllables and stress. Hear it, try it, then return to the phrase.</p>
      {model([state.word, state.word], "Hear this word", "word")}
    </div>}
    {state.stage === "tune" && <div className={styles.preparationRepair}>{model([words[1], words[1]], "Hear the ending", "ending")}<p>{lesson.listenFor}</p></div>}
    {state.stage === "unsure" && <div className={styles.preparationRepair}>
      <p>You can work on one word and then put it back in the phrase. An experienced reader can help if you want.</p>
      {model([words[0], words[0]], "Hear the first word", "word")}
    </div>}
    <details><summary>See the sound and its written cue</summary><FamilyChip family={verse.units[words[1]].family} melody={verse.kind} /><p>{lesson.listenFor}</p><p>Keep the actual words and this model together. The name is optional for chanting practice.</p></details>
    <div className={styles.preparationActions}>
      {state.stage === "model" && <button type="button" className="button-start" disabled={failed} onClick={() => stage("echo")}>Echo after the model stops</button>}
      {state.stage === "echo" && <button type="button" className="button-start" onClick={() => stage("attempt")}>Try from the text</button>}
      {state.stage === "attempt" && <button type="button" className="button-start" onClick={() => stage("compare")}>Compare with the reader</button>}
      {!silent && state.stage !== "model" && <button type="button" className="button-secondary" onClick={() => stage("attempt")}>Try again without the recording</button>}
      {state.stage === "model" && <button type="button" className="button-secondary" onClick={() => stage("attempt")}>Try this familiar phrase directly</button>}
      {["word", "tune", "unsure", "context"].includes(state.stage) && <button type="button" className="button-secondary" onClick={() => stage("model")}>Return to the whole phrase</button>}
      {state.stage === "compare" && <><button type="button" className="button-secondary" onClick={() => stage("context")}>Put the phrase in its verse</button><button type="button" className="button-secondary" onClick={onExamples}>More examples</button>{onAnchors && <button type="button" className="button-secondary" onClick={onAnchors}>Optional recognition practice</button>}</>}
      <button type="button" className="button-secondary" onClick={onDone}>Finish this practice</button>
    </div>
  </section>;
}

/** Models are separate from answer controls. An unplayed new family never joins the scored alternatives. */
export function SoundAnchors({ lesson, examples, taught, onModeled, onStart, onDone }: { lesson: Lesson; examples: ReadonlyMap<string, readonly SoundExample[]>; taught: ReadonlySet<FamilyId>; onModeled(family: FamilyId): void; onStart(): void; onDone(): void }) {
  const anchors = soundAnchors(lesson, examples);
  const { player } = useLearnServices();
  useEffect(() => () => player.stop(), [player]);
  return <section className={styles.preparation} data-sound-anchors="">
    <h2 className={styles.prompt}>Models for optional recognition</h2>
    <p>Hear and echo any sound you want to revisit. New sounds join the questions once their model has played, and you can finish without answering.</p>
    <p>Different words and readers can sound different. Keep the model available and listen for the pattern you practiced.</p>
    <ul className={styles.verses}>{anchors.map(({ family, phrase, verse }) => {
      const id = `anchor:${lesson.id}:${family}:${phrase.ref}`;
      return <li key={family} className={styles.soundAnchor}>
        <FamilyChip family={family} melody={verse.kind} />
        <UnitsText verse={verse} units={phrase.words} playback={[id]} className={styles.phraseStandard} look={() => "inked"} />
        <PlayTile id={id} requests={[phraseRequest(verse, phrase.words)]} label={`Hear ${familyName(family)}`} onPlayed={() => onModeled(family)} />
        {verse.units[phrase.words[1]].trope && <p>Ending mark in this model: {tropeLabel(verse.units[phrase.words[1]].trope!)}.</p>}
        <p className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi>{taught.has(family) ? " · Available in practice" : " · Hear this model before its questions"}</p><AudioError id={id} />
      </li>;
    })}</ul>
    <div className={styles.preparationActions}><button type="button" className="button-start" onClick={onStart}>Start optional questions</button><button type="button" className="button-secondary" onClick={onDone}>Finish without questions</button></div>
  </section>;
}
