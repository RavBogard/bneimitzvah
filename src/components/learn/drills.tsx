"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import { familyName, type Melody, type TropeId } from "../../lib/learn/course";
import { tropeLabel, tropeSample, isConjunctive } from "../../lib/learn/marks";
import type { BuildItem, DrillItem, EndItem, NameItem, Phrase, Pools, SameItem, TapItem } from "../../lib/learn/pools";
import { LEADS_ON, type AnalysedVerse } from "../../lib/learn/verse";
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
    <UnitsText verse={verse} className={styles.phraseStandard} look={unit => unit >= phrase.words[0] && unit <= phrase.words[1] ? "inked" : "plain"} />
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
        <ContourMark family={family} melody={melody} /><span>{familyName(family)}</span>{state === "right" && <span className={styles.choiceMark}>{icons.check}</span>}
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
    <span>{label}</span>{chosen !== null && same === item.same && <span className={styles.choiceMark}>{icons.check}</span>}</button>;
  return <>
    <h2 className={styles.prompt}>Same tune or different?</h2>
    <div className={styles.playRow}><PlayTile id={id} requests={both} /><span className={styles.number} data-on={part(0)} aria-hidden="true">1</span><span className={styles.number} data-on={part(1)} aria-hidden="true">2</span></div>
    <AudioError id={id} />
    <div className={styles.pair}>{button(true, "Same tune")}{button(false, "Different tune")}</div>
    {chosen !== null && <div className={styles.answer} data-answer><div className={styles.pairList}>{[item.first, item.second].map((phrase, n) => {
      const verse = verseOf(pools, phrase);
      return <div key={n} className={styles.pairRow}><span className={styles.number} aria-hidden="true">{n + 1}</span>
        {verse && <UnitsText verse={verse} units={phrase.words} look={() => "inked"} className={styles.phraseStandard} />}
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
/** Where does the phrase end: the phrase plays from a marked word and stops at its end; tap that word. */
export function WhereDoesItEnd({ item, pools, prompt, onAnswer }: DrillProps<EndItem>) {
  const { player } = useLearnServices(), id = `end:${item.key}`, [tapped, setTapped] = useState<number | null>(null), verse = verseOf(pools, item.target);
  useAutoplay(id, [request(item.target)], item.audio);
  if (!verse) return null;
  const [first, last] = item.target.words, right = tapped === last;
  const tap = (unit: number) => {
    if (tapped !== null) return; setTapped(unit);
    if (unit !== last) void player.play(id, [request(item.target)]);
    onAnswer(unit === last);
  };
  return <>
    <h2 className={styles.prompt}>{prompt ?? "Tap the word where the phrase ends."}</h2>
    {item.audio && <div className={styles.playRow}><PlayTile id={id} requests={[request(item.target)]} /></div>}
    <AudioError id={id} />
    <div className={styles.verseBox} data-end-unit={last}>
      <UnitsText verse={verse} className={styles.phraseStandard} onUnit={tapped === null ? tap : undefined}
        unitLabel={unit => `Word ${unit + 1}${unit === first ? ", the phrase starts here" : ""}`}
        look={unit => tapped !== null && unit >= first && unit <= last ? "inked" : "plain"}
        unitClass={unit => [unit === first ? styles.start : "", tapped !== null && unit === tapped && !right ? styles.missed : ""].filter(Boolean).join(" ") || undefined} />
    </div>
    <p role="status" className={styles.feedback}>{tapped !== null && !right ? wrongEndLine(verse, tapped) : ""}</p>
    {tapped !== null && <div className={styles.answerHead} data-answer><FamilyChip family={item.target.family} melody={item.target.kind} /><span className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></span></div>}
  </>;
}

/** Tap the phrase you heard: the verse uncoloured, its phrases the tap targets, the tile above it. */
export function TapThePhrase({ item, pools, onAnswer }: DrillProps<TapItem>) {
  const { player } = useLearnServices(), id = `tap:${item.key}`, [tapped, setTapped] = useState<number | null>(null), verse = verseOf(pools, item.target);
  useAutoplay(id, [request(item.target)]);
  if (!verse) return null;
  const target = verse.phrases.findIndex(row => row.units[0] === item.target.words[0]);
  const tap = (index: number) => {
    if (tapped !== null) return; setTapped(index);
    const right = index === target, chosen = verse.phrases[index];
    if (!right) void player.play(`${id}:compare`, [request(item.target), phraseRequest(verse, chosen.units)]);
    onAnswer(right);
  };
  const chosenFamily = tapped === null ? null : verse.phrases[tapped]?.family;
  return <>
    <h2 className={styles.prompt}>Hear a phrase, then tap it.</h2>
    <div className={styles.playRow}><PlayTile id={id} requests={[request(item.target)]} /></div>
    <AudioError id={[id, `${id}:compare`]} />
    <div className={styles.verseBox} data-target-phrase={target}>
      <p className={`${styles.hebrew} ${styles.phraseStandard}`} lang="he" dir="rtl">{verse.phrases.map((phrase, index) => {
        const shown = tapped !== null && index === target, wrong = tapped !== null && index === tapped && index !== target;
        return <span key={index}>{index > 0 && <span className={styles.phraseGap} aria-hidden="true"> </span>}
          <span className={`${styles.target}${wrong ? ` ${styles.missed}` : ""}`} role={tapped === null ? "button" : undefined} tabIndex={tapped === null ? 0 : undefined} data-phrase-target={index}
            aria-disabled={tapped !== null ? "true" : undefined} aria-label={tapped === null ? `Phrase ${index + 1}` : undefined} onClick={() => tap(index)}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); tap(index); } }}>
            <UnitsText as="span" verse={verse} units={phrase.units} look={() => shown ? "inked" : "plain"} />
          </span></span>;
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
    {done && <div className={styles.answer} data-answer><UnitsText verse={verse} units={item.phrase.words} look={() => "inked"} className={styles.phraseStandard} />
      <div className={styles.answerHead}><FamilyChip family={item.phrase.family} melody={item.phrase.kind} /><span className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></span></div></div>}
  </>;
}
