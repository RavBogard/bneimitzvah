import type { RelatedSourceMetadata } from "../study/sources/metadata";

/**
 * Study-guide body limits. The SQL function portal_study_guide_body_valid enforces the same
 * structure and sizes; this module adds the text rules a database check cannot sensibly hold
 * (no links, no markup). Both must agree: a body this accepts the database accepts.
 */
export const LIMITS = Object.freeze({
  voice: 32768, overview: 8192, intro: 4096, note: 4096, title: 120, themes: 8, notes: 12, sources: 3, body: 131072, themeId: 64, verseRef: 100,
});

export type GuideSource = RelatedSourceMetadata & { readable: boolean };
export type GuideNote = { verseRef: string; body: string; sources: GuideSource[] };
export type GuideTheme = { id: string; title: string; intro: string; notes: GuideNote[] };
export type GuideBody = { overview?: string; themes: GuideTheme[] };
type Result<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const bytes = (text: string) => new TextEncoder().encode(text).length;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
// Bidi controls, zero-width marks and line/paragraph separators can disguise what a reader sees
// (and PostgreSQL may class the separators as controls under the server's locale). The SQL
// function portal_study_markdown rejects the same set.
const HIDDEN = /[\u061c\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/;
// Every way markdown or a renderer could turn text into a link: inline, reference and definition
// links, autolinks (already blocked by the angle-bracket rule), URL schemes, bare domains, emails.
const LINKISH = /\]\s*[([:]|^\s*\[[^\]\n]*\]\s*:|[a-z][a-z0-9+.-]*:\/\/|\/\/[a-z0-9]|\b(?:mailto|javascript|data|vbscript|file|ftp|tel):\S|www\.|[^\s@]+@[^\s@]+\.[a-z]{2,}/im;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const VERSE_REF = /^[A-Za-z ]+ [1-9]\d*:[1-9]\d*$/;

/** One line of plain text: titles and source labels. */
export function plain(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 && bytes(value) <= maxBytes && value.trim() === value && value.normalize("NFC") === value
    && !/[\x00-\x1f\x7f-\x9f<>]/.test(value) && !HIDDEN.test(value);
}

/**
 * Markdown-lite prose: paragraphs, emphasis and lists only. No raw HTML, no link syntax, no URLs;
 * the app makes Sefaria references into links itself.
 */
export function markdown(value: unknown, maxBytes: number, problems: string[], where: string): value is string {
  if (typeof value !== "string" || value.replace(/[\s\u200b-\u200d\u2060\ufeff]/g, "").length === 0) { problems.push(`${where}: text required`); return false; }
  if (bytes(value) > maxBytes) { problems.push(`${where}: over ${maxBytes} bytes`); return false; }
  if (value.normalize("NFC") !== value || /[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(value) || HIDDEN.test(value)) { problems.push(`${where}: control or hidden characters`); return false; }
  if (/[<>]/.test(value)) { problems.push(`${where}: raw HTML is not allowed`); return false; }
  if (LINKISH.test(value)) { problems.push(`${where}: links are not allowed; cite sources instead`); return false; }
  return true;
}

function source(value: unknown, problems: string[], where: string): value is GuideSource {
  if (!object(value) || !exactKeys(value, ["id", "ref", "indexTitle", "category", "labels", "readable"])) { problems.push(`${where}: source shape`); return false; }
  const labels = value.labels;
  const ok = typeof value.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.id) && plain(value.ref, 512) && plain(value.indexTitle, 512) && plain(value.category, 128)
    && typeof value.readable === "boolean" && object(labels) && exactKeys(labels, ["en", "he"])
    && (labels.en === null || plain(labels.en, 256)) && (labels.he === null || plain(labels.he, 256));
  if (!ok) problems.push(`${where}: source fields`);
  return ok;
}

export function validateGuideBody(body: unknown, opts: { allowOverview: boolean }): Result<GuideBody> {
  const problems: string[] = [];
  if (!object(body)) return { ok: false, problems: ["body must be an object"] };
  const keys = opts.allowOverview ? ["overview", "themes"] : ["themes"];
  if (!exactKeys(body, keys)) return { ok: false, problems: [opts.allowOverview ? "body has exactly overview and themes" : "student additions have themes only, no overview"] };
  let size: number;
  try { size = bytes(JSON.stringify(body)); } catch { return { ok: false, problems: ["body is not JSON"] }; }
  if (size > LIMITS.body) problems.push(`body over ${LIMITS.body} bytes`);
  if (opts.allowOverview) markdown(body.overview, LIMITS.overview, problems, "overview");
  const themes = body.themes;
  if (!Array.isArray(themes) || themes.length > LIMITS.themes || (!opts.allowOverview && themes.length === 0)) return { ok: false, problems: [...problems, `themes: 0 to ${LIMITS.themes}${opts.allowOverview ? "" : ", at least one"}`] };
  const ids = new Set<string>();
  themes.forEach((theme, i) => {
    const at = `themes[${i}]`;
    if (!object(theme) || !exactKeys(theme, ["id", "title", "intro", "notes"])) { problems.push(`${at}: theme shape`); return; }
    if (typeof theme.id !== "string" || theme.id.length > LIMITS.themeId || !SLUG.test(theme.id)) problems.push(`${at}.id: lowercase slug`);
    else if (ids.has(theme.id)) problems.push(`${at}.id: duplicate`); else ids.add(theme.id);
    if (!plain(theme.title, LIMITS.title * 4) || [...(theme.title as string)].length > LIMITS.title) problems.push(`${at}.title: one plain line of at most ${LIMITS.title} characters`);
    markdown(theme.intro, LIMITS.intro, problems, `${at}.intro`);
    const notes = theme.notes;
    if (!Array.isArray(notes) || notes.length > LIMITS.notes) { problems.push(`${at}.notes: at most ${LIMITS.notes}`); return; }
    notes.forEach((note, j) => {
      const nat = `${at}.notes[${j}]`;
      if (!object(note) || !exactKeys(note, ["verseRef", "body", "sources"])) { problems.push(`${nat}: note shape`); return; }
      if (typeof note.verseRef !== "string" || note.verseRef.length > LIMITS.verseRef || !VERSE_REF.test(note.verseRef)) problems.push(`${nat}.verseRef: "Book C:V"`);
      markdown(note.body, LIMITS.note, problems, `${nat}.body`);
      if (!Array.isArray(note.sources) || note.sources.length > LIMITS.sources) { problems.push(`${nat}.sources: at most ${LIMITS.sources}`); return; }
      const seen = new Set<string>();
      note.sources.forEach((s, k) => {
        if (source(s, problems, `${nat}.sources[${k}]`)) { if (seen.has(s.id)) problems.push(`${nat}.sources[${k}]: duplicate`); seen.add(s.id); }
      });
    });
  });
  return problems.length ? { ok: false, problems } : { ok: true, value: body as GuideBody };
}

export function validateVoice(body: unknown): Result<string> {
  const problems: string[] = [];
  if (typeof body !== "string" || body.trim().length === 0) return { ok: false, problems: ["voice: text required"] };
  if (bytes(body) > LIMITS.voice) return { ok: false, problems: [`voice: over ${LIMITS.voice} bytes`] };
  // The voice is read by Claude, not rendered to students, but it is still plain markdown.
  if (body.normalize("NFC") !== body || /[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(body) || HIDDEN.test(body) || /[<>]/.test(body)) problems.push("voice: control characters or raw HTML");
  return problems.length ? { ok: false, problems } : { ok: true, value: body };
}
