# PocketTorah word-boundary repair — Phase 1

Branch `claude/boundary-repair`. Phase 1 changes **word timings only**: verse clips, short MP3 bodies and
`REFERENCE_AUDIO_STUDENT_RELEASE` are untouched. Nothing is published by this branch; Daniel runs the
publish and env steps below.

Binding rules applied (MISSION, Current 1.0 scope): reuse the PocketTorah index; never invent word
timings. Every refined time here is derived from the recording itself, every move is bounded by a fixed
window and logged privately, and the original CTC onset is kept beside each refined start.

## What was built

| Piece | File |
|---|---|
| DSP and refinement (pure) | `scripts/reference-boundaries.mjs` |
| Metrics M1–M4 (CLI + pure measures) | `scripts/reference-boundary-metrics.mjs` |
| Refinement CLI, writes index v2 | `scripts/reference-boundary-refine.mjs` |
| Shared private I/O (ffmpeg decode, worker pool, aligner join) | `scripts/reference-boundary-io.mjs` |
| Manifest rebind (no re-encode) | `scripts/reference-short-manifest-rebind.mjs` |
| Contract v2 (index + DTO `words.ends`) | `scripts/reference-index-contract.mjs`, `src/lib/reference-audio/contract.ts` |
| Word loops use ends | `src/lib/reference-audio/timeline.ts`, `src/server/http/portal.ts` |
| 5 ms raised-cosine fades on word cuts | `src/lib/reference-audio/short-playback.ts` |

Private outputs (never in Git): `C:/private/pockettorah/verse-index-v2.json`,
`C:/private/pockettorah/boundary-v2/` (metrics, per-word move log `refine-moves.jsonl`, `catalog-v2.json`,
`manifest-ee39c3e/`). `verse-index.json` (v1) is unchanged.

## Refinement rules

Each start stays within **-120/+60 ms** of its CTC onset (`WORD_MOVE_BOUNDS`, enforced again by the index
contract), at least 30 ms after the previous start, before the next CTC onset, and inside the existing clip.

1. Default: CTC onset − 20 ms (the voice branch's `onset-20ms`, set by Daniel's ear on 2026-10-16).
2. Pause: the nearest rise out of the floor (≥ 50 ms quiet, loud within 60 ms) − 20 ms. Refused when the
   rise precedes the previous word's last phone, falls after this word's first vowel, or lies after the
   onset while sound is already at the onset.
3. Vowel-to-vowel join across words: the largest timbre change (level-normalised log-mel flux), as in
   `propose_alignment.py` `vowel_join`; refused when the cut lands in quiet.
4. Before b, d, g, m or n after a vowel: back to the start of a voiced closure (low-band hum ≥ 7 dB below
   the vowel), at most 120 ms, as in the port's murmur pass.
5. Ends: where the last 120 ms before the next start are quiet, the word ends at its fade-out plus the
   measured decay (to floor + 3 dB, at most 150 ms); otherwise at the next start. An end never passes the
   next start.

Run totals (97,832 words, 7,073 verses, 431 recordings): pause-rise 49,219; onset−20 ms 43,805;
vowel-join 4,011; voiced-closure 797. Ends: fade-decay 37,691, next-onset 60,141. Refused moves logged:
pause-rise out of window 2,105, previous-word 3,376, inside-word 4,356, sound-at-onset 274; vowel-join in
quiet 589; voiced-closure out of window 189. Clamped to a neighbour or clip edge: 818. Median |move| 20 ms,
max 120 ms; median measured decay 35 ms. Unrefined verses: 0.

## Metrics, before and after (aggregates only)

Definitions (`METRIC` in the metrics script). Levels are dB above each recording's 10th-percentile frame
level; frames are 10 ms windows on a 5 ms grid at 16 kHz, decoded by ffmpeg exactly as the aligner did.

- **M1 onsets.** For each start, the nearest onset-flux peak and the nearest rise out of the floor within
  ±150 ms. *Clean lead* = the start precedes the event by 0–60 ms; *late* = more than 5 ms after it.
- **M2 labels.** Starts against PocketTorah's own word labels (label-matched recordings), centred on each
  recording's median offset; disagreements over 300 ms.
- **M3 drill tails.** Hot tail: the last 40 ms is within 15 dB of the word's peak. Trailing silence over
  150 ms. Next word's own onset event (nearest to its CTC onset) inside the drill. Defect = any of the three.
- **M4 edges.** First or last 30 ms loud throughout; lead-in over 250 ms of quiet; last word cut while
  sounding where the clip ends at the next verse. Measured for word drills and for verse clips.

Primary measures were fixed when the metric code was written, before the first comparison run:
M1 clean-lead rates (flux and rise), M3 defect rate, M4 drill defect rate.

| Measure | All: v1 | All: v2 | Stress 34: v1 | Stress 34: v2 |
|---|---:|---:|---:|---:|
| **M1 flux clean lead** | 54.3% | **72.6%** | 54.5% | **69.7%** |
| M1 flux late | 35.2% | 18.9% | 35.0% | 20.3% |
| M1 flux median \|Δ\| | 21 ms | 20 ms | 18 ms | 22 ms |
| **M1 rise clean lead** | 35.0% | **92.3%** | 27.1% | **92.3%** |
| M1 rise late | 55.2% | 4.8% | 65.5% | 5.8% |
| M1 rise median \|Δ\| | 35 ms | 20 ms | 38 ms | 20 ms |
| **M3 defect** | 70.0% | **45.1%** | 71.2% | **44.1%** |
| M3 hot tail | 47.5% | 42.8% | 50.8% | 43.3% |
| M3 median tail level | −15.7 dB | −17.2 dB | −14.6 dB | −18.3 dB |
| M3 trailing silence > 150 ms | 13.5% | 0.2% | 11.1% | 0% |
| M3 next onset inside drill | 30.5% | 7.3% | 29.0% | 6.3% |
| **M4 drill defect** | 75.9% | **56.1%** | 82.6% | **54.6%** |
| M4 drill first 30 ms loud | 61.8% | 34.7% | 70.0% | 37.0% |
| M4 drill last 30 ms loud | 47.3% | 33.7% | 56.1% | 35.3% |
| M4 drill lead-in > 250 ms | 0.34% | 0.36% | 0% | 0% |
| M4 last words cut by next verse | 54 | 54 | 1 | 1 |
| M4 verse-clip defect (clips unchanged) | 9.4% | 9.4% | 20.6% | 20.6% |
| M2 label disagreements > 300 ms | 13.54% | 13.08% | — | — |

Bar: new better than old on M1, M3 and M4, and never worse on the listening-review stress set
(listening-sample/v2, 34 verses). **Met on every primary measure, overall and on the stress set.**

Not improved, reported as found:
- M1 flux median |Δ| on the stress set grows 18 → 22 ms. This is the deliberate 20 ms lead: starts now sit
  just ahead of the attack rather than on it. The clean-lead and late rates, which measure that intent,
  improve.
- M4 drill lead-in > 250 ms rises 0.34% → 0.36% (about 20 words). These are words whose CTC onset already
  sat 230–250 ms early in silence, with the true rise outside the +60 ms window (refused, logged); the
  20 ms lead tips them over. Phase 2 territory.
- Verse-clip M4 and the 54 last words cut by the next verse are unchanged by design (clips unchanged).

Caveat: M1 and M3 measure the same kinds of acoustic events the refinement uses, so they partly confirm
the method by construction. M2 is independent of the refinement and also improves. Daniel's listening
review is the real test.

## Phase 1 build

- v1 index recompiled with this branch's compiler reproduces the published catalog byte for byte:
  `48c8147becc417690de2f8546ae63870d34422f5d95668671ea1a9f5d7c7efdf`.
- **New catalog** (index v2): `ee39c3e17b50470cdc7b6b1843ded462d92cb702b5cfcfca082d7f0adad520b1`, 5,393,743 bytes,
  431 assets, 7,073 cuts. Every asset (id, file, sha256, bytes) and every verse's playback (status, review,
  clip) is identical to the published catalog; 7,072 verses with ready words gain ends.
- **New short manifest**: `cedd52021935469c5bcef29b616c4cd797db244b53dc828b3140d961b433bd87`, 4,571,589 bytes,
  6,984 entries. Planned by the corpus build's own worker from the new catalog and the published candidate's
  measured per-cut facts; every one of the 6,984 entries is identical to the published manifest
  `7784feb9…4824` except `parentCatalogSHA256`; every candidate body was verified against its new entry
  and re-hashed to its name. **No clip body changed**, so nothing needs re-uploading but two JSON objects.

## Decided here

- GATE: contract change is backward compatible — proceeded because v1 catalogs parse unchanged and
  reproduce the published hash; `ends` is optional on the wire and ignored when absent.
- GATE: DTO schema stays `reference-verse/v1` with an optional field rather than a v2 schema — proceeded
  because the server re-serialises every DTO and client and server ship in one deploy; old code with the new
  catalog fails closed, so the code deploy must precede the env switch (step order below).
- Index v2 is a new schema (`pockettorah-verse-index/v2`), so v1 words can never carry `end`/`ctcStart`
  and v2 words must; the move window is enforced by the contract, not only by the refiner.
- Highlighting still follows onsets; only word loops use ends. Changing what the highlight does during a
  pause is a product decision left for Daniel's listening review.
- "A drill can only shrink" is read as: an end never passes the next start; the fade rule only shortens.
- M2 uses the labels as `verse_index.py` copied them verbatim into the index (label-matched recordings
  only), not a second parse of `labels/`.
- Port adjustments, each to keep the Python rule's effect on a 5 ms grid: timbre flux smoothed over 25 ms
  (the port's 3 frames at 10 ms; a 15 ms smoothing left two peaks at the window edges); align_all's
  syllable end is one CTC frame past the span, so the join window opens 10 ms after it (the port's 30 ms).
- Manifest rebuilt by **rebind, not re-encode**: `reference-short-corpus-build.mjs` pins
  `src/lib/reference-audio/contract.ts` in its baseline, so it cannot run on this branch, and body bytes
  depend only on parent audio, clip geometry and recipe. The rebind proves geometry identity instead.
- Not touched: production, Vercel env, `REFERENCE_AUDIO_STUDENT_RELEASE`, verse clips (Phase 2).

## Publish and env steps (Daniel)

Order matters: old code rejects a catalog with `ends` (strict key set) and would turn off all reference
audio, and `REFERENCE_AUDIO_CATALOG_SHA256` must always equal the short manifest's parent, so the two env
vars move together and only after both objects are in the store.

1. **Merge and deploy the code** through the normal pipeline. With the env unchanged it serves the v1
   catalog exactly as today (verified: v1 compiles to the published hash; ends absent means v1 loops).
2. **Upload two objects** to the private store (`BLOB_STORE_ID`), create-only, private:
   - `reference-audio/pockettorah/catalog/ee39c3e17b50470cdc7b6b1843ded462d92cb702b5cfcfca082d7f0adad520b1.json`
     from `C:/private/pockettorah/boundary-v2/catalog-v2.json` (5,393,743 bytes);
   - `reference-audio/short-v1/manifests/cedd52021935469c5bcef29b616c4cd797db244b53dc828b3140d961b433bd87.json`
     from `C:/private/pockettorah/boundary-v2/manifest-ee39c3e/manifest.json` (4,571,589 bytes).
   No body upload: all 6,984 `reference-audio/short-v1/<sha>.mp3` objects are already published and unchanged.
   **No ready-to-run uploader exists for these hashes.** Both earlier uploads ran inside a Production Vercel
   build using that build's OIDC identity (a local Development identity is refused). The catalog's publisher
   is `C:/private/pockettorah/reference-release-20261017/native-build-*-0731928/publish.mjs`; its `PLAN`
   constant (sha256, bytes) is hard-coded to `48c8147b…`. The manifest's stage is
   `C:/private/pockettorah/reference-short-manifest-6947b31-v1/`, whose `entry.mjs` is pinned to the old parent
   and manifest. Uploading means re-pointing one of those private stages at the two new objects (sha256, bytes,
   pathname) and running it as before:
   `vercel deploy <stage> --prod --skip-domain --yes --scope ravbogards-projects`. It then GET-verifies each
   object's sha256 and bytes. That is new production write code, so it gets its own review first; it is not
   on this branch.
3. **Switch both env vars together**, Production only:
   ```
   vercel env update REFERENCE_AUDIO_SHORT_MANIFEST_SHA256 production --value cedd52021935469c5bcef29b616c4cd797db244b53dc828b3140d961b433bd87 --yes --scope ravbogards-projects
   vercel env update REFERENCE_AUDIO_CATALOG_SHA256 production --value ee39c3e17b50470cdc7b6b1843ded462d92cb702b5cfcfca082d7f0adad520b1 --yes --scope ravbogards-projects
   ```
   Leave `REFERENCE_AUDIO_STUDENT_RELEASE`, `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE` and `BLOB_STORE_ID` as they are.
4. **Redeploy** the current production deployment so the env applies:
   `vercel redeploy <current production deployment id> --target production --scope ravbogards-projects`.
5. **Check**: open a stress-set verse (for example Deuteronomy 6:4), play a word drill, and confirm it stops at
   the end of the word instead of running into the pause or the next word. A failure shows as reference audio
   unavailable, never as wrong audio.
6. **Rollback**: the same two `env update` commands with `48c8147becc417690de2f8546ae63870d34422f5d95668671ea1a9f5d7c7efdf`
   and `7784feb91fac6ca81cb12a1a052345b39f35f0631f0fab1a71a40fb93c634824`, then redeploy. The old objects
   are immutable and stay in the store.

## Adversarial review (contract change)

A second agent (dan-auditor) reviewed `c6b66ea`. It verified claims 1–5 (index v2 rules, a hostile `ends`
probe, timeline binding, portal pass-through, fade math including 1- and 2-frame cuts) and that old code
fails closed. Its findings and the fixes:

- High: the never-in-repo guard knew only `pockettorah-verse-index/v1`. **Fixed:** v2 is private too
  (`scripts/private-benchmark-policy.mjs`), with tests in `repo-policy` and `reference-index-guard-review`.
- Medium: the move window was checked only against the v2 file's own `ctcStart`, with 1.5 ms of slack.
  **Fixed:** `checkV2AgainstV1` requires v2 to equal v1 except word times, and every `ctcStart` to be the v1
  start. The compiler refuses a v2 index without `--v1-index`, and refuses `--v1-index` with a v1 index.
  The window is now exact on the 1 ms grid.
- Medium: the deploy note did not say the manifest env must move with the catalog. **Fixed** in the steps above.
- Low: a sub-millisecond word could collapse on the DTO grid. **Fixed:** v2 refuses an end that does not
  stay after its start on that grid. The refine CLI checks its own output against v1 and the contract, and
  validates recording keys and pack paths. The rebind removes only real, unlinked temporary directories
  inside their parents. The metrics skip a word without a label. An HTTP test covers `ends` pass-through,
  and the comments no longer call next-onset ends "measured".

After the fixes the v2 index, catalog `ee39c3e1…` and manifest `cedd5202…` were regenerated and are byte-identical.

## Open items that wait on Daniel

- Listening: word drills on the stress set before and after (the old catalog stays one env switch away).
- Phase 2: verse clip edges (the 54 last words cut by the next verse, 9.4% verse-clip M4 defects) and the
  refused out-of-window pause rises.
