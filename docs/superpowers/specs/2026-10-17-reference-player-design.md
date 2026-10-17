# Existing reference recording player

## Settled decisions (Daniel, binding)

Daniel's revised 2026-10-17 scope makes existing reference recordings the first 1.0 feature: word/verse playback, synchronized Hebrew highlighting and looping. Pitch adjustment is desirable if speed and alignment remain correct. Generated voices are outside 1.0; unfinished student recordings are parked. Preserve the existing reading interface, no transliteration, equal Torah/haftarah support and linked-child practice authority. Sol implements; root directs and integrates. No new service spending or source-permission decision is implied.

## Recovered evidence and first checkpoint

The [source contract](../../planning/2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md) and [integration return](../../planning/2026-10-17-reference-audio/INTEGRATION-RETURN.md) already define PocketTorah ingestion and exact word mapping. The local private index/audio/alignment collection has been located again; no replacement source discovery or uploads from Daniel are needed. Historical reports count 431 recordings and 7,073 verse cuts, with 36 start-moved holds and an older parser's 52 unavailable projections. Those counts are not current parser acceptance or listening approval. Keep the index, audio and licensed text outside Git. See the [current inventory](../../planning/2026-10-17-reference-player/PLAYER-INVENTORY.md) and source-readiness note alongside it.

First implementation checkpoint: client-safe closed `reference-verse/v1` parser and immutable source-timeline helpers. Only a ready playback variant can create a playable timeline; needs-review remains held. Reference IDs must match the requested verse before any playback. Word selection/highlighting additionally requires the actual rendered NFC reading-text digest and exact projected word count, never a digest echoed from the response. Missing/stale word binding may retain verse-only playback. Preserve fixed attribution and refuse malformed/oversize input.

Use seconds on the original asset timeline throughout. Clip and word intervals are half-open; each word ends at the next onset, or clip end for the final word. Highlight from the current source-media time, independently of wall time and speed. The original label field is diagnostic and must never drive highlighting. Onsets do not prove clean phonetic ends: real word loops still need audible review.

## Next implementation boundaries

1. Recheck the recovered index against today's portal projection and catalog using local data, reporting only aggregate results. Preserve existing review holds and coverage gaps, including missing Haazinu aliyah 1 and absent festival/special readings; no generated fallback.
2. Design the smallest approved-asset registry and serving adapter. Reuse public-source recording provenance, allow only approved opaque asset IDs and exact refs, preserve BY-SA attribution/change notices and recipients' licensed rights. Keep source paths, private index text and provider credentials out of DTOs. Storage work must serve reference playback only; do not borrow unfinished student-upload activation or restart its native proof. Independently review assignment/linked-child authorization and media access before release.
3. Fit explicit play/pause, verse/word selection, current-word highlight and repeat into the existing lifted reading surface. Word identity must survive phrase colors being turned off, including qere/ketiv and maqaf cases. No autoplay. Stop playback, cancel pending fetch/hash/play operations and clear old state on verse/assignment/role/child change or unmount. Stale asynchronous results must never resume the old recording. Audio ticks are not calendar visits.
4. Exercise browser playback with runtime-generated synthetic audio, then approved real source samples. Verify nonzero clip offsets, seek/loop boundaries, first/last words, speed changes, held/unavailable states, teardown, keyboard access and phone layout. Do not report the pure-helper tests as a working player or deploy acceptance.

## Independent pitch investigation

Browser `preservesPitch` maintains pitch while changing playback speed; it is not an independent pitch dial. See the [HTML media standard](https://html.spec.whatwg.org/multipage/media.html#dom-media-preservespitch). A separate DSP path must preserve the source timeline, account for processing latency, reset on seek/loop and stop cleanly on scope changes.

[Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch) is a candidate, not a selected dependency. Its primary documentation specifies independent transpose controls, input/output latency, seek/reset and fixed-length flush handling; its [project page](https://signalsmith-audio.co.uk/code/stretch/) identifies MIT licensing. A bounded browser/mobile feasibility test and provenance review are required before adoption. Do not substitute playback-rate/detune pitch shifts that alter duration or move the highlights. Basic accurate reference playback should not wait on an unproven DSP addition.

## Open items that wait on Daniel

The existing 26-clip source/timing listening review remains pending; start-moved verses stay held. No new request for source locations or reconsideration of the previously accepted uploader assertion is needed. Root prepares a playable, concrete review surface before asking Daniel to perform that listening check. Broader source coverage/custom recording choices can follow observed assignment gaps; do not invent missing audio.
