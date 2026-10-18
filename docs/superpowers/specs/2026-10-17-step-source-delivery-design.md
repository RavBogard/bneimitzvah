# Bounded STEP source delivery

## Settled decisions (Daniel, binding)

Word meanings/grammar and Hebrew syllables/stress belong in1.0, without transliteration. Reference playback remains first. Generated voices and student recordings remain parked. Reuse the accepted STEP adapter and pinned source; no new paid service, storage store, provider configuration, corpus in Git, production migration, roster import or mail.

## Architecture decision

Use fixed public source fetches at STEP commit `bd09545c7a44b39ace20f16c0359915f2aa23a62`, with the existing CC BY4 attribution and parser change notice. The read-only source spike measured a pinned18,190,455-byte download in1.487s and representative book parsing in393–434ms. Observed RSS182–213MiB and retained book heap roughly40–47MiB plus8MiB lexicon are measurements, not hard ceilings or production guarantees. Runtime fetch is the smallest first source seam; defer build-derived function assets unless actual cold-use evidence justifies them.

Source manifest metadata may enter Git: fixed source identity/URL/pin, exact byte count and SHA256. Corpus and derived real-data assets may not. Verify the remaining three cache candidates against one GET each from their exact pinned official URLs before accepting manifest values; Genesis was already verified. Never overwrite cached originals on mismatch or print source/body/exception text. Record only hashes, bytes, counts and fixed outcomes. These three read-only requests are authorized preparation, not a provider write.

Own server-only modules under `src/server/study/lexical/`, synthetic app tests and a bounded return. Preserve the pure parser/morphology modules unless a separately reported blocker requires a narrow change. No HTTP route, runtime wiring, database, UI or engine change in this checkpoint.

## Transport and cache contract

- Production source descriptors are fixed to the three supported TAHOT groups and TBESH at that exact commit on official raw.githubusercontent.com paths. Caller input chooses only a recognized supported book code. No caller/environment URL, pin, path, digest or fallback source. Trusted constructor injection for synthetic transport tests must remain separate from the fixed production wrapper.
- Stream with an absolute deadline, caller cancellation, fixed HTTP/redirect policy, no cookies/auth/referrer, bounded bytes, fatal UTF8 decode and exact actual byte-count/SHA256 verification before parsing. Group cap32MiB and lexicon cap4MiB; actual descriptor length must also match. Bound header handling, cancel refused bodies and produce only fixed unavailable errors. No raw upstream error, URL, body or cause escapes. Do not add retries or network in ordinary tests.
- At most one active book-group producer and one lexicon producer, with at most16 attached callers per same key. Different-book contention or excess waiters returns closed unavailable; no unbounded queue or32-way group downloads. Book source is parsed only for the requested supported book, using the unchanged accepted adapter.
- Retain at most one completed immutable parsed book and one immutable lexicon. Cache keys bind source pin/digest and exact book. Cache no failed/pending result as a success, actor, session, authorization, assignment, canonical reading or response DTO. One caller abort does not cancel other subscribers; the last subscriber abort cancels transport, invalidates the completion generation and cannot repopulate a success cache. Do not overlap a replacement producer while a canceled predecessor still owns transport; stale completion cannot evict a newer entry. Cache public source only, never permission.
- Check cancellation again around synchronous parse/cache commit. Bound the data and concurrency honestly; do not claim a hard JavaScript heap ceiling from these guards. Preserve parsed source-format holds and exact correspondence rules. No fallback, guessed root, inferred stress, arbitrary LCS or transliteration retention.

## Acceptance and review

Synthetic tests cover fixed URL/pin selection, no ambient credentials, success/integrity/decode/size/deadline failures, immutable success reuse, fresh different-book parsing, contention/waiter bounds, partial and last-waiter abort, cancellation during parse, late completion and cache replacement, and no failure retention. Tests use isolated spawning and no real corpus/network. The three native verification GETs are separate ignored preparation evidence, not test fixtures or broad linguistic acceptance. Run focused tests, typecheck and repository protection; a different Sol independently reviews source/repository boundaries before root integration. Do not repeat completed reference-player visual/native work.

## Open items that wait on Daniel

None for this internal source seam. Word-details DTO, both study authorization passes and a secondary study-word interface are later bounded integrations; this checkpoint exposes no new student feature.
