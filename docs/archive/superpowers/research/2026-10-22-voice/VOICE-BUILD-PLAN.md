# Generated chant voice: build plan for Claude Code

2026-10-22. Planning written by Cowork after the research (`REPORT.md`) and two rounds of Daniel's rulings (`QUESTIONS-FOR-DANIEL.md`). Claude Code owns everything from here: the pipeline **and** the portal integration (Daniel's ruling, "Claude Code both"). This plan names the milestones, the interfaces between them, the exit tests, and the rules. Exact code design is Claude Code's job.

Release target: **1.5 beta**. Per Daniel's standing rule there are no dates here; work proceeds as fast as gates allow.

---

## 1. Rulings this plan implements

| Area | Ruling |
|---|---|
| Scope | Any verse, any key. Torah and haftarah chant, plus trope drills and trope-chart buttons. Blessings, High Holy Day trope and Megillot are **release 2.5**, not now. |
| Data | Train on PocketTorah and Finkel. Finkel's consent is on record with Daniel; do not ask for it. Finkel training clips: the **265 machine-passed clips, chant, normal tempo**, plus automatic filters, with no listening step. |
| Voice | **Finkel's**, unnamed. The only label is "Claude-generated chant", with "check with your tutor or cantor". PocketTorah teaches the model Hebrew chant. |
| Style and pace | Plain teaching chant with little ornament. Default pace matches PocketTorah. Slow practice uses the player's slow-down, with no separate slow renders. |
| Pronunciation | ח = [χ], the same as כ. ע silent, or a light glottal catch between vowels. ר uvular and **always pronounced**. ה **always audible** at the start of a syllable and with mappiq. Vocal sheva and doubled consonants **follow the PocketTorah reader, measured**. |
| "Great" | Correct (zero "would teach wrong") plus at least 95% "fine to learn from" plus one consistent voice. Indistinguishability is not required. |
| Release gate | **System-level.** G1 and G2 run automatically on every file, plus Daniel's blind sample review (zero "would teach wrong" in 59 verses; at least 95% "fine"). No second listener, no per-verse review. Then "release it to the wild". |
| New model versions | **Automatic checks only** (golden set plus G1/G2 on every file); no listening. |
| Listening rounds | 15 minutes at most each. |
| Which source plays | PocketTorah where it exists. In a reading with gaps, **only the gap verses** switch to generated. Students **may choose** the generated voice for any verse, so every verse is rendered. |
| Key | **Student chooses**, live in the browser. There are no pre-rendered keys. This applies to human and generated audio alike. |
| Mistakes | A "report a mistake" button on generated verses feeds **Daniel's admin queue**. The verse stays up until he pulls it. |
| Kill | If Experiment 1 hits the kill rule, **stop for good**. |
| Spend | Cloud GPU up to $25 in total without asking; above that, ask. Rendering runs on the laptop. |
| Storage | **Vercel Blob** (the existing private store). Weights are backed up in `C:/private` plus the private Blob store. |
| Code home | `bneimitzvah` repo, a new `voice/` folder. Audio, weights, labels and private data stay off-repo. |
| Vocoder | OpenVPI's shared vocoder is approved for the pilot. Train our own before release (§4, M3). |

**Correction from the Finkel data count** (`FINKEL-DATA-COUNTS.md`). Finkel's FLAC masters wrap **lossy** sources, so they are not original lossless audio.

- Most sources are MP3s: 33 clips come from 256 kbit/s files, and the rest mostly from about 115 or 64 kbit/s.
- 83 of the 110 deduped preferred clips are stereo.
- 29 of the 110 come from sources flagged for clipping.

| Set | Clips | Hours |
|---|---|---|
| Machine-passed normal-tempo chant, deduped | 110 | 2.53 |
| The same, plus chant drills | 128 | 3.43 |
| Clean subset (no clipping, noise or spot-check flags) | 77 | 1.65 |

Finkel is still better source audio than PocketTorah's ~31 kbit/s, and enough for a second speaker. But it is not studio quality, so it caps how clean the final voice can sound. M2 prefers the 256 kbit/s-origin clips, and M4's listening test decides whether that is good enough. If it is not, the remedy is a short studio session with Finkel, which is Daniel's spend decision (§4, M2).

**Tooling corrections** from `DIFFSINGER-RECIPE.md` are folded into `EXPERIMENT-1.md`:

- Python 3.11.
- A separate Python 3.10 environment for ONNX export.
- Two cherry-picked fixes on top of v2.5.1.
- Run DiffSinger from a copy outside the repo.

The Signalsmith and Vercel items stand.

**One earlier ruling is superseded by the browser-key choice.** "Generated voice beyond ±4 semitones" no longer applies: every key is a live browser shift of whichever source is playing. If M7's listening check fails at large shifts, the fallback is to pre-render the generated voice natively at one or two extra keys. That would be a decision for Daniel.

---

## 2. Architecture

```
pointed MAM text
  -> trope engine (Node, dependency-free)
       verseUnits -> scoreVerse -> timing model
  -> chant-performance/v1  (new, model-neutral; one JSON per verse)
  -> voice/ (Python, off to the side, pinned env)
       align (training data only)
       train (DiffSinger acoustic + own vocoder)
       render (ONNX)
       check (G1, G2, sound check)
       package (MP3 + word timings + manifest)
  -> private Vercel Blob
  -> portal
       generated source variant
       source choice
       live key shift (Signalsmith Stretch)
       label
       report a mistake
```

**The new contract, `chant-performance/v1`** (Node writes it; Python reads it). Split it out of today's SoulX-bound identity map (`trope/benchmark-pack.mjs`, `benchmarkIdentityMap`) so that no renderer's token scheme leaks in. Per verse:

- `ref`, `engineVersion`, `profile` (name plus hash of the pronunciation profile), `table`, `key` (MIDI tonic), `timing` (source: `modelled`, plus the model hash)
- `words[{id, he}]`
- `syllables[{id, wordId, phones[], stress, startMs, durMs, noteIds[]}]`
- `phones[{syllableId, phone, startMs, durMs}]`
- `notes[{id, syllableId, midi, startMs, durMs, slur}]`
- `rests[{startMs, durMs}]`

IDs stay stable across versions, and fields may be added but never renamed. The same object produces the word timings the player needs, exactly, with no alignment of generated audio.

The schema name must be added to the private-data refusal list if any instance could carry private-derived numbers. The timing model is fitted on private recordings.

---

## 3. Engine changes (Node, `trope/`, dependency-free)

1. **Profile `israeli-v2`** in `pronunciation.json`. It implements the pronunciation ruling and needs two new knobs:
   - `rules.heAudible`: always emit ה at the start of a syllable and with mappiq, and mark it for voicing between vowels.
   - `rules.ayin = "catch-between-vowels"`.

   Sheva (`syllabifier.longVowels`) and `rules.geminate` are set from the PocketTorah measurement in M1, step 3. Keep `israeli-v1` unchanged for the existing benchmark packs.
2. **`trope/timing-model.mjs`, `measured-timing.mjs`, `chant-silence.mjs`**. These exist only on branch `voice/human-alignment` (`39c8770`, on origin). Bring them to main as engine code, with their tests. No fitted models go in the repo.
3. **`chant-performance/v1` emitter** plus a CLI: refs in, one JSON per verse out, to a private path guarded by `scripts/private-paths.mjs`.
4. **Drill emitter.** One performance object per trope cell: 62 Torah and 50 haftarah. Use a short neutral carrier word, or the cell's most common real word in PocketTorah. Daniel's ruling is that drills are generated; the choice of carrier is Claude Code's.

---

## 4. Milestones

Each milestone has an exit test. G1 means every note's median pitch within ±50 cents of its target, none missing or extra. G2 means loudness, true peak at or below −1 dBTP, no dropouts, complete.

### M0. Repo groundwork

- Create the `voice/` folder (Python): a `uv.lock`, a pinned PyTorch `cu126` index, DiffSinger pinned at tag v2.5.1 (fork or snapshot), and a README with every path being private.
- Extend `scripts/repo-policy.mjs`:
  - refuse `.ds` files and any DiffSinger binary or `.npy`/`.npz` data under `voice/`;
  - refuse data carrying `chant-performance/v1` that was made from private timing.
- Add a `voice/` entry to the never-in-repo tests.
- Bring the branch-only engine files to main (§3, item 2).
- **Exit:** CI green, and the guards refuse a planted `.onnx`, `.ds` and private-schema JSON under `voice/`.

### M1. Experiment 1 (PocketTorah content test)

- Run exactly `EXPERIMENT-1.md`. It is cleared, with its pronunciation and listening changes already in it.
- **Exit:** its ordered rule. **Kill means stop for good**: delete nothing, park everything, and report to Daniel.

### M2. Finkel data

- Source: the prepared package at `%LOCALAPPDATA%/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/CRCBeitMitzvah/research-private/finkel-collection/prepared`.
- Select the machine-passed chant clips at normal tempo (Torah, haftarah, megillah and blessings, per the catalog).
- Segment to verses using the catalog's candidate boundaries and the engine's verse text.
- Align with the aligner trained in M1 (MFA trained on PocketTorah plus the engine dictionary), constrained by the score: a syllable-to-note map plus a pitch track.
- Apply automatic filters:
  - alignment likelihood in the bottom 5%;
  - phone durations out of range;
  - clipping or noise floor.
- Hold out a test set before any training: about 30 verses across Torah and haftarah, chosen as in `EXPERIMENT-1.md` step 2.
- **Exit:** a counts table with hours kept and phone coverage. Every phone must occur at least 20 times; list any short.
- **Selection:** start from the 110-clip deduped set, or the 128-clip set with drills. Drop clipping-flagged and noisy sources first. Prefer 256 kbit/s-origin clips, and downmix to mono (check whether the stereo clips are true stereo).
- **Shortfall:** if usable clean chant is under about 1.5 h (the count says about 1.65 h), or a phone is missing, report it.
- **Studio session option.** A scripted 1–2 h studio session with Finkel would fix both coverage and fidelity:
  - dry room, 48 kHz/24-bit, phone- and trope-balanced script per REPORT §6;
  - estimate about $500–1,500: about $300 per recorded hour plus studio time at $30–125 an hour.

  This is Daniel's spend decision.

### M3. Release model and own vocoder

- Train a two-speaker DiffSinger acoustic model (PocketTorah plus Finkel) on the laptop, falling back to the cloud cap.
- Train our own NSF-HiFiGAN vocoder with OpenVPI's MIT SingingVocoders code, on Finkel's best-quality chant (256 kbit/s origin) plus PocketTorah. This removes the non-commercial weights from anything released.
  - The recipe warns that a from-scratch vocoder on a few hours may sound worse than the shared one, which was trained on about 93 h.
  - Fine-tuning the shared one keeps its non-commercial licence.
  - If the self-trained vocoder sounds clearly worse in M4, report it. Using the shared one in release is Daniel's licence decision.
- Optionally train DiffSinger's pitch and duration predictors on PocketTorah notes, if M1 showed the engine-driven render needs it.
- Export everything to ONNX. Record SHA-256 hashes.
- Back up the weights to `C:/private/voice/models/` plus the private Blob store, under a non-public path.
- **Exit:** the models load and render a held-out verse via ONNX, and G1 and G2 pass on the held-out set.

### M4. Finkel-voice evaluation (Daniel, two or three rounds of 15 minutes or less)

- Blind review of the held-out Finkel verses: generated against Finkel's real recording, matched loudness and format, using the same flag page and categories as Experiment 1. Split the clips across rounds so each takes 15 minutes or less.
- **Exit:** zero "would teach wrong", at least 95% "fine", and the real recordings at least 95% "fine".
- **Fail:** one tuning round (labels, predictors or vocoder), then re-test. A second failure goes to Daniel. The M1 kill rule already settled whether the approach works at all; this decides whether *Finkel's voice* works.

### M5. Full render

- Render every Torah and haftarah verse the engine scores: about 7,500, including the gap verses. Render all 112 drill cells. Use one key per verse: the engine's key, matched to PocketTorah's typical tonic for that reading.
- For every file:
  - 64 kbit/s MP3;
  - word starts and ends straight from the performance object;
  - G1, G2 and the sound check (Hebrew IPA Whisper, compared to the expected phones);
  - a manifest row binding the file hash to the model, vocoder, engine, profile and timing hashes.
- A file failing G1 or G2 is **not published**. That verse falls back to text-only, and the failure is listed.
- **Exit:** a manifest with pass counts, and a failure list under 1% of verses. If more fail, stop and report.

### M6. Release gate (system-level G3; Daniel, 15 minutes or less per round)

- Draw 59 random verses from the M5 release set, stratified: about a third gap haftarot, a third other haftarot, a third Torah. Add 10 drills. Spread them over about four rounds of 15 minutes or less, mixed with about 10% hidden real Finkel recordings.
- **Pass:** zero "would teach wrong" in the 59 verses, at least 95% "fine", and the hidden real recordings at least 95% "fine".
- Record the approval as the **release identity**: model, vocoder, engine, profile, timing model and ONNX Runtime hashes, plus the manifest hash.
- **Fail:** fix the cause, re-render, and redraw a fresh sample. Do not re-review the same 59.

### M7. Portal integration (Claude Code)

Work from the survey of the current code:

- **Contract.** Add a generated source variant alongside `reference-verse/v1` and `reference-short-source/v1` (`src/lib/reference-audio/contract.ts`, `short-resolution.ts`). It carries:
  - its own attribution and label;
  - word starts and ends in its own seconds;
  - the release-identity hash.

  Serve it from the private Blob store through the same gated route pattern as `src/app/reference-audio/short-v1/[file]/route.ts`. Put a new env flag on it, for example `GENERATED_CHANT_PUBLIC_RELEASE`, and require the approved release-identity hash in env. That turns G3 into code: no approved identity means no generated path.
- **Source choice** (`reading-audio-coordinator.ts`, `reading-player-intent.ts`):
  - human audio if present;
  - generated for gap verses;
  - a per-student "voice" setting (Recorded / Generated) that the **student** controls.
- **Live key shift.** Use **Signalsmith Stretch** (npm `signalsmith-stretch`, MIT, last release 1.3.2 of 2025-06-27; verify again at build). It does speed and key at once, with formant compensation. The new path goes in `src/lib/reference-audio/playback.ts`:
  - decode the verified Blob into an `AudioContext`;
  - schedule with `rate`, `semitones`, `formantCompensation: true` and `formantBaseHz` of about 100–120;
  - drive highlighting and loops from `inputTime`.

  Keep the current `preservesPitch` media-element path as the fallback. Key is a **student** setting, ±7 semitones, remembered per student. Carry over the iOS rules: the context starts on a tap and is suspended when hidden. Carry the MIT notice by hand, since the tarball ships no LICENSE file.
- **Label.** "Claude-generated chant", plus "check with your tutor or cantor", on every generated clip, the trope chart and drills.
- **Report a mistake.** A button on generated verses opens a small form (optional word tap plus note). It lands in Daniel's admin queue as a new table (migration). The verse stays up until he pulls it, and pulling adds the verse to a deny list the resolver honours.
- **Trope chart and drills.** Play buttons use the generated drill files.
- **Key-shift listening check** (Daniel, 15 minutes or less): 6 human and 6 generated verses at −5, −2, +2 and +5 semitones. "Fine to learn from?" If large shifts fail, report it; native extra-key renders are the fallback, and that is Daniel's decision.
- **Exit:** app tests green, never-in-repo green, and a production-denial test showing generated audio is unreachable without the flag and approved hash.

### M8. Operations

- **Blob.** About 7,500 generated verses plus 112 drills at 64 kbit/s is about 1 GB (estimate: 7,600 files × 16 s × 64 kbit/s). There is no per-key storage, because keys are live. The portal is on **Vercel Pro** (Daniel, 2026-10-22), so this fits: usage is about $0.10/month for storage plus transfer, inside Pro's included credit.
- **New model version.** Per Daniel, the gate is automatic only:
  1. a golden set (the Experiment 1 and M4 held-out verses plus 20 hard-case verses) must match or beat the approved version on G1, G2, the sound-check error and the ה-voicing measure;
  2. then G1 and G2 on every file;
  3. then swap the release identity.
- **Reproducibility.** `uv.lock`, a container image pinned by digest, the DiffSinger fork, ONNX for rendering, and model hashes in two places.

---

## 5. What Claude Code must not do

- No audio, weights, labels, performance JSON with private-derived timing, or Finkel catalog data in any repo. Assert `insideGitWorkingTree()` is false before every private write.
- No upload of Finkel audio to any cloud machine unless the $25 cap applies and training cannot fit locally. PocketTorah, which is public, may go to the cloud within the cap.
- No student sees or hears generated chant until M6 passes and the approved identity is in env.
- No contact with anyone. No spend beyond the $25 cloud cap.
- No change to blessings, High Holy Day trope or Megillot (release 2.5).

---

## 6. Kickoff prompt for Claude Code

> Read `C:/Users/dsbog/voice-research/VOICE-BUILD-PLAN.md`, then `REPORT.md`, `EXPERIMENT-1.md` and the rulings at the top of `QUESTIONS-FOR-DANIEL.md` in the same folder. Commit the shareable research (REPORT, SOURCES, the plan, and the experiment spec, all counts-only and without private paths beyond those already in the repo's docs) to `docs/superpowers/research/2026-10-22-voice/`. Then execute the plan from M0, in order, honouring every exit test and the rules in §5. Daniel's listening tasks are 15 minutes or less each; give him a link and nothing else to read. Stop only at a kill, a spend above $25, or a failure the plan routes to Daniel.
