# Trope engine: research round 1 (2026-10-15)

Goal: Cantor Josh Finkel records as little as reasonably possible; software and AI render any haftarah verse chanted in his voice, the melody computed from the te'amim. This reverses the 2.0 spec's "record everything, AI later" (chant-audio.md); amend the spec once the decisions below are taken.

Four reports, read in this order:

| Report | Question | Bottom line |
|---|---|---|
| `trope-grammar.md` | How small is the musical grammar, and what is the minimal recording? | One Eastern Ashkenazi haftarah style is ~44 melodic cells, 3 syllable-fitting rules, ~130 recordable units. A 39-verse calibration corpus covers every cell and every frequent context. **~25-27 min of finished audio, 2-2.5 h in the studio.** TropeTrainer 3.2's melody tables were recovered from the archive.org ISO and confirm the cell/upbeat/context model (reference design only; Kinnor's data). |
| `hebrew-text-pipeline.md` | Masoretic text to syllables, phonemes, stress. | Pure JS. havarotjs (MIT, written against Sefaria's MAM text) got every syllable boundary and stress right on the sample verse and the full Machar Chodesh haftarah. MAM already doubles pashta/zarka/segol/telisha on the stressed syllable. Vendor havarotjs' ESM dist (~80 KB) like the fonts; write the resolver, stress and phoneme layers ourselves. Sefaria's v3 endpoint (already used by fetch.mjs) returns MAM for any ref. |
| `synthesis-survey.md` | The voice: 2025-26 state of the art from minimal data. | Zero-shot score-driven singing synthesis exists since Feb 2026 (SoulX-Singer, Apache-2.0: notes + phonemes + a 10 s prompt clip). Nothing has Hebrew; phonemes must be hand-mapped. Three pipelines: A zero-shot (2-5 min of Josh), B zero-shot guide + voice conversion (10-20 min), C DiffSinger fine-tune (25-30 min, highest ceiling, 3-4 weekends). One 35-45 min session serves all three. Commercial cloning is a dead end (singing forbidden or no Hebrew). |
| `prior-art-and-evaluation.md` | What other traditions did; labeling; proving correctness. | No tradition has "notation in, reciter's voice out"; every working system takes the melody as explicit input, so a deterministic melody engine feeding a synthesizer is the right shape. Labeling: rule G2P, MMS/ctc first pass, hand-correct a 10-min seed, train SOFA/HubertFA on it. Evaluation: three gates (RMVPE contour vs expected motif with Needleman-Wunsch per ISMIR 2011; speaker-embedding cosine vs his real takes and PocketTorah negatives; cantor blind ABX + pass/fail with reason codes, zero tolerance for "would teach wrong"). A 30-verse regression suite re-rendered on every engine change. |

## The architecture that falls out

```
Sefaria MAM text (any ref)
  -> word parser (maqaf chains, legarmeh, ketiv/qere, divine name)      [JS, ours]
  -> havarotjs syllables + stress                                        [JS, vendored MIT]
  -> phonemes per the cantor's pronunciation (pronunciation.json)       [JS, ours]
  -> cell selection: trope x context (before/after/group/last verse)     [JS, ours; cell table = Josh's melodies]
  -> syllable fitting (drop/repeat upbeat, mil'el last note)             [JS, ours]
  -> per-verse score JSON: syllables with phonemes, stress, notes, durations, melisma grouping
  -> renderer: A SoulX zero-shot | B + voice conversion | C DiffSinger | E WORLD concatenation (floor)
  -> pre-rendered MP3 per verse in the audio Blob store (2.0 spec section 5.9 unchanged)
  -> evaluation gates + cantor review before anything is public
```

The score JSON is the contract between the two halves; the renderer is swappable and the models are disposable. The WAVs and the cell table are the durable assets.

## Recording plan (one session, ~45 min studio, ~25-30 min audio)

1. Spoken consent statement (30 s).
2. Prompt clips: 6-8 verses of 8-15 s at comfortable, high, low, slow; one on "la"; one with the final cadence.
3. The ~130 units: every cell in three syllable shapes on a neutral syllable (or the trope names, which double as the learner drill).
4. The 39-verse calibration corpus (586 words; a 20-verse core if time is short), each verse its own take; 10 of them twice, for the human-variance band.
5. The 4 end-of-haftarah patterns, each into the opening of the after-blessing; the blessings.
6. ~120 CV syllables and sustained vowels at 3 pitches (insurance for phoneme coverage; needed by C and E only).

## Before Josh records anything: the one-weekend mechanics test

Render one verse six ways from PocketTorah CC BY-SA audio and Daniel's own voice (synthesis-survey.md section 6). Go/no-go for pipeline A is whether Hebrew through English phonemes is intelligible and the cadence survives.

## Decisions pending (collected from the four reports)

For Daniel: scope (haftarah cycle only vs any verse in the Prophets; Torah later), CRC's ranges vs hebcal's, the quality bar for a public labeled AI voice (accented-but-correct vs native-sounding), whether CC-BY-NC tooling and a PocketTorah-derived share-alike base model are acceptable for an unpublished model, vendoring havarotjs, publishing the cell table, and amending the 2.0 spec.

For Josh: which melody table (three diagnostic cells settle it: sof pasuk approach, etnachta melisma or syllabic, final cadence degree), the munach-before-zakef, tevir and double-pashta variants, elision, pronunciation parameters (ר, ח/ע, ת rafe, qamats, tsere, vocal shva, dagesh forte), what counts as a teaching error vs his own variance, the three consent grants, and one 45-minute session.

## Rulings (Daniel, 2026-10-15)

1. **Scope: haftarah and Torah.** The engine carries two cell tables; the text pipeline is the same.
2. **Ranges: hebcal's traditional ranges.**
3. **Quality bar: accented-but-correct ships.** "Sounds right, melodically correct, slightly American on resh and chet" is acceptable for a labeled AI voice.
4. **Licensing: use what exists now.** CC-BY-NC aligner weights and a PocketTorah-derived share-alike base model are fine for private, unpublished models.
5. **Josh's recording is optional.** If the result can be great and human-sounding without him, that is fine. He records only if it costs no significant extra work and sounds better. So pipeline A with a stock or Daniel's own prompt voice is the baseline; Josh's clip is an upgrade, not a dependency.
6. **Stay on this branch** without amending the 2.0 spec yet; make the branch visible to main and the other coder.

## Round 2 (same day, after the rulings)

| Report | Bottom line |
|---|---|
| `torah-grammar.md` | Avery/Binder Torah table: 51 cells (43 core + 4 end-of-aliyah + 4 end-of-book), same fitting rules, five Torah context flags (end of aliyah, end of book, Creation refrain, Journeys, Song of the Sea), a fifth aliyah-end pattern (etnachta then silluq, no tipcha), the rare marks (shalshelet x4, mercha kefula x5, karnei farah + yerach ben yomo x1), a 31-verse core / 54-verse full calibration corpus, hebcal `fullkriyah` for the 457 aliyah-final verses, and the Decalogue's double cantillation in MAM. |
| `nusach-tables.md` | Sources for the option menu. Idelsohn's *Thesaurus* (public domain, archive.org) carries the Moroccan, Gibraltar, Oriental-Sephardi and Aleppo haftarah tables; Jacobson for Ashkenazi traditional (book needed); the 1965 S&P prayer book for Spanish & Portuguese. Recommended order after Binder/Avery: Ashkenazi traditional, Moroccan, S&P, Syrian. Moroccan, Gibraltar, Syrian and Yemenite are reciting-tone traditions where several te'amim share one figure, so the engine needs cell aliases, a reciting-tone default for unlisted marks, a per-table degree map (quarter tones for Syrian), and a Sephardi pronunciation profile. |
| `voice-feasibility.md` | (pending) The prompt-voice question and a first Hebrew render through a zero-shot singing model. |

## Built the same day (on the branch)

`trope/text.mjs` (Sefaria MAM to syllables, stress, phonemes; havarotjs vendored), `trope/melody.mjs` (cell selection, syllable fitting, cadence flags), `trope/cells/haftarah.json` and `trope/cells/torah.json` (Avery/Binder), `trope/midi.mjs`, `scripts/trope-score.mjs --ref "Book c:v-c:v"` (any reading from Sefaria to a table and a MIDI), `scripts/trope-fetch.mjs`, calibration corpora (53 haftarah verses, 83 Torah verses) and tests (`tests/trope-*.test.mjs`); `npm test` 183 passing.
