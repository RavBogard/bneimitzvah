import { COURSE } from "../learn/course";
import { SERVICE_COURSE, lessonOpen } from "../service-course/course";
import { SHELL_BASE_PAGES } from "./policy";

/** The app shell's pages: the reader, /offline, and every Learn to lein page (F3, 2026-10-23). All are static. */
export const SHELL_PAGES: readonly string[] = Object.freeze([...SHELL_BASE_PAGES, ...COURSE.lessons.map(lesson => `/learn/${lesson.id}`),
  // 1.6: the practice runs (Quick ten) are Learn pages too.
  ...COURSE.practice.map(practice => `/learn/practice/${practice.id}`),
  // 2.0 SC6: every open service-course lesson page, exactly the static pages its route builds. A page holds no prayer text: the Read
  // step asks for it, and offline only a pack answers (the public service-course pack; the evening text only from its owner's pack).
  ...SERVICE_COURSE.lessons.filter(lesson => lessonOpen(lesson)).map(lesson => `/learn/service/${lesson.id}`)]);
