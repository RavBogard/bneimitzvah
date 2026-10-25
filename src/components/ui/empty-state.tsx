import type { ReactNode } from "react";
import styles from "./ui.module.css";

export type EmptyStateProps = {
  title: string;
  /** What is missing and what to do about it, in a sentence. */
  description?: ReactNode;
  /** The one next action, normally a Button or ButtonLink. */
  action?: ReactNode;
  /** The heading level that fits the page's outline. */
  level?: 2 | 3 | 4;
};

/** The one empty-state pattern: words and one next action. Nothing is drawn: no picture, mascot or emoji. */
export function EmptyState({ title, description, action, level = 2 }: EmptyStateProps) {
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return <section className={styles.empty}>
    <Heading className={styles.emptyTitle}>{title}</Heading>
    {description && <p className={styles.emptyBody}>{description}</p>}
    {action && <div className={styles.emptyAction}>{action}</div>}
  </section>;
}
