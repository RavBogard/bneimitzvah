import type { PublicWeek } from "../public-reading/api";
import type { StudyVerse } from "../workspace/study/api";

// One fictional assignment for the student, parent, tutor and admin views.
export const SAMPLE_STUDENT = "Noa Example";
export const SAMPLE_PORTION = "Bereshit";
export const SAMPLE_DATE = "2026-10-10";
export const SAMPLE_DATE_LABEL = "Sat, Oct 10, 2026";
export const SAMPLE_RANGE = "Genesis 1:1–2";
export const SAMPLE_NOTE = "Practice the opening phrase, then read both verses together.";

function verse(ref: string, text: string): StudyVerse {
  const pointed = text.normalize("NFC");
  return { ref, english: null, hebrew: { text: pointed, readingText: pointed, segments: [{ kind: "text", text: pointed }], paragraphAfter: null } };
}

// Masoretic Hebrew, Genesis 1:1–2.
export const SAMPLE_VERSES = [
  verse("Genesis 1:1", "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃"),
  verse("Genesis 1:2", "וְהָאָ֗רֶץ הָיְתָ֥ה תֹ֙הוּ֙ וָבֹ֔הוּ וְחֹ֖שֶׁךְ עַל־פְּנֵ֣י תְה֑וֹם וְר֣וּחַ אֱלֹהִ֔ים מְרַחֶ֖פֶת עַל־פְּנֵ֥י הַמָּֽיִם׃"),
];

export const SAMPLE_WEEK: PublicWeek = {
  date: SAMPLE_DATE, parashah: SAMPLE_PORTION, fetchedAt: 0, listening: { pocketTorah: false },
  torah: { kind: "torah", ranges: ["Genesis 1:1-6:8"], verseCount: 146, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 6:8" }] },
  haftarah: null,
};
