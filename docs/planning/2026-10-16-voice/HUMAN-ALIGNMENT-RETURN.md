# Voice milestone 1 return: reviewed human alignment and retiming — 2026-10-16

Assignment: `docs/superpowers/plans/2026-10-16-claude-code-voice-handoff.md`, "First implementation milestone". Worked on branch `voice/human-alignment` in a separate worktree from published `origin/main` `29854eb`; the shared checkout's uncommitted service-learning work was not touched. No recording, real target, model, GPU, cloud, download, spend or student path was involved. Every waveform in the tests is synthetic (tones, noise, buzz); targets are invented syllables or existing permitted MAM fixtures.

## What exists now

| File | What it does |
|---|---|
| `trope/human-alignment.mjs` | `chant-human-alignment/v1`: one adult spoken take aligned to one target passage. Binds the pack manifest, identity map and B speech plan hashes, target hash, exact audio bytes and format, speaker/sample/take, consent record and six-flag consent scope. Per syllable: every onset consonant, the vowel nucleus and every coda consonant, plus pauses/breaths. Each span keeps a `proposed` boundary separately from the `reviewed` one; only reviewed boundaries are processed. A reviewed consonant may be `absent` only if it is ʔ or h (counted and warned); a vowel never. |
| `trope/human-retime.mjs` | Deterministic timing plan, render, F0/voicing and packaging (`chant-human-retime/v1`). |
| `trope/audio-dsp.mjs` | Strict WAV reader (PCM 16/24/32, float32, no truncation or clamping), explicit downmix policy, Kaiser-windowed-sinc polyphase resampler, WSOLA, float32 WAV and `.npy` writers. Dependency-free. |
| `trope/benchmark-run.mjs` | `chant-benchmark-run/v1` execution records and the blind-listening label map plus a separate identity key. |
| `scripts/trope-human-retime.mjs` | Offline CLI. Inputs and output must lie outside **every** Git working tree, checked on both the lexical and resolved paths (`scripts/private-paths.mjs`); hard-linked inputs are refused. The original take is re-hashed before outputs are written. Writes are exclusive: artifacts, then the manifest, then the run record. Errors are fixed and sanitized. |
| `tests/trope-human-retime.test.mjs` | 12 synthetic tests. |
| `scripts/repo-policy.mjs` (+ test) | Repository guard now refuses any data file carrying a private benchmark schema (`chant-benchmark-input/pack/identity/run`, `chant-human-*`, `chant-listening-*`), including under `trope/` and `tests/fixtures/trope/`. `privateBenchmarkDestination` (target-pack CLI) also refuses any Git working tree. |

Nothing in `trope/` gained a dependency. No engine, renderer or app behaviour changed. The two touched shared files are the destination check in `scripts/trope-benchmark-pack.mjs` and the repo guard; both are stricter.

## How the adapter works

- **Validation before processing.** Monotonic, in-bounds, positive-length intervals; from first to last phone every sample belongs to exactly one phone or one annotated pause/breath (gaps and overlaps reject); events only between syllables; every identity-map syllable exactly once, in order, with exactly its expected Phonikud phones; duplicate or missing identities reject. Stale manifest, identity map, plan or target hash, a mismatched recording (hash, rate, channels, frames, encoding), pending review, incomplete review, or `localProcessing: false` all reject before any audio is produced. Record IDs are retained as assertions, not as proof of consent or review.
- **Timing.** The existing B rule (`speech2sing.py impose`): each vowel starts on its first note; the vowel, its coda and the next onset share the span to the next vowel onset; consonants keep their reviewed length unless they exceed 60% of the span, are then shortened together (never below 0.5×, otherwise rejected) and logged. The vowel nucleus covers every note of a melisma: one vowel piece, no repeated consonants, no invented syllables. A phrase's first onset sits in the preceding rest; final codas sit inside the phrase's last note. Source pauses and breaths are dropped; target rests are digital silence.
- **Retiming method.** Consonants at ratio 1 are exact sample copies. Other ratios use WSOLA (20 ms Hann frames, ±5 ms similarity search), which keeps pitch but **is not harmless at large stretches**. In the long-melisma fixture, synthetic 90 ms vowels needed 10–79× stretches. Every piece records its ratio, and stretches above 8× produce warnings. Raised-cosine 5 ms fades are applied only at discontinuities, next to silence or across a dropped pause. Nothing is normalised.
- **Units and resampling.** Source boundaries are original-recording sample indices, mapped once by `round(s × out / in)` after the whole take is resampled (default 24 kHz, the SVC input rate). The target timeline is the identity map's executed integer milliseconds in output samples.
- **F0/voicing.** Score F0 comes from the same B plan notes (`scoreF0` defaults, sampled from a 1 kHz curve at each 50 fps frame start). Voicing comes from the retime map at frame centres: 0 over silence and voiceless consonants (`p t k f s ʃ χ h ʔ ts`); vowels and voiced consonants get the score pitch, or the nearest nonzero score pitch where the curve is 0 (counted). Written as JSON and as SoulX-SVC-compatible float32 `.npy`.
- **Split joins.** SVC slices follow the target's segment boundaries. A boundary that is not inside silence or exactly at a syllable attack moves back to the latest silence midpoint or syllable attack, so a syllable's onset always travels with its vowel. Shifts over 2 s, cuts still inside a phone, and slices over 30 s all reject. Slices rejoin sample-exactly to the full timeline, and each slice has its own F0 grid.
- **Run records** bind input/output/config/model hashes to every attempt, failures included (sequential; success only last; sanitized error codes; peak memory with its source). Neural stages require a model record; non-neural stages forbid one. Any seed claim is refused, because no existing SoulX wrapper exposes a verified seed. **Listening labels** are drawn from injected cryptographic randomness. The reviewer file holds only label and review-copy hash; lane, run and passage live in the separate key.

## Commands and results (Windows, Node 24)

- `node --test tests/trope-human-retime.test.mjs`: **12/12 pass**.
- `node --test "tests/**/*.test.mjs"`: **164/164 pass**: the 152 previous tests, including the target-pack, engine, isolation and never-in-repo checks, plus 12 retime tests and 1 repo-guard test.
- `npx vitest run` (app, unchanged by this branch): **589 passed, 1 skipped**. An earlier run had 1 failure that did not reproduce. It ran alongside `npm ci` and the reviewer's load, and its test was not identified before the rerun.
- Independent adversarial review: see "Review" below.

Private artifact hashes: **none.** No real private input, recording, target pack or output was created.

## Evidence versus hypotheses

Established, on synthetic signals only: identity and duration preservation, vowel-on-note, single-consonant melisma, final-consonant placement, voiced/unvoiced F0 masking, split behaviour, determinism, input rejection, private-path containment and sanitized CLI errors. Not established: how WSOLA-stretched real Hebrew vowels sound, whether SVC preserves consonants from this source, alignment accuracy from any tool, or anything about teaching quality.

Implemented but unexecuted: the CLI on a real take. A failed CLI run prints a sanitized code but writes no run record; failed attempts are expressible in `chant-benchmark-run/v1` and must be recorded by the SVC runner; SVC on these outputs (the existing `trope/soulx_svc_runner.py` job schema takes `wav`/`f0`/`prompt_f0`/`out`, so slices map onto it directly, but no run was made). Not implemented: the DSP-only pitch baseline (its role is reserved and reported as `not-produced`; the next step is a WORLD resynthesis like `speech2sing.py world_pitch` over `retimed-speech.wav` + `target-f0.npy`), loudness-matched review copies, and a CLI for listening keys.

## Remaining blockers and requests for Daniel

1. Target and pronunciation review of P01, P02, P09 and P11 (key, tempo, difficult phones), so that real packs can carry a target review record.
2. Donor and voice-use scope: who records, and which of the six consent flags apply. Retiming needs `localProcessing`; SVC needs `voiceConversion`. Training, cloud processing and distribution stay off unless granted.
3. The four paired spoken/sung takes, the dry prompt and room silence, per the benchmark plan's protocol.
4. Later: checkpoint/weight terms before any download, spend for cloud, and blind listening.

## Exact next action

Implement the DSP-only WORLD baseline and an SVC job adapter that consumes `slices/*.wav` + `slices/*-f0.npy` and writes `chant-benchmark-run/v1` records with real GPU memory. Then build lane A for the same four passages. Annotate the first real take only after items 1–3 above.

## Review

An independent adversarial reviewer ran two passes.

**First pass: accept with fixes.** It found two medium problems:
1. A split exactly on a vowel start left that syllable's onset consonant in the previous SVC slice. This happened at 29 of the 37 rest-less split points in the 83 MAM fixtures.
2. The containment check protected only this worktree, not the shared main checkout.

It also raised seven low findings: unlimited absent consonants, manifest wording, incomplete code hashes, seed claims, a run-record un-blinding note, a loose extensible-WAV check, and the repo guard missing these schemas.

**Second pass: accept.** All findings are resolved, except that a failed CLI run still writes no run record; that is documented above. The reviewer re-ran the retiming property survey across the 83 fixtures and mixed sample rates: no syllable spans a cut, output is byte-identical on repeat runs, and per-slice F0/voicing matches an independent recomputation. It also probed containment with the main checkout, junctions, 8.3 short names, `\?\` and UNC path forms, and hard links. The retimed outputs carry no learner release path, and G3 is untouched.

Residual gaps, both low:
- Per-passage target-pack files (`units.json`, `score.json`, `a-soulx-target.json`, `b-speech-plan.json`) carry no `schema` marker. The repo guard therefore catches them outside `trope/` and `tests/fixtures/trope/` only as unlisted data files.
- A hard-linked input is refused even when both links are outside any repository. That is a deliberate usability cost.

## Coordination (2026-10-16, for Codex)

**Acknowledged:** `C:/Users/dsbog/bneimitzvah/docs/planning/2026-10-16-parallel-work/COORDINATION.md`.
- I keep the ownership listed there and work only in `C:/Users/dsbog/bneimitzvah-voice` on `voice/human-alignment`, with its own dependencies.
- I won't edit another stream's files, the coordination file or the original checkout's STATE.

**Frozen checkpoint for integration:** `24778d3`, pushed to `origin/voice/human-alignment`, with CI green on Windows, Ubuntu, Postgres and browser.
- Files changed: `trope/{audio-dsp,human-alignment,human-retime,benchmark-run}.mjs`, `scripts/{trope-human-retime,private-paths}.mjs`, `tests/trope-human-retime.test.mjs`, and this note.
- Shared files changed: `scripts/repo-policy.mjs`, `tests/repo-policy.test.mjs` and `scripts/trope-benchmark-pack.mjs` (`privateBenchmarkDestination`).

**About `scripts/repo-policy.mjs`:** the voice change is additive.
- It adds one constant, `PRIVATE_BENCHMARK_SCHEMA`, and one rule in `entryProblems`: data files whose `"schema"` is `chant-benchmark-(input|pack|identity|run)/`, `chant-human-*/` or `chant-listening-*/` are flagged, even under `trope/` and `tests/fixtures/trope/`.
- The test for it is "private chant-benchmark records are rejected even under the engine and fixture allow-lists" in `tests/repo-policy.test.mjs`.
- It doesn't touch the font rules, so keep both when you reconcile.
- `scripts/private-paths.mjs` (`insideGitWorkingTree`) is new and voice-only, but it now also guards the target-pack CLI destination.

**Integration request:** none yet. This branch has no app, UI, schema or provider changes and no student path, so it can merge on its own whenever you integrate. G3 is untouched.

**Since `24778d3`:**
- Daniel recorded one private take: an iPad Voice Memo, Genesis 11:1–2, spoken and then a self-described Moroccan-style chant.
- It's stored outside every repository at `C:\private\chant-benchmark\recordings\2026-10-16-daniel\`.
- It has a consent record: private playback, local processing, voice conversion, and cloud processing for this file. Training and distribution stay off.
- Nothing from it is in Git.

**Next checkpoint (separate commit):**
1. Build a Genesis 11:1 target pack in the private folder.
2. Machine-propose alignment boundaries, using a locally run aligner whose license is checked first.
3. Give Daniel a word-by-word listening review, recorded explicitly as word-level review, with the sound-level boundaries kept as proposals. This needs a small, separately reviewed schema change for review granularity.
4. Set up the local SoulX environment outside the repo (free, Apache-2.0; a few GB of downloads).
5. Produce the first real retime and SVC output for Daniel's listening only.

**Message to the UI stream:** none blocking. The only shared file is `scripts/repo-policy.mjs`, as above.

## First real listening result (2026-10-16, private)

**Lane A, SoulX score model.**
- Input: the V'ahavta target (Deuteronomy 6:5–9, v2 phrasing, D3, tempo 96), with a 20 s voice sample from Daniel's own Binder/Avery chant.
- Run on the RTX 4070: 77 s of audio in 56 s wall time, peak 2,016 MiB allocated and 3,752 MiB reserved.
- A private run record is in the run folder (no seed control).

**Daniel's blind-free verdict:** "pretty awful… almost a Peruvian accent, with a number of odd sounds. And the speed is super inhumane and unnatural."

Recorded as a **diction failure** for lane A on this passage. Two causes:
1. **Accent:** SoulX realises Hebrew through English ARPAbet and Mandarin substitutes.
2. **Pace:** the engine's grid timing. It affects every lane, not just A.

**Decisions taken from this result (GATE: proceeded because Daniel gave the verdict and the plan already rejects tuning a failed lane):**
- No further A tuning.
- Next is B-human (Daniel's spoken V'ahavta), first on the engine timing.
- Then on a human-timed target, with syllable durations measured from Daniel's sung V'ahavta. That variant changes the target timing only; notes and text stay the same. It is a benchmark condition, not an engine change.

## Second real listening result: B-human (2026-10-16, private)

**Run:** lane B-human on the full siddur V'ahavta (Deuteronomy 6:5–9 and Numbers 15:40–41), engine grid timing.
- Source: Daniel's spoken take.
- Alignment: the machine proposal, boundary rule `onset-20ms`, with spectral cuts at vowel-to-vowel joins between words.
- Review: word-listening review `review-daniel-vahavta-words-1`. It is recorded as accepted for a diagnostic run: vowel-to-vowel joins are not tight by ear, which Daniel accepted as inherent to connected speech.
- Retime: all 7 verses passed with no rejections. Warnings: 34 vowel stretches above 8× and 6 notes mostly consonant.
- SoulX-SVC on the RTX 4070: 115 s of audio in 86 s wall time, including the model load; peak 2,419 MiB allocated.

**Daniel's verdict:** "It sounds really really fake, but it is an improvement."

**Reading:**
- Native Hebrew input improves on lane A's foreign-phone diction.
- The remaining fakeness is attributed provisionally to grid timing and large vowel stretches. This is not yet separated by experiment.

**Measurement:** Daniel's sung V'ahavta runs about 71 s against the engine's 115 s for the same 196 syllables. Per verse it is 45–74% of engine length. Median sung syllables are 0.20–0.32 s, ranging 0.06–2.08 s, against the engine's near-constant 0.313 s. These come from a CTC alignment of singing, unreviewed.

**Next condition:** a measured-timing target (same notes and text; syllable durations from the sung take), then B-human on it.

## Listening iterations after B-human (2026-10-16, private)

| Run | Change | Daniel's verdict |
|---|---|---|
| B-human, sung-time v1 | Syllable lengths measured from Daniel's sung V'ahavta. Median vowel stretch fell from 3.40× to 1.82×; stretches above 8× fell from 34 to 6. | "Still somewhat inhuman, but better." Words ending in ך, ח or ה are cut off. |
| sung-time v2 | Phrase-final release into the rest (the take's own decay, or the final vowel sustained). Measured syllables kept whole. | "Better." Many final ך still cut off. The first word "almost sounds French". |
| sung-time v3 | Final syllables measured by the loudness fade (the CTC estimate was 0.04 s; actual 0.18–0.40 s). The verse-final rest is kept under measured timing, and there is a bounded tail release. | Pending. |

**Diagnoses with evidence:**
- **Verse-final ך:** two defects stacked.
  - The CTC "end" is the onset of the last span. It measured held finals at 40 ms, clamped up to 60 ms.
  - `applyMeasuredTiming` dropped the verse-final rest, so there was no room to release.
  - Both are fixed in `c265184` and the v3 input.
- **Mid-verse -ךָ before a vowel-initial word:** the accepted vowel-to-vowel join imprecision.
- **"French" first word:** a hypothesis. The spoken take reduces unstressed vowels; the phone decode shows "…haftə". A reduced vowel held for 0.5–0.6 s may sound like a French "e".
  - Proposed remedy: a slower spoken take with full vowels.
  - Alternative: select vowel material from stressed instances.

**Second independent review (`21a50c2`..`d0dafe3`): accept with fixes.** All findings are fixed in `3cb9436`:
1. A release-cursor regression with absent consonants.
2. Word-listening review not bound to its own passage.
3. Non-increasing aligner boundaries possible at vowel joins.
4. The v1 breath accounting was wrong.

Later changes (`c265184`: verse-final rest and tail) have not been independently reviewed yet.

## Latest listening results (2026-10-16, private)

| Run | Change | Daniel's verdict |
|---|---|---|
| sung-time v3 | Final syllables measured by loudness; verse-final rest kept; bounded tail release. | Three words still wrong: "ve'ahavteh", "elohechaM", "anochiN". |
| v4 | Steady-middle vowel stretch (`d2ba4f3`). | **"No change."** The hypothesis is refuted for these three words. The change is kept as a general improvement; it is not a confirmed fix. |
| v5 | Voiced-closure (murmur) boundary rule (`2ada343`, `--murmur-db 5`). Measurement showed about 90 ms of low-band hum, already closing for ב, counted as the end of the "a" in אֱלֹהֶיךָ. 14 boundaries before b, d, m or n moved 20–81 ms. | **"This is much better. We're getting there."** |

The v5 word review is recorded as provisional (`review-daniel-vahavta-words-2p`), because the moved cuts were not re-heard word by word.

**Remaining, attributed to the spoken source rather than the pipeline:**
- **"teh":** the final vowel of וְאָהַבְתָּ is reduced in the spoken take.
- **"anochiN":** Daniel read מְצַוְּךָ without the sung sheva ("mtsavcha"). The aligner then placed the target's "e" over מ hum.

**Requested from Daniel:** a slow, deliberate spoken take with every vowel and every sung sheva sounded.

**Third independent review (`c265184`, `d2ba4f3`, `2ada343`): accept, no correctness defects; 171/171.** Its non-blocking findings are fixed in `4002d98`:
1. Short vowels could be stretched from a single looped 20 ms grain. The stretched middle now keeps at least two WSOLA frames, and a `vowel-middle-stretch-high` warning reports the heard ratio.
2. The verse tail could push the last slice past 30 s or the passage past 180 s. It is now capped by both limits.
3. `retime-map.json` labels the tail (`units.target`, `totalMsCovers`).
4. The tail path is tested with a target that has no final rest.
5. Voiced-closure moves are capped at 120 ms, re-checked for 5 ms spans, and traceable (token, word, clip time).

Not changed: the reviewer's concern that the hum test may fire inside whole i, u or o vowels. Watch the move counts.

## Slow spoken take (2026-10-16, private)

Daniel recorded `2026-10-16-daniel-vahavta-spoken-slow` (216 s). It holds three readings: a slow one, restarted ("I'll do it again"); a complete slow one (90–164 s, used); and a quicker one. The used reading runs about 72 s, against about 71 s for his chant, so the median vowel ratio fell from 1.4–2.6 to about 1.0.

Its held word-final consonants did not fit the short maqaf notes: ל of about 250 ms, and final ת with about 100 ms of silent closure. Five of seven verses failed `consonant-fit` at the 0.5 floor. The retime CLI gained `--min-consonant-ratio` (0.2–1, default unchanged, recorded in the retime manifest's options), and the take was rendered at 0.25 as run `vahavta-Bhuman-slow-v6b`. Word review `review-daniel-vahavta-slow-words-1p` is provisional; nothing in this take has been heard word by word.

GATE: lowered the consonant floor for this take only — proceeded because the extra length is silence or a steady sonorant, it is a run option rather than a new default, and the render is private research audio under G3.

**v6b verdict (Daniel):** "another great step forward", but "some of the final ך are now too breathy".

**Measured cause:** the slow reading pauses after more phrase ends, so 16 releases switched from a sustained vowel to a 150 ms copy of the take's decay. That decay is unvoiced exhale: about 10–15 dB below the vowel, with an autocorrelation voicing score of about 0.2, held flat rather than decaying. SVC renders unvoiced F0 there as breath.

**Fix (run `vahavta-Bhuman-slow-v7`):** a final vowel or voiced continuant is now held, voiced, for the release, ending in at most `releaseBreathMs` (default 60) of the take's decay. Releases record `heldSamples`, `breathSamples` and the source `held-then-take-decay`. Awaiting Daniel's listening.

**v7 verdict (Daniel):** "Still a little too much. But this is seriously getting so just better. Now it's just nitpicking." The default `releaseBreathMs` is now 30, and run `vahavta-Bhuman-slow-v8` is awaiting his listening.

**Word flags on v8 (Daniel, on a private flag page that stores taps in its own database):** six final vowels ran long: אֱלֹהֶיךָ, לְבָבְךָ, יָדֶךָ, בֵּיתֶךָ, מִצְוֺתָי, מִצְרַיִם.
- Five of the six have 130–360 ms of silence after them in the chant. Measured timing had folded that silence into the syllable, and the emitter adds its own breath there too, so the pause was counted twice.
- Four of the six also had the v7 hold at full level.
- לְבָבְךָ has no gap in the chant; it is probably the known vowel-to-vowel join with וּבְכׇל.

**Fixes (run `vahavta-Bhuman-slow-v9`, pack `daniel-vahavta-siddur-sungtime4`):**
- Each measured syllable's longest silent run below −30 dBFS (10 ms frames) gives up all but 80 ms, and the cut is applied only when it is 100 ms or more, so in effect pauses of 180 ms or more are shortened. 3.69 s were removed; the timing record is `timing-daniel-vahavta-sung-3-silence-removed`. The step first ran as a one-off command; it is now `trope/chant-silence.mjs` (`chantSilenceCuts`, `removeChantSilence`), which reproduces the private record exactly (196 of 196 cuts, 3690 ms, identical timing).
- A held vowel now fades linearly from the start of its hold through the breath.

**v9 verdict (Daniel):** "Approved." He flagged no words on the second flag page (its `flags` collection read back empty). This approves v9 as the current state of the B-human research render. It is not the G3 listening review: no student hears it, and the formal review (at least 95% melody passes, zero "would teach wrong") is still to come.

**Fourth review (adversarial, 4002d98..44fc926):** no blocking defects. Release accounting, the fade's continuity into the breath, and source bounds were checked directly. Fixed:
- The v9 silence removal had no committed code. It is now `trope/chant-silence.mjs` with tests.
- `releaseBreathMs` of 1–19 ms was accepted but behaved as 0, since breaths under 20 ms are dropped. Only 0 or 20–400 is accepted now.
- Tests now tie the release record's `heldSamples` and `breathSamples` to the vowel and release pieces. The CLI test covers `--min-consonant-ratio`: values out of range are refused, and 0.25 is recorded in the manifest.

Left as noted:
- Commit 2ae2b5c's subject says the release keeps the *last* 60 ms of the breath. It keeps the first, continuous with the vowel. Pushed history is not rewritten.
- A hold under 20 ms is kept when a breath follows it.
- A sustained release records `releaseSamples` on its piece, not `heldSamples`.
- Vowel-stretch warnings are computed before the hold lengthens the final vowel.
- A word ending in voiceless ך (for example בַדֶּרֶךְ) still copies its full breath after a pause.

The test that the breath is not faded twice is still missing.

## Four passages: P01, P02, P09, P11 (2026-10-16, private)

Daniel recorded `2026-10-16-daniel-four-passages` (256 s, one take) from a script page: 9 s of room silence, then each passage spoken and then sung. Where he restarted, the last complete attempt is used; `segments.json` beside the take records the cuts and his remarks. The page's text was too small to read with glasses, and it has since been enlarged.

He said he made up the trope melodies ("the timing should be fine; just the melodies off"). So the targets use his chant's syllable timing, with the same chant-pause removal as V'ahavta v9, and the engine's own score for the melody: two packs, `daniel-four-torah-sungtime` and `daniel-four-haftarah-sungtime`.

GATE: timed the engine's melody to an improvised chant — proceeded because Daniel judged the timing sound, the melody comes from the score, and the render is private research audio under G3.

**Aligner change:** at a reading pause in P11 (1.6 s before וַיִּפָּקֵד), CTC had marked the word's first consonant straight after the previous word. The consonant then swallowed the pause and failed `consonant-fit`. `propose_alignment.py` now also counts a gap of `--pause` or more between a word's first consonant and the next phone as a pause before the word, with the consonant starting where the loudness rises. The other three passages' proposals are unchanged byte for byte.

Run `four-Bhuman-v1b` (floor 0.25, provisional word review `review-daniel-four-spoken-words-1p`): median vowel ratio 1.4–1.6 for P01, P02 and P09, and 2.2 for P11, whose spoken reading is faster than his chant. Awaiting Daniel's listening on a flag page.

**v1b verdict (Daniel):** "really impressive. Much better." He flagged 11 of 46 words, and said some were drawn out in weird ways, at least one was too fast, the ה/ח sound was off, and endings dragged or faded oddly.
- 9 of the 14 words with ה or ח/ך were flagged, against 2 of the other 32.
- 6 of the 7 held phrase endings were flagged.
- Every word with a vowel stretched more than 8 times was flagged except דָּוִד and יְהוֹנָתָן.

**Causes:**
- The spoken reading runs about 1.5 times faster than his chant, 2.2 times in P11. V'ahavta improved once its stretch was near 1.
- h and χ are voiceless, so SVC gets no F0 for 40–100 ms mid-line. Daniel's own h measures as partly voiced (autocorrelation 0.33–0.48).

**Next:**
- Daniel is recording a slow spoken take, paced against his own chant, which the script page now plays.
- A new retime option, `voicedPhones` (CLI `--voiced-phones h`, recorded in the manifest), carries the score F0 through listed default-voiceless phones. It will be rendered on and off for comparison.

## Lane B-TTS and modelled timing (2026-10-16, private)

Daniel: "It's gonna have to be tts." The route is the existing Phonikud-TTS path (`trope/speech2sing.py`, voice `michael`, non-commercial licence, accepted earlier by Daniel as an intermediate stage because SVC replaces its voice). The CPU environment was installed per the home-setup plan, section 5.

**Same targets as B-human v1b (run `four-Btts-v1`):**
- Whisper large-v3 character error is 0.26 for the TTS source against 0.44 for Daniel's own reading.
- Daniel flagged 11 of 46 words, mostly as "weird reverb sounding things or extra long pronunciation or both". 8 of the 11 were also flagged in B-human.
- So the shared cause is the target timing, not the source. Flagged words run 1.55 times the model's typical length, against 1.31 for unflagged words. The worst are מֹשֶׁה at 2.8, its final syllable 2.1 s, and לֹא at 4.1. His improvised P11 chant is slow throughout.

**Timing model (`trope/timing-model.mjs`, tests in `tests/trope-timing-model.test.mjs`):**
- log(ms) = global + gamma·log(notes) + three nested effects: the syllable's place against its word's accent; that place by accent role; and that place by accent name, with verse-final or phrase-final marked. Each effect is a median shrunk by n/(n+6), with gamma 0.5.
- Leave-one-verse-out over 11 verses (306 syllables): mean |log error| falls from 0.452 for the engine rhythm, scaled, to 0.373.
- It wins on all seven V'ahavta verses; the four improvised verses are about even.
- The fitted model is derived from private recordings and lives at `C:/private/chant-benchmark/models/timing-daniel-v1.json`, not in the repo.
- Packs now accept `timing.source: "modelled"` and say so in their manifest.

**First fully unread render (run `unread-Btts-v1`):** Genesis 1:2, Genesis 1:3 and I Samuel 20:19. The engine melody, modelled timing, Phonikud speech and SVC with Daniel's prompt; nothing recorded of these verses. Awaiting Daniel's flags.

**Unread v1 verdict (Daniel):** "very impressive". He flagged 3 of 35 words:
- וָבֹהוּ: "the final vowel was too cut off". The TTS path had no phrase-end release.
- וַיְהִי: "the ה sounds like a ח". SVC renders an F0-less h as a fricative.
- נִסְתַּרְתָּ: "just too cramped". The model gives a consonant-heavy syllable no extra time.
- The haftarah verse "broadly has more of those weird reverb sounds".

**Fixes:**
- `speech2sing.py --release-ms` (a phrase's last syllable carries on into the rest, with a linear fade, leaving `--release-gap-ms` 40 before the next phrase).
- `speech2sing.py --voiced h` (h keeps the score F0).
- Timing model term `delta·consonants`, with defaults gamma 0.75 and delta 0.2. Leave-one-verse-out error is 0.366, against 0.373.
- Run `unread-Btts-v2` uses model `timing-daniel-v2`, release 150 ms and voiced h. U10 is also rendered from the WORLD-stretched source to compare against the reverb.

**Fifth review (adversarial, b3c6178..f31711b): five defects, all fixed.**
1. A modelled pack's `score.json` said `measured`. `applyMeasuredTiming` now takes the source.
2. The aligner's proposal tag was not bumped for the pause rule; it is now r5.
3. `predictSyllableMs` could undercut `applyMeasuredTiming`'s per-note floor for unequal notes. The floor now uses the notes' score lengths, and a test builds every calibration verse at tempoScale 1, 0.1 and 0.01.
4. In midpoint mode the pause rule left the consonant in silence; the rule is now onset mode only.
5. `chantSilenceCuts` could cut a negative amount when keepMs exceeded minRunMs; that setting is refused now. The last onset is range-checked too.

Also fixed: holes in `voicedPhones` are refused, `f0-voicing.json` lists the effective voiceless set, and the tests that passed vacuously now check their own preconditions.

**Left as noted:**
- chant-silence stops one frame short of the next onset, as the approved v9 record did, so a silence needs about 110 ms to count as 100.
- If CTC was right that a consonant follows the previous word directly, the pause rule's fade_out can still walk through that consonant. Proposals are reviewed by ear.

**Sixth review (adversarial, 39ccaa7): four defects, all fixed.**
1. The release fade swallowed a closed final syllable's coda. A release is now for an open final syllable only, and its fade runs from `release` frames before the final vowel ends.
2. The release could reach the next phrase's lead consonants and borrow its pitch. The room now stops LEAD_S (0.2 s) before the next phrase's first note, and the phrase's last pitch is held over the released frames.
3. The WORLD-stretched source got the longer vowel without the fade; both sources are faded now.
4. A note-length ratio over about 190 was clamped into an impossible syllable. It is refused (`note-ratio`).

Also fixed: release options are range-checked, missing consonants are refused, and a non-numeric delta is refused. Run `unread-Btts-v3` replaces v2 on the same page; Daniel had not flagged v2.

## PocketTorah: Daniel's decisions and a proposal for Codex (2026-10-16)

**Decided (Daniel):**
- **Use PocketTorah.** Its recordings serve as timing and melody data for the engine, and students may hear them. "Yes I want it, we are safe with the license on archive, don't stress it."
  - The data comes from archive.org item `PockettorahAudioFiles`, CC BY-SA 3.0, Avery Binder style, plus the app repository's word-onset labels.
  - Private copy and provenance: `C:/private/pockettorah/` (PROVENANCE.md).
  - Attribution: "PocketTorah (not-a-box media lab), CC BY-SA 3.0".
- **Generated chant is a fallback only.** "We don't need to offer my voice as an option ... only my voice when no other choice." Where a human recording exists, students hear it. Daniel's converted voice is used only where none exists, and only after G3.

**Proposal for Codex (app integration, Codex-owned):**
- **What plays.** A verse player that serves a PocketTorah recording cut to the verse, with word highlighting, wherever one covers the verse: every Torah aliyah and each parashah's single-range haftarah. Composite haftarot and special readings fall back to generated chant, under G3. The CC BY-SA credit is shown wherever a recording plays.
- **Cut points.** The voice stream will supply verse and word timings from its own alignment of every recording (CTC, cross-checked against PocketTorah's labels: no drift, about ±150 ms scatter on the first aliyah). It will also supply a coverage table of which verses have a recording.
- **Storage.** Audio stays out of the repository, as always; serving it needs a storage decision on Codex's side.
- **Release.** This audio is not generated chant, so G3 does not hold it, but it is student-visible. Daniel approved the source.

**Pronunciation (Daniel, after listening to Bereshit 1 and its haftarah):** "It sounds perfect actually." PocketTorah's reader matches what CRC students should learn, so generated chant is needed only where no recording exists.

**Coverage built:** 431 of 432 recordings, 7,073 verses. That is every aliyah of all 54 parashot except Haazinu 1, whose song layout the engine's score refuses, plus all 54 weekly haftarot, five of them in two parts. The archive's other 12 files (`torah-1` to `torah-12`, about 20 s each) are not readings. Alignment is complete; see the player hand-off below.

## Generation parked (Daniel, 2026-10-16)

"Let's cut generation for now. Keep in the background for the future if we ever want to pick it back up."

Students hear PocketTorah's human recordings. Generated chant, in lane A, B-human or B-TTS, is parked: no further listening rounds or tuning. Nothing is deleted.

**What exists, and how to resume:**
- **B-human:** a spoken take goes through `trope/propose_alignment.py` (CTC proposal, r5), then `applyWordListeningReview`, then `scripts/trope-human-retime.mjs` (WSOLA retime, releases, `--min-consonant-ratio`, `--voiced-phones`), then `trope/soulx_svc_runner.py`. Best result: V'ahavta v9, which Daniel approved as a research render, not under G3.
- **B-TTS:** a pack's `b-speech-plan.json` with `scoreF0` goes through `trope/speech2sing.py` (Phonikud `michael`, `--release-ms`, `--voiced h`), then SVC with Daniel's prompt. Best result: unread-verse v1 with 3 of 35 words flagged. v2/v3 tried fixes for those flags, and v3 has known defects (below).
- **Timing:** `trope/timing-model.mjs` (modelled timing; packs accept `timing.source: "modelled"`), `trope/chant-silence.mjs` and `trope/measured-timing.mjs`. The fitted models stay private, under `C:/private/chant-benchmark/models/`.
- **Environments:** the SoulX venv and SVC checkpoint under `C:/Users/dsbog/haftarah-audio`, and the TTS venv per the home-setup plan, section 5.
- **Private runs and records:** `C:/private/chant-benchmark/`.

**Open defects at park (seventh review, b94a80b). Fix these first when resuming:**
1. The `LEAD_S` room rule (`speech2sing.py`) disables the release for U01's וָבֹהוּ, the word Daniel flagged: a 0.2 s rest gives negative room. v3 is bit-identical to no release there. Use the next phrase's actual lead frames instead of the constant.
2. `impose` does not cap the first onset to LEAD_S, so the room's assumption is unenforced.
3. The TTS output is already silent over that final vowel's last ~150 ms (raw Phonikud), while target_f0 marks it voiced. That is probably the real cause of "too cut off".
4. The fade can start before a very short final vowel's own start, and the held pitch can freeze a vibrato swing.
5. No test covers the Python TTS path, and `scripts/trope-speech2sing.mjs` never passes `--release-ms`.

## Frozen checkpoint offer for Codex (parked engine work, not for release)

Range `2f8119b..1f1d596` on `voice/human-alignment`. It is engine and tooling only, with no app or UI changes, and nothing student-facing.
- **Review coverage:**
  - Six adversarial reviews: the third through the sixth plus the reviews of 39ccaa7 and b94a80b, recorded above.
  - Every defect they found is fixed, except the five open TTS-release items listed under "Generation parked".
- **Tests:** 182 Node tests pass on Windows (`node --test "tests/**/*.test.mjs"`), and `tests/never-in-repo.test.mjs` is green. Hosted CI has not run on this range.
- **Option and default changes that affect render identity:**
  - `releaseMs` 150, `releaseGapMs` 40, `releaseBreathMs` 30 (0 or 20–400).
  - `voicedPhones` [], `minConsonantRatio` default 0.5 (CLI 0.2–1).
  - Aligner tag r5; chant-silence defaults; timing model `chant-timing-model/v1` with gamma 0.75, delta 0.2, shrink 6.
  - Pack `timing.source` measured or modelled, recorded in both manifest and score.
- **Caveats:**
  - No G1/G2/G3 standing.
  - No inheritance of earlier listening results.
  - Generation is parked, so this integrates only if Codex wants the engine kept in sync. It can equally wait.


## Verse player hand-off for Codex (2026-10-17)

Codex owns the player, storage and student surface. This section gives it the data and the rules.

**The index:** `C:/private/pockettorah/verse-index.json` (4.6 MB, schema `pockettorah-verse-index/v1`), built by the voice stream's `verse_index.py` from the per-recording alignments in `C:/private/pockettorah/align/`. It stays out of the repository with the audio. Codex picks where both are served from.

```
{ schema, source, method,
  recordings: [ { key: "Bereshit-1" | "Bereshit-h", parsha, part: "1".."7" | "h", table: "torah" | "haftarah",
                  ref, archiveFile: "<file in archive.org PockettorahAudioFiles>", seconds, wordLabelsMatched,
                  verses: [ { ref: "Genesis 1:1", start, end,             // seconds in the recording: the verse cut
                              words: [ { he, start, label? } ],           // engine words in order; he = MAM word with marks
                              alignScore, startVsSoundOnsetMs, review?, labelGapMedianMs } ] } ] }
```

**How to play a verse:** seek to `start` and stop at `end`. Highlight word *k* from `words[k].start` until the next word's start. Use `start`, not `label`: PocketTorah's own labels lead the voice by about 0.25–0.5 s, measured against sound onsets after pauses, while the aligned starts land within about 40 ms. Display the words from `he`, because splitting the verse text on spaces disagrees with the engine's word list in some verses (maqaf, ketiv/qere).

**Cut rule:**
- A verse runs from 80 ms before its first aligned sound to 150 ms after its last vowel's loudness end, and never past 80 ms before the next verse.
- A breath before the first word is left out.
- Where pitched sound precedes the aligned first word, the start moves back to it and the verse carries `review`. 36 verses carry it.

**Quality across all 7,073 verses:**
- Verse starts sit a median 34 ms from the measured sound onset.
- Of the 338 that differ by more than 150 ms, almost all are breaths before the verse or quiet stretches after it.
- The label-count check: 422 of 431 recordings have exactly as many PocketTorah labels as engine words, and the other 9 differ by 1 or 2 words.
- **Spot check:** 26 verses for Daniel at https://claude.ai/artifact/EXjZ6aSD4SLAW9kHd8cHmZ, results pending.

**Range corrections:** PocketTorah's `aliyah.json` is wrong in two places, and both are corrected in the index:
- **Vayera haftarah:** the data says `Kings_1 4:1-37`, but the haftarah and the recording are II Kings 4:1–37.
- **Masei haftarah:** the data says `Jeremiah ... 3:4 - 3:5`, but the recording ends at 3:4, the Ashkenazi ending. The label count confirms it.

**Gaps, which fall back to generated chant under G3 or show no audio:**
- Haazinu aliyah 1 (the song layout).
- Holiday, special-Shabbat and megillah readings.
- Any community custom that differs from PocketTorah's ranges.

**Rules carried over:**
- Show the credit "PocketTorah (not-a-box media lab), CC BY-SA 3.0" wherever a recording plays.
- These recordings are human, not generated chant, so G3 does not hold them. Daniel approved the source and the pronunciation. They are still student-visible, so the player follows the normal student-surface review.
- No generated chant reaches a student before G3.
