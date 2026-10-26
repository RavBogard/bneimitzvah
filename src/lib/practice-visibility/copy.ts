/**
 * 1.9 N23: what the student, and the parent practising with the student, are told about what the tutor sees.
 * - learn is LD-10's approved line, word for word.
 * - account is Daniel's approved Account line, word for word (2026-10-26).
 * - parent is the parent-facing line, decided in the house voice from Daniel's: the child's name, never a pronoun. It shows on the
 *   parent's Account and in child practice, where the child sits with the parent and so is told too.
 * All of them stay behind the release gate (release.ts), the same gate as every tutor and parent line.
 */
export const PRACTICE_DISCLOSURE = Object.freeze({
  learn: "Your tutor sees which phrases you can hear.",
  account: "Your tutor sees which days you practised, which verses you opened, how you marked them and whether a parent was with you, and in Learn to lein which phrases you can hear and the two you mix up most. Your parents see how you marked each verse. No one sees how long you practise or a score.",
  parent: "{name}'s tutor sees which days {name} practised, which verses {name} opened, how {name} marked them and whether a parent was there, and in Learn to lein which phrases {name} can hear and the two {name} mixes up most. You see how {name} marked each verse. No one sees how long {name} practises or a score.",
});
/** The parent line with the child's name filled in, as plain text. */
export const parentDisclosure = (name: string) => PRACTICE_DISCLOSURE.parent.split("{name}").join(name);
