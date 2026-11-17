# Claude voice assignment — reference recording contract

Assigned by Codex, 2026-10-17, under Daniel's direction to keep both Claude sessions working. Generated chant remains parked by Daniel's later instruction. This checkpoint concerns human reference recordings only, with no student release.

## Start and ownership

Preserve frozen `voice/human-alignment` at `39c8770`. Create a separate `voice/reference-index-contract` branch from that ref in `C:/Users/dsbog/bneimitzvah-voice`. That checkout's portal app is old: do not merge it wholesale into current main or copy old app/backend files forward.

You own narrowly named reference-index validator/coverage tooling under `scripts/`, synthetic tests and a new reference-audio contract/return document. No application, storage/player, schema/auth, repository-policy, shared STATE/COORDINATION, Python renderer or generated-engine changes. You are not alone: preserve others' work and do not recursively delegate. Codex owns the serving/player design and eventual narrow cherry-picks.

## Deliverable

Turn the existing private PocketTorah index handoff into a validated, model-independent ingestion contract suitable for a separately reviewed player adapter.

1. Validate the schema, closed relevant fields, finite times, positive recording duration, unique recording identity and canonical verse identity, in-range monotonic verse cuts and word starts, declared review flags and known coverage gaps. Specify tolerances and reject ambiguous identity/timing rather than guessing. A word highlight is based on aligned `start`, never the earlier `label`.
2. Define and test the authoritative portal Hebrew/qere read-word crosswalk. The index's `he` is alignment evidence, not authority to replace licensed study text. Maqaf, ketiv/qere, punctuation and normalization mismatches require an exact reviewed mapping or an explicit unavailable-word-highlighting result. Never shift highlighting silently. Whole-verse playback eligibility and word-highlighting eligibility should be distinguishable.
3. Produce a coverage/quality summary against the real private index with aggregate counts only in the public return. Detailed records, references, Hebrew text, source/index/audio files and real output stay outside every Git working tree. Synthetic fixtures alone go in Git. Reuse existing private-path/error-sanitization helpers where applicable; do not weaken repository protection.
4. Check the primary-source provenance and the actual recording/archive license, attribution and share-alike obligations. Save supporting official links and distinguish verified facts from handoff claims. Do not assume the code repository's license covers recordings. Identify the minimal release metadata Codex must retain; flag any unresolved rights question before serving audio.
5. Define a small client-safe adapter DTO with opaque approved asset identity, verse cuts, optional exact canonical word identities/times, review/availability state and attribution. Do not expose filesystem paths, archive URLs, arbitrary external media URLs or raw source-index records to clients. No upload, public hosting, new provider, paid service or student audio release in this assignment.

Generation lanes A/B-human/B-TTS and their open defects stay parked. There is no generated fallback for coverage gaps. Existing G1/G2/G3 policy is preserved. Daniel's pending human spot-check remains pending; machine timing/label agreement does not replace it.

## Acceptance and return

Cover malformed/duplicate/out-of-range timings, identity ambiguity, qere/maqaf mismatches, review states, coverage gaps, missing provenance and private-path protection with focused synthetic tests. Validate the real private index without printing source text, family data, credentials or private paths in public reports beyond the already documented handoff path. Keep Node checks and never-in-repo green.

Return a frozen narrow ref, exact changed files, aggregate results, verified licensing sources, unresolved quality/rights dependencies and a concise integration contract. Do not push main, deploy, serve audio, tune/generate voices or contact anyone. Codex will independently review before integration.
