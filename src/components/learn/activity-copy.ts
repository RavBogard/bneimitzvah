import type { LookAlikeMark, LookAlikeWord } from "../../lib/learn/course";
import { markPlace } from "../../lib/learn/verse";

/**
 * The 1.6 activities' words. DRAFTED is docs/superpowers/research/2026-10-23-cowork-offload/learn-next-activities.md,
 * as written (Daniel, 2026-10-23: use the drafted strings). Everything else the screens say is either existing Learn
 * wording, used where it is used today, or one of the NEW strings at the bottom, which the draft did not have.
 */
export const DRAFTED = Object.freeze({
  lookAlikes: Object.freeze({
    title: "Same sign, different place",
    intro: "Some marks look alike. Where they sit tells you which one it is.",
    readPrompt: (mark: LookAlikeMark) => `Which one is ${mark}?`,
    hearPrompt: "Hear it, then tap the word it came from.",
    tells: Object.freeze({
      pashta: "Pashta sits on the last letter of the word, wherever the stress falls.",
      "pashta-doubled": "Two pashtas on one word: the first shows the stressed syllable, the last is the pashta itself.",
      kadma: "Kadma sits on the stressed syllable, so it can be inside the word.",
      "kadma-near-end": "Kadma is close to the end here, but not on the last letter.",
      mahpach: "Mahpach sits under the stressed syllable and leads into the next word.",
      yetiv: "Yetiv sits before the first letter, to the right of its vowel.",
      azla: "Azla comes right after a kadma. Its stroke leans the other way from kadma's.",
      geresh: "The same stroke with no kadma before it is geresh.",
    }),
  }),
  whichHalf: Object.freeze({
    title: "Which half of the verse",
    promptLeadIn: "The verse plays up to one phrase. Is that phrase before the rest, or after it?",
    promptPhrase: "Find the phrase you heard. Is it before the rest, or after it?",
    before: "Before the rest",
    after: "After the rest",
    tellBefore: "Before the rest: this phrase is in the first half.",
    tellAfter: "After the rest: this phrase is in the second half, on the way to the ending.",
  }),
  quickTen: Object.freeze({
    homeRow: "Quick ten: ten phrases, one after another, about 2 minutes",
    title: "Quick ten",
    prompt: "Which phrase is this?",
    stop: "Stop here",
    endClean: "Done.",
    endMissed: "Done. The ones you missed come back in review.",
    empty: "Quick ten opens after three phrases.",
  }),
});

/** NEW in 1.6: strings neither the draft nor the existing Learn screens had. Listed in the PR for Daniel. */
export const NEW = Object.freeze({
  /** Quick ten's loading line, in the shape of "Loading the lesson…" and "Loading the review…". */
  quickTenLoading: "Loading the phrases…",
});

/** The tell line for a look-alike word's mark (learn-next-activities.md), by where the mark sits on this word. */
export function lookTell(side: { word: Pick<LookAlikeWord, "mark" | "text"> }): string {
  const { mark, text } = side.word, place = markPlace(text, mark), tells = DRAFTED.lookAlikes.tells;
  return mark === "pashta" && place === "doubled" ? tells["pashta-doubled"] : mark === "kadma" && place === "near-end" ? tells["kadma-near-end"] : tells[mark];
}
