# Next source milestones: preparation, not implementation approval

Prepared alongside the independently reviewed assigned-citation discovery checkpoint. Two Sol workers performed bounded read-only preparation: existing assignment/storage seams and official selected-edition documentation. No live source API/body request, database operation or next-milestone implementation occurred. Daniel's existing commentary requirements remain authoritative; this note grants no new license or role.

## Citation assignment before content expansion

Reuse the live staff privilege pattern of `note-write`, the version/receipt/audit transaction pattern in `src/server/student-work/service.ts`, and current reading locks from `confirmedReadings`. A source-specific capability or deliberate reuse needs an explicit reviewed contract. A public catalog hash proves change detection, never write permission. ADD must establish the server-resolved citation against the actual target outside SQL locks, then recheck live staff and reading authority transactionally. REMOVE should work from stored identity/current version without requiring provider availability.

Prefer an immutable full-value citation-set version stream with expected-version checks, actor-scoped mutation receipts and atomic audit. Source bodies, rights approvals and arbitrary client metadata do not belong in that set. Preserve historical canonical verse and stable assignment/student identity: `persistAssignment` deletes and reinserts `assignment_verse` rows, so durable history must not FK to those transient verse IDs. Stored reading revision alone is not current proof.

Before code, root must settle stream identity across reading revisions, a justified active-set/byte bound, duplicate/no-op behavior, precise prepare/confirm and receipt reconciliation, and the old-revision policy. No silent reactivation when a verse survives or returns. Unknown COMMIT needs authorized reconciliation rather than a new UUID and blind retry. Force tenant RLS, composite authority FKs, immutable rows and audit constraints; prove them in a disposable native fixture. RELEASE's next migration number is0021; parked recording migrations must not be imported.

## Selected-edition content is a separate contract

V3 requires a full English language name with the exact edition title. Omitting the selector or specifying only a language can choose a priority edition; the older `en`/`he` catalog field is not a generic ready-to-use V3 selector. Disable missing-segment fill and request plain text. Require the exact returned reference/index/edition and no fallback warnings. [V3 reference](https://developers.sefaria.org/reference/get-v3-texts), [version catalog](https://developers.sefaria.org/reference/get-versions).

The official tutorial illustrates scalar segment content while the reference describes arrays; broad or spanning commentary references do not establish a safe generic flattening contract. Start with a proven segment and hold unsupported extents/shapes. A plain-text flag does not replace bounded safe parsing and text-node rendering. No actual content-response shape was verified by this documentation-only research. [Official tutorial](https://developers.sefaria.org/reference/tutorial-dvar-torah-outliner).

Rights are edition-specific; absent licensing is not verified permission. Keep exact edition provenance and unknown rights held. Human commentary does not acquire an extra rabbi-approval gate from this research: the mission specifically requires rabbi approval for generated summaries, and clergy authority for congregation defaults remains separate. Source assignment, source rights and generated-summary approval are distinct decisions. [Sefaria data-use guidance](https://developers.sefaria.org/docs/usage-of-our-name-and-logo).

## Next action

Finish discovery's exact integration/deployment gate, then design and independently review citation assignment's transaction/schema contract. Plan its optional inline interface against the incumbent reading surface. Source content expansion follows an exact-edition/safe-content/rights contract; do not silently introduce a broad range reader, default edition, source chatbot or clergy role grant.
