# Authorized word meanings and grammar

## Settled decisions (Daniel, binding)

Word meanings/grammar and Hebrew syllables/stress belong in1.0; no transliteration. Direct reference listening in the main passage remains the primary word action. Study details are secondary and must not open on playback ticks. This checkpoint delivers a closed word-details contract through existing study authorization; it adds no UI, provider, storage, schema, package or engine change.

## Contract

Start from the independently accepted source factory at75d4818 (exact CI pending). Preserve its fixed manifest, bounded public-only cache, pure parser/morphology, existing numeric word-aid endpoint and both study authorization passes. Add a client-safe `study-word-details/v1` contract/parser and server producer for exactly one explicitly selected canonical word.

The closed numeric identity is canonical verse ref, actual NFC readingText SHA256, word count and zero-based word index. Client validation must use its independently derived actual rendered reading text/vector/ref/index, not echo the response hash. Reject wrong counts/ref/index/hash, getters/unknown fields/malformed arrays, invalid Unicode and oversized payloads. Copy/freeze nested results. No whole Hebrew verse, engine internals, IPA, transliteration, raw source rows or source errors in the response.

Separate unavailable source/correspondence from a ready word. Ready data may include the short TAHOT occurrence gloss, factual occurrence morphology and up to16 lexical dictionary entries. A dictionary gloss describes a dictionary sense, not an authoritative occurrence translation. Entries may expose only validated lemma ID, dictionary headword in Hebrew and short TBESH gloss, or a closed unavailable result for that lemma; no raw pronunciation/meaning HTML/URL fields. Do not infer a root or replace occurrence grammar with dictionary grammar. Discard nonlexical lemma markers rather than pretending they have a dictionary definition. Retain recognized factual grammar fields only (part of speech, language, stem/form, person/gender/number/state/definiteness); omit opaque variant codes. Unknown morphology is explicit unavailable. Bound glosses to512 UTF8 bytes, headwords to128 UTF8 bytes, morphemes/entries to16 and the serialized selected-word DTO to32KiB. Rendered HTML is never part of this contract. Fixed source attribution includes STEPBible/Tyndale House Cambridge, exact commit, CC BY4 license link and normalization/change notice.

Produce data only after projecting the actual authorized verse through the existing canonical qere/maqaf read-word projector. Use `alignStepVerse`'s existing exact full ordered count/skeleton proof; source-format holds, unsupported books and mismatches remain unavailable. Never pick a repeated-word traceback, divine-name substitution, first alternative or fallback provider to force correspondence. Existing Hebrew syllable/stress delivery remains its own accepted contract; do not change it here.

A non-ready canonical projection, including its word/byte bounds hold, returns only the closed reconstruction-unavailable shape with schema/ref/wordIndex/status/reason and no fabricated hash/count. It performs no STEP I/O. Do not infer a vector or count from a generic projection hold or independently retokenize it. A malformed request index outside integer0..511 is invalid; an index at or above an actually ready, proved canonical count is also invalid before STEP I/O. An oversized/unproved verse is an unavailable analysis, not proof that an otherwise syntactically valid index is wrong.

## Authorization and transport

Compose a new service through unchanged `createStudyService`, like the existing word-aid service. Snapshot/validate word index and selection before asynchronous work; no mutable per-service current-word field. First authorization must precede text/source work, and the original second authorization/snapshot comparison must complete before projecting a response. This applies equally to cold and warm public-source cache hits. Preserve original request headers/selection, grant/relationship/student/assignment/context/session identity, expiry, abort and revocation checks. Source caches carry no authorized DTO or actor closure.

Add GET `/api/students/:id/study-word-details` following the existing strict word-aid query/method/host/session pattern, with one required canonical integer `wordIndex` in0..511 alongside existing study selection. Actual index/count is proved after authorized text loads. Reject unsupported query/body/method before source I/O. Explicitly project only the small existing authority envelope and closed word-details DTO. All responses remain private/no-store; no source/body/error logging.

Production runtime owns one module-scope no-I/O-created fixed source factory for public-cache reuse. Trusted composition injection may supply a fake source for offline tests, following existing component patterns; no test mode/environment bypass or live network in tests. Do not put a request-specific database, session or source closure into a global cache.

## Ownership and acceptance

Sol A owns new neutral DTO/producer/service/tests and narrow portal HTTP/runtime wiring. Existing access/study service, source factory, parser, word-aid endpoint, engine and frontend are read-only unless a specific blocker is reported first. Root owns architecture/integration. A different Sol independently tests the frozen authorization/HTTP boundary: actual SDK/HTTP revocation during a held source load, warm-cache second checks, sibling/context switch, original session expiry/replacement cookie, header/selection/index mutation, assignment/student/grant drift, abort, strict no-I/O methods/query and no private fields. Synthetic qere/maqaf/NFD/repetition/mismatch/hold/bounds/closed-projection tests are also required. Run focused tests/type/protection; exact hosted CI before promotion. No real data or corpus fixtures, production operation or UI work.

## Open items that wait on Daniel

None for this backend checkpoint. A secondary study-word interface and actual linguistic/usability acceptance remain separate work.
