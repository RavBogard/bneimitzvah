import { cx } from "./cx";
import styles from "./ui.module.css";

/** `attention` is marigold behind ink, `done` forest, `info` lake, `danger` red; `neutral` is a plain count or label. */
export type ChipTone = "neutral" | "attention" | "done" | "info" | "danger";

/**
 * A state or a count. Colour is never the only signal, so the word is required and is a string: a chip cannot be an
 * empty dot or an icon. The tone is a small set; a new meaning is a new word, not a new colour.
 */
export function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: string }) {
  return <span className={cx(styles.chip, tone !== "neutral" && styles[tone])} data-tone={tone}>{children}</span>;
}
