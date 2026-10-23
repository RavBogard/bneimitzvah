"use client";
import { LENSES, useStudyLens, type Lens } from "./study-lens";

/** Lein | Study, at the top of the passage. It changes the layout, never which verses are shown. */
export function LensSwitch({ onChange }: { onChange?(lens: Lens): void }) {
  const lens = useStudyLens();
  if (!lens.available) return null;
  return <div className="study-kind-choice reading-lens-choice" role="group" aria-label="Reading lens">
    {LENSES.map(row => <button key={row.id} type="button" className="button-secondary" aria-pressed={lens.lens === row.id} data-lens={row.id}
      onClick={() => { if (lens.lens !== row.id) { lens.setLens(row.id); onChange?.(row.id); } }}>{row.label}</button>)}
  </div>;
}
