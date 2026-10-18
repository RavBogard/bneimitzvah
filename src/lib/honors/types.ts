export type HonorPerson = Readonly<{ id: string; englishName: string }>;
export type GenerationPerson = HonorPerson & Readonly<{ relationship: string | null }>;
export type AliyahPerson = GenerationPerson & Readonly<{ hebrewName: string | null; parent1HebrewName: string | null; parent2HebrewName: string | null }>;
export type HonorsForm = Readonly<{
  schemaVersion: 1; openingArk: readonly HonorPerson[]; generationToGeneration: readonly GenerationPerson[];
  undressingTorah: readonly HonorPerson[]; redressingTorah: readonly HonorPerson[]; closingArk: readonly HonorPerson[];
  aliyot: readonly Readonly<{ startVerse: string; participants: readonly AliyahPerson[] }>[];
  parentalBlessing: Readonly<{ participation: null | "yes" | "no"; delivery: null | "together" | "separately" }>;
}>;
export type HonorsSpan = Readonly<{ startVerse: string; endVerse: string }>;
export type HonorsContext = Readonly<{
  schemaVersion: 1; tenantId: string; studentId: string; ceremonyDate: string; serviceSlot: "morning" | "havdalah" | "unknown";
  torah: null | Readonly<{ id: string; revision: number; ref: string; basis: "triennial" | "selection" | "full" | "custom";
    confirmation: Readonly<{ confirmationDate: string | null; serviceSlot: string | null; slotProvenance: number | null; needsReview: boolean }>;
    verses: readonly string[]; cuts: readonly string[] | null }>;
}>;
export type HonorsContextView = Readonly<{ hash: string; snapshot: HonorsContext; spans: readonly HonorsSpan[];
  status: "unassigned" | "unresolved-cuts" | "assigned"; unknownSlot: boolean; readingNeedsReview: boolean }>;
export type HonorsSelection = Readonly<{ mode: "student" | "parent" | "tutor" | "admin"; studentId: string }>;
export type HonorsIntent = Readonly<{ expectedVersion: number; mutationId: string; contextHash: string; form: HonorsForm }>;
export type HonorsVersion = Readonly<{ version: number; form: HonorsForm; reviewedContext: HonorsContextView; createdAt: string }>;
export type HonorsRead = Readonly<{ ok: true; studentId: string; currentVersion: number; currentContext: HonorsContextView; saved: HonorsVersion | null; needsReview: boolean }>;
export type HonorsCommit = Readonly<{ ok: true; outcome: "committed"; replayed: boolean; committedVersion: number; currentLatestVersion: number;
  committed: HonorsVersion; currentContext: HonorsContextView; needsReview: boolean }>;
