# Finkel private reading review

## Settled decisions (Daniel, binding)

Reading practice comes first. Prefer reviewed Finkel material and preserve one source/performance across each selected passage. Later word taps play complete trope phrases, with verse playback and looping. Service parts, lessons and pitch adjustment follow. The chosen visual direction remains Annotated score.

The prepared collection is not human-approved. All 322 clips remain studentReady=false; no validated phrase/word timings exist. Machine verification and filename defaults do not establish listening, privacy, text, musical or rights acceptance. Private review must not expose personal lesson context or raw catalogs in Git or public transport.

Astra approved this bounded implementation on 2026-10-21: private manifest/control/decision backend, maximum eight machine-passed scripture clips, four MiB per playback, 128 KiB per manifest, whole-clip listening only. The first eventual real batch is four clips: one Torah and one haftarah selection, each plain spoken plus plain chant. Each pair must cover identical verses and derive from the same original source. Producer examples are candidates, not an approved selection. No drills, speed variants, service symbols or inventory-only works enter this first slice.

## Runtime boundary

The subsystem is distinct from PocketTorah. No Finkel path is added to its public short-audio route, catalog parser or student playback provider. The existing PRIVATE Blob store ID is injected by trusted composition. Native request-context OIDC is the sole Blob credential; no static-token, public-URL, endpoint or signed-client-URL fallback exists.

`createReferenceReviewService` receives the existing verified-identity access service, an optional exact reviewer configuration, and the private getter. Missing configuration fails closed. Configuration requires tenant `crc` and the immutable actual Daniel user ID. Implementation correction: BetterAuth stores user IDs as text and this app does not override its generator. The accepted canonical ID syntax is `[A-Za-z0-9_-]{1,128}`, matched exactly and case-sensitively to the live actor; no UUID, email or any-admin inference is made. Tenant IDs are also existing text namespaces, not UUIDs.

Each operation requires the configured identity, enabled tenant, live verified session, active membership and active admin grant. Mutations require a fresh session and same-origin cookie CSRF checks. Authorization snapshots bind session ID/expiry, membership authority revision and role-grant ID/revision. Every external fetch ends before final reauthorization; changed actor/control snapshots or elapsed expiry deny the result. Identity locks precede grant locks and batch locks. Session/batch expiry is checked again after lock waits, after asynchronous COMMIT, and immediately before return. An internal WeakMap barrier also checks immediately after runtime pool cleanup, without exposing any expiry marker in transport; list rows are filtered at that final instant. Authorization locks necessarily end before response delivery. An operation committed while authorized is not rolled back if its final reply later expires: the UI treats that reply as uncertain and requires readback rather than blind replay.

The media endpoint buffers an entire selected object with byte, time, idle and empty-read bounds. It verifies complete SHA-256/length before returning audio, then reauthorizes. Requests resolve only members of the pinned manifest. Responses use private,no-store, no-referrer and nosniff; audio also explicitly disables CDN caching. No Range, HEAD, arbitrary query/body fields or provider path selectors are accepted. Previously delivered bytes cannot be recalled; revocation denies subsequent reads and decisions.

## Immutable evidence and controls

The content-addressed PRIVATE manifest contains sanitized canonical reading references, plain mode, exact canonical Hebrew snapshot and projection hash, parser catalog/asset/target identities, master hash, and playback size/hash/duration. It contains no raw source IDs, titles, personal provenance, upstream URLs or proposed timings. Importer identity is recomputed rather than accepted as a label. Hebrew is rendered as plain text.

Text snapshots must come from the existing app's approved canonical text reader and `projectStudyVerse` reading projection for the exact refs. Producer transcripts or arbitrary titles are not a text authority. `buildReviewManifest` is a trusted preparation seam, not a user-facing admission API; its syntactic/hash checks alone cannot prove where supplied text came from. Future operator preparation must establish that provenance explicitly.

Migration0026 adds a tenant-scoped batch control (manifest/catalog digest, exact reviewer, member count, generation, expiry and revocation) and append-only per-entry decisions. Controls cannot change identity/expiry after admission. Revocation creates a permanent tombstone and increments generation once. Runtime has SELECT and column-limited revocation UPDATE on controls, SELECT/INSERT on decisions, and no admission, rewrite or delete privilege. Forced RLS applies to both tables. Database triggers independently prevent rewriting evidence or appending to an inactive/revoked/wrong-generation/wrong-reviewer control.

Each decision binds catalog, manifest, asset identity, target, canonical text, playback SHA/byte count, live actor/session/grant revisions, server time and five distinct pass/hold checks: privacy, listening, exact text, musical accuracy and rights. An expected per-entry revision is checked under the batch lock; corrections append history. Request UUID plus request digest makes identical retries idempotent and conflicting reuse fail. SQL checklist checks use `IS TRUE` so JSON null cannot bypass a CHECK.

Five passes mean whole-clip review accepted only. Every returned decision still advertises studentReady=false and timing=unavailable. This slice contains no student release, timing approval, admission or publication route. A later independently reviewed release operation must consume exact accepted evidence and the additional validated timing/source-selection contract. No global release flag can activate this provider.

## Next operator slice — proposal, not yet an upload implementation

Use two phases, with a count-only dry run before any external mutation. Preserve the source package and store all preparation artifacts outside Git.

1. Pin the prepared catalog bytes, reviewed importer source and selected entry declarations. Resolve only explicit selections; max four in the first batch. Validate plain spoken/chant pairs against identical exact Torah/haftarah refs and the same original source SHA. Reuse prior package-wide evidence; freshly verify only the selected playback and master sizes/SHA. Resolve every path under the pinned private package root, reject symlinks/reparse points and realpath escape, and leave the package untouched.
2. Fetch exact refs through the existing approved canonical text reader; project the reading text and bind every snapshot/hash. Produce the sanitized manifest and explicit digest-path upload plan. Count-only diagnostics distinguish pending human checks without returning source labels/paths/text. Dry-run receipts bind importer, catalog, manifest, selected media and text snapshots; they confer no release approval.
3. Only after exact-source tests and independent review, use the existing native private create-only upload/readback protocol adapted to the new namespace. Verify the exact intended project/environment/store and CRC DB target under the shared release lock. Existing differing objects fail; identical objects are verified and reused. No overwrite, public path or provider override exists.
4. Fully read back selected immutable objects and compare hashes/lengths before owner registration through `admitReviewBatch`. Admission uses an explicit batch ID/reviewer/expiry and must reconcile identical repeated registration rather than silently replace controls. The current helper intentionally rejects duplicate insertion; idempotent owner reconciliation remains part of this proposed operator slice. A failed/unknown external outcome requires readback, not blind repetition.
5. Production migration0025→0026 is a fresh scoped reviewed operation after source/CI gates and release-lock coordination. Historical runners are references only. No actual upload, database admission or production operation occurred in implementing this backend.

## Verification and remaining boundary

Synthetic app tests exercise full-body integrity, decisions/history/idempotence, wrong actors/tenants, CSRF/closed schemas, revocation and authority changes during fetch, permanent holds, runtime privileges and immutable SQL records. Native PostgreSQL tests observe actual blocking edges for decision contention and revoke-vs-decision, expiry after lock waits, revocation during external fetch, RLS and all five JSON-null checklist cases. Independent adversarial review remains required for authorization, tenancy and private media access.

The low-level getter and operator admission helper are explicit composition seams, not proof of an actual uploaded batch or private listening acceptance. Real collection/audio/text payloads are absent from Git. Human privacy/listening/text/musical/rights checks and future timing validation remain open.

## Open items that wait on Daniel

Daniel reviews the actual selected private whole clips against the five separate checks after reviewed preparation/admission. Individual musical/text/privacy/rights findings may hold a clip or batch. No additional visual-world or permission interview is required. Future student release and validated fine timing need their own concrete accepted evidence; this backend does not manufacture either.
