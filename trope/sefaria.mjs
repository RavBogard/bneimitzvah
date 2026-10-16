// Fetch a reading's Masoretic text (Miqra according to the Masorah) from Sefaria, one record per
// verse with its own ref, so any range (one verse, one chapter, across chapters) scores the same way.
export const HEBREW_VERSION = "Miqra according to the Masorah";

const flat = x => Array.isArray(x) ? x.flatMap(flat) : [x];

export async function fetchReading(r) {
  const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(r.replace(/\s+/g, " "))}?version=hebrew|${encodeURIComponent(HEBREW_VERSION)}&return_format=default`;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "crc-haftarah-sheet/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  const v = (j.versions || []).find(x => x.languageFamilyName === "hebrew");
  if (!v || v.versionTitle !== HEBREW_VERSION) throw new Error(`no MAM text for ${r}`);
  // Sefaria returns a string for one verse, an array for one chapter, nested arrays across chapters.
  // Verse refs are rebuilt from the range's start: the first chapter starts at the range's first
  // verse, later chapters at verse 1.
  const book = (j.book || j.indexTitle || r.replace(/\s+\d.*$/, "")).trim();
  const [startChapter, startVerse] = (j.sections || [1, 1]).map(Number);
  const chapters = Array.isArray(v.text) && Array.isArray(v.text[0]) ? v.text : [Array.isArray(v.text) ? v.text : [v.text]];
  const out = [];
  chapters.forEach((ch, c) => flat(ch).forEach((he, i) => {
    const verse = (c === 0 ? startVerse : 1) + i;
    if (he) out.push({ ref: `${book} ${startChapter + c}:${verse}`, he });
  }));
  return out;
}
