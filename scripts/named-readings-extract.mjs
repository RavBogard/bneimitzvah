#!/usr/bin/env node
// Hand-run extractor for src/lib/readings/named-readings.ts. Network only (Hebcal's public
// leyning API, CC BY 4.0); never imported by the app and never run by `npm test`.
//
//   node scripts/named-readings-extract.mjs [--raw <dir outside the repo>] [--offline]
//
// --raw keeps each Hebcal response in <dir> (and reuses it on a later run); --offline reads only
// from <dir>. The output is a pure function of the raw responses: same responses, same bytes.
// Numbers and names only: Hebcal's book/chapter/verse ranges and English names. No text.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { insideGitWorkingTree } from "./private-paths.mjs";

if (process.env.NODE_TEST_CONTEXT || process.env.VITEST) { console.error("named-readings-extract is hand-run only; it never runs under a test runner."); process.exit(2); }

// The library modules are TypeScript with extensionless relative imports (bundler resolution).
// Node strips the types; this hook only adds the ".ts" the bundler would have found.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
    return next(specifier, context);
  },
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { hebcalRef, parseRange } = await import(pathToFileURL(join(root, "src/lib/readings/leyning.mjs")).href);
const { canonicalReadingRef, joinReadingRef } = await import(pathToFileURL(join(root, "src/lib/readings/reading-ref.ts")).href);
const { TANAKH_VERSE_COUNTS } = await import(pathToFileURL(join(root, "src/lib/readings/catalog.ts")).href);

const args = process.argv.slice(2);
const rawDir = args.includes("--raw") ? resolve(args[args.indexOf("--raw") + 1] ?? "") : null;
const offline = args.includes("--offline");
if (offline && !rawDir) throw new Error("--offline needs --raw <dir>");
if (rawDir && await insideGitWorkingTree(rawDir)) throw new Error("--raw must be outside the repository");

// ---- Windows. Hebcal answers at most about 180 days per request, so both spans are fetched by
// quarter; every answer must echo exactly the requested range. The supplementary span (the following
// twelve years) feeds parashah entries only, and only a Torah or haftarah the base span never gives
// plainly: in 2024-2032 Matot and Masei are never read alone, and Pinchas, Miketz, Vayakhel, Tzav,
// Metzora and Kedoshim always meet a special haftarah.
function quarters(from, to) {
  const out = [], last = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let y = from[0], m = from[1]; y * 12 + m <= to[0] * 12 + to[1]; ) {
    const end = Math.min(y * 12 + m + 2, to[0] * 12 + to[1]), ey = Math.floor((end - 1) / 12), em = end - ey * 12;
    out.push([`${y}-${String(m).padStart(2, "0")}-01`, `${ey}-${String(em).padStart(2, "0")}-${last(ey, em)}`]);
    m += 3; while (m > 12) { m -= 12; y++; }
  }
  return out;
}
const BASE = quarters([2024, 9], [2032, 9]);
const SUPPLEMENT = quarters([2032, 10], [2044, 9]);
const url = ([start, end]) => `https://www.hebcal.com/leyning?${new URLSearchParams({ cfg: "json", start, end, i: "off", triennial: "off" })}`;

async function load(window) {
  const file = rawDir && join(rawDir, `${window[0]}_${window[1]}.json`);
  let body;
  if (file && existsSync(file)) body = await readFile(file);
  else {
    if (offline) throw new Error(`missing raw response for ${window.join("..")}`);
    const response = await fetch(url(window), { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Hebcal ${response.status} for ${window.join("..")}`);
    body = Buffer.from(await response.arrayBuffer());
    if (file) { await mkdir(rawDir, { recursive: true }); await writeFile(file, body); }
    await new Promise(done => setTimeout(done, 300));
  }
  const json = JSON.parse(body.toString("utf8"));
  if (json.location !== "Diaspora" || json.range?.start !== window[0] || json.range?.end !== window[1] || !Array.isArray(json.items)) throw new Error(`Hebcal answered a different calendar or range for ${window.join("..")}`);
  return { window, body, json };
}
const base = [], supplement = [];
for (const window of BASE) base.push(await load(window));
for (const window of SUPPLEMENT) supplement.push(await load(window));
const items = responses => {
  const seen = new Map();
  for (const { json } of responses) for (const item of json.items) {
    if (!item || typeof item.date !== "string" || typeof item.name?.en !== "string") throw new Error("Hebcal item without a date or name");
    seen.set(`${item.date}\0${item.name.en}`, item);
  }
  return [...seen.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.en < b.name.en ? -1 : 1);
};
const baseItems = items(base), supplementItems = items(supplement);

// ---- Verse arithmetic over the trusted numeric catalog.
const counts = TANAKH_VERSE_COUNTS;
const point = text => { const [c, v] = text.split(":").map(Number); return [c, v]; };
const rangeOf = aliyah => {
  if (!aliyah || typeof aliyah.k !== "string" || typeof aliyah.b !== "string" || (aliyah.e !== undefined && typeof aliyah.e !== "string")) return null;
  const parsed = parseRange(hebcalRef(aliyah));
  return parsed && Object.hasOwn(counts, parsed.book) ? parsed : null;
};
const after = (book, [c, v]) => v < counts[book][c - 1] ? [c, v + 1] : [c + 1, 1];
const cmp = ([c1, v1], [c2, v2]) => c1 - c2 || v1 - v2;
const segment = (book, from, to) => hebcalRef({ k: book, b: from.join(":"), e: to.join(":") });

/** Aliyot in order → passages: a book change or a step backwards starts a new passage; a gap in one book a new segment. */
function runs(ranges) {
  const passages = [];
  for (const range of ranges) {
    const passage = passages.at(-1), open = passage?.segments.at(-1);
    if (!passage || passage.book !== range.book || cmp(range.from, passage.segments[0].from) < 0 || cmp(range.from, open.from) < 0) {
      passages.push({ book: range.book, segments: [{ from: range.from, to: range.to }] }); continue;
    }
    if (cmp(range.from, after(range.book, open.to)) <= 0) { if (cmp(range.to, open.to) > 0) open.to = range.to; }
    else passage.segments.push({ from: range.from, to: range.to });
  }
  return passages.map(p => joinReadingRef(p.segments.map(s => segment(p.book, s.from, s.to))));
}
const haftarahOf = item => {
  if (item.haft === undefined) return null;
  const rows = Array.isArray(item.haft) ? item.haft : [item.haft];
  const refs = rows.map(rangeOf);
  return refs.every(Boolean) ? joinReadingRef(refs.map(r => segment(r.book, r.from, r.to))) : "";
};
const aliyot = (item, keys) => keys.filter(n => item.fullkriyah?.[n] !== undefined).map(n => rangeOf(item.fullkriyah[n]));

// ---- Collection with agreement across years: a value that differs between years is refused.
const refused = [], notes = [];
function agree(name, label, values) {
  const distinct = [...new Set(values.map(v => JSON.stringify(v)))];
  if (distinct.length === 1) return JSON.parse(distinct[0]);
  refused.push(`${name}: ${label} differs between years (${distinct.join(" | ")})`);
  return undefined;
}
const slugOf = name => name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const entries = [];
function add(group, name, passages) {
  for (const passage of passages) {
    if (!canonicalReadingRef(passage.ref, passage.kind)) { refused.push(`${name}: ${passage.label} "${passage.ref}" is not a canonical ${passage.kind} reference`); return; }
  }
  if (!passages.length) { refused.push(`${name}: no passage`); return; }
  entries.push({ slug: slugOf(name), name, group, passages });
}

// ---- 1. Parashiyot: aliyot 1-7 of the full kriyah, from years where no item-level reason replaces an aliyah
// (an aliyah's own "reason" is only a note such as "some sources use 4:19-26"; the whole range is the same), and the
// haftarah from years whose haftarah has no reason override.
const parashot = new Map();
const SEVEN = ["1", "2", "3", "4", "5", "6", "7"];
function collect(pool, part) {
  for (const item of pool) {
    if (item.type !== "shabbat" || item.parshaNum === undefined) continue;
    const numbers = Array.isArray(item.parshaNum) ? item.parshaNum : [item.parshaNum];
    if (!parashot.has(item.name.en)) parashot.set(item.name.en, { name: item.name.en, numbers, base: { torah: [], haftarah: [] }, supplement: { torah: [], haftarah: [] } });
    const entry = parashot.get(item.name.en)[part];
    const reason = item.reason && typeof item.reason === "object" ? item.reason : {};
    const seven = aliyot(item, SEVEN);
    if (seven.length === 7 && seven.every(Boolean) && SEVEN.every(n => !reason[n])) {
      const passages = runs(seven);
      entry.torah.push(passages.length === 1 && !passages[0].includes(";") ? passages[0] : `refused: ${passages.join(" / ")}`);
    }
    if (!reason.haftara && item.haft !== undefined) entry.haftarah.push(haftarahOf(item));
  }
}
collect(baseItems, "base");
collect(supplementItems, "supplement");
for (const entry of parashot.values()) {
  for (const piece of ["torah", "haftarah"]) {
    if (entry.base[piece].length || !entry.supplement[piece].length) continue;
    notes.push(`${entry.name}: ${piece === "torah" ? "never read alone" : "its own haftarah is never read"} in the base span; ${piece} taken from the supplementary span`);
  }
  entry.torah = entry.base.torah.length ? entry.base.torah : entry.supplement.torah;
  entry.haftarah = entry.base.haftarah.length ? entry.base.haftarah : entry.supplement.haftarah;
}
// Vezot Haberakhah is read only on Simchat Torah: its aliyot are the ones Hebcal marks parashah 54, with that day's haftarah.
const simchat = baseItems.filter(item => item.type === "holiday" && item.name.en === "Simchat Torah");
parashot.set("Vezot Haberakhah", { name: "Vezot Haberakhah", numbers: [54],
  torah: simchat.map(item => { const r = runs(["1", "2", "3", "4", "5", "6", "7"].filter(n => item.fullkriyah?.[n]?.p === 54).map(n => rangeOf(item.fullkriyah[n]))); return r.length === 1 ? r[0] : "refused"; }),
  haftarah: simchat.map(haftarahOf) });
notes.push("Vezot Haberakhah: aliyot Hebcal marks parashah 54 on Simchat Torah, with Simchat Torah's haftarah");
const ordered = [...parashot.values()].sort((a, b) => Math.max(...a.numbers) - Math.max(...b.numbers) || a.numbers.length - b.numbers.length);
for (const entry of ordered) {
  if (!entry.torah.length) { refused.push(`${entry.name}: no year with the parashah's own aliyot`); continue; }
  const torah = agree(entry.name, "Torah", entry.torah);
  if (torah === undefined || torah.startsWith("refused")) { if (torah) refused.push(`${entry.name}: Torah ${torah}`); continue; }
  const passages = [{ label: "Torah", kind: "torah", ref: torah }];
  if (!entry.haftarah.length) refused.push(`${entry.name}: haftarah (never read without a special haftarah in the span; Torah only)`);
  else { const haftarah = agree(entry.name, "haftarah", entry.haftarah); if (haftarah) passages.push({ label: "Haftarah", kind: "haftarah", ref: haftarah }); }
  add("parashah", entry.name, passages);
}

// ---- 2. Special Shabbatot: one entry per Hebcal reason, holding exactly the readings that reason replaces.
const SPECIAL = /^(?:Shabbat (?:Shekalim|Zachor|Parah|HaChodesh|HaGadol|Shuva|Rosh Chodesh|Machar Chodesh)\b|Chanukah Day [1-8] \(on Shabbat\)$|Shabbat Rosh Chodesh Chanukah$)/;
const specials = new Map(), skippedReasons = new Set();
for (const item of baseItems) {
  if (item.type !== "shabbat" || !item.reason || typeof item.reason !== "object") continue;
  const names = new Set(Object.entries(item.reason).filter(([key]) => key !== "sephardic" && key !== "chabad").map(([, value]) => value));
  for (const name of names) {
    if (!SPECIAL.test(name)) { skippedReasons.add(name); continue; }
    const passages = [];
    for (const n of ["1", "2", "3", "4", "5", "6", "7"]) if (item.reason[n] === name) { const r = rangeOf(item.fullkriyah?.[n]); passages.push({ label: `Aliyah ${n}`, kind: "torah", ref: r ? segment(r.book, r.from, r.to) : "" }); }
    if (item.reason.M === name) { const r = rangeOf(item.fullkriyah?.M); passages.push({ label: "Maftir", kind: "torah", ref: r ? segment(r.book, r.from, r.to) : "" }); }
    if (item.reason.haftara === name) passages.push({ label: "Haftarah", kind: "haftarah", ref: haftarahOf(item) ?? "" });
    specials.set(name, [...(specials.get(name) ?? []), passages]);
  }
}
for (const name of skippedReasons) notes.push(`not a special Shabbat in this catalog (left to the parashah or a custom passage): "${name}"`);
const SPECIAL_ORDER = ["Shabbat Shuva (with Vayeilech)", "Shabbat Shuva (with Ha'azinu)", "Chanukah Day 1 (on Shabbat)", "Chanukah Day 2 (on Shabbat)", "Chanukah Day 3 (on Shabbat)",
  "Chanukah Day 4 (on Shabbat)", "Chanukah Day 5 (on Shabbat)", "Chanukah Day 6 (on Shabbat)", "Shabbat Rosh Chodesh Chanukah", "Chanukah Day 7 (on Shabbat)", "Chanukah Day 8 (on Shabbat)",
  "Shabbat Shekalim", "Shabbat Shekalim (on Rosh Chodesh)", "Shabbat Zachor", "Shabbat Parah", "Shabbat HaChodesh", "Shabbat HaChodesh (on Rosh Chodesh)", "Shabbat HaGadol",
  "Shabbat Rosh Chodesh", "Shabbat Machar Chodesh"];
for (const name of [...specials.keys()]) if (!SPECIAL_ORDER.includes(name)) throw new Error(`special Shabbat "${name}" has no place in SPECIAL_ORDER`);
for (const name of SPECIAL_ORDER) {
  if (!specials.has(name)) { if (!/Chanukah Day [256]/.test(name)) notes.push(`special Shabbat "${name}" does not occur in the span`); continue; }
  const passages = agree(name, "readings", specials.get(name));
  if (passages) add("special", name, passages);
}

// ---- 3. Diaspora festivals and fasts: Torah in same-book runs, the maftir when it is a reading of its
// own, and the haftarah. A name and its "(on Shabbat)" form are one entry when every year agrees; when
// they differ each keeps Hebcal's own name. A maftir that changes from year to year is left out.
const FESTIVALS = ["Rosh Hashana I", "Rosh Hashana II", "Yom Kippur", "Yom Kippur (Mincha)", "Sukkot I", "Sukkot II", "Sukkot Shabbat Chol ha-Moed", "Shmini Atzeret", "Simchat Torah",
  "Purim", "Pesach I", "Pesach II", "Pesach Shabbat Chol ha-Moed", "Pesach VII", "Pesach VIII", "Shavuot I", "Shavuot II"];
const FASTS = ["Tzom Gedaliah", "Tzom Gedaliah (Mincha)", "Asara B'Tevet", "Asara B'Tevet (Mincha)", "Ta'anit Esther", "Ta'anit Esther (Mincha)", "Tzom Tammuz", "Tzom Tammuz (Mincha)",
  "Tish'a B'Av", "Tish'a B'Av (Mincha)"];
function dayPassages(item) {
  const main = aliyot(item, ["1", "2", "3", "4", "5", "6", "7"]);
  if (!main.length || main.some(r => !r)) return null;
  const maftir = item.fullkriyah?.M === undefined ? null : rangeOf(item.fullkriyah.M);
  if (item.fullkriyah?.M !== undefined && !maftir) return null;
  const last = main.at(-1);
  // A maftir that simply continues the last aliyah (a fast-day Mincha) is part of the Torah reading.
  const continues = maftir && maftir.book === last.book && cmp(maftir.from, after(last.book, last.to)) <= 0 && cmp(maftir.from, last.from) > 0;
  const torah = runs(continues ? [...main, maftir] : main);
  const passages = torah.map((ref, i) => ({ label: i === 0 ? "Torah" : `Torah ${i + 1}`, kind: "torah", ref }));
  if (maftir && !continues) passages.push({ label: "Maftir", kind: "torah", ref: segment(maftir.book, maftir.from, maftir.to) });
  const haftarah = haftarahOf(item);
  if (haftarah !== null) passages.push({ label: "Haftarah", kind: "haftarah", ref: haftarah });
  return passages;
}
for (const [group, names] of [["festival", FESTIVALS], ["fast", FASTS]]) {
  for (const name of names) {
    const forms = [name, `${name} (on Shabbat)`].map(form => ({ form, days: baseItems.filter(item => item.type === "holiday" && item.name.en === form).map(dayPassages) }))
      .filter(f => f.days.length);
    if (!forms.length) { refused.push(`${name}: not in the span`); continue; }
    if (forms.some(f => f.days.some(d => !d))) { refused.push(`${name}: a year Hebcal gives no usable aliyot`); continue; }
    const all = forms.flatMap(f => f.days), one = new Set(all.map(d => JSON.stringify(d))).size === 1;
    for (const { form, days } of one ? [{ form: name, days: all }] : forms) {
      const labels = agree(form, "passage list", days.map(d => d.map(p => p.label)));
      if (!labels) continue;
      const passages = [];
      for (const [i, label] of labels.entries()) {
        const values = new Set(days.map(d => JSON.stringify(d[i])));
        if (values.size === 1) passages.push(days[0][i]);
        else if (label === "Maftir") notes.push(`${form}: maftir changes from year to year (${[...values].map(v => JSON.parse(v).ref).join(" | ")}); left out`);
        else { refused.push(`${form}: ${label} differs between years`); passages.length = 0; break; }
      }
      if (passages.length) add(group, form, passages);
    }
  }
}

// ---- Checks, then the two files.
const slugs = new Set();
for (const entry of entries) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) || entry.slug.length > 64 || slugs.has(entry.slug)) throw new Error(`bad or duplicate slug ${entry.slug}`); slugs.add(entry.slug); }
const parashahCount = entries.filter(e => e.group === "parashah").length;
const quote = value => JSON.stringify(value);
const lines = entries.map(e => `  r(${quote(e.slug)}, ${quote(e.name)}, ${quote(e.group)}, [${e.passages.map(p => `p(${quote(p.label)}, ${quote(p.kind)}, ${quote(p.ref)})`).join(", ")}]),`);
const source = `// Generated by scripts/named-readings-extract.mjs from Hebcal's leyning API (CC BY 4.0); do not edit by hand.
// Numbers and names only. Provenance, refusals and notes: named-readings.PROVENANCE.md.
export type NamedReadingGroup = "parashah" | "special" | "festival" | "fast";
export type NamedReadingPassage = Readonly<{ label: string; kind: "torah" | "haftarah"; ref: string }>;
export type NamedReading = Readonly<{ slug: string; name: string; group: NamedReadingGroup; passages: readonly NamedReadingPassage[] }>;

const p = (label: string, kind: "torah" | "haftarah", ref: string): NamedReadingPassage => Object.freeze({ label, kind, ref });
const r = (slug: string, name: string, group: NamedReadingGroup, passages: NamedReadingPassage[]): NamedReading => Object.freeze({ slug, name, group, passages: Object.freeze(passages) });

/** Parashiyot in Torah order (each combined parashah after its second part), then special Shabbatot, festivals and fasts in calendar order. */
export const NAMED_READINGS: readonly NamedReading[] = Object.freeze([
${lines.join("\n")}
]);

const bySlug: ReadonlyMap<string, NamedReading> = new Map(NAMED_READINGS.map(reading => [reading.slug, reading]));
/** The named reading for a page address's \`reading=<slug>\`, or null. */
export const namedReading = (slug: unknown): NamedReading | null => typeof slug === "string" ? bySlug.get(slug) ?? null : null;
`;
const hashes = [...base, ...supplement].map(({ window, body }) => ({ url: url(window), sha256: createHash("sha256").update(body).digest("hex") }));
const combined = createHash("sha256").update(hashes.map(h => `${h.url}\n${h.sha256}\n`).join("")).digest("hex");
const generated = [...base, ...supplement].map(({ json }) => json.date).filter(d => typeof d === "string").sort().at(-1)?.slice(0, 10) ?? "unknown";
const groups = ["parashah", "special", "festival", "fast"].map(g => `${entries.filter(e => e.group === g).length} ${g}`).join(", ");
const provenance = `# Named readings catalog

\`named-readings.ts\` holds only English names and numeric book/chapter/verse ranges for the parashiyot, special Shabbatot, diaspora festivals and fasts that "Any reading" offers. It was extracted by \`scripts/named-readings-extract.mjs\` (hand-run, never part of \`npm test\`) from [Hebcal's leyning API](https://www.hebcal.com/home/4277/leyning-torah-reading-api), whose calendar data is © Hebcal, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). No verse text, translation, summary or Hebrew was retained.

- **Extracted:** ${generated} (UTC, Hebcal's own response time), diaspora calendar (\`i=off\`), full kriyah (\`triennial=off\`).
- **Span:** quarterly requests ${BASE[0][0]} to ${BASE.at(-1)[1]} for everything; then ${SUPPLEMENT[0][0]} to ${SUPPLEMENT.at(-1)[1]} only for a parashah whose own Torah or haftarah the base span never gives (listed under Notes).
- **Raw responses:** ${hashes.length} JSON answers, kept outside the repository. SHA-256 over the lines \`<url>\\n<sha256 of body>\\n\` in request order: \`${combined}\`.
- **Result:** ${entries.length} entries (${groups}).

## Rules

- A parashah's Torah is aliyot 1–7 joined, from years where no special reason replaces an aliyah (an aliyah's own note such as "some sources use 4:19-26" leaves the whole range unchanged); every such year must agree. Its haftarah comes from years where Hebcal gives no haftarah \`reason\`; every such year must agree, and a parashah with no such year has no haftarah here.
- Vezot Haberakhah is read only on Simchat Torah: its Torah is the aliyot Hebcal marks parashah 54 that day, and its haftarah is Simchat Torah's.
- A special Shabbat is one entry per Hebcal reason, holding exactly the readings that reason replaces (an aliyah, the maftir, the haftarah), identical in every year it occurs.
- A festival or fast is its aliyot in passages: a change of book, or a step backwards, starts a new passage (so a Torah passage never crosses books and \`expandReadingRanges\` is unchanged); a gap inside one book is a further "; " segment. The maftir is its own passage unless it continues the last aliyah (a fast-day Mincha). A name and its "(on Shabbat)" form are one entry when every year agrees, else two entries under Hebcal's names. A maftir that changes from year to year is left out.
- Every passage passed \`canonicalReadingRef\` (\`reading-ref.ts\`) at extraction; anything else is refused, never repaired.

## Refused

${refused.length ? refused.map(line => `- ${line}`).join("\n") : "- Nothing."}

## Notes

${notes.map(line => `- ${line}`).join("\n")}
`;
const out = join(root, "src/lib/readings");
await writeFile(join(out, "named-readings.ts"), source);
await writeFile(join(out, "named-readings.PROVENANCE.md"), provenance);
console.log(`named readings: ${entries.length} entries (${groups}); ${parashahCount} parashiyot; ${refused.length} refused; ${notes.length} notes`);
for (const line of refused) console.log(`  refused: ${line}`);
