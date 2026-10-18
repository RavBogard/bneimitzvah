import type { Assigned } from "../../src/components/portal/workspace/api";
import { parseExplorationPreparation } from "../../src/components/portal/workspace/study/exploration-api";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import type { StudyPage } from "../../src/components/portal/workspace/study/api";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";
export const explorationStudent = "10000000-0000-4000-8000-000000000001";
export const explorationBaseline = (): Assigned => ({ student: { id: explorationStudent, firstName: "Synthetic", lastName: "Explorer", revision: 1, ceremonyDate: "2027-01-02" }, mode: "student", context: null, readings: [] });
export function explorationResponse() {
  return { status: "prepared", studentId: explorationStudent, studentRevision: 1, mode: "student", kind: "torah", ceremonyDate: "2027-01-02", serviceSlot: "morning", readingDate: "2027-01-02", calendar: "diaspora",
    binding: `v1.${"a".repeat(100)}`, expiresAt: Date.now() + 299000, sourceFetchedAt: Date.now() - 1000, portion: "Synthetic", ranges: ["Genesis 1:1-6:8"], verseCount: 146,
    pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 4:20", chapters: ["Genesis 1", "Genesis 2", "Genesis 3", "Genesis 4"] },
      { offset: 100, first: "Genesis 4:21", last: "Genesis 6:8", chapters: ["Genesis 4", "Genesis 5", "Genesis 6"] }] };
}
export function explorationPrepared() {
  const value = parseExplorationPreparation(explorationResponse(), explorationBaseline());
  if (value.status !== "prepared") throw new Error("Synthetic exploration shape mismatch"); return value;
}
export function explorationPage(offset = 0): StudyPage {
  const ranges = ["Genesis 1:1-6:8"];
  const page = syntheticUiStudyPage({ ranges, kind: "torah", verses: expandReadingRanges(ranges, "torah", TANAKH_VERSE_COUNTS), offset, translation: "jps2023" });
  return { ...page, translation: { ...page.translation }, verses: page.verses.map(verse => ({ ...verse, hebrew: { ...verse.hebrew, segments: verse.hebrew.segments.map(part => ({ ...part })) } })),
    chapters: page.chapters.map(chapter => ({ ...chapter, editions: chapter.editions.map(edition => studyEditions[edition.key]) })) };
}
