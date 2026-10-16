/** Lossless source spans use NFC UTF-16 offsets, never the engine's NFD ranges. */
export type HebrewSegment = Readonly<
  { kind: "text"; text: string } | { kind: "alternative"; written: string; read: string }
  | { kind: "gap"; break: "petuchah" | "setumah" } | { kind: "inverted-nun" }
>;
export type HebrewSource = Readonly<{ text: string; readingText: string; segments: readonly HebrewSegment[]; paragraphAfter: "petuchah" | "setumah" | null }>;
export type WordSpan = Readonly<{ segment: number; field: "text" | "read"; start: number; end: number }>;
export type ReadingWord = Readonly<{ index: number; text: string; spans: readonly WordSpan[] }>;
export type DisplayPart = Readonly<{ text: string; start: number; end: number; wordIndex: number | null }>;
export type DisplayRun = Readonly<
  { kind: "text"; segment: number; parts: readonly DisplayPart[] }
  | { kind: "alternative"; segment: number; written: string; read: readonly DisplayPart[] }
  | { kind: "gap"; segment: number; break: "petuchah" | "setumah" }
  | { kind: "inverted-nun"; segment: number }
>;
export type PhraseToken = Readonly<{ kind: "text" | "gap" | "sign"; text: string; words: readonly number[] }>;
export type StudyProjection = Readonly<{ ref: string; text: string; readingText: string; paragraphAfter: HebrewSource["paragraphAfter"];
  runs: readonly DisplayRun[]; words: readonly ReadingWord[]; tokens: readonly PhraseToken[] }>;
export const PROJECTION_LIMITS = Object.freeze({ bytes: 8192, words: 512 });
const bytes = (s: string) => new TextEncoder().encode(s).length;
export type ProjectionResult = { status: "ready"; projection: StudyProjection } | { status: "unavailable"; reason: "reconstruction" | "bounds" };

// Pinned haftarah template/lib.js HE_WORD + hebrewWords letter test (5b2530f).
const HE_WORD = /[א-תװ-ײיִ-ﭏ֑-ׇֽֿׁׂׅׄ͏‌‍]+/g;
const LETTER = /[א-תיִ-ﭏ]/;
const normalized = (s: string) => s.normalize("NFC").replace(/[\u00a0\u2009\t\r\n ]+/g, " ").trim();
const valid = (s: string) => s.isWellFormed() && s === s.normalize("NFC") && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(s);

/** Derive from the authorized parsed DTO; never parse HTML or mutate the source. */
export function projectStudyVerse(ref: string, source: HebrewSource): ProjectionResult {
  if (source.segments.length > 4096 || source.text.length > 65536 || source.readingText.length > 65536) return { status: "unavailable", reason: "bounds" };
  if (!valid(source.text) || !valid(source.readingText) || !source.segments.length) return { status: "unavailable", reason: "reconstruction" };
  // Bound raw display AND read data before building any source maps. Normalized DTO
  // strings alone cannot bound thousands of whitespace-only segments.
  let displayBytes = 0, readingBytes = 0;
  for (const s of source.segments) {
    if (s.kind === "text") { displayBytes += bytes(s.text); readingBytes += bytes(s.text); }
    else if (s.kind === "alternative") { displayBytes += bytes(s.written) + bytes(s.read); readingBytes += bytes(s.read); }
    else { displayBytes += 2; readingBytes += 2; }
    if (displayBytes > PROJECTION_LIMITS.bytes || readingBytes > PROJECTION_LIMITS.bytes) return { status: "unavailable", reason: "bounds" };
  }
  const chunks: { segment: number; field: "text" | "read"; start: number; end: number; text: string }[] = [];
  const boundaries: { start: number; end: number; kind: "gap" | "sign" }[] = [];
  const alternatives: { start: number; end: number }[] = [];
  let raw = "", written = "", read = "";
  for (const [segment, s] of source.segments.entries()) {
    const start = raw.length;
    if (s.kind === "text" || s.kind === "alternative") {
      const value = s.kind === "text" ? s.text : s.read;
      if (!valid(value) || s.kind === "alternative" && (!valid(s.written) || !LETTER.test(value) || !LETTER.test(s.written))) return { status: "unavailable", reason: "reconstruction" };
      raw += value; read += value; written += s.kind === "text" ? value : s.written;
      chunks.push({ segment, field: s.kind === "text" ? "text" : "read", start, end: raw.length, text: value });
      if (s.kind === "alternative") alternatives.push({ start, end: raw.length });
    } else if (s.kind === "gap") {
      if (s.break !== "petuchah" && s.break !== "setumah") return { status: "unavailable", reason: "reconstruction" };
      raw += " "; read += " "; written += " "; boundaries.push({ start, end: raw.length, kind: "gap" });
    } else if (s.kind === "inverted-nun") {
      raw += "׆"; boundaries.push({ start, end: raw.length, kind: "sign" });
    } else return { status: "unavailable", reason: "reconstruction" };
  }
  const last = [...source.segments].reverse().find(s => s.kind !== "inverted-nun" && (s.kind !== "text" || s.text.trim()));
  if (normalized(written) !== source.text || normalized(read) !== source.readingText || source.paragraphAfter !== (last?.kind === "gap" ? last.break : null)) return { status: "unavailable", reason: "reconstruction" };
  const matches: RegExpExecArray[] = [];
  const scanner = new RegExp(HE_WORD.source, "g");
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(raw))) if (LETTER.test(match[0])) {
    if (matches.length === PROJECTION_LIMITS.words) return { status: "unavailable", reason: "bounds" };
    matches.push(match);
  }
  const words: ReadingWord[] = matches.map((m, index) => ({ index, text: m[0].normalize("NFC"), spans: chunks.filter(c => c.start < m.index! + m[0].length && c.end > m.index!).map(c => ({
    segment: c.segment, field: c.field, start: Math.max(0, m.index! - c.start), end: Math.min(c.text.length, m.index! + m[0].length - c.start),
  })) }));
  const parts = (segment: number, value: string): DisplayPart[] => {
    const spans = words.flatMap(w => w.spans.filter(s => s.segment === segment).map(s => ({ ...s, index: w.index })));
    const points = [...new Set([0, value.length, ...spans.flatMap(s => [s.start, s.end])])].sort((a, b) => a - b);
    return points.slice(0, -1).map((start, k) => ({ text: value.slice(start, points[k + 1]), start, end: points[k + 1], wordIndex: spans.find(s => s.start <= start && s.end > start)?.index ?? null }));
  };
  const runs: DisplayRun[] = source.segments.map((s, segment) => s.kind === "text" ? { kind: "text", segment, parts: parts(segment, s.text) }
    : s.kind === "alternative" ? { kind: "alternative", segment, written: s.written, read: parts(segment, s.read) } : { ...s, segment });
  const tokens: PhraseToken[] = [];
  const add = (start: number, end: number, kind: PhraseToken["kind"]) => {
    if (start === end) return;
    tokens.push({ kind, text: raw.slice(start, end), words: matches.flatMap((m, k) => m.index! < end && m.index! + m[0].length > start ? [k] : []) });
  };
  let start = 0;
  for (let k = 0; k < raw.length; k++) {
    const boundary = boundaries.find(b => b.start === k);
    if (boundary) { add(start, k, "text"); add(k, boundary.end, boundary.kind); k = boundary.end - 1; start = boundary.end; }
    else if (/\s/u.test(raw[k]) && !alternatives.some(a => a.start <= k && k < a.end)) { add(start, k, "text"); start = k + 1; }
  }
  add(start, raw.length, "text");
  return { status: "ready", projection: { ref, text: source.text, readingText: source.readingText, paragraphAfter: source.paragraphAfter, runs, words, tokens } };
}
