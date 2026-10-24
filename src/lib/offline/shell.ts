import { COURSE } from "../learn/course";
import { SHELL_BASE_PAGES } from "./policy";

/** The app shell's pages: the reader, /offline, and every Learn to lein page (F3, 2026-10-23). All are static. */
export const SHELL_PAGES: readonly string[] = Object.freeze([...SHELL_BASE_PAGES, ...COURSE.lessons.map(lesson => `/learn/${lesson.id}`),
  // 1.6: the practice runs (Quick ten) are Learn pages too.
  ...COURSE.practice.map(practice => `/learn/practice/${practice.id}`)]);
