# Return: reference-index contract (Claude voice → Codex)

Branch `voice/reference-index-contract`, cut from frozen `voice/human-alignment` at `39c8770`. The frozen ref and the checkout's old app code are untouched. There are no application, storage, player, schema, auth, repository-policy, shared STATE/COORDINATION, renderer or engine changes.

## Changed files

- `scripts/reference-index-contract.mjs`: the pure contract: `validateIndex`, `crosswalkWords`, `applyOverride`, `buildVerseDto`, `TOLERANCES`, `REVIEW_STATES`, `KNOWN_GAPS`, `ATTRIBUTION`.
- `scripts/reference-index-check.mjs`: the private measurement CLI. It refuses any input or output inside a Git working tree (it reuses `scripts/private-paths.mjs`) and prints aggregate counts and bare error codes only.
- `tests/reference-index-contract.test.mjs`: 18 synthetic tests, using invented letter strings and times. They cover:
  - malformed, duplicate, out-of-range and overlapping timings
  - identity ambiguity
  - qere and maqaf mismatches
  - review states
  - coverage gaps
  - stale or unreviewed overrides
  - DTO leak checks
  - refusal of paths inside a Git working tree, and sanitized CLI output
- `docs/planning/2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md`: the contract, the DTO, and the licence facts with their sources.
- This return.

## Results against the real private index (aggregate only)

The run used the portal's own `normalizeHebrew` and `projectStudyVerse`, copied from `origin/main` `0ce58b6` into a private harness outside every Git tree, and run on Sefaria MAM chapter text cached privately (267 chapters, Hebrew only).

- **Index validation.** It is valid: 0 errors, 431 of 431 recordings accepted, 7,073 verse cuts.
  - The first run rejected one recording because PocketTorah's own labels ran past the end of its audio. The private index builder now keeps labels only when every one falls inside the recording (421 recordings keep them).
  - A rebuild then changed nothing else: the verse cuts, word starts and review flags are identical.
- **Whole-verse playback.** 7,037 verses are `ready`; 36 are `needs-review` (start moved earlier to a pitched sound).
- **Word highlighting.** 7,021 verses map **exactly** one-to-one. None needed a maqaf group, and none mismatched.
  - The other 52 are `portal-text-unavailable`: the portal itself cannot render their text (see the next section). They still play whole.
  - No reviewed overrides exist, and none are needed.
- **Identity.** There are 7,051 distinct verse refs. 22 refs occur in two recordings, so the adapter must pick (asset, ref) explicitly.
- **Coverage.** 431 of 432 readings in PocketTorah's own table are present. The one missing, Haazinu aliyah 1, is a declared gap.
  - Festival, special-Shabbat and megillah readings are not in the source. There is no generated fallback.
- **Provenance.** All 431 audio files match the archive.org item `PockettorahAudioFiles` byte for byte, by MD5.

## Portal finding (Codex's lane, not changed here)

On `origin/main` `0ce58b6`, `normalizeHebrew` throws "Unsupported study markup" for 52 verses inside these reading ranges:

- 35 contain `mam-kq-trivial`.
- 17 are ketiv/qere spans that its two-child, non-empty rule rejects, apparently written-without-read or read-without-written.

`validateChapter` normalizes every verse of a chapter. So, reading the code (not tested live), the whole study request fails with `invalid-response` for any assignment touching those chapters: **43 of the 267 chapters** in Torah and haftarah readings. `tests/fixtures/trope/edge-cases.json` already contains a `mam-kq-trivial` verse.

This affects the study text students see today, not only reference audio. It wants a reviewed normalizer rule:

- treat a trivial qere as plain text
- represent a missing side of an alternative explicitly rather than throwing

## Integration contract (summary)

1. **Server side.** Load the private index and run `validateIndex`; use only `result.recordings`. Keep `archiveFile`, paths and MD5 on the server.
2. **Asset registry.** Map each approved recording to an opaque `ra_…` id and approve it explicitly. Without approval there is no playback.
3. **Per verse.** Call `buildVerseDto({recording, verse, asset, portal: {status, words: projection.words.map(w => w.text), readingTextSha256}, indexWordsSha256})`.
   - Render the highlight from `words.starts[i]` onto portal word `i` only when `words.status === "ready"` and the hash matches the text on screen.
   - Never use `label`.
4. **`needs-review` verses.** Hold them until a person listens, unless Daniel decides otherwise.
5. **Attribution and licence.** Show `ATTRIBUTION` with any played clip. Serve clips under CC BY-SA with no DRM.
6. **Recommended guard addition (Codex owns `repo-policy`).** Reject files carrying `"schema": "pockettorah-verse-index/v1"` the same way private chant-benchmark records are rejected. I did not change the guard.

## Unresolved dependencies

- **Quality:** Daniel's 26-clip spot-check is pending (no marks yet); the 36 `needs-review` verses have not been listened to.
- **Rights:**
  - the share-alike and no-DRM serving design
  - the attribution link wording
  - the unnamed performer, accepted by Daniel on 2026-10-16
- **Portal:** the normalizer rejection above.

## Checks

The new tests pass 18 of 18. The full Node suite and `tests/never-in-repo.test.mjs` are recorded in the commit that freezes this branch. Nothing was pushed to main, deployed or served. No audio was uploaded or hosted, no voice was generated or tuned, and nobody was contacted.
