import { COMMENTARY_WORKS } from "../readings/commentary";

/**
 * A signed-in person's own reading preferences, as the account keeps them (release 1.7 M3b): the commentaries
 * shown inline in Study, Study's English, and the reading settings (phrase colours, Lein's English, text size,
 * tikkun view). One small `version: 1` document per member. Every field is optional: a field is present only
 * once the person chose it, so an unset field keeps the page's own default (Rashi and the Women's Commentary on,
 * Daniel 2026-10-23) and a chosen one, including turning every commentary off, is kept as chosen.
 * The same strict parser checks what a browser sends, what the server stores and what the browser receives.
 * Display choices only: no text, name or identifier of anyone.
 */
export const PREFERENCES_VERSION = 1;
/** Registry order; the Study lens shows at most three works inline (study-lens.ts MAX_INLINE_WORKS). */
export const PREFERENCE_WORKS: readonly string[] = Object.freeze(Object.keys(COMMENTARY_WORKS));
export const PREFERENCE_MAX_WORKS = 3;
export const PREFERENCE_TEXT_SIZES = Object.freeze(["small", "standard", "large", "huge"] as const);
export const PREFERENCE_TIKKUN_VIEWS = Object.freeze(["off", "beside", "only"] as const);
/** The stored document's bound; the 0041 CHECK holds the same. A full document is under 200 bytes. */
export const PREFERENCES_MAX_BYTES = 1024;
export const PREFERENCE_FIELDS = Object.freeze(["works", "studyEnglish", "colors", "translation", "size", "tikkunView"] as const);
export type PreferenceField = (typeof PREFERENCE_FIELDS)[number];
export type Preferences = Readonly<{
  version: 1;
  works?: readonly string[];
  studyEnglish?: boolean;
  colors?: boolean;
  translation?: boolean;
  size?: (typeof PREFERENCE_TEXT_SIZES)[number];
  tikkunView?: (typeof PREFERENCE_TIKKUN_VIEWS)[number];
}>;
export const EMPTY_PREFERENCES: Preferences = Object.freeze({ version: 1 });

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * Registered works, without repeats, in registry order, at most three: exactly the form the Study lens keeps
 * (normalizeWorks). Anything else is refused rather than repaired, so nothing unexpected is ever stored.
 */
function works(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > PREFERENCE_MAX_WORKS || value.some(work => typeof work !== "string" || !PREFERENCE_WORKS.includes(work))) return null;
  const ordered = PREFERENCE_WORKS.filter(work => value.includes(work));
  return ordered.length === value.length && ordered.every((work, index) => value[index] === work) ? Object.freeze(ordered) : null;
}

/** The document, strictly: a plain object with `version: 1` and only allow-listed fields and values; anything else is null. */
export function parsePreferences(value: unknown): Preferences | null {
  if (!plain(value) || Object.getOwnPropertySymbols(value).length) return null;
  const keys = Object.keys(value);
  if (value.version !== PREFERENCES_VERSION || keys.some(key => key !== "version" && !(PREFERENCE_FIELDS as readonly string[]).includes(key))) return null;
  const out: { -readonly [K in keyof Preferences]: Preferences[K] } = { version: 1 };
  if (Object.hasOwn(value, "works")) { const chosen = works(value.works); if (!chosen) return null; out.works = chosen; }
  for (const flag of ["studyEnglish", "colors", "translation"] as const)
    if (Object.hasOwn(value, flag)) { if (typeof value[flag] !== "boolean") return null; out[flag] = value[flag] as boolean; }
  if (Object.hasOwn(value, "size")) { if (!(PREFERENCE_TEXT_SIZES as readonly unknown[]).includes(value.size)) return null; out.size = value.size as Preferences["size"]; }
  if (Object.hasOwn(value, "tikkunView")) { if (!(PREFERENCE_TIKKUN_VIEWS as readonly unknown[]).includes(value.tikkunView)) return null; out.tikkunView = value.tikkunView as Preferences["tikkunView"]; }
  const result = Object.freeze(out);
  return new TextEncoder().encode(serializePreferences(result)).byteLength <= PREFERENCES_MAX_BYTES ? result : null;
}

/**
 * A stored document, read leniently in one respect only: a commentary later removed from the registry (or past a
 * lowered limit) is dropped from `works` rather than locking the member out of their own preferences. Everything else
 * is the strict parser; requests are always parsed strictly.
 */
export function parseStoredPreferences(value: unknown): Preferences | null {
  if (plain(value) && Array.isArray(value.works) && value.works.every(work => typeof work === "string"))
    return parsePreferences({ ...value, works: PREFERENCE_WORKS.filter(work => (value.works as string[]).includes(work)).slice(0, PREFERENCE_MAX_WORKS) });
  return parsePreferences(value);
}

/** One canonical text for a document: fields in PREFERENCE_FIELDS order, so two equal documents serialize the same. */
export function serializePreferences(value: Preferences): string {
  const out: Record<string, unknown> = { version: value.version };
  for (const field of PREFERENCE_FIELDS) if (value[field] !== undefined) out[field] = field === "works" ? [...value.works!] : value[field];
  return JSON.stringify(out);
}
export const samePreferences = (a: Preferences, b: Preferences) => serializePreferences(a) === serializePreferences(b);

/** The fields whose value differs between two documents (a field present in one and absent in the other differs). */
export function changedFields(from: Preferences, to: Preferences): PreferenceField[] {
  return PREFERENCE_FIELDS.filter(field => JSON.stringify(from[field] ?? null) !== JSON.stringify(to[field] ?? null));
}
/** `base` with `fields` taken from `over`; a field `over` does not have stays as `base` has it. */
export function overlayPreferences(base: Preferences, over: Preferences, fields: readonly PreferenceField[]): Preferences {
  const out: Record<string, unknown> = JSON.parse(serializePreferences(base));
  for (const field of fields) if (over[field] !== undefined) out[field] = field === "works" ? [...over.works!] : over[field];
  return parsePreferences(out) ?? base;
}
