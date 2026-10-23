/**
 * Daniel's pinned tone rule for every learner-facing string in the course: no exclamation point,
 * emoji, streak, badge, score or pep talk. Shared by the course validator and the copy scan test.
 */
export const BANNED_PHRASES = Object.freeze([
  "awesome", "great job", "good job", "nice job", "well done", "keep it up", "you got this", "you've got this", "level up",
  "streak", "badge", "amazing", "woohoo", "yay", "congrats", "congratulations", "high score",
]);
// Pictographic emoji, variation selectors and the keycap combiner. Hebrew marks are not in these ranges.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️⃣]/u;

/** Every problem the tone rule finds in one string; empty when it is clean. */
export function toneProblems(text: string): string[] {
  const problems: string[] = [];
  if (text.includes("!")) problems.push("exclamation point");
  if (EMOJI.test(text)) problems.push("emoji");
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) if (new RegExp(`(?:^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`).test(lower)) problems.push(`"${phrase}"`);
  return problems;
}
