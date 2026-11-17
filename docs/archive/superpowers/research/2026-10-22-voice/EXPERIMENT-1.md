# Experiment 1: real-chant model pilot (PocketTorah, held-out verses)

2026-10-22. Written for a Claude Code agent to run.

**Cleared to start (Daniel, 2026-10-22).** Q1 is yes: train on PocketTorah, with the `C:/private/` work folders approved. Q4 is yes: the OpenVPI vocoder may be used for the pilot. Finkel training is also approved and his consent is on record, so Finkel alignment prep for Stage 2 may run in parallel. It is agent and CPU work and must not touch the Experiment 1 data. Cloud GPU is allowed up to $25 in total without asking; above that, stop and ask.

## The question

If a singing model learns from real Hebrew chant in our tradition, can it chant verses it has never heard correctly enough, and naturally enough, to learn from?

It is answered under two conditions:

- **O ("perfect conditions").** The model gets the real reader's own timing and pitch for the held-out verse. This tests whether the model can sound like the reader at all, and is the upper limit of the approach.
- **S ("engine").** The model gets only what our engine supplies: phones from the text, durations from a timing model, and pitch from the trope score. This is what we would actually ship.

**R** is the real PocketTorah recording of the same verse.

## Ground rules

- Everything runs on Daniel's RTX 4070 laptop by default. Cloud GPU is allowed only if the laptop cannot fit, and only up to $25 in total. Copying PocketTorah audio, which is already public, to that machine is allowed. Finkel audio is not used in this experiment. Above $25, stop and ask. **No other spend and no other upload.**
- Public model and code downloads listed under "Tools" are allowed once Daniel answers Q1/Q4. Check each licence file before download, and record it.
- Work folder: `C:/private/voice-pilot/`, which is outside every Git tree. Reuse `scripts/private-paths.mjs` to assert this before writing.
- Nothing from this experiment enters any repository. That covers audio, weights, labels, verse lists with text, and run records with private paths. The only thing that may be committed later is a counts-only summary, after review.
- Only Daniel hears the outputs. G3 is untouched: this is research audio.
- Stop and report, rather than improvise, if any kill condition below triggers, or if a step needs money, cloud or a new data source.

## Inputs

| Input | Where | Notes |
|---|---|---|
| PocketTorah readings | `C:/private/pockettorah/audio/` | The 431 indexed readings listed in the verse index only; ignore any file the index does not list. MD5s already verified against archive.org. |
| Verse index and word timings | `C:/private/pockettorah/verse-index-v2.json`, `align/`, `labels/` | Existing CTC alignment: word onsets, median error 34 ms. Inspect what phone-level spans exist. |
| Trope engine | repo `trope/` (`text.mjs`, `melody.mjs`, `pronunciation.json`, `timing-model.mjs`) | Phones, notes, phrase structure. **One pronunciation profile for training labels and rendering alike.** Use Daniel's ruling, listed below the table. |
| MAM text | existing packs and `C:/private/pockettorah/sefaria-mam/` | Read-only |
| Flag page | the private word-flag page used for the October listening reviews | Reuse it, with a small extension (step 9) |

**Daniel's pronunciation ruling (2026-10-22):**

- ח = [χ], the same as כ.
- ע is silent, or a light glottal catch between vowels.
- ר is uvular and always pronounced.
- ה is always audible at the start of a syllable and with mappiq.
- Vocal sheva and doubled consonants follow what the PocketTorah reader actually does. Measure this from training-set alignments (derived numbers) before labelling, and record the result.

**Other rulings that shape later stages (not this experiment):**

- The final voice is Finkel's, unnamed.
- Plain teaching chant, at PocketTorah's pace.

## Tools

DiffSinger is pinned now, to a release tag. The other versions are **chosen at run time and then frozen**: record exact versions and hashes in `env/manifest.json`, and never update them silently afterwards.

**Follow `DIFFSINGER-RECIPE.md`** (same folder) for exact commands, config keys for 8 GB and known pitfalls. It also covers keeping the 25k/50k/100k checkpoints, which the defaults would delete, and a short onnxruntime render script, since there is no official one. Run its smoke test first.

| Tool | Version | Licence | Use |
|---|---|---|---|
| Python | **3.11** (pyworld and onnxsim have no Windows wheels above 3.11), managed with `uv` and a `uv.lock` committed to the private folder. ONNX export needs a **second environment** (Python 3.10, PyTorch 1.13) at v2.5.1; see `DIFFSINGER-RECIPE.md`. | PSF | — |
| PyTorch | The CUDA 12.6 (`cu126`) build that DiffSinger v2.5.1's requirements accept; record the exact version | BSD | Training |
| OpenVPI DiffSinger | Tag **v2.5.1** (2026-01-08) plus cherry-picked fixes 920ba91 (RMVPE) and 8a07f76 (mel padding); record the commit hashes; snapshot it **outside the repo**, because it writes checkpoints under its own folder | Apache-2.0 (code) | Acoustic model |
| MakeDiffSinger | Pinned commit at run time | BSD-3 | Data prep scripts |
| Montreal Forced Aligner | Latest 3.x from conda-forge at run time; record the version | MIT | Phone alignment trained on this corpus |
| RMVPE checkpoint | The one DiffSinger's docs reference; record SHA-256 | Apache-2.0 code; check the checkpoint's terms | Pitch extraction and the G1 check |
| Vocoder | OpenVPI `pc-nsf-hifigan-44.1k-hop512-128bin-2025.02`; record SHA-256 | **CC BY-NC-SA 4.0. Private research use only, per Q4.** Never in a release. | Pilot only |
| whisper-heb-ipa (`notmax123/whisper-heb-ipa`) | Pin the Hugging Face revision hash | Apache-2.0 (per card; re-check) | Diagnostic sound check |
| ffmpeg / ffprobe | Record the version | LGPL/GPL (local tool use) | Inspect and encode |
| pyloudnorm | Pinned | MIT | Loudness matching |

## Steps

### 0. Environment and memory profile (stop point)

Run Step 2 (freeze the held-out set) **first**. The profiling subset below must exclude the held-out readings, and the profiling checkpoint is deleted afterwards.

1. Create the uv environment, install, and record the manifest.
2. Run `nvidia-smi` and record the GPU and driver.
3. Train 500 steps on a 30-minute subset with `max_batch_frames` at about 12,000–16,000, mixed precision on, and `max_batch_size` reduced. Record the peak VRAM.
4. If it runs out of memory at the smallest reasonable settings, try training the auxiliary decoder and the diffusion decoder separately (DiffSinger's `train_aux_decoder` / `train_diffusion` switches).
5. **If it still does not fit:** use cloud GPU within the $25 cap (for example an RTX 4090 at about $0.34–0.89/h). Record each charge. If $25 will not cover the run, stop and ask.

### 1. Measure the PocketTorah audio

1. Run ffprobe on every file: codec, bitrate, sample rate, channels.
2. Compute the effective bandwidth: the 99th-percentile spectral rolloff over voiced frames.
3. Write a one-table summary.
4. The expectation is about 31–32 kbit/s, from file sizes. **This sets the comparison format in step 7.**

### 2. Choose and freeze the held-out set (before any training)

1. Hold out whole readings, so no held-out verse or its neighbours are in training:
   - the Torah reading containing Gen 1:1 (benchmark P01);
   - the Torah reading containing Ex 35:20 (benchmark P02);
   - one weekly haftarah, chosen so the 12 test verses below can be covered.
2. From those readings, choose **12 test verses**, each 8–25 s long. Together they must cover:
   - a word with ה at the start of a syllable, and one with mappiq;
   - ח or ך, in at least 3 verses;
   - an open word-final vowel at a phrase end;
   - a consonant-heavy cluster;
   - vocal sheva;
   - qamatz qatan if present;
   - a long melisma (for example pazer, telisha, or a zarqa group);
   - a major disjunctive pause;
   - a verse-final sof pasuq cadence;
   - at least 3 haftarah verses.
3. Write `heldout.json` (verse refs only, no text) and record its SHA-256 in the run record **before training starts**.
4. Exclude the held-out readings from every training, timing-model and aligner-training input.

### 3. Training labels

1. For each training verse, generate the phone sequence from the engine with the chosen profile.
2. Cut the audio at the existing verse boundaries. Then split into 5–15 s segments at score rests or phrase breaks that fall inside measured silences of 150 ms or more. Drop segments that cannot be cut cleanly; count them.
3. Phone boundaries:
   1. constrain each word to its existing CTC word span;
   2. inside each word, place phones with MFA trained on this corpus (`mfa train` with an engine-generated dictionary);
   3. inside each melisma, keep one vowel phone spanning all its notes.
4. Quality filter, applied automatically and counted:
   - drop segments where the MFA log-likelihood is in the bottom 5%;
   - drop segments where any phone is under 15 ms or any vowel exceeds 4 s;
   - drop segments where the word count disagrees with the engine.
5. **Do not hand-correct labels in this experiment.**
6. Record: training hours kept, segments dropped by reason, and phone counts (every phone must appear at least 20 times; list any that do not).

### 4. Preprocess and train

1. DiffSinger acoustic config (single speaker):
   - 44.1 kHz, hop 512, 128 mel bins, to match the vocoder;
   - pitch from RMVPE;
   - default augmentation (key shift ±5 semitones, time stretch).
2. Note that the audio is MP3 upsampled to 44.1 kHz. Do not add bandwidth extension.
3. Train to 100,000 steps or 36 hours of wall time, whichever comes first. Checkpoint at 25,000, 50,000 and 100,000.
4. Record the loss curves, wall time and peak VRAM.

### 5. Timing and pitch for the "engine" condition (derived numbers only)

1. **Timing.** Refit `trope/timing-model.mjs` on PocketTorah's training-set alignments. This is derived numbers, inside the existing authorisation. Save it as `C:/private/chant-benchmark/models/timing-pockettorah-v1.json`. Report the leave-one-verse-out error against the engine grid rhythm.
2. **Pitch.**
   1. Build the curve from the engine's score notes.
   2. Shape each note transition with the median transition time for that interval size, measured from PocketTorah's training-set pitch tracks.
   3. Add no vibrato.
   4. Transpose to the held-out reading's tonic, estimated from that reading's median pitch on sof pasuq final notes. This uses only the key from the real audio.
   5. Keep rests at the score's positions.

### 6. Render

For each of the 12 test verses, produce:

| Condition | Durations | Pitch |
|---|---|---|
| **O** | From the held-out recording's alignment (step 3 method) | From the held-out recording (RMVPE) |
| **S** | From the step 5 timing model | From the step 5 engine curve |

- Use the 100,000-step checkpoint, or the best of the three by a quick agent-only check of G1 and the sound check.
- Record which checkpoint was used and why.
- Render each condition **once**: no retries and no cherry-picking. Record any failure.

### 7. Make the listening copies

1. Take R, O and S for each verse. Trim each to the verse, from first phone onset minus 150 ms to final offset plus 300 ms.
2. Normalise all to the same loudness (−20 LUFS integrated) with true peak at or below −1 dBTP.
3. **Encode R, O and S identically** at PocketTorah's measured format (step 1), so audio quality is not a giveaway.
4. Name files with random labels. Keep a separate key file, never shown to the reviewer.

### 8. Automatic checks (before Daniel hears anything)

1. **G1** (S and O): RMVPE median pitch per score note within ±50 cents; note count and order correct.
2. **G2:** loudness, true peak, no dropout (no silence inside a phrase longer than the score's rest plus 100 ms), complete.
3. **Sound check:** whisper-heb-ipa on R, O and S. Report the per-verse phone error rate of O and S *relative to R*. Flag words where S's recognised phones differ from R's and from the expected engine phones.
4. **Voicing at ה:** the share of voiced frames at each ה in R, O and S.
5. **Durations:** S's syllable durations against R's (median ratio and the worst five).

A verse failing G1 or G2 in S is **reported as a failure, not dropped**. If more than 2 of 12 fail G1 or G2, stop and report before the listening task.

### 9. Daniel's listening task (two rounds, 15 minutes or less each)

Extend the existing private flag page with two parts. Each part is a separate round.

**Part A, round 1, about 13–15 minutes.**
- 36 clips (12 verses × R, O, S), shuffled, with blind labels. Each plays in full; replay is allowed.
- For each clip, Daniel taps one of:
  - **Fine to learn from**
  - **Flag words** (tap the words; optional note: wrong sound / stress / melody / phrasing / artefact)
  - **Would teach wrong** (tap the words)

**Part B, round 2, about 6–8 minutes.**
- 12 pairs, one per verse, each R against S in random order within the pair: "Which one is the real reader?"
- Each pair may be stopped early once Daniel has decided.

**Instructions shown to Daniel (keep this short):** "Three versions of 12 verses, mixed up: some real, some generated. Mark each one as you would for a student. Then, in a second sitting, 12 pairs: pick the real reader. About 15 minutes each."

If a pre-run timing of a round (total clip length plus about 3 s per tap) exceeds 15 minutes, drop the longest verses from both parts until it fits, and record which.

### 10. Results and decision

Record everything in `C:/private/voice-pilot/runs/<run-id>/`:

- manifest (hashes of code, weights, config, inputs, held-out list);
- the automatic-check table;
- Daniel's taps;
- the decision.

Prepare a **counts-only summary** (no audio, no text, no private paths) for Claude Code to review.

**Pre-registered decision rule.** Apply the rows **in order**, take the first that matches, and then show the result to Daniel. "The bar" means: zero "would teach wrong", at least 10 of 12 "fine", and all 12 pass G1 and G2. For O, G1 is measured against the pitch it was given (the real reader's), not the score.

| Order | Outcome | Condition | Next |
|---|---|---|---|
| 1 | **Stopped early** | Training could not run within 8 GB plus the $25 cloud cap, or step 8 found more than 2 of 12 S verses failing G1/G2 | Report. More spend or a fix is Daniel's decision. |
| 2 | **Invalid** | R scores fewer than 11 of 12 "fine" | The test is miscalibrated (format, loudness or verse choice). Fix and rerun the listening task only. |
| 3 | **Kill** | O misses the bar | Stop generated-voice work. Report what failed (category counts). This applies even if S looks better than O, since that would mean a broken comparison, not a working model. |
| 4 | **Pass** | S meets the bar | Stage 2 (add Finkel's voice; own vocoder) |
| 5 | **Promising** | O meets the bar, S does not | One retry only (Stage 1b): train DiffSinger's duration and pitch predictors on PocketTorah notes, rerender S, same task. If the retry is not a Pass, stop. |

**Also report, without using it to decide:**

- Part B accuracy, as correct out of 12. 10 or more means Daniel can reliably tell S from R (about a 2% chance by guessing). Fewer than 10 does not prove he can't tell.
- Flags by category.
- Words where the automatic sound check and Daniel agree or disagree. This calibrates future automatic gates.
- Training hours used, wall time, peak VRAM.

## Expected outputs

- A model checkpoint and its manifest (private).
- 36 listening copies plus a key (private).
- `results.json` with the decision.
- `SUMMARY.md` (counts only).

## Effort and cost

| Item | Estimate |
|---|---|
| Money | $0 |
| Agent and laptop time | About 1 day of setup and labelling, about 1–1.5 days of training, about half a day of rendering and checks |
| Daniel | Two rounds of up to 15 minutes (two more if the Stage 1b retry runs) |
