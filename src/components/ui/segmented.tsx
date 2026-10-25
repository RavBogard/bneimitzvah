"use client";
import { useId } from "react";
import styles from "./ui.module.css";

export type SegmentedOption<V extends string> = { value: V; label: string; disabled?: boolean };
export type SegmentedProps<V extends string> = {
  /** What the group chooses, for assistive technology ("Reading", "Role"): required, because the segments alone do not say. */
  label: string;
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V;
  onChange: (value: V) => void;
};

/** One choice from a few, as a native radio group: arrow keys move and choose, the selected segment is a lake pill. */
export function Segmented<V extends string>({ label, options, value, onChange }: SegmentedProps<V>) {
  const name = useId();
  return <div role="radiogroup" aria-label={label} className={styles.segmented}>
    {options.map(option => <label key={option.value} className={styles.segment}>
      <input type="radio" name={name} value={option.value} checked={option.value === value} disabled={option.disabled} onChange={() => onChange(option.value)} />
      {option.label}
    </label>)}
  </div>;
}
