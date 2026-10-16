import type { ServiceBlock, ServiceUnit } from "../../../lib/service-learning/types";

type Group = { indices: number[]; refrain?: boolean };
export type UnitLayout = { kind: string; groups: Group[] };
const indices = (length: number, start = 0) => Array.from({ length }, (_, i) => start + i);
const he = (block: ServiceBlock) => Boolean(block.he);
const en = (block: ServiceBlock) => block.en !== undefined;
const flow = (block: ServiceBlock) => ["stanza", "trope", "chatimah", "seasonal"].includes(block.type) || block.type === "english" && block.role !== "original";
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const counts = (value: unknown): value is readonly number[] => Array.isArray(value) && value.length > 0 && value.every(n => count(n) && n > 0);
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);
function partition(sizes: readonly number[], start = 0): Group[] {
  let at = start;
  return sizes.map(size => { const group = { indices: indices(size, at) }; at += size; return group; });
}
function interleave(blocks: readonly ServiceBlock[], selected: number[]): Group[] {
  const result: Group[] = []; let current: number[] = [];
  selected.forEach(index => {
    if (current.length && he(blocks[index]) && !he(blocks[current.at(-1)!])) { result.push({ indices: current }); current = []; }
    current.push(index);
  });
  if (current.length) result.push({ indices: current });
  return result;
}
function ordinary(unit: ServiceUnit): UnitLayout {
  const result: Group[] = [], blocks = unit.blocks;
  let at = 0;
  while (at < blocks.length) {
    if (unit.render !== "interleave" || !flow(blocks[at])) { result.push({ indices: [at++] }); continue; }
    let end = at; while (end < blocks.length && flow(blocks[end])) end++;
    const run = indices(end - at, at), first = run.findIndex(i => he(blocks[i]));
    let last = -1;
    run.forEach((i, n) => { if (n > 0 && !he(blocks[i]) && en(blocks[i]) && he(blocks[run[n - 1]])) last = n; });
    if (first < 0) result.push(...run.map(i => ({ indices: [i] })));
    else {
      if (last < first) last = run.length - 1;
      result.push(...run.slice(0, first).map(i => ({ indices: [i] })), ...interleave(blocks, run.slice(first, last + 1)), ...run.slice(last + 1).map(i => ({ indices: [i] })));
    }
    at = end;
  }
  return { kind: unit.render === "interleave" ? "interleave" : "ordinary", groups: result };
}

/** Hints may change grouping, never the selected block population. */
export function unitLayout(unit: ServiceUnit): UnitLayout {
  const fallback = ordinary(unit), s = unit.renderStructure, blocks = unit.blocks, length = blocks.length;
  if (!s || typeof s.kind !== "string") return fallback;
  const kind = s.kind, sizes = s.groups, head = s.head ?? 0, tail = s.tail ?? 0;
  let groups: Group[] | null = null;
  if (["threshold", "section-close", "section-opening", "section-opening-call", "section-start", "title-page"].includes(kind)) groups = fallback.groups;
  else if (kind === "service-event" && blocks.every(b => b.type === "rubric")) groups = fallback.groups;
  else if (["source-lines", "short-prayer"].includes(kind) && counts(sizes) && sizes.length === 1 && sizes[0] === blocks.filter(b => b.type === "stanza").length) groups = [{ indices: indices(length) }];
  else if (kind === "paragraphs" && counts(sizes) && sizes.reduce((a, b) => a + b, 0) === length) {
    const proposed = partition(sizes);
    if (proposed.every(g => g.indices.some(i => he(blocks[i])) && g.indices.some(i => en(blocks[i])))) groups = proposed;
  } else if (kind === "paired-passages" && counts(sizes) && count(head) && count(tail) && head + tail + sizes.reduce((a, b) => a + b, 0) === length) {
    const body = partition(sizes, head);
    if (body.every(g => g.indices.some(i => he(blocks[i])) && g.indices.some(i => en(blocks[i])))) groups = [...indices(head).map(i => ({ indices: [i] })), ...body, ...indices(tail, length - tail).map(i => ({ indices: [i] }))];
  } else if (kind === "parallel-passages" && count(s.rows) && s.rows > 0 && length === s.rows * 2) {
    const rows = s.rows;
    if (blocks.slice(0, rows).every(b => b.type === "stanza" && he(b)) && blocks.slice(rows).every(b => b.type === "english" && !he(b) && en(b))) groups = indices(rows).map(i => ({ indices: [i, i + rows] }));
  } else if (kind === "stanza-groups" && counts(sizes) && count(tail) && sizes.reduce((a, b) => a + b, 0) + tail === length) {
    const body = partition(sizes), at = length - tail;
    if (blocks.slice(0, at).every(b => b.type === "stanza") && blocks.slice(at).every(b => b.type !== "stanza")) groups = [...body, ...indices(tail, at).map(i => ({ indices: [i] }))];
  } else if (kind === "refrain-song" && counts(sizes) && Array.isArray(s.refrainGroups) && s.refrainGroups.length > 0) {
    const lines = indices(length).filter(i => blocks[i].type === "stanza");
    if (lines[0] === 0 && sizes.reduce((a, b) => a + b, 0) === lines.length) {
      let at = 0;
      groups = sizes.map(size => { const first = lines[at]; at += size; return { indices: indices((lines[at] ?? length) - first, first) }; });
    }
  } else if (["short-sequence", "litany"].includes(kind) && unit.render === "interleave" && counts(s.rows) && count(head) && count(tail) && head + tail < length) {
    const body = indices(length - head - tail, head), proposed = interleave(blocks, body);
    const outer = indices(head).concat(indices(tail, length - tail));
    const validOuter = kind === "litany" ? outer.length === 0 : outer.every(i => blocks[i].type === "english" && !he(blocks[i]) && en(blocks[i]));
    if (validOuter && body.every(i => flow(blocks[i])) && same(proposed.map(g => g.indices.length), s.rows) && (kind !== "litany" || count(s.refrain) && Boolean(blocks[s.refrain]?.gold && he(blocks[s.refrain])))) groups = [...indices(head).map(i => ({ indices: [i] })), ...proposed, ...indices(tail, length - tail).map(i => ({ indices: [i] }))];
  }
  if (!groups) return fallback;
  if (s.refrainGroups !== undefined) {
    const refs = s.refrainGroups;
    const population = counts(sizes) ? sizes.length : groups.length;
    if (!Array.isArray(refs) || new Set(refs).size !== refs.length || refs.some(n => !count(n) || n >= population)) return fallback;
    groups = groups.map((g, i) => ({ ...g, refrain: refs.includes(i) }));
  }
  // Coverage is checked independently of each shape's interpretation.
  if (!same(groups.flatMap(g => g.indices).sort((a, b) => a - b), indices(length))) return fallback;
  return { kind, groups };
}

export type TextSegment = { he: string; en: string };
/** Split a single canonical block, or map exact whole blocks; ambiguous maps fall back. */
export function unitSegments(unit: ServiceUnit): ReadonlyMap<number, readonly TextSegment[]> | null {
  const s = unit.renderSegments;
  if (!s || !Array.isArray(s.he) || !Array.isArray(s.en) || s.he.length === 0 || s.he.length !== s.en.length || s.he.some(x => typeof x !== "string") || s.en.some(x => typeof x !== "string")) return null;
  if (unit.blocks.some(b => b.en !== undefined && typeof b.en !== "string")) return null;
  if (s.he.join("") !== unit.blocks.map(b => b.he ?? "").join("") || s.en.join("") !== unit.blocks.map(b => b.en ?? "").join("")) return null;
  const populated = indices(unit.blocks.length).filter(i => unit.blocks[i].he !== undefined || unit.blocks[i].en !== undefined);
  if (populated.length === 1) return new Map([[populated[0], s.he.map((h, i) => ({ he: h, en: s.en[i] }))]]);
  if (populated.length !== s.he.length || populated.some((index, i) => (unit.blocks[index].he ?? "") !== s.he[i] || (unit.blocks[index].en ?? "") !== s.en[i])) return null;
  return new Map(populated.map((index, i) => [index, [{ he: s.he[i], en: s.en[i] }]]));
}
