import { LIMITS as GUIDE_LIMITS, markdown, plain, validateGuideBody, VERSE_REF, type GuideBody } from "../study-guides/validation";
import { PORTION_SUMMARY_LIMITS } from "../portion-summary/validation";

/**
 * The guide-sharing file ("guide-export/v1", plan ruling 11, 2026-10-30). One congregation's rabbi exports their reviewed work; another
 * congregation's rabbi imports it. The file is data, never trusted: this module is the only parser, and it refuses a file that is not
 * exactly this shape. It carries no id of any kind from the exporting database (no row, user, membership or Sefaria link id), no
 * email, nothing student-specific and no English verse text. A citation is its Sefaria reference (a public key such as "Rashi on
 * Genesis 1:1:1"), which the importer looks up again in its own catalog.
 */
export const SHARE_SCHEMA = "guide-export/v1";
export const SHARE_LIMITS = Object.freeze({ fileBytes: 4 * 1024 * 1024, guides: 200, summaries: 80, discussions: 300, discussionSources: 24, credit: 240, problems: 20 });

export type ShareGuide = Readonly<{ kind: "torah" | "haftarah"; readingKey: string; origin: "claude" | "rabbi"; credit: string;
  body: Readonly<{ overview: string; themes: readonly Readonly<{ id: string; title: string; intro: string;
    notes: readonly Readonly<{ verseRef: string; body: string; sources: readonly Readonly<{ ref: string }>[] }>[] }>[] }> }>;
export type ShareSummary = Readonly<{ reading: string; summary: string; outline: readonly string[]; credit: string }>;
export type ShareDiscussionSource = Readonly<{ ref: string; anchorRef: string; edition: string | null; translation: Readonly<{ originalEdition: string; body: string }> | null; selectedBy: string }>;
export type ShareDiscussion = Readonly<{ slug: string; title: string; kind: "torah" | "haftarah"; sources: readonly ShareDiscussionSource[] }>;
export type ShareFile = Readonly<{ schema: typeof SHARE_SCHEMA; exportedAt: string; guides: readonly ShareGuide[]; summaries: readonly ShareSummary[]; discussions: readonly ShareDiscussion[] }>;
type Result = { ok: true; file: ShareFile } | { ok: false; problems: string[] };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
/** An author's display name: one plain line, never an address or a link. */
export const authorName = (value: unknown): value is string =>
  plain(value, SHARE_LIMITS.credit) && [...value].length <= 120 && !value.includes("@") && !/:\/\/|www\./i.test(value);

export function parseShareFile(value: unknown): Result {
  const problems: string[] = [], bad = (where: string) => { if (problems.length < SHARE_LIMITS.problems) problems.push(where); };
  if (!object(value) || !exactKeys(value, ["schema", "exportedAt", "guides", "summaries", "discussions"])) return { ok: false, problems: ["The file is not a guide export."] };
  if (value.schema !== SHARE_SCHEMA) return { ok: false, problems: ["The file is not a guide export this portal can read."] };
  if (typeof value.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value.exportedAt) || !Number.isFinite(Date.parse(value.exportedAt))) bad("exportedAt");
  const { guides, summaries, discussions } = value;
  if (!Array.isArray(guides) || guides.length > SHARE_LIMITS.guides) return { ok: false, problems: [`The file has more than ${SHARE_LIMITS.guides} guides.`] };
  if (!Array.isArray(summaries) || summaries.length > SHARE_LIMITS.summaries) return { ok: false, problems: [`The file has more than ${SHARE_LIMITS.summaries} summaries.`] };
  if (!Array.isArray(discussions) || discussions.length > SHARE_LIMITS.discussions) return { ok: false, problems: [`The file has more than ${SHARE_LIMITS.discussions} discussions.`] };

  const seenGuides = new Set<string>(), outGuides: ShareGuide[] = [];
  guides.forEach((raw, i) => {
    const at = `guides[${i}]`;
    if (!object(raw) || !exactKeys(raw, ["kind", "readingKey", "origin", "credit", "body"])) return bad(`${at}: shape`);
    if (raw.kind !== "torah" && raw.kind !== "haftarah") return bad(`${at}.kind`);
    if (typeof raw.readingKey !== "string" || raw.readingKey.length > 160 || !SLUG.test(raw.readingKey)) return bad(`${at}.readingKey`);
    if (raw.origin !== "claude" && raw.origin !== "rabbi") return bad(`${at}.origin`);
    if (!authorName(raw.credit)) return bad(`${at}.credit`);
    if (seenGuides.has(`${raw.kind}:${raw.readingKey}`)) return bad(`${at}: duplicate reading`);
    seenGuides.add(`${raw.kind}:${raw.readingKey}`);
    const body = raw.body;
    if (!object(body) || !exactKeys(body, ["overview", "themes"]) || !Array.isArray(body.themes)) return bad(`${at}.body`);
    // Citations are {ref}; each is held aside and replaced by a placeholder id so the guide's own body rules run unchanged.
    let shaped = true;
    const placeholder: GuideBody = { overview: body.overview as string, themes: body.themes.map((theme: unknown) => {
      if (!object(theme) || !Array.isArray(theme.notes)) { shaped = false; return theme as never; }
      return { ...theme, notes: theme.notes.map((note: unknown) => {
        if (!object(note) || !Array.isArray(note.sources)) { shaped = false; return note as never; }
        const sources = note.sources.map((source: unknown, k: number) => {
          if (!object(source) || !exactKeys(source, ["ref"]) || !plain(source.ref, 512)) { shaped = false; return { id: "invalid" }; }
          return { id: `s${k}` };
        });
        return { ...note, sources };
      }) } as never;
    }) };
    if (!shaped) return bad(`${at}.body: shape`);
    const checked = validateGuideBody(placeholder, { allowOverview: true, input: true });
    if (!checked.ok) return bad(`${at}.body: ${checked.problems[0]}`);
    // Keep only what the file said: the validated body with its original refs back in place.
    const themes = (body.themes as Record<string, unknown>[]).map(theme => ({ id: theme.id as string, title: theme.title as string, intro: theme.intro as string,
      notes: (theme.notes as Record<string, unknown>[]).map(note => ({ verseRef: note.verseRef as string, body: note.body as string,
        sources: (note.sources as { ref: string }[]).map(source => ({ ref: source.ref })) })) }));
    if (themes.some(theme => theme.notes.some(note => new Set(note.sources.map(s => s.ref)).size !== note.sources.length))) return bad(`${at}.body: a citation is repeated`);
    outGuides.push({ kind: raw.kind, readingKey: raw.readingKey, origin: raw.origin, credit: raw.credit as string, body: { overview: body.overview as string, themes } });
  });

  const seenSummaries = new Set<string>(), outSummaries: ShareSummary[] = [];
  summaries.forEach((raw, i) => {
    const at = `summaries[${i}]`;
    if (!object(raw) || !exactKeys(raw, ["reading", "summary", "outline", "credit"])) return bad(`${at}: shape`);
    if (typeof raw.reading !== "string" || raw.reading.length > 80 || !SLUG.test(raw.reading) || seenSummaries.has(raw.reading)) return bad(`${at}.reading`);
    seenSummaries.add(raw.reading);
    const own: string[] = [];
    markdown(raw.summary, PORTION_SUMMARY_LIMITS.summaryBytes, own, "summary");
    if (!Array.isArray(raw.outline) || raw.outline.length !== PORTION_SUMMARY_LIMITS.aliyot || !raw.outline.every(line => plain(line, PORTION_SUMMARY_LIMITS.lineBytes))) own.push("outline");
    if (!authorName(raw.credit)) own.push("credit");
    if (own.length) return bad(`${at}: ${own[0]}`);
    outSummaries.push({ reading: raw.reading, summary: raw.summary as string, outline: [...(raw.outline as string[])], credit: raw.credit as string });
  });

  const seenDiscussions = new Set<string>(), outDiscussions: ShareDiscussion[] = [];
  discussions.forEach((raw, i) => {
    const at = `discussions[${i}]`;
    if (!object(raw) || !exactKeys(raw, ["slug", "title", "kind", "sources"])) return bad(`${at}: shape`);
    if (typeof raw.slug !== "string" || raw.slug.length > 80 || !SLUG.test(raw.slug) || seenDiscussions.has(raw.slug)) return bad(`${at}.slug`);
    seenDiscussions.add(raw.slug);
    if (!plain(raw.title, 160 * 4) || [...(raw.title as string)].length > 160) return bad(`${at}.title`);
    if (raw.kind !== "torah" && raw.kind !== "haftarah") return bad(`${at}.kind`);
    if (!Array.isArray(raw.sources) || raw.sources.length < 1 || raw.sources.length > SHARE_LIMITS.discussionSources) return bad(`${at}.sources`);
    const sources: ShareDiscussionSource[] = [];
    for (const source of raw.sources as unknown[]) {
      if (!object(source) || !exactKeys(source, ["ref", "anchorRef", "edition", "translation", "selectedBy"])) return bad(`${at}.sources: shape`);
      const translation = source.translation, own: string[] = [];
      if (!plain(source.ref, 256)) own.push("ref");
      if (typeof source.anchorRef !== "string" || source.anchorRef.length > GUIDE_LIMITS.verseRef || !VERSE_REF.test(source.anchorRef)) own.push("anchorRef");
      if ((source.edition === null) === (translation === null)) own.push("edition or translation");
      if (source.edition !== null && !plain(source.edition, 300)) own.push("edition");
      if (translation !== null) {
        if (!object(translation) || !exactKeys(translation, ["originalEdition", "body"]) || !plain(translation.originalEdition, 300)) own.push("translation");
        else markdown(translation.body, 16384, own, "translation");
      }
      if (!authorName(source.selectedBy)) own.push("selectedBy");
      if (own.length) return bad(`${at}.sources: ${own[0]}`);
      sources.push({ ref: source.ref as string, anchorRef: source.anchorRef as string, edition: source.edition as string | null,
        translation: translation === null ? null : { originalEdition: (translation as { originalEdition: string }).originalEdition, body: (translation as { body: string }).body }, selectedBy: source.selectedBy as string });
    }
    if (sources.length === raw.sources.length) outDiscussions.push({ slug: raw.slug, title: raw.title as string, kind: raw.kind, sources });
  });
  if (problems.length) return { ok: false, problems };
  return { ok: true, file: Object.freeze({ schema: SHARE_SCHEMA, exportedAt: value.exportedAt as string, guides: outGuides, summaries: outSummaries, discussions: outDiscussions }) };
}
