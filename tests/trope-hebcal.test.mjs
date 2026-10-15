// trope/hebcal.mjs offline: saved Hebcal leyning responses (tests/fixtures/trope/hebcal/, fetched
// 2026-10-15 from https://www.hebcal.com/leyning?cfg=json&start=D&end=D) through the pure helpers, and
// readingFor with a fake fetch so the date / parashah / holiday selection runs without the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aliyotOf, torahRanges, parseRefList, haftarahRefs, readingFromItem, pickItem, verseFlags, specialFor,
  flagLabel, formatRange, parseRef, readingFor } from "../trope/hebcal.mjs";

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/trope/hebcal/${name}.json`, import.meta.url), "utf8"));
const item = name => fixture(name).items.find(i => i.fullkriyah);

// Every verse ref of "Book c:v-c:v" given the chapter lengths it crosses (the network gives these in real use).
function verses(book, chapters) {
  const out = [];
  for (const [ch, from, to] of chapters) for (let v = from; v <= to; v++) out.push(`${book} ${ch}:${v}`);
  return out;
}

test("aliyotOf: Bereshit's seven aliyot and maftir in order, with their end verses", () => {
  const a = aliyotOf(item("bereshit"));
  assert.deepEqual(a.map(x => x.n), [1, 2, 3, 4, 5, 6, 7, "M"]);
  assert.deepEqual(a.map(x => x.endRef), ["Genesis 2:3", "Genesis 2:19", "Genesis 3:21", "Genesis 4:18", "Genesis 4:22", "Genesis 5:24", "Genesis 6:8", "Genesis 6:8"]);
  assert.equal(a[0].ref, "Genesis 1:1-2:3");
  assert.equal(a[4].reason, "some sources use 4:19-26");
});

test("torahRanges: a regular week is one range; a special maftir and Simchat Torah add ranges", () => {
  assert.deepEqual(torahRanges(aliyotOf(item("bereshit"))), ["Genesis 1:1-6:8"]);
  assert.deepEqual(torahRanges(aliyotOf(item("beshalach"))), ["Exodus 13:17-17:16"]);
  assert.deepEqual(torahRanges(aliyotOf(item("vayakhel-shekalim"))), ["Exodus 35:1-38:20", "Exodus 30:11-16"]);
  assert.deepEqual(torahRanges(aliyotOf(item("simchat-torah"))), ["Deuteronomy 33:1-34:12", "Genesis 1:1-2:3", "Numbers 29:35-30:1"]);
  // Hebcal's holiday data numbers the book; the REST response names it. Both work.
  assert.deepEqual(aliyotOf({ fullkriyah: { 1: { k: 5, b: "34:1", e: "34:12" } } })[0].endRef, "Deuteronomy 34:12");
});

test("verseFlags on Bereshit: aliyah ends, the Creation refrain, final; 7th and maftir share 6:8", () => {
  const a = aliyotOf(item("bereshit"));
  const refs = verses("Genesis", [[1, 1, 31], [2, 1, 25], [3, 1, 24], [4, 1, 26], [5, 1, 32], [6, 1, 8]]);
  const f = verseFlags(refs, a);
  const ends = f.filter(x => x.endOfAliyah).map(x => [x.ref, x.aliyot]);
  assert.deepEqual(ends, [["Genesis 2:3", [1]], ["Genesis 2:19", [2]], ["Genesis 3:21", [3]], ["Genesis 4:18", [4]],
    ["Genesis 4:22", [5]], ["Genesis 5:24", [6]], ["Genesis 6:8", [7, "M"]]]);
  assert.deepEqual(f.filter(x => x.special === "creation").map(x => x.ref), ["Genesis 1:5", "Genesis 1:8", "Genesis 1:13", "Genesis 1:19", "Genesis 1:23", "Genesis 1:31"]);
  assert.deepEqual(f.filter(x => x.final).map(x => x.ref), ["Genesis 6:8"]);
  assert.equal(f.some(x => x.endOfBook), false);
  assert.equal(flagLabel(f.at(-1)), "end aliyah 7, maftir");
  assert.equal(flagLabel(f.find(x => x.ref === "Genesis 2:3")), "end aliyah 1");
  assert.equal(flagLabel(f[4]), "[creation]");
});

test("verseFlags on V'Zot HaBerachah (Simchat Torah): end of book on Deut 34:12, Gen 2:3 an aliyah end, maftir last", () => {
  const a = aliyotOf(item("simchat-torah"));
  const refs = [...verses("Deuteronomy", [[33, 1, 29], [34, 1, 12]]), ...verses("Genesis", [[1, 1, 31], [2, 1, 3]]), ...verses("Numbers", [[29, 35, 39], [30, 1, 1]])];
  const f = Object.fromEntries(verseFlags(refs, a).map(x => [x.ref, x]));
  assert.deepEqual(f["Deuteronomy 34:12"], { ref: "Deuteronomy 34:12", final: false, endOfAliyah: true, aliyot: [6], endOfBook: true, special: null });
  assert.equal(flagLabel(f["Deuteronomy 34:12"]), "end aliyah 6  end of book");
  assert.equal(f["Genesis 2:3"].endOfAliyah, true);
  assert.equal(f["Genesis 1:31"].special, "creation");
  assert.equal(f["Numbers 30:1"].final, true);
  assert.equal(f["Numbers 30:1"].endOfAliyah, true);
  assert.equal(Object.values(f).filter(x => x.endOfBook).length, 1);
});

test("verseFlags on Beshalach: the Song of the Sea inside aliyah 4, the fifth-pattern verse Ex 14:4 is not an aliyah end in full kriyah", () => {
  const a = aliyotOf(item("beshalach"));
  const refs = verses("Exodus", [[13, 17, 22], [14, 1, 31], [15, 1, 27], [16, 1, 36], [17, 1, 16]]);
  const f = verseFlags(refs, a);
  const song = f.filter(x => x.special === "song-of-the-sea").map(x => x.ref);
  assert.equal(song.length, 19);
  assert.equal(song[0], "Exodus 15:1");
  assert.equal(song.at(-1), "Exodus 15:19");
  assert.deepEqual(f.filter(x => x.endOfAliyah).map(x => x.ref), ["Exodus 14:8", "Exodus 14:14", "Exodus 14:25", "Exodus 15:26", "Exodus 16:10", "Exodus 16:36", "Exodus 17:16"]);
});

test("specialFor: the three passages, and nothing just outside them", () => {
  assert.equal(specialFor("Genesis 1:5"), "creation");
  assert.equal(specialFor("Genesis 1:6"), null);
  assert.equal(specialFor("Exodus 14:31"), null);
  assert.equal(specialFor("Exodus 15:20"), null);
  assert.equal(specialFor("Numbers 33:10"), null);
  assert.equal(specialFor("Numbers 33:11"), "journeys");
  assert.equal(specialFor("Numbers 33:46"), "journeys");
  assert.equal(specialFor("Numbers 33:47"), null);
  assert.equal(specialFor("Isaiah 1:5"), null);
  assert.equal(parseRef("I Samuel 20:18").book, "I Samuel");
});

test("haftarah ranges: Hebcal's structured multi-range haft, its display string, and the semicolon form", () => {
  const shemot = item("shemot");
  assert.equal(shemot.haftara, "Isaiah 27:6-28:13, 29:22-23");
  assert.deepEqual(haftarahRefs(shemot), ["Isaiah 27:6-28:13", "Isaiah 29:22-23"]);
  assert.deepEqual(haftarahRefs({ haftara: shemot.haftara }), ["Isaiah 27:6-28:13", "Isaiah 29:22-23"]);
  assert.deepEqual(parseRefList("Isaiah 27:6-28:13; 29:22-23"), ["Isaiah 27:6-28:13", "Isaiah 29:22-23"]);
  assert.deepEqual(parseRefList("Joshua 3:5-7, 5:2-6:1, 6:27"), ["Joshua 3:5-7", "Joshua 5:2-6:1", "Joshua 6:27"]);
  assert.deepEqual(parseRefList("II Kings 23:1-9, 23:21-25"), ["II Kings 23:1-9", "II Kings 23:21-25"]);
  assert.deepEqual(parseRefList("Isaiah 42:5-43:10"), ["Isaiah 42:5-43:10"]);
  assert.equal(formatRange("Jeremiah", "3:4", "3:4"), "Jeremiah 3:4");
  // Bereshit 5787 fell on Shabbat Machar Chodesh: the haftarah and its reason come through.
  assert.deepEqual(readingFromItem(item("bereshit")).haftarah, { refs: ["I Samuel 20:18-42"], reason: "Shabbat Machar Chodesh" });
});

test("pickItem: parashah by name (spellings, combined parashiyot), V'Zot HaBerachah -> Simchat Torah, a bare date", () => {
  const all = ["bereshit", "shemot", "simchat-torah", "beshalach", "vayakhel-shekalim"].flatMap(n => fixture(n).items);
  assert.equal(pickItem(all, { parashah: "Bereishit" }).name.en, "Bereshit");
  assert.equal(pickItem(all, { parashah: "beshalach" }).name.en, "Beshalach");
  assert.equal(pickItem(all, { parashah: "V'Zot HaBerachah" }).name.en, "Simchat Torah");
  assert.equal(pickItem(all, { holiday: "simchat torah" }).name.en, "Simchat Torah");
  assert.equal(pickItem(all, { parashah: "Noach" }), null);
  const combined = [{ type: "shabbat", name: { en: "Matot-Masei" }, fullkriyah: { 1: { k: "Numbers", b: "30:2", e: "30:17" } } }];
  assert.equal(pickItem(combined, { parashah: "Masei" }).name.en, "Matot-Masei");
  assert.equal(pickItem(fixture("shemot").items, {}).name.en, "Shemot");
});

test("readingFor: a date, and the next occurrence of a parashah searched in windows, with no network", async () => {
  const byDate = { "2026-10-10": "bereshit", "2027-01-02": "shemot", "2027-01-23": "beshalach" };
  const urls = [];
  const fetchJSON = async url => {
    urls.push(url);
    const start = /start=([\d-]+)/.exec(url)[1], end = /end=([\d-]+)/.exec(url)[1];
    return { items: Object.entries(byDate).filter(([d]) => d >= start && d <= end).flatMap(([, n]) => fixture(n).items) };
  };
  const r = await readingFor({ date: "2027-01-02", fetchJSON });
  assert.equal(r.name, "Shemot");
  assert.deepEqual(r.torah.ranges, ["Exodus 1:1-6:1"]);
  assert.deepEqual(r.haftarah.refs, ["Isaiah 27:6-28:13", "Isaiah 29:22-23"]);
  assert.equal(r.torah.aliyot.length, 8);
  urls.length = 0;
  const b = await readingFor({ parashah: "Beshalach", from: "2026-10-15", fetchJSON });
  assert.equal(b.date, "2027-01-23");
  assert.equal(urls.length, 1, "found in the first 120-day window");
  await assert.rejects(readingFor({ parashah: "Noach", from: "2026-10-15", fetchJSON }), /no reading named Noach/);
  await assert.rejects(readingFor({ fetchJSON }), /needs a parashah/);
});
