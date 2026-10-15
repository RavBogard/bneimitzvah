# The musical grammar of Eastern Ashkenazi haftarah cantillation, as a computable spec

Researched 2026-10-15. Builds on `../2026-10-15-web-2-0/chant-audio.md` section 2(d) (the "compute the melody from the te'amim, then voice it" path). Nothing in the repo was changed; scratch scripts and extracted data live in the session scratchpad (`C:\Users\dsbog\AppData\Local\Temp\claude\C--Users-dsbog-haftarah\a7f4aefe-3700-425e-87ab-0020f95626f2\scratchpad\`).

**Tags.** `[V]` verified against a source (URL given). `[C]` computed by me in this session from Sefaria's *Miqra according to the Masorah* (MAM) text and hebcal-leyning ranges; scripts named below. `[I]` inferred: my reading of several sources, or a design proposal. Where teachers disagree I say so and add the question to the final list.

**Bottom line.** The grammar is small and fully rule-based. One Eastern Ashkenazi haftarah style (the "Binder/Avery (Reform Standard)" table that TropeTrainer shipped) is **44 melodic cells** (trope × musical context), each a 1–12 note cell with 0–2 "upbeat" (pre-tonic) notes. Syllable fitting follows three rules (omit upbeats when the stress is on the first syllable; repeat the first upbeat when there are more pre-tonic syllables than upbeats; a mil'el word gets the cell's last note on its post-tonic syllable). The three rare te'amim of the Torah (shalshelet, karnei farah, yerach ben yomo) **never occur in any haftarah** [C], so the engine needs no melody for them. A recording plan of **about 135 neutral-syllable units (~10 min of audio) plus a 39-verse real-word calibration corpus (586 words, ~12 min) plus the two blessings** covers every cell, every context and every rare trope that the haftarah cycle contains, in roughly **2–3 hours of studio time**.

---

## 1. Inventory of the te'amim of the 21 prose books

Unicode codepoints, type and rank are from Wikipedia's *Hebrew cantillation* tables [V] https://en.wikipedia.org/wiki/Hebrew_cantillation ; placement exceptions (prepositive/postpositive) from Malin 2016 n.21 and Jacobson 2002 p.418 as cited there [V] https://jewish-music.huji.ac.il/media/2302/download/ . Counts are mine [C] (`count_teamim.py`): all 21 prose books of Nevi'im = **9,296 verses, 121,610 words**; the weekly Ashkenazi haftarah set from hebcal-leyning `aliyot.json` = **1,217 verses, 15,299 words** (the earlier report said 1,239; hebcal's `haft` field is what I used); weekly + holiday/special haftarot (`holiday-readings.json`) = **1,739 verses, 22,068 words**.

| Ta'am | U+ | Type / rank | Placement | Nevi'im | per 1000 words | weekly haftarot | weekly+holiday |
|---|---|---|---|---|---|---|---|
| sof pasuk / silluq | U+05C3 (׃ marker); the silluq itself is U+05BD under the last word in MAM | disjunctive, 1st (emperor) | stressed syllable | 9,294 | 76.4 | 1,217 | 1,739 |
| etnachta | U+0591 | disjunctive, 1st | stressed | 8,931 | 73.4 | 1,190 | 1,703 |
| zakef katan | U+0594 | disjunctive, 2nd (king) | stressed | 13,728 | 112.9 | 1,715 | 2,491 |
| zakef gadol | U+0595 | disjunctive, 2nd | stressed | 817 | 6.7 | 108 | 152 |
| tipcha | U+0596 | disjunctive, 2nd | stressed | 18,203 | 149.7 | 2,403 | 3,437 |
| segol | U+0592 | disjunctive, 2nd | **postpositive** (last letter; MAM adds a 2nd segol on the stressed syllable when they differ) | 477 | 3.9 | 58 | 90 |
| shalshelet | U+0593 | disjunctive, 2nd (segol's substitute) | stressed; always followed by paseq | **2** (Isa 13:8, Amos 1:2) | 0.02 | **0** | **0** |
| revia | U+0597 | disjunctive, 3rd (duke) | stressed | 4,807 | 39.5 | 552 | 835 |
| zarka | **U+05AE** (U+0598 is "tsinnorit", misnamed; MAM uses U+0598 only as the secondary mark on the stressed syllable) | disjunctive, 3rd | **postpositive** | 431 (+90 secondary U+0598) | 3.5 | 55 | 82 |
| pashta | U+0599 | disjunctive, 3rd | **postpositive**; doubled on the stressed syllable of a mil'el word | 13,474 | 110.8 | 1,730 | 2,502 |
| yetiv | U+059A | disjunctive, 3rd (pashta's substitute) | **prepositive** (before the first letter) | 642 | 5.3 | 71 | 108 |
| tevir | U+059B | disjunctive, 3rd | stressed | 3,855 | 31.7 | 465 | 662 |
| geresh | U+059C | disjunctive, 4th (count) | stressed (on a mil'el word; U+059D geresh muqdam is poetic-books only: 0 here) | 2,275 | 18.7 | 234 | 347 |
| gershayim | U+059E | disjunctive, 4th | stressed | 878 | 7.2 | 104 | 149 |
| telisha gedola | U+05A0 | disjunctive, 4th | **prepositive** (first letter; MAM doubles it on the stress) | 1,079 | 8.9 | 124 | 171 |
| pazer | U+05A1 | disjunctive, 4th | stressed | 421 | 3.5 | 41 | 61 |
| karnei farah | U+059F | disjunctive, 4th (pazer's substitute) | stressed | **6** | 0.05 | **0** | **0** |
| munach legarmeh | U+05A3 + paseq U+05C0 | disjunctive, 4th | stressed | 913 paseq in Nevi'im; 101 / 146 in corpus | 7.5 | 101 | 146 |
| munach | U+05A3 | conjunctive | stressed | 18,313 | 150.6 | 2,249 | 3,253 |
| mahpach | U+05A4 | conjunctive | stressed | 6,544 | 53.8 | 860 | 1,238 |
| mercha | U+05A5 | conjunctive | stressed | 14,643 | 120.4 | 1,908 | 2,724 |
| mercha kefula | U+05A6 | conjunctive (tevir's substitute) | stressed | **5** (1 Ki 10:3, 1 Ki 20:29, Ezek 14:4, Hab 1:3, **Zech 3:2**) | 0.04 | **1** (Zech 3:2, Beha'alotcha / Chanukah) | 1 |
| darga | U+05A7 | conjunctive | stressed | 1,551 | 12.8 | 180 | 260 |
| kadma | U+05A8 | conjunctive (same glyph as pashta; sits on the stressed syllable, not the last letter) | stressed | 3,770 | 31.0 | 403 | 602 |
| telisha ketana | U+05A9 | conjunctive | **postpositive** (MAM doubles it on the stress) | 1,244 | 10.2 | 151 | 217 |
| yerach ben yomo | U+05AA | conjunctive (always precedes karnei farah) | stressed | **6** (Josh 19:51, 2 Sam 4:2, 2 Ki 10:5, Jer 13:13, 38:25, Ezek 48:21) | 0.05 | **0** | **0** |
| meteg (not a ta'am) | U+05BD | stress/secondary-stress mark; **MAM uses the same codepoint for silluq** | | 15,548 incl. 9,294 silluqs | | | |

Rank is the four-level "emperor/king/duke/count" scheme (Wikipedia) [V]; Malin and Jacobson use D1/D2/D3 with "f" for the final disjunctive of a level [V]. Poetic-book accents (ole, iluy, dechi, atnach hafukh, geresh muqdam, tsinnorit) have **zero** occurrences in Nevi'im [C].

**Things that matter for the engine** [C, V]:
- MAM's version notes say it adds an extra accent in the proper place "when an accent is marked in an unstressed syllable (*pashta*, *zarqa*, *segol*, *telisha*)" and visibly distinguishes legarmeh from paseq [V] (Sefaria `versionNotes`, https://www.sefaria.org/api/v3/texts/Obadiah%201?version=hebrew%7CMiqra%20according%20to%20the%20Masorah ). So **the stressed syllable of every word is readable from the text** without a lexicon: for the postpositive/prepositive marks, take the second (inner) mark; for all others, the mark itself. In the corpus: 376 words carry a doubled pashta, 72 a doubled telisha gedola, 40 a doubled telisha ketana, 16 a doubled zarka, 10 a doubled segol [C] (`coverage.py`).
- Words joined by maqaf (U+05BE) are one musical word (1,344 maqaf chains in the corpus) [C]; the earlier Jewish Encyclopedia / LBC rule "treated as though they were one word from a musical point of view" [V] https://lbc.ac.uk/wp-content/uploads/2024/02/Learn-to-Leyn-Offline-Version.pdf .
- Two te'amim on one word happen: 113 words carry munach+zakef katan, 28 kadma+zakef katan, 19 etnachta+mercha (really the maqaf chain), etc. [C]. TropeTrainer handles kadma+zakef on one word with a special context (`ON_ONE_WORD`), see section 5.
- The first disjunctive-frequency chart in print is Jacobson 2002 p.412 (based on Price 1996); tipcha is 24.16% of disjunctives and revia 5.98% [V, via Malin nn.49, 53]. My Nevi'im numbers agree in rank order.

---

## 2. The haftarah mode: scale, motifs, and how a motif fits a word

### 2.1 Scale and reference tone

- Haftarah trope is in **minor**, emphasizing scale degrees **1, 3 and 4**; the common verse uses the minor pentatonic (1, 3, 4, 5, 7); 2 appears only as a passing tone between 1 and 3; 6 appears as the local high point of kadma v'azla and of "munach katon", and in the end-of-reading cadence. Etnachta's fingerprint is the <1-3-5-4> melisma ending on 4; zakef katon ends on 3; **sof pasuk is the only disjunctive that ends on 1**. (Malin 2016 §3, citing Jacobson 2002 p.731, Kalib 2002, Ne'eman 1954–71.) [V] https://jewish-music.huji.ac.il/media/2302/download/
- TropeTrainer's Eastern Ashkenazi haftarah tables are all in minor: Binder/Avery and Rosowsky in D minor, "Common Melody", Chabad, Kreinces and Goldenberg in A minor, Spiro in C minor [V, extracted from `tropedef.xml`, see §5].
- The reference pitch is free ("readers may chant at any level that is comfortable", Malin); the engine should store everything as scale degrees and let the cantor's recorded tonic set the key.

Notation used below: scale degree numbers in the minor scale, `7_` = the 7th **below** the tonic, `8` = the octave, `9` = the 2nd above the octave. `[ ]` = upbeat (pre-tonic) notes. `-` inside a cell joins notes sung as a melisma on one syllable; `,` separates notes that take their own syllable (Malin's convention).

### 2.2 The syllable-fitting rules (the "how" a programmer needs)

These are stated identically by the 1906 Jewish Encyclopedia, Chani Smith's *Learn to Leyn* (LBC), Jacobson (as described by Malin and by reviewers), and by TropeTrainer's own manual and data format:

1. **Each cell has a stressed note; it must land on the word's stressed syllable.** "One of the most important principles of leyning is that the stressed note of the ta'am must coincide with the accented syllable of the word it accompanies." [V] LBC p.5–6.
2. **Pre-tonic syllables take the cell's "introductory"/"upbeat" notes.** If the word is stressed on its first syllable (or is monosyllabic) the upbeat is omitted; if there are more pre-tonic syllables than upbeat notes, "one repeats the introductory note as many times as necessary." [V] LBC p.6 examples (3)–(5). TropeTrainer: "When a word is accented on its first syllable, its trope's upbeat note is omitted." [V] *TropeTrainer Installation and User's Guide* (2003), p.27, extracted from the archive.org ISO. Jewish Encyclopedia 1906: "any syllables preceding the accented syllable are recited on a note of the trope introduced for the purpose in front of the note bearing the stress." [V] https://www.jewishencyclopedia.com/articles/3986-cantillation
3. **Post-tonic syllables (mil'el words).** "If the word has a penultimate accent, the last note is, where necessary, repeated" (JE 1906) [V]. Malin on Kalib's High Holiday etnachta: "If the final syllable of the word is unaccented, then the accented syllable is on 3 and the final syllable is on 1; the figure becomes <3-2, 1> instead of <3-2-1>" [V], i.e. the **last note of the cell is detached and given to the post-tonic syllable**; the melisma shrinks by one note. Spiro's haftarah example: on "la-mah" (mil'el) the accented syllable gets 4 and the unaccented one descends to 1 [V] Malin n.23. TropeTrainer has a per-style flag `ADJUST_HIGH_MILEIL_LAST_NOTE` for this [V, XML].
4. **Elision.** When the upbeat of a disjunctive is dropped (rule 2) and the previous word carries a conjunctive, chanters often add the dropped upbeat as an extra last note of the previous word to keep the phrase intact. TropeTrainer exposes this as an on/off option ("Enable Elision") [V, manual p.27]; LBC teaches the same for mercha + monosyllabic tipcha word (Gen 3:9) [V] LBC p.10.
5. **Missing conjunctives.** "Sometimes the munaḥ is missing from a particular sequence. In that case, the music for the munaḥ is omitted as well." [V] LBC p.10. The disjunctive's melody is unchanged.
6. **Rhythm is free.** Jacobson notates eighths/quarters/halves as approximate; Malin omits rhythm as "a variable feature of oral practice"; Binder, Portnoy/Wolff and TropeTrainer notate it precisely [V] Malin n.20. TropeTrainer's `ASSIMILATE_RHYTHM="True"` on all haftarah styles means durations are stretched to the syllable count [I from attribute name + manual].

[I] Encoding: a cell = `{upbeats: [deg...], core: [deg...], stressIndex: 0}` where the stressed note is the first core note. A word = `{pre: p, post: q}` syllables. Output = `repeat(upbeats[0], max(0, p-len(upbeats))) + upbeats[-p:] (if p>0) + core[:-q] as melisma on the stressed syllable + core[-q:] on post-tonic syllables`. That reproduces every example in the sources above.

### 2.3 The cells: Binder/Avery "Reform Standard" (D minor), with Rosowsky and "Common Melody" variants

Source: TropeTrainer 3.2 (2005) `tropedef.xml`, `TROPEDEF NAME="Ashkenazic - Binder/Avery (Reform Standard)" TYPE="Haftarah" KEY="D MINOR"`, described in the file as "A simplified version of the traditional melody of East European origin ... This melody is the current standard for the Reform movement." [V] extracted from https://archive.org/details/Trope_Trainer_Kinnor_Software_Inc._Version_3.2_2005 (Data1.cab inside the ISO). Pitch letters converted to D-minor degrees by me; TropeTrainer durations (`DURATION=n` ≈ a 1/n note; 4 = quarter, 8 = eighth, 10/12 shorter, 3/6 longer) [I] are given only where they mark a held note. The Rosowsky column is the same file's `Ashkenazic - Rosowsky` haftarah table (D minor, "a traditional melody of East European origin"); the "Common" column is `Ashkenazic - Common Melody` (A minor, "A common and traditional East European melody").

| Cell (trope, context) | Binder/Avery (Reform Standard) | Rosowsky | Common Melody | Malin / other sources |
|---|---|---|---|---|
| **sof pasuk** (silluq), normal verse | [7_, 1] 3, 1 (last note held) | [5] 3, 1 | [5] 3, 1 | Spiro approaches 1 from 7_ below; Kalib uses the <5, 3-1> arpeggio; Kalib also lists <3,7,1> and <7,7,3-1> [V] Malin §4, n.46 |
| mercha before sof pasuk | [7_] 7_ | [4] 5 | [5] 5 | — |
| tipcha in a sof-pasuk group | [4] 5, 3, 7_ (held) | [3] 4 | [3] 4 | "merkha-tipḥa sometimes varies depending on whether it is leading up to etnaḥta or sof pasuk" [V] Malin n.50 |
| mercha in a sof-pasuk group (before tipcha) | [1] 3 | [1] 3, 1 | [1] 3, 1 | |
| **etnachta** | [1] 3, 1, 3, 5, 4 (held) | same | [1, 3] 5, 4 | Spiro <1-3-5-4> melismatic; Kalib <1, 3, 5-4> syllabic; of 94 recorded cantors singing Isa 40:28, 93.6% use <1,3,5,4> in some form: 18% melisma from 1, 37% Kalib's, 38% <3-1-3-5-4> [V] Malin n.25 |
| munach before etnachta | [4] 3 | same | [1] 1 | |
| munach before munach (etnachta group) | [4] 4 | same | — | |
| **tipcha** (default, before etnachta) | [3] 4 (held) | same | [3] 4 | "merkha sets up a recitation tone; tipḥa begins on it, ascends on the accented syllable"; haftarah version "moves up and does not return", 1 to 4 [V] Malin §10 |
| mercha (default, before tipcha) | [1] 3, 1 | same | [1] 3, 1 | |
| **zakef katon** | [4] 5, 3 | same | [4] 5, 3 | ends on 3 [V] Malin |
| munach immediately before zakef katon | [4] 4, 1, 6, 5 | same | [1] 6, 5 | "6 as a local highpoint in the melismatic figure for munaḥ katon" [V] Malin n.24 |
| munach elsewhere in a katon group (e.g. before mahpach) | [4] 4, 3, 4, 5, 4 | same | [1] 1, [1] 1 | |
| pashta | [1] 5, 4 | same | [1] 5, 4 | |
| double pashta (mil'el word) | first mark [1] 5; second mark 4 | same | [1] 5 / 4 | i.e. the same cell with its last note moved to the post-tonic syllable, exactly rule 3 |
| mahpach | [4] 4, 1 | same | [4] 4, 1 | Spiro: 4 then skip to 1 [V] Malin n.23 |
| kadma (before mahpach/pashta) | [1] 4 | same | [1] 5, 4 | "before mahpach pashta the kadma sounds just like pashta" [V] https://e-ark.net/haftorah-trope/ |
| kadma before azla/geresh | [1] 4 (same cell) | same | [1] 4 | |
| mercha before pashta / legarmeh | [1] 1 | same | [1] 1 | |
| yetiv | 4, 8, 4 (no upbeat; the word is stressed on its first syllable by definition) | 5, 4 | 6 | |
| **revia** | [4] 4, 3, 2, 1, 3, 1 (held) | same | [4] 4, 3, 2, 1, 3, 1 | "R'vi-i in general moves down in a scalar pattern, sometimes with an extra jog at the end" [V] Malin §11 |
| munach before revia | [4] 8, 4 | [1] 4 | [1] 1 | |
| munach legarmeh | [1] 1, 2, 3, 1, 4 | same | [1] 4, 4♭, 4, 5, 4 | |
| **tevir** | [4] 1, 7_, 1, 3 (held) | same | [4] 1, 7_, 1, 3 | |
| darga (before tevir) | [4] 7, 6, 5, 4 | same | [4] 7, 6, 5, 4, 5, 4 | |
| mercha before tevir | [4] 7, 4 | same | [1] 3, 1 (no special cell) | LBC: "merkha before tipḥa is sung differently from a merkha before t'vir" [V] |
| mercha kefula | [4] 4, 5, 6, 7, 6, 5, 4 | same | = tevir cell | |
| **kadma v'azla** (azla) | [5] 6, 5, 4, 8, 4 | [5] 6, 5, 4, 7, 4 | [5] 6, 5, 4, 7, 4 | 6 as high point [V] Malin n.24 |
| geresh | [1] 4, 5, 6, 5, 7, 6, 5, 4, 5, 4 | = azla | = azla | after kadma the upbeat becomes [4] (B/A) |
| gershayim | [1] 1, 4, 5, 6, 4, 6 (held) | [4] 4, 3, 4, 6 | [1] 4, 4♭, 4, 5, 4 | |
| munach before geresh / zakef gadol | [1] 1 | same | [1] 1 | |
| munach before gershayim, telisha, pazer | [1] 4, 3 | [1] 4 | [1] 1 | |
| zakef gadol | [1] 5, 3, 1, 4, 3 (held) | [4] 7, 4, 1, 4, 3 | [4] 6, 5, 4, 3 | |
| telisha ketana | [1] 4 (held), 3, 4, 5, 3, 1 | [1] 2, 3, 2, 1 | [4] 1, 2, 3, 2, 3 | "Telisha Ketanah has 5 differentiated notes, Telisha Gedolah has 7" [V] e-ark.net |
| telisha gedola | [1] 1, 2, 3, 4, 3, 2, 1 | same | [4] 1, 2, 3, 2, 3, 1 | |
| pazer | [1] 4, 5, 6, 7, 8, 7, 6, 5, 4, 5, 4 | [1, 2] 4, 5, 6, 5, 7, 6, 5, 4 | [1] 4, 5, 6, 5, 7, 6, 5, 4, 5, 4 | |
| **zarka** | [4] 5 (long), 4, 3, 2, 1, 2, 7_ | [4] 4, 3, 2, 1, 2, 7_ | [4] 4, 3, 1, 3, 1 | |
| munach before zarka | [1] 4 (long) | same | [1] 1 | |
| **segol** | [3] 5 (held), 4 | [4] 4, 3, 4, 5, 4 | [1] 4, 3, 5, 4 | |
| munach before segol | [7_] 3 | same | [1] 1 | |
| munach before munach (segol group) | [7_] 7_ | same | — | |
| **end of haftarah** tipcha | [6] 6, 5, 4, 3, 4, 3 | [6] 6, 3 | [4] 4, 7, 4 | Malin: haftarah end-of-section melodies "cadence on the relative major (III)" and link to the blessing's key [V] §11 |
| end of haftarah mercha before tipcha | [3] 6 | [3] 6 | [4] 7 | |
| end of haftarah mercha before silluq | [3] 3 | [3] 6 | [5] 5 | |
| end of haftarah silluq | [4] 5, 7, 8, 7, 6 (held) | [6] 6, 5, 4, 3, 4, 3 | [5] 5, 4, 5, 4 | the three tables end on 6, 3 and 4 respectively: **teacher variance; ask the cantor** |
| shalshelet, karnei farah, yerach ben yomo | *empty* | *empty* | *empty* | TropeTrainer shipped no haftarah melody for them, consistent with their zero count in haftarot [C] |

Reading the table: it is 44 distinct melodic cells in Binder/Avery (I counted distinct note strings, not contexts; several contexts share a cell). Jacobson's set, as taught on Cantor Sarah Bolts's site, is organised the same way: 66 numbered phrases across etnachta (4), siluk, zakef-katon (18 patterns, nos. 11–28, incl. "metiga-zakef" = kadma+zakef on one word), yetiv, zakef-gadol, tevir, revia, segol, geresh, gershayim, telisha-gedola, pazer, final siluk (4, nos. 63–66) [V] https://sarahbolts.com/trope/haftarah-trope/ , https://sarahbolts.com/trope/haftarah-trope/zakef-katon-phrases-haftarah/ , https://sarahbolts.com/trope/haftarah-trope/final-siluk-phrases-haftarah/ . That site offers each phrase in two melody sets, "Jacobson" and "Binder/Avery (B'nai Israel)", which is the same split as TropeTrainer's tables. JTS teaches ten haftarah phrase groups (Cantor Sarah Levine) [V] https://www.jtsa.edu/torah/cantillation-for-haftarah/ ; Har Shalom's booklet uses 16 lines ending with "sof-parasha" [V] https://www.harshalom.org/bmmelodies .

**How the cell stretches or compresses with word length** [I, from rules 1–4]: the upbeats absorb 0–3 pre-tonic syllables by omission/repetition; the core is sung as one melisma on the stressed syllable for a mil'ra word, or split core[:-1] + core[-1] for a mil'el word. Long cells (geresh, pazer, telisha gedola, end-of-haftarah silluq) are therefore mostly melisma whatever the word, which is why they sound "ornate". Short cells (tipcha [3] 4, mercha [1] 1, kadma [1] 4) become nearly syllabic. Teachers differ mainly in (a) whether etnachta's core is one melisma or syllabic (Spiro vs Kalib), (b) sof pasuk's approach note (7_ vs 5), (c) the end-of-haftarah cadence. Rhythm (held notes) is the least stable feature across sources.

---

## 3. Context-dependent variants, one by one

Each item below is a rule the engine must implement. "TT" = the TropeTrainer `CONTEXT` attribute that encodes it (section 5).

- **Munach before zakef vs etnachta vs revia vs segol.** Four different cells (table above). TT: `BEFORE="ZAKEF_KATON"`, `BEFORE="ETNACHTA"`, `BEFORE="REVIA"`, `BEFORE="SEGOL"`, plus `BEFORE="ZARKA"`, `BEFORE="GERESH"`, `BEFORE="GERSHAYIM"`, `BEFORE="ZAKEF_GADOL"`, `BEFORE="TELISHA_KETANA"`, and group-level `TROPE_GROUP="ZAKEF_KATON|ETNACHTA|SEGOL|PAZER|TELISHA_GEDOLA"` for a munach that is not adjacent to the disjunctive. A second munach in a row is a different cell ("munach before munach" per group) [V XML; V Wikipedia "Munach": "a second munach is occasionally inserted when the words have too many syllables" https://en.wikipedia.org/wiki/Munach ]. LBC's teaching simplification: an unlisted munach is sung as "ordinary munach" [V]. **Our lib.js already computes the group** (`BLOCK_ENDING` families), which is exactly the `TROPE_GROUP` lookup TT needs; the engine only adds the "immediately before X" test.
- **Mercha before tipcha vs before sof pasuk.** Three mercha cells in the sof-pasuk/etnachta area: default (before tipcha), "in sof-pasuk group" (mercha-tipcha leading to silluq), "before silluq". TT: `BEFORE="SILLUQ"`, `TROPE_GROUP="SOF_PASUK"` [V]. Malin n.50 confirms the variation is traditional, not an artefact.
- **Darga-tevir vs mercha-tevir.** Tevir's cell is the same; darga has its own descending cell ([4] 7 6 5 4) and mercha before tevir has a special cell ([4] 7 4) distinct from ordinary mercha [V XML; V LBC]. Corpus frequency: darga>tevir 208, mercha>tevir 168 [C].
- **Kadma vs pashta disambiguation.** Same glyph U+05A8 vs U+0599; the codepoints differ, so there is nothing to disambiguate in MAM text. Kadma sits on the stressed syllable; pashta on the last letter [V] https://en.wikipedia.org/wiki/Pashta . Kadma before mahpach-pashta sounds like pashta; before azla it is a different, shorter cell [V] e-ark.net; TT: `KADMA BEFORE="AZLA"/"GERESH"` in Common Melody.
- **Pashta doubled.** A mil'el pashta word carries two pashtas; Ashkenazim sing the pashta cell on the first (right-hand) mark and only the cell's last note on the final syllable; "Sephardim call this combination Trei-Kadmin and sing a melody on each" [V, TT `<COMMENT>` in `tropedef.xml`]. LBC: "it has become a tradition to sing the double pashta with extra notes to highlight its accent" [V]. TT models it as a pseudo-trope `DOUBLE_PASHTA` + `PASHTA AFTER="DOUBLE_PASHTA"`. 376 such words in the corpus [C].
- **"Zakef katon after pashta" / kadma+zakef on one word ("metiga-zakef").** When kadma and zakef katon share a word, zakef gets a special melody; TT `ON_ONE_WORD="TRUE"` and the lesson note "ADVANCED_ZAKEF_KATON_MELODY" [V]; sarahbolts phrase 28 "Metiga, Zakef-Katon" [V]. 28 words in the corpus [C]. Pashta>zakef (no munach between) occurs 751 times; the zakef cell does not change.
- **Tipcha-etnachta.** Tipcha's default cell; etnachta's cell is invariant (except elision of its upbeat when the word is stressed on syllable 1). tipcha>etnachta is 930 bigrams; tipcha>munach>etnachta 771 [C].
- **Yetiv.** Replaces pashta when the word is stressed on its first (or only) syllable and no conjunctive precedes it; it is prepositive and "almost never followed by mahpach" [V] LBC p.12, Wikipedia Pashta/Yetiv. Its cell has no upbeat (4, 8, 4 in B/A). yetiv>munach 92, yetiv>zakef-katan 14 [C].
- **Telisha ketana / gedola.** Ketana is postpositive and conjunctive (leads to kadma: telisha-ketana>kadma 171); gedola is prepositive and disjunctive (telisha-gedola>kadma 50, >gershayim 15) [C]. MAM doubles both on the stress, so the engine knows the stressed syllable [V]. Different cells (5 vs 7 notes).
- **Pazer.** One cell, 11 notes in B/A, usually with its own munach cell before it (munach>pazer 30; pazer>telisha-ketana 28, pazer>munach 19) [C]. No karnei-farah substitute ever occurs in haftarot [C].
- **Mahpach-pashta.** mahpach>pashta 928 [C]; mahpach has one cell. The combination mercha>pashta (52) replaces mahpach when no syllable separates the two stresses [V] Wikipedia Pashta.
- **Long/short tevir.** Not a distinction in any Eastern Ashkenazi source I found; what teachers call "short tevir" is the tevir cell sung on a short word with its upbeat dropped and the melisma compressed (rules 2–3) [I]. TT has a single tevir cell per style. Ask the cantor whether he sings two.
- **Sof pasuk vs etnachta phrase endings.** Different cells, and the mercha/tipcha before them differ (above). Also the degenerate verse with etnachta followed directly by sof pasuk (etnachta>sof-pasuk, 2 verses in the corpus, e.g. 1 Ki 18:14) [C]: both cells sung back to back, no mercha.
- **Sof haftarah (end-of-reading cadence).** Applied to the **last verse only**, to the final mercha-tipcha-(mercha)-silluq. TT's `<COMMENT>` in the Binder/Avery table states the four patterns and the allocation rule exactly: "1: Tipcha-Silluq 2: Mercha-Tipcha-Silluq 3: Tipcha-Mercha-Silluq 4: Mercha-Tipcha-Mercha-Silluq ... there are four components a, b, c, d ... Wherever the Mercha is located, it shares the niggun of the trope that follows it" [V]; TT encodes it with `END_OF_ALIYAH="TRUE"` contexts on MERCHA (`BEFORE="TIPCHA"` / `BEFORE="SILLUQ"`), TIPCHA and SILLUQ. sarahbolts "Final Siluk Phrases" lists the same four (nos. 63–66) [V]. Wikipedia: Eastern and Western Ashkenazim use "a different coda at the haftarah's end that modulates from minor to major before the blessing" [V] https://en.wikipedia.org/wiki/Hebrew_cantillation ; Malin: end-of-section melodies for haftarah "cadence on the relative major (III)" and "provide tonal links to the blessings" [V]. The corpus has 82 "last verses" (one per haftarah range; `coverage.py` marks them). Note Western Ashkenazi haftarah applies a coda to *every* verse [V Wikipedia], which is not our nusach.
- **The blessings before and after.** They are fixed liturgical texts, not trope-driven. Kol Kore: the after-blessings are long but built from three recurring patterns (opening, closing, "Baruch atah Adonai") [V] https://kol-kore.org/en/haftarah-blessings-a-guide-for-learners/ . TropeTrainer did not generate them from rules: its `HaftarahBlessing` table (Binder, G minor) is 39 hand-set per-word melodies (`V01`...`V39`) [V XML]. **Record them whole** (about 1.5–2 minutes), do not synthesize. The relative-major cadence at the end of the haftarah is what hands off to the blessing's key (Malin), so the cantor should sing the last verse and the blessing in one take so the engine learns the hand-off pitch.

---

## 4. The unit inventory and recording plan

### 4.1 Unit model [I]

A **unit** = one melodic cell sung in one syllable shape. The engine composes a verse by: parsing words (maqaf chains merged, paseq attached), reading each word's ta'am and stressed syllable from MAM, computing the context (previous/next ta'am, group from `tropePhrases`, last-verse flag), choosing the cell, then choosing the unit by the word's (pre-tonic, post-tonic) shape, and finally time-stretching the unit's syllable segments to the word's actual syllables (the chant-audio report's path 3: PSOLA/WORLD concatenation, or a DiffSinger/SVS model trained on the same data).

Syllable shapes that change the recorded audio (not just its timing): p = pre-tonic syllables ∈ {0, 1, 2+} (0 drops the upbeat, 1 uses it, 2+ repeats it, so 2+ is derivable from 1 by looping the upbeat segment) and q = post-tonic ∈ {0, 1} (mil'ra / mil'el). Three shapes per cell are enough: **(p=1,q=0), (p=0,q=0), (p=1,q=1)**; p≥2 is synthesised by repeating the first upbeat segment, and the rare q=2 (a maqaf chain whose stressed word is followed by an unstressed enclitic) by repeating the last note.

### 4.2 Counts

| Layer | Count | Basis |
|---|---|---|
| Melodic cells, one Eastern Ashkenazi style | **44** (Binder/Avery); Rosowsky 44; Common 40 | distinct note strings in `tropedef.xml` [V/C] |
| Cells that have no upbeat (yetiv) or are empty (shalshelet, karnei farah, yerach) | 1 + 3 | |
| Units = cells × 3 syllable shapes | **~130** (44×3 minus shapes that do not apply: yetiv has no p=1 shape; monosyllabic-only cells) | [I] |
| Phrase patterns a teacher would list (for a phrase-level recording instead) | 66 (Jacobson set on sarahbolts) | [V] |
| Distinct ta'am bigrams in the haftarah corpus | **157**, of which 129 occur ≥10 times and 102 ≥20 times | [C] `coverage.py` |
| Word-shape features (doubled marks, two accents on one word) in the corpus | 48 types, 6 with ≥20 occurrences | [C] |

So the thing to record is on the order of **130 units**, not the 1,900 verses of the cycle.

### 4.3 Recording time

Assumptions: a unit on a neutral syllable ("la"/"na", or better the cantor's choice of an open vowel) lasts 1.5–4 s (pazer, geresh and the end cadence are the long ones); recorded once neutral and once on a real word; three takes average; slating and breaks ×2.5.

| Item | Clips | Finished audio | Studio time |
|---|---|---|---|
| 130 units on a neutral syllable | 130 | ~6 min | ~35 min |
| the same 44 cells on real words, via the calibration verses below (every cell and every frequent context appears in them) | 39 verses, 586 words | ~12 min at PocketTorah's 18.7 s/verse pace (chant-audio.md §3) | ~40 min |
| sof-haftarah: the 4 end patterns, each followed by the opening of the after-blessing | 4 | ~1.5 min | ~10 min |
| blessings before and after (Shabbat; festival variant optional) | 2–3 | ~2 min | ~10 min |
| rare te'amim outside the haftarah corpus (optional, for "any verse in the Prophets"): shalshelet (Isa 13:8, Amos 1:2), karnei farah + yerach ben yomo (Josh 19:51 or Ezek 48:21), remaining mercha kefula (1 Ki 10:3, 20:29, Ezek 14:4, Hab 1:3) | 4–6 verses | ~2 min | ~10 min |
| slow-tempo duplicate of the 44 cells for the learner drill (not needed by the engine) | 44 | ~3 min | ~15 min |
| **Total** | | **~25–27 min** | **~2–2.5 h** (one session, two with breaks) |

This is consistent with the "trope-family drill set, 2–4 h" line in chant-audio.md §3, and it is the whole engine input. Everything else (any verse, any week) is computed.

### 4.4 Calibration / validation corpus [C]

`coverage.py` tokenises every verse of the weekly + holiday haftarah corpus (1,739 verses), extracts the ta'am sequence (maqaf chains merged, munach+paseq = legarmeh, doubled marks and multi-accent words flagged, last verse of each haftarah flagged), and greedily picks the fewest verses that cover every feature.

**Core set, 20 verses (331 words): covers all 23 ta'am types present in haftarot and every bigram and word-shape that occurs ≥10 times (129 features).** Seeds: I Sam 20:18 (the example in the brief) and Zech 3:2 (the corpus's only mercha kefula).

I Samuel 20:18 · Zechariah 3:2 · Jeremiah 9:23 (last verse of a haftarah; segol>yetiv) · Isaiah 66:20 (pazer>pazer, munach+pazer on one word) · Zechariah 14:2 (mercha+zarka on one word) · I Kings 6:6 · I Kings 7:48 · I Samuel 20:25 · Isaiah 7:3 · Obadiah 1:1 · Judges 5:11 (etnachta+tevir and zakef+mahpach on one word) · II Samuel 7:6 (zakef>telisha gedola) · Isaiah 6:2 · I Kings 18:4 · Jeremiah 1:18 · Judges 5:4 (zakef+munach on one word) · Joshua 2:19 (darga+tevir on one word) · II Samuel 22:26 (4 words; a short verse for the no-conjunctive case) · Judges 13:6 · I Kings 18:36.

**Full set, 39 verses (586 words): covers everything that occurs ≥3 times (171 features).** The 20 above plus: Judges 5:17, II Kings 23:3 (revia>geresh), Judges 5:16, I Kings 19:8 (etnachta>geresh), II Kings 4:23, Isaiah 58:6, Malachi 3:15, Judges 11:27, Jeremiah 46:28 (last verse), I Kings 5:32, Judges 5:19, I Samuel 12:7, Ezekiel 37:11 (segol>zakef gadol), Jeremiah 46:27, I Kings 18:26, I Kings 1:25 (segol>telisha ketana), II Samuel 22:47, Jeremiah 8:18, II Samuel 6:12, Hosea 12:14, Ezekiel 1:25 (zakef gadol>zakef gadol), II Samuel 22:7, Ezekiel 1:9, Jonah 1:2, I Kings 19:7, Ezekiel 1:10, I Kings 18:6, Amos 9:14, I Samuel 15:16. (A 74-verse set covers every single feature including one-offs; not worth the cantor's time, since one-off word shapes are handled by the general rules.)

Add for the rare marks that never occur in haftarot (only if "any verse in the Prophets" is a goal): Isaiah 13:8 and Amos 1:2 (shalshelet), Joshua 19:51 (karnei farah + yerach ben yomo), I Kings 10:3 (mercha kefula). The verse lists are also the acceptance test: the engine's rendering of each verse is compared to the cantor's take (pitch contour per word via the ISMIR-2011 style alignment in §6).

**Caveat on selection.** hebcal's ranges are the traditional Ashkenazi haftarot. If CRC reads shorter or alternative passages (chant-audio.md Q5), the cells and units are unchanged; only the "last verse" flag moves.

---

## 5. How TropeTrainer (Kinnor Software, Thomas Buchler) encoded it

Everything in this section is verified by extracting the data from the 2005 v3.2 installer preserved at https://archive.org/details/Trope_Trainer_Kinnor_Software_Inc._Version_3.2_2005 (ISO → `Data1.cab` → 20 files; `expand.exe` opens the cab). This confirms the Hacker News description by user *jes5199* ("an XML file that describes the musical notes for different tropes (in several traditions)", "an INI file mapping Hebrew letters to DECtalk phonemes", "very gnarly hand-written logic for Hebrew pronunciation rules", Delphi then Xojo) [V] https://news.ycombinator.com/item?id=35401895 . The user guide (`TRO_000C.PDF` on the ISO) and Inverse's feature [V] https://www.inverse.com/input/features/tropetrainer-thomas-buchler-torah-software supply the rest. Note: the XML is Kinnor's copyrighted data; it is cited here as a reference design, not as something to ship.

**Data files.** `tropedef.xml` (1.04 MB, 26,994 lines): all melody tables. `tropedef_megillot.xml` (350 KB). `tropenames.xml`: trope names per naming tradition ("ASHKENAZ-ACADEMIC NAMES", "ASHKENAZ-COMMON NAMES", Sephardic) with Hebrew in a Michigan-Claremont-style transliteration. `phonemes.ini`: per-pronunciation (U.S. Sephardi, Ashkenazi, ...) map from Hebrew letter/vowel to DECtalk phoneme and to Latin transliteration, e.g. `Chet=~ cz|kh`, `Ayin=~ q <3,>|\``, `ShvaNa=~ eh|"`. `tan.ett`/`tex.ett`: the Tanakh text (derived from BHS = Leningrad Codex, per the manual). `sedrot.xml` / `custom_sedrot.xml`: reading ranges. `training.xml`: lesson sequence (e.g. "Trope Upbeats and Melodies", "Words accented on their next-to-last syllable"). `dtalk_us.dic`: DECtalk dictionary.

**Melody schema** (`tropedef.xml`): 45 `TROPEDEF` tables (Torah 20, Haftarah 11, High Holiday 5, Megillot/Eicha, blessings, Tehillim). Attributes: `NAME`, `TYPE`, `ENCODING` (which name set), `KEY` ("D MINOR"), `PITCHBEND` (semitone offset so all styles play in a comfortable register), `ASSIMILATE_PITCH`, `ASSIMILATE_RHYTHM` (True on every haftarah style), `TRUNCATE_EXTRA_UPBEATS`, `ADJUST_HIGH_MILEIL_LAST_NOTE`, `DESCRIPTION`, plus `LESSON_NOTES` text with `%TROPE%` placeholders. Each `TROPE` has one or more `CONTEXT` blocks selected by attributes: `DEFAULT`, `BEFORE=`, `AFTER=`, `BEFORE_BEFORE=`, `AFTER_AFTER=`, `TROPE_GROUP=`, `END_OF_ALIYAH=TRUE` (the haftarah-end cadence), `END_OF_BOOK=TRUE`, `ON_ONE_WORD=TRUE`, `MONOSYLLABIC=TRUE`, and text-specific `SONG_OF_MOSES=`, `IN_CREATION_DAY=TRUE`, `IN_JOURNEY=1|2`. Across the file: 1,462 default contexts, 142 `END_OF_ALIYAH`, 121 `BEFORE=SILLUQ`, 93 `BEFORE=MUNACH`, 82 `BEFORE=TIPCHA`, 67 `BEFORE=ZAKEF_KATON`, 59 `BEFORE=ETNACHTA`, 53 `AFTER=MUNACH`, 52 `BEFORE=ZARKA`, 44 `BEFORE=TEVIR`, 43 `AFTER=DOUBLE_PASHTA`, 33 `BEFORE=SEGOL`, 31 `BEFORE=REVIA`, 28 `AFTER=KADMA`, 26 `BEFORE=MUNACH_LEGARMEH` ... (counts from my parser). Each context holds `NOTE PITCH="g" DURATION="8" UPBEAT="TRUE"`: pitch letters with case for octave and `-` for flat, duration as a note-value divisor (3, 4, 6, 8, 10, 12, 16, 18 all occur), `UPBEAT` marking the pre-tonic notes (2,892 of 10,446 notes), and a rare `EXTRA` flag. **This is the same cell/upbeat/core model as §2.2**, and the `BEFORE`/`AFTER`/`TROPE_GROUP` vocabulary is the complete list of contexts the engine needs.

**Rendering.** Hebrew → phonemes (hand-written rules for dagesh, shva na/nach, etc., based on "a great majority of traditional grammarians", per the manual) → per-syllable DECtalk phoneme strings with pitch and duration ("just strings of ascii phoneme names and pitch and duration information", jes5199). DECtalk engineer Stacey Schnee: plain pitch control was not enough, "that's not how you sing Torah trope"; she and Edward Bruckert added pause types and later a dedicated Hebrew phoneme set [V] Inverse. Cantor Neil Schwartz notated melodies and converted notation to DECtalk code [V] Inverse.

**User-adjustable parameters** (manual pp.6, 19–21, 27): melody style per reading type (with "Melody Help" descriptions and advice to consult your cantor); pronunciation/accent (modern Sephardi or Ashkenazi with a U.S. accent, plus regional); voice (bass, baritone, tenor, alto, soprano, child); key/pitch ±12 semitones; speed 1–10 ("10 is similar to what an experienced Baal Korei might read at; 5 is useful for beginners"); volume; trope-group colour highlighting; and the **Enable Elision** checkbox described in §2.2. Special-melody readings (Devarim and Tisha b'Av haftarot in Eicha trope) can be toggled.

**Styles relevant to CRC** (haftarah tables in the 2005 file): Ashkenazic Common Melody (A minor), Rosowsky (D minor), Binder (D minor), Binder/Avery (Reform Standard) (D minor), Binder/Avery Mod 2, Chabad (A minor), Spiro (C minor), Grob (F major), Kreinces (A minor), British (F major), Urstein (E♭ major), Goldenberg (A minor). The successor web product lists 8 haftarah voicings: Avery/Binder, British, Common Melody, Chabad, Rosowsky, Moroccan, Syrian, Spanish & Portuguese [V] https://www.tropetrainer.com/voicing . "Avery/Binder" is the Reform standard; **the question for Cantor Finkel is whether he sings Binder/Avery, Rosowsky/Spiro (JTS-Conservative lineage), or Jacobson's notation**, since the cells differ in the places flagged in §2.3.

---

## 6. Analytic and computational literature; datasets

- **van Kranenburg, Biró, Ness, Tzanetakis, ISMIR 2011**, "A Computational Investigation of Melodic Contour Stability in Jewish Torah Trope Performance Traditions" [V] https://webhome.csc.uvic.ca/~gtzan/ismir2011chant_gtzan.pdf . Data: two recordings of the same Torah passage (one catalogued Hungarian/Ashkenazi, "the trope melody and pronunciation correspond more to Italian practices"; one Moroccan), manually segmented into te'amim by the domain expert; about 130 realisations of each ta'am, 12 distinct te'amim; audio at `cantillion.sness.net/ismir2011`. Method: SWIPEP f0 at 10 ms, pitch in cents, scaled between the two most prevalent pitches of the recording, then **Needleman-Wunsch alignment** with a musically-motivated substitution score (gap penalty 0.6) instead of DTW. Result: mean average precision 0.644 (Hungarian) vs 0.309 (Moroccan); per ta'am in the Hungarian reading sof pasuq 0.994, revia 0.967, etnachta 0.945, pashta 0.683, tipcha 0.673, katon 0.562, mapach 0.550, mercha 0.530, zakef 0.231, munach 0.179, kadma 0.040. Lesson for us: disjunctives are stable and retrievable from contour; short conjunctives are not, which is one reason to record conjunctives in context rather than in isolation. Their 2014 ICMC/SMC overview reused this as the paradigm for computational ethnomusicology.
- **Ben-Shalom, Keshet, Yeger-Granot, CIM14 (Berlin, 2014)**, "Automatic Analysis of Music: Performance of Cantillation Signs in Yemenite Jewish Traditional Cantillation" [V] https://keshet.net.technion.ac.il/files/2022/05/BenShalomKeYe14.pdf . Hebrew University musicology + Bar-Ilan CS (the PDF is merely hosted at Technion). Yemenite Torah reading, two readers, **forced alignment adapted from speech ML** to locate every word, then analysis of one sign only, sof pasuq: readers vary the finalis pitch to divide the text into sections. Preliminary; no release.
- **Yonatan Malin, Yuval 10 (2016)**, "Eastern Ashkenazi Biblical Cantillation: An Interpretive Musical Analysis" [V] https://jewish-music.huji.ac.il/media/2302/download/ . The best single analytic source for our nusach: scale-degree analysis of all six modes with audio by Cantor Elizabeth Sacks; tabulates variants (Spiro, Kalib, Binder, Portnoy/Wolff, Jacobson, Ne'eman); n.25 counts 94 recorded etnachtas from the American Cantorate archive. Cites **Ne'eman 2012** (Hebrew U PhD), "a rigorous, computational study of variability ... the Ashkenazi tradition is the least variable ... readers typically maintain a consistent contour and final pitch" [V].
- **Patents (Abramovitz & Stiebel, priority 2011):** US 10,565,997 "Methods and systems for teaching a Hebrew Bible trope lesson" (recorded human chant, word-boundary playback, forced alignment, pitch-pattern identification; expired for fees) [V] https://patents.google.com/patent/US10565997B1/en ; US 10,019,995 (synthesised chant of trope *names* with adjustable pitch) and US 11,380,334 / 11,062,615 (remote learning). Teaching tools, not melody models; worth knowing they exist, but nothing in them blocks a rules + concatenation engine (the TropeTrainer design predates them by a decade).
- **Hobby/open code:** `kylemath/cantillate` (GitHub, 2025–26) [V] https://github.com/kylemath/cantillate : hand-drawn Torah and haftarah motif tables as (time, semitone) contours; `data/haftarah-shapes.json` = per-accent "most representative recorded instance" and median duration **measured from PocketTorah's haftarah recordings**; `trope-index.json` = every recorded verse with mp3, word onsets and one accent per word; pitch via autocorrelation. Its haftarah contours are measured, not canonical, and it has no syllable-fitting rules; but it shows the measurement pipeline works on PocketTorah audio.
- **2015–2026 ML work on generating te'amim melodies: none found** after four targeted searches (arXiv/ISMIR/Interspeech, "cantillation", "trope", "te'amim", neural/synthesis). Adjacent: Ethiopian Orthodox chant dataset for generation (arXiv 2412.18788, 2024) and Quranic recitation assessment (arXiv 2305.06429) [V]. The field is open; TropeTrainer's rule engine remains the state of the art for synthesis.
- **Datasets of chanted haftarah with aligned text:** PocketTorah (54 weekly haftarot, 387 min, CC BY-SA; chant-audio.md §3) plus cantillate's word-onset index built on it [V]; the American Cantorate archive (Slobin 1984–86, wesscholar.wesleyan.edu/sung/: many cantors on the same verses, incl. Spiro on Isa 40:27–28) [V via Malin]; the ISMIR-2011 pair of segmented Torah recordings. Nothing is nusach-labelled at the cell level; our own 39-verse corpus would be the first.

---

## 7. What this means for the engine (recommendation) [I]

1. Keep `tropePhrases()` as the group parser; add a word parser that returns `{taamim[], stressSyllable, preTonic, postTonic, maqafChain, legarmeh}` from MAM (doubled marks give the stress for free).
2. Encode cells as JSON in the TropeTrainer shape (`{trope, context:{before, after, group, endOfReading, onOneWord}, upbeats[], core[]}`), scale degrees, with the Binder/Avery table of §2.3 as the seed and the cantor's corrections overriding it cell by cell.
3. Implement rules 1–5 of §2.2 and the four-pattern end cadence of §3.
4. Record §4.3; render the 39 verses; have the cantor mark each word pass/fail; fix cells until the 39 pass; then open "any verse".
5. Validate numerically with the ISMIR-2011 method (f0 → scaled pitch → Needleman-Wunsch per word) so later changes do not regress.

---

## Questions only Daniel or the cantor can answer

1. **Cantor:** which table is yours: Binder/Avery (Reform standard, Portnoy/Wolff *Art of Cantillation* vol. 2), Rosowsky/Spiro/JTS, Jacobson's notation, or a family tradition? Concretely, sing these and we will know: (a) sof pasuk, approached from 7 below ([7_,1] 3 1) or from 5 ([5] 3 1)? (b) etnachta as one melisma <1-3-5-4> or syllabic <1, 3, 5-4>? (c) end of haftarah: does the last word land on 3 (relative major, Rosowsky), 6 (Binder/Avery), or 4 (Common)?
2. **Cantor:** munach before zakef katon: do you sing the long [4] 4 1 6 5 cell, or Common Melody's [1] 6 5, or a plain munach? And do you sing a different munach when it is the second of two?
3. **Cantor:** mercha before tevir and darga before tevir: two different cells, or the same tevir approach? Do you distinguish a "long" and "short" tevir?
4. **Cantor:** double pashta: regular pashta cell with the last note on the final syllable, or the "extra notes" tradition?
5. **Cantor:** elision on or off? (When a disjunctive's upbeat is dropped, do you add it to the end of the preceding conjunctive word?)
6. **Cantor:** which open syllable do you want to record the neutral units on ("la", "na", "da", or the trope names themselves as in the "trope song")? Trope names would double as the learner drill.
7. **Cantor:** for the four end-of-haftarah patterns, will you sing each straight into the opening of the after-blessing, so the hand-off pitch is captured?
8. **Cantor:** do you chant Devarim / Tisha b'Av haftarot in Eicha trope, and holiday haftarot with any variant? (Affects whether a second table is needed; TropeTrainer had a toggle.)
9. **Daniel:** is "any verse in the Prophets" in scope, or only the haftarah cycle? Only the former needs shalshelet, karnei farah and yerach ben yomo (6 verses in all of Nevi'im, none in a haftarah).
10. **Daniel:** do we record the traditional hebcal ranges or exactly what CRC reads (changes which verse is "last" and gets the cadence)?
11. **Daniel:** quality bar for v1: TropeTrainer-level concatenation (deterministic, clearly synthetic) or hold the public release until an SVS/RVC model trained on the same 25 minutes passes the cantor's blind test?
12. **Daniel:** may the engine's cell table be published (it will be the cantor's melodies, in numbers)? TropeTrainer's data is a reference only; ours would be CRC's and the cantor's to license.
