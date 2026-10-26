/**
 * Curated discussions' approved wording (Daniel, 2026-10-24 popups; spec 2026-10-24-curated-discussions-design). The credit
 * goes where an edition credit goes; the person who selected the source appears in the source details, never in the credit.
 */
export const claudeTranslationCredit = (productName: string) => `Claude translation for ${productName}`;
export const selectedByDetail = (name: string) => `Selected by ${name}`;

/**
 * The reader's labels for curated discussions (Daniel, 2026-10-24 popups), exact and behind one name each: the marker beside a
 * verse, the heading of a reading's list, and the way back from a source to its verse. Nothing else in the reader says these words.
 */
export const DISCUSSION_LABELS = Object.freeze({
  marker: "Sources on this verse",
  list: "Sources for this reading",
  /** The Study column and its phone sheet (1.9 N7; Daniel, 2026-10-25, T3 N7-1: "Alternatives" to "Sources for this reading"). Print keeps `list`. */
  column: "Sources",
  back: "Back to this verse",
});
