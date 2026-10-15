# The trope engine: chanted Torah and haftarah, computed from the te'amim

Design spec, 2026-10-15, branch `trope-engine-research`. The decisions in section 2 are Daniel's rulings of 2026-10-15 and are not reopened here. The research is in `docs/superpowers/research/2026-10-15-trope-engine/` (README.md and seven reports, cited by file name). For the chant audio, this spec supersedes three non-goals of `2026-10-15-web-2-0-design.md` section 10 ("An AI chanting voice in 2.0", "PocketTorah or any other non-cantor audio", "More than one nusach"); that spec is otherwise unchanged and still owns the player, the audio store and any recordings by the cantor.

## 1. Purpose and audience

Any verse of Torah or haftarah, chanted correctly in a chosen nusach, on the web sheet, generated, not recorded.

The listeners are the Torah from Scratch class (PRODUCT.md): literate adults who mostly read the English, some who read Hebrew, and a few who chant. The chanters use it to learn a reading. The rest hear the verse being studied. Success means a participant taps any verse of the week's Torah selection or haftarah and hears it sung to the te'amim in the nusach they picked. Every note is traceable to a cell in a cited table, and the audio is labeled as generated.

## 2. Settled decisions (Daniel, binding)

| Topic | Ruling |
|---|---|
| Scope | Haftarah and Torah. One text pipeline, one cell table per reading type per nusach. |
| Ranges | Hebcal's traditional ranges. Aliyah ends come from hebcal's full-kriyah aliyot. |
| Quality bar | Accented but correct ships: melodically correct, intelligible, slightly American on resh and chet. |
| Tooling | Use what exists now. CC-BY-NC aligner weights and a PocketTorah-derived share-alike base model are acceptable for private, unpublished models. |
| Voice | The voice belongs to no one in particular: a stock or synthetic voice. Nothing depends on a cantor. A cantor's recording would be an upgrade, never a prerequisite. |
| Melodies | Standard published tables, one JSON table per nusach per reading type, each citing its source, offered as options. Order: Standard Reform (Binder/Avery) first, then Ashkenazi traditional, Moroccan, Spanish & Portuguese and Syrian, as nusach-tables.md section 8 lays out. |

## 3. Architecture

### 3.1 Two halves

| Half | What it is | Where | State |
|---|---|---|---|
| **Score engine** | Pure, dependency-free JS. It takes MAM Hebrew and a cell table and produces a score per verse. | `trope/text.mjs` (text front end), `trope/cells/*.json` (cell tables), `trope/melody.mjs` (melody engine), `trope/pronunciation.json` | Exists |
| **Renderer** | Turns a score into audio. It is swappable and runs offline. | `trope/midi.mjs` (MIDI audition) today; the singing renderers in section 6 | MIDI exists; the rest is provisional |

The tools are `scripts/trope-score.mjs` and `scripts/trope-fetch.mjs`. `trope-score.mjs` scores one verse from a units file, or any reading with `--ref "Book c:v-c:v"` fetched from Sefaria. It prints a note table and writes MIDI with `--midi` (other flags: `--key`, `--tempo`, `--elision`, `--final`/`--no-final`, `--table`, `--quiet`). `trope-fetch.mjs` fetches raw MAM verses into the calibration fixtures (`--corpus`, `--refs`, `--out`). Both scripts are Node 18+ with global fetch and install nothing.

### 3.2 The score JSON is the contract

`scoreVerse(units, { table, key, tempo, elision })` in `trope/melody.mjs` returns a score with the shape below (taken from the code; I Samuel 20:18 with the haftarah table). Each renderer consumes this object and nothing upstream of it. Fields may be added. They are never renamed or dropped.

```jsonc
{
  "ref": "I Samuel 20:18", "key": "D4", "tempo": 96,           // key = the pitch of degree 1
  "table": "Ashkenazic haftarah, Binder/Avery (Reform Standard)",
  "flags": { "final": false, "endOfAliyah": false, "endOfBook": false },
  "special": null,                                               // "creation" | "journeys" | "song-of-the-sea"
  // "specialCells": false                                       // present when special is set: did this table compute it?
  "units": [                                                     // one per accent unit (maqaf chain)
    { "text": "יְהוֹנָתָ֖ן",
      "cell": { "id": "tipcha", "trope": "tipcha", "context": {} },   // + "confidence" when the cell has one
      "syllables": [
        { "he": "יְ", "ph": ["j","e"], "stress": null, "notes": [ { "deg": 3, "midi": 65, "dur": 0.5, "slur": false } ] },   // … הוֹ, נָ
        { "he": "תָ֖ן", "ph": ["t","a","n"], "stress": "tonic", "notes": [ { "deg": 4, "midi": 67, "dur": 1.5, "slur": false } ] } ] } ],
  "events": [ { "t": 0, "dur": 0.5, "midi": 62, "deg": 1, "unit": 0, "syllable": 0, "slur": false, "lyric": "vaj", "he": "וַ" } ],
  "beats": 22, "seconds": 13.75
}
```

`dur` is in beats (quarter note = 1). `slur: true` marks a melisma continuation note. `elided: true` marks an upbeat moved by elision. `midi` is `tonic + degree semitones + alt`, and it may become fractional once a table carries quarter tones (section 4.4). The input to `scoreVerse` is the per-verse units object that `verseUnits()` in `trope/text.mjs` returns (hebrew-text-pipeline.md section 6.3), plus the reading flags `final`, `endOfAliyah`, `endOfBook` and `special`.

### 3.3 What lasts

The cell tables, the pronunciation profiles, the calibration corpora and the score contract are durable, and they are versioned in the repo. Models, prompt clips, rendered audio and renderer code are disposable. Any of them can be replaced, and the replacement is re-run from the scores. A rendered MP3 is valid only for the score it was rendered from (section 8).

## 4. Cell tables

### 4.1 Shape (as built)

A table is one JSON file. The header holds `name`, `type` (`haftarah` | `torah`), `tradition`, `source`, `mode`, `key`, `tonic`, `degrees` (numbering and a `semitones` map from diatonic degree to semitones above degree 1, with 0 = the 7th below, -1 = the 6th below, -2 = the 5th below), `durations`, `cellShape`, `tropeIds`, `variantSets` and `cells`. `haftarah.json` adds `absent` (shalshelet, karnei farah and yerach ben yomo, which have no haftarah melody), `endOfHaftarah` (the four closing patterns) and `phraseEndings`. `torah.json` adds `readingFlags`, `specialMelodies` and `notInTable`.

A cell is `{ id, trope, context, upbeats: [{deg, dur, alt?}], core: [{deg, dur, alt?}], source, confidence?, note?, variants? }`. The stressed note is `core[0]`. The context keys are `before`, `after`, `group` (lib.js's phrase family), `endOfReading`, `endOfAliyah`, `endOfBook`, `special`, `noTipcha`, `onOneWord` and `monosyllabic`. `selectCell` takes every cell for the unit's trope whose context keys all hold, and the most specific one wins by weight (endOfBook and special 32, endOfReading and endOfAliyah 16, before 8, after 4, onOneWord 4, monosyllabic 2, noTipcha 2, group 1). A trope with no cell falls back to the reciting tone, with `id: "fallback:<trope>"` and `confidence: "none"`. `fitSyllables` applies the syllable-fitting rules of trope-grammar.md section 2.2. Upbeats absorb the pre-tonic syllables: dropped at p = 0, the first one repeated for p greater than the number of upbeats. The core is a melisma on the tonic syllable, and for a mil'el word its last note moves to the post-tonic syllable. Elision (rule 4) is an option and is off by default.

| Table | Cells | With variants | `confidence: "low"` | Variant sets | Special cells |
|---|---|---|---|---|---|
| `trope/cells/haftarah.json` (Binder/Avery, D minor) | 50 (44 distinct melodies) | 34 | 5 | `rosowsky`, `common`, `kalib` | none |
| `trope/cells/torah.json` (Avery/Binder, F = 1 major frame) | 62 (51 per torah-grammar.md, plus contexts) | 61 | 2 | `rosowsky`, `common`, `high` | `creation` |

### 4.2 One table per nusach per reading type; the citation rule

- Each option is a pair of files, `<reading>-<nusach>-<source>.json` (nusach-tables.md section 8 names them, for example `haftarah-moroccan-idelsohn.json`). When the second nusach lands, the two existing files are renamed `haftarah-binder-avery.json` and `torah-binder-avery.json`.
- The header gains `id`, `nusach` (the menu label), `reading` and `pronunciation` (the default profile, section 5.3).
- **Citation rule.** The header's `source` names one standard published source by author, title, edition and page or number, with a URL when one is public and a rights line ("public domain" or "copyrighted edition, transcribed to degrees, pages not reproduced"). Every cell's `source` points to the place in that source. A table with no published source does not ship. Melodies are stored as degrees only. No scans, pages or source audio enter the repo.
- Today's two tables cite the reports' transcription of TropeTrainer's Binder/Avery tables (trope-grammar.md section 2.3, torah-grammar.md section 2.2). Checking them against a printed Binder/Avery source is open item 11.

### 4.3 Variants and confidence

`variants` on a cell holds the other tables' readings of the same context, keyed by variant set. `withVariants(table, picks)` swaps the chosen cells in. A variant is a choice inside one nusach option, not a separate option. The variant sets drawn only from TropeTrainer (`rosowsky`, `common`) carry no printed source (open item 12). `confidence: "low"` marks a cell whose value the report flags as uncertain. The score carries it through, so a listening review can single those words out. The `degrees.note` of `haftarah.json` flags the natural 7th before sof pasuk as low confidence.

### 4.4 Extensions for reciting-tone traditions (Wave 4)

nusach-tables.md sections 2, 3 and 7. The Moroccan, Gibraltar and Syrian tables have several te'amim sharing one figure on a reciting tone. These extensions are added with the first table that needs them:

| Field | Meaning | First needed by |
|---|---|---|
| `aliases: { "<trope>": "<trope>" }` | One cell serves several te'amim. `selectCell` resolves the alias before matching. | Moroccan |
| `recitingTone: { deg, dur }` | Default for a ta'am the source does not notate. It replaces the engine fallback for that table and is reported as `confidence: "recitingTone"`, not `"none"`. | Moroccan |
| `degrees.semitones` with fractional values, per table | A dorian map (Moroccan) or a map with quarter tones (Syrian, for example a neutral second of 1.5). `degreeSemitones` already reads any number from the map. `midi.mjs` gains pitch bend, since it now truncates (`midi & 0x7f`), and renderers receive the fractional pitch. | Moroccan (map), Syrian (quarter tones) |
| `pronunciation` | The table's default profile. The listener can override it with Israeli. | Moroccan, S&P, Syrian |
| `classMap` | Ta'am to class before cell lookup. | Yemenite (not in the first four) |

### 4.5 The option menu

| Order | Option | Source | Engine work |
|---|---|---|---|
| 1 | Standard Reform (Binder/Avery), haftarah and Torah | Binder/Avery via trope-grammar.md 2.3 and torah-grammar.md 2.2 | exists |
| 2 | Ashkenazi traditional | Jacobson, *Chanting the Hebrew Bible* (JPS 2002/2017) | none; the book must be bought (open item 6) |
| 3 | Moroccan | Idelsohn, *Thesaurus* vol. 5 (1929), nos. 271-272, public domain | aliases, recitingTone, dorian map, `moroccan` profile |
| 4 | Spanish & Portuguese (London) | *Book of Prayer of the S&P Jews' Congregation, London*, vol. 1 (1965), pp. 365-367 | `sp-london` profile |
| 5 | Syrian / Oriental Sephardi | Idelsohn, *Thesaurus* vol. 4 (1923), nos. 312 and 328, public domain | quarter tones, `syrian` profile |

The menu lists only options with both a table and a rendered week. A haftarah table can ship before its Torah table. The option then appears for haftarah verses only.

## 5. Text front end (exists)

### 5.1 What it does

`verseUnits(html, { final, pronunciation, ref })` takes a `sheet.json` verse or a raw Sefaria v3 MAM string. It returns the units object, carrying `ref`, `version`, `pronunciation`, `final`, `he`, `break`, `units`, `ipa` and `warnings`. It runs stages 1-7 of hebrew-text-pipeline.md section 6.2:

- resolves markup: the ketiv/qere spans, legarmeh versus paseq, pisqa, footnotes, `&nbsp;` runs, implicit maqaf, nun hafukha;
- reads the divine name as Adonai or Elohim, carrying its accents;
- handles Jerusalem as a qere perpetuum;
- merges maqaf chains into one unit;
- syllabifies;
- marks the tonic from the accent (MAM's doubled pashta, zarka, segol and telisha give it directly);
- sets the trope family and phrase position;
- assigns phonemes per syllable.

Trope families come from `lib.js` `tropePhrases()`, so the engine's phrase families equal the chanter's copy by construction. `verseIpa` and `verseToSyllableString` (gold-set notation) render the result. Tests: `tests/trope-text.test.mjs`, `trope-melody.test.mjs`, `trope-engine.test.mjs` and `trope-torah.test.mjs` (52 tests, run by `npm test`), on fixtures in `tests/fixtures/trope/`. Those fixtures are `calibration-haftarah.json` (53 verses: core 20, full 29, rare 4), `calibration-torah.json` (83 verses: core 31, full 43, rare 6, extra 3, with `endOfAliyah`, `endOfBook` and `special` flags), `edge-cases.json` and `i-samuel-20-18.units.json`.

### 5.2 The vendored library and the no-install rule

Syllables come from havarotjs 0.25.5 (MIT), vendored at `trope/vendor/havarotjs/`. Its `dist` `.js` files are byte-identical to the npm tarball, kept with `LICENSE` and `PROVENANCE.md` (hashes, date, update steps), plus a one-line `package.json` with `{"type":"module"}`. It has no runtime dependencies. Nothing is ever installed through npm in this repo. A future library is vendored the same way or not used. The resolver, stress, trope and phoneme layers are ours.

### 5.3 Pronunciation profiles

`trope/pronunciation.json` holds `default: "israeli-v1"` and one profile, `israeli-v1`: modern Israeli segment values on Tiberian syllable structure. Each profile has `syllabifier` (havarotjs options), `consonants`, `vowels`, `rules` (tsere-yod, gemination, furtive patach, alef and ayin onsets, divine name and others) and `symbols` (IPA, X-SAMPA, an ARPAbet fallback, roman). Sephardi tables need their own profiles before they ship: `moroccan`, `sp-london` and `syrian`, with the new symbols ħ ʕ q sˤ tˤ w ŋ (nusach-tables.md section 5). A profile's symbols must each map to a renderer phoneme, or the table does not ship for that renderer.

### 5.4 Reading flags

`final` gives the haftarah's closing cadence. `endOfAliyah` and `endOfBook` give the Torah cadences on the sof-pasuk phrase, and the fifth pattern (`noTipcha`) applies at an aliyah end. `special` must be one of the names in `SPECIAL_MELODIES`, and an unknown name throws. The caller sets the flags today. Wave 1 derives them from the reading. The flags are:

- `final` for the last verse of a haftarah;
- `endOfAliyah` for every aliyah's end verse in the reading's hebcal aliyot (2.0 spec section 4.1, `readings[].aliyot`);
- `endOfBook` for the five book ends;
- `special: "creation"` for Gen 1:5, 8, 13, 19, 23 and 31.

`trope-score.mjs --ref` sets only `final`.

### 5.5 Known gaps

| Gap | State | Plan |
|---|---|---|
| Decalogue double cantillation (Ex 20:2-14, Deut 5:6-18, Gen 35:22; 27 verses) | Not handled. MAM superimposes both accent systems. Run unfiltered, the parser yields false units. | Wave 1: refuse these verses with a named error. Later: a hand-curated 27-verse `{tachton, elyon}` table and a per-reading switch, once open item 4 is settled. |
| Song of the Sea (Ex 15:1-19) | Scored with the regular cells, with `special: "song-of-the-sea"` and `specialCells: false`. | Labeled "regular trope" in the player until a table computes it (open item 5). |
| Journeys (Num 33) | As above, `special: "journeys"`. | As above. |
| Creation refrain | Partly done. The `creation:*` cells exist in `torah.json`, but nothing sets the flag automatically. | Wave 1: the flag from the verse list. |
| *Chazak chazak v'nitchazek* | Not computed. It is a fixed formula, not trope. | Open item 5. |
| Deut 1:12 in Eicha trope; Eicha-trope haftarot | Not handled. No Eicha table exists. | Open item 5. |
| Fallback visibility | `scoreVerse` does not copy the cell's `fallback: true` into `score.units[].cell`, so the "no fallback" checks in `trope-engine.test.mjs` (lines 22 and 47) cannot fail. A fallback is visible only as `id: "fallback:*"`. | Wave 1: carry the flag through; the test checks the id prefix too. |

## 6. Renderers

Confirmed by voice-feasibility.md (2026-10-15): step 2 rendered I Samuel 20:18 end to end, Windows-native on the GTX 1660 Ti, with 33 of 33 pitched notes within half a semitone of the score. The ladder runs from cheapest to best. Each step consumes the score JSON unchanged.

| Step | Renderer | Input beyond the score | State |
|---|---|---|---|
| 0 | **MIDI audition.** `scoreToMidi`: format 0, PPQ 480, a lyric meta event with each syllable's phonemes | none | Exists |
| 1 | **Floor: dependency-free concatenation.** A Node renderer, using no packages, pitch-shifts and time-stretches a small bank of syllable units (CV syllables and sustained vowels at three pitches, made once from the stock voice) to the score's notes and durations. The result is melodically exact and plainly synthetic. It is the low anchor in listening tests. | the unit bank | Planned |
| 2 | **Zero-shot score-driven singing synthesis.** SoulX-Singer (Apache-2.0) takes notes, phonemes and a prompt clip. A JS emitter writes its metadata from the score: per syllable, ARPAbet tokens from the profile's `symbols.arpabet`, `note_pitch` from `midi`, durations in seconds, and `note_type` 2 for a syllable's first note, 3 for `slur`, 1 for rests. Hebrew goes through a hand-mapped ARPAbet table, with Mandarin tokens for ח and צ to be tried. | a prompt clip | Works locally: fp16, Python 3.12, torch 2.2.0+cu121, 2.9 GB of GPU memory, about 86 s per 14 s verse, so a haftarah is about 35 min and the annual cycle a few overnight batches. The free Space is for quick comparisons only. The emitter must send an all-zero f0 string, not an empty one. |
| 3 | **Optional voice conversion.** SoulX-Singer-SVC or RVC/Applio polishes the step 2 output, with the score's pitch as the F0 input, so the melody is never re-estimated. | the prompt voice | Optional |
| 4 | **Ceiling: fine-tuned DiffSinger.** A real Hebrew phoneme dictionary generated from `pronunciation.json`, labels generated from the scores, SOFA/HubertFA alignment, OpenUtau or CLI rendering on CPU. A PocketTorah-derived base is allowed privately (ruling 4). The published voice must not be the PocketTorah reader's. | training data and a GPU | Later |

- **Offline only.** Rendering is a batch job run by Daniel or Claude on a local machine or rented or free GPU, never at request time and never on Vercel. The output is a mono MP3 per verse, loudness-normalized as in 2.0 section 5.9, uploaded to the separate public audio Blob store that the 2.0 spec defines.
- **The voice.** Whose voice it is does not matter (ruling). A voice that belongs to nobody does not exist for this model, which has no speaker embedding to interpolate. The model's shipped prompts are stems of commercial pop recordings and serve internal tests only. The published prompt is either Daniel's own 20-30 s clip (voice-feasibility.md's default: no licence stack, no consent question) or an anonymised VocalSet male singer (CC BY 4.0; the singers never consented to cloning, so it is credited and logged). Open item 1.
- **The weights and the environment** live outside the repo, in `C:\Users\dsbog\haftarah-audio\` (checkpoint, venv, renders). Nothing from it is committed or uploaded except the finished MP3s.
- **The renderer for Wave 3** is the lowest step that passes the gates in section 7.

## 7. Evaluation gates

Adapted from prior-art-and-evaluation.md section 5. There is no cantor reference take, so the melodic gate measures the render against its own score. A render that fails a hard gate is not published.

| Gate | Check | Fail |
|---|---|---|
| **G1 Melody** (automatic) | Track f0 with RMVPE or SwiftF0 (FCPE as a second opinion; pYIN only for a sanity plot), segment it into notes, and align the notes to the score's events in order. Every scored note must be present with its median f0 within ±50 cents of `midi`, and no extra pitched note may appear. Rhythm is free, so durations only warn. | Hard: a missing, extra or off-pitch note. Warn: the trackers disagree by more than 50 cents on more than 5% of voiced frames. |
| **G2 Technical** (automatic) | No clipping; loudness within ±1 LU of the target; length within ±15% of `seconds`; the phoneme count matches the score. | Hard |
| **G3 Listening** (human) | Daniel reviews each verse of the review set with the Hebrew in trope colors and marks pass or fail with reason codes: wrong motif, motif on the wrong syllable, pronunciation, phrasing or pause, artifact, would teach a learner something wrong. The class rates 10 items for naturalness (5 points), with the floor render as the low anchor, in under 10 minutes a session. | Publication needs at least 95% melody passes from Daniel on the review set and zero "would teach wrong". |

**Regression set.** The calibration corpora are the fixed set: 53 haftarah verses and 83 Torah verses, plus each new table's own sample verses. On every engine change, `npm test` re-scores them. Wave 1 adds a committed hash of each corpus verse's score JSON, so a table edit shows as a named diff. On every renderer or model change, the corpus is re-rendered offline and G1 and G2 run on every verse. Changed verses go into a one-page A/B report for Daniel. A render is promoted only after his G3 pass.

## 8. The web sheet

The 2.0 spec owns the player (section 5.9). This engine adds:

- **Per-verse audio by verse id.** Verse ids are the 2.0 spec's (section 4.3): `<reading>-<chapter>-<verse>`, for example `haftarah-54-3`. A side file `weeks/<slug>/chant.json` maps each id to its audio, per table: `{ "tables": { "<table-id>": { "label", "source", "verses": { "haftarah-54-3": { "src", "seconds" } } } } }`. MP3s live in the audio store at `chant/<table-id>/<hash>.mp3`. The hash is the sha256 of the score JSON plus the renderer version, so a verse with the same flags is rendered once and reused across weeks and years. The index gains `hasChant`. Publish lists the file the way 2.0 section 4.7 lists side files.
- **A nusach selector.** It sits in the Aa card and lists the tables in `chant.json` in menu order (section 4.5). The choice is remembered per device under `haftarah:v1:`.
- **The label.** "AI-generated. Melody computed from the te'amim; voice synthetic." It appears beside the player while generated audio plays, with the table's name and source in the footer's credits. The wording is shown to Daniel before it ships.
- **Trope colors.** The sheet already has this mode (Aa card; `template/trope.css`). The audio uses the same phrase families, because `text.mjs` takes them from `lib.js`, so what is colored and what is sung always agree.

## 9. Waves

| Wave | Delivers | Exit test |
|---|---|---|
| **1. Score engine** | Done: text front end, both Binder/Avery tables, melody engine, MIDI, `trope-score`, `trope-fetch`, corpora, tests. Remaining: carry `fallback` into the score; reading flags derived from `readings[].aliyot`, the book ends and the Creation verses; refuse the Decalogue verses; corpus score hashes. | `npm test` green. Every corpus verse scores in both tables with no fallback, checked by id. Flags derived from an aliyot list equal the fixture flags. A Decalogue verse raises the named error. |
| **2. First renderer and listening review** | The score-to-SoulX emitter and the ARPAbet map from `symbols`; the floor renderer; the stock prompt voice; G1 and G2 as an offline script; renders of the 20-verse haftarah core and the 31-verse Torah core; one listening session with Daniel and one with the class. | All core verses pass G1 and G2. Daniel's G3: at least 95% melody passes, zero "would teach wrong". The renderer for Wave 3 is chosen. |
| **3. Web integration** | The batch render of a week's readings to the audio store; `chant.json` and `hasChant`; the player playing generated verses (using 2.0 Wave 5's store and player, or the minimum of 2.0 section 5.9 built here if Wave 5 has not shipped); the selector; the label; CSP `media-src 'self'`. | A published week plays any verse of both readings in Binder/Avery with the verse highlighted and the label shown. A re-delivered week re-renders only verses whose score changed. |
| **4. More nusach tables** | The section 4.4 extensions and the Sephardi profiles; the tables in menu order, haftarah then Torah per option. Each table is transcribed from its cited source with cell-level citations. | Per table: every haftarah corpus verse (and Torah corpus verse, for a Torah table) scores with no fallback. The table's printed sample lines re-score to the source's notes. Its profile's symbols all map to the renderer. G1 to G3 pass on its core set. |

## 10. Out of scope

- Recording or cloning any living person's voice, including the cantor's. The 2.0 spec's recordings remain separate.
- Rendering at request time. Rendering in the browser.
- Publishing a model, prompt clip or source audio. PocketTorah audio on the site.
- Megillot and Eicha tables. Psalms, Proverbs and Job (a different accent system).
- Word-level karaoke (2.0 non-goal). Record-yourself scoring.
- The Yemenite, Italian, Western Ashkenazi and Chabad tables (after the first four).
- Triennial aliyah ends (hebcal full kriyah is the ruling).
- Speaker-similarity metrics, since there is no reference voice to measure against.

## 11. Open items

1. **Prompt voice and first listen.** Daniel listens to the first renders in `C:\Users\dsbog\haftarah-audio\renders`, then picks the published prompt: his own clip, or a VocalSet male singer (licensed, never consented to cloning).
2. **Compute.** Local on the GTX 1660 Ti is the baseline and needs no WSL2. Whether to also pay for HF PRO ($9 a month) or a rented GPU to render the cycle faster.
3. **CRC's aliyah cut points.** Hebcal's ends are the default. Should a per-week override come from CRC's actual cut points now or later (torah-grammar.md Q10; 2.0 spec open item 4)?
4. **Decalogue system.** Elyon, tachton, or elyon on Shavuot only. Tiberian or printed verse division. Whether the 27-verse table may be derived from Wikisource MAM (CC BY-SA 4.0) and shipped under that licence.
5. **Special melodies without a cantor.** For the Song of the Sea, Journeys, the Chiefs, *chazak*, Deut 1:12 and the Eicha-trope haftarot: does each get a published-table melody, regular trope with a label, or nothing? The same question applies to each nusach's special tunes (S&P Dipuranita, Moroccan Three Weeks).
6. **Buying Jacobson** (needed for option 2), and optionally Portnoy and Wolff and Tunkel.
7. **Does a 1929 Idelsohn notation count as "standard"**, given that living Moroccan and Syrian practice may differ? Which Moroccan (general or Spanish-Moroccan)? Which Syrian (no. 312's closing form or no. 328's Aleppo study mode)? Should Jerusalem Sephardi be a separate option?
8. **Pronunciation default for the Sephardi tables.** The table's own profile (pharyngeal ח and ע, S&P ע as "ng") with Israeli as an override, or the reverse.
9. **Copyrighted-edition sources.** Transcribing Jacobson and the 1965 S&P book to degrees, with citations, never reproducing pages.
10. **Torah tables for the Sephardi options.** Build them with each haftarah table, or do haftarah first across all options.
11. **The Binder/Avery citation.** Check today's two tables against a printed Binder (*Biblical Chant*) or Portnoy and Wolff source, so the citation rule holds for option 1 without TropeTrainer as the intermediary.
12. **The TropeTrainer-only variants.** Keep `rosowsky` and `common` as variants, or remove them once a citable Ashkenazi table exists. Is "Common Melody" ever its own option?
13. **Defaults where a table leaves a choice.** Elision (off), the natural or raised 7th before sof pasuk (natural), the Torah sof pasuk low or high (low). Daniel confirms by ear in Wave 2.
14. **Festival and Simchat Torah readings.** In scope from Wave 3, or weekly Shabbat first (torah-grammar.md Q11)?
15. **Publishing the cell tables.** Their licence in the public repo, now that they are transcriptions of published tables.
16. **The class as listeners.** How many sessions a season.
17. **Generated and recorded together.** If the cantor later records under 2.0 open item 1, does his recording replace the generated audio for that reading, or sit beside it as another option?

## 12. Research

In `docs/superpowers/research/2026-10-15-trope-engine/`:

- `README.md`: round 1 synthesis, Daniel's rulings, the round 2 index.
- `trope-grammar.md`: the haftarah grammar, the Binder/Avery cells, syllable fitting, units, the calibration corpus.
- `torah-grammar.md`: the Torah table, aliyah and book ends, the Decalogue, special melodies, rare te'amim, hebcal data.
- `hebrew-text-pipeline.md`: markup, syllables, stress, phonemes, the vendoring rule, edge cases, validation.
- `synthesis-survey.md`: singing synthesis in 2025-26, pipelines A, B, C and E, the smallest experiment.
- `prior-art-and-evaluation.md`: other traditions, labeling and alignment, evaluation, consent.
- `nusach-tables.md`: sources for each nusach, the engine extensions, pronunciation coupling, the recommended order.
- `voice-feasibility.md`: the prompt voice, compute, a first rendered Hebrew verse (section 6 of this spec waits on it).
