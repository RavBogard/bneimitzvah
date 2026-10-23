import "server-only";
import { parseCompareVerse } from "../../lib/readings/compare";
import { curatedMatch, parseSourceRef, shelfGroupLabel, shelfGroupOf, shelfSefariaUrl, SHELF_GROUPS, SHELF_LIMITS, type ShelfAnswer, type ShelfGroup, type ShelfGroupKey,
  type ShelfItem, type ShelfWork } from "../../lib/readings/shelf";
import { absent, anchor, field, hasText, list, plain, row, SOURCE_METADATA_LIMITS, SourceMetadataUnavailable } from "./sources/metadata";

/**
 * The shelf's projection of Sefaria's links for one verse (`/api/links/<verse>?with_text=0`). It keeps only
 * rows anchored on the verse (the metadata rule: anchorRef, or a short anchorRefExpanded that names it) with a
 * plain citation, title and category, and from them only the work, its dates and the citations. The signed-in
 * related-sources parser and its catalog hash are untouched; this is its own projection.
 */
const fail = (): never => { throw new SourceMetadataUnavailable(); };
type Link = Readonly<{ ref: string; indexTitle: string; category: string; title: string; heTitle: string | null; dates: readonly [number, number] | null }>;

function datesOf(value: unknown): readonly [number, number] | null {
  const years = list(value, 2);
  if (!years?.length || !years.every(year => Number.isSafeInteger(year) && Number(year) >= -4000 && Number(year) <= 2100)) return null;
  const [from, to = from] = years as number[];
  return from <= to ? Object.freeze([from, to] as const) : null;
}
function linkOf(value: unknown, verse: string): Link | null {
  const r = row(value);
  if (!r) return null;
  if (hasText(r)) return fail(); // asked for without text: a body here is not the answer we asked for
  const ref = parseSourceRef(plain(field(r, "sourceRef"), SHELF_LIMITS.ref));
  const indexTitle = plain(field(r, "index_title"), SHELF_LIMITS.title), category = plain(field(r, "category"), SHELF_LIMITS.category);
  if (!ref || !indexTitle || !category || !anchor(r, verse)) return null;
  const titles = field(r, "collectiveTitle"), labels = titles === absent || titles === null ? null : row(titles);
  if (titles !== absent && titles !== null && !labels) return null;
  const en = labels ? field(labels, "en") : null, he = labels ? field(labels, "he") : null;
  const title = en === absent || en === null || en === "" ? indexTitle : plain(en, SHELF_LIMITS.title);
  const heTitle = he === absent || he === null || he === "" ? null : plain(he, SHELF_LIMITS.title);
  if (!title || he !== absent && he !== null && he !== "" && !heTitle) return null;
  return Object.freeze({ ref, indexTitle, category, title, heTitle, dates: datesOf(field(r, "compDate")) });
}

/** A comment's parent when it is a comment on a verse ("Ramban on Genesis 12:1:2" → "Ramban on Genesis 12:1"). */
function parentOf(link: Link): string | null {
  const match = /^(.+ \d+[ab]?:\d+(?::\d+)*):\d+$/u.exec(link.ref);
  return match && link.ref.startsWith(`${link.indexTitle} `) ? match[1] : null;
}
/** Comments of one work on the same verse fold into one item that opens them together; everything else stands alone. */
function itemsOf(links: readonly Link[]): ShelfItem[] {
  const parents = new Map<string, number>();
  for (const link of links) { const parent = parentOf(link); if (parent) parents.set(parent, (parents.get(parent) ?? 0) + 1); }
  const items: ShelfItem[] = [], folded = new Set<string>();
  for (const link of links) {
    const parent = parentOf(link);
    if (parent && parents.get(parent)! > 1) {
      if (folded.has(parent)) continue;
      folded.add(parent); items.push(Object.freeze({ ref: parent, segments: Math.min(parents.get(parent)!, SHELF_LIMITS.segments) }));
    } else items.push(Object.freeze({ ref: link.ref, segments: 1 }));
  }
  return items;
}

const TALMUD_RANK = (work: { title: string; category: string }) =>
  work.category === "Talmud" ? work.title.startsWith("Jerusalem Talmud") ? 1 : 0 : work.category === "Mishnah" ? 2 : 3;
const byDates = (a: { dates: readonly [number, number] | null; title: string }, b: typeof a) =>
  (a.dates?.[0] ?? Infinity) - (b.dates?.[0] ?? Infinity) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

export function parseShelfLinks(value: unknown, requested: string): ShelfAnswer {
  const verse = parseCompareVerse(requested);
  if (!verse) return fail();
  const rows = list(value, SOURCE_METADATA_LIMITS.related);
  if (!rows) return fail();
  const seen = new Set<string>(), works = new Map<string, { group: ShelfGroupKey; title: string; heTitle: string | null; category: string; dates: readonly [number, number] | null; links: Link[] }>();
  for (const raw of rows) {
    const link = linkOf(raw, verse.ref);
    if (!link || seen.has(link.ref)) continue;
    seen.add(link.ref);
    const group = shelfGroupOf(link.category), key = JSON.stringify([group, group === "other" ? link.category : "", link.title]);
    const work = works.get(key) ?? { group, title: link.title, heTitle: link.heTitle, category: link.category, dates: link.dates, links: [] };
    if (!works.has(key)) works.set(key, work);
    work.dates ??= link.dates; work.heTitle ??= link.heTitle;
    work.links.push(link);
  }
  const categoryRows = new Map<string, number>();
  for (const work of works.values()) categoryRows.set(work.category, (categoryRows.get(work.category) ?? 0) + work.links.length);
  const groups: { key: ShelfGroupKey; label: string; count: number; works: ShelfWork[] }[] = [];
  for (const definition of SHELF_GROUPS) {
    const curated = definition.curated[verse.corpus];
    const rank = (title: string) => { const at = curated.findIndex(name => curatedMatch(title, name)); return at < 0 ? Infinity : at; };
    const members = [...works.values()].filter(work => work.group === definition.key).map(work => ({ ...work, rank: rank(work.title) }));
    if (!members.length) continue;
    members.sort((a, b) => definition.key === "other"
      ? categoryRows.get(b.category)! - categoryRows.get(a.category)! || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0) || b.links.length - a.links.length || byDates(a, b)
      : definition.key === "talmud" ? TALMUD_RANK(a) - TALMUD_RANK(b) || byDates(a, b)
        : a.rank - b.rank || byDates(a, b));
    groups.push({ key: definition.key, label: shelfGroupLabel(definition.key), count: members.reduce((sum, work) => sum + work.links.length, 0), works: members.map(work => {
      const items = itemsOf(work.links);
      return Object.freeze({ title: work.title, heTitle: work.heTitle, dates: work.dates, category: work.category, curated: Number.isFinite(work.rank),
        items: Object.freeze(items.slice(0, SHELF_LIMITS.itemsPerWork)), more: Math.max(0, items.length - SHELF_LIMITS.itemsPerWork) });
    }) });
  }
  // Bounded: at most 400 works and 384 KiB, giving up the least prominent works first (the end of the last group).
  const total = () => groups.reduce((sum, group) => sum + group.works.length, 0);
  const answer = () => ({ verse: verse.ref, sefariaUrl: shelfSefariaUrl(verse.ref), groups: groups.filter(group => group.works.length).map(group => Object.freeze({ ...group, works: Object.freeze([...group.works]) })) });
  const trim = () => { const last = [...groups].reverse().find(group => group.works.length); last?.works.pop(); return Boolean(last); };
  while (total() > SHELF_LIMITS.works && trim()) { /* drop */ }
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  let size = bytes(answer());
  while (size > SHELF_LIMITS.responseBytes) {
    const last = [...groups].reverse().find(group => group.works.length); if (!last) break;
    size -= bytes(last.works.pop()) + 1;
    if (!last.works.length) size = bytes(answer()); // a group gone changes the frame too
  }
  if (bytes(answer()) > SHELF_LIMITS.responseBytes) return fail();
  return Object.freeze({ ...answer(), groups: Object.freeze(answer().groups as ShelfGroup[]) });
}
