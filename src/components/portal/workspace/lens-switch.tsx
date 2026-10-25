"use client";
import { startTransition, useOptimistic } from "react";
import { LENSES, useStudyLens, type Lens } from "./study-lens";

/**
 * Lein | Study, at the top of the passage. It changes the layout, never which verses are shown.
 * The switch is a transition (1.9 N3, G14): the pressed button answers at once and the text is set again in the background,
 * so a long section never holds up the tap that asked for it.
 */
export function LensSwitch({ onChange }: { onChange?(lens: Lens): void }) {
  const lens = useStudyLens(), [shown, setShown] = useOptimistic(lens.lens);
  if (!lens.available) return null;
  return <div className="study-kind-choice reading-lens-choice" role="group" aria-label="Reading lens">
    {LENSES.map(row => <button key={row.id} type="button" className="button-secondary" aria-pressed={shown === row.id} data-lens={row.id}
      onClick={() => { if (shown !== row.id) { startTransition(() => { setShown(row.id); lens.setLens(row.id); }); onChange?.(row.id); } }}>{row.label}</button>)}
  </div>;
}
