import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeHebrew } from "../../src/server/study/normalize";
import { aliyahRuns, bookletRange, bookletSections, notesOn, type BookletInput, type BookletPart, type BookletReading } from "../../src/lib/print/booklet";
import { BookletDocument, bookletTitle } from "../../src/components/portal/print/booklet";
import { bookletHref } from "../../src/components/portal/print/booklet-href";
import type { Reading } from "../../src/components/portal/workspace/api";
import type { StudentGuideView } from "../../src/components/portal/workspace/study/guide-api";

// The study booklet's assembly (B1/B4): which sections print, in order, from a synthetic fixture, and that a section with no data is left
// out silently. Synthetic text only: two Hebrew words per verse and placeholder English, never an edition's text.
const STUDENT = { id: "11111111-1111-4111-8111-111111111111", firstName: "Noa", lastName: "Synthetic", ceremonyDate: "2026-12-12", revision: 1, rehearsal1: "2026-11-07", rehearsal2: null, serviceSlot: "morning" as const };
const SOURCE = { status: "available" as const, fetchedAt: 0, date: "2026-12-12", calendar: "diaspora" as const, attribution: null };
const verse = (ref: string) => { const hebrew = normalizeHebrew("אָ֑ב גַּֽד׃"); return { ref, hebrew: { ...hebrew, segments: [...hebrew.segments] }, english: `Synthetic English for ${ref}.` }; };
const EDITIONS = [{ key: "mam", versionTitle: "Miqra according to the Masorah", language: "he", creator: "Synthetic creator", sourceUrl: "https://example.test/he", license: "CC-BY-SA-4.0", licenseUrl: "https://example.test/l", changes: "None" },
  { key: "jps2023", versionTitle: "Synthetic English edition", language: "en", creator: "Synthetic publisher", sourceUrl: "https://example.test/en", license: "CC-BY-NC-4.0", licenseUrl: "https://example.test/l", changes: "None" }];
const LABEL = { origin: "claude" as const, reviewed: false, rabbiName: "Synthetic Rabbi" };

function reading(kind: "torah" | "haftarah", refs: string[], aliyahStarts: string[] | null, guide: StudentGuideView | null): BookletReading {
  const row: Reading = { id: kind === "torah" ? "33333333-3333-4333-8333-333333333333" : "44444444-4444-4444-8444-444444444444", kind, revision: 1, ranges: [bookletRange(refs.map(ref => ({ ref })))],
    verses: refs, needsReview: false, aliyahStarts, readingKey: kind === "torah" ? "vayeshev" : null, source: SOURCE, confirmationDate: null, basis: "custom" };
  const chapter = { ref: refs[0].replace(/:\d+$/, ""), sefariaUrl: "https://example.test/c", fetchedAt: 0, hash: "x".repeat(64), editions: EDITIONS };
  return { reading: row, text: { verses: refs.map(verse), chapters: [chapter as never] }, guide };
}
const guide = (kind: "torah" | "haftarah", noteRef: string): StudentGuideView => ({ kind, readingKey: kind === "torah" ? "vayeshev" : null, tickable: false, additions: null,
  base: { version: 1, label: LABEL, overview: "A synthetic overview of the whole portion.", updatedAt: "2026-10-28T00:00:00Z",
    themes: [{ id: "first-theme", title: "A synthetic theme", intro: "A synthetic intro.", read: false, readVersion: 0,
      notes: [{ verseRef: noteRef, body: "A synthetic note.", sources: [{ id: "s1", ref: "Rashi on Genesis 37:2:1", indexTitle: "Rashi on Genesis", category: "Commentary", labels: { en: "Rashi", he: null }, readable: true }] }] }] } });
const TORAH = ["Genesis 37:1", "Genesis 37:2", "Genesis 37:3", "Genesis 37:4"], HAFTARAH = ["Amos 2:6", "Amos 2:7"];
const part = (unitId: string, lesson: string | null): BookletPart => ({ unitId, name: unitId, lesson, material: {} as never, teaching: lesson ? { text: "A synthetic teaching.", approved: "2026-10-24" } : null });
const full: BookletInput = { student: STUDENT, tutor: "Synthetic Tutor", parts: [part("torah.blessing-before-the-torah-reading@bm-shacharit", "torah-before"), part("shma.shma@bm-shacharit", "shma")],
  torah: reading("torah", TORAH, ["Genesis 37:3"], guide("torah", "Genesis 37:2")), haftarah: reading("haftarah", HAFTARAH, null, guide("haftarah", "Amos 2:7")) };
const kinds = (input: BookletInput) => bookletSections(input).map(section => "reading" in section && typeof section.reading === "string" ? `${section.kind}-${section.reading}` : section.kind);

describe("the study booklet's sections", () => {
  it("prints every section in the plan's order when there is data for each", () => {
    expect(kinds(full)).toEqual(["cover", "blessings", "about-torah", "reading-torah", "practice-torah", "about-haftarah", "reading-haftarah", "practice-haftarah", "service", "credits"]);
    const [cover, blessings] = bookletSections(full, () => "Vayeshev");
    expect(cover).toMatchObject({ kind: "cover", name: "Noa Synthetic", ceremonyDate: "2026-12-12", rehearsals: ["2026-11-07"], tutor: "Synthetic Tutor",
      readings: [{ kind: "torah", name: "Vayeshev", aliyot: ["Aliyah 1: Genesis 37:1–2", "Aliyah 2: Genesis 37:3–4"] }, { kind: "haftarah", name: null, aliyot: [] }] });
    // The Torah blessing on the plan prints with the blessings, not again among the service parts; the haftarah's falls back to its siddur page.
    expect(blessings).toMatchObject({ kind: "blessings", groups: [{ kind: "torah", page: "22", parts: [{ lesson: "torah-before" }] }, { kind: "haftarah", page: "23–24", parts: [] }] });
    expect(bookletSections(full).find(section => section.kind === "service")).toMatchObject({ parts: [{ lesson: "shma" }] });
  });

  it("splits the student's own verses aliyah by aliyah, with the guide's notes on those verses after each", () => {
    const runs = aliyahRuns(full.torah!.reading, full.torah!.text.verses);
    expect(runs.map(run => [run.label, run.verses.map(v => v.ref)])).toEqual([["Aliyah 1", ["Genesis 37:1", "Genesis 37:2"]], ["Aliyah 2", ["Genesis 37:3", "Genesis 37:4"]]]);
    expect(aliyahRuns(full.haftarah!.reading, full.haftarah!.text.verses).map(run => run.label)).toEqual([null]);
    expect(notesOn(full.torah!.guide, runs[0].verses).map(note => note.verseRef)).toEqual(["Genesis 37:2"]);
    expect(notesOn(full.torah!.guide, runs[1].verses)).toEqual([]);
    expect(bookletRange([{ ref: "Genesis 37:23" }, { ref: "Genesis 38:5" }])).toBe("Genesis 37:23–38:5");
  });

  it("leaves out a section with no data, silently: no guide, no haftarah, no service parts, no rehearsals, no tutor", () => {
    const bare: BookletInput = { ...full, student: { ...STUDENT, rehearsal1: null }, tutor: null, parts: [], haftarah: null, torah: reading("torah", TORAH, null, null) };
    expect(kinds(bare)).toEqual(["cover", "blessings", "reading-torah", "practice-torah", "credits"]);
    expect(bookletSections(bare)[0]).toMatchObject({ rehearsals: [], tutor: null });
    // A haftarah only: its sections, its blessings.
    expect(kinds({ ...full, torah: null, parts: [] })).toEqual(["cover", "blessings", "about-haftarah", "reading-haftarah", "practice-haftarah", "credits"]);
    // No reading at all: the cover, and the service parts when there are any.
    expect(kinds({ ...full, torah: null, haftarah: null, parts: [] })).toEqual(["cover"]);
    expect(kinds({ ...full, torah: null, haftarah: null })).toEqual(["cover", "service", "credits"]);
    // A part whose text is unavailable prints nothing.
    expect(kinds({ ...full, torah: null, haftarah: null, parts: [{ ...part("shma.shma@bm-shacharit", "shma"), material: null }] })).toEqual(["cover"]);
  });

  it("renders each section by test id, in trope colour by default or black and white, with the guide's review label and no transliteration", () => {
    const input: BookletInput = { ...full, parts: [] };
    for (const colour of [true, false]) {
      const markup = renderToStaticMarkup(createElement(BookletDocument, { input, colour, productName: "Synthetic" }));
      for (const id of ["booklet-cover", "booklet-blessings", "booklet-about-torah", "booklet-reading-torah", "booklet-practice-torah", "booklet-haftarah", "booklet-about-haftarah", "booklet-reading-haftarah", "booklet-practice-haftarah", "booklet-credits"])
        expect(markup, id).toContain(`data-testid="${id}"`);
      expect(markup).not.toContain('data-testid="booklet-service"');
      expect(markup).toContain(`data-colour="${colour ? "trope" : "black-and-white"}"`);
      expect(markup).toContain("Written by Claude for CRC · not yet reviewed by Synthetic Rabbi");
      expect(markup).toContain(bookletTitle("Noa", "Synthetic").replace("'", "&#x27;"));
      expect(markup).not.toMatch(/translit/i);
    }
    expect(bookletTitle("Noa", "Synthetic")).toBe("Noa Synthetic's study booklet");
    expect(bookletHref(STUDENT.id)).toBe(`/print/booklet/${STUDENT.id}`);
  });
});
