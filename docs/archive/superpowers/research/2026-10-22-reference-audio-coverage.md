# Reference-audio coverage count (PocketTorah + Cantor Finkel), 2026-10-22

For Daniel's 1.5 ruling: "Tutor/clergy reference uploads: count PocketTorah gaps first; build uploads only if real gaps show." This is read-only research. It made no changes to a repository, Blob, Vercel, Neon or the network. It holds counts and verse references only.

## Bottom line

- **Torah has effectively no gap that a recording would fill.** All 5,846 Torah verses have a PocketTorah recording. 5,808 have a playable cut (99.4%). The other 38 come from review holds, a manifest omission and one failed alignment:
  - 24 are start-moved review holds.
  - 8 are ready cuts that have no short-manifest entry.
  - 6 are Haazinu aliyah 1. Its recording exists, but its alignment pack failed, so it has no cuts.
  - Finkel closes 2 of these 38 verses. 36 remain, and all 36 can be fixed with software or a review. None needs a recording.
- **Haftarah has one real gap: the special-Shabbat and festival haftarot.** PocketTorah recorded only the 54 parashah haftarot. 18 haftarot that the portal can be handed for a Saturday have no PocketTorah audio at all: Shekalim, Zachor, Parah, HaChodesh, HaGadol, Rosh Chodesh, Machar Chodesh, Pesach I, Shabbat Chol HaMoed Pesach, Pesach VIII, Shavuot II, Rosh Hashana I, both Yom Kippur readings, Sukkot I, Shabbat Chol HaMoed Sukkot, Shemini Atzeret, and the Micah part of Shabbat Shuva.
  - They hold **416 verses** with no PocketTorah audio. Finkel covers 16 of them (HaChodesh 10, Rosh Hashana I 6).
  - That leaves **400 verses uncovered**, about **2 hours of chant** at PocketTorah's average of 18 s per haftarah verse.
  - These haftarot replace the parashah haftarah on about 10 to 15 Shabbatot a year: the six named special Shabbatot every year, plus Rosh Chodesh and Machar Chodesh, plus festival Shabbatot. The current week (2026-10-10, Bereshit, Machar Chodesh) is one of them.
- **The parashah haftarot have no recording gap except 2 verses.** Masei's Jeremiah 4:1-2 is missing, because current Hebcal adds those verses and PocketTorah's recording stops at 3:4. The other 34 uncovered verses come from software or review:
  - 22 are duplicate references in Isaiah 54:1-55:5, shared by Noach, Re'eh and Ki Teitzei. The resolver refuses an ambiguous reference, so those three haftarot are entirely silent.
  - 11 are review holds.
  - 1 has no short-manifest entry.
- **Judgement:** there is a real gap that clergy or tutor recordings would fill, but it is narrow and can be listed in full: 18 named special and festival haftarot, about 400 verses, about 2 hours. It is not an open-ended need. A one-time recording of those 18 haftarot through the existing Finkel pipeline would close it. That pipeline covers private storage, a pinned manifest, the release hold and the listening review. A general upload feature is not needed for this. Build per-student or per-tutor uploads only if Daniel wants tutors to supply alternative melodies or customs, which is a product choice, not a coverage need. Separately, about 64 verses need software or review work, not recordings: 22 duplicates, 34 holds, 8 manifest omissions, plus the Haazinu-1 alignment.

## Totals

"Playable" means what a student page actually gets:
- `resolveReference(catalog, verse)` finds **exactly one** cut, with no asset, as the page path calls it;
- that cut's status is `ready`;
- `findShortSource` finds its short-v1 entry.

"Finkel" means the verse is inside one of the 167 clips that PR #23's build selects (`selectFinkelClips`). Coverage there is at **passage** granularity, explained below. "Neither" means not PocketTorah-playable and not inside a Finkel clip.

The counts use distinct verses, so a verse that appears in several units counts once.

| | Verses | PT playable | PT held (start-moved) | PT duplicate ref | PT ready, no short entry | PT no cut | Inside a Finkel clip | PT holes Finkel fills | **Neither** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Torah | 5,846 | 5,808 | 24 | 0 | 8 | 6 | 228 | 2 | **36** |
| Haftarah | 1,629 | 1,176 | 12 | 22 | 1 | 418 | 93 | 17 | **436** |
| Overall | 7,475 | 6,984 | 36 | 22 | 9 | 424 | 321 | 19 | **472** |

How the uncovered verses break down, by recording versus software:
- **Torah, 36:** 23 held, 7 with no short entry, 6 with no cut (Haazinu-1, a failed alignment).
- **Haftarah, 436:**
  - 400 are special-haftarah verses with no cut.
  - 2 are Masei 4:1-2, with no cut.
  - 22 are duplicates.
  - 11 are held.
  - 1 has no short entry.

Two Ashkenazi alternatives that current Hebcal may give are kept out of the table above because I could not check them offline:
- Vayishlach, Hosea 11:7-12:12: 17 verses, none recorded.
- Achrei Mot, Ezekiel 22:1-19: 3 extra verses, none recorded.

With them, haftarah has 1,649 verses and 456 uncovered, and the overall figures are 7,495 and 492.

Units counted: 534 in all.
- 431 Torah units: the 54 parashiyot, aliyot 1-7 plus maftir (Vezot Haberakhah has no maftir).
- 7 combined parashiyot.
- 18 special-Shabbat and festival Torah readings.
- 54 parashah haftarot.
- 24 special, festival or variant haftarot.

**71 units have at least one uncovered verse.** They are listed below.

Finkel detail:
- The selection has 167 clips, 152 of them preferred. Students would hear only the preferred clips, but the preferred clips cover the same 327 verses (Torah 228, haftarah 99).
- 6 Finkel haftarah verses fall outside every supported unit: Ezekiel 1:4-8, from the Shavuot I haftarah, which never falls on a Saturday, and Amos 2:1.
- The whole prepared package, including held clips, drills and tempo variants, lists 378 scripture verses. It would add only 1 more uncovered verse if everything were released. **Finkel barely overlaps the gaps.** His recordings mostly duplicate verses PocketTorah already has.
- Granularity: Finkel clips are passages, mostly 2 to 12 or more verses. Only 32 clips are single verses. None has verse or word timings. "Covered by Finkel" means a page showing that verse offers a whole-passage player. It does not mean the verse can be played on its own.

## How each number was computed (so it can be checked)

Script: `coverage.mjs` in this scratchpad, with outputs `coverage-data.json` and `units-table.md`. It runs offline with Node 24.

1. **Reading units.** The portal has no static list of units. It takes each Saturday's reading from Hebcal's `/leyning` API at run time (`src/lib/readings/proposals.ts`, `leyning.mjs`). Hebcal is a network service, so I rebuilt the units offline:
   - **Parashiyot.** The 54 parashiyot, with their full-kriyah aliyot 1-7 plus maftir and their Ashkenazi haftarah, come from PocketTorah's `aliyah.json` (`C:/private/pockettorah/aliyah.json`, Hebcal's older aliyot table).
   - **Two corrections to that table:**
     - Vayera's haftarah is II Kings 4:1-37. The table says "I Kings 4:1-37", a verse range that does not exist. The catalog's own Vayera-H cuts are II Kings.
     - Masei uses current Hebcal's Jeremiah 2:4-28; 3:4; 4:1-2.
   - **Combined parashiyot.** Each is the union of its two parts. Hebcal divides the aliyot differently, but the verse set is the same.
   - **Special Shabbatot and festivals.** The Torah readings and the haftarah ranges come from my knowledge of Hebcal's Ashkenazi data, limited to festivals that can fall on a Saturday in either calendar.
     - I checked the fixtures where they exist: Shekalim (II Kings 12:1-17), Machar Chodesh (I Samuel 20:18-42) and Simchat Torah (Joshua 1:1-18). For this I ran the portal's own `createHebcalReader` on `tests/fixtures/trope/hebcal/*.json` with an injected fake fetch.
     - The other special ranges are standard but were not checked against live Hebcal.
   - **Verse expansion.** Every unit was expanded with the portal's own `expandReadingRanges` and `TANAKH_VERSE_COUNTS`, one range at a time.
   - **Left out.** Triennial units are subsets of these, so they add no verses. Custom ranges can be any verse in Tanakh and are not counted.
2. **PocketTorah.**
   - **Catalog.** `C:/private/pockettorah/reference-release-20261017/catalog.json`, whose SHA-256 is `48c8147b…7efdf`. That is the pin STATE.md records, and it is byte-identical to the short-manifest build's `parent.json`. It has 431 recordings, 7,073 cuts and 7,051 distinct references.
   - **Short manifest.** `reference-short-manifest-6947b31-v1/publication-input/manifest.json`, with 6,984 entries. That equals STATE's "All 6,984 reference bodies are published".
   - **Matching.** Each verse was classified with the same rules as `resolveReference` and `findShortSource`: a unique reference, `ready` status, the same parent asset, and the same floor/ceil native frame grid.
   - **Reconciliation:** 7,051 references, minus 22 duplicates, minus 36 held, minus 9 with no short entry, gives 6,984. That is exactly the manifest size.
3. **Finkel.**
   - The private prepared package is `…/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/CRCBeitMitzvah/research-private/finkel-collection/prepared/catalog.json`, with 322 assets.
   - I imported `selectFinkelClips` unchanged from `C:/Users/dsbog/bneimitzvah-finkel/scripts/finkel-reference-build.mjs` (PR #23). It reproduces the plan's figures: 167 clips, 152 preferred, Torah 228 verses, haftarah 99 verses.
   - A verse counts as covered if it is in any selected clip's `verses`. That matches the PR's rule that "a clip is offered on any reading page that shows at least one of its verses."
4. **Neither.** A verse whose PocketTorah state is not playable and that is not in any Finkel clip.

## Suspicious or noteworthy coverage

1. **Haazinu aliyah 1 (Deuteronomy 32:1-6) has no cuts at all.** The recording exists, but its alignment pack was rejected (`skipped.json`: "Haazinu-1 pack failed"). It is the only Torah aliyah with no audio. This is an alignment problem, not a missing recording.
2. **Duplicate references silence three haftarot.** Isaiah 54:1-55:5 has 22 verses with two cuts each:
   - Noach-H with Ki Teitzei-H for 54:1-10;
   - Noach-H with Re'eh-H for 54:11-55:5.

   `resolveReference` returns unavailable when it finds more than one match and no asset, and the page path (`readPage`) never passes an asset. So the Noach, Re'eh and Ki Teitzei haftarot play nothing, although the audio exists. The fix is to choose the cut by the assignment's reading, which is a software change.
3. **36 start-moved review holds:** 24 Torah and 12 haftarah. They are listed in the unit tables. Each is one verse inside an otherwise covered unit.
4. **9 ready cuts have no short-manifest entry** (STATE's "nine held lookups"):
   - Genesis 2:19
   - Leviticus 25:46
   - Numbers 17:24 and 20:13
   - Deuteronomy 30:6, 32:52, 33:7 and 33:21
   - Isaiah 52:12

   Almost all of them are the last verse of an aliyah or a recording. Numbers 20:13 is covered by a Finkel passage.
5. **One cut has no word map:** II Kings 5:18 (`portal-text-unavailable`). It plays, but without word highlighting.
6. **For 10 recordings, PocketTorah's own word labels did not match.** Their 251 verse cuts rest on alignment alone, so treat their boundaries with less confidence. The recordings are:
   - Bamidbar-3, Behaalotcha-5, Lech-Lecha-4, Nasso-6
   - Shemot-1, Shmini-6, Tetzaveh-3, Toldot-6
   - Vayera-H, Yitro-H
7. **"Playable" is not "accepted".** Per STATE, Daniel's listening of PocketTorah playback FAILED on 2026-10-18 because word playback was slow and inaccurate. The word-boundary repair (`verse-index-v2.json`, dated 2026-10-22) is still in progress. This count measures whether a cut exists, not whether it is good enough for students.
8. **The catalog and the index agree exactly.** All 7,073 recording/verse pairs in the catalog appear in both `verse-index.json` and `verse-index-v2.json`, and neither index has a pair the catalog lacks. Every catalog reference falls inside a supported unit, so the catalog lists nothing the unit table lacks.
9. **Multi-range haftarot break the portal's calendar proposal.** This was outside the brief, but it limits which units the portal can propose.
   - Hebcal returns `haft` as an array when a haftarah has more than one range. `normalizePayload` in `proposals.ts` accepts only an object, so the whole date's reading is refused (`ReadingUnavailable("invalid-response")`), Torah included. I confirmed this offline: the Shemot fixture is REFUSED, while Bereshit, Beshalach, Vayakhel-Shekalim and Simchat Torah parse.
   - Affected weeks, by the same code path: Shemot, Yitro, Mishpatim, Tzav, Masei and Matot-Masei, Shabbat Shuva, and Pesach I.
   - Custom assignment can stand in for most of them. But `expandReadingRanges` rejects ranges that cross books or run backwards, so three haftarot cannot be one portal assignment at all:
     - Shabbat Shuva: Hosea, Micah and Joel;
     - Yom Kippur afternoon: Jonah and Micah;
     - Mishpatim: Jeremiah 34:8-22 followed by 33:25-26.

## Every unit with an uncovered verse

Columns: verses in the unit; PocketTorah-playable verses; verses inside a Finkel clip; uncovered verses; and why. "held" is a start-moved review hold, "dup" a duplicate reference, "no-short" a ready cut with no short entry, and "none" means no PocketTorah cut.

### Torah, parashah aliyot (30 of 431 units)

| Unit | Verses | PT playable | Finkel | Uncovered | Why (PT state of uncovered verses) | Uncovered refs |
|---|---:|---:|---:|---:|---|---|
| Bereshit aliyah 2 | 16 | 15 | 0 | **1** | no-short 1 | Genesis 2:19 |
| Noach aliyah 7 | 32 | 31 | 0 | **1** | held 1 | Genesis 11:25 |
| Vayetzei aliyah 5 | 32 | 31 | 0 | **1** | held 1 | Genesis 31:3 |
| Vayetzei aliyah 6 | 26 | 25 | 0 | **1** | held 1 | Genesis 31:17 |
| Vayetzei aliyah 7 | 15 | 14 | 0 | **1** | held 1 | Genesis 31:52 |
| Vayishlach aliyah 5 | 42 | 41 | 0 | **1** | held 1 | Genesis 34:6 |
| Beshalach aliyah 4 | 32 | 31 | 0 | **1** | held 1 | Exodus 15:2 |
| Yitro aliyah 2 | 11 | 10 | 0 | **1** | held 1 | Exodus 18:23 |
| Terumah aliyah 6 | 8 | 7 | 0 | **1** | held 1 | Exodus 27:7 |
| Ki Tisa aliyah 1 | 45 | 44 | 0 | **1** | held 1 | Exodus 31:7 |
| Shmini aliyah 5 | 5 | 4 | 0 | **1** | held 1 | Leviticus 10:16 |
| Kedoshim aliyah 5 | 7 | 6 | 2 | **1** | held 1 | Leviticus 20:6 |
| Behar aliyah 6 | 8 | 7 | 0 | **1** | no-short 1 | Leviticus 25:46 |
| Bamidbar aliyah 4 | 13 | 12 | 0 | **1** | held 1 | Numbers 3:1 |
| Korach aliyah 5 | 9 | 8 | 0 | **1** | no-short 1 | Numbers 17:24 |
| Pinchas aliyah 4 | 18 | 17 | 0 | **1** | held 1 | Numbers 27:20 |
| Matot aliyah 7 | 23 | 22 | 0 | **1** | held 1 | Numbers 32:34 |
| Devarim aliyah 3 | 17 | 16 | 0 | **1** | held 1 | Deuteronomy 1:29 |
| Devarim aliyah 4 | 9 | 8 | 0 | **1** | held 1 | Deuteronomy 1:40 |
| Devarim aliyah 6 | 21 | 19 | 0 | **2** | held 2 | Deuteronomy 2:37, Deuteronomy 3:13 |
| Re'eh aliyah 1 | 17 | 15 | 0 | **2** | held 2 | Deuteronomy 12:6, Deuteronomy 12:10 |
| Re'eh aliyah 4 | 21 | 20 | 0 | **1** | held 1 | Deuteronomy 14:18 |
| Ki Teitzei aliyah 7 | 28 | 27 | 0 | **1** | held 1 | Deuteronomy 24:14 |
| Ki Tavo aliyah 6 | 63 | 62 | 0 | **1** | held 1 | Deuteronomy 28:44 |
| Nitzavim aliyah 4 | 6 | 5 | 0 | **1** | no-short 1 | Deuteronomy 30:6 |
| Haazinu aliyah 1 | 6 | 0 | 0 | **6** | none 6 | Deuteronomy 32:1, Deuteronomy 32:2, Deuteronomy 32:3, Deuteronomy 32:4, Deuteronomy 32:5, Deuteronomy 32:6 |
| Haazinu aliyah 7 | 9 | 8 | 0 | **1** | no-short 1 | Deuteronomy 32:52 |
| Haazinu maftir | 5 | 4 | 0 | **1** | no-short 1 | Deuteronomy 32:52 |
| Vezot Haberakhah aliyah 1 | 7 | 6 | 0 | **1** | no-short 1 | Deuteronomy 33:7 |
| Vezot Haberakhah aliyah 4 | 4 | 3 | 0 | **1** | no-short 1 | Deuteronomy 33:21 |

### Torah, combined parashiyot (whole reading) (4 of 7 units)

| Unit | Verses | PT playable | Finkel | Uncovered | Why (PT state of uncovered verses) | Uncovered refs |
|---|---:|---:|---:|---:|---|---|
| Achrei Mot-Kedoshim (whole reading) | 144 | 143 | 10 | **1** | held 1 | Leviticus 20:6 |
| Behar-Bechukotai (whole reading) | 135 | 134 | 11 | **1** | no-short 1 | Leviticus 25:46 |
| Matot-Masei (whole reading) | 244 | 243 | 16 | **1** | held 1 | Numbers 32:34 |
| Nitzavim-Vayeilech (whole reading) | 70 | 69 | 0 | **1** | no-short 1 | Deuteronomy 30:6 |

### Torah, special Shabbatot and festivals (2 of 18 units)

| Unit | Verses | PT playable | Finkel | Uncovered | Why (PT state of uncovered verses) | Uncovered refs |
|---|---:|---:|---:|---:|---|---|
| Pesach VII | 70 | 69 | 0 | **1** | held 1 | Exodus 15:2 |
| Simchat Torah (Israel, Shabbat) | 81 | 79 | 0 | **2** | no-short 2 | Deuteronomy 33:7, Deuteronomy 33:21 |

### Haftarah, parashah (Ashkenazi) (15 of 54 units)

| Unit | Verses | PT playable | Finkel | Uncovered | Why (PT state of uncovered verses) | Uncovered refs |
|---|---:|---:|---:|---:|---|---|
| Noach haftarah (Isaiah 54:1 - 55:5) | 22 | 0 | 0 | **22** | dup 22 | whole unit or most of it |
| Vayera haftarah (II Kings 4:1 - 4:37) | 37 | 36 | 0 | **1** | held 1 | II Kings 4:16 |
| Chayei Sara haftarah (I Kings 1:1 - 1:31) | 31 | 30 | 0 | **1** | held 1 | I Kings 1:13 |
| Vayishlach haftarah (Obadiah 1:1 - 1:21) | 21 | 20 | 0 | **1** | held 1 | Obadiah 1:6 |
| Shemot haftarah (Isaiah 27:6 - 28:13; 29:22 - 29:23) | 23 | 22 | 0 | **1** | held 1 | Isaiah 28:1 |
| Bechukotai haftarah (Jeremiah 16:19 - 17:14) | 17 | 16 | 0 | **1** | held 1 | Jeremiah 16:19 |
| Nasso haftarah (Judges 13:2 - 13:25) | 24 | 22 | 0 | **2** | held 2 | Judges 13:22, Judges 13:25 |
| Pinchas haftarah (I Kings 18:46 - 19:21) | 22 | 21 | 0 | **1** | held 1 | I Kings 18:46 |
| Matot haftarah (Jeremiah 1:1 - 2:3) | 22 | 21 | 0 | **1** | held 1 | Jeremiah 1:10 |
| Masei haftarah (Jeremiah 2:4 - 2:28; 3:4; 4:1 - 4:2) | 28 | 26 | 0 | **2** | none 2 | Jeremiah 4:1, Jeremiah 4:2 |
| Eikev haftarah (Isaiah 49:14 - 51:3) | 27 | 26 | 5 | **1** | held 1 | Isaiah 49:21 |
| Re'eh haftarah (Isaiah 54:11 - 55:5) | 12 | 0 | 0 | **12** | dup 12 | whole unit or most of it |
| Shoftim haftarah (Isaiah 51:12 - 52:12) | 24 | 23 | 0 | **1** | no-short 1 | Isaiah 52:12 |
| Ki Teitzei haftarah (Isaiah 54:1 - 54:10) | 10 | 0 | 0 | **10** | dup 10 | whole unit or most of it |
| Ki Tavo haftarah (Isaiah 60:1 - 60:22) | 22 | 21 | 0 | **1** | held 1 | Isaiah 60:5 |

### Haftarah, special Shabbatot and festivals (20 of 24 units)

| Unit | Verses | PT playable | Finkel | Uncovered | Why (PT state of uncovered verses) | Uncovered refs |
|---|---:|---:|---:|---:|---|---|
| Shabbat Shekalim haftarah | 17 | 0 | 0 | **17** | none 17 | whole unit or most of it |
| Shabbat Zachor haftarah | 33 | 0 | 0 | **33** | none 33 | whole unit or most of it |
| Shabbat Parah haftarah | 23 | 0 | 0 | **23** | none 23 | whole unit or most of it |
| Shabbat HaChodesh haftarah | 28 | 0 | 10 | **18** | none 18 | whole unit or most of it |
| Shabbat HaGadol haftarah | 21 | 0 | 0 | **21** | none 21 | whole unit or most of it |
| Shabbat Shuva haftarah | 25 | 22 | 0 | **3** | none 3 | Micah 7:18, Micah 7:19, Micah 7:20 |
| Shabbat Rosh Chodesh haftarah | 24 | 0 | 0 | **24** | none 24 | whole unit or most of it |
| Shabbat Machar Chodesh haftarah | 25 | 0 | 0 | **25** | none 25 | whole unit or most of it |
| Pesach I haftarah | 19 | 0 | 0 | **19** | none 19 | whole unit or most of it |
| Shabbat Chol HaMoed Pesach haftarah | 14 | 0 | 0 | **14** | none 14 | whole unit or most of it |
| Pesach VIII (Diaspora) haftarah | 25 | 0 | 0 | **25** | none 25 | whole unit or most of it |
| Shavuot II (Diaspora) haftarah | 20 | 0 | 0 | **20** | none 20 | whole unit or most of it |
| Rosh Hashana I haftarah | 38 | 0 | 6 | **32** | none 32 | whole unit or most of it |
| Yom Kippur morning haftarah | 22 | 0 | 0 | **22** | none 22 | whole unit or most of it |
| Yom Kippur afternoon haftarah | 51 | 0 | 0 | **51** | none 51 | whole unit or most of it |
| Sukkot I haftarah | 21 | 0 | 0 | **21** | none 21 | whole unit or most of it |
| Shabbat Chol HaMoed Sukkot haftarah | 22 | 0 | 0 | **22** | none 22 | whole unit or most of it |
| Shemini Atzeret haftarah | 13 | 0 | 0 | **13** | none 13 | whole unit or most of it |
| Vayishlach Ashkenazi variant haftarah | 17 | 0 | 0 | **17** | none 17 | whole unit or most of it |
| Achrei Mot Ashkenazi variant haftarah | 19 | 16 | 0 | **3** | none 3 | Ezekiel 22:17, Ezekiel 22:18, Ezekiel 22:19 |

### Units where Finkel closes a PocketTorah hole (4)

- Lech-Lecha haftarah (Isaiah 40:27 - 41:16): 1 PT-unplayable verse(s), all inside a Finkel passage
- Chukat aliyah 3: 1 PT-unplayable verse(s), all inside a Finkel passage
- Eikev aliyah 1: 1 PT-unplayable verse(s), all inside a Finkel passage
- Chukat-Balak (whole reading): 1 PT-unplayable verse(s), all inside a Finkel passage
