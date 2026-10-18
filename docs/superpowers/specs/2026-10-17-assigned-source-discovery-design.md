# Related sources for an assigned verse

## Settled decisions (Daniel, binding)

Commentary and source assignments belong to the student's own verses. The student reading remains a flowing Hebrew passage with direct reference playback. No transliteration, student chatbot or generated voices. This backend milestone makes related citation metadata available under existing reading access; it adds no new interface, source text, assignments, defaults, approval or role grants.

Metadata checkpoint fe4d8deb580e7c21ff3c6c1449a10c20fee19b57 passed all four exact hosted jobs39091506738 and its normal canonical Production deployment is verified. It preserves the separately reviewed6e150376 Word tools experience. Discovery is a separate branch/checkpoint; never promote its later HEAD using the metadata gate.

## Authorization and public work

Add a narrow service following the existing selected-word service adapter. Reuse unchanged `createStudyService` and an actual existing `loadText` result; do not invent a fake StudyPage or generalize the protected service merely to avoid that read. Capture the request-local source-page selection before public work. The target must equal the actual selected assigned verse at the verified public request offset. The caller cannot choose a source reference, work title, URL, category or provider endpoint.

Load related metadata using the accepted fixed-host reader. It still requests links with text and sheet content disabled; it does not fetch versions or source bodies. Require a closed catalog for that exact target verse. Preserve original request, selection, session, student, role/relationship and assignment bindings across both existing authorization passes. Public metadata work runs outside the capability transactions. Abort and expiry remain effective. No new cache, coalescer, global private result or environment bypass.

Stage catalog mismatch, dynamic out-of-range and metadata-provider-unavailable as tagged outcomes on the actual loaded StudyPage; map them to409/400/503 only after the unchanged final authorization pass. A provider failure must not mask a concurrently revoked session or relationship. Do not throw those source outcomes inside the public loader and bypass the second pass. Existing base-text failure and request-abort semantics remain unchanged. The existing text budget plus metadata's10-second bound can exceed the Word tools client's15-second budget; a future discovery client needs its own complete deadline rather than copying that adapter blindly.

## Explicit pagination

Return at most10 entries per page with a64KiB cap on the complete private HTTP JSON body, including its authority envelope. This fixed page size accommodates the maximum retained fields even after JSON escaping. The related metadata parser's full4096-row and2MiB limits remain unchanged. Do not silently truncate the catalog to a small application cap.

Sort the copied accepted entries by opaque provider ID using deterministic ordinal comparison, independent of locale/provider row ordering. Compute SHA256 over a documented stable closed serialization of the full normalized catalog, including verse, entries and received/held/duplicate counts. This public catalog hash is change detection, never an authorization token or immutable source-text identity.

Use required separate `sourceOffset` (multiples of10,0..4090, including explicit0 for the first page) and optional lowercase64-hex `catalogHash`; Bible `offset` retains its existing meaning. Offset0 can start without a hash. Any subsequent source page requires a hash. A supplied hash must be valid even at offset0. When it differs, return a source-catalog-changed result only after the final authorization pass, with no entries; the HTTP status is409. A client must restart rather than combine catalogs. If the catalog becomes shorter, hash change takes precedence over dynamic page bounds. With a matching catalog, out-of-range pages are rejected. Empty catalogs allow offset0 only.

The closed page contains schema `study-related-page/v1`, target ref, catalog hash, source offset, fixed page size, total accepted entries, received/held/duplicate counts, nullable next source offset and copied entries. Entries expose only id, ref, complete indexTitle, category and nullable short en/he title labels. Include no arbitrary URLs, provider rows, source text, edition rights claims or hidden commentary approvals. Every accepted entry can be reached by following the declared next offsets while the full catalog identity remains unchanged.

## HTTP and composition

Add GET `/api/students/:id/study-sources` to the existing portal dispatcher and compose the service with the existing access/practice/loadText and fixed-host metadata reader. Match the existing study authority envelope. Allow only existing StudySelection query keys plus sourceOffset and catalogHash. Reject duplicate/unknown/malformed query fields, bodies and transfer-encoding; accept only absent or exact zero content-length. Methods/host/session/error handling follow the existing boundary. Every response is private/no-store; source failure is a fixed unavailable response, never raw provider detail. Closed explicit field projection and the full body byte cap apply before responding.

Offline app and HTTP-browser fixtures must wire a trusted empty or injected related metadata source with no network; production remains the fixed reader. Do not add provider configuration, credentials, mail, schema/migration, UI, paid service or source assignment storage. Do not weaken original study or HTTP tests.

## Ownership and acceptance

Sol A owns the new source-discovery service, narrow portal/runtime composition and required existing fixture wiring, plus new author tests. Sol B owns separate independent tests and reads implementation; no overlapping source edits. Root owns this design, final integration, Git and release. Shared checkout: preserve other changes, no recursive delegation.

Acceptance uses actual existing fixture access and SDK HTTP behavior with invented metadata: correct assigned Torah/haftarah verse; denied/other-student access performs no metadata I/O; assigned tutor and explicit child-practice behavior; real revocation, expiry, student/assignment/relationship changes during delayed public work; original mutable caller inputs cannot rebind; two-pass behavior on catalog changes; full reachable catalogs over64 entries; exact hash insensitive to provider ordering but sensitive to retained changes/counts; escaped maximum-field body sizing; empty/last/out-of-range pages; malformed/duplicate/unknown query and method/body rejection; private/no-store; abort/late/unavailable handling; no source text/version endpoint. Run focused author/independent composition, types, isolation/protection and required integration gate. No live API or production migration is needed for implementation/review.

## Open items that wait on Daniel

None for existing-scope citation discovery. Actual-source listening, edition-specific reproduction rights outside established terms, protected clergy provisioning and later source-assignment release remain separate gates.
