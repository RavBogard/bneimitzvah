# Cantor Finkel's recordings as voice material: handoff

2026-10-22. Authority: MISSION, "Amended 2026-10-22, later (Daniel, Finkel recordings become voice material)". Daniel, verbatim: "let's cut the Finkel recordings and use only pocket Torah. Instead we will use Finkel as the basis for the future work of of the voice we are developing".

The portal now plays PocketTorah only. Cantor Josh Finkel's recordings are not played to anyone in the portal; the playback code from PR #23 (`35febcc`) was removed on branch `claude/remove-finkel-playback`. This note tells whoever starts the voice work what exists, where it is and what it still lacks. Counts only: no recording, title, label, source ID or text is written here, and none may enter the repository.

## Licence

Unrestricted. Daniel recorded on 2026-10-22 that the licence is done and every recording is unrestricted (MISSION, "Amended 2026-10-22 (Daniel, Cantor Finkel's recordings)"). Using the recordings to build and train the voice needs no further licence step. The never-in-repo rule still applies: recordings, the catalog, derived audio and model weights stay off-repo.

## Where it lives (off-repo)

- **Prepared package:** `%LOCALAPPDATA%/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/CRCBeitMitzvah/research-private/finkel-collection/prepared`. It holds `catalog.json` (schema `finkel-prepared-catalog/v1`), the audio under `assets/`, verse-boundary candidates under `timings/candidates/` (one file per clip), an empty `timings/validated/`, and the producer's notes (`QUALITY-REVIEW.md`, `INTEGRATION-RETURN.md`, `MISSING-SOURCES.md`, `coverage.csv`, `duplicates.json`, `validation-result.json`).
- **Private build output from the playback work:** `C:/private/finkel-reference-v1` (`manifest.json` and `plan.json`, the 167-clip playback subset). It is only useful as a record of what was uploaded; the voice work should start from the full package.
- The repository guard (`scripts/private-benchmark-policy.mjs`) still refuses any committed JSON carrying the `finkel-prepared-catalog/v1`, `finkel-reference-manifest/v1` or `finkel-reference-upload-plan/v1` schema. Keep it that way.

## What the package contains

322 clips, each a lossless FLAC master (44.1 or 48 kHz, mono or stereo) plus a 64 kbps mono MP3. The producer drew them from 354 source recordings (184 prepared, 73 kept as supporting material, 60 duplicates, 37 held).

| Kind | Clips | Machine-passed | Chant | Spoken | Chant drill | Spoken drill | Minutes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Torah | 227 | 190 | 111 | 66 | 16 | 34 | 323.6 |
| Haftarah (prophets) | 63 | 49 | 36 | 18 | 4 | 5 | 99.2 |
| Megillah | 12 | 12 | 10 | 2 | 0 | 0 | 10.1 |
| Blessings and service parts | 19 | 13 | 16 | 0 | 2 | 1 | 20.5 |
| Trope anthem | 1 | 1 | 1 | 0 | 0 | 0 | 5.4 |
| **Total** | **322** | **265** | **174** | **86** | **22** | **40** | **458.8** |

- **Machine check:** 265 clips passed the producer's machine verification; 57 are held (failed it). Of the machine-passed Torah clips, 97 are chant and 49 spoken; of the haftarah clips, 31 chant and 10 spoken. No clip has had a human listen (all 322 are "pending"), and none is marked student-ready.
- **Tempo variants:** 22 clips are tempo variants of another take (21 faster, 1 slower); the other 300 are at normal tempo. 18 of the faster takes are Torah.
- **Preferred takes:** the producer marked 242 clips as the recommended default for their passage, mode and tempo.
- **Durations:** about 7 hours 39 minutes in all. Clips run from 5 seconds to about 8 minutes 20 seconds. The masters total about 2.5 GB; the MP3s about 220 MB.
- **Verses named:** the Torah clips name 265 distinct verses, the haftarah clips 113 and the megillah clips 8 (counted from each clip's verse list; PLAN.md's slightly higher figures were counted another way).

## Timings

- **No word timings.** No clip has a validated phrase or word timing. The candidate files carry raw speech-recognition word guesses for 243 clips; these are not timings anyone has checked.
- **Rough verse boundaries only.** 243 clips have machine-guessed verse boundaries; 79 have none. 36 of them passed the producer's boundary check (the catalog marks their verse capability "candidate pending review"); none has been validated by a person. The candidate files also carry a looser "pause-checked" flag on 73 clips and "incomplete" on 170.

## The objects already in the private Blob store

168 objects (167 playback MP3s and one manifest, about 103 MB) were uploaded to the private store `beitmitzvah-private-media` under `reference-review/finkel/v1/` (`audio/<sha256>.mp3` and `manifests/<sha256>.json`; manifest `3739578e…`) on 2026-10-22. Nothing reads them any more: production's Finkel variables were removed the same day, and the code that served them is gone. They stay where they are, unused, at about $0.0024 a month. Deleting them needs Daniel.

## What the voice work would need

1. **Alignment.** The voice needs audio paired with exactly what is sung, at least verse by verse and ideally word by word. Nothing in the package provides that yet. PocketTorah's CTC forced-alignment pipeline, `C:/private/pockettorah/tools/align_all.py` (wav2vec2 espeak at a pinned revision, driven by the trope engine's phone packs, run off-repo), is the obvious tool. Running it on Finkel means installing PyTorch and the model privately and aligning roughly 7.5 hours of audio (or the 265 machine-passed clips first), then a timing review, because Daniel found PocketTorah's own computed boundaries inaccurate on 2026-10-18.
2. **Choosing the training set.** Likely the machine-passed plain chant at normal tempo first (Torah 97, haftarah 31, plus megillah and blessings), with spoken takes, drills and tempo variants decided case by case. The 57 held clips stay out unless a person listens and overrides.
3. **A listen.** No clip has been heard by a person. Decide whether the training set needs one before use.
4. **G3.** Any chant generated from this voice is still gated: no student hears it until Daniel passes the listening review (at least 95% melody passes and zero "would teach wrong"), after G1 and G2. Using Finkel as source material changes nothing about that gate.

## Decided here

- `scripts/finkel-reference-build.mjs` and its test were removed, not kept as a package indexer. It selected only the 167-clip playback subset (dropping drills, tempo variants, megillah, service parts and held clips), wrote the playback manifest and Blob upload plan, and its publish step could not run against the OIDC-only store anyway. The package's own `catalog.json` already indexes all 322 clips, which is what the voice work needs. The script stays in history at `35febcc` if anyone wants its verification code.
- The older private review backend (migration `0026_finkel_private_review`, `src/server/reference-review/`) predates PR #23, is disabled unless its own reviewer variables are set, and carries a migration; it was left in place. Whether to retire it is a separate decision.
