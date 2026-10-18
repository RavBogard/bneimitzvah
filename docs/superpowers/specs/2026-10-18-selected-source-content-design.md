# Exact-edition text for an authorized verse source

## Settled decisions (Daniel, binding)

Commentary belongs to the student's own verses; authorized readers may browse sources and staff may assign them. Human commentary has no extra generated-summary approval gate. Preserve the flowing Hebrew, direct reference playback, quiet unchanged tab return and absence of transliteration. Generated voices and student recordings remain parked.

Root accepts the bounded author-feasibility and independent design reviews for this backend first slice. This is not complete commentary coverage or authorization to invent clergy defaults. There is no UI, new schema, cache, storage, invitation or mail work here. The inline Sources release is separately checkpointed at c3018e2045a855ce1c63ed169126c8ed06dc0bbb; its exact hosted gate remains pending.

## Authority and source binding

Extract only the shared private current-verse capture from the existing source-assignment boundary. Preserve its copied original request, ordinary live read/practice dispatch, exact current confirmed assignment/revision/vector/verse and full private session, grant, student, relationship and context binding. Public DTOs and mutation-receipt compatibility are not authority for this read. Leave Bible StudyService and existing source-write/receipt dispatch and semantics unchanged.

Preflight and final fresh capability transactions surround all public work. No transaction spans provider I/O. Compare the original full binding again before exposing any staged outcome. In assigned scope, require a positive current set version and resolve one stored citation under that head; seal its head identity/version and complete closed snapshot. Final lookup must find the same current head/snapshot, including after clear/re-add. No related lookup is needed for a retained assigned citation.

In related scope, resolve the source ID from one freshly fetched complete related catalog for the actual verse and the supplied hash. Never accept a caller source ref, work title or URL. A hash proves that observed public catalog, not an external atomic lock. Final authorization still checks the original reading/context.

## Closed HTTP contract

Add private/no-store GET endpoints `/api/students/:id/source-editions` and `/api/students/:id/source-text`. Student identity comes only from the path. Common query fields: mode, kind, assignmentId, assignmentRevision, verseRef, sourceId, sourceScope (`assigned|related`). Assigned scope requires positive expectedSetVersion and forbids sourceCatalogHash; related scope requires sourceCatalogHash and forbids expectedSetVersion. Reject duplicate/extra keys and bodies.

Edition listing adds editionOffset (explicit zero, then multiples10 through510), with editionCatalogHash required after page0. Text instead requires editionCatalogHash, exact bounded editionTitle without the selector delimiter, and language=`he|en`, mapped only to `hebrew|english`. No default/priority version, orientation-based language inference, fallback or missing-segment filling.

Return the existing small authority/reading/verse envelope, one closed source identity and either a ten-entry edition page or one scalar text/provenance result. Expose set version or related hash only for its actual lane. Do not expose private authority bindings or raw provider objects. Fix these error classes before code freeze: invalid request400; live denial401/403/404; stale reading, changed current source set, related catalog or edition catalog409; deliberately unsupported source/edition profile422; transport/malformed/timeout503. Use fixed closed codes; no provider detail or source excerpt in errors.

## Editions and current rights

Reuse accepted edition metadata parsing without changing its existing normalization/order semantics. The new page projection sorts copied rows deterministically and hashes the full normalized work/catalog, license/source/actual-language facts and held/duplicate counts. Preserve all512 bounded rows; do not truncate to64. Body selection must resolve exactly one current row for actual language and exact title, or hold as ambiguous. Legacy language and actual language remain distinct.

Root approves only exact current `Public Domain` and `CC0` profiles for this first human-text reader. Require nonempty bounded inert versionSource; missing/changed/unknown license or provenance remains held. Check current metadata and returned selected version, including title, legacy language, actual language, mother-language family, license and source. Credit Sefaria, source reference, exact edition and license. Provenance is plain text, never a fetch or arbitrary link. An edition listing is not a promise that its text is ready. Other rights/attribution profiles need separate work.

This follows Sefaria's [edition-specific reuse guidance](https://developers.sefaria.org/docs/usage-of-our-name-and-logo); its [contribution guidance](https://www.sefaria.org/add/new) describes CC0 original translations as donated to the public domain. Unknown licenses do not establish permission.

## Exact text and bounded public work

Initial support is a complete simple numeric leaf: complete indexTitle followed by canonical positive decimal colon addresses, exact returned ref/index/depth, equal canonical STRING sections/toSections, nonspanning, exactly one selected version and empty warnings. Only nonempty well-formed scalar plain text may be ready. Reject arrays, padding, fallback, markup/entities, unsafe controls and unsupported extents. Preserve the received scalar exactly; do not flatten or invent a first comment/paragraph. The provider's text_only transform must be credited honestly. Whole-verse parents, ranges, named nodes and broader rights remain outstanding work, not silently omitted requirements.

Public work has one20s monotonic total budget; each fixed official HTTPS GET receives at most10s total and5s progress idle, shortened by remaining time. No redirects, retry, credentials, referrer, provenance fetch or global cache. Retain2MiB decoded transport, fatal UTF8/JSON,64-empty-read and late-body cleanup guards. Enforce64KiB actual scalar and128KiB actual complete escaped output independently; hold overflow without truncation.

Provider budget cancellation is separate from the copied original caller signal. Stage timeout, parse, rights, unsupported, hash and output-bound outcomes, then perform final authorization and binding comparisons before returning them. A provider timeout cannot hide revocation, reading drift or source-head change. Caller abort may refuse delivery. Large intermediate catalogs and late bodies must not survive the request.

## Ownership and acceptance

Sol author owns the narrow context extraction, pure edition/content projections, bounded fixed-host reader, service, strict HTTP boundary and runtime/offline wiring plus new author tests. Independent Sol reviewer owns new adversarial tests and is sole launcher of any disposable native window. Root owns architecture, Git, live operations and final integration. Shared checkout: preserve other edits; no recursive delegation.

Acceptance covers both source lanes and actual modes, early denial/no I/O, mutation of original inputs/headers, final session/guardian/grant/child/reading/head drift, provider failure precedence, deterministic complete paging, ambiguous selectors, exact rights/provenance/language/version/ref, strict string addresses, output/transport bounds and late cleanup. Explicitly exhaust provider budget while revoking access/changing head and prove final denial/staleness wins. Reuse existing source-assignment read/write/receipt regressions after extraction; independently review authorization. No licensed body or raw response in Git/logs/tests: invented fixtures only.

The completed earlier live probe remains held: numeric address checks failed and actual address values were not retained. Official upstream string serialization supports the new contract, not a retrospective pass. No further API call is authorized by this design. Root may separately authorize one fixed live parser check after offline freeze; a live-ready claim requires that evidence and exact hosted release checks.

## Open items that wait on Daniel

None for local implementation of this established human-commentary subset. Broader source coverage, rights requiring new permission, clergy defaults and generated-summary approval remain separate. No product-complete or production source-body claim is made here.
