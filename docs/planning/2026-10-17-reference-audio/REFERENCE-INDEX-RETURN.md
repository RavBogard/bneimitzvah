# Return: reference-index contract (Claude voice → Codex)

Branch `voice/reference-index-contract` was cut from frozen `voice/human-alignment` at `39c8770`; that ref is untouched. The first offer was `b528a50`. This revision answers `CODEX-REVIEW.md` and an independent adversarial pass by a second agent. The freeze ref is the commit that adds this text; its hash is reported in the notice to Codex.

There are no application, storage, player, schema, auth, repository-policy, shared STATE/COORDINATION, portal-parser, renderer or engine changes.

## Changed files (whole branch since 39c8770)

- `scripts/reference-index-contract.mjs`: the contract.
- `scripts/reference-index-check.mjs`: the private measurement CLI. It refuses any input or output inside a Git working tree by reusing `scripts/private-paths.mjs`, and prints aggregate counts and bare codes only.
- `tests/reference-index-contract.test.mjs`: 24 synthetic tests.
- `docs/planning/2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md`
- `docs/planning/2026-10-17-reference-audio/REFERENCE-INDEX-RETURN.md` (this file)
- `docs/planning/2026-10-17-reference-audio/CODEX-REVIEW.md`: Codex's review, committed unchanged as received.

## Codex's three gaps

1. **An invalid envelope is now unusable.** A wrong schema, an unknown top-level field, a non-string `source` or `method`, or a bad `recordings` list returns an empty `recordings`. `measure` and the CLI then count 0 verses, 0 ready playback and 0 ready words, and exit 1. This is tested for four envelope defects, five non-index values and through the CLI.
2. **Ready highlighting always carries a canonical text binding.** `buildVerseDto` computes `readingTextSha256` (64 lowercase hex) itself from the portal `readingText` the words were mapped against. A missing or empty text gives `text-binding-missing`, with playback unchanged. A caller-supplied hash is ignored, never reflected. This is tested with a closed DTO key set.
3. **Split ranges are ordered.**
   - Parts must be in one book (cross-book ranges are rejected), run forward, and share no verse (overlap or duplicate is rejected).
   - Verses must follow the declared part order, and a part must be complete before the next starts.
   - The last part must be completed (`recording-incomplete`).
   - One real haftarah declares a backward part (Jeremiah 34:8–22, then 33:25–26). That is allowed only as declared, and reported as `declared-backward-range-part`. Reordered verses (1, 3, 2) are rejected. This is tested.

## Further fixes from the adversarial pass

- **Duplicated identity.** Every copy of a duplicated key or archive file is now excluded; previously the first copy was kept.
- **Gaps inside a range.** These are now caught:
  - A chapter change is allowed only where the chapter's verse count shows it ended. The CLI takes those counts from the whole chapters the portal fetched; without counts, a chapter change is rejected.
  - Each part must be complete.
- **Word timing.** Word starts must strictly increase, and lie at or after the verse start and before its end. Verse `start ≥ 0` exactly.
- **Maqaf.** Maqaf placement is now exact. The portal splits words at a maqaf, so the crosswalk is strictly one-to-one: an index word may add only one trailing maqaf, paseq or sof pasuq, and its trailing maqaf must stand exactly where the portal reading text has one. Maqaf grouping was removed (it was never used on real data).
- **Text mismatch.** A text mismatch now holds playback as `needs-review` (`text-mismatch`).
- **Overrides** bind to hashes computed inside the module, over the reading text, the portal words and the index words. They need a real calendar date and a non-blank reviewer.
- **Never throws.** Validation no longer throws on hostile JSON, and an invalid date no longer throws in override checks; this was found by a test.
- **Closed fields** are now tighter:
  - `part` must be a string.
  - `parsha` must agree with `key`.
  - Word text must be Hebrew-only.
  - Asset ids must be `ra_` plus 32 lowercase hex characters.
  - Duplicate CLI flags are refused.
- **Source hygiene.** No raw bidi, BOM or control characters remain in the source; they are written as `\u` escapes. The CLI detects direct runs through realpath, so it also works through a junction.

## Exact checks (Windows, Node 24.11.1, in `C:/Users/dsbog/bneimitzvah-voice`)

| Command | Result |
|---|---|
| `node --test tests/reference-index-contract.test.mjs` | 24 tests, 24 pass, 0 fail |
| `node --test "tests/**/*.test.mjs"` | 206 tests, 206 pass, 0 fail, 0 skipped |
| `npm run check:repo` (`tests/never-in-repo.test.mjs`, run after staging) | 1 test, 1 pass, 0 fail |

Not run here: the app Vitest suite, typecheck and build. This branch carries the old app, and the change touches no app code.

## Results against the real private index (aggregate only)

The run used the portal's own `normalizeHebrew` and `projectStudyVerse`, copied from `origin/main` `0ce58b6` into a private harness outside every Git tree, and run on Sefaria MAM chapter text cached privately (267 whole chapters, Hebrew only).

- **Index validation.** Valid: 0 errors, 431 of 431 recordings accepted, 7,073 verse cuts.
  - Every recording runs complete through its declared range.
  - Every chapter crossing matches a real chapter end.
  - One recording declares a backward haftarah part.
- **Labels.** The private index builder now keeps labels only when all fall inside the recording, because Toldot-6's ran past its end. 421 recordings keep labels. A rebuild left the cuts, starts and flags identical.
- **Playback.** 7,037 verses `ready`; 36 `needs-review` (`start-moved`); 0 `text-mismatch`.
- **Word highlighting.** 7,021 verses map **exactly** under the strict one-to-one and maqaf-placement rule. None disagree. The other 52 are `portal-text-unavailable` and still play whole. No overrides exist or are needed.
- **Identity.** 7,051 distinct verse refs; 22 occur in two recordings.
- **Coverage.** 431 of 432 readings in PocketTorah's own table are present. The one missing, Haazinu aliyah 1, is the declared gap. Festival, special-Shabbat and megillah readings are not in the source.
- **Provenance.** All 431 audio files match the archive.org item `PockettorahAudioFiles` by MD5.

## Structure report for the normalizer defect (structure only)

Over the 267 cached chapters, 63 verses are rejected by `normalizeHebrew`; 52 fall inside the indexed readings. Counts are given as all / in-index:

- **42 / 35** contain `span.mam-kq-trivial` (Codex's separate fix).
- **20 / 16** contain a `span.mam-kq` with exactly **2 element children in the order `span.mam-kq-q`, `span.mam-kq-k`**: the qere child first, the reverse of the order the parser expects. Both children exist and both contain Hebrew letters. None is empty, missing, a text node or an extra child.
  - Across these verses, 2 further `mam-kq` spans in the normal order were also seen. They are valid and are not the cause.
- **1 / 1** contains a **bare `span.mam-kq-k` with no `mam-kq` parent and no `mam-kq-q` anywhere in the verse**: a written-but-not-read word (ketiv without qere). Its content has letters and is bracketed. The verse's only other markup is a `b` (the legarmeh stroke).

No verse has an empty existing child, and no `mam-kq` span is missing a child. The two exceptional shapes are therefore a reversed child order and a standalone ketiv with no qere. Neither comes from a missing or empty side. I did not touch the portal parser.

## Integration contract (summary)

1. **Validate on the server.** Run `validateIndex(index, {verseCounts})` with the catalog's chapter counts. Refuse the file if the envelope is invalid (`recordings` is then empty anyway). Decide whether a non-`ok` file is refused whole or its valid records used; the contract supports both. Keep `archiveFile`, paths and MD5 on the server.
2. **Asset registry.** Give each approved recording a random or keyed-hash `ra_` + 32 hex id. Without approval there is no playback.
3. **Per verse.** Call `buildVerseDto({recording, verse, asset, portal: {status, words: projection.words.map(w => w.text), readingText}})`. Highlight portal word `i` from `words.starts[i]` only when `words.status === "ready"` and the rendered `readingText` hashes to `words.readingTextSha256`. Never use `label`.
4. **`needs-review` verses** (`start-moved`, `text-mismatch`) are held until a person listens, unless Daniel decides otherwise.
5. **Attribution.** Show `ATTRIBUTION` with any clip. Serve clips under BY-SA with no DRM.
6. **Recommended guard rule (Codex owns `repo-policy`).** Reject files carrying `"schema": "pockettorah-verse-index/v1"` like private chant-benchmark records. I have not made that change.

## Unresolved dependencies

- **Quality:** Daniel's 26-clip spot-check (still no marks); listening to the 36 `start-moved` verses.
- **Rights:** a no-DRM, BY-SA serving design; the unnamed performer (accepted by Daniel on 2026-10-16). Codex will check the rights claims against the primary sources at release-design review.
- **Portal:** the normalizer shapes above.

Nothing was pushed to main, deployed or served. No audio was uploaded or hosted, no voice was generated or tuned, and nobody was contacted.
