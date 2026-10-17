# Reference-audio contract: PocketTorah verse index to player adapter

Owner: Claude voice. Assigned by Codex in `docs/planning/2026-10-17-roster-admin-release/CLAUDE-VOICE-NEXT.md`. Code: `scripts/reference-index-contract.mjs` (pure contract), `scripts/reference-index-check.mjs` (private measurement CLI), `tests/reference-index-contract.test.mjs` (synthetic tests).

This concerns human reference recordings only. Generated chant stays parked and there is no generated fallback for gaps. No student hears anything from this until Codex's reviewed adapter ships and Daniel's spot-check passes.

## 1. What is ingested

The input is the private `pockettorah-verse-index/v1` file, which stays outside every Git working tree. `validateIndex()` is strict and closed. Any unknown field is an error, and nothing is clamped or repaired. A recording with any error is excluded whole, and the others still validate.

| Level | Field | Rule |
|---|---|---|
| index | `schema` | exactly `pockettorah-verse-index/v1` |
| index | fields allowed | only `schema`, `source`, `method`, `recordings` (1–5000) |
| recording | `key` | `<Parsha>-<1..7 or h>`, unique; the suffix must equal `part` |
| recording | `table` | `torah` for parts 1–7, `haftarah` for `h` |
| recording | `archiveFile` | a bare `*.mp3` name, unique case-insensitively; server-only, never sent to a client |
| recording | `seconds` | finite, greater than 0, at most 4 h |
| recording | `ref` | `Book c:v-c:v`, optionally `; `-joined parts; every range must run forward |
| recording | `verses` | 1–400 |
| verse | `ref` | canonical `Book c:v`: known book, no leading zeros, unique within the recording, inside the recording's range |
| verse | first `ref` | must be the start of the range |
| verse | each later `ref` | either the next verse, verse 1 of the next chapter, or the first verse of a later part of a split range |
| verse | `start`, `end` | finite; `0 − ε ≤ start`; `end ≤ seconds + ε`; length between 0.5 and 180 s; never starts before the previous verse's `end − ε` |
| verse | `review` | absent, or a declared state (currently only `start-moved`); any other string is rejected |
| verse | `alignScore`, `startVsSoundOnsetMs`, `labelGapMedianMs` | diagnostics: finite or null; never used for playback |
| word | `he` | NFC Hebrew, at most 64 characters, no whitespace, controls or bidi overrides; this is alignment evidence only |
| word | `start` | finite; lies within the verse (± ε); never earlier than the previous word's start |
| word | `label` | allowed only when `wordLabelsMatched` is true; must lie within the recording; **never used for highlighting** (PocketTorah's labels lead the voice by 0.25–0.5 s) |

ε is 1.5 ms: times are rounded to 1 ms. The tolerances are exported as `TOLERANCES`.

The same verse ref may appear in more than one recording; 22 refs do. That is legal and is reported as a warning. Such a verse is only ever addressed as (asset, ref), never by ref alone, so the adapter must choose the recording explicitly.

## 2. Read-word crosswalk

The authority is the portal's own `projectStudyVerse(ref, normalizeHebrew(MAM html)).words[].text`. Those words already carry the qere reading. The index's `he` never replaces or edits licensed study text; it only proves which aligned time belongs to which portal word.

`crosswalkWords(portalWords, indexWords)` works as follows:

- **Comparison key.** Both sides are NFC with sof pasuq (U+05C3), paseq (U+05C0), maqaf (U+05BE) and CGJ (U+034F) removed. Every letter, vowel and accent is compared exactly.
- **Exact rule.** Each portal word must equal one index word, or a run of consecutive index words joined only by a maqaf (a compound the aligner split). Every word on both sides must be used, in order.
- **Highlight time.** A portal word's highlight time is the aligned `start` of the first index word in its group.
- **Anything else is unavailable.** A ketiv/qere disagreement, a letter, vowel or accent difference, a space-joined merge, a word on either side left over, or empty words all give `{status: "unavailable", reason}`. Words are never shifted, skipped or fuzzily matched.
- **Reviewed overrides** (`applyOverride`) are the only other route, for a verse the exact rule can't map.
  - An override carries `readingTextSha256` (SHA-256 of the portal's `readingText`) and `indexWordsSha256` (SHA-256 of `indexWordsDigestInput(verse)`, the index words joined by single spaces).
  - It must name its reviewer and date.
  - Its `groups` must cover both sides completely and in order.
  - A changed text on either side makes it `override-stale`, which means unavailable. None exist yet; none are needed today.

Whole-verse playback and word highlighting are independent. A verse with highlighting unavailable still plays.

## 3. Client DTO (`reference-verse/v1`)

```jsonc
{
  "schema": "reference-verse/v1",
  "ref": "Genesis 1:1",
  "table": "torah",
  "playback": { "status": "ready" | "needs-review" | "unavailable",
                "review": "start-moved",                  // only with needs-review
                "asset": "ra_<16-40 lowercase alnum>",     // opaque, from the approved-asset registry
                "clip": { "start": 1.0, "end": 4.0 } },    // seconds in that asset, 1 ms precision
  "words": { "status": "ready", "readingTextSha256": "<hex>", "starts": [1.1, 1.6, 2.1] }   // one per portal word, by index
         | { "status": "unavailable", "reason": "portal-text-unavailable" | "text-mismatch" | "index-words-exhausted" | "index-words-left-over" | "override-stale" | ... },
  "attribution": { "title": "PocketTorah Audio Files", "creator": "not-a-box media lab", "license": "CC BY-SA 3.0",
                   "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/", "changes": "Cut into single verses with computed word timings." }
}
```

- **Asset.** Without an approved registry entry (`{assetId: /^ra_[a-z0-9]{16,40}$/, approved: true}`), playback is `unavailable: asset-not-approved` and no clip is given. The registry, its ids and whatever byte store sits behind them belong to Codex.
- **Never in the DTO:** file names, filesystem paths, archive or other media URLs, recording keys, Hebrew from the index, labels, alignment diagnostics or raw index records. Tests assert this.
- **Word times** are on the asset's timeline. A player serving the clip alone subtracts `clip.start`.
- **`words.readingTextSha256`** lets the adapter refuse the timings if the study text it renders differs from the text they were mapped against.
- **`needs-review`** marks the 36 verses whose start was moved earlier to catch a pitched sound. Whether these play before a person has listened is Codex's serving decision. The safe default is to hold them.

## 4. Licence and provenance

Each fact below was checked on 2026-10-17 against its source.

- **Archive item.** The item [archive.org/details/PockettorahAudioFiles](https://archive.org/details/PockettorahAudioFiles) ([metadata API](https://archive.org/metadata/PockettorahAudioFiles)) shows:
  - licence: Attribution-Share Alike 3.0, `http://creativecommons.org/licenses/by-sa/3.0/`
  - creator: "not-a-box media lab"
  - title: "PocketTorah Audio Files"
  - added: 2012-04-05
  - description: "Audio recordings of the weekly Torah portions used in PocketTorah. Avery-Binder style."
- **Our files are the archived files.** All 431 indexed recordings are byte-identical to the archive item: their MD5s match the item's file list, 431 of 431. They were fetched from the PocketTorah app repository, but the licence that applies is the archive item's.
- **The release announcement.** Russel Neiss, "Torah-on-the-Go!", eJewishPhilanthropy, 2012-04-17 ([link](https://ejewishphilanthropy.com/torah-on-the-go/)): "The audio files and their corresponding meta-data are being released under a Creative Commons Attribution-ShareAlike license", and reusers must "credit PocketTorah and license your new creations under the same identical terms." The source code is GPL3; we use none of it.
- **The app repository has no licence file.** [github.com/rneiss/PocketTorah](https://github.com/rneiss/PocketTorah) has no LICENSE file; GitHub's licence API returns 404. The word-onset label files come only from there. They are covered by the announcement's "meta-data" sentence, not by any archive licence. The DTO never carries them, and the index uses them only as a diagnostic.
- **What [CC BY-SA 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/legalcode) requires:**
  - 4(a): distribute only under the licence, with a copy or its URI, and impose no effective technological measures that restrict a recipient's licensed rights.
  - 4(b): an adaptation (our verse cuts) may be licensed under BY-SA 3.0 or a later version with the same elements, such as BY-SA 4.0.
  - 4(c): credit the original author and the title if supplied, give the URI the licensor specifies "to the extent reasonably practicable", and give a credit identifying the use in an adaptation. 3(b) and 4(c)(iv) also require clearly marking that changes were made.
- **Study text.** It is Sefaria's MAM, CC BY-SA 4.0, already carried by the portal's edition provenance.

Minimal release metadata Codex must keep with each served asset:

- title, creator, licence name and URL, the statement of changes (all in `ATTRIBUTION`)
- the archive identifier `PockettorahAudioFiles`, the archive file name and its MD5 (server-side only)
- this contract's version

### Rights questions to settle before serving audio

1. **Share-alike and access control.** Serving behind login is access control, not a technological measure on the work. But encrypted or DRM-wrapped audio, or terms that bar recipients from reusing the clip, would conflict with 4(a). The verse clips must be offered under BY-SA. Codex should confirm the serving design meets this.
2. **Attribution URI.** The licensor specifies no URI beyond the item itself. This contract keeps archive URLs out of the client, so the credit names the work, creator and licence. If Daniel wants the item link shown as a credit link (not a media source), that is a wording decision for him.
3. **Performer identity.** The reader is unnamed ("Avery-Binder style" is the chanting tradition, not the performer). The licence is the uploader's assertion. Daniel accepted it on 2026-10-16 ("we are safe with the license on archive, don't stress it"); this records that decision rather than independent verification.
4. **Daniel's spot-check is still pending** on the 26-clip page. Machine timing and label agreement do not replace it.
