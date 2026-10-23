"use client";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import { familyColor, familyName, type Melody } from "../../lib/learn/course";
import { contourPath, CONTOUR_BOX } from "../../lib/learn/contours";
import type { AnalysedVerse } from "../../lib/learn/verse";
import type { PhraseRequest } from "../../lib/learn/phrase-audio";
import { usePlayerState, useLearnServices } from "./services";
import styles from "./learn.module.css";

const svg = (children: ReactNode, size = 22) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
export const icons = {
  play: svg(<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />),
  stop: svg(<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />),
  close: svg(<path d="M6 6l12 12M18 6L6 18" />),
  check: svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, 18),
  arrow: svg(<path d="M9 6l6 6-6 6" />, 20),
  back: svg(<path d="M15 6l-6 6 6 6" />, 20),
};

export const phraseStyle = (family: FamilyId, w?: number) => ({ "--phrase-color": familyColor(family), ...(w === undefined ? {} : { "--w": w }) }) as CSSProperties;

/** The family's contour: its closing melody as a line, in ink. Draws itself while its phrase plays. */
export function ContourMark({ family, melody, drawSeconds }: { family: FamilyId; melody: Melody; drawSeconds?: number }) {
  return <svg className={`${styles.contour}${drawSeconds ? ` ${styles.drawing}` : ""}`} viewBox={`0 0 ${CONTOUR_BOX.width} ${CONTOUR_BOX.height}`} aria-hidden="true" focusable="false"
    style={drawSeconds ? { "--draw": `${drawSeconds}s` } as CSSProperties : undefined}>
    <polyline points={contourPath(family, melody)} pathLength={1} />
  </svg>;
}
/** Name, colour and contour mark together, so colour never carries the meaning alone. */
export function FamilyChip({ family, melody, large = false, drawSeconds }: { family: FamilyId; melody: Melody; large?: boolean; drawSeconds?: number }) {
  return <span className={`${styles.chip}${large ? ` ${styles.chipLarge}` : ""}`} style={phraseStyle(family)} data-family-chip={family}>
    <ContourMark family={family} melody={melody} drawSeconds={drawSeconds} /><span>{familyName(family)}</span>
  </span>;
}

export type UnitLook = "plain" | "inked" | "pull";
/**
 * Hebrew of units [first, last] of a verse, read text only, each unit its own span. `look` colours a
 * unit by its phrase's family; "pull" wipes the colour in word by word (the ink pull).
 */
export function UnitsText({ verse, units, look = () => "plain", className = "", onUnit, unitLabel, unitClass, as = "p", wipe }: {
  verse: AnalysedVerse; units?: readonly [number, number]; look?: (unit: number) => UnitLook; className?: string; as?: "p" | "span";
  /** The ink pull's stagger step for a unit (in 70 ms steps); the default is its place in the range. */ wipe?(unit: number): number;
  onUnit?(unit: number): void; unitLabel?(unit: number): string; unitClass?(unit: number): string | undefined;
}) {
  const [first, last] = units ?? [0, verse.units.length - 1], Tag = as;
  const key = (event: KeyboardEvent, unit: number) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onUnit?.(unit); } };
  return <Tag className={`${styles.hebrew} ${className}`} lang="he" dir="rtl">
    {verse.units.slice(first, last + 1).map((unit, k) => {
      const mode = look(unit.index), extra = unitClass?.(unit.index);
      const classes = [styles.unit, mode === "inked" ? styles.inked : mode === "pull" ? styles.pull : "", onUnit ? styles.target : "", extra ?? ""].filter(Boolean).join(" ");
      return <span key={unit.index}>{k > 0 && " "}<span className={classes} style={mode !== "plain" ? phraseStyle(unit.family, wipe ? wipe(unit.index) : k) : undefined} data-unit={unit.index} data-family={mode !== "plain" ? unit.family : undefined}
        {...(onUnit ? { role: "button", tabIndex: 0, "aria-label": unitLabel?.(unit.index), onClick: () => onUnit(unit.index), onKeyDown: (event: KeyboardEvent) => key(event, unit.index) } : {})}>{unit.text}</span>{unit.legarmeh && " ׀"}</span>;
    })}
  </Tag>;
}

/** The play tile: plays the phrase cuts in turn; tapping again replays from the start. */
export function PlayTile({ id, requests, label = "Hear it", iconOnly = false, rate, onPlayed }: { id: string; requests: readonly PhraseRequest[]; label?: string; iconOnly?: boolean; rate?: number; onPlayed?(): void }) {
  const { player } = useLearnServices(), state = usePlayerState();
  const mine = state.id === id, playing = mine && state.status === "playing", loading = mine && state.status === "loading";
  return <button type="button" className={`${styles.play}${iconOnly ? ` ${styles.playIcon}` : ""}`} data-state={playing ? "playing" : loading ? "loading" : "idle"} aria-label={iconOnly ? label : undefined}
    disabled={!requests.length} onClick={() => { if (playing) player.stop(); else void player.play(id, requests, { rate }).then(done => { if (done) onPlayed?.(); }); }}>
    {playing ? icons.stop : icons.play}{!iconOnly && <span>{label}</span>}
  </button>;
}
/** The one audio failure line (COPY.md), for the tile that failed. */
export function AudioError({ id }: { id: string | readonly string[] }) {
  const state = usePlayerState(), ids = typeof id === "string" ? [id] : id;
  return state.status === "error" && state.id && ids.includes(state.id) ? <p role="status" className={styles.feedback}>The recording did not load. Try again.</p> : null;
}
export const phraseRequest = (verse: Pick<AnalysedVerse, "ref" | "kind">, words: readonly [number, number]): PhraseRequest => ({ ref: verse.ref, kind: verse.kind, words });
