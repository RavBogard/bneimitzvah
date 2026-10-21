# Settled decisions (Daniel, binding)

Approved 2026-10-20. This extends the portal's service learning workflow; it does not activate generated voices, student recording uploads, reference playback, or a deployment.

Each student prepares one Beit Mitzvah ceremony, morning or Havdalah, with one connected music setlist. A future complete date and type automatically queues creation/linking, including quiet imports. No staff confirmation is required. Reuse an explicit connection; otherwise reuse a unique organization/date/structured-type match. Multiple matches require staff resolution. With no match, use `bnei_mitzvah_saturday` or `havdalah_bnei_mitzvah`. Use configured default arrangements only; leave missing defaults unresolved. Durable idempotency covers concurrent imports and retries. Connector failure cannot roll back roster intake. Do not backfill existing roster rows.

A joint ceremony can share a setlist while assignments and practice progress stay individual. Rescheduling preserves the connected setlist and flags reconciliation; it never regenerates a customized order.

My service leads with the ceremony and Parts I lead, followed by an expandable full order. Show approved Hebrew, vetted matching recordings, authorized scores, student directions and reader/music links. Canonical text remains in the existing source/feed, with no transliteration or licensed text/chart bytes in this repository. Identify parts with stable prayer IDs or exact biblical references plus edition.

Music owns scores and performance notes. The portal owns student directions and private feedback, with separate projections. Students and linked guardians may request changes per part. Staff review pending/accepted/declined requests and respond. A request never directly changes music; musical acceptance completes only after an authorized source change succeeds. Reordered parts preserve practice progress. Arrangement/text/edition changes flag resources for review, and deleted rows remain unresolved rather than losing individual work.

Staff prepare and refresh overlays using the existing authorized workflow. Show differences, preserve operator edits and require explicit display names. Live booth/display commands are excluded from this feature. Planned setlist setup is authorized once configured; all tests use synthetic sources. Cross-app access is narrow and revocable; portal membership grants no music library access.

The interface follows the selected Annotated score direction: clear Hebrew, restrained color, practice tools alongside the reading, and minimal forms. Student and family data, recordings, credentials, licensed materials and real imports never enter fixtures or the repository. Finkel asset preparation is separate work.

## Implementation boundaries

Portal stores scheduling intent, a durable synchronization state, stable source identifiers and metadata, individual directions/progress and change requests. It does not infer remote machine authentication from existing user OAuth. Source applications must supply a narrow authenticated broker and revocable resource projection before configured integrations can report success. Unconfigured integration is explicitly unavailable and retryable.

## Open items that wait on Daniel

No product decisions are reopened. Daniel's October 17 deployment authority persists; independent adversarial review and the specific reference/listening hold remain unchanged. Any future money or licensing question still waits on Daniel.
