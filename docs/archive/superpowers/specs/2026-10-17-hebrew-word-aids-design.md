# Hebrew word-aid foundation

## Settled decisions (Daniel, binding)

No transliteration. The next study tools include Hebrew syllables/stress, word meanings/grammar and commentary/source assignments. Generated voices are outside 1.0; student recordings remain parked. This first bounded backend slice provides syllable/stress data without a new provider, schema, route or interface.

## Root's implementation contract

Use the portal's canonical NFC `projectStudyVerse` read words, including qere and maqaf behavior. Accept an already normalized study verse, never a raw HTML request. The server may reuse the existing dependency-free `trope/text.mjs` analysis on safely escaped canonical reading text. Do not change that engine or import its Node/IPA/phoneme machinery into the client.

Return a closed, bounded, immutable `study-word-aids/v1` DTO tied to canonical ref, actual NFC reading-text SHA256 and word count. Ready words contain only their canonical index and consecutive UTF-16 syllable ranges within that word, with `tonic`, `secondary` or null stress. No duplicate Hebrew text, IPA, romanization, raw warnings, phonemes or engine objects enter the DTO. A client-safe parser must validate the range tiling against the actual expected canonical words and independently supplied text hash; an echoed response hash is not evidence.

When canonical projection cannot be proved, use only the closed verse-level `schema/ref/status/reason` unavailable shape, without inventing a hash or word count. It authorizes no ranges. Successfully projected ready envelopes carry the exact hash/count and a ready-or-unavailable result at every canonical word index. Client parsing always binds the canonical ref and requires independently supplied actual words/hash before accepting a ready envelope.

Map whole-verse engine units back to canonical read words in exact order. Strip only explicitly understood separators during comparison; require exact NFC reconstruction, matching counts and boundaries before Hebrew letters rather than detached combining marks. Never guess a word index, split a grapheme or silently repair a mismatch. Bound source size/count using the existing projector and also bound the resulting syllable count/serialized DTO. Copy rather than mutate input; freeze output.

Reject unsupported poetic accent systems (Psalms, Proverbs, Job), reconstruction failures and engine warnings with closed unavailable results. A special spoken-form substitution (`read` in the older engine, including divine names/Jerusalem) makes its unit unavailable for this first guide; do not show a literal syllable guide that would teach a different pronunciation. Other exact independent units may remain available. No stress is inferred from an unaccented word: accept stress only for an explicitly accented unit (or a verified final meteg/silluq context), with a coherent single tonic in that unit. Maqaf members may correctly lack their own tonic. Unsupported/ambiguous cases stay unavailable rather than defaulting to final stress. Engine errors/warnings can include source text and must never escape or be logged.

Keep the type/strict parser under `src/lib/hebrew/` without Node imports, and the analysis adapter under `src/server/study/`. Add only the minimal engine declaration needed by TypeScript. No network, persistence, authority wiring, translation-edition changes or UI controls are part of this checkpoint.

## Acceptance

- Direct synthetic expected-output cases cover pointed Hebrew, explicit stress, sheva/dagesh/meteg, maqaf, qere and split display spans; no real licensed corpus is added to Git.
- NFC/NFD, malformed/mismatched source, ambiguous/unaccented/poetic/special-reading inputs fail safely where exact proof is missing. Every ready word reconstructs exactly, and range/stress output is bounded and immutable.
- Strict parser rejects extra fields, wrong ref/hash/count, malformed indices/ranges, detached marks and any unsupported status/stress/shape. It returns no raw source/error details.
- Existing engine/projection tests remain unchanged; focused new tests, typecheck and repository protection pass. A second worker reviews correctness and adversarial boundaries before integration.

## Open items that wait on Daniel

None for this pure backend contract. Lexical data/provider licensing, commentary approval and later teaching/listening acceptance are separate decisions; this foundation makes no claim that those features or the guide's user interface are complete.
