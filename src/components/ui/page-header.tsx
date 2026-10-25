import type { ReactNode, Ref } from "react";
import styles from "./ui.module.css";

export type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** Buttons for the page's main actions, at most two. */
  actions?: ReactNode;
  /** For a client router to move focus to the page's name after a change of screen. The h1 is focusable but not a tab stop. */
  titleRef?: Ref<HTMLHeadingElement>;
};

/** The one page header: the page's single h1, at the one h1 size, with an optional line under it and actions beside it. */
export function PageHeader({ title, description, actions, titleRef }: PageHeaderProps) {
  return <header className={styles.header}>
    <div className={styles.headerText}>
      <h1 ref={titleRef} tabIndex={-1} className={styles.pageTitle}>{title}</h1>
      {description && <p className={styles.description}>{description}</p>}
    </div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </header>;
}
