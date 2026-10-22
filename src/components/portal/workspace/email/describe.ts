import type { EmailOption } from "./api";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** The line under each email choice. It must say what the checkbox does as the server sends it. */
export function describeEmailOption(option: EmailOption) {
  if (option.kind === "tutor-draft") return "One short email with a link to sign in. At most one a day for each student.";
  const day = WEEKDAYS[option.weekday ?? 0];
  if (option.kind === "weekly-digest") {
    if (option.audience === "self") return `Each ${day} morning: your days practiced, new lesson notes and upcoming dates.`;
    // A parent who is also an adult student: their own part is opt-in, so the box starts off.
    if (option.audience === "both") return option.enabled ? `Each ${day} morning: your child’s and your own days practiced, new lesson notes and upcoming dates.`
      : `Each ${day} morning: your child’s days practiced, new lesson notes and upcoming dates. Turn it on to include your own as well.`;
    return `Each ${day} morning: your child’s days practiced, new lesson notes and upcoming dates.`;
  }
  return "A short reminder on the day you choose. Only you get it, at the email you sign in with.";
}
