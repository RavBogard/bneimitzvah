import "server-only";
import { sourceMetadataWork, parseEditionMetadata, type RelatedSourceMetadata, type SourceEditionMetadata } from "./metadata";
import { SourceContentUnavailable, SourceContentUnsupported, supportedEdition, MOTHER_TONGUES, SOURCE_CONTENT_LIMITS, type SourceText } from "./content";
export const SOURCE_EXTENT_LIMITS = Object.freeze({ depth: 4, segments: 64, coordinate: 2147483647 });
export type SourceSegment = Readonly<{ ref: string; status: "text"; text: string }> | Readonly<{ ref: string; status: "missing"; text: null }>;
export type SourceSegments = Readonly<{ schema: "study-source-segments/v1"; ref: string; extent: Readonly<{ kind: "parent" | "range"; parentRef: string; requestedStart: string | null; requestedEnd: string | null; observedStart: string | null; observedEnd: string | null }>; segments: readonly SourceSegment[]; edition: SourceText["edition"]; provenance: SourceText["provenance"] }>;
const fail = (): never => { throw new SourceContentUnavailable(); };
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return fail(); return v as Record<string, unknown>; }
function get(v: Record<string, unknown>, key: string) { const d = Object.getOwnPropertyDescriptor(v, key); return d && Object.hasOwn(d, "value") ? d.value : fail(); }
function array(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length > max || Reflect.ownKeys(v).length !== v.length + 1) return fail(); const result: unknown[] = []; for (let i = 0; i < v.length; i++) { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d || !Object.hasOwn(d, "value")) return fail(); result.push(d.value); } return result; }
const unsupported = (): never => { throw new SourceContentUnsupported("source"); };
export function extentCoordinate(value: string): number { if (!/^[1-9][0-9]*$/.test(value) || value.length > 10) return unsupported(); const n = Number(value); return n <= SOURCE_EXTENT_LIMITS.coordinate ? n : unsupported(); }
/** A numeric citation grammar only; a parent still needs full response depth/offset proof. */
export function sourceNumericCitation(input: Pick<RelatedSourceMetadata, "ref" | "indexTitle">) {
  const row = object(input), ref = get(row, "ref"), indexTitle = get(row, "indexTitle");
  if (typeof ref !== "string" || typeof indexTitle !== "string" || sourceMetadataWork(ref) !== ref || sourceMetadataWork(indexTitle) !== indexTitle || !ref.startsWith(indexTitle + " ")) return unsupported();
  const match = /^([1-9][0-9]*(?::[1-9][0-9]*)*)(?:-([1-9][0-9]*))?$/.exec(ref.slice(indexTitle.length + 1)); if (!match) return unsupported();
  const coordinates = Object.freeze(match[1].split(":")), rangeEnd = match[2] ?? null;
  if (rangeEnd !== null) { if (coordinates.length < 2 || coordinates.length > SOURCE_EXTENT_LIMITS.depth) return unsupported(); coordinates.forEach(extentCoordinate); const start = extentCoordinate(coordinates[coordinates.length - 1]), end = extentCoordinate(rangeEnd); if (end <= start || end - start + 1 > SOURCE_EXTENT_LIMITS.segments) return unsupported(); }
  return Object.freeze({ ref, indexTitle, coordinates, rangeEnd });
}
function scalar(value: unknown): string {
  if (typeof value !== "string" || !value.isWellFormed() || value !== "" && !value.trim() || Buffer.byteLength(value) > SOURCE_CONTENT_LIMITS.scalarBytes || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value) || /&(?:#[0-9]+|#x[a-fA-F0-9]+|[A-Za-z][A-Za-z0-9]+);/.test(value)) return fail(); return value;
}
export function parseSourceSegments(value: unknown, input: Readonly<{ source: RelatedSourceMetadata; edition: SourceEditionMetadata; language: "he" | "en" }>): SourceSegments {
  const citation = sourceNumericCitation(input.source), row = object(value), depth = get(row, "textDepth"), rawEdition = object(input.edition);
  const capturedEdition = Object.freeze(Object.fromEntries(["versionTitle", "language", "actualLanguage", "license", "source"].map(key => [key, get(rawEdition, key)])));
  const parsedEdition = parseEditionMetadata([{title:citation.indexTitle, versionTitle:capturedEdition.versionTitle, language:capturedEdition.language, actualLanguage:capturedEdition.actualLanguage, license:capturedEdition.license, versionSource:capturedEdition.source}], citation.indexTitle);
  if (parsedEdition.entries.length !== 1 || JSON.stringify(parsedEdition.entries[0]) !== JSON.stringify(capturedEdition)) return fail(); const edition = parsedEdition.entries[0];
  supportedEdition(edition, input.language);
  const range = citation.rangeEnd !== null, expectedDepth = range ? citation.coordinates.length : citation.coordinates.length + 1;
  if (expectedDepth < 2 || expectedDepth > SOURCE_EXTENT_LIMITS.depth) return unsupported();
  citation.coordinates.forEach(extentCoordinate);
  if (depth !== expectedDepth || get(row, "ref") !== citation.ref || get(row, "indexTitle") !== citation.indexTitle || get(row, "isComplex") !== false || get(row, "isSpanning") !== false) return fail();
  const types = array(get(row, "addressTypes"), 4); if (types.length !== depth || types.some(type => type !== "Integer" && type !== "Perek" && type !== "Pasuk")) return fail();
  const offsets = object(get(row, "index_offsets_by_depth")); if (Reflect.ownKeys(offsets).length) return fail();
  const endCoordinates = range ? [...citation.coordinates.slice(0, -1), citation.rangeEnd!] : [...citation.coordinates];
  for (const [key, expected] of [["sections", citation.coordinates], ["toSections", endCoordinates]] as const) { const actual = array(get(row, key), 4); if (actual.length !== expected.length || actual.some((v, i) => typeof v !== "string" || v !== expected[i])) return fail(); }
  const spanning = Object.getOwnPropertyDescriptor(row, "spanningRefs"); if (spanning && (!Object.hasOwn(spanning, "value") || array(spanning.value, 0).length)) return fail();
  if (array(get(row, "warnings"), 0).length) return fail();
  const missings = Object.getOwnPropertyDescriptor(row, "missings");
  if (missings ? !Object.hasOwn(missings, "value") || array(missings.value, 0).length : "missings" in row) return fail();
  const versions = array(get(row, "versions"), 1); if (versions.length !== 1) return fail(); const version = object(versions[0]);
  for (const [key, expected] of Object.entries({ versionTitle: edition.versionTitle, language: edition.language, actualLanguage: input.language, languageFamilyName: MOTHER_TONGUES[input.language], license: edition.license, versionSource: edition.source })) if (get(version, key) !== expected) return fail();
  const merged = Object.getOwnPropertyDescriptor(version, "sources"); if (merged && (!Object.hasOwn(merged, "value") || array(merged.value, 0).length)) return fail();
  const raw = array(get(version, "text"), SOURCE_EXTENT_LIMITS.segments), start = range ? extentCoordinate(citation.coordinates[citation.coordinates.length - 1]) : 1;
  if (range && raw.length !== extentCoordinate(citation.rangeEnd!) - start + 1) return fail();
  let aggregate = 0; const strings: string[] = []; for (const value of raw) { const text = scalar(value); aggregate += Buffer.byteLength(text); if (aggregate > SOURCE_CONTENT_LIMITS.scalarBytes) return fail(); strings.push(text); }
  const parentRef = range ? `${citation.indexTitle} ${citation.coordinates.slice(0, -1).join(":")}` : citation.ref;
  const segments: readonly SourceSegment[] = Object.freeze(strings.map((text, index) => text === "" ? Object.freeze({ ref: `${parentRef}:${start + index}`, status: "missing" as const, text: null }) : Object.freeze({ ref: `${parentRef}:${start + index}`, status: "text" as const, text })));
  return Object.freeze({ schema: "study-source-segments/v1", ref: citation.ref, extent: Object.freeze({ kind: range ? "range" : "parent", parentRef, requestedStart: range ? String(start) : null, requestedEnd: range ? citation.rangeEnd : null, observedStart: raw.length ? String(start) : null, observedEnd: raw.length ? String(start + raw.length - 1) : null }), segments,
    edition: Object.freeze({ versionTitle: edition.versionTitle, language: edition.language, actualLanguage: input.language }), provenance: Object.freeze({ provider: "Sefaria", sourceRef: citation.ref, editionTitle: edition.versionTitle, license: edition.license as "Public Domain" | "CC0", versionSource: edition.source!, format: "text_only" }) });
}
