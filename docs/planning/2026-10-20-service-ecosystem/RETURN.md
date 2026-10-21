# Service ecosystem return

Baseline: main `9a7b1cc`, isolated `beit-service-ecosystem` worktree. Migration 0024 adult honors is present; next is 0025. Approved design saved beside existing specs.

Implemented portal durable scheduling/outbox, source broker, revocable projection/resource routes, individual assignments/progress/requests and My service within the existing Service parts surface. Migration 0025 is `0025_service_ecosystem.sql` with restricted-role RLS and stable identity protections. Source uses dedicated fixed-CRC server bearer plus `x-org-id: crc`; configured source endpoint is `/api/integrations/beit-mitzvah/v1`. It is unconfigured locally; no live source or student resource availability is claimed.

After committed intake, Next after dispatch owns a fresh DB pool, leases jobs atomically, runs four requests at a time within 20 seconds, and backs off failures. A separately authenticated CRON_SECRET drain and daily Vercel cron provide fallback; outages/bulk backlog can delay setup until a later drain. Nothing waits for staff approval to queue or create a complete future service.

Explicit portal catalog mappings are individual, staff-selected exact active catalog units. Source music moment IDs and reader unit IDs are independent namespaces. Resource identity changes retain progress and require resource review. Source-projected audio shares the existing student listening hold, including a final returned-kind check against score-to-audio reapproval races.

Reschedules retain the source ID and persist monotonically numbered schedule intents; source must fence older intents. Joint disagreement suppresses the shared remote proposal. Staff can align roster dates or explicitly move one student to a separate service; historical assignments/progress remain for review.

Verification checkpoint: typecheck passes; 17 focused app/broker tests passed before the latest ordered reschedule/separation extension; existing 27 student tests passed. Independent adversarial review is active and found the reschedule and resource-kind issues now being repaired/verified. Next: focused regression tests for these extensions, actual source-auth contract, synthetic phone/desktop browser tests with the fresh disposable WSL Postgres runner, then broader required checks and review fixes.

No deploy/merge, real imports/email/live booth commands, generated voices/student uploads or reference activation. Reader base is the established `https://siddur.centralreform.org/`, with only explicit book/folio/serviceViewId metadata. Overlay link targets the existing authorized `/services?setlistId=...` workflow; a separate source owner supplies its selection enhancement. Impeccable context reported a stale design sidecar; durable visual direction remains unchanged and no unrelated sidecar repair was made.
