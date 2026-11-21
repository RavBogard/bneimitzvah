export const CHILD_LEARN_PARAM = "child-practice";
export const CHILD_LEARN_RESUME = "resume-child-practice";
export const PRACTICE_STUDENT_HEADER = "X-Practice-Student";

export function childLearnHref(href: string) {
  const url = new URL(href, "https://practice.invalid");
  url.searchParams.set(CHILD_LEARN_PARAM, "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

export const isLearnPath = (path: string) => path === "/learn" || path.startsWith("/learn/");

export function childLearnPath(path: string, search: string) {
  return isLearnPath(path) && new URLSearchParams(search).get(CHILD_LEARN_PARAM) === "1";
}

export const PERSONAL_STUDY_PARAM = "personal-study";
export const PERSONAL_STUDY_HEADER = "X-Personal-Study";
export function personalStudyHref(href: string) {
  const url = new URL(href, "https://practice.invalid");
  url.searchParams.set(PERSONAL_STUDY_PARAM, "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
