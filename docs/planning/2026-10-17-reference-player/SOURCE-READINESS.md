# PocketTorah source readiness — recovered evidence

2026-10-17, read-only at integration `21f81dbbdb3484be14453b29a0fd27f71ba9dc67`. Daniel's current scope is human reference playback by word/verse with highlighting/loop; student recordings are PARKED and generated trope voices are outside1.0. This note recovers existing source locations; it does not approve a serving architecture or claim new listening/native/provider acceptance. See [player inventory](PLAYER-INVENTORY.md) for the existing UI/source seams.

## Actual local source locations, verified by file metadata

The archive is **`C:/private/pockettorah/`**, outside the working checkouts. Its root and the inspected audio/align/labels/portal-harness directories are ordinary directories, not reparse points. Keep this corpus and all derived real index/text/audio outside every Git working tree; the existing private-path checks and repository guard remain binding.

| Path under that root | Verified existence/metadata | What this establishes |
|---|---|---|
| `verse-index.json` | 7,247,766 bytes; modified2026-10-17T11:53:47Z | The private index exists. Its envelope and current counts were subsequently validated in the authorized local recheck below. |
| `verse-index.prev.json` | 7,254,021 bytes | Prior build retained; not a substitute for the current validated index. |
| `verse-index-report.json` | 4,151 bytes | Prior aggregate/report artifact exists; retained unchanged, not used as current results. |
| `audio/` | **444 MP3 files**,463,755,099 total bytes (~464MB decimal) | Actual local audio assets exist. This is more files than the historically indexed431; do not call all444 indexed or approved. No audio was opened, played, decoded or hashed here. |
| `align/` | **431 JSON files**,27,934,997 bytes | Per-recording alignment artifacts exist. Format/content/accuracy not checked here. |
| `labels/` | **432 TXT files**,1,032,755 bytes | Original label artifacts exist. Labels are diagnostic; they must not drive highlighting. |
| `aliyah.json` | 446,461 bytes | Source reading/range table exists and was used by the authorized local recheck. |
| `archive-metadata.json` | 435,548 bytes | Prior archive provenance metadata is cached. No new archive.org request or MD5 comparison occurred. |
| `sefaria-mam/` | **267 JSON chapter files**,2,078,425 bytes | Private Hebrew chapter cache exists; used in memory by the authorized current-parser recheck. |
| `portal-words.json` | 4,434,872 bytes | Prior portal read-word crosswalk input exists; retained unchanged and not used as current projection input. |
| `contract-check/reference-index-check.json` | 2,063,283 bytes; modified2026-10-17T12:15:23Z | Detailed private validation/DTO report exists. Body not opened; never copy it into Git or return it to clients. |
| `portal-harness/MAIN_REF` | Public source ref read: **`0ce58b6bd8da0c9e31288314986c278fa7db1360`** | The saved normalizer/projector harness is historical, not current main. The directory also contains the copied normalization/projector sources and dump/structure tools. |
| `tools/` | `align_all.py`, `verse_index.py`, `all_packs.mjs`, `packs.mjs` | Rebuild tooling exists outside Git. Targeted source comments identify CTC forced alignment using wav2vec2 espeak at pinned revision; no model/dependency/tool was executed or downloaded. |
| `PROVENANCE.md` | Read existing provenance/handoff text only | Records the archive/licence/origin and historical verification described below. This is documentation, not a fresh integrity or rights check. |

No Hebrew, index records, media/index bodies or cached word/chapter bodies were printed/copied. Directory counts above are new metadata observations; they do not establish byte identity, complete index-to-audio mapping or acoustic quality. The unrelated adult voice-training take under `C:/private/chant-benchmark/` is not this reference corpus and is not needed for the player.

## Historical measured results, not rerun results

[REFERENCE-INDEX-RETURN](../2026-10-17-reference-audio/REFERENCE-INDEX-RETURN.md) and [contract](../2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md) record:

- 431/431 indexed recordings accepted,0 structural errors,7,073 verse cuts and7,051 distinct refs;22 refs occur in two recordings.431/432 readings in PocketTorah's table were present; Haazinu aliyah1 is the declared gap. Festivals/special-Shabbat/megillah readings are absent from that source. Do not invent generated audio for any gap.
- 7,037 playback-ready cuts,36 `start-moved` cuts needing listening review,0 text mismatches.7,021 exact one-to-one/maqaf word crosswalks;52 then lacked portal text. Those word-ready counts are not an approval count and do not override a playback review hold.
- 421 recordings retained original labels after an out-of-bounds label set was omitted. Labels reportedly lead the voice by0.25–0.5s; aligned starts, not labels, are the player data.
- All431 indexed MP3s reportedly matched the archive.org file-list MD5s. This review did not repeat the audio MD5 comparison. Root reports archive.org details/metadata inaccessible today, so there is **no current web verification**.

The historical harness used0ce58b6. The subsequently accepted trivial-wrapper and reversed-KQ normalization fixes make the old52 unavailable count stale as a current readiness claim; standalone/missing-structure cases still fail closed. A later authorized private measurement should use the current projector and independently report the intersection of approved playback and current exact word mapping. The later authorized current-parser validation below supersedes these old match counts; no listening run occurred.

The historical26-clip Daniel spot-check and36 shifted-start reviews are recorded as pending. No PocketTorah review/listening-mark artifact was located by filename in the recovered PocketTorah tree or the targeted voice/original ignored-log locations. This does not prove Daniel never listened; no marks were recovered. Preserve the existing disposition rather than asking Daniel to reconstruct the source location or treating structural validation as listening approval.

## Existing rights/attribution disposition — preserved, not reopened

The existing contract§4 researched [archive item/metadata](https://archive.org/details/PockettorahAudioFiles), the [2012 release announcement](https://ejewishphilanthropy.com/torah-on-the-go/) and [CC BY-SA3.0](https://creativecommons.org/licenses/by-sa/3.0/legalcode). It records title **PocketTorah Audio Files**, creator **not-a-box media lab**, Avery-Binder style, and BY-SA3.0 audio. The announcement includes corresponding metadata; the app repository itself has no LICENSE file. No app code is imported. Daniel accepted the uploader/unnamed-performer assertion on2026-10-16; that decision is retained and no new permission question is raised here.

Preserve visible title/creator/licence link and the changes notice when clips are served. Existing `ATTRIBUTION` says “Cut into single verses with computed word timings.” Keep archive ID/file/MD5 and contract version as server-side provenance. Copies/adaptations follow the already researched BY-SA terms; the serving design must not impose DRM or restrict the recipient's licensed rights. Existing MAM text provenance remains separately CC BY-SA4.0. These are the recorded obligations, not a new legal opinion or a fresh licence audit. Generated-chant G3 is not a substitute gate for human reference audio, and generated voices remain outside1.0.

## Smallest useful read/registry integration

1. Use the recovered local files as ingestion inputs, **not** a hardcoded application filesystem path or a copy into `public/`. A narrowly bounded server loader should validate the index with actual chapter counts, match approved media bytes/provenance, and bind an immutable index/audio version. The existing `reference-index-check.mjs` is an outside-Git measurement tool, not an uploader or runtime loader. Production byte delivery is still a root-selected seam; these local files are not already deployed assets.
2. Create the missing approved-asset registry: opaque `ra_` plus32 lowercase hex IDs mapped server-side to exactly approved media identity/locator, digest, source/version, attribution and review disposition. Use explicit `(asset, ref)` identity where refs overlap; do not select the first matching recording silently. Neither a random ID nor the measurement CLI's all-zero stand-in establishes approval.
3. Reuse `validateIndex`, then `buildVerseDto` with CURRENT `projectStudyVerse` reading words/text. Return only the closed `reference-verse/v1` contract: approved opaque asset, clip bounds, mapped onsets, computed reading-text hash and attribution/status. Keep paths/archive filenames/index Hebrew/labels/raw reports out of responses. The client verifies rendered NFC reading-text hash before word seek/highlight; unmapped text gets verse-only behavior only where the serving policy permits it. `needs-review` remains a hold under the existing contract.
4. Resolve approved bytes through a separately reviewed reference-media read seam and integrate explicit play/pause, word/verse seek/highlight/loop with the existing selection/concealment lifecycle. Timings are on the whole-asset timeline; subtract clip.start only if actually serving cut bytes. A word loop bounded by the next onset/verse end is an onset-derived interval, not an independently measured phonetic ending. Preserve the source's recorded voice; root is researching independent pitch separately.

This uses the existing reference contract and normal study authority rather than the parked student-upload/receipt subsystem. No new schema, dependency, provider/store, route, browser test, audio operation, money decision or permission request was made. The following separately authorized local recheck reads only existing private metadata/text/index inputs. Only this source-readiness note is owned here; root's other shared files are preserved. Root chooses implementation/review and serving integration next.
## Authorized current-source remeasurement

Completed locally at root `597f272af7855c23ca5b69213dc9f5d033c0df4b`; the five relevant source files were clean against HEAD and unchanged during the run. This was a separate authorization after the metadata-only recovery. The new private directory is **`C:/private/pockettorah/portal-recheck-20261017/`**. `run.mjs` uses `isolatedEnv` for its sole child and awaits cleanup. The child imports CURRENT TypeScript functions directly with Node type stripping and the package's `react-server` condition for the server-only marker: no old0ce harness source, transpiler installation, parser alteration or source copy is involved. Fetch is blocked. No audio is read or played.

It normalizes/projects the cached whole chapters in memory, verifies each chapter's length against current `TANAKH_VERSE_COUNTS`, calls existing `validateIndex` against that full catalog, and calls existing `measure` using the newly computed portal words. Private detailed results stay in `measurement.json`; only aggregate counts/bare codes are emitted. The prior index, old portal words, chapter cache, provenance and other original inputs were not overwritten. SHA256 pre/post comparisons of all267 chapter inputs, original metadata/index files and all five source files passed unchanged.

| Current check | Result |
|---|---:|
| Cached full chapters / verse rows | 267 / 7,864 |
| Current ready projections / normalization rejection | 7,863 / 1 |
| Index validation with current complete Tanakh catalog | PASS;431/431 recordings;0 errors |
| Indexed verse cuts / distinct refs / refs repeated across recordings | 7,073 / 7,051 / 22 |
| Playback ready / review-held `start-moved` | 7,037 / 36 |
| Word-ready / `portal-text-unavailable` | **7,072 / 1** |
| Both playback-ready AND word-ready | **7,036** |
| Review-held cuts whose words map | 36; they stay review-held |
| Expected readings / present / missing | 432 / 431 / 1; missing is declared |

Both validators report only bare warning codes `verse-in-several-recordings` and `declared-backward-range-part`, one aggregate warning each. There are no text-mismatch errors. Relative to the historical7,021 word-ready figure,51 additional cuts now map exactly; the remaining normalization rejection was not weakened or silently repaired. Current results establish structural/text/timing contract eligibility, not listening quality, approved registry membership, hosted delivery or pitch behavior.

Source SHA256 bindings (also retained privately in `source-and-input-manifest.json`):

| Relevant current file | SHA256 |
|---|---|
| `src/server/study/normalize.ts` | `842701e0e248b6b4385d2bd0aff31b8a1aa66efd88c626582ba74a2b6eba76ef` |
| `src/lib/hebrew/study-tokens.ts` | `06befaaf39791417608c8b8a06aeb66678d397ad6e222a19bed1a458208534ce` |
| `src/lib/readings/catalog.ts` | `9394917939e2f33a97880a49634854cedeb3829ed3cc62a0ed3ba0f9fb9ff548` |
| `scripts/reference-index-contract.mjs` | `6f95a39f505bfd0911e5bc2b50bb063273155fc2d6faa1002966c8976bc3acbe` |
| `scripts/reference-index-check.mjs` | `dc41f2902ecc66a3c20727ba347662b7fb905ff4fc3503e9c3a3c000c67a1947` |

Exact command: `node C:/private/pockettorah/portal-recheck-20261017/run.mjs`; that isolated runner invokes Node with `--experimental-strip-types --conditions=react-server` on its private `measure.mjs`, in the current integration checkout. Successful aggregate is `aggregate-attempt2.json`; the initial fixed failure remains `aggregate.json`. First attempt safely returned `private-reference-recheck-failed` at index-measurement; the cached `aliyah.json` has a UTF8 BOM. Adding only the same leading-BOM handling used by existing CLI `readJson` fixed the harness, with no input/parser/dependency change. No raw exception/JSON/cache text or stderr was logged. All private inputs and original outputs are preserved.