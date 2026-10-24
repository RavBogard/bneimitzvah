import type { FamilyId } from "../trope/chart-catalog";
import { COURSE, lookAlikeExamples, MELODY_FAMILIES, TROPE_IDS, type Drill, type LookAlikeMark, type LookAlikePairId, type LookAlikeWord, type Melody, type TropeId } from "./course";
import { isSpecialMelody, lookAlikeMatches, type AnalysedVerse } from "./verse";

/**
 * Item generation over the verses the course has loaded (plan, Decided 3). Pure: a seeded rng makes
 * every run reproducible in tests. The rules are ACTIVITIES.md's last section.
 */
export type Phrase = Readonly<{ ref: string; kind: Melody; family: FamilyId; words: readonly [number, number]; tropes: readonly (TropeId | null)[]; book: string; verseUnits: number }>;
export type Pools = Readonly<{ families: ReadonlyMap<FamilyId, ReadonlyMap<Melody, readonly Phrase[]>>; verses: ReadonlyMap<string, AnalysedVerse> }>;
export const POOL_RULES = Object.freeze({ minWords: 1, maxWords: 5 });
export const phraseKey = (phrase: Pick<Phrase, "ref" | "words">) => `${phrase.ref}#${phrase.words[0]}-${phrase.words[1]}`;

/** May this verse's phrase join its family's pool? */
function eligible(verse: AnalysedVerse, family: FamilyId, length: number): boolean {
  if (length < POOL_RULES.minWords || length > POOL_RULES.maxWords) return false;
  // Sof pasuk's cadence changes on the last verse of an aliyah or a haftarah, so a verse the course
  // cannot place stays out of that pool; the end of the haftarah is only ever the last verse.
  if (family === "sof-pasuk") return verse.endsRecording === false && !verse.final;
  if (family === "sof-haftarah") return verse.final && verse.kind === "haftarah";
  return true;
}

/** family -> melody -> phrases. Every phrase of every loaded verse joins, not only the example phrase. */
export function buildPools(verses: readonly AnalysedVerse[]): Pools {
  const families = new Map<FamilyId, Map<Melody, Phrase[]>>(), byRef = new Map<string, AnalysedVerse>(), seen = new Set<string>();
  for (const verse of verses) {
    if (!verse.wordReady || isSpecialMelody(verse.ref)) continue;
    const known = byRef.get(verse.ref);
    if (known && known.kind !== verse.kind) continue;
    byRef.set(verse.ref, verse);
    for (const phrase of verse.phrases) {
      const length = phrase.units[1] - phrase.units[0] + 1, row: Phrase = Object.freeze({ ref: verse.ref, kind: verse.kind, family: phrase.family, words: phrase.units,
        tropes: Object.freeze(verse.units.slice(phrase.units[0], phrase.units[1] + 1).map(unit => unit.trope)), book: verse.book, verseUnits: verse.units.length });
      if (!eligible(verse, phrase.family, length) || seen.has(phraseKey(row))) continue;
      seen.add(phraseKey(row));
      const melodies = families.get(phrase.family) ?? new Map<Melody, Phrase[]>(); families.set(phrase.family, melodies);
      const list = melodies.get(verse.kind) ?? []; melodies.set(verse.kind, list); list.push(row);
    }
  }
  return Object.freeze({ families, verses: byRef });
}
export const poolOf = (pools: Pools, family: FamilyId, melody: Melody): readonly Phrase[] => pools.families.get(family)?.get(melody) ?? [];

/** A small seeded generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle<T>(values: readonly T[], rng: () => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function weighted<T>(values: readonly T[], weight: (value: T) => number, rng: () => number): T {
  const total = values.reduce((sum, value) => sum + weight(value), 0);
  let pick = rng() * total;
  for (const value of values) { pick -= weight(value); if (pick < 0) return value; }
  return values.at(-1)!;
}

export type NameItem = Readonly<{ type: "hear-and-name"; key: string; answer: Phrase; choices: readonly FamilyId[] }>;
export type SameItem = Readonly<{ type: "same-or-different"; key: string; first: Phrase; second: Phrase; same: boolean; by: "family" | "melody" }>;
export type EndItem = Readonly<{ type: "where-does-it-end"; key: string; target: Phrase; audio: boolean }>;
export type TapItem = Readonly<{ type: "tap-the-phrase"; key: string; target: Phrase }>;
export type BuildItem = Readonly<{ type: "build-the-phrase"; key: string; phrase: Phrase; tiles: readonly TropeId[] }>;
/** One look-alike word on screen, in its verse as loaded. */
export type LookSide = Readonly<{ word: LookAlikeWord; verse: AnalysedVerse }>;
/** Same sign, different place: two words side by side; the learner taps the one carrying `ask`. `answer` is its place in `shown`. */
export type LookItem = Readonly<{ type: "look-alikes"; key: string; pair: LookAlikePairId; context: "word" | "previous-word"; ask: LookAlikeMark;
  shown: readonly [LookSide, LookSide]; answer: 0 | 1; hard: boolean; mode: "read" | "hear"; first: boolean }>;
/** Which half of the verse: `target` is a phrase of a verse with one etnachta, on unit `rest`; before or after it? */
export type HalfItem = Readonly<{ type: "which-half"; key: string; target: Phrase; rest: number; half: "before" | "after"; audio: "lead-in" | "phrase" }>;
export type DrillItem = NameItem | SameItem | EndItem | TapItem | BuildItem | LookItem | HalfItem;
/** The verses an item plays from; consecutive items never share one. */
export const itemRefs = (item: DrillItem): string[] => item.type === "same-or-different" ? [item.first.ref, item.second.ref]
  : item.type === "look-alikes" ? [...new Set(item.shown.map(side => side.verse.ref))]
  : [item.type === "hear-and-name" ? item.answer.ref : item.type === "build-the-phrase" ? item.phrase.ref : item.target.ref];
/** The family and melody whose review card an item answers; look-alikes and which-half answer none (they teach marks and halves). */
export const itemCard = (item: DrillItem): { family: FamilyId; melody: Melody } | null => {
  if (item.type === "look-alikes" || item.type === "which-half") return null;
  const phrase = item.type === "hear-and-name" ? item.answer : item.type === "same-or-different" ? item.first : item.type === "build-the-phrase" ? item.phrase : item.target;
  return { family: phrase.family, melody: phrase.kind };
};

/** The phrase of a verse that holds unit `unit`, as a pool phrase, for a look-alike heard in its phrase. */
export function phraseAt(verse: AnalysedVerse, unit: number): Phrase | null {
  const phrase = verse.phrases.find(row => row.units[0] <= unit && unit <= row.units[1]); if (!phrase) return null;
  return Object.freeze({ ref: verse.ref, kind: verse.kind, family: phrase.family, words: phrase.units,
    tropes: Object.freeze(verse.units.slice(phrase.units[0], phrase.units[1] + 1).map(row => row.trope)), book: verse.book, verseUnits: verse.units.length });
}
/** The unit of a verse's one etnachta, or null when it has none or more than one. */
export function restUnit(verse: AnalysedVerse): number | null {
  const rests = verse.units.filter(unit => unit.trope === "etnachta");
  return rests.length === 1 ? rests[0].index : null;
}

/** Picks phrases so that no two in a row share a verse and books are spread: least-used book first. */
function picker(rng: () => number) {
  const books = new Map<string, number>(), used = new Set<string>();
  let previous: string[] = [];
  return {
    pick(candidates: readonly Phrase[], avoid: readonly string[] = []): Phrase | null {
      const fresh = candidates.filter(phrase => !previous.includes(phrase.ref) && !avoid.includes(phrase.ref));
      if (!fresh.length) return null;
      const unused = fresh.filter(phrase => !used.has(phraseKey(phrase))), pool = unused.length ? unused : fresh;
      const least = Math.min(...pool.map(phrase => books.get(phrase.book) ?? 0));
      const best = pool.filter(phrase => (books.get(phrase.book) ?? 0) === least);
      const choice = best[Math.floor(rng() * best.length)];
      used.add(phraseKey(choice)); books.set(choice.book, (books.get(choice.book) ?? 0) + 1);
      return choice;
    },
    done(refs: string[]) { previous = refs; },
  };
}
/** The answer families of a run: the lesson's own family about half the time, the rest spread evenly. */
function answerPlan(families: readonly FamilyId[], focus: FamilyId | null, items: number, available: (family: FamilyId) => boolean, rng: () => number): FamilyId[] {
  const live = families.filter(available);
  if (!live.length) return [];
  const own = focus && live.includes(focus) ? focus : null, others = shuffle(live.filter(family => family !== own), rng), plan: FamilyId[] = [];
  for (let i = 0; i < items; i++) plan.push(own && (i % 2 === 0 || !others.length) ? own : others[(own ? (i - 1) / 2 | 0 : i) % others.length]);
  return shuffle(plan, rng);
}
/** Distractor weight: 2 to 1 toward the answer's confusable neighbours, times the activity's own weight. */
function distractorWeight(answer: FamilyId, weight: Readonly<Partial<Record<FamilyId, number>>>) {
  const near = COURSE.families[answer]?.confusedWith ?? [];
  return (family: FamilyId) => (near.includes(family) ? 2 : 1) * (weight[family] ?? 1);
}
const DECOYS: readonly TropeId[] = ["munach", "mercha", "tipcha", "mahpach", "pashta", "darga", "kadma", "etnachta", "revia", "zakef-katan", "tevir", "segol"];

export type DrillContext = Readonly<{ melody: Melody; focus: FamilyId | null }>;
/** The items of one drill run. Fewer come back than planned only when the loaded verses cannot fill it. */
export function drillItems(activity: Drill, pools: Pools, context: DrillContext, rng: () => number): DrillItem[] {
  const out: DrillItem[] = [], picks = picker(rng), melody = context.melody;
  const push = (item: DrillItem) => { out.push(item); picks.done(itemRefs(item)); };
  const key = (type: string, ...parts: string[]) => `${type}:${out.length}:${parts.join("|")}`;
  switch (activity.type) {
    case "hear-and-name": {
      const { families, items, choices, weight } = activity.params;
      for (const family of answerPlan(families, context.focus, items, family => poolOf(pools, family, melody).length > 0, rng)) {
        const answer = picks.pick(poolOf(pools, family, melody)); if (!answer) continue;
        const rest = families.filter(other => other !== family), chosen: FamilyId[] = [family], score = distractorWeight(family, weight);
        while (chosen.length < Math.min(choices, families.length) && rest.length) { const next = weighted(rest, score, rng); chosen.push(next); rest.splice(rest.indexOf(next), 1); }
        push({ type: "hear-and-name", key: key("name", phraseKey(answer)), answer, choices: Object.freeze(shuffle(chosen, rng)) });
      }
      break;
    }
    case "same-or-different": {
      const { families, items, melodies } = activity.params;
      const same = shuffle(Array.from({ length: items }, (_, i) => i % 2 === 0), rng);
      if (melodies) {
        // The same family in two tunes: "same" is two verses in one melody, "different" one of each.
        const family = families[0];
        for (const alike of same) {
          const a = shuffle(MELODY_FAMILIES.torah.includes(family) ? ["torah", "haftarah"] as const : ["haftarah"] as const, rng)[0];
          const b: Melody = alike ? a : a === "torah" ? "haftarah" : "torah";
          const first = picks.pick(poolOf(pools, family, a)), second = first && picks.pick(poolOf(pools, family, b), [first.ref]);
          if (first && second) push({ type: "same-or-different", key: key("same", phraseKey(first), phraseKey(second)), first, second, same: alike, by: "melody" });
        }
        break;
      }
      const live = families.filter(family => poolOf(pools, family, melody).length > 0);
      for (const [i, alike] of same.entries()) {
        // With a focus family (the lesson's, or a review slot's), every pair starts from it.
        const a = context.focus && live.includes(context.focus) ? context.focus : live[(i + Math.floor(rng() * live.length)) % Math.max(1, live.length)]; if (!a) break;
        const others = live.filter(family => family !== a);
        const b = alike || !others.length ? a : weighted(others, distractorWeight(a, {}), rng);
        const first = picks.pick(poolOf(pools, a, melody)), second = first && picks.pick(poolOf(pools, b, melody), [first.ref]);
        if (first && second) push({ type: "same-or-different", key: key("same", phraseKey(first), phraseKey(second)), first, second, same: a === b, by: "family" });
      }
      break;
    }
    case "where-does-it-end":
    case "tap-the-phrase": {
      const { families, items, verseWords } = activity.params;
      const fits = (phrase: Phrase) => {
        const verse = pools.verses.get(phrase.ref);
        if (!verse || phrase.verseUnits < verseWords[0] || phrase.verseUnits > verseWords[1]) return false;
        // Tap the phrase needs a verse of 3 to 6 phrases; the end drill needs a phrase that is not the whole verse.
        return activity.type === "tap-the-phrase" ? verse.phrases.length >= 3 && verse.phrases.length <= 6 : verse.phrases.length >= 2;
      };
      for (const family of answerPlan(families, context.focus, items, family => poolOf(pools, family, melody).some(fits), rng)) {
        const target = picks.pick(poolOf(pools, family, melody).filter(fits)); if (!target) continue;
        push(activity.type === "tap-the-phrase" ? { type: "tap-the-phrase", key: key("tap", phraseKey(target)), target }
          : { type: "where-does-it-end", key: key("end", phraseKey(target)), target, audio: activity.params.audio });
      }
      break;
    }
    case "look-alikes": {
      // Every example of the lesson's melody whose two words still match the loaded verses, each used once, the pairs in turn.
      type Row = { id: LookAlikePairId; a: LookSide; b: LookSide; hard: boolean };
      const byPair = new Map<LookAlikePairId, Row[]>();
      for (const { pair, example } of lookAlikeExamples(activity, melody)) {
        const a = pools.verses.get(example.a.ref), b = pools.verses.get(example.b.ref);
        if (!a || !b || a.kind !== melody || b.kind !== melody || !lookAlikeMatches(a, example.a) || !lookAlikeMatches(b, example.b)) continue;
        if (activity.params.mode === "hear" && a === b && phraseAt(a, example.a.word)?.words[0] === phraseAt(b, example.b.word)?.words[0]) continue;
        const list = byPair.get(pair.id) ?? []; byPair.set(pair.id, list);
        list.push({ id: pair.id, a: { word: example.a, verse: a }, b: { word: example.b, verse: b }, hard: example.hard });
      }
      const queues = activity.params.pairs.flatMap(id => byPair.has(id) ? [shuffle(byPair.get(id)!, rng)] : []), chosen: Row[] = [];
      for (let turn = 0; chosen.length < activity.params.items && queues.some(queue => queue.length); turn++) { const row = queues[turn % queues.length].shift(); if (row) chosen.push(row); }
      // A hard item is never first, and two items in a row never share a verse when the order can avoid it.
      const refs = (row: Row) => [row.a.verse.ref, row.b.verse.ref], shares = (x: Row, y: Row) => refs(x).some(ref => refs(y).includes(ref));
      const start = shuffle(chosen, rng);
      // A depth-first search over at most eight items finds an order with no shared neighbours whenever one exists.
      const search = (order: Row[], rest: Row[], strict: boolean): Row[] | null => {
        if (!rest.length) return order;
        for (const [i, row] of rest.entries()) {
          if (!order.length && row.hard || strict && order.length && shares(order.at(-1)!, row)) continue;
          const found = search([...order, row], rest.filter((_, k) => k !== i), strict); if (found) return found;
        }
        return null;
      };
      const ordered = search([], start, true) ?? search([], start, false) ?? start;
      for (const [n, row] of ordered.entries()) {
        const askA = rng() < 0.5, flip = rng() < 0.5, shown = Object.freeze(flip ? [row.b, row.a] : [row.a, row.b]) as readonly [LookSide, LookSide];
        out.push(Object.freeze({ type: "look-alikes", key: key("look", row.id, row.a.verse.ref, String(row.a.word.word), row.b.verse.ref, String(row.b.word.word)), pair: row.id,
          context: COURSE.lookAlikes[row.id].context, ask: askA ? row.a.word.mark : row.b.word.mark, shown, answer: askA !== flip ? 0 : 1, hard: row.hard, mode: activity.params.mode, first: n === 0 }));
      }
      break;
    }
    case "which-half": {
      const { families, items, verseWords, audio } = activity.params;
      // Phrases of the listed families in verses of one etnachta and 6 to 18 words, never the etnachta phrase or the ending.
      const candidates = { before: [] as Phrase[], after: [] as Phrase[] };
      for (const family of families) for (const phrase of poolOf(pools, family, melody)) {
        const verse = pools.verses.get(phrase.ref), rest = verse ? restUnit(verse) : null;
        if (!verse || rest === null || verse.units.length < verseWords[0] || verse.units.length > verseWords[1]) continue;
        if (phrase.family === "etnachta" || phrase.family === "sof-pasuk" || phrase.family === "sof-haftarah" || phrase.words[0] <= rest && rest <= phrase.words[1] || phrase.words[1] === verse.units.length - 1) continue;
        (phrase.words[1] < rest ? candidates.before : candidates.after).push(phrase);
      }
      // About half before the rest and half after it.
      for (const wanted of shuffle(Array.from({ length: items }, (_, i) => i % 2 === 0 ? "before" as const : "after" as const), rng)) {
        const first = picks.pick(candidates[wanted]), half = first ? wanted : wanted === "before" ? "after" : "before", target = first ?? picks.pick(candidates[half]);
        if (!target) continue;
        push(Object.freeze({ type: "which-half", key: key("half", phraseKey(target)), target, rest: restUnit(pools.verses.get(target.ref)!)!, half, audio }));
      }
      break;
    }
    case "build-the-phrase": {
      const { family, items, patterns, extraMarks } = activity.params;
      const wanted = patterns.map(pattern => pattern.join("-"));
      // Each mark on its own word, 2 to 4 words, matching one of the lesson's patterns.
      const fits = (phrase: Phrase) => {
        const verse = pools.verses.get(phrase.ref); if (!verse) return false;
        const units = verse.units.slice(phrase.words[0], phrase.words[1] + 1);
        return units.length >= 2 && units.length <= 4 && wanted.includes(phrase.tropes.join("-")) && units.every((unit, i) => i === units.length - 1 && unit.trope === "silluq" ? unit.accents.length <= 1 : new Set(unit.accents).size === 1);
      };
      const candidates = poolOf(pools, family, melody).filter(fits);
      for (let i = 0; i < items; i++) {
        const phrase = picks.pick(candidates); if (!phrase) break;
        const marks = phrase.tropes as TropeId[], decoys = shuffle(DECOYS.filter(id => !marks.includes(id) && (TROPE_IDS as readonly string[]).includes(id)), rng).slice(0, extraMarks);
        push({ type: "build-the-phrase", key: key("build", phraseKey(phrase)), phrase, tiles: Object.freeze(shuffle([...marks, ...decoys], rng)) });
      }
      break;
    }
  }
  return out;
}
