# The Torah mode: what the trope engine needs beyond the haftarah grammar

Researched 2026-10-15, as a delta against `trope-grammar.md` (same folder). Scope per Daniel's rulings: **haftarah and Torah**, hebcal's full-kriyah ranges, Eastern Ashkenazi, Reform (Binder/Avery first). Nothing in the repo was changed; scripts and data are in the session scratchpad, subfolder `C:\Users\dsbog\AppData\Local\Temp\claude\C--Users-dsbog-haftarah\a7f4aefe-3700-425e-87ab-0020f95626f2\scratchpad\torah\` (`count_torah.py`, `torah_coverage.py` → `coverage_torah.txt`, `tt_degrees_f.py` → `tt_degrees_f.txt`, `peek.py`, the five MAM book dumps under `data/books/`, `ends.json`).

**Tags.** `[V]` verified at a source (URL given). `[C]` computed in this session from Sefaria's MAM text and hebcal-leyning's JSON. `[I]` inferred or proposed.

**Bottom line.** The Torah mode is a second cell table, not a second engine. Binder/Avery's Torah table (TropeTrainer's "Reform standard", Lawrence Avery's variant of A. W. Binder) has **43 core cells plus 4 end-of-aliyah and 4 end-of-book cells = 51**, against the haftarah's 44; the same three syllable-fitting rules apply, and TropeTrainer's own Torah tables use the identical `CONTEXT` vocabulary plus five Torah-only flags (`END_OF_ALIYAH`, `END_OF_BOOK`, `IN_CREATION_DAY`, `IN_JOURNEY=1|2`, `SONG_OF_MOSES`). The Torah brings the **five rare te'amim** (shalshelet ×4, mercha kefula ×5, karnei farah + yerach ben yomo ×1) into scope: 10 verses in all, every one of which lands in the calibration corpus automatically. hebcal's `fullkriyah` gives the engine the end verse of every aliyah: **457 distinct aliyah-final verses** (378 from the weekly cycle, 79 holiday-only), which is the `END_OF_ALIYAH` flag. The computed Torah calibration corpus is **31 verses (481 words) at the ≥10 threshold and 54 verses (774 words) at ≥3**. The special-melody passages that a Reform congregation actually meets in a year are few (Decalogue ×3 readings, Song of the Sea ×2, the five *chazak* endings, the Creation refrain, the Journeys list, Deut 1:12 in Eicha trope) and should be **recorded whole, not synthesized**: about 12–15 minutes of audio. Torah adds roughly **30–37 minutes of finished audio and 2.5–3 hours of studio time** to the haftarah plan; the two tables together are about one hour of audio.

---

## 1. The Torah inventory, as a delta [C]

Five books from Sefaria's v3 API, version `Miqra according to the Masorah`, `return_format=default`: **5,846 verses, 68,484 whitespace tokens** (maqaf chains count as one token), Genesis 1,533 / Exodus 1,210 / Leviticus 859 / Numbers 1,288 / Deuteronomy 956. The weekly cycle covers every verse, so unlike the haftarah there is no "corpus subset": the Torah corpus is the Torah. `count_torah.py`.

| Ta'am | Torah count | per 1,000 words | Nevi'im per 1,000 (from trope-grammar.md) | note |
|---|---|---|---|---|
| tipcha | 11,297 | 165.0 | 149.7 | still the most frequent disjunctive |
| munach | 9,465 | 138.2 | 150.6 | |
| mercha | 9,141 | 133.5 | 120.4 | |
| zakef katan | 6,998 | 102.2 | 112.9 | |
| pashta | 6,378 | 93.1 | 110.8 | 856 words carry the doubled pashta [C] |
| sof pasuk (U+05C3) | 5,853 | 85.5 | 76.4 | 7 more than verses: Ex 20:13 carries 4, 20:14 and Gen 35:22 carry 2, Deut 5:17/18 likewise (section 6) |
| etnachta | 5,494 | 80.2 | 73.4 | |
| mahpach | 3,049 | 44.5 | 53.8 | |
| tevir | 2,681 | 39.1 | 31.7 | |
| revia | 2,447 | 35.7 | 39.5 | |
| kadma | 2,125 | 31.0 | 31.0 | |
| geresh | 1,120 | 16.4 | 18.7 | |
| darga | 1,090 | 15.9 | 12.8 | |
| telisha ketana | 530 | 7.7 | 10.2 | |
| zakef gadol | 526 | 7.7 | 6.7 | |
| gershayim | 513 | 7.5 | 7.2 | |
| telisha gedola | 496 | 7.2 | 8.9 | 218 doubled on the stress |
| segol | 451 | 6.6 | 3.9 | 78 doubled |
| zarka (U+05AE) | 375 | 5.5 | 3.5 | plus 59 U+0598 stress helpers |
| yetiv | 357 | 5.2 | 5.3 | |
| paseq (U+05C0) | 387 | 5.7 | | 269 are munach legarmeh (`<b>׀</b>`), the rest plain paseq (`<small>׀</small>`) |
| pazer | 159 | 2.3 | 3.5 | |
| **mercha kefula** | **5** | | | section 3 |
| **shalshelet** | **4** | | | section 3 |
| **karnei farah / yerach ben yomo** | **1 each** | | | section 3 |
| nun hafukha (U+05C6) | 2 | | | Num 10:35, 10:36 |
| meteg/silluq (U+05BD) | 10,109 | | | |

Poetic-book accents: zero, as in Nevi'im. Rank order is the same as Nevi'im; the te'amim inventory and the three syllable-fitting rules of trope-grammar.md §1–2.2 carry over unchanged.

**Bigram/word-shape inventory** (`torah_coverage.py`, excluding the 27 dual-cantillation verses of section 2.5): **242 features = 36 unigrams (incl. the aliyah/book-end flags), 189 ta'am bigrams, 17 word-shape types**. 156 bigrams occur ≥3 times, 119 ≥10, 113 ≥20 (the haftarah corpus had 157 / 129 / 102). Top bigrams: mercha>tipcha 4,374; tipcha>sof-pasuk 3,425; munach>zakef-katan 3,269; tipcha>etnachta 3,124; zakef-katan>tipcha 2,543; mahpach>pashta 2,528. Word shapes: maqaf chain 4,595 words; double pashta 856; munach+zakef on one word 347; **kadma+zakef on one word ("metiga-zakef") 156**; double telisha gedola 218; double segol 78; double telisha ketana 72; double zarka 59; kadma+geresh on one word 36; mercha+tevir on one word 17.

---

## 2. The Torah cell table

### 2.1 Scale, frame and the "C major" trap

- The Torah mode is a **major** mode whose final has a fifth above and a fourth below it, with a recurring resting tone on **2**; zakef katon ends on 2, etnachta "begins and ends on 2, touching down on the 5 below", tipcha is a neighbour-note figure `<2, 3-2>`, revia is the only disjunctive that ends on **6 below** (a temporary move to vi), and the **end-of-section melodies cadence on the relative minor (vi)**, the inverse of the haftarah's relative-major cadence; Kalib calls it a "tonally-focused major mode". [V] Malin 2016 §"The Torah Mode", Examples 10a (Kalib 2002) and 10b (Portnoy/Wolff 2000, also in Binder 1959 pp. 117–18 and Ne'eman), Example 13, Table 4, https://jewish-music.huji.ac.il/media/2302/download/
- Two documented sof-pasuk endings: **3→1** (Kalib, Example 10a) and **1→5 below** (Portnoy/Wolff, Binder: "F going down to C"), the latter "not common in Israeli Ashkenazi communities" (Malin n.47). Zakef katon: `<5, 3-2>` (Kalib) vs `<3, 5-2>` (Portnoy/Wolff/Binder), a permutation (n.46). [V]
- TropeTrainer labels Binder's Torah tables "C MAJOR" and Rosowsky's/Common's "F MAJOR" at the same `PITCHBEND=1`; the pitch letters are the same absolute notes. The "C" tables simply call the low sof-pasuk note the tonic (Malin n.47: "may also be heard with C as tonic; the scale would then be Mixolydian"). [V tropedef.xml; V Malin] **Everything below is in Malin's frame, F = 1**, so that it lines up with the literature: Binder's "sof pasuk ends on C" reads as `1, 5_` and Rosowsky's "High Silluq" as `3, 1`. Notation as in trope-grammar.md: `[ ]` upbeats, `5_` = below the tonic, `'` = held in TropeTrainer's durations, `4#` = B natural (the raised 4th, which appears only in the Journeys etnachta and in Common Melody's pazer).

### 2.2 The cells: Avery/Binder (Reform standard) with Rosowsky and Common Melody [V tropedef.xml, converted by `tt_degrees_f.py`]

Source: `TROPEDEF NAME="Ashkenazic - Avery/Binder" TYPE="Torah" KEY="C MAJOR"`, described in the file as "Lawrence Avery's variant on the melody taught by Abraham Binder ... a standard for the Reform movement. Sof Pasuk ends on C." Comparison columns: `Ashkenazic - Rosowsky` (Torah, "A standard for Ashkenazim of Polish-Lithuanian origin ... the most complex with many detailed exceptions, principally with the 'Munach' trope"; a second table `Rosowsky (High Silluq)` differs in the sof pasuk) and `Ashkenazic - Common Melody` (Torah, "A common style used in many Chabad and other synagogues"). Kinnor's data is cited as a reference design only. The "literature" column is Malin's reading of Kalib / Portnoy-Wolff / Binder.

| Cell (trope, context) | Avery/Binder | Rosowsky | Common Melody | Literature |
|---|---|---|---|---|
| **sof pasuk** (silluq) | [2] 1, 5_' | [2] 1, 5_ (High Silluq table: 3→1) | [2] 3', 1' | 1→5_ (P-W, Binder 1959) vs 3→1 (Kalib) [V Malin] |
| Avery/Binder "High Sof Pasuk" variant table | [2] 3', 1' (only cell that differs) | | | |
| mercha before silluq | [7_] 2 | [7_] 2' (default) | [5_] 2, 7_ (default) | |
| **tipcha** (default and after mercha) | [2] 3, 5, 2 | [3] 3, 5, 2 / after mercha [2] 3, 5, 2 | [2] 3, 2' | `<2, 3-2>` neighbour figure [V] |
| mercha (default, before tipcha) | [7_] 2' | [7_] 2' | [5_] 2, 7_ | |
| **etnachta** | [5_] 2' | [5_] 2' | [5_] 2' | ends on 2, touches 5_ [V] |
| munach before etnachta | [2] 1, 6_ | [1] 1, 6_' | [2] 1 | |
| munach before munach (etnachta group) | [2] 2 | [2] 2 | [2] 2 (default) | |
| **zakef katon** | [3] 5, 2' | [3] 5, 2 (monosyllable: 3, 2) | [3] 5', 2 | `<3, 5-2>` P-W/Binder [V] |
| munach immediately before zakef katon | [3] 3, 2, 3' | [3] 3, 2, 3 | [2] 1, 2, 3 | |
| munach elsewhere in a zakef group | [3] 3 | [5] 5, 3, 5 (group), [5] 3, 2, 5 (before munach) | [3] 3' | |
| **munach, default** (Binder's "high" munach) | [5] 5, 3, 5' | [1] 3, 2 | [2] 2 | |
| pashta / double pashta | [1] 5' / first mark [1] 5, second 5' | [1] 5' / same | [2] 5', 3 / [2] 5' + 3 | |
| mahpach | [3] 3, 5_, 1 | [3] 3, 5_, 1 (after munach [5] 3, 5_, 1) | [6_] 2, 6_, 2 | |
| kadma (before mahpach/pashta) | [1] 3' | [1] 3' | [3] 5 | |
| kadma before azla | [5_] 1' | = default | = default | |
| **kadma + zakef on one word (metiga-zakef)** | no special cell (156 words [C]) | none | kadma [1] 2#', zakef [2#'] 2#, 1, 2#, 5, 2#, 4, 2#', 2' (chromatic) | sarahbolts Torah phrase 28 "Metiga Zakef-Katon" [V] https://sarahbolts.com/trope/torah-trope/zakef-katon-phrases-torah/ |
| mercha before pashta / double pashta / legarmeh | [1] 1 | [1] 1' | [2] 2 | |
| yetiv | 6, 5 (no upbeat) | 6, 5 | 5' | |
| **revia** | [3] 2, 1, 7_, 6_' | [2] 2, 1, 7_, 6_' (after munach [3] …) | [2] 2', 3, 2, 1, 7_, 6_' | scalar descent 3→6_, "temporary vi" [V] |
| munach before revia | [2] 5, 3' | [2] 5, 3' | [2] 2, 5, 3 | |
| munach legarmeh | [1] 1, 2, 3, 1, 2 | [1] 1, 2, 3, 1, 2' | [2] 2 (revia group: [2'] 1, 2, 3, 1, 2) | |
| **tevir** | [2] 1, 7_, 1, 2' | [2] 1, 7_, 1, 2' | [5_] 1, 2, 1, 7_, 1, 2 | |
| darga | [3] 5', 4, 3, 2' | [3] 5, 4, 3, 2' (after munach [5] …) | [3] 5, 4, 3, 2, 3, 2 | |
| mercha before tevir | [3] 5, 2' | [3] 5, 2 (after munach [5] 5, 2) | [2] 5, 2 | |
| mercha kefula | [2] 2, 3, 4, 5, 4, 3, 2' | same | [2] 5', 4#, 5, 6', 5', 3', 2 | |
| **kadma v'azla** (azla) | [1, 3] 5, 3, 6, 5' | [3] 6, 5 | [3] 6, 5 | |
| geresh | [5] 5, 3, 6, 5' | [3] 5, 3, 6, 5' (after munach [2] …) | [3] 5, 3, 6, 5 (after kadma [3] 3, 6, 5) | |
| gershayim | [1] 3', 2, 1, 2, 3 | [1] 3, 2, 1, 2, 3' | [2] 3', 2, 1, 2, 3' | |
| munach before geresh / before gershayim | [5] 5 / [1] 1 | — / [3] 3, 2 | default | |
| zakef gadol | [1, 1] 3, 5', 6, 5, 3', 2' | [1, 3] 5, 6, 5, 3, 2' | [2] 5, 3, 5, 3, 2 | |
| telisha ketana | [1] 1, 7_, 1, 2', 1' | [1] 1, 7_, 1, 2, 1' | [2] 1, 2, 3, 1, 2' | |
| telisha gedola | [1] 1, 2, 3, 4, 5, 3, 2, 1' | same | [2] 1, 2, 3', 2', 1 | |
| munach before telisha ketana / pazer / in a telisha-gedola group | [1] 3, 2 | [1] 3, 2 | [2] 3', 2 | |
| pazer | [1] 1, 2, 3, 4, 5, 6, 5, 3, 2' | same | [2] 2', 3, 4#, 5, 6, 5, 3, 2' | |
| **zarka** | [2] 3, 2', 1, 7_, 6_, 7_, 5_ | same | [2] 2', 1, 7_, 6_, 7_, 6_, 5_ | |
| munach before zarka / mercha before zarka | [4] 3, 2 / [4] 3 | [4] 3, 2 / [4] 3' | [2] 4, 3 / — | |
| **segol** | [2] 3, 2' | [5_] 3, 2' (after munach [2] 3, 2') | [6_] 3', 2' | |
| munach before segol / munach-munach in a segol group | [5_] 2' / [5_] 5_' | [5_] 2' / [2] 2 | [6_] 1', 7_ | |
| shalshelet | [1] (1, 2, 3, 4, 5, 6, 5) ×3, 3, 2 — 23 notes | [1] 1, 3, 5, 3, 1, 3, 5, 3, 8, 3, 5, 3, 1, 3, 6, 5' | [2] (2, 3, 4#, 5, 6, 5, 3, 2') ×2 | "similar to three pazers" [V] https://en.wikipedia.org/wiki/Shalshelet |
| yerach ben yomo | [1] 3, 2' | [1] 3', 2 | [2] 5', 4#, 3, 7_' | |
| karnei farah | [1] 1, 7_, 1, 2, 1', 2, 3, 4, 5, 3, 2, 1' (= telisha ketana + telisha gedola) | [1] 1, 7_, 1, 2, 1, 1, 2, 3, 4, 5, 3, 2' | [2] 5', 4#, 5, 6', 5', 3', 2, 1, 2, 3, 2', 1 | "telisha ketana and gedola together" [V] https://en.wikipedia.org/wiki/Karne_parah |
| munach before yerach / karnei farah | [1] 3, 2 | default | [2] 3', 2 | |
| **END OF ALIYAH** mercha→tipcha / tipcha / mercha→silluq / silluq | [6_] 1' / [6_] 5, 3 / [3] 3 / [3] 2, 6_' | [6_] 1' / [1] 5, 3 / [3] 3, 2 / [2] 2, 6_ | [2] 2 / [2] 5, 3 / [2] 2 / [3] 2', 6_' | cadence on vi (relative minor) [V] Malin Table 4 |
| **END OF BOOK** mercha→tipcha / tipcha / mercha→silluq / silluq | [5] 5' / [6] 6, 5, 3 / [3] 3 / [2] 2, 1' | [2] 2 / [2] 2, 7_, 5_ / [2] 2 / [2] 5, 2' | [7_] 2 / [2] 2, 3, 2, 7_, 1, 7_, 5_' / [5_] 5_ / [5_, 5', 5, 5] 5, 6, 5, 2 | Binder 1959 "Festive endings" [V TOC via bookseller] |
| **CREATION DAY** (Gen 1:5, 8, 13, 19, 23, 31) | = END OF BOOK cells, mercha→tipcha unheld [5] 5 | (none) | [2] 4, 2 / [4] 5, 3 / [3] 3 / [2] 2, 3, 2, 1 | |
| **JOURNEYS** A / B (two alternating verse-melodies) | tipcha→silluq [1] 5 / [3] 3; tipcha→etnachta [1, 2] 3 / [5] 5; tipcha→munach [3] 3 / [5] 5; silluq [2] 3' / [2] 2, 1'; etnachta [3] 4#, 3, 2 / [5] 6, 5, 3; munach [3] 3 / [5] 5; kadma [1] 1 / [5] 5; zakef katon [2] 3 / [5] 5 | (none) | (none) | "chanted in pairs" [V] Cantor Jamie Marx, https://reformjudaism.org/learning/torah-study/torah-commentary/tell-me-if-youve-heard-one |
| **SONG OF MOSES** (Ex 15) | 29 contexts in six named sub-schemes (`SofPasuk`, `ShortSofPasuk`, `Etnachta`, `EarlyZakefKaton`, `LateZakefKaton`, `LateZakefKaton2`), 15 distinct cells | 4 contexts (mercha, tipcha, silluq) | 11 contexts (`ChabadSongOfMoses…`) | Binder 1959 chapter "Musical detours: Shirath Hayam" [V TOC] |

Counting distinct note strings per category [C]: Avery/Binder **43 core + 4 end-of-aliyah + 4 end-of-book = 51**, plus 4 Creation, 10 Journeys, 15 Song = 60 in the file (112 contexts). Rosowsky 50 core + 4 + 3 = 57 of 59 (75 contexts; no Creation/Journey cells). Common 43 + 3 + 4 = 50 of 57. Spiro 45 + 4 + 3 of 55.

**Where the Torah tables disagree, hence what to sing to the cantor** [I from the table]: (a) sof pasuk 1→5_ (Avery/Binder default, Rosowsky default) vs 3→1 (Avery/Binder High, Rosowsky High Silluq, Common); (b) the default munach: Binder's high `[5] 5 3 5` vs Rosowsky's `[1] 3 2` vs Common's `[2] 2`; (c) the end-of-aliyah silluq lands on 6_ in all three (safe) but the end-of-book silluq lands on 1 (Binder), 2 (Rosowsky, Common); (d) whether he sings a metiga-zakef cell at all (Common does, Binder/Rosowsky do not); (e) kadma v'azla 6 notes (Binder) vs 2 (Rosowsky, Common). Items (a) and (b) are audible in any verse; the rest need a chosen verse each (section 4.3 lists them).

### 2.3 What does not change

The three syllable-fitting rules, elision, the missing-conjunctive rule, free rhythm, the double-pashta convention (`DOUBLE_PASHTA` + `PASHTA AFTER="DOUBLE_PASHTA"`), and the end-of-reading four-pattern comment are stated identically in the Torah tables (the `<COMMENT>` text in the Avery/Binder Torah table is the same text as in the haftarah table) [V tropedef.xml]. `ASSIMILATE_RHYTHM` is TRUE on Avery/Binder, Rosowsky, Spiro and FALSE on Common Melody and Chabad Torah [V]. The LBC "Learn to Leyn" rules quoted in trope-grammar.md are in fact a Torah manual (its worked examples are Gen 3:9 and Lev 1), so they were already Torah rules [V] https://lbc.ac.uk/wp-content/uploads/2024/02/Learn-to-Leyn-Offline-Version.pdf .

---

## 3. Torah-specific contexts and special cases

### 3.1 End of aliyah vs end of book [C, V]

- **The flag.** `@hebcal/leyning`'s `aliyot.json` lists `fullkriyah` 1–7 and M for each of the 61 parashah entries (54 single + 7 combined), and `holiday-readings.json` lists `fullkriyah` for 112 holiday/special keys. Every aliyah's `e` verse is an `END_OF_ALIYAH` verse. Union: **457 distinct verses** (378 from the weekly cycle incl. the combined parashiyot, 79 that are aliyah ends only in a holiday reading, e.g. Gen 22:8 on Rosh Hashana II, or the maftir verses of Zachor/Shekalim/Parah/HaChodesh). `ends.json`.
- **The four patterns** (TropeTrainer's a/b/c/d comment, identical for Torah): over the 457 aliyah-final verses, mercha-tipcha-silluq 163, tipcha-mercha-silluq 112, tipcha-silluq 94, mercha-tipcha-mercha-silluq 86, and **2 verses that end etnachta→silluq with no tipcha at all: Ex 14:4 (Beshalach aliyah 1) and Ex 36:7 (Vayakhel aliyah 3)**; the engine needs a fifth rule for those (sing the end-of-aliyah silluq cell alone, or ask the cantor). Over the whole Torah the verse-final tails are m-t-s 1,930, t-s 1,496, t-m-s 1,278, m-t-m-s 1,093, etnachta>silluq 38, revia>silluq 6, segol 2, zakef 1.
- **Maftir.** On an ordinary Shabbat `M` repeats the last 3+ verses of the 7th aliyah (Bereshit M = 6:5–6:8), so its end verse is already flagged. On special Shabbatot `M` comes from another book (Zachor Deut 25:17–19; Shekalim Ex 30:11–16; Parah Num 19:1–22; HaChodesh Ex 12:1–20; Shabbat Rosh Chodesh Num 28:9–15; Chanukah Num 7:x) and those ends are among the 79 holiday-only flags. `Vezot Haberakhah` has no `M` in `aliyot.json`; Simchat Torah's entry supplies the maftir (Num 29:35–30:1) and makes **Gen 1:1–2:3 its 7th aliyah**, so Gen 2:3 is an aliyah end that day. [V aliyot.json, holiday-readings.json]
- **End of book** = five verses: Gen 50:26 (m-t-s), Ex 40:38 (m-t-s), Lev 27:34 (t-s), Num 36:13 (t-m-s), Deut 34:12 (t-s) [C]. The end-of-book cells replace the end-of-aliyah cells on those verses, and in Binder's table they are the **same cells as the Creation-day refrain** (section 2.2). After the last word the congregation says *chazak chazak v'nitchazek* and the reader repeats it; Cantor Marx reports it sung to the same "traveling melody" as the Journeys [V reformjudaism.org]. It is a fixed formula, not trope: **record it**.
- TropeTrainer's data confirms `END_OF_ALIYAH` on MERCHA(before TIPCHA / before SILLUQ), TIPCHA and SILLUQ in every Torah table (142 such contexts across the file) and `END_OF_BOOK` (63) [V].

### 3.2 The Decalogue: ta'am elyon vs ta'am tachton

- **Two systems.** The lower (tachton) accents follow the ordinary verse division and are used for private reading and, by most Ashkenazim, on the two Shabbatot (Yitro, Va'etchanan); the upper (elyon) accents make each commandment one verse and are used on Shavuot; Sephardim and many others use the elyon for all three public readings. [V] Hebrew Wikisource "ביאור:חלוקת עשרת הדברות" (via search summary) https://he.wikisource.org/wiki/ביאור:חלוקת_עשרת_הדברות ; Masorti UK (elyon for all three) https://masorti.org.uk/articles/vaetchanan-2/ ; Ohr Somayach (most Ashkenazim: Shavuot only) https://ohr.edu/ask_db/ask_main.php/237/Q6/ ; tanach.us (lower = Tiberian, upper = Babylonian origin) https://www.tanach.us/Supplements/Decalogues.html
- **Reform practice is not documented anywhere I could find** (four searches). The nearest evidence: the UK Progressive manual (LBC) says the upper notes "are the notes intended for public reading on the two Sabbaths when these portions occur and on Shavuot" [V LBC p.16]; Binder's *Biblical Chant* (the Reform standard text) has a chapter "Double tropes in the Ten Commandments" [V TOC, https://www.biblio.com/book/biblical-chant-binder-abraham-wolf/d/1257776680 ]; Jacobson's companion site presents the Decalogue as "Ten verses: one for each commandment" for "a liturgical service" [V] https://www.chantingthehebrewbible.com/the-decalogue ; TropeTrainer offered both [V] https://www.tropetrainer.com/holiday/details/Shavuot . **Ask the cantor** (question 2). The engine should support both from one table: the elyon is only a different set of marks and verse boundaries, not a different melody (no source describes a special Decalogue tune in the Eastern Ashkenazi tradition) [I].
- **What Sefaria's MAM text carries: both systems superimposed on the same words.** [C from `peek.py`; V encoding doc https://bdenckla.github.io/MAM-basics/MAM-for-Sefaria/ ] Example Ex 20:2 `אָֽנֹכִ֖י֙` = tipcha (U+0596) + pashta (U+0599); `אֱלֹהֶ֑֔יךָ` = etnachta + zakef katan; `עֲבָדִ֑͏ֽים` = etnachta + CGJ + silluq; Ex 20:13 `תִּֿרְצָ֖͏ֽח` = tipcha + CGJ + silluq, `תִּֿגְנֹֽ֔ב` = silluq + zakef. Counts: Ex 20:2–14 has 139 words, **48** carrying marks of both systems, 4 words with a rafe, 7 words with CGJ, 16 sof-pasuq signs in 13 Sefaria verses; Deut 5:6–18: 163 words, 54 dual, 4 rafe, 6 CGJ, 16 sof-pasuq; Gen 35:22 (the Reuben verse, the third dual passage): 17 words, 5 dual, 2 sof-pasuq. The MAM doc calls the fragile words "QUPO" (one letter, four marks) and "UM" (under-accent followed by meteg) and pins their order with U+034F. **MAM also writes both dagesh and rafe on the same letter** where the two systems pronounce it differently: Ex 20:9 `כׇּֿל־מְלַאכְתֶּֽךָ֒` (kaf soft in the elyon, hard in the tachton) [V] Wikisource "מבוא למקרא על פי המסורה/פרק ב" via search; [C] the codepoints.
- **Verse boundaries differ from Sefaria's numbering in both systems.** In the Tiberian tachton, Ex 20:2–3 is one verse (etnachta on עֲבָדִים, silluq on עַל־פָּנָי), and 20:13's four short commandments are one verse (tipcha / etnachta / zakef / silluq); in the elyon אָנֹכִי is its own verse ending at עֲבָדִים, each of the four short commandments is a verse, and לֹא תַחְמֹד is one verse. The printed-edition tachton (Koren, chumashim) splits 2 and 3. [V] fetched Wikisource comparison page https://he.wikisource.org/wiki/עשרת_הדברות_בסיס/טעמים (CC BY-SA 4.0; separate text blocks "בטעם התחתון" / "בטעם העליון" for Exodus and Deuteronomy, each per the Tiberian Masorah and per the printed editions, plus the Reuben verse) — verse-break details are my reading of its sof-pasuq marks, confirm before coding.
- **Rule of thumb for separating the marks**, if one must: "choose the left sign whenever two signs occupy the same slot, or the top sign when there is a choice between a lower and an upper sign" gives the elyon [V LBC p.16]; tanach.us states the Leningrad convention as "first in right-to-left order is Lower, second is Upper" [V]. Both fail on words like `תִּֿגְנֹֽ֔ב` where Unicode canonical ordering has already moved the meteg. **Recommendation [I]: hand-curate a JSON for the 27 Sefaria verses (319 words, 107 dual-marked) with per-word `{tachton, elyon}` accents and the two verse-boundary sets, derived from the Wikisource separated texts, and switch on a per-reading flag.** Sefaria has no separated elyon text (the MAM-for-Sefaria doc lists the three passages only as "dual cantillation sections").
- **The Decalogue ends an aliyah in all three readings**: Yitro aliyah 6 = 19:20–20:14, Shavuot I aliyah 4 = 19:20–20:14, Va'etchanan aliyah 4 = 5:1–5:18 [V aliyot.json / holiday-readings.json]. So the `END_OF_ALIYAH` cadence falls on the tenth commandment in whichever system is chanted.

### 3.3 Song of the Sea (Shirat Hayam, Ex 15:1–19)

Read in Beshalach (aliyah 4 = 14:26–15:26) and on Pesach VII (aliyah 5 = 14:26–15:26) [V aliyot.json, holiday-readings.json]. Chanted with a special melody: Binder's table has 29 contexts in six named sub-schemes applied to specific phrases, Rosowsky's a simpler 3-cell scheme, Common's an 11-context Chabad scheme [V tropedef.xml]; TropeTrainer's manual: "Certain texts such as the Song of Moses in Exodus ... are often chanted using special melodies" with an "Underline special melodies" button [V manual p.18]; Jacobson publishes a Shirat Ha-Yam PDF [V chantingthehebrewbible.com]; Cantor Marx describes the "traveling melody" used "in several places before, during, and after" the Song [V]. Which verse gets which sub-scheme is in TropeTrainer's text file `tan.ett`, which is an obfuscated zip (stored entries, non-text payload) that I could not read [C]. Congregations also sing Ex 15:11 (*mi chamocha*) and 15:18 together. **Record the 19 verses whole** (about 6 minutes); do not try to rule-generate them. MAM lays the Song out in the scroll's brick pattern with runs of eight `&nbsp;` inside the verse (15 of the 19 verses) [C]; see section 6.

### 3.4 Creation refrain, Journeys, and the other passages TropeTrainer encodes

| Passage | Verses | What happens | Reform weekly relevance |
|---|---|---|---|
| Creation days (`IN_CREATION_DAY`) | Gen 1:5, 8, 13, 19, 23, 31 (*vayhi erev vayhi voker yom …*) | the verse-final mercha-tipcha-(mercha)-silluq takes the festive end-of-book cells (Binder) [V XML] | Bereshit every year; Simchat Torah (Gen 1:1–2:3 is its 7th aliyah) |
| Journeys (`IN_JOURNEY=1|2`) | Num 33:11–12 and 33:17–46 per Marx; Jacobson's PDF "Num 33:11–46" | verses chanted in pairs to an old "Journeys"/"traveling" melody regardless of the marks; TropeTrainer encodes two alternating verse-melodies A/B over tipcha, silluq, etnachta, munach, kadma, zakef katon [V XML; V reformjudaism.org; V chantingthehebrewbible.com] | Masei / Matot-Masei, once a year (aliyah 2 of Masei = 33:11–49) |
| The Chiefs | Num 10:15–27 | Jacobson publishes a special-melody PDF for it [V chantingthehebrewbible.com]; no TropeTrainer flag | Beha'alotcha, once a year; ask whether the cantor uses it |
| *Chazak* | after Gen 50:26, Ex 40:38, Lev 27:34, Num 36:13, Deut 34:12 | congregation then reader, same traveling melody [V Marx] | five times a year |
| Deut 1:12 (*eichah*) | one verse | sung in Lamentations trope on Shabbat Chazon by many Ashkenazim; TropeTrainer toggles Eicha melody for the Devarim haftarah [V manual p.9] and ships an Eicha table in `tropedef_megillot.xml` [V] | once a year; one verse: record it rather than add a seventh table |
| Ten Commandments | Ex 20:2–14, Deut 5:6–18 | section 3.2 | Yitro, Va'etchanan, Shavuot |
| Song of the Sea | Ex 15:1–19 | section 3.3 | Beshalach, Pesach VII |
| Tochecha | Lev 26:14–43 (Bechukotai aliyah 3 = 26:10–46), Deut 28:15–68 (Ki Tavo aliyah 6 = 28:7–69) | read quickly and quietly, no melody change [I, common knowledge; no source found] | a tempo/dynamics parameter, not a cell |
| Priestly Blessing | Num 6:24–26 (Nasso aliyah 4) | **no special leyning melody in any source consulted** (no TropeTrainer flag, not in Binder's TOC, not in Jacobson's special-melody list); the familiar tune is the liturgical *duchenen*, not trope [I] | regular cells |
| Ha'azinu | Deut 32:1–43 | scroll layout in two columns (MAM: 31 verses with the eight-`&nbsp;` layout [C]); no Eastern Ashkenazi special melody in the sources consulted [I] | regular cells; layout only |
| Parashat Zachor | maftir Deut 25:17–19 | regular trope; the only known variation is reading זֵכֶר twice (*zeicher* / *zecher*) in many Ashkenazi congregations [I, widely known; not verified today] | ask the cantor whether to double it |
| Thirteen Attributes | Ex 34:6–7 on festivals; Ki Tisa aliyah 7 | congregation reads first, then the reader; regular trope [I] | performance note only |
| Shema | Deut 6:4 | congregation first; large ע and ד (`<big>`) [C] | performance note only |

**What matters for a Reform congregation's weekly reading** [I]: every week, the end-of-aliyah cadence (and, five times a year, the end-of-book cadence with *chazak*); the Creation refrain (Bereshit, Simchat Torah); the Decalogue three times a year (system to be decided); the Song of the Sea twice; the Journeys once; Deut 1:12 once. Everything else is regular trope. Note that CRC may read fewer or shorter aliyot than hebcal's seven (chant-audio.md Q5); Daniel ruled hebcal's full ranges, so the engine flags hebcal's 457 ends and a later per-congregation override would only move the flag.

---

## 4. Rare te'amim in the Torah [C, V]

| Ta'am | Torah occurrences | Verses | Parashah / when read | Notes |
|---|---|---|---|---|
| shalshelet | 4 | Gen 19:16 (וַיִּתְמַהְמָהּ), Gen 24:12 (וַיֹּאמַר), Gen 39:8 (וַיְמָאֵן), Lev 8:23 (וַיִּשְׁחָט) | Vayera, Chayei Sara, Vayeshev, Tzav | always followed by paseq (`<b>׀</b>` in MAM); 23 notes in Binder, "three pazers" [V Wikipedia, which agrees on the four verses] |
| mercha kefula | 5 | Gen 27:25, Ex 5:15, Lev 10:1, Num 14:3, Num 32:42 | Toldot, Shemot, Shmini, Sh'lach, Matot | 14 in the whole Bible; always darga>mercha-kefula>tipcha here (5 of each bigram) [C]; "sometimes confused with a t'vir because it follows darga" [V LBC p.16; V Wikipedia list] |
| karnei farah + yerach ben yomo | 1 | Num 35:5 (יָ֣ם ׀ אַלְפַּ֪יִם בָּֽאַמָּ֟ה) | Masei / Matot-Masei | the pair always occurs together (munach>yerach>karnei-farah>telisha-ketana) [C]; 16 in the Bible [V Wikipedia] |
| pazer gadol | = karnei farah (its other name) | | | TropeTrainer and Wikipedia both file it as karnei farah |
| telisha gedola | 496 marks in 261 verses | | | ordinary, not rare: 7.2 per 1,000 words |
| pazer | 159 in 152 verses | | | 2.3 per 1,000; pazer>pazer 3 times |
| zakef gadol | 526 | | | 7.7 per 1,000 |

So the Torah scope adds **three cells** (shalshelet, mercha kefula, karnei farah + yerach ben yomo, with their munach) that the haftarah left empty, and **10 verses** carry them. Because the coverage script forces every unigram into the target, all three land in both calibration sets automatically (Gen 24:12, Lev 10:1 or Gen 27:25, Num 35:5).

---

## 5. Unit inventory, recording delta, and the Torah calibration corpus

### 5.1 Cells and units [C, I]

| Layer | Haftarah (trope-grammar.md) | Torah (Avery/Binder) | Delta |
|---|---|---|---|
| Core cells incl. the rare three | 44 (3 empty) | 43 + 3 rare = 46 distinct strings incl. rare | +2 net, but three previously empty cells are now real |
| End-of-reading cells | 4 (end of haftarah) | 4 end-of-aliyah + 4 end-of-book | +4 |
| Creation / Journeys / Song cells | — | 4 / 10 / 15 (recorded whole, not as units) | 0 units |
| Units = cells × 3 syllable shapes | ~130 | **~150** (51 × 3 minus yetiv's p=1 shape and the monosyllabic-only cells) | **+20** |
| Distinct bigrams in corpus | 157 | 189 | |
| Word-shape features | 48 types | 17 types (coarser flagging: pashta/zarka/segol/telisha doubles and two-accent words only) | |

### 5.2 Recording time for the Torah add-on

Same assumptions as trope-grammar.md §4.3 (1.5–4 s per neutral unit, PocketTorah's 18.7 s/verse pace for real verses, studio ×2.5 with slating and breaks).

| Item | Clips | Finished audio | Studio |
|---|---|---|---|
| ~150 Torah units on a neutral syllable (or the trope names) | 150 | ~7 min | ~40 min |
| Torah calibration corpus (31 verses core / 54 full; §5.3) | 31 / 54 | ~10 / ~17 min | ~35 / ~55 min |
| End-of-aliyah: the four patterns, each sung as the last verse of an aliyah (already inside the corpus: Deut 1:21 t-s, Lev 6:11 m-t-s, Num 36:13 t-m-s, Deut 14:29 m-t-m-s) plus the two etnachta-silluq ends (Ex 14:4, Ex 36:7) | 2 extra | ~1 min | ~5 min |
| End of book: Ex 40:38 and Deut 34:12 (the other three are in the corpus), each followed by *chazak chazak v'nitchazek* | 2 | ~1 min | ~5 min |
| Creation refrain: Gen 1:5 and 1:31 whole | 2 | ~1 min | ~5 min |
| Journeys: one A/B pair, Num 33:11–12 | 1 | ~0.5 min | ~3 min |
| Song of the Sea, Ex 15:1–19, whole | 19 | ~6 min | ~20 min |
| Decalogue, Ex 20:2–14, in the system the cantor uses (only if elyon or a special melody; otherwise computed) | 13 | ~4 min | ~12 min |
| Deut 1:12 in Eicha trope | 1 | ~0.3 min | ~2 min |
| Torah blessings before and after (fixed texts; TropeTrainer has a hand-set `TorahBlessing` table too) | 2 | ~1 min | ~5 min |
| **Torah total** | | **~31–38 min** | **~2.2–2.6 h** |

Combined with the haftarah plan (25–27 min, 2–2.5 h): about **one hour of finished audio over two sessions**. Since Daniel ruled Josh's recording optional, the same list is the list of what a stand-in voice must produce for pipeline A.

### 5.3 Torah calibration corpus [C]

`torah_coverage.py` tokenises all 5,846 verses (qere read, ketiv dropped, maqaf chains merged, `<b>׀</b>` → legarmeh, `<small>׀</small>` ignored, sub-verses split on U+05C3), flags every aliyah-final and book-final verse from hebcal with its tail pattern, excludes the 27 dual-cantillation verses from the inventory, seeds Gen 1:1, and greedily picks the fewest verses (favouring short ones) that cover every unigram and every feature at the threshold.

**Core set, 31 verses, 481 words: every ta'am type in the Torah, all five rare-mark cells, all four end-of-aliyah patterns plus the etnachta-silluq end, three of the five book ends, and every bigram/word-shape occurring ≥10 times (165 features).**

Genesis 1:1 · Deuteronomy 1:21 (end of Devarim 2; tipcha-silluq) · Numbers 26:35 · **Numbers 35:5** (karnei farah + yerach ben yomo) · Genesis 43:7 · Deuteronomy 6:11 · Genesis 42:38 · **Numbers 36:13** (end of Numbers; tipcha-mercha-silluq) · Deuteronomy 31:17 · Deuteronomy 14:29 (end of Re'eh 5; mercha-tipcha-mercha-silluq) · Numbers 32:1 · **Exodus 36:7** (end of Vayakhel 3; etnachta-silluq) · Deuteronomy 3:20 (zakef gadol>kadma) · Genesis 7:2 · Deuteronomy 2:36 · Leviticus 6:11 (end of Tzav 1; mercha-tipcha-silluq) · Exodus 29:1 · Exodus 35:29 (end of Vayakhel 2) · Exodus 35:35 · Leviticus 27:11 · Genesis 9:2 · Exodus 30:12 · Exodus 7:20 · **Leviticus 10:1** (mercha kefula) · Genesis 41:22 · **Genesis 50:26** (end of Genesis) · **Leviticus 27:34** (end of Leviticus) · Genesis 23:15 · Genesis 7:21 · **Genesis 24:12** (shalshelet) · Numbers 16:13 (end of Korach 1).

**Full set, 54 verses, 774 words: everything occurring ≥3 times (202 features).** The core set's first five plus: Genesis 27:25 (mercha kefula), Genesis 27:33 (pazer>pazer, segol>pazer), Exodus 30:12, Genesis 6:15, Exodus 3:18, Exodus 3:8, **Exodus 40:38** (end of Exodus), Numbers 22:20 (end of Balak 2), Deuteronomy 6:10, Exodus 36:7, Numbers 29:18, Numbers 18:9, Genesis 10:32 (end of Noach 6), Numbers 19:4, Deuteronomy 5:22, Exodus 11:1, Exodus 3:19 (telisha gedola>mercha), Deuteronomy 31:16, Genesis 3:11 (zakef gadol>yetiv), Genesis 5:29 (gershayim+telisha gedola on one word), Exodus 16:6, Genesis 42:16, Exodus 13:3, Exodus 35:20 (end of Vayakhel 1, 5 words), Exodus 16:17, Genesis 13:1 (geresh>telisha gedola), Exodus 7:7 (end of Vaera 3), Genesis 22:8 (end of Rosh Hashana II aliyah 2), Leviticus 15:18, Leviticus 27:34, Genesis 23:15, Genesis 24:12, Genesis 28:16 (segol>zakef gadol), Genesis 41:30 (telisha gedola>geresh), Exodus 4:31 (end of Shemot 6), Exodus 40:19 (zakef katan>geresh), Leviticus 11:35 (segol>darga), Numbers 14:29, Numbers 36:13, Genesis 38:12 (pashta>revia), Genesis 43:34 (segol>geresh), Genesis 44:1, Exodus 38:30, Leviticus 26:26, Numbers 14:35, Leviticus 14:48 (pashta>telisha gedola), Numbers 11:21 (segol>mercha), Genesis 47:15, Leviticus 7:21 (pashta>legarmeh; also a mid-verse pisqa). (The greedy run's exact list is in `coverage_torah.txt` lines 296–351.)

Add, outside the generic corpus: Deut 34:12 (the fifth book end), the Creation, Journeys, Song, Decalogue and Deut 1:12 passages of §5.2, and the three metiga-zakef diagnostic words if the cantor sings a special cell (any of the 156 words, e.g. in Gen 1:1's neighbourhood: search `two-accents:kadma+zakef-katan`).

As with the haftarah, the verse lists double as the acceptance test (engine rendering vs the cantor's take, word-aligned, ISMIR-2011 style).

---

## 6. What differs in the text pipeline for Torah [C unless marked]

`hebrew-text-pipeline.md` §1 already covers codepoint classes, maqaf, legarmeh vs paseq, pisqa/petuchah/setumah, the divine name and ketiv/qere, all of which behave the same in the Torah. New or different:

1. **Dual cantillation (27 verses).** Ex 20:2–14, Deut 5:6–18, Gen 35:22 carry both systems' marks on the same words, with U+034F CGJ pinning mark order (14 CGJ in 10 verses, all here), both dagesh and rafe on the same letter (8 words), and a verse division that matches neither system (Sefaria's 20:13 holds four tachton sub-clauses that are four elyon verses, each closed by U+05C3 in the string). Section 3.2 gives the counts and the recommended hand-curated table. The generic word parser must not run on these verses unfiltered: `coverage.py`-style accent extraction yields bogus bigrams such as tipcha+pashta on one word.
2. **Poetic layout runs.** 46 verses contain runs of eight `&nbsp;` inside the verse text: Ex 15 (15 verses, the Song) and Deut 32 (31 verses, Ha'azinu). They are layout, not pauses; collapse to a space. The same eight-`&nbsp;` run follows every `{ס}` span (`mam-spi-samekh`), and `{פ}` (`mam-spi-pe`) is followed by `<br>` [V MAM doc].
3. **Pisqa be'emtza pasuq.** Ten verses have `{ס}`/`{פ}` before the verse's last token: Gen 35:22, Ex 20:13, 20:14, Ex 33:23 (with an inline note "ספק פרשה סתומה בכתר ארם צובה"), Lev 7:21, 7:27, Num 26:1, Deut 2:8, 5:17, 5:18. `fetch.mjs`'s `<span class="pisqa">` handling covers them; no melodic effect.
4. **Nun hafukha.** `<span class="mam-spi-invnun">׆</span>` at the start of Num 10:35 and the end of 10:36 (MAM places the second one before `{פ}`); strip it. Only occurrence in the Torah.
5. **Footnotes are inline.** 28 verses carry `<sup class="footnote-marker">*</sup><i class="footnote">(…)</i>` (e.g. Deut 11:21, Ex 33:23); the classes differ from the haftarah fixture's `<sup>*</sup><i class="footnote">`. Strip both before tokenising, or the note text becomes words.
6. **Large and small letters.** 14 verses use `<big>` (the first twelve printed: Gen 1:1 בְּ, Gen 5:1, Ex 34:7, 34:14, Lev 11:42, 13:33, Num 14:17, 27:5, Deut 6:4 ע/ד, 11:21, 22:6, 29:27) and `<small>` wraps both small letters (Gen 2:4 ה, Gen 23:2, Lev 1:1 א, …) **and every plain paseq**, so a parser must test the span's content. No effect on singing.
7. **Puncta extraordinaria.** 32 × U+05C4 (upper dot) in the ten Torah places (Gen 16:5, 18:9, 19:33, 33:4, 37:12, Num 3:39, 9:10, 21:30, 29:15, Deut 29:28); ignore.
8. **Ketiv/qere.** 36 `mam-kq` pairs and 31 `mam-kq-trivial` spans in the Torah; no `mam-kq-k`/`-q` velo instances; **no `mam-implicit-maqaf`** in the Torah. Same resolution rule as the haftarah doc.
9. **No ZWJ/ZWNJ** (U+200C/D) appear in the Torah text from the API.
10. **Verse count check.** `len(text)` per chapter from the v3 API matches the traditional 5,846 (Sefaria's Exodus 20 has 23 verses, Deut 5 has 30, i.e. the Jewish numbering, not KJV's 26/33).

---

## 7. hebcal data for Torah [V unless marked]

- Package: `@hebcal/leyning` **10.1.0** (npm, BSD-2-Clause, ESM only, `dist/esm/index.js`, deps `@hebcal/core ^6.13.0`, `@hebcal/hdate ^0.23.0`; `src/*.json` are wrapped into TS modules at build). Triennial readings moved to **`@hebcal/triennial`** (Daniel ruled full kriyah, so it is not needed; it would only change the aliyah-end flags). https://registry.npmjs.org/@hebcal/leyning/latest , https://github.com/hebcal/hebcal-leyning
- Functions (from `src/leyning.ts`, `getLeyningOnDate.ts`, `specialReadings.ts`, `index.ts`): `getLeyningForParsha(parsha, lang)` date-independent regular reading incl. `weekday`; `getLeyningForParshaHaShavua(ev, il, lang)` applies the special maftir/7th/haftarah overrides for a dated `PARSHA_HASHAVUA` event; `getLeyningOnDate(hdate, il, wantarray, lang)` returns the Shabbat, holiday, Rosh Chodesh/Chanukah/fast or Mon/Thu reading(s) for any date; `getLeyningForHoliday` / `getLeyningForHolidayKey` and `getLeyningKeyForEvent` (holiday keys such as `"Shabbat Zachor"`); `specialReadings2(parsha, hd, il, aliyot)` → `{aliyot, reason, haft, seph, chabad}`; `lookupParsha`, `getWeekdayReading`, `formatAliyahWithBook`, `formatAliyahShort`, `makeLeyningNames`. https://hebcal.github.io/api/leyning/
- Types: `Aliyah {k: book, b: "ch:v", e: "ch:v", v?: verses, p?: parsha number (holiday aliyot), reason?: string}`; `AliyotMap` keyed `"1"…"7"` and `"M"`; `LeyningShabbatHoliday {fullkriyah, alt?, haft, haftara, haftaraNumV?, seph?, chabad?, reason?: {["1"…"7"|"M"|"haftara"]: string}, megillah?, triHaftara?}`; `LeyningBase.type ∈ 'shabbat'|'holiday'|'weekday'`; `HaftTheme {admonition? 1–3, consolation? 1–7}`. https://hebcal.github.io/api/leyning/types/Aliyah.html
- Data: `aliyot.json` has 61 entries (54 + `Vayakhel-Pekudei`, `Tazria-Metzora`, `Achrei Mot-Kedoshim`, `Behar-Bechukotai`, `Chukat-Balak`, `Matot-Masei`, `Nitzavim-Vayeilech`), each with `fullkriyah` 1–7 + M (some with a third note element, e.g. Bereshit 5 "some sources use 4:19-26"), `weekday` 1–3, `haft`, `seph`, `chabad`, `haftTheme`; `holiday-readings.json` has 112 keys (Pesach I … Shavuot I/II … Rosh Hashana I/II, Yom Kippur incl. Mincha variants, Sukkot, Shmini Atzeret, Simchat Torah, 17 Chanukah keys, Purim, the four special Shabbatot incl. "(on Rosh Chodesh)" variants, Shabbat Shuva, Rosh Chodesh ×14, Shabbat Machar Chodesh, Yom HaAtzma'ut, fast days). Holiday aliyot are `{p, k: book number 1–5, b, e}`. [V the two JSON files in the scratchpad `data/`]
- Special-reading overrides: a matching `fullkriyah` special replaces `M` (or merges 6+7 and replaces `7`), recalculates verse counts and attaches a `reason` key (`"Shabbat Zachor"`, `"Shabbat Rosh Chodesh"`, `"Masei on Shabbat Rosh Chodesh"`, `"Pinchas occurring after 17 Tammuz"`, `"Kedoshim following Special Shabbat"`, `"Ki Teitzei with 3rd Haftarah of Consolation"`, `"Shabbat Machar Chodesh"`, `"Shabbat Shuva (with …)"`). `il=true` selects the Israel schedule (different holiday days and parashah drift).
- **So the engine's flag computation is**: for each reading the app shows, `fullkriyah[n].e` (and `M.e`) → `END_OF_ALIYAH`; `e ∈ {Gen 50:26, Ex 40:38, Lev 27:34, Num 36:13, Deut 34:12}` → `END_OF_BOOK`; the special-section ranges of §3 are static. Across all entries that is 457 verses [C]. Because hebcal's Simchat Torah reading ends Deuteronomy and restarts Genesis in one `fullkriyah`, Deut 34:12 and Gen 2:3 both get flags that day.

---

## 8. Recommendation for the engine [I]

1. One cell-table schema, two tables (`haftarah.json`, `torah.json`), same `{trope, context:{before, after, group, endOfAliyah, endOfBook, onOneWord, section}, upbeats[], core[]}` shape; `section ∈ {creation, journeyA, journeyB}` only if the cantor wants those computed rather than recorded.
2. Seed `torah.json` from §2.2's Avery/Binder column (51 cells), store degrees in Malin's F=1 frame, and let the cantor's recorded tonic set the key.
3. The flag pipeline: hebcal `fullkriyah` → `END_OF_ALIYAH` on 457 verses; the five book ends; a per-reading `decalogue: "elyon"|"tachton"` switch consuming the hand-curated 27-verse table; a `recordedWhole` list (Ex 15:1–19, Num 33:11–46 or the chosen pair, Gen 1:5 etc., Deut 1:12, the five *chazak* formulas, the blessings) that bypasses synthesis.
4. Implement the fifth end-of-aliyah pattern (etnachta→silluq, 2 verses) and confirm it with the cantor.
5. Record §5.2; render the 31-verse core; cantor pass/fail per word; then the 54; then any verse.

---

## Questions only Daniel or the cantor can answer

1. **Cantor:** Torah sof pasuk: do you end low (Binder/Avery, Portnoy-Wolff: `1, 5_`, "F down to C") or high (Kalib, Rosowsky High Silluq, Common: `3, 1`)? This is the single cell that separates the two Avery/Binder tables.
2. **Cantor:** the Ten Commandments on Yitro, Va'etchanan and Shavuot: ta'am elyon, ta'am tachton, or elyon on Shavuot only? And if tachton, the Tiberian division (Ex 20:2–3 one verse, as in MAM) or the printed one (Koren/Plaut)?
3. **Cantor:** your default munach: Binder's high `[5] 5 3 5`, Rosowsky's `[1] 3 2`, or a plain recitation note?
4. **Cantor:** do you sing a metiga-zakef cell when kadma and zakef katon share a word (156 words in the Torah), and a different zakef for monosyllables?
5. **Cantor:** kadma v'azla: the six-note Binder cell (`[1, 3] 5 3 6 5`) or the two-note Rosowsky/Common one (`[3] 6 5`)?
6. **Cantor:** end of book: do you use a distinct festive ending (Binder: silluq lands on the tonic) or the end-of-aliyah cadence on 6_? And the Creation-day refrain: the same festive ending, something else, or nothing special?
7. **Cantor:** the two aliyot that end etnachta→silluq with no tipcha (Ex 14:4, Ex 36:7): what do you sing there?
8. **Cantor:** which special melodies do you actually use at CRC: Song of the Sea (which tune), Journeys (Num 33), the Chiefs (Num 10:15–27), Deut 1:12 in Eicha trope, *chazak*, and do you read זֵכֶר twice in Zachor? Each "yes" is a whole-passage recording, not a cell.
9. **Cantor:** will you record the Song of the Sea and the Decalogue as complete passages (about 10 minutes together)?
10. **Daniel:** CRC's Shabbat practice vs hebcal's seven aliyot: if CRC reads one to three aliyot with its own cut points, the `END_OF_ALIYAH` flag should come from CRC's cut points, not hebcal's (hebcal's remain the default). Do we need a per-week override now or later?
11. **Daniel:** Simchat Torah and festival Torah readings: in scope for the Torah engine from the start, or weekly Shabbat only?
12. **Daniel:** may the 27-verse Decalogue table be derived from the Wikisource MAM pages (CC BY-SA 4.0) and shipped under that licence alongside the cell table?
