# Family honors: grounded private form and scoped recipient milestone

## Settled decisions (Daniel, binding)

The parent dashboard has one family-form write exception: honors. Honorees receive a signed, expiring, revocable no-login link with a deliberately narrow projection. Parent sign-in opening child practice does not grant staff authority or make the family form a child-practice feature. No visible transliteration. No automatic invitations, mail or external writes. Daniel authorized continuing the revised product to completion and deployment, and on 2026-10-18 explicitly asked for research in CRC's shared Drive.

Generated voices and student recordings remain parked. This milestone does not activate them, import a real roster, provision another tenant, or change spending/provider permissions. Auth and tenancy changes require independent adversarial review before release.

## Grounding and decisions made here — 2026-10-18

Read-only Drive research located **Shared Files → EDUCATION → Beit Mitzvah → 2026 Updated Documents → [Beit Mitzvah Binder Info October 2026](https://docs.google.com/document/d/1fh0dXGtEeO_8ot3xHvkP-OvAPUG7VzBK4OChSONulng/edit)**, modified 2026-10-15. Its blank honors section, rather than a completed family's form, grounds the inventory below. No family values, private prayer bodies, document images or contact details belong in Git or fixtures.

The blank form allows groups larger than two for ark and Torah handling; generation-to-generation participants include relationships. Each aliyah can have multiple people. It asks for English and Hebrew names, including the Hebrew names of both parents, and directs unknown names to rabbinic help. Its usual three-aliyah example explicitly defers the actual count to the tutor. The portal must derive actual spans from the current assigned Torah vector/cuts, never manufacture three or seven slots.

The form also asks whether a parental blessing will be given and whether speakers speak together or separately. Include only those optional ceremony logistics. Do not collect blessing prose, God paragraphs, supplement content, catering, fees, greeter scheduling or other siddur/event-planning material.

The shared Frequently Requested Items folder contains an Aliyah Blessings PDF and Word document. Best-effort PDF extraction has corrupt Hebrew encoding and does not establish credits, current translation permission or an audio mapping. Do not turn that extraction into rendered prayer content. Use the existing separately approved service-material contract when establishing recipient permissions; the authenticated CRC Music catalog does not itself authorize no-login sharing. This is a material-release boundary, not a blocker on private family saves.

Further metadata-only discovery found **[Torah Blessings.wav](https://drive.google.com/file/d/1sG38yLdhKtMTl3W0WN9dLeF0ugmp--Rh/view)** under the shared Beit Mitzvah recordings / Torah from Corey folder (audio/x-wav, 1,345,230 bytes). No audio was downloaded, transcribed, copied, uploaded or published. The connector did not return a permissions array; a successful staff metadata read is not evidence of anonymous recipient access, recording consent or a stable CRC Music mapping. Keep it as a specific candidate to reconcile with the prayer-audio link policy, not an activated portal asset.

## Checkpoint A — authenticated backend

Deliver a useful private read/replace/original-intent receipt service, local schema and meaningful tests. No bearer scaffolding, no UI, no production migration in the author assignment. The following contract is root's implementation direction; module-level names may follow existing conventions without changing these semantics.

### Authority

Dedicated server-selected `honors-read` and `honors-write` capabilities restrict full family access to actual base parent with live linked guardian, or explicit admin correction. Do not broaden ordinary student read or reuse practice/source permissions. Base-mode `X-Practice-Context` rejection remains, including overlapping staff accounts. A guardian whose delegated practice is disabled can still use their own family form. Ordinary tutors, child students, adult students pending policy, unrelated and foreign tenants receive no new family access.

**Integration clarification, 2026-10-18:** a successful freshly authorized **base-parent reading** (`mode=parent`, no practice context) changing the same student's ceremony date, display fields or ordinary record revision is metadata reconciliation, not a synthetic authorization denial. Keep the exact mode/student identity/context boundary, full response comparison and real 401/403/404/session/guardian/disabled-student erasure. Route the metadata change through the existing same-binding reload so unsaved honors remain available for explicit date/span review. Do not change child-practice, student, tutor or administrator authority comparisons in this bounded repair. Native validation exposed the inherited whole-student comparison clearing the family owner on a date change; the old check's test must remain strict for its other modes and gain explicit base-parent regressions. No server authorization or relationship policy changes.

Use existing live identity/session/tenant/membership/grant/student/relationship lock order. Mutation requires exact cookie-origin protection. No caller-supplied guardian, tenant or actor establishes authority. Recheck session expiry after waits and immediately before returning/committing; aborted work must not commit a save. Project form DTOs separately from generic study, portal and roster DTOs.

### Closed draft payload

`schemaVersion: 1`; named ordered lists `openingArk`, `generationToGeneration`, `undressingTorah`, `redressingTorah`, `closingArk`; ordered `aliyot`; and `parentalBlessing`.

- Ordinary ceremony participant: local entry UUID and `englishName`.
- Generation participant: local entry UUID, `englishName`, optional `relationship` represented consistently as null when unknown.
- Each saved aliyah mapping identifies its exact current `startVerse`, with ordered participants. Each participant has a local entry UUID, `englishName`, nullable `hebrewName`, `parent1HebrewName`, `parent2HebrewName`, and nullable `relationship`. These are ceremonial labels, never account/contact identifiers. Accept an already-composed Hebrew name without manufacturing connectors or inferring gender. All Hebrew-name components may remain unknown.
- `parentalBlessing` uses `participation: null | "yes" | "no"` and `delivery: null | "together" | "separately"`; non-null delivery requires yes. Yes with unanswered delivery is a valid draft.
- Empty arrays/unknown fields are valid drafts; do not require completion before saving. Nonempty participant rows require a name; blank UI rows can stay client drafts and must not create meaningless persisted people. Do not deduplicate participants merely because names repeat, including the same people opening/closing the ark.
- Local entry UUIDs are unique within a complete form but do not identify users, establish guardianship or link students. Aliyah mappings are unique and sorted in actual current verse order; omitted mappings are unfilled. No mapping is allowed when the current Torah/cuts are unresolved, and no supplied span/ordinal may invent verses. Use exact start refs from the server-derived cuts; do not store caller-supplied end refs as authority.

Technical bounds: at most 32 participants per ceremony list or aliyah, at most 256 participants across the whole form, at most the existing 1,000 possible current aliyah starts, total payload at most 64 KiB UTF-8. Names at most 256 UTF-8 bytes and relationships 160. Accept meaningful Hebrew marks, apostrophes and hyphens; normalize NFC/trim, reject malformed Unicode, controls, markup and invisible direction overrides, but do not impose Latin-only rules. Closed own-data plain objects/dense arrays; unknown keys/accessors/inherited members/prototype tricks must not add fields. Store a canonical normalized copy and compute the digest from that exact copy. No arbitrary notes/contact/email/phone/address/DOB fields.

### Reading and ceremony binding

Capture tenant/student IDs, ceremony date, service slot, exact current Torah assignment ID/revision/ref/basis/confirmation-review facts, ordered verified verse vector, and cuts (null means unresolved; [] means explicitly one aliyah). Derive a canonical context hash from the actual rows under lock. Caller sends the hash they reviewed, never authoritative reading claims. Do not add unrelated student fields to the hash or expand generic `StudentView` merely to obtain slot.

No current Torah permits saving only non-aliyah fields, with an honest unassigned status. Null cuts permit those same draft fields, with an unresolved-cuts status. Unknown slot and existing reading review requirements remain explicit. Validate stored vectors against canonical reading expansion and cuts against that vector; corrupt records fail closed. A changed date, slot, assignment revision, verse vector, cuts or review state marks existing form mappings as needing review. Return the previous saved form and its old span labels as history alongside current context, never silently relabel it as current. A fresh explicit save with today's context hash is the review acknowledgement; it must submit mappings valid against today's starts rather than automatically remapping old ordinal numbers.

### Persistence, concurrency and recovery

Reserve migration **0022** for `honors_version` only; recheck the ledger before generating. No other worker owns schema changes. Add matching Drizzle schema, index export, SQL, journal/snapshot and fixture support through established repository tools. Do not apply production SQL.

One append-only per-tenant/student version stream spans all ceremony/reading changes. Include base/previous/version, closed payload, reviewed context snapshot/hash, actor user/membership/grant/mode and actual guardian attribution (null for admin), original mutation UUID/digest and timestamp. Tenant-composite FKs include guardian tenant/student/parent grant compatibility. Parent/admin-only DB constraints, FORCE RLS, runtime SELECT/INSERT only, immutable update/delete trigger and bounded JSON validation protect data integrity. Never alter or overwrite earlier versions.

Whole-form replace uses expectedVersion CAS and original mutation UUID. Two guardians saving the same base produce one commit and one conflict. A byte-identical original intent under the original actor authority replays its original committed version plus the actual latest version; same UUID/different intent or changed actor/grant/guardian attribution conflicts. Never give a conflict a fresh UUID automatically. **Clarified during independent review, 2026-10-18:** UUID uniqueness is global within `(tenant, student, mutationId)`, across actors, because this is one shared family-form stream. A second guardian cannot create a later duplicate by reusing the original UUID with an advanced expectedVersion. After current live family authorization, receipt lookup uses tenant/student/UUID, then explicitly checks actor user/membership/grant/mode/guardian compatibility. An incompatible actor receives only a generic conflict, with no original intent or creator details. This deliberately differs from the per-user source-assignment receipt index.

After live current honors authorization, look up an original receipt before rejecting its old context hash: subsequent ceremony changes must not erase evidence of an earlier committed save. Returning such a receipt does not authorize a stale new write or claim its old mapping is current. Missing receipt is unconfirmed. Every write and compact `honors.set` audit entry commits atomically, with no names/payload in audit metadata. Use existing post-wait liveness/rollback patterns. New writes with stale context fail, even when expectedVersion matches.

Checkpoint A may include closed GET/POST `/api/students/:id/honors` and POST `/honors/receipt` transport, real runtime composition and dispatcher wiring, after its service contract is reviewed. Exact query/method/body bounds, cookie-origin protection, generic private denials, private/no-store and complete-response cap are mandatory. It has no frontend control, provider I/O, mail, invitations, new grants or links.

### Acceptance

Meaningful tests cover Hebrew/Unicode/drafts/more-than-two people/multiple honorees/varying cuts, all limits and closed shapes; SQL RLS/composite attribution/immutability/bounds; base guardian/admin success versus tutor/student/child-practice/foreign/revoked/disabled/expired denial; practice-disabled guardian still allowed; concurrent guardian CAS; exact replay versus changed intent/authority; receipts surviving binding changes under live authority; date/slot/reading/cut changes, malformed vectors and unresolved cases; original intent and no mail/network side effects. HTTP method/origin/body/denial projections and actual restricted-runtime behavior need coverage. Focused checks during implementation, independent adversarial review, required full hosted CI and migration/release checks before promotion. No claim that synthetic tests establish Daniel's product acceptance.

## Checkpoints B and C — follow after A

B freezes the dedicated signed/hash-persisted/expiring/revocable bearer contract and reviewed recipient material projection. Secrets travel fragment then memory/body, never query/log/storage; landing HTML is static with restrictive CSP/no third-party assets. Every request checks current live student, form, date/slot/reading/cuts and approved material lifecycle. Project only student first name/date, explicitly issued own-aliyah span and approved before/after blessings/credits. No full roster, contact, drafts, activity or recordings. Manual explicit issue/copy/revoke/reissue only; no automatic mail. Unknown cuts refuse issue. No implicit public media proxy or assumed audio rights. Exact bounded TTL and material identifiers are frozen in B before code, with an independent bearer review.

C implements the private family form, staff review/print and recipient UI in the established Song session world, using existing owner/CAS/unknown-save patterns and quiet unchanged tab return. Apply Impeccable's established workflow without reopening the visual world. Drafts and stale reading mappings need clear review affordances. Existing date+slot changes invalidate issued links. UI comes after actual backend contracts and material readiness; unused schema does not constitute completed honors delivery.

## Open items that wait on Daniel

- Adult students' self-edit policy was already asked asynchronously and remains unanswered. Keep it denied until settled; it does not block guardian/admin implementation.
- No longer ask Daniel to locate the blank honors template: the October 2026 shared binder was found and read directly.
- Raise a concrete recipient material/rights question only if the exact approved service units and current repository evidence cannot establish it. Do not request a broad licensing re-decision or treat garbled PDF text as a publishable edition.
- Daniel's actual-source phone playback acceptance remains a separate reference-player release gate; this milestone does not turn studentrelease on.
