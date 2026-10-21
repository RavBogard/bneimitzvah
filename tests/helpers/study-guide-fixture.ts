import type { GuideBody, GuideNote, GuideSource, GuideTheme } from "../../src/server/study-guides/validation";

// Invented prose and invented source rows only: no verse text, no licensed bodies.
export const source = (id = "invented-source-1", readable = true): GuideSource =>
  ({ id, ref: "Invented Commentary on Exodus 40:34:1", indexTitle: "Invented Commentary", category: "Commentary", labels: { en: "Invented Commentary", he: null }, readable });
export const note = (verseRef = "Exodus 40:34", extra: Partial<GuideNote> = {}): GuideNote =>
  ({ verseRef, body: "A short invented note about why this moment matters.", sources: [source()], ...extra });
export const theme = (id = "finished-work", extra: Partial<GuideTheme> = {}): GuideTheme =>
  ({ id, title: "A finished work", intro: "An invented introduction to the theme.", notes: [note()], ...extra });
export const guide = (extra: Partial<GuideBody> = {}): GuideBody =>
  ({ overview: "An invented overview of the portion for a twelve-year-old and an adult together.", themes: [theme()], ...extra });
export const additions = (themes: GuideTheme[] = [theme("for-you")]): GuideBody => ({ themes });
