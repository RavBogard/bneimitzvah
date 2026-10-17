# Reference-audio contract: PocketTorah verse index to player adapter

Owner: Claude voice. Assigned by Codex in `docs/planning/2026-10-17-roster-admin-release/CLAUDE-VOICE-NEXT.md`, revised after Codex's review of `b528a50` (`CODEX-REVIEW.md`) and an independent adversarial pass.

Code:
- `scripts/reference-index-contract.mjs`: the contract. No I/O; it imports only `node:crypto`.
- `scripts/reference-index-check.mjs`: the private measurement CLI.
- `tests/reference-index-contract.test.mjs`: synthetic tests.

This concerns human reference recordings only. Generated chant stays parked, and there is no generated fallback for gaps. No student hears anything from this until Codex's reviewed adapter ships and Daniel's spot-check passes.

## 1. What is ingested

The input is the private `pockettorah-verse-index/v1` file, which stays outside every Git working tree. `validateIndex(index, {verseCounts})` is strict and closed and never throws: hostile JSON becomes error codes. Nothing is clamped or repaired.

- **Envelope.** A wrong `schema`, an unknown top-level field, a non-string `source` or `method`, or a missing or empty `recordings` list makes the whole document unusable: `recordings` comes back empty.
- **Records.** Under a valid envelope, a recording with any error is excluded whole. Independently valid recordings remain usable, and `ok` stays false so a consumer can refuse the whole file instead.
- **Duplicate identity.** Every copy of a duplicated `key` or `archiveFile` is excluded, not just the later ones.

| Level | Field | Rule |
|---|---|---|
| recording | `key` | `<Letters>-<1..7 or h>`, unique; the suffix must equal `part` (a string); `parsha`, with non-letters removed, must equal the key's prefix |
| recording | `table` | `torah` for parts 1–7, `haftarah` for `h` |
| recording | `archiveFile` | a bare `*.mp3` name, unique case-insensitively; server-only |
| recording | `seconds` | finite, greater than 0, at most 4 h |
| recording | `ref` | `Book c:v-c:v`, optionally `; `-joined parts in one book. Every part runs forward, and no two parts share a verse. A declared backward part is allowed and reported (`declared-backward-range-part`) because a real haftarah reads Jeremiah 34:8–22 and then 33:25–26 |
| verse | `ref` | canonical `Book c:v`, unique in the recording |
| verse | reading order | The first verse is the start of the first part. Each next verse is either: the following verse; or verse 1 of the next chapter, but only where `verseCounts` shows the chapter really ended (`verse-skipped`, or `chapter-end-unverified` without counts); or the start of the next declared part, but only once the current part is complete. The last verse must be the end of the last part (`recording-incomplete`). |
| verse | `start`, `end` | finite; `0 ≤ start`; `end ≤ seconds + ε`; length between 0.5 and 180 s; never starts before the previous verse's `end − ε` |
| verse | `review` | absent, or a declared state string (currently only `start-moved`) |
| verse | `alignScore`, `startVsSoundOnsetMs`, `labelGapMedianMs` | finite or null; diagnostics only |
| word | `he` | 1–64 characters, NFC, made only of Hebrew points, accents, letters, maqaf, paseq, sof pasuq, geresh marks and CGJ, with at least one letter. This is alignment evidence only. |
| word | `start` | finite; `verse.start ≤ start < verse.end`; strictly greater than the previous word's start |
| word | `label` | allowed only when `wordLabelsMatched` is true, and within the recording. **Never used for highlighting**: PocketTorah's labels lead the voice by 0.25–0.5 s. |

ε is 1.5 ms, because times are rounded to 1 ms (`TOLERANCES`). The same verse ref may occur in two recordings (22 refs do). That verse is only ever addressed as (asset, ref).

## 2. Read-word crosswalk

The authority is the portal's own `projectStudyVerse(ref, normalizeHebrew(MAM html))`: its `words[].text` (with the qere already chosen) and its `readingText`. The portal splits words at a maqaf, so a portal word never contains a maqaf, paseq or sof pasuq. The index's `he` never replaces licensed study text.

`crosswalkWords(portalWords, readingText, indexWords)`:

- **Counts.** Word counts must be equal. Words are strictly one-to-one: no grouping, merging, skipping or shifting.
- **Text.** Index word k must equal portal word k, plus at most one trailing maqaf, paseq or sof pasuq. CGJ (invisible) is ignored on both sides. Every other letter, vowel and accent is compared exactly.
- **Maqaf placement.** Index word k carries a trailing maqaf exactly when the portal's `readingText` has a maqaf between portal words k and k+1. The last word never carries one.
- **Binding.** Every portal word must be found in order in `readingText`, with no letters between them.
- **Otherwise** the result is `unavailable` with one of these reasons: `word-count-mismatch`, `text-mismatch`, `maqaf-mismatch`, `text-binding-missing`, `text-binding-mismatch`, `portal-word-punctuation`, `empty-word`, `no-words`.

**Reviewed overrides** (`applyOverride`) are the only other route. An override binds to three SHA-256 hashes: of the portal's NFC `readingText`, of the portal words joined by spaces, and of the index words joined by spaces. `buildVerseDto` computes all three itself, so nothing a caller supplies is trusted. An override also needs a non-blank reviewer and a real calendar date, and its groups must cover both sides completely and in order. Anything stale or incomplete means unavailable. None exist, and none are needed today.

## 3. Client DTO (`reference-verse/v1`)

```jsonc
{
  "schema": "reference-verse/v1",
  "ref": "Genesis 1:1",
  "table": "torah",
  "playback": { "status": "ready" | "needs-review" | "unavailable",
                "review": "start-moved" | "text-mismatch",   // only with needs-review
                "asset": "ra_<32 lowercase hex>",             // random or keyed-hash id from the approved-asset registry
                "clip": { "start": 1.0, "end": 4.0 } },       // seconds in that asset, 1 ms precision, start ≥ 0
  "words": { "status": "ready", "readingTextSha256": "<64 lowercase hex>", "starts": [1.1, 1.6, 2.1] }   // one per portal word
         | { "status": "unavailable", "reason": "..." },
  "attribution": { "title": "PocketTorah Audio Files", "creator": "not-a-box media lab", "license": "CC BY-SA 3.0",
                   "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/", "changes": "Cut into single verses with computed word timings." }
}
```

- **Approved asset required.** Without an approved registry entry there is no playback and no clip. The registry and its byte store are Codex's.
- **Highlighting needs a text hash.** `words.status === "ready"` always carries `readingTextSha256`, computed from the portal `readingText` the timings were mapped against. A missing or empty `readingText` gives `text-binding-missing`, and playback is unaffected. The player must refuse the timings if the text it renders hashes differently.
- **`text-mismatch` holds playback.** When the index words disagree with the portal text (count, letters or maqaf), playback becomes `needs-review` with `text-mismatch`, because the disagreement questions whether the audio is that verse. This never happens on today's index.
- **No text check.** When the portal itself cannot produce text (`portal-text-unavailable`), playback stays `ready`. Verse identity then rests on the validated reading order alone, and that is Codex's serving decision.
- **Never in the DTO:** file names, paths, archive or media URLs, recording keys, index Hebrew, labels, diagnostics, raw records or caller-supplied hashes. Tests assert this.
- **Word times** are on the asset's timeline. Subtract `clip.start` for a clip served alone.

## 4. Licence and provenance

Each fact below was checked on 2026-10-17 against its source.

- **The archive item** [archive.org/details/PockettorahAudioFiles](https://archive.org/details/PockettorahAudioFiles) ([metadata API](https://archive.org/metadata/PockettorahAudioFiles)) shows:
  - licence: Attribution-Share Alike 3.0, `http://creativecommons.org/licenses/by-sa/3.0/`
  - creator: "not-a-box media lab"
  - title: "PocketTorah Audio Files"
  - added: 2012-04-05
  - description: "Audio recordings of the weekly Torah portions used in PocketTorah. Avery-Binder style."
- **Our files are the archived files.** All 431 indexed recordings are byte-identical to it: their MD5s match the item's file list, 431 of 431.
- **The release announcement.** Russel Neiss, "Torah-on-the-Go!", eJewishPhilanthropy, 2012-04-17 ([link](https://ejewishphilanthropy.com/torah-on-the-go/)): "The audio files and their corresponding meta-data are being released under a Creative Commons Attribution-ShareAlike license"; reusers must "credit PocketTorah and license your new creations under the same identical terms." The code is GPL3, and we use none of it.
- **The app repository has no licence file.** [github.com/rneiss/PocketTorah](https://github.com/rneiss/PocketTorah) has none (GitHub's licence API returns 404). The label files come only from there, so they rest on the announcement's "meta-data" sentence. They are diagnostic only and never reach a client.
- **What [CC BY-SA 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/legalcode) requires:**
  - 4(a): distribute only under the licence, with a copy or its URI; impose no effective technological measures that restrict a recipient's licensed rights.
  - 4(b): adaptations under BY-SA 3.0 or a later version with the same elements.
  - 4(c): credit the original author, the title, the URI the licensor specifies "to the extent reasonably practicable", and the use in an adaptation. 3(b) and 4(c)(iv) also require marking that changes were made.
- **Study text.** Sefaria's MAM, CC BY-SA 4.0, already carried by the portal's edition provenance.

Codex has said it will check these rights and serving claims against the primary sources when it reviews the audio release design. Minimal release metadata to keep with each served asset:

- the `ATTRIBUTION` fields
- the archive identifier `PockettorahAudioFiles`, the archive file name and its MD5 (server-side only)
- this contract's version

Open before serving audio:

1. A serving design with no DRM, and clips offered under BY-SA.
2. The unnamed performer: the licence is the uploader's assertion, which Daniel accepted on 2026-10-16.
3. Daniel's 26-clip spot-check, which is pending. Machine agreement does not replace it.
