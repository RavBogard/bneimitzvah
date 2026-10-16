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
