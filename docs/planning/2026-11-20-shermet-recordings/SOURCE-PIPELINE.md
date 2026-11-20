# Source and GPU pipeline return point

November 20, 2026. All source audio, source text, ASR, models and acquisition receipts remain outside Git. The checked-in files contain public labels, references, numeric IDs, hashes, byte lengths and verified timing intervals only.

## Running work

- Source root: `C:/Users/dsbog/beitmitzvah-media/shermet-collection`. The browser inventory covers 247 pages, 8,326 rows and 8,154 distinct official media URLs. `inventory.json` and append-only `inventory-receipts.jsonl` preserve the observed first-party hierarchy and row labels. The receiver remains on loopback port 43121.
- Four downloader workers start at most four CDN requests per second. Each original is hashed, probed and fully decoded; MP3 and PCM WAV retain their original bytes and actual MIME. `acquisition-watch.pid`, `acquisition-watch.log`, `acquisition-watch-errors.log` and `watcher-state.json` identify the running process and loaded script digest. Checkpoints are atomic. Refusals trigger host backoff; malformed/empty audio stays held. Source 416380 returned zero bytes; source 430626 returned a transient HTTP 504 when last checked.
- GPU root: `C:/private/shermet-alignment`. `alignment-watch.pid` identifies the resident CUDA worker; `alignment-watch.log` and `alignment-watch-errors.log` hold progress. It reloads the growing public manifest, targets and projections, prioritizes the 110 distinct course references, and checkpoints each source/ref/hash. It continues without this chat being active.
- `extra-packs/target-build-receipts.json`: 37 additional chapter groups built; Deuteronomy 32 remains held by the existing untimed-pack tool. Current projection generated 7,420 of 7,422 requested references; holds are II Kings 5:18 unsupported markup and the invalid printed Leviticus 17:17 reference. The latter remains navigable under its source label rather than becoming a default.

Compact progress:

```powershell
node scripts/shermet-status.mjs C:/Users/dsbog/beitmitzvah-media/shermet-collection C:/private/shermet-alignment/collection-candidates
```

## Source identity

`source-adjudications.json` contains digest-bound operator decisions and evidence hashes. Independent Hebrew ASR and contrastive phone checks resolve duplicated IDs, duplicated bytes and the Deuteronomy 23 mislabels. The raw receipts are under `C:/private/shermet-alignment/asr-audit` and `source-comparison`. An adjudication applies only when the actual downloaded SHA matches it. Wrong original labels remain in the separate library. No source ID or identical audio hash becomes the ordinary default for distinct references without that confirmation.

The two structural source corrections require their complete expected row sequences: Noach's 153 Genesis positions and B'haalot'cha's 136 Numbers positions. Every published ordinary reference also passes the app's actual `canonicalReadingRef`, including Roman book names. Megillot, blessings, holiday Torah variants, lessons, festival songs and unresolved rows remain separate.

Regenerate final external manifests, then refresh checked-in metadata (preserving the independently matched initial 20):

```powershell
node scripts/shermet-collection.mjs manifest C:/Users/dsbog/beitmitzvah-media/shermet-collection
node scripts/shermet-publish-metadata.mjs C:/Users/dsbog/beitmitzvah-media/shermet-collection C:/Users/dsbog/beitmitzvah-media/shermet-pilot/sefaria-source-manifest.json C:/Users/dsbog/beitmitzvah-media/shermet-pilot/omaha-source-manifest.json C:/Users/dsbog/beitmitzvah-media/shermet-learn-candidates/torah/sefaria-source-manifest.json
```

The generator writes `collection-metadata.ts`, the compatibility re-export `pilot-metadata.ts`, and `nonverse-catalog.json`. The last has its exact repository-policy schema; do not broaden that policy to admit source text.

## Timing qualification and publication

The official pinned checkpoint loads with zero missing/unexpected tensors after its historical weight-normalization keys are deterministically renamed. A real RTX 4070 smoke processed 11.378 seconds in 0.218 seconds of inference with 1.425 GiB peak allocation. No PocketTorah timing or labels are read: its existing packs provide untimed words and phone targets only.

Pipeline `shermet-ctc-native-grid-energy-v3` stitches each native model frame exactly once, including final partial windows. Tests cover 28.9, 29.8 and 57.7 seconds and shifted inputs. All eligible rows receive a second inference with a non-grid 137 ms silence prefix; phone-start disagreement, confidence, source/word agreement, interval invariants and acoustic starts/tails can hold a row. Independent 10 ms PCM energy extends CTC phone endings through sustained vowels until real quiet or the next word onset. No proportional or PocketTorah boundaries are substituted. Root independently compared real recordings with Hebrew Whisper; its lexical and timing-overlap cohort is saved in `asr-audit/pilot-comparison.json`.

Refresh current-source projections after changing reference adjudications:

```powershell
node scripts/shermet-project-targets.mjs C:/Users/dsbog/beitmitzvah-media/shermet-collection/mapped-inventory.json C:/private/pockettorah/sefaria-mam C:/private/shermet-alignment/collection-targets
```

Publish only qualifying candidates bound to the current source and current NFC reading text:

```powershell
node scripts/shermet-publish-timings.mjs C:/private/shermet-alignment/collection-candidates C:/Users/dsbog/beitmitzvah-media/shermet-collection/public-verse-manifest.json C:/private/shermet-alignment/collection-targets/portal-words-current.json C:/private/shermet-alignment/asr-audit/pilot-comparison.json
```

This writes lazy per-book numerical TS shards and `getShermetTiming` in `timing-catalog.ts`. Holds are excluded. The external publication receipt pins the independent audit and projection implementation. Source selection still checks the exact audio hash before a timing can be returned.

### Additive word-boundary rescue

`shermet-word-rescue.py` leaves the original worker and qualified rows untouched. It measures frame energy about each frame's own mean: some real Genesis recordings have a DC offset near −0.023 while quiet-frame variation is only about 0.0005, so uncentered RMS falsely calls the quiet lead/tail voiced. The separate 137 ms inference uses DC-neutral silence and must preserve normalized primary features within 0.0001. Word starts and acoustically extended word ends must agree; movement of an internal phone alone does not reject a stable word. Sustained unassigned voice, confidence problems, source/text mismatches and independent ASR contradictions remain holds. Low phone confidence needs stronger exact-unit, SHA-bound Whisper corroboration.

The worker PID is in `C:/private/shermet-alignment/word-rescue-watch.pid`; logs have the same prefix. Its output is `word-rescues`. Independent real-clip evidence is in `asr-audit/rescue-cohort-current.json`; this derives from the original cohort and pins the newer repeat-limited, DC-filtered decoding receipt for the two initially anomalous transcriptions. Decoder repetition is failed corroboration, not proof of a wrong source label.

Report publication eligibility without changing generated files:

```powershell
node scripts/shermet-rescue-report.mjs C:/private/shermet-alignment/word-rescues C:/Users/dsbog/beitmitzvah-media/shermet-collection/public-verse-manifest.json C:/private/shermet-alignment/collection-targets/portal-words-current.json C:/private/shermet-alignment/asr-audit/rescue-cohort-current.json C:/Users/dsbog/beitmitzvah-media/shermet-collection/priority-refs.json
```

The timing publisher accepts two additional arguments, rescue directory and independent rescue audit. Add these to the existing publish command to merge eligible rescues only where no original good timing exists:

```text
C:/private/shermet-alignment/word-rescues C:/private/shermet-alignment/asr-audit/rescue-cohort-current.json
```

Deuteronomy 32:1–6 has an untimed linguistic target repair in `extra-packs/Shermet-Deuteronomy32-untimed-phones`. `shermet-phone-targets.mjs` uses the same read-only engine word parser and syllable-phone conversion without requesting an unsupported melody score. Twelve ordinary verses (153 words) matched the original trusted packs' word labels and all phones exactly. No note timeline, melody or generated audio is produced.

## Resume commands

Do not start a duplicate worker while its PID is running. Source resume:

```powershell
node scripts/shermet-collection.mjs watch C:/Users/dsbog/beitmitzvah-media/shermet-collection
```

Untimed target completion can be rerun safely; it finds missing canonical refs and uses the existing authorized pack tool:

```powershell
node scripts/shermet-build-targets.mjs C:/Users/dsbog/beitmitzvah-media/shermet-collection/mapped-inventory.json C:/private/pockettorah/packs C:/private/shermet-alignment/extra-packs C:/private/pockettorah/tools/packs.mjs
```

GPU resume:

```powershell
& C:/Users/dsbog/haftarah-audio/soulx-env/venv/Scripts/python.exe -u scripts/shermet-align.py --model C:/private/shermet-alignment/models/wav2vec2-2c733782da5604684829819a5eb744c193fe9398 --packs C:/private/pockettorah/packs --extra-packs C:/private/shermet-alignment/extra-packs --portal-words C:/private/shermet-alignment/collection-targets/portal-words-current.json --catalog C:/Users/dsbog/beitmitzvah-media/shermet-collection/public-verse-manifest.json --audio-directory C:/Users/dsbog/beitmitzvah-media/shermet-collection --output C:/private/shermet-alignment/collection-candidates --maximum 100 --verify --watch --priority-refs C:/Users/dsbog/beitmitzvah-media/shermet-collection/priority-refs.json
```

Focused verification: TypeScript; `tests/shermet-*.test.mjs`; the Shermet app tests, including generated lazy timing lookup; then never-in-repo and the required full CI/device checks. Integration owns final PLAN/STATE counts and release status after the workers finish.
