import "server-only";
import { createHash } from "node:crypto";

// A pure adapter, not an artifact downloader, tenant authorization or rights grant.
// Licensed lane and matching hashes never imply redistribution permission. Pins
// must come from a trusted acquisition boundary, never the documents being parsed.
export const SERVICE_FEED_LIMITS = Object.freeze({ feedBytes: 2_097_152, provenanceBytes: 32_768,
  depth: 18, nodes: 100_000, string: 16_384, units: 256, sections: 64,
  blocks: 4_096, blocksPerUnit: 256, pointers: 16_384, pages: 1_024 });
export type ServiceFeedPins = Readonly<{ feedSha256: string; provenanceSha256: string;
  artifactRepo: string; artifactCommit: string; artifactRunId: string; sourceGitSha: string }>;
export type ServiceSpan = Readonly<{ t: string } | { em: readonly ServiceSpan[] } |
  { strong: readonly ServiceSpan[] } | { footnote: readonly ServiceSpan[] }>;
export type ServiceBlock = Readonly<{ type: string; he?: string; bare?: string;
  en?: string | readonly ServiceSpan[]; text?: readonly ServiceSpan[]; footnote?: readonly ServiceSpan[];
  role?: "original";
  label?: string; verse?: string; cue?: string; occasion?: string; gold?: boolean;
  folio?: number; phys?: number; marks?: readonly Readonly<{ type: string; label: string }>[] }>;
export type ServiceUnit = Readonly<{ id: string; family: "bm-shacharit" | "bm-maariv";
  name: string; section: number; blocks: readonly ServiceBlock[];
  caption?: string; standalone?: boolean; render?: "interleave"; companionOf?: string; companionRole?: string;
  group?: string | null; shortName?: string; printedFolio?: number; folios?: readonly number[];
  renderStructure?: Readonly<Record<string, string | number | readonly number[]>>;
  renderSegments?: Readonly<{ he: readonly string[]; en: readonly string[]; folios?: readonly number[] }>;
  sourceBoundaries?: Readonly<{ en: readonly Readonly<{ block: number; endAfter: string }>[] }> }>;
export type ServiceFeed = Readonly<{ identity: string; schemaVersion: 1; volume: "legacy-beit-mitzvah";
  title: string | Readonly<{ en: string; he: string }>;
  blockGranularity?: "line" | "stanza";
  source: Readonly<{ gitSha: string; builtAt: string; pages: number; lane: "licensed" }>;
  artifact: Readonly<{ repo: string; commit: string; runId: string; builtAt: string }>;
  license: Readonly<{ spdx: string; attribution?: string }>;
  sections: readonly Readonly<Record<string, string | number | boolean | null>>[];
  units: readonly ServiceUnit[]; front: readonly ServiceBlock[];
  pageIndex: Readonly<Record<string, readonly Readonly<{ unit: string; block: number }>[]>> }>;
export class ServiceFeedInvalid extends Error {
  constructor() { super("Service feed unavailable"); this.name = "ServiceFeedInvalid"; }
}
const invalid = (): never => { throw new ServiceFeedInvalid(); };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const own = (value: object, key: string) => Object.hasOwn(value, key);
function object(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const out = value as Record<string, unknown>;
  if (required.some(key => !own(out, key)) || Object.keys(out).some(key => !required.includes(key) && !optional.includes(key))) return invalid();
  return out;
}
function string(value: unknown, nonempty = false): string {
  if (typeof value !== "string" || value.length > SERVICE_FEED_LIMITS.string || (nonempty && !value.length)) return invalid();
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}
function array(value: unknown, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return invalid();
  return value;
}
function timestamp(value: unknown): string {
  const result = string(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result.replace("Z", ".000Z")) return invalid();
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

// Bound nesting, strings, tokens and duplicate object keys BEFORE JSON.parse.
// This scanner also rejects ambiguous duplicate keys expressed with JSON escapes.
function parse(bytes: Uint8Array, max: number): unknown {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > max) return invalid();
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid(); }
  const stack: ({ keys: Set<string> } | null)[] = [];
  let nodes = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i++;
      for (; i < text.length && text[i] !== '"'; i++) {
        if (i - start > SERVICE_FEED_LIMITS.string * 6) return invalid();
        if (text[i] === "\\") i++;
      }
      if (i >= text.length) return invalid();
      let decoded: unknown;
      try { decoded = JSON.parse(text.slice(start, i + 1)); } catch { return invalid(); }
      const key = string(decoded);
      let next = i + 1; while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] === ":") {
        const frame = stack.at(-1);
        if (!frame || frame.keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) return invalid();
        frame.keys.add(key);
      }
      if (++nodes > SERVICE_FEED_LIMITS.nodes) return invalid();
    } else if (char === "{" || char === "[") {
      stack.push(char === "{" ? { keys: new Set() } : null);
      if (stack.length > SERVICE_FEED_LIMITS.depth || ++nodes > SERVICE_FEED_LIMITS.nodes) return invalid();
    } else if (char === "}" || char === "]") { stack.pop(); }
    else if (char === "," && ++nodes > SERVICE_FEED_LIMITS.nodes) return invalid();
  }
  try { return JSON.parse(text); } catch { return invalid(); }
}
/**
 * The same bounded pre-parse scanner, unchanged, for the service course's public-volume parser (2.0 SC2,
 * src/server/service-course/public-feed.ts): one scanner for both lanes, so neither can drift looser than the other.
 * Throws ServiceFeedInvalid on anything it refuses.
 */
export const parseBoundedServiceJson = (bytes: Uint8Array, max: number): unknown => parse(bytes, max);
function spans(value: unknown): ServiceSpan[] {
  return array(value, 512).map(raw => {
    const entry = object(raw, [], ["t", "em", "strong", "footnote"]), keys = Object.keys(entry);
    if (keys.length !== 1) return invalid();
    const key = keys[0];
    return (key === "t" ? { t: string(entry.t) } : { [key]: spans(entry[key]) }) as ServiceSpan;
  });
}
const blockKinds = ["stanza", "trope", "english", "rubric", "chatimah", "seasonal", "display"];
const structureKinds = ["litany", "paired-passages", "paragraphs", "parallel-passages", "refrain-song", "section-close", "section-opening", "section-opening-call", "section-start", "service-event", "short-prayer", "short-sequence", "source-lines", "stanza-groups", "threshold", "title-page"];
function blocks(value: unknown, coordinateMax: number, budget: { blocks: number }): ServiceBlock[] {
  return array(value, SERVICE_FEED_LIMITS.blocksPerUnit).map(raw => {
    if (++budget.blocks > SERVICE_FEED_LIMITS.blocks) return invalid();
    const block = object(raw, ["type"], ["he", "bare", "tr", "en", "text", "footnote", "role", "label", "verse", "cue", "occasion", "gold", "folio", "phys", "marks"]);
    if (!blockKinds.includes(string(block.type))) return invalid();
    const out: Record<string, unknown> = { type: block.type };
    for (const key of ["he", "bare", "label", "verse", "cue", "occasion"]) if (own(block, key)) out[key] = string(block[key]);
    if (own(block, "tr")) string(block.tr); // validated, deliberately not projected
    if (own(block, "en")) out.en = typeof block.en === "string" ? string(block.en) : spans(block.en);
    // Source-owned English, distinct from a translation. No role inferred here.
    if (own(block, "role")) {
      if (block.role !== "original" || block.type !== "english" || !own(block, "en")) return invalid();
      out.role = "original";
    }
    for (const key of ["text", "footnote"]) if (own(block, key)) out[key] = spans(block[key]);
    if (own(block, "gold")) { if (typeof block.gold !== "boolean") return invalid(); out.gold = block.gold; }
    for (const key of ["folio", "phys"]) if (own(block, key)) out[key] = integer(block[key], 0, coordinateMax);
    if (own(block, "marks")) out.marks = array(block.marks, 64).map(raw => {
      const mark = object(raw, ["type", "label"]); return { type: string(mark.type, true), label: string(mark.label) };
    });
    if (own(block, "verse") && own(block, "label") && block.verse !== block.label) return invalid();
    return out as ServiceBlock;
  });
}
function structure(value: unknown, count: number): Record<string, string | number | number[]> {
  const raw = object(value, ["kind"], ["groups", "rows", "head", "tail", "refrain", "refrainGroups"]);
  if (!structureKinds.includes(string(raw.kind))) return invalid();
  const out: Record<string, string | number | number[]> = { kind: raw.kind as string };
  for (const key of ["head", "tail", "refrain"]) if (own(raw, key)) out[key] = integer(raw[key], 0, key === "refrain" ? count - 1 : count);
  for (const key of ["groups", "rows", "refrainGroups"]) if (own(raw, key)) {
    if (key === "rows" && typeof raw[key] === "number") out[key] = integer(raw[key], 1, count);
    else {
      const counts = array(raw[key], count, key === "refrainGroups" ? 0 : 1).map(x => integer(x, key === "refrainGroups" ? 0 : 1, key === "refrainGroups" ? count - 1 : count));
      if (key !== "refrainGroups" && counts.reduce((a, b) => a + b, 0) > count) return invalid();
      out[key] = counts;
    }
  }
  // The reader's head/tail are counts despite the schema's index wording.
  // Groups/rows must fit the body; paired passages and stanza groups cover it.
  const head = typeof out.head === "number" ? out.head : 0, tail = typeof out.tail === "number" ? out.tail : 0;
  if (head + tail > count) return invalid();
  for (const key of ["groups", "rows"]) if (Array.isArray(out[key])) {
    const consumed = (out[key] as number[]).reduce((a, b) => a + b, 0) + head + tail;
    if (consumed > count || (key === "groups" && ["paired-passages", "stanza-groups"].includes(out.kind as string) && consumed !== count)) return invalid();
  }
  if (typeof out.rows === "number" && out.rows > count - head - tail) return invalid();
  if (Array.isArray(out.refrainGroups)) {
    if (!Array.isArray(out.groups) || new Set(out.refrainGroups).size !== out.refrainGroups.length ||
      out.refrainGroups.some(index => index >= (out.groups as number[]).length) ||
      (out.kind === "refrain-song" && !out.refrainGroups.length)) return invalid();
  }
  return out;
}
function unit(raw: unknown, sectionIds: Set<number>, pages: number, budget: { blocks: number }): ServiceUnit {
  const value = object(raw, ["id", "name", "section", "blocks"], ["caption", "standalone", "render", "companionOf", "companionRole", "group", "shortName", "printedFolio", "folios", "renderStructure", "renderSegments", "sourceBoundaries"]);
  const id = string(value.id), match = /^[a-z0-9-]+(?:\.[a-z0-9-]+)?@(bm-shacharit|bm-maariv)$/.exec(id);
  if (!match || !sectionIds.has(integer(value.section, 0, SERVICE_FEED_LIMITS.sections - 1))) return invalid();
  // Source pages count the served original PDF. Folio/phys describe the separate
  // internal typeset, and must not be interpreted as destinations in that PDF.
  const coordinateMax = SERVICE_FEED_LIMITS.pages;
  const parsedBlocks = blocks(value.blocks, coordinateMax, budget);
  const out: Record<string, unknown> = { id, family: match[1], name: string(value.name, true), section: value.section, blocks: parsedBlocks };
  if (own(value, "caption")) out.caption = string(value.caption);
  for (const key of ["companionOf", "companionRole", "shortName"]) if (own(value, key)) out[key] = string(value[key], true);
  if (own(value, "companionOf") !== own(value, "companionRole")) return invalid();
  if (own(value, "group")) out.group = value.group === null ? null : string(value.group, true);
  if (own(value, "standalone")) { if (typeof value.standalone !== "boolean") return invalid(); out.standalone = value.standalone; }
  if (own(value, "render")) { if (value.render !== "interleave") return invalid(); out.render = value.render; }
  if (own(value, "printedFolio")) out.printedFolio = integer(value.printedFolio, 0, pages);
  if (own(value, "folios")) {
    const folios = array(value.folios, coordinateMax).map(x => integer(x, 0, coordinateMax));
    if (folios.some((x, i) => i > 0 && x <= folios[i - 1])) return invalid(); out.folios = folios;
  }
  if (own(value, "renderStructure")) out.renderStructure = structure(value.renderStructure, parsedBlocks.length);
  if (own(value, "renderSegments")) {
    const segments = object(value.renderSegments, ["he", "tr", "en"], ["folios"]);
    const he = array(segments.he, 512, 1).map(x => string(x)), en = array(segments.en, 512, 1).map(x => string(x));
    const tr = array(segments.tr, 512, 1).map(x => string(x));
    // Only canonical plain blocks can support these coordinated segments.
    for (const [key, pieces] of [["he", he], ["en", en], ["tr", tr]] as const) {
      const source = (value.blocks as Record<string, unknown>[]).map(x => x[key] ?? "");
      if (source.some(x => typeof x !== "string") || pieces.join("") !== source.join("")) return invalid();
    }
    if (he.length !== en.length || tr.length !== he.length) return invalid();
    out.renderSegments = { he, en, ...(own(segments, "folios") ? { folios: array(segments.folios, he.length, he.length).map(x => integer(x, 0, coordinateMax)) } : {}) };
  }
  if (own(value, "sourceBoundaries")) {
    const boundaries = object(value.sourceBoundaries, ["en"]), positions = new Map<number, number>();
    out.sourceBoundaries = { en: array(boundaries.en, 512, 1).map(raw => {
      const pointer = object(raw, ["block", "endAfter"]), block = integer(pointer.block, 0, parsedBlocks.length - 1);
      const anchor = string(pointer.endAfter, true), text = parsedBlocks[block].en;
      if (typeof text !== "string" || text.indexOf(anchor) < 0 || text.indexOf(anchor) !== text.lastIndexOf(anchor)) return invalid();
      const end = text.indexOf(anchor) + anchor.length;
      if (end >= text.length || end <= (positions.get(block) ?? 0)) return invalid(); positions.set(block, end);
      return { block, endAfter: anchor };
    }) };
  }
  return out as ServiceUnit;
}

export function parseServiceFeed(feedBytes: Uint8Array, provenanceBytes: Uint8Array, pins: ServiceFeedPins): ServiceFeed {
  try { return parsePinnedFeed(feedBytes, provenanceBytes, pins); }
  catch { return invalid(); } // Never expose parser exceptions, input text or identifiers.
}
function parsePinnedFeed(feedBytes: Uint8Array, provenanceBytes: Uint8Array, pins: ServiceFeedPins): ServiceFeed {
  // Size gate precedes hashing as well as decoding/parsing.
  if (!(feedBytes instanceof Uint8Array) || feedBytes.byteLength > SERVICE_FEED_LIMITS.feedBytes || !(provenanceBytes instanceof Uint8Array) || provenanceBytes.byteLength > SERVICE_FEED_LIMITS.provenanceBytes) return invalid();
  if (!pins || !/^[a-f0-9]{64}$/.test(pins.feedSha256) || !/^[a-f0-9]{64}$/.test(pins.provenanceSha256) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pins.artifactRepo) || !/^[a-f0-9]{40}$/.test(pins.artifactCommit) ||
    !/^[1-9]\d{0,19}$/.test(pins.artifactRunId) || !/^[a-f0-9]{7,40}(?:-LICENSED)?$/.test(pins.sourceGitSha) ||
    hash(feedBytes) !== pins.feedSha256 || hash(provenanceBytes) !== pins.provenanceSha256) return invalid();
  const artifact = object(parse(provenanceBytes, SERVICE_FEED_LIMITS.provenanceBytes), ["schemaVersion", "producedBy", "sourceRepo", "sourceSha", "sourceShaShort", "sourceRef", "builtAt", "runId", "runUrl", "bookCount", "books", "lane", "laneWhy"]);
  if (artifact.schemaVersion !== 1 || artifact.producedBy !== "build/build-app.sh via .github/workflows/build-siddur.yml" ||
    artifact.sourceRepo !== pins.artifactRepo || artifact.sourceSha !== pins.artifactCommit || artifact.sourceShaShort !== pins.artifactCommit.slice(0, 7) ||
    artifact.sourceRef !== "refs/heads/main" || artifact.runId !== pins.artifactRunId || artifact.lane !== "licensed" ||
    artifact.runUrl !== `https://github.com/${pins.artifactRepo}/actions/runs/${pins.artifactRunId}`) return invalid();
  string(artifact.laneWhy, true);
  const books = array(artifact.books, 128, 1).map(x => string(x, true));
  if (integer(artifact.bookCount, 1, 128) !== books.length || new Set(books).size !== books.length || !books.includes("legacy-beit-mitzvah")) return invalid();
  const artifactBuiltAt = timestamp(artifact.builtAt);
  const feed = object(parse(feedBytes, SERVICE_FEED_LIMITS.feedBytes), ["schemaVersion", "volume", "title", "printing", "license", "sections", "units", "pageIndex"], ["front", "blockGranularity"]);
  if (feed.schemaVersion !== 1 || feed.volume !== "legacy-beit-mitzvah") return invalid();
  if (own(feed, "blockGranularity") && feed.blockGranularity !== "line" && feed.blockGranularity !== "stanza") return invalid();
  const title = typeof feed.title === "string" ? string(feed.title, true) : (() => { const v = object(feed.title, ["en", "he"]); return { en: string(v.en), he: string(v.he) }; })();
  // Reader-authored carry metadata is deliberately outside this producer adapter.
  const printing = object(feed.printing, ["gitSha", "pages", "builtAt", "source"]);
  const source = object(printing.source, ["gitSha", "pages", "builtAt", "lane"]);
  if (source.gitSha !== pins.sourceGitSha || printing.gitSha !== source.gitSha || source.lane !== "licensed" || printing.pages !== source.pages || printing.builtAt !== source.builtAt) return invalid();
  const pages = integer(source.pages, 1, SERVICE_FEED_LIMITS.pages), builtAt = timestamp(source.builtAt);
  const license = object(feed.license, ["spdx"], ["attribution"]);
  const projectedLicense = { spdx: string(license.spdx, true), ...(own(license, "attribution") ? { attribution: string(license.attribution, true) } : {}) };
  const sectionIds = new Set<number>();
  const sections = array(feed.sections, SERVICE_FEED_LIMITS.sections, 1).map(raw => {
    const value = object(raw, ["idx"], ["en", "he", "blurb", "cue", "epithet", "folio", "opener"]), idx = integer(value.idx, 0, SERVICE_FEED_LIMITS.sections - 1);
    if (sectionIds.has(idx)) return invalid(); sectionIds.add(idx);
    const out: Record<string, string | number | boolean | null> = { idx };
    for (const key of ["en", "he", "blurb", "cue", "epithet"]) if (own(value, key)) out[key] = value[key] === null ? null : string(value[key]);
    if (own(value, "folio")) out.folio = value.folio === null ? null : integer(value.folio, 0, SERVICE_FEED_LIMITS.pages);
    if (own(value, "opener")) {
      if (typeof value.opener !== "boolean") return invalid(); out.opener = value.opener;
    }
    return out;
  });
  const budget = { blocks: 0 }, units = array(feed.units, SERVICE_FEED_LIMITS.units, 1).map(x => unit(x, sectionIds, pages, budget));
  const byId = new Map(units.map(x => [x.id, x]));
  if (byId.size !== units.length) return invalid();
  for (const value of units) if (value.companionOf && (!byId.has(value.companionOf) || value.companionOf === value.id || byId.get(value.companionOf)?.family !== value.family)) return invalid();
  for (const value of units) {
    const seen = new Set<string>(); let current: ServiceUnit | undefined = value;
    while (current) {
      if (seen.has(current.id)) return invalid(); seen.add(current.id);
      current = current.companionOf ? byId.get(current.companionOf) : undefined;
    }
  }
  // An arbitrary-key map needs a cardinality gate, not an O(n^2) dynamic whitelist.
  if (!feed.pageIndex || typeof feed.pageIndex !== "object" || Array.isArray(feed.pageIndex)) return invalid();
  const pageIndex = feed.pageIndex as Record<string, unknown>;
  if (Object.keys(pageIndex).length > SERVICE_FEED_LIMITS.pages + 1) return invalid();
  const projectedPages: Record<string, { unit: string; block: number }[]> = {};
  const expectedPages: Record<string, { unit: string; block: number }[]> = {};
  for (const value of units) value.blocks.forEach((block, index) => {
    if (block.folio === undefined) return;
    const entries = expectedPages[String(block.folio)] ??= [];
    if (!entries.some(entry => entry.unit === value.id)) entries.push({ unit: value.id, block: index });
  });
  let pointers = 0;
  for (const [page, entries] of Object.entries(pageIndex)) {
    if (!/^(0|[1-9]\d*)$/.test(page)) return invalid(); integer(Number(page), 0, SERVICE_FEED_LIMITS.pages);
    const seen = new Set<string>();
    projectedPages[page] = array(entries, SERVICE_FEED_LIMITS.pointers).map(raw => {
      if (++pointers > SERVICE_FEED_LIMITS.pointers) return invalid();
      const pointer = object(raw, ["unit", "block"]), id = string(pointer.unit), target = byId.get(id);
      if (!target) return invalid(); const block = integer(pointer.block, 0, target.blocks.length - 1), key = `${id}:${block}`;
      if (seen.has(key) || (target.blocks[block].folio !== undefined && target.blocks[block].folio !== Number(page))) return invalid(); seen.add(key);
      return { unit: id, block };
    });
  }
  if (Object.keys(projectedPages).length !== Object.keys(expectedPages).length ||
    Object.entries(expectedPages).some(([page, entries]) => JSON.stringify(projectedPages[page]) !== JSON.stringify(entries))) return invalid();
  const front = own(feed, "front") ? blocks(feed.front, SERVICE_FEED_LIMITS.pages, budget) : [];
  const identity = createHash("sha256").update(`beit-mitzvah-service-feed-v1\0${pins.feedSha256}\0${pins.provenanceSha256}`).digest("hex");
  return freeze({ identity, schemaVersion: 1, volume: "legacy-beit-mitzvah", title,
    ...(own(feed, "blockGranularity") ? { blockGranularity: feed.blockGranularity as "line" | "stanza" } : {}),
    source: { gitSha: pins.sourceGitSha, pages, builtAt, lane: "licensed" },
    artifact: { repo: pins.artifactRepo, commit: pins.artifactCommit, runId: pins.artifactRunId, builtAt: artifactBuiltAt },
    license: projectedLicense, sections, units, front, pageIndex: projectedPages });
}

// Classification only: no religious subset, default assignment or unknown-slot fallback.
export function serviceUnitsForSlot(feed: ServiceFeed, slot: "morning" | "havdalah" | "unknown"): readonly ServiceUnit[] {
  if (slot === "unknown") return Object.freeze([]);
  if (slot !== "morning" && slot !== "havdalah") return invalid();
  const family = slot === "morning" ? "bm-shacharit" : "bm-maariv";
  return Object.freeze(feed.units.filter(unit => unit.family === family));
}

// MISSION rulings 28-30: every CRC student leads the Torah and haftarah blessings and the Sh'ma and
// V'ahavta; the rest of the service is a per-student menu. These are the feed's stable unit ids for
// those parts, without the service family suffix ("@bm-shacharit" / "@bm-maariv").
export const DEFAULT_SERVICE_PARTS = Object.freeze(["torah.blessing-before-the-torah-reading", "torah.blessing-following-the-torah-reading",
  "torah.blessing-before-the-haftarah-reading", "torah.blessing-following-the-haftarah-reading", "shma.the-shma", "shma.vahavta"]);
/** The default parts this feed actually provides for the slot, in service order. A part the feed lacks is simply not offered. */
export function defaultServiceUnitIds(feed: ServiceFeed, slot: "morning" | "havdalah" | "unknown"): readonly string[] {
  if (slot === "unknown") return Object.freeze([]);
  const family = slot === "morning" ? "bm-shacharit" : "bm-maariv", wanted = new Set(DEFAULT_SERVICE_PARTS.map(base => `${base}@${family}`));
  return Object.freeze(serviceUnitsForSlot(feed, slot).filter(unit => wanted.has(unit.id)).map(unit => unit.id));
}
