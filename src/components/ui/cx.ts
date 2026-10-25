/** Joins the class names that are set; a falsy part is skipped. */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
