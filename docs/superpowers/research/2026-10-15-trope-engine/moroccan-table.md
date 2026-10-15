# Moroccan haftarah table, from Idelsohn vol. 5 no. 271

Built 2026-10-15, following Daniel's ruling that the tradition after Binder/Avery is Moroccan and comes from a published source. Companion to `nusach-tables.md` §4.2 and §8, which chose the source. Outputs: `trope/cells/haftarah-moroccan.json`, `tests/fixtures/trope/idelsohn-272-joshua-1-14.json`, `tests/trope-moroccan.test.mjs`.

Marks: **[V]** I read it in the scan myself. **[I]** my inference. **[ear]** needs a listening check against a living reader.

---

## 0. Summary

- **Source.** A. Z. Idelsohn, *Thesaurus of Oriental Hebrew Melodies* vol. 5, *Songs of the Moroccan Jews* (Harz, 1928/29), public domain. Scan: https://archive.org/details/31761125265157. No. 271 "Nĕbiim (Prophets)" (the ta'amim table) and no. 272 (Joshua 1:14 chanted) are both on **book p. 103** (scan page index 120). Idelsohn's Hebrew introduction says that 271 gives the accents "according to Fez" and that 272 is "an example of the Fez reading" (intro p. 5) [V]. The table is therefore labelled **Moroccan (Fez)**.
- **The table** has 19 cells and 3 aliases, and declares 7 te'amim as recited on the tone. 14 of the 19 cells come straight from no. 271, and 5 are filled from no. 272 where 271 is silent. The mode is D dorian, with the final on D and the reciting tone on E. Range: B3 to A4.
- **Check against no. 272.** Scored with the table, Joshua 1:14 matches Idelsohn's notation exactly on 15 of 21 words and in contour on 2 more. On the other 4 words, no. 271 prints the ta'am differently from how 272 sings it. The table follows 271 there, and a `jos272` variant reproduces 272 on 3 of those 4 words. The test enforces this.
- **Engine.** Added cell `aliases`, a per-table reciting tone with declared recitation (recited, not flagged as fallback), and `foldUpbeats`. Also `--nusach moroccan`. Nothing else changed: all 285 existing tests pass unchanged, and the suite now has 293.
- **The × mark is resolved.** In Idelsohn's notation it raises a note by about a quarter tone. It does not occur in 271 or 272.
- **Positional tevir/darga: open.** No. 271 does not distinguish mid-verse from near-the-end forms. No. 296, a different Prophets table, prints two tebir forms. See §5.

---

## 1. Provenance and legend (Hebrew introduction)

- **Book pp. 3-4** (scan 18-19) list the "Prophets mode" (נוסח נביאים) as nos. 1, 271-279 and 296-301 [V].
- **p. 5** (scan 20) [V, my translation]: "271, the accents according to Fez; 272 is an example of the Fez reading; 273-274 from Marrakesh; 275-276 from Mogador; 277-278 from Gibraltar." **This disagrees with the printed headings.** On p. 103, 273 is headed "Mode of Prophets-Gibraltar", 275 Gibraltar for the feasts, and 276 the Gibraltar Shabbat Hazon haftarah. On p. 6 the introduction calls 278 the Hazon haftarah from Fez. The introduction's numbering for 273 onward looks shifted against the printed edition. **For 271/272 the two agree**, so "Fez" is reasonably safe (medium-high).
- **p. 5, on this mode** [V]: "This mode in its Moroccan form is very restricted; altogether it moves on the tones [D, E, (G)], and it is found more developed among the London Sephardim, in a scale of a fourth above the final and a fourth below." A small staff gives D (quarter), E (half), and (G) in brackets. That is our basis for E as the reciting tone and for the `recite` block.
- **p. 6** (scan 21) groups **271, 272, 296, 297** as one type, together with the Syrian/Aleppo use of this mode for "Vattitpallel Hannah", and the Italian and Consolo "ta'amei navi" [V].
- **The × sign** (p. 5, scan 20) [V]: "G, joined to the tone above it, rises to G♯ or to G×"; and "in Morocco [these raisings are] only a quarter [tone], or at least without fixed precision, between a quarter and a half; in Europe it is raised by a half." So **× = raised by about a quarter tone** (♯ = a semitone). The scale on p. 4 shows it on the Torah mode (E final, with D×/D♯ under it). The × occurs in the Torah tables (263 pasta, 264) and **not in 271 or 272**, so the haftarah table needs no microtones. The same passage says the sixth, "when it is a third below the final", is raised in Morocco only by a quarter. In 271 that note is B3 under D, printed B♮. If a living reader's B3 sounds low, the map's `-1: -3` may want `-3.5` **[ear]**.
- The introduction also notes pronunciation: Moroccan Jews pronounce צ, שׁ and ס alike as [s] (Toledano, quoted p. 3), which is why Idelsohn transliterates *Nĕ-sê-hem*, *mô-so*. Vocal sheva, hatafim, mil'el/mil'ra and dagesh forte are kept "as the Sephardim do" [V]. See §6.

---

## 2. No. 271, "Nĕbiim (Prophets)": transcription

Treble clef, no key signature, final D. Read from a 500-600 dpi render. Noteheads were located by a staff-line and notehead detector, then every note was read by eye against it [V]. The figures are sung on Idelsohn's ta'am names, separated by double bars. Rhythm: 8 = eighth, 16 = sixteenth, 8. = dotted eighth, 4 = quarter; ~ = slur. Degrees: D = 1, 0 = C4, -1 = B3.

| # | Idelsohn's label | Notes (rhythm) | Degrees | Reading confidence |
|---|---|---|---|---|
| 1 | Zarqa | E8 A8 \| E8 F8 E8 F16 E16 D8 | 2 5 \| 2 3 2 3 2 1 | high (the 2nd note is **A**, not G as `nusach-tables.md` §4.2 had) |
| 2 | segôl | D8 E8 D8 C4 | 1 2 1 0 | high |
| 3 | qadma | G4 E4 | 4 2 | high |
| 4 | wĕazla | E8 E8 D4 C4 | 2 2 1 0 | high |
| 5 | rĕbiʿa (beneath: "z.g. u. gersaim") | E8 E8. D16 C4 | 2 2 1 0 | high |
| 6 | merḥa | E4 E4 | 2 2 | high |
| 7 | ṭifḥa | E8 E4 | 2 2 | high |
| 8 | munaḥ | E8 E4 | 2 2 | high |
| 9 | atnaḥ | D4 D4 | 1 1 | high |
| 10 | talsa | C4 E4 | 0 2 | high |
| 11 | tĕrên qadmin | E8 G8 A4 G4 E4 | 2 4 5 4 2 | high |
| 12 | tĕbir | E8 D4~C4 | 2 1 0 | high |
| 13 | merḥa (2nd half) | D8 C8 B8 | 1 0 -1 | high |
| 14 | ṭifḥa (2nd half) | C8 D4 | 0 1 | high |
| 15 | sôf pasuq | C8 D8 E4 D4 | 0 1 2 1 | high |

**What Idelsohn does not notate:** zakef katon, zakef gadol and gershayim as separate entries (the last two are merged into rĕbiʿa), pashta under that name, mahpach, darga, yetiv, pazer, telisha gedola as a separate entry, geresh under that name, munach legarmeh, mercha kefula, the three Nevi'im-only marks, conjunctive-before-disjunctive pairs (except the two halves' merḥa/ṭifḥa), and any end-of-haftarah cadence. He gives no upbeat/core split, and rhythm only as written note values.

**Label reading [V/I].** Idelsohn's Torah table 263, on the same pages, lists *pasta* (pashta), *azla*, *gêrês* and *tĕrên qadmin* separately, so his labels are not a simple Ashkenazi or Sephardi set. No. 272 settles the two that matter. Its kadma word (תַּעַבְר֨וּ) sings G G E = "qadma", and its geresh word (חֲמֻשִׁ֜ים) sings E E D C = "wĕazla". So "qadma wĕazla" is the kadma-before-geresh pair, with **qadma = U+05A8 kadma and azla = geresh** [V]. "Tĕrên qadmin" ("two qadmas") is the Sephardi name of the doubled pashta sign, so I read it as the **pashta** figure [I, low]: 271 has no other pashta entry, and 272 has no pashta word to confirm it.

## 3. No. 272, Joshua 1:14: transcription and check

The full per-syllable transcription is the fixture `tests/fixtures/trope/idelsohn-272-joshua-1-14.json` [V]. The ta'amim are MAM's (from Sefaria), which match the verse Idelsohn sets. "Table" is what the Moroccan table sings.

| Word (Idelsohn) | Ta'am | Idelsohn 272 | Table | Match |
|---|---|---|---|---|
| Nĕ-sê-hem | munach | E E E | E E E | exact |
| ta-pĕ-hem | zarka | E A EFEFED | same | exact |
| u-miq-nê-hem | segol | D E D C | same | exact |
| jês'-bu | zakef gadol | E D~C | E E D~C (je-she-vu: the engine's vocal sheva) | contour |
| ba-a-reṣ | zakef gadol | E D C | same | exact |
| ă-ser | kadma | E E | same | exact |
| na-tan | mercha | E D | same | exact |
| la-hem | tevir | E E~D~C | E D~C | contour |
| mô-so | tipcha | **C** E | E E | divergent; `tifha:jos272` reproduces it |
| bĕ-ʿê-ber | munach | **D** E E | E E E | divergent; no variant (the pre-tonic D only) |
| haj-jar-dên | etnachta | D D **C** | D D D | divergent; `atnah:jos272` reproduces it |
| wĕ-at-tem | telisha ketana | D D C~D~E | same | exact |
| ta-ʿab-ru | kadma (before geresh) | G G E | same | exact |
| hă-mu-sim | geresh | E E D~C | same | exact |
| lif-nê | munach | E E | same | exact |
| ă-hê-hem | revia | **D C D~C** | E E D~C | divergent; `rebia:jos272` reproduces it |
| kôl | yetiv | F | same | exact |
| gib-bô-rê | munach | E E E | same | exact |
| ha-ḥa-jil | zakef katan | D~C D C | same (foldUpbeats) | exact |
| wa-ʿă-zar-tem | tipcha (2nd half) | C B C D | same | exact |
| ô-tam | silluq | D E~D | same | exact |

Reading confidence in 272: high throughout. Two spots are medium. The second note of *ha-* in haḥajil is C4 (a ledger line through the head) rather than B3. In *ʿă* of waʿăzartem the note hangs below the ledger, which makes it B3, a neighbour note.

**What 272 adds over 271:** zakef katon (D~C | D C, the same contour as its revia), yetiv (a single F, the only F held in the whole mode), merha before tebir (E | D), and kadma not before geresh, which is recited (E E). It also confirms zarqa, segol, rebia-as-zakef-gadol, wĕazla-as-geresh, qadma, munah, talsa, the second-half ṭifḥa and sof pasuq.

**Where 272 differs from 271:** the etnachta ends a step below the final (C, not D). The one revia word sings 1 0 1 0 instead of 2 2 1 0. The tipcha before etnachta starts from a low C. Idelsohn printed both, so the reader's own variation, or a context 271 does not show, is the likeliest explanation [I]. With one verse there is no telling which **[ear]**.

## 4. The table: choices and confidence

**Rule.** Where 271 prints a figure, the cell follows 271. Where 271 is silent, 272 fills it. Where 272 sings a 271 figure differently, 271 stays the default and the 272 reading is a variant `jos272` (`withVariants(table, { atnah: "jos272" })`).

**Upbeat/core split** (Idelsohn gives none): the core is what lands on the stressed syllable, decided by setting each figure on the 272 words that carry it. For example, rebia's E E are upbeats, because jês'-bu sings E | D~C and baʾareṣ E | D | C. Zarqa's E A are upbeats, because ta-pĕ | hem. Segol's D E D are upbeats, because u-miq-nê | hem.

| Cell | Serves | Upbeats \| core (degrees) | From | Confidence |
|---|---|---|---|---|
| zarka | zarka | 2 5 \| 2 3 2 3 2 1 | 271 + 272 | high |
| segol | segol | 1 2 1 \| 0 | 271 + 272 | high |
| qadma>azla | kadma before geresh | 4 \| 2 | 271 + 272 | high |
| qadma | kadma elsewhere | 2 \| 2 | 272 (1 word) | low |
| azla | geresh | 2 2 \| 1 0 | 271 + 272 | high |
| rebia | revia, **zakef gadol, gershayim** (aliases) | 2 2 \| 1 0 | 271 label + 272 (2 z.g. words) | high (revia itself: medium, see §3) |
| zakef-katan | zakef katan | 1 0 \| 1 0, foldUpbeats | 272 (1 word) | low |
| pashta | pashta | 2 4 \| 5 4 2 | 271 "tĕrên qadmin" (label inferred) | low |
| yetiv | yetiv | \| 3 | 272 (1 word) | low |
| tevir | tevir | 2 \| 1 0 | 271 + 272 | medium |
| merha>tebir | mercha before tevir | 2 \| 1 | 272 (1 word) | low |
| telisha | telisha ketana, **telisha gedola** (alias) | 1 \| 0 1 2 | 271 + 272 | medium |
| merha | mercha (etnachta half, default) | 2 \| 2 | 271 | medium |
| tifha | tipcha (etnachta half) | 2 \| 2 | 271 | medium |
| munah | munach, **munach legarmeh** (alias) | 2 \| 2 | 271 + 272 (4 words) | high (legarmeh alias: editor's choice) |
| atnah | etnachta | 1 \| 1 | 271 | medium |
| merha@sof-pasuq | mercha in the sof-pasuq group | 1 0 \| -1 | 271 | medium |
| tifha@sof-pasuq | tipcha in the sof-pasuq group | 0 -1 0 \| 1 | 271 + 272 | high |
| sof-pasuq | silluq | 0 1 \| 2 1 | 271 + 272 | high |

**Recited on E by declaration** (`recite.tropes`, scored with `recite: true`, never `fallback`):

- **basis "source"**: mahpach, darga, mercha kefula, yerach ben yomo. These are conjunctives that 271 does not print. 271 prints its conjunctives (munah, merḥa) as notes on E, and Idelsohn says the mode moves on D and E. Confidence medium for mahpach and darga, low for the rare two.
- **basis "editor"**: pazer, karnei farah, shalshelet. These are disjunctives that Idelsohn does not give at all. Reciting them is my placeholder, not his reading. Confidence "none". Pazer is the one that matters: 5 words in the calibration corpus.

The engine still flags any ta'am that has no cell, no alias and no declaration as `fallback` (a hole). The test makes sure the corpus has none.

**Not built, on purpose:**

- **No end-of-haftarah cadence.** Idelsohn gives none for this mode, and Wikipedia says Sephardi haftarah traditions have none [V `nusach-tables.md` §6]. The last verse takes the ordinary sof pasuq.
- **No positional tevir/darga** (§5).
- **No special tunes** (Three Weeks, Hazon).

Coverage on the 53-verse calibration corpus: every word gets a cell or a declared recitation, with no holes. 30 of the 371 words of Machar Chodesh (I Samuel 20:18-42) are recited by declaration.

## 5. Positional tevir/darga, and how 273 and 296 differ

- **No. 271 has a single tĕbir** (E | D~C) and no darga entry. So the table has no positional context, and none was added to the engine. Wikipedia's uncited note says Moroccan darga and tevir "differ depending on whether they fall mid-verse or near the end", and that two sets in one verse take two tunes. That stays **open [ear]**.
- **No. 296** (book p. 113, scan 130), "Prophets", the same family by the introduction's grouping, **does print two tĕbir figures** side by side. They are C. B♭ A G | A and C | A C B♭ A [V]. That is evidence the distinction exists in some Moroccan Prophets readings. 296 is a different, much fuller system in **one flat with the final G**, which Idelsohn's introduction groups with London and Italy. It has Sephardi names (*sofar holeh* = munach, *tarha* = tipcha, *mehuppah* = mahpach), separate pasta, zagef gadol, darga, yetib, pazer, talša qĕtanna, "qadma wĕazala", and a sof pasuq with a raised leading tone (G F♯ G A) ending on A. No. 297 is Joshua 1:14 in that mode. **If the positional forms are wanted, 296/297 is the source to transcribe next**, but it is not the Fez table, and mixing them would break the "one published source" rule.
- **No. 273**, "Mode of Prophets-Gibraltar" (p. 103; the introduction calls 273-274 Marrakesh), is in one flat with the final D and the reciting tone on A [V]. Its figures:

  | Figure | Notes |
  |---|---|
  | rebia | F G A B♭ A G A |
  | talsa qĕtanna u. gĕdola | F G A C G A |
  | tebir u. z.g. | G A G A B♭ A G |
  | mahpah | A B♮ C B♮ D |
  | pasta | C C A |
  | munah | A A |
  | z. qatôn | G A |
  | merha | F F |
  | tifha | G A |
  | atnah | G A |
  | merha (2nd half) | G A G |
  | tifha (2nd half) | F E G |
  | sôf pasuq | A G F E D |

  Zakef katon, tipcha and etnachta share one figure that ends on the reciting tone, and only sof pasuq descends to the final. It is a fifth higher in tessitura than 271, and a different system, the "Spanish-Moroccan" haftarah tune. It would make a second Moroccan option (`haftarah-moroccan-gibraltar.json`) with the same engine features.

## 6. What needs a listening check against a living Moroccan reader

Check against these, cited and not downloaded (all copyrighted):

- Isaac Benchetrit's weekly haftarot "in the traditional Moroccan version", http://isaacbenchetrit.com/haftara/index-he.html
- Darké Abotenou (book ISBN 9781937887636, and its YouTube Torah/haftarah recordings)
- Joshua Maroof, "Taamim for Haftara, Moroccan style", https://soundcloud.com/joshua-maroof/taamim-for-haftara-moroccan , and the Haftarat Bemidbar sample at https://www.ydvh.org/samples-of-sephardic-cantillation/ . Maroof chants the ta'amim names, which is the fastest check of a cell table.

The checks, in priority order:

1. **Is Fez-1929 still what is sung?** `nusach-tables.md` §4.2 records a report of Yerushalmi drift. If the living reading differs throughout, Daniel's Q1 in `nusach-tables.md` decides between "as notated 1929" and "as sung".
2. **Pazer** (editor placeholder) and **pashta** (label inference). These are the two biggest unknowns.
3. **Zakef katan, yetiv, merha before tevir, kadma not before geresh**: one word of 272 each.
4. **The 271-vs-272 conflicts:** etnachta ending on D or C, revia 2 2 1 0 or 1 0 1 0, and tipcha before etnachta from E or from C. If a reader uses 272's forms, switch the default to `jos272`.
5. **Positional tevir/darga** (§5).
6. **The B3 under the final:** B♮ as printed, or the quarter-raised B♭ Idelsohn describes.
7. **Mahpach and darga** as plain recitation.
8. **Tempo and rhythm.** The cells carry Idelsohn's note values, which are a shape only.

## 7. Pronunciation: a Sephardi/Moroccan profile is needed for audio

A Moroccan table sung with `israeli-v1` sounds wrong to a Moroccan listener. The profile should be `moroccan-v1` in `trope/pronunciation.json`. Changes against `israeli-v1`:

| Item | israeli-v1 | moroccan-v1 (proposed) | Basis |
|---|---|---|---|
| ח | x | **ħ** (pharyngeal) | standard description; `nusach-tables.md` §5 |
| ע (`rules.ayin`) | "" | **ʕ** (pharyngeal) | same |
| alef with vowel (`rules.alefOnset`) | "" | "q" (glottal onset) | [I] |
| צ / ץ | ts | ts by default; **s** as a regional option | Idelsohn p. 3 quotes Toledano: Moroccans pronounce צ, שׁ, ס alike as [s] (his *Nĕ-sê-hem*, *mô-so*). This is regional, so it should be an option, not the default. |
| שׁ | sh | sh, with **s** as the same option | same |
| ת rafe | t | t | |
| ר | r (uvular in practice) | alveolar tap/trill | standard description [I] |
| vocal sheva (`vowels.SHEVA`) | e | e, always sounded (keep `longVowels: true`) | Idelsohn p. 3: "sheva na and hatafim as the Sephardim" |
| dagesh forte (`rules.geminate`) | double | double, articulated | Idelsohn p. 3 |
| tsere + yod (`rules.tsereYod`) | e | e (ê) | Idelsohn's vowel table, p. 3 |
| holam | o | o (Idelsohn: a "mixed" ô close to u at the end, "in Mogador like the Sephardi holam") | p. 3 [V, partly unclear] |

Engineering cost:

- **New symbols** in `pronunciation.json` `symbols`: ħ and ʕ, at minimum. The text front end's `rules.ayin` currently takes only `''` or `'q'`, so it needs a third value.
- **Phone maps.** The SoulX phone maps (`trope/soulx.mjs`, owned by another agent) have no pharyngeals. A fallback such as ħ to h and ʕ to a glottal stop or nothing would ship "accented but correct", per Daniel's 2026-10-15 ruling.

This is not implemented here: it is not quick and clean without touching the renderer files another agent owns. Scoring is unaffected, since the melody engine never reads phonemes.

## 8. Engine changes (`trope/melody.mjs`, backward compatible)

- **`aliases`** on a cell lists the other te'amim it serves. `selectCell` considers it for those te'amim. When a cell sings a ta'am that is not its own, the returned cell, and the score's `cell`, carry `as: <ta'am>`. Context keys are matched as before.
- **`table.recite`** = `{ tone: {deg, dur}, tropes: { <ta'am>: { basis, confidence, source } } }`. A ta'am with no cell that is listed there gets a `recite:<ta'am>` cell on the table's tone, marked `recite: true` and not `fallback`. Any other ta'am with no cell is still `fallback: true` (a hole), now sung on the table's reciting tone rather than always on degree 1. `recitingTone(table)` is exported. Tables without `recite` behave exactly as before.
- **`foldUpbeats`** on a cell: when a word has fewer pre-tonic syllables than the cell has upbeats, the extra upbeats are sung as a melisma on the first syllable instead of dropped. Only the Moroccan zakef katan uses it.
- **Per-table degree map:** no code change. `haftarah-moroccan.json` sets dorian (6 = +9, -1 = -3).
- **`scripts/trope-score.mjs --nusach moroccan`** is short for `--table trope/cells/haftarah-moroccan.json`. Unknown names, or a Torah reading with a nusach that has no Torah table, exit 2. The summary line counts the words recited by the table's choice.

**Tests:** `tests/trope-moroccan.test.mjs`, 8 tests. They cover the table's shape and sources; aliases; recite vs fallback; foldUpbeats; the 53-verse corpus with no holes; Joshua 1:14 against no. 272 (exact/contour/divergent per word, at least 15 exact, at most 4 divergent); the `jos272` variants reproducing 272; and the CLI alias. Full suite: 293 pass.

**MIDI for listening** (not committed): `C:\Users\dsbog\haftarah-audio\renders\moroccan\joshua-1-14.mid` and `i-samuel-20-18-42-machar-chodesh.mid`, D4, tempo 96.

Scan, page renders and crops: `C:\Users\dsbog\haftarah-audio\sources\idelsohn-v5\` (`v5.pdf`; `pages/p120.png` is the page with 271-274).
