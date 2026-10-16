// A week's reading from Hebcal (full kriyah, Daniel's ruling) and the per-verse reading flags the melody
// engine needs (spec §5.4). The network call (readingFor) is kept apart from the pure helpers below it
// so the flag logic is testable offline against saved Hebcal responses. Dependency-free: Hebcal's public
// REST leyning endpoint over fetch, the same one scripts/fetch.mjs already uses, not @hebcal/leyning.

const LEYNING = "https://www.hebcal.com/leyning?cfg=json";
const BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"];

// The last verse of each book: its aliyah end takes the end-of-book cadence (torah-grammar.md §3.1).
export const BOOK_ENDS = new Set(["Genesis 50:26", "Exodus 40:38", "Leviticus 27:34", "Numbers 36:13", "Deuteronomy 34:12"]);

// The special-melody passages of torah-grammar.md §3.3-3.4, by verse. Creation: only the six refrain
// verses (the creation cells cover their sof-pasuk phrase). Song of the Sea: Ex 15:1-19, the report's
// range (15:19 is the prose coda some readers sing to the Song's tune). Journeys: Num 33:11-46, Jacobson's
// published range; Cantor Marx's practice (33:11-12, 17-46) is a subset, so nothing outside it is flagged.
export const SPECIAL_RANGES = [
  { special: "creation", book: "Genesis", verses: ["1:5", "1:8", "1:13", "1:19", "1:23", "1:31"] },
  { special: "song-of-the-sea", book: "Exodus", from: "15:1", to: "15:19" },
  { special: "journeys", book: "Numbers", from: "33:11", to: "33:46" },
];

// "Genesis 1:5" / "I Samuel 20:18" -> { book, chapter, verse }; null for anything that is not one verse.
export function parseRef(ref) {
  const m = /^(.+?)\s+(\d+):(\d+)$/.exec(String(ref || "").trim());
  return m ? { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) } : null;
}

const cv = s => s.split(":").map(Number);
// Order of two "c:v" strings in one book.
const cmpCV = (a, b) => { const [ac, av] = cv(a), [bc, bv] = cv(b); return ac - bc || av - bv; };

export function specialFor(ref) {
  const r = parseRef(ref);
  if (!r) return null;
  const here = `${r.chapter}:${r.verse}`;
  for (const s of SPECIAL_RANGES) {
    if (s.book !== r.book) continue;
    if (s.verses ? s.verses.includes(here) : cmpCV(here, s.from) >= 0 && cmpCV(here, s.to) <= 0) return s.special;
  }
  return null;
}

// Hebcal names a book by name in the REST response but by number (1-5) in its holiday data; accept both.
const bookName = k => typeof k === "number" || /^\d+$/.test(String(k)) ? BOOKS[Number(k) - 1] : String(k);

// "Isaiah", "27:6", "28:13" -> "Isaiah 27:6-28:13"; a one-chapter range is shortened the way people write
// it ("Isaiah 29:22-23") and a one-verse range is just the verse.
export function formatRange(book, b, e) {
  if (!e || b === e) return `${book} ${b}`;
  const [bc] = cv(b), [ec, ev] = cv(e);
  return bc === ec ? `${book} ${b}-${ev}` : `${book} ${b}-${e}`;
}

// The aliyot of a Hebcal item's fullkriyah, in reading order (1-7, then maftir).
// n is 1..7 or "M"; endRef is the verse that takes the end-of-aliyah cadence.
export function aliyotOf(item) {
  const fk = (item && item.fullkriyah) || {};
  const order = k => (k === "M" ? 99 : Number(k));
  return Object.keys(fk).sort((a, b) => order(a) - order(b)).map(k => {
    const a = fk[k], book = bookName(a.k);
    return { n: k === "M" ? "M" : Number(k), book, b: a.b, e: a.e, ref: formatRange(book, a.b, a.e), endRef: `${book} ${a.e}`, ...(a.reason ? { reason: a.reason } : {}) };
  });
}

// True when range y picks up where range x stopped: overlapping (the maftir repeats the 7th aliyah's
// end), the next verse, or verse 1 of the next chapter (an aliyah always resumes where the last stopped,
// and chapter lengths are not known here).
function continues(x, y) {
  if (x.book !== y.book || cmpCV(y.b, x.b) < 0) return false;
  if (cmpCV(y.b, x.e) <= 0) return true;
  const [xc, xv] = cv(x.e), [yc, yv] = cv(y.b);
  return (yc === xc && yv === xv + 1) || (yc === xc + 1 && yv === 1);
}

// The Torah text to fetch: the aliyot merged into contiguous ranges, in reading order. A regular week is
// one range; a special maftir (Shekalim, Rosh Chodesh) or Simchat Torah's Deut/Gen/Num adds ranges.
export function torahRanges(aliyot) {
  const out = [];
  for (const a of aliyot) {
    const last = out.at(-1);
    if (last && continues(last, a)) { if (cmpCV(a.e, last.e) > 0) last.e = a.e; }
    else out.push({ book: a.book, b: a.b, e: a.e });
  }
  return out.map(r => formatRange(r.book, r.b, r.e));
}

// "Isaiah 27:6-28:13; 29:22-23" or Hebcal's "Isaiah 27:6-28:13, 29:22-23" -> one ref per range, the book
// carried forward when a part starts with a chapter number. A comma inside a part never occurs in a ref.
export function parseRefList(s) {
  let book = null;
  return String(s || "").split(/[;,]/).map(p => p.trim()).filter(Boolean).map(p => {
    const m = /^(.*?[A-Za-z].*?)\s+(\d.*)$/.exec(p);
    if (m) { book = m[1]; return `${m[1]} ${m[2]}`; }
    if (!book) throw new Error(`no book for "${p}" in "${s}"`);
    return `${book} ${p}`;
  });
}

// The haftarah's ranges: Hebcal's structured haft (an object, or an array for a multi-range haftarah),
// else its display string.
export function haftarahRefs(item) {
  const h = item && item.haft;
  if (h) return (Array.isArray(h) ? h : [h]).map(x => formatRange(bookName(x.k), x.b, x.e));
  return item && item.haftara ? parseRefList(item.haftara) : [];
}

// One Hebcal leyning item -> the reading shape the scorer uses.
export function readingFromItem(item) {
  const aliyot = aliyotOf(item);
  const reason = (item.reason && item.reason.haftara) || (item.haft && !Array.isArray(item.haft) && item.haft.reason) || null;
  return {
    name: item.name && item.name.en, date: item.date || null, type: item.type || null,
    torah: { ranges: torahRanges(aliyot), aliyot },
    haftarah: { refs: haftarahRefs(item), ...(reason ? { reason } : {}) },
  };
}

// Spelling-proof name key: "Lech-Lecha", "lech lecha", "Lech L'cha"-ish all reduce alike.
const nameKey = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
// Common spellings Hebcal does not use. V'Zot HaBerachah is never a Shabbat reading: it is Simchat Torah's.
const ALIASES = { bereishit: "bereshit", bereishis: "bereshit", beshallach: "beshalach", bshalach: "beshalach" };
const isVezot = k => /^v[e]?zot/.test(k);

// The item a request names, from a list of Hebcal items (one date, or a window of dates). A parashah
// matches a Shabbat item with a full kriyah, exactly first, else as half of a combined parashah
// ("Masei" in "Matot-Masei"); a holiday matches by name, exactly first, else as a prefix.
export function pickItem(items, { parashah, holiday } = {}) {
  const withTorah = (items || []).filter(i => i.fullkriyah);
  let want = parashah ? nameKey(parashah) : null;
  if (want && isVezot(want)) { holiday = "Simchat Torah"; want = null; }
  if (want) {
    want = ALIASES[want] || want;
    const shabbat = withTorah.filter(i => i.type === "shabbat");
    return shabbat.find(i => nameKey(i.name && i.name.en) === want)
      || shabbat.find(i => String(i.name && i.name.en).split("-").some(p => nameKey(p) === want)) || null;
  }
  if (holiday) {
    const h = nameKey(holiday);
    return withTorah.find(i => nameKey(i.name && i.name.en) === h) || withTorah.find(i => nameKey(i.name && i.name.en).startsWith(h)) || null;
  }
  // A bare date: its Shabbat or holiday reading (a weekday Torah reading has no full kriyah).
  return withTorah.find(i => i.type === "shabbat") || withTorah.find(i => i.type === "holiday") || null;
}

// Per-verse flags for a reading, given its verse refs in reading order and its aliyot:
//   endOfAliyah on each aliyah's last verse (aliyot lists which: [3], or [7, "M"] when they coincide),
//   endOfBook on the five book ends, final on the last verse, special for the §3.3-3.4 passages.
export function verseFlags(refs, aliyot = []) {
  const ends = new Map();
  for (const a of aliyot) ends.set(a.endRef, [...(ends.get(a.endRef) || []), a.n]);
  return refs.map((ref, i) => ({
    ref,
    final: i === refs.length - 1,
    endOfAliyah: ends.has(ref),
    aliyot: ends.get(ref) || [],
    endOfBook: BOOK_ENDS.has(ref),
    special: specialFor(ref),
  }));
}

// "end aliyah 3", "end aliyah 7, maftir", plus the book end and a special passage, for a human to check.
export function flagLabel(f) {
  const parts = [];
  if (f.endOfAliyah) parts.push(`end aliyah ${f.aliyot.map(n => (n === "M" ? "maftir" : n)).join(", ")}`);
  if (f.endOfBook) parts.push("end of book");
  if (f.special) parts.push(`[${f.special}]`);
  return parts.join("  ");
}

// ---- network ----------------------------------------------------------------------------------------

async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "crc-haftarah-sheet/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const j = await res.json();
  if (j.error) throw new Error(`${j.error} for ${url}`);
  return j;
}

const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
// Hebcal truncates a leyning range at about six months of items, so a year is searched in windows.
const WINDOW_DAYS = 120, SEARCH_DAYS = 400;

// The reading for a date, or for the next occurrence (from `from`, default today) of a parashah or
// holiday. getJSON is injectable so the selection logic can be tested against saved responses.
export async function readingFor({ parashah, date, holiday, from, fetchJSON = getJSON } = {}) {
  if (!parashah && !date && !holiday) throw new Error("readingFor needs a parashah, a date or a holiday");
  const want = { parashah, holiday };
  let item = null;
  if (date) {
    const j = await fetchJSON(`${LEYNING}&start=${date}&end=${date}`);
    item = pickItem(j.items, want);
    if (!item) throw new Error(`Hebcal has no full-kriyah reading${parashah || holiday ? ` for ${parashah || holiday}` : ""} on ${date}`);
  } else {
    const start = from || iso(new Date());
    for (let off = 0; off < SEARCH_DAYS && !item; off += WINDOW_DAYS) {
      const j = await fetchJSON(`${LEYNING}&start=${addDays(start, off)}&end=${addDays(start, off + WINDOW_DAYS - 1)}`);
      item = pickItem(j.items, want);
    }
    if (!item) throw new Error(`Hebcal has no reading named ${parashah || holiday} in the ${SEARCH_DAYS} days from ${start}`);
  }
  return readingFromItem(item);
}
