import type { CommentaryComment } from "../readings/commentary";

/**
 * The public discussions answer as the browser holds it (1.7 M6b): what GET /api/public/discussions says, parsed once
 * (components/portal/workspace/study/discussions-api.ts), then read by the verse panel, the reading's list and the print sheet.
 * Pure types and lookups, so the print appendix can use them without a component. Nothing here names a curator but the
 * display label the route returns for the source details.
 */
export type DiscussionEdition = Readonly<{ language: "he" | "en"; title: string; license: string; licenseLabel: string; credit: string; url: string }>;
/** A source's text as Sefaria gave it: the segments, and the editions that supplied each language (each credited once). */
export type DiscussionText = Readonly<{ segments: readonly CommentaryComment[]; editions: readonly DiscussionEdition[] }>;
type Shared = Readonly<{
  position: number; ref: string; anchorRef: string; sefariaUrl: string;
  /** "Selected by {name}", as the route words it: a source detail, never part of a credit. */
  selectedBy: string;
  /** Null when Sefaria could not give this source's text just now: the credit and the link are shown, the text is not. */
  text: DiscussionText | null;
}>;
export type DiscussionSource = Shared & ({ kind: "edition"; edition: string; credit: string | null }
  | { kind: "translation"; translation: Readonly<{ body: string; originalEdition: string }> });
export type Discussion = Readonly<{ slug: string; title: string; kind: "torah" | "haftarah"; anchors: readonly string[]; sources: readonly DiscussionSource[] }>;
/** `truncated`: the route left later discussions out to stay within its limits; the ones shown are complete in themselves, and nothing is said of the rest. */
export type DiscussionsAnswer = Readonly<{ discussions: readonly Discussion[]; productName: string | null; /** The rabbi's display name (the congregation's setting), for the "From {name}" label. */ rabbiName?: string; complete: boolean; truncated: boolean }>;

/** One discussion's sources that sit on one verse, in the discussion's own order. */
export type VerseDiscussion = Readonly<{ discussion: Discussion; sources: readonly DiscussionSource[] }>;
/** The answer for a reader: which verses are anchors, and what each has. */
export type DiscussionsView = Readonly<{ answer: DiscussionsAnswer; productName: string; anchors: ReadonlySet<string>; forVerse(ref: string): readonly VerseDiscussion[] }>;

/** The reader's view of an answer, or null where there is nothing to show (no discussion, no anchor, no product name to credit by). */
export function discussionsView(answer: DiscussionsAnswer): DiscussionsView | null {
  if (!answer.discussions.length || !answer.productName) return null;
  const byVerse = new Map<string, VerseDiscussion[]>();
  for (const discussion of answer.discussions) {
    for (const verse of discussion.anchors) {
      const sources = discussion.sources.filter(source => source.anchorRef === verse);
      if (sources.length) byVerse.set(verse, [...byVerse.get(verse) ?? [], Object.freeze({ discussion, sources })]);
    }
  }
  if (!byVerse.size) return null;
  return Object.freeze({ answer, productName: answer.productName, anchors: new Set(byVerse.keys()), forVerse: (ref: string) => byVerse.get(ref) ?? [] });
}
