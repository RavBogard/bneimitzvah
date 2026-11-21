# Cantor Wendy Shermet in CRC Torah

On November 20, 2026, Daniel selected Cantor Wendy Shermet of Temple Israel, Omaha as CRC’s default recorded voice throughout the product. Daniel confirmed that the rabbi’s permission covers CRC public streaming, shared reading links and offline practice on learners’ devices. A portal for Omaha is a separate future decision. Credit both Shermet and Temple Israel, Omaha.

## Implementation and acceptance

1. Inventory the published collection, including Torah, weekly and special haftarot, trope instruction, blessings, holiday variants and Megillot. Preserve Omaha’s page and row labels for each source. Report listed rows, distinct files, verified full verses and timed verses separately. [Omaha collection](https://www.templeisraelomaha.com/cantors-classroom) · [Special haftarot](https://www.templeisraelomaha.com/special-haftarot.html)
2. Acquire the original files outside Git. Verify each recording by decoding the full file and recording its duration and SHA-256. Bind public playback to the CRC identity and the verified inventory. Use the source label for a variant or unresolved reference until the corresponding verse can be identified.
3. Prefer Shermet on public, shared and assigned readings, the practice modal, Learn and new offline saves. Preserve existing saved practice. Align phrases and word taps to the Hebrew text and Shermet’s own performance. Use her full verse when available, even if fine timing is pending. Show the actual source when a different recording plays.
4. Make standalone recordings discoverable from relevant practice surfaces. Retain the tune or occasion named by Omaha. Compare verified ordinary verses with the CRC baseline of 5,846 Torah and 1,629 haftarah verses. [Coverage baseline](../../archive/superpowers/research/2026-10-22-reference-audio-coverage.md)
5. Independently review recording access and offline scope. Verify reader, Learn, mixed-source fallback and offline playback. Run CI on the release commit, then check the public deployment.

## Inventory evidence

The public site yielded 247 catalog pages, 8,326 playable rows and 8,154 distinct media URLs. The Chanukah blessings and Jeremiah 31:1–19 listings display titles or verse labels without a player or media link. One special Samuel page requires sign-in. Recordings on other public pages can still match overlapping references. Inventory and acquisition receipts are outside Git in the local shermet-collection media directory.

The first 20 decoded recordings cover Genesis 1:1, 1:27–30 and 22:1–4, Exodus 35:1–6, Numbers 6:26–27 and Micah 7:18–20. Credited full-verse exercises independently identify several of these files. [Genesis opening](https://voices.sefaria.org/sheets/415562) · [Exodus exercises](https://voices.sefaria.org/sheets/386127) · [Micah recordings](https://www.templeisraelomaha.com/micah-718-20.html)

## Verified collection

CRC can play all 8,153 distinct source files that returned decodable audio. The published Numbers 1:1 file is empty. The reader maps 7,434 ordinary verses. The library contains 778 entries for other performances and source labels. Some performances appear in both. The union of published source IDs and SHA-256 digests matches the acquisition receipts.

| Reading | Matched CRC verses | CRC baseline | Coverage |
|---|---:|---:|---:|
| Torah | 5,774 | 5,846 | 98.77% |
| Haftarah | 1,541 | 1,629 | 94.60% |
| Combined | 7,315 | 7,475 | 97.86% |

The remaining 119 ordinary verse recordings fall outside the weekly and festival baseline and can be used for custom readings. The local coverage report lists every remaining full-verse gap. Source identity checks include original page/row evidence, canonical verse bounds and independent comparisons of the sung Hebrew wherever a file was assigned to different biblical texts.

## Playback pace

Daniel selected a faster teaching pace on November 20 after hearing the live recordings. The displayed 1× plays Cantor Shermet at 125% of the recorded tempo, with pitch preserved. Relative rates 0.5×, 0.75× and 1.25× play at 62.5%, 93.75% and 156.25% of the original. Reader highlights and clip boundaries follow the recording’s media clock. The same convention applies to the library, prayer lessons, Learn examples and offline practice. PocketTorah uses its own natural tempo.

## Library playback controls

Listen starts the selected recording and focuses the compact player. Controls opens playback settings within the selected recording's result. Collapsing Controls keeps playing. Close stops playback and returns focus to the Listen button. Changing the search, category or page closes the player. Embedded service lessons retain their controls next to the lesson.

## Completed word-timing pass

Every one of the 7,434 ordinary verse recordings was evaluated. The primary alignment qualified 2,118 verses. The independent word-boundary pass qualified another 2,668. The release contains 4,786 timed verses (61,262 words), including 3,770 Torah and 941 haftarah verses within CRC’s 7,475-verse baseline. Every timing was checked against its source digest, normalized Hebrew text digest, word count, and ordered media-clock intervals. The other 2,648 recordings support whole-verse practice. Across the 110 course references, all have complete recordings and 72 have qualified word timings.

Production verification on CRC’s canonical site covered signed-out first-tap playback for Torah and haftarah, a word clip in Numbers 6:26, the blessing before Torah, byte ranges, and a full hash match for the 7,327,802-byte WAV recording. An installed phone test saved a hash-bound recording, then played it with the network off at the faster default.
