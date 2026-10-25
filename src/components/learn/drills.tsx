"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import { familyName, type Melody, type TropeId } from "../../lib/learn/course";
import { tropeLabel, tropeSample, isConjunctive } from "../../lib/learn/marks";
import { phraseAt, type BuildItem, type DrillItem, type EndItem, type HalfItem, type LookItem, type LookSide, type NameItem, type Phrase, type Pools, type SameItem, type TapItem } from "../../lib/learn/pools";
import { LEADS_ON, type AnalysedVerse } from "../../lib/learn/verse";
import { DRAFTED, lookTell } from "./activity-copy";
import { AudioError, ContourMark, FamilyChip, icons, phraseRequest, phraseStyle, PlayTile, UnitsText } from "./bits";
import { useLearnServices, usePlayerState } from "./services";
import styles from "./learn.module.css";

export type DrillProps<I extends DrillItem> = Readonly<{ item: I; pools: Pools; melody: Melody; prompt?: string;
  /** A phrase of this family from another verse, for the contrast after a miss. */
  contrast(family: FamilyId, avoid: readonly string[]): Phrase | null;
  onAnswer(right: boolean): void }>;
const request = (phrase: Phrase) => phraseRequest(phrase, phrase.words);
const verseOf = (pools: Pools, phrase: Phrase) => pools.verses.get(phrase.ref) ?? null;
const melodyName = (melody: Melody) => melody === "torah" ? "Torah" : "Haftarah";
/** Plays when the item opens; the tile replays it. */
function useAutoplay(id: string, requests: Parameters<ReturnType<typeof useLearnServices>["player"]["play"]>[1], enabled = true) {
  const { player } = useLearnServices(), played = useRef(false);
  useEffect(() => { if (!enabled || played.current) return; played.current = true; void player.play(id, requests); }, [id, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
function Answer({ verse, phrase, id }: { verse: AnalysedVerse; phrase: Phrase; id: string }) {
  return <div className={styles.answer} data-answer>
    <UnitsText playback={[id, `${id}:compare`, `${id}:verse`]} verse={verse} className={styles.phraseStandard} look={unit => unit >= phrase.words[0] && unit <= phrase.words[1] ? "inked" : "plain"} />
    <div className={styles.answerHead}><span className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></span><FamilyChip family={phrase.family} melody={phrase.kind} />
      <PlayTile id={`${id}:verse`} requests={[phraseRequest(verse, [0, verse.units.length - 1])]} label="Whole verse" /></div>
  </div>;
}

/** Hear and name: a phrase plays; two to four family chips; the right one takes its colour. */
export function HearAndName({ item, pools, melody, contrast, onAnswer }: DrillProps<NameItem>) {
  const { player } = useLearnServices(), id = `name:${item.key}`, [chosen, setChosen] = useState<FamilyId | null>(null), [compared, setCompared] = useState(false);
  const verse = verseOf(pools, item.answer);
  useAutoplay(id, [request(item.answer)]);
  const pick = (family: FamilyId) => {
    if (chosen) return; setChosen(family);
    const right = family === item.answer.family;
    if (!right) { const other = contrast(family, [item.answer.ref]); setCompared(!!other); void player.play(`${id}:compare`, other ? [request(item.answer), request(other)] : [request(item.answer)]); }
    onAnswer(right);
  };
  return <>
    <h2 className={styles.prompt}>Which phrase is this?</h2>
    <div className={styles.playRow}><PlayTile id={id} requests={[request(item.answer)]} /></div>
    <AudioError id={[id, `${id}:compare`]} />
    <ul className={styles.choices}>{item.choices.map(family => {
      const state = !chosen ? undefined : family === item.answer.family ? "right" : family === chosen ? "chosen" : "other";
      return <li key={family}><button type="button" className={styles.choice} data-state={state} disabled={!!chosen} aria-pressed={chosen === family}
        style={state === "right" ? phraseStyle(family) : undefined} data-family={family} data-right={family === item.answer.family || undefined} onClick={() => pick(family)}>
        <ContourMark family={family} melody={melody} /><span>{familyName(family)}</span>{state === "right" && <span className={styles.choiceMark}>{icons.check}</span>}{state === "chosen" && <span className={styles.choiceMark}>{icons.wrong}</span>}
      </button></li>;
    })}</ul>
    <p role="status" className={styles.feedback}>{chosen && chosen !== item.answer.family ? compared ? `That one is ${familyName(item.answer.family)}. Here is ${familyName(chosen)} for comparison.` : `That one is ${familyName(item.answer.family)}.`
      : chosen ? <span className="sr-only">{familyName(item.answer.family)}</span> : ""}</p>
    {chosen && verse && <Answer verse={verse} phrase={item.answer} id={id} />}
  </>;
}

/** Same or different: two phrases from two verses, one after the other. */
export function SameOrDifferent({ item, pools, onAnswer }: DrillProps<SameItem>) {
  const { player } = useLearnServices(), state = usePlayerState(), id = `same:${item.key}`, [chosen, setChosen] = useState<boolean | null>(null);
  const both = [request(item.first), request(item.second)];
  useAutoplay(id, both);
  const pick = (same: boolean) => {
    if (chosen !== null) return; setChosen(same);
    const right = same === item.same; if (!right) void player.play(id, both); onAnswer(right);
  };
  const part = (n: number) => state.id === id && state.status === "playing" && state.part === n;
  const button = (same: boolean, label: string) => <button type="button" className={styles.choice} disabled={chosen !== null} aria-pressed={chosen === same}
    data-state={chosen === null ? undefined : same === item.same ? "right" : chosen === same ? "chosen" : "other"} style={{ "--phrase-color": "var(--lake-tint)" } as CSSProperties} data-right={same === item.same || undefined} onClick={() => pick(same)}>
    <span>{label}</span>{chosen !== null && same === item.same && <span className={styles.choiceMark}>{icons.check}</span>}{chosen === same && same !== item.same && <span className={styles.choiceMark}>{icons.wrong}</span>}</button>;
  return <>
    <h2 className={styles.prompt}>Same tune or different?</h2>
    <div className={styles.playRow}><PlayTile id={id} requests={both} /><span className={styles.number} data-on={part(0)} aria-hidden="true">1</span><span className={styles.number} data-on={part(1)} aria-hidden="true">2</span></div>
    <AudioError id={id} />
    <div className={styles.pair}>{button(true, "Same tune")}{button(false, "Different tune")}</div>
    {/* Finding 22: the answer is spoken as well as shown, with the right button's own label (as hear-and-name speaks its right family). */}
    <p role="status" className="sr-only">{chosen !== null ? item.same ? "Same tune" : "Different tune" : ""}</p>
    {chosen !== null && <div className={styles.answer} data-answer><div className={styles.pairList}>{[item.first, item.second].map((phrase, n) => {
      const verse = verseOf(pools, phrase);
      return <div key={n} className={styles.pairRow}><span className={styles.number} aria-hidden="true">{n + 1}</span>
        {verse && <UnitsText playback={[{ id, part: n }]} verse={verse} units={phrase.words} look={() => "inked"} className={styles.phraseStandard} />}
        <FamilyChip family={phrase.family} melody={phrase.kind} />{item.by === "melody" && <span className={styles.muted}>{melodyName(phrase.kind)}</span>}
        <span className={styles.ref}><bdi dir="ltr">{phrase.ref}</bdi></span></div>;
    })}</div></div>}
  </>;
}

/** The line a wrong tap in the end drill shows: what the tapped word's own mark does. */
export function wrongEndLine(verse: AnalysedVerse, unit: number): string {
  const trope = verse.units[unit]?.trope as TropeId | null, phrase = verse.phrases.find(row => row.units[1] === unit);
  if (phrase) return `That one is ${familyName(phrase.family)}.`;
  if (!trope) return "";
  if (isConjunctive(trope)) return `That's a ${tropeLabel(trope)}, which joins.`;
  if (LEADS_ON.has(trope)) return `That's a ${tropeLabel(trope)}, which joins the following phrase.`;
  return `That's a ${tropeLabel(trope)}.`;
}
/** Where does the phrase end: the phrase plays from a marked word and stops at its end; tap that word. The tap is
 * the answer and plays nothing; once answered, a tapped word opens its card. */
export function WhereDoesItEnd({ item, pools, prompt, onAnswer }: DrillProps<EndItem>) {
  const id = `end:${item.key}`, [tapped, setTapped] = useState<number | null>(null), verse = verseOf(pools, item.target);
  useAutoplay(id, [request(item.target)], item.audio);
  if (!verse) return null;
  const [first, last] = item.target.words, right = tapped === last;
  const tap = (unit: number) => {
    if (tapped !== null) return; setTapped(unit);
    onAnswer(unit === last);
  };
  return <>
    <h2 className={styles.prompt}>{prompt ?? "Tap the word where the phrase ends."}</h2>
    {item.audio && <div className={styles.playRow}><PlayTile id={id} requests={[request(item.target)]} /></div>}
    <AudioError id={id} />
    <div className={styles.verseBox} data-end-unit={last}>
      <UnitsText playback={[id]} verse={verse} className={styles.phraseStandard} onUnit={tapped === null ? tap : undefined}
        unitLabel={unit => `Word ${unit + 1}${unit === first ? ", the phrase starts here" : ""}`}
        look={unit => tapped !== null && unit >= first && unit <= last ? "inked" : "plain"}
        unitClass={unit => [unit === first ? styles.start : "", tapped !== null && unit === tapped && !right ? styles.missed : ""].filter(Boolean).join(" ") || undefined} />
    </div>
    <p role="status" className={styles.feedback}>{tapped !== null && !right ? wrongEndLine(verse, tapped) : ""}</p>
    {tapped !== null && <div className={styles.answerHead} data-answer><FamilyChip family={item.target.family} melody={item.target.kind} /><span className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></span></div>}
  </>;
}

/** Tap the phrase you heard: the verse uncoloured, its phrases the tap targets, the tile above it. The tap is the
 * answer and plays nothing; after a miss the tile plays the phrase and the one tapped. Once answered, words open cards. */
export function TapThePhrase({ item, pools, onAnswer }: DrillProps<TapItem>) {
  const id = `tap:${item.key}`, [tapped, setTapped] = useState<number | null>(null), verse = verseOf(pools, item.target);
  useAutoplay(id, [request(item.target)]);
  if (!verse) return null;
  const target = verse.phrases.findIndex(row => row.units[0] === item.target.words[0]);
  const tap = (index: number) => {
    if (tapped !== null) return; setTapped(index);
    onAnswer(index === target);
  };
  const chosenFamily = tapped === null ? null : verse.phrases[tapped]?.family, missed = tapped !== null && tapped !== target ? verse.phrases[tapped] : null;
  return <>
    <h2 className={styles.prompt}>Hear a phrase, then tap it.</h2>
    <div className={styles.playRow}>{missed ? <PlayTile key="compare" id={`${id}:compare`} requests={[request(item.target), phraseRequest(verse, missed.units)]} /> : <PlayTile id={id} requests={[request(item.target)]} />}</div>
    <AudioError id={[id, `${id}:compare`]} />
    <div className={styles.verseBox} data-target-phrase={target}>
      <p className={`${styles.hebrew} ${styles.phraseStandard}`} lang="he" dir="rtl">{verse.phrases.map((phrase, index) => {
        const shown = tapped !== null && index === target, wrong = tapped !== null && index === tapped && index !== target;
        return <span key={index}>{index > 0 && <span className={styles.phraseGap} aria-hidden="true"> </span>}
          {tapped === null ? <span className={styles.target} role="button" tabIndex={0} data-phrase-target={index} aria-label={`Phrase ${index + 1}`} onClick={() => tap(index)}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); tap(index); } }}>
            <UnitsText playback={[id, `${id}:compare`]} as="span" verse={verse} units={phrase.units} card={false} />
          </span> : <span className={wrong ? styles.missed : undefined} data-phrase-target={index}><UnitsText playback={[id, `${id}:compare`]} as="span" verse={verse} units={phrase.units} look={() => shown ? "inked" : "plain"} /></span>}</span>;
      })}</p>
    </div>
    <p role="status" className={styles.feedback}>{tapped !== null && tapped !== target && chosenFamily ? `That one is ${familyName(item.target.family)}. Here is ${familyName(chosenFamily)} for comparison.` : ""}</p>
    {tapped !== null && <div className={styles.answerHead} data-answer><FamilyChip family={item.target.family} melody={item.target.kind} /><span className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></span></div>}
  </>;
}

/** Build the phrase: tap its marks into order; each placed mark plays its word. */
export function BuildThePhrase({ item, pools, onAnswer }: DrillProps<BuildItem>) {
  const { player } = useLearnServices(), id = `build:${item.key}`, verse = verseOf(pools, item.phrase);
  const marks = item.phrase.tropes as TropeId[], [placed, setPlaced] = useState<number[]>([]), [miss, setMiss] = useState<{ tile: number; n: number } | null>(null), missed = useRef(false);
  useAutoplay(id, [request(item.phrase)]);
  if (!verse) return null;
  const done = placed.length === marks.length;
  const tap = (tile: number) => {
    if (done || placed.includes(tile)) return;
    const position = placed.length;
    if (item.tiles[tile] !== marks[position]) { missed.current = true; setMiss({ tile, n: (miss?.n ?? 0) + 1 }); return; }
    const next = [...placed, tile]; setPlaced(next); setMiss(null);
    const unit = item.phrase.words[0] + position;
    if (next.length === marks.length) { void player.play(`${id}:all`, [request(item.phrase)]); onAnswer(!missed.current); }
    else void player.play(`${id}:word`, [phraseRequest(verse, [unit, unit])]);
  };
  return <>
    <h2 className={styles.prompt}>Hear it, then build it.</h2>
    <div className={styles.playRow}><PlayTile id={id} requests={[request(item.phrase)]} /></div>
    <AudioError id={[id, `${id}:word`, `${id}:all`]} />
    <ol className={styles.slots} aria-label="Marks in order">{marks.map((_, i) => {
      const tile = placed[i];
      return <li key={i} className={styles.slot} data-filled={tile !== undefined}>{tile !== undefined ? <span className={styles.tile} style={{ boxShadow: "none", background: "transparent" }}>
        <span className={`${styles.hebrew} ${styles.tileSample}`} lang="he" dir="rtl">{tropeSample(marks[i])}</span><span className={styles.tileName}>{tropeLabel(marks[i])}</span></span>
        : <span className="sr-only">Empty</span>}</li>;
    })}</ol>
    <div className={styles.tray} role="group" aria-label="Marks">{item.tiles.map((trope, tile) => <button key={`${tile}:${miss?.tile === tile ? miss.n : 0}`} type="button" className={styles.tile}
      disabled={done || placed.includes(tile)} data-miss={miss?.tile === tile ? "true" : undefined} data-order={marks.indexOf(trope)} onClick={() => tap(tile)} aria-label={tropeLabel(trope)}>
      <span className={`${styles.hebrew} ${styles.tileSample}`} lang="he" dir="rtl" aria-hidden="true">{tropeSample(trope)}</span><span className={styles.tileName} aria-hidden="true">{tropeLabel(trope)}</span>
    </button>)}</div>
    {done && <div className={styles.answer} data-answer><UnitsText playback={[id, `${id}:word`, `${id}:all`]} verse={verse} units={item.phrase.words} look={() => "inked"} className={styles.phraseStandard} />
      <div className={styles.answerHead}><FamilyChip family={item.phrase.family} melody={item.phrase.kind} /><span className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></span></div></div>}
  </>;
}

/** One look-alike word at Hebrew Large: the word alone, or (azla against geresh) with the word before it, muted. */
function LookWord({ side, context, card, playback }: { playback: import("./player").PlaybackBinding[]; side: LookSide; context: LookItem["context"]; card: boolean }) {
  const at = side.word.word, first = context === "previous-word" ? Math.max(0, at - 1) : at;
  return <UnitsText playback={playback} as="span" verse={side.verse} units={[first, at]} className={styles.lookHebrew} card={card} unitClass={unit => unit < at ? styles.contextWord : undefined} />;
}
/** Same sign, different place: two words side by side, each with a look-alike sign. The tap is the answer and plays
 * nothing; once answered, both show their mark names, the tell appears, the tile plays the tapped word then the other,
 * and the words open their cards. */
export function LookAlikes({ item, onAnswer, first = item.first }: DrillProps<LookItem> & { first?: boolean }) {
  const id = `look:${item.key}`, [tapped, setTapped] = useState<0 | 1 | null>(null), copy = DRAFTED.lookAlikes;
  const answerSide = item.shown[item.answer], heard = item.mode === "hear" ? phraseAt(answerSide.verse, answerSide.word.word) : null;
  useAutoplay(id, heard ? [request(heard)] : [], !!heard);
  const tap = (n: 0 | 1) => { if (tapped !== null) return; setTapped(n); onAnswer(n === item.answer); };
  const word = (side: LookSide) => phraseRequest(side.verse, [side.word.word, side.word.word]);
  const both = tapped === null ? [] : [word(item.shown[tapped]), word(item.shown[tapped === 0 ? 1 : 0])];
  return <>
    <h2 className={styles.prompt}>{item.mode === "hear" ? copy.hearPrompt : copy.readPrompt(item.ask)}</h2>
    {first && <p className={styles.lookIntro}>{copy.intro}</p>}
    {heard && <div className={styles.playRow}><PlayTile id={id} requests={[request(heard)]} /></div>}
    <div className={styles.lookPair} dir="rtl" data-look-answer={item.answer}>{item.shown.map((side, n) => {
      const state = tapped === null ? undefined : n === item.answer ? "right" : n === tapped ? "chosen" : "other";
      return tapped === null
        ? <button key={n} type="button" className={`${styles.choice} ${styles.lookWord}`} data-look={n} onClick={() => tap(n as 0 | 1)}>
          <LookWord playback={n === item.answer ? [id] : []} side={side} context={item.context} card={false} /></button>
        : <div key={n} className={`${styles.choice} ${styles.lookWord}`} data-look={n} data-state={state} style={{ "--phrase-color": "var(--lake-tint)" } as CSSProperties}>
          <LookWord playback={[...(n === item.answer ? [id] : []), { id: `${id}:words`, part: n === tapped ? 0 : 1 }]} side={side} context={item.context} card />
          <span className={styles.lookMark} dir="ltr">{state === "right" && <span className={styles.choiceMark}>{icons.check}</span>}{state === "chosen" && <span className={styles.choiceMark}>{icons.wrong}</span>}{side.word.mark}</span>
        </div>;
    })}</div>
    <p role="status" className={styles.feedback}>{tapped !== null ? lookTell(answerSide) : ""}</p>
    <AudioError id={[id, `${id}:words`]} />
    {tapped !== null && <div className={styles.answerHead} data-answer>
      <PlayTile id={`${id}:words`} requests={both} />
      <span className={styles.ref}><bdi dir="ltr">{[...new Set(item.shown.map(side => side.verse.ref))].join(" · ")}</bdi></span>
    </div>}
  </>;
}

/** Which half of the verse: the verse uncoloured, a hairline gap after the rest; the recording plays from the verse's
 * start through one phrase (ruling 2026-10-23), or the phrase alone. Before the rest, or after it? */
export function WhichHalf({ item, pools, onAnswer }: DrillProps<HalfItem>) {
  const id = `half:${item.key}`, [chosen, setChosen] = useState<"before" | "after" | null>(null), verse = verseOf(pools, item.target), copy = DRAFTED.whichHalf;
  const [first, last] = item.target.words, leadIn = item.audio === "lead-in";
  const requests = verse ? [leadIn ? phraseRequest(verse, [0, last]) : request(item.target)] : [];
  useAutoplay(id, requests, !!verse);
  if (!verse) return null;
  const pick = (half: "before" | "after") => { if (chosen) return; setChosen(half); onAnswer(half === item.half); };
  const restPhrase = verse.phrases.find(row => row.units[0] <= item.rest && item.rest <= row.units[1]);
  const inHalf = (unit: number) => item.half === "before" ? unit <= item.rest : unit > item.rest;
  const look = (unit: number) => chosen && restPhrase && unit >= restPhrase.units[0] && unit <= restPhrase.units[1] ? "inked" as const : "plain" as const;
  // Daniel, 2026-10-23 ("Hide until answered"): nothing marks the phrase until the answer, so the half is chosen by ear.
  const unitClass = (unit: number) => [unit >= first && unit <= last && chosen ? styles.underlined : "", chosen && inHalf(unit) && look(unit) === "plain" ? styles.halfTint : ""].filter(Boolean).join(" ") || undefined;
  const button = (half: "before" | "after", label: string) => <button type="button" className={styles.choice} disabled={!!chosen} aria-pressed={chosen === half}
    data-state={!chosen ? undefined : half === item.half ? "right" : half === chosen ? "chosen" : "other"} style={{ "--phrase-color": "var(--lake-tint)" } as CSSProperties}
    data-right={half === item.half || undefined} onClick={() => pick(half)}>
    <span>{label}</span>{chosen && half === item.half && <span className={styles.choiceMark}>{icons.check}</span>}{chosen === half && half !== item.half && <span className={styles.choiceMark}>{icons.wrong}</span>}</button>;
  return <>
    <h2 className={styles.prompt}>{leadIn ? copy.promptLeadIn : copy.promptPhrase}</h2>
    <div className={styles.playRow}><PlayTile id={id} requests={requests} /></div>
    <AudioError id={id} />
    <div className={styles.verseBox} data-half={chosen ? item.half : undefined} data-rest-unit={item.rest}>
      <p className={`${styles.hebrew} ${styles.phraseStandard}`} lang="he" dir="rtl">
        <UnitsText playback={[id]} as="span" verse={verse} units={[0, item.rest]} card={!!chosen} look={look} unitClass={unitClass} />
        <span className={styles.halfGap} aria-hidden="true"> </span>
        {item.rest < verse.units.length - 1 && <UnitsText playback={[id]} as="span" verse={verse} units={[item.rest + 1, verse.units.length - 1]} card={!!chosen} look={look} unitClass={unitClass} />}
      </p>
    </div>
    <div className={styles.pair}>{button("before", copy.before)}{button("after", copy.after)}</div>
    <p role="status" className={styles.feedback}>{chosen ? item.half === "before" ? copy.tellBefore : copy.tellAfter : ""}</p>
    {chosen && <div className={styles.answerHead} data-answer><span className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></span></div>}
  </>;
}
