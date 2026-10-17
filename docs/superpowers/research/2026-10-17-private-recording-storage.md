# Private student-recording storage — researched 2026-10-17

Decision status: **candidate, not provisioned or approved for spending**. This note prepares the next recording milestone; the current0020 ledger has no storage SDK or provider dependency. Human reference audio has a separate provenance and release contract. Generated chant remains parked.

## Recommendation and verified constraints

Prefer a dedicated **private Vercel Blob store**, if the deployment checks below pass. Keeping the existing host avoids adding an unrelated service, while private objects require authenticated reads and writes. Delivery goes through our authorized endpoint; never substitute a hard-to-guess public URL for access control. [Private storage and security](https://vercel.com/docs/vercel-blob/security).

A single32MiB recording cannot be posted through an ordinary Vercel Function: request and response payloads are limited to4.5MB. Use a narrowly scoped direct browser upload, then verify it before registering private metadata. Streaming playback needs a separate range/streaming proof on the deployed runtime. [Function limits](https://vercel.com/docs/functions/limitations).

The current SDK offers `handleUploadPresigned` for OIDC uploads; older `handleUpload` requires a static read-write token. Project connections support selected environments, but Production and Preview are initially selected. Connect **Production only**, with no shared Development/Preview store or static fallback credential. Let the SDK refresh OIDC; do not save extracted tokens. Pin a reviewed SDK release before implementation. [SDK reference](https://vercel.com/docs/vercel-blob/using-blob-sdk).

Environment isolation is supported by the documented connection selection and an explicit `oidc_environment_not_allowed` provider error handled in the [official SDK at5425e161](https://github.com/vercel/storage/blob/5425e1611f65799a02ffa0033086a56e8d280dd5/packages/blob/src/api.ts). This is evidence for a viable design, **not a completed live denial test**. Omitting `BLOB_STORE_ID` alone is not an authorization boundary. Before real audio exists, test production access and denied Preview/Development access using the same known store ID and synthetic media; retain only redacted outcomes.

Private delivery defaults/examples must be overridden with `Cache-Control: private, no-store` on our recording responses. Immutable object names and no overwrite avoid replacement races. Any future offline recording/playback cache requires its own scoped revocation and expiry contract. [Private delivery](https://vercel.com/docs/vercel-blob/private-storage).

## Proposed next implementation boundary

1. Issue a short-lived, write-only upload capability for one new opaque asset, with closed MIME/byte limits, no overwrite, and a server-owned capture receipt bound to the current student/practice authority. No family information in names or provider metadata.
2. Keep uploaded bytes in quarantine. Verify signed completion, capture ownership, actual container/codec/duration/size and content hash; recheck current session, context and retention before trusted ledger registration. A client descriptor or callback alone never proves media validity. Revocation during upload may leave quarantine bytes, never playable audio.
3. Deliver through a same-origin endpoint that resolves recording IDs under current authority on every request, including range requests. Do not return provider URLs, signing material, paths or raw SDK objects. Bound stream duration, cancellation and byte accounting; prove behavior beyond4.5MB before accepting the design.
4. Add bounded trusted deletion and orphan cleanup that continue after student access is disabled. Claim physical deletion only after provider confirmation. Account for expired receipts, duplicated callbacks, missing objects and partial failures without reviving a deleted asset.
5. Independently review provider auth, upload verification, byte delivery and cleanup before real-student use. Resolve the pending private-recording retention question. Browser capture and storage are later slices;0020 alone is not a working recorder.

## Cost notice to prepare before provisioning

The current default-region table lists storage at$0.023/GB-month, simple operations$0.40/million, advanced operations$5/million, and Blob transfer$0.05/GB. Region and plan allowances matter. Private delivery additionally incurs Function-to-browser transfer and applicable origin-transfer charges; storage price alone is not total cost. [Current pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).

Illustrative storage-only arithmetic:34 students ×20 retained recordings ×5MB ≈3.4GB, about$0.08/month before allowances. This is an assumption, not measured demand or a spend ceiling. Obtain the actual team plan/region and expected listening volume, calculate transfer and operations, then present a concrete bounded spend notice to Daniel. No new paid service, upgrade, store, credential connection or upload has been created by this research.

## Remaining evidence

- Exact SDK version and synthetic local adapter tests; verify upload grants cannot read/delete/list/overwrite and callbacks cannot register another capture.
- Live synthetic Production-only access/Preview denial, and large-object playback with real runtime streaming/range behavior.
- Bounded media verification mechanism within hosting execution/memory limits; MIME declarations alone are insufficient.
- Retention/deletion worker authority and reconciliation contract, including never-submitted private recordings.
- Concrete cost configuration approved by Daniel before provisioning.
