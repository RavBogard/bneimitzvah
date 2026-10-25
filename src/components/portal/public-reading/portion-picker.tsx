"use client";
import { useId } from "react";
import { portionLabel, portionPicks, type PortionPick, type WeekPortions } from "../../../lib/print/portions";
import { useMore } from "./read-header";
import styles from "./public-reading.module.css";

/**
 * The Portion control on /read (1.9 N3, decision 2), with the words /print's Portion control uses: the whole calendar portion, the
 * triennial reading (with its year), each aliyah and the maftir. Only what the calendar gives is offered, so a week with no aliyot
 * (a festival Saturday, or aliyot that did not load) offers nothing to choose and the control is not drawn.
 * It lives in the More sheet (N5); choosing closes the sheet and then shows the reading chosen.
 */
export function PortionPicker({ portions, pick, onPick }: { portions: WeekPortions | null; pick: PortionPick; onPick(pick: PortionPick): void }) {
  const id = useId(), picks = portionPicks(portions), more = useMore();
  // One aliyah is the whole portion (and no triennial reading is nothing else to pick): there is nothing to choose.
  if (picks.length < 2 || !portions || portions.full.length < 2 && !portions.triennial) return null;
  return <div className={styles.portion}>
    <label htmlFor={id}>Portion</label>
    <select id={id} value={picks.includes(pick) ? pick : "full"} onChange={event => { const next = event.target.value as PortionPick; if (more) more.close(() => onPick(next)); else onPick(next); }}>
      {picks.map(row => <option key={row} value={row}>{portionLabel(row, portions)}</option>)}
    </select>
  </div>;
}
