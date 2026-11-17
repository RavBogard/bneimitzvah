# Relationship controls and CSV import — bounded plan

Status: approved by Astra, 2026-10-16, after the priority study-phone CI correction. Existing checkpoint supplied by Astra: `362986e`. Approval refinements are incorporated below.

## Outcome and boundaries

Complete the missing Phase 2 admin relationship and CSV interfaces using the published HTTP contracts. An admin can inspect a student's linked tutors, guardians and sign-in identities; assign/remove a tutor; change guardian practice permission; revoke a guardian or student link; mark a tutor as cantor; revoke an ordinary role grant; and preview/review/commit a student CSV. Every access change has an explicit identity-and-consequence review before its POST.

Preserve the selected Annotated score world and existing Operate workspace: system type, white working field, fine rules, burgundy actions, 48px controls, narrow forms, phone stacking and wrapped/bidi-isolated identity values. No product interview or visual-world chooser. Scope excludes new providers/accounts, mail, owner administration, server/schema/runtime changes, unrelated study UI and student release. No commits or pushes by this worker.

Read authority: CLAUDE.md, AGENTS.md, MISSION.md, STATE.md, PRODUCT.md, confirmed PM amendments and the Phase 2 plan. Impeccable context was loaded against `roster.tsx`; it resolves the existing workspace brief and requests one manual scoped detector pass after UI completion. Craft-floor is deferred until immediately before UI edits, as required for planning-only work.

## Proposed surfaces and identities

- Student roster: add an **Access** link for each student, including disabled students, beside the existing reading/edit actions. Add **Manage tutors** and **Import students** navigation.
- `/workspace/admin/students/[studentId]/access`: authoritative student identity/date/status followed by Tutors, Parents and Student sign-in sections. Use current link DTOs, distinct one-student link removal and congregation-wide role revocation actions, and effective-access labels. Empty sections link to existing invitation management rather than inventing direct guardian/identity creation.
- `/workspace/admin/tutors`: paged eligible tutors, cantor state, ordinary tutor-role revocation and invitation link. This is the available staff picker; there is no general account/member/admin directory API. Tutor grants are the selectable identities, not user IDs or typed email addresses. Use display name plus a short stable grant identifier when names collide; review includes the full grant identifier.
- `/workspace/admin/students/import`: local file/paste input, format help, server preview, row-number errors/duplicates, explicit duplicate opt-in followed by a fresh preview, reviewed commit and receipt/recovery. Explain that import creates records and contacts; invitations and reading confirmation are separate tasks.
- Student targets come from existing roster links and the route UUID, then reauthorize through the relationship read. Parent/student identities come only from that student's returned links. No arbitrary UUID entry, global name search, admin grant picker or role creation UI.

## Exact existing HTTP contracts

All GETs use same-origin credentials, no-store, no-referrer and closed response parsers. All POSTs use same-origin JSON with the exact bodies below; the server derives admin mode and tenant. Never attach `X-Practice-Context` to these routes. Existing response errors are fixed/sanitized; do not display raw response bodies.

| Purpose | HTTP route | Body / response |
| --- | --- | --- |
| Eligible tutors | `GET /api/admin/tutors?limit=100&afterId=<last grant UUID>` | `{tutors:[{id,displayName,revision,isCantor}]}`. UUID ascending cursor; no total or next cursor. A full page offers next; an empty next page remains recoverable with previous. |
| Inspect student access | `GET /api/admin/students/:studentId/relationships` | `{student:{id,firstName,lastName,ceremonyDate,revision,disabled},guardians,identities,tutors}`; exact link shapes below. |
| Assign tutor | `POST /api/admin/students/:studentId/relationships/tutors` | `{tutorGrantId,expectedState:"unassigned"}` → 201 `{ok:true,id,studentId,tutorGrantId}`. |
| Remove tutor/guardian/student link | `POST /api/admin/students/:studentId/relationships/:group/:linkId/revoke` where group is `tutors`, `guardians` or `identities` | `{expectedState:"active"}` → `{ok:true,id}`. Distinct link UUID is the concurrency identity. |
| Guardian practice permission | `POST /api/admin/students/:studentId/relationships/guardians/:linkId/practice` | `{expectedRevision,practiceEnabled:boolean}` → `{ok:true,id,revision,practiceEnabled}`. Revision belongs to the guardian link. |
| Ordinary role revocation | `POST /api/admin/grants/:grantId/revoke` | `{expectedRevision,expectedState:"active"}` → `{ok:true,id,revision}`. Revision belongs to the role grant. Server refuses admin roles permanently. |
| Cantor flag | `POST /api/admin/tutors/:grantId/cantor` | `{expectedRevision,isCantor:boolean}` → `{ok:true,id,revision,isCantor}`. Role grant revision; no role promotion. |
| CSV preview | `POST /api/admin/students/import/preview` | `{csv,allowDuplicates:boolean}` → `{validRows,issues:[{row,code}],duplicateRows,requiresDuplicateConfirmation,canConfirm,binding}`. Codes: `invalid-row`, `invalid-columns`; binding is null unless confirmable. |
| CSV commit | `POST /api/admin/students/import/confirm` | `{csv,allowDuplicates,binding}` → 201 `{ok:true,ids:[UUID...]}`. Atomic create; no invitations/readings. |

Relationship link shapes:

- Guardians: `{id,revision,parentGrantId,parentGrantRevision,displayName,practiceEnabled,effectiveRead,effectivePractice}`.
- Student identities: `{id,studentGrantId,studentGrantRevision,displayName,effectivePractice}`.
- Tutors: `{id,tutorGrantId,tutorGrantRevision,displayName,isCantor,effectiveRead}`.

Each relationship array is limited to 500. Tutor eligibility requires an active tutor grant, enabled membership and verified identity; contacts are deliberately absent. Relationship inspection returns unrevoked links even when the grant/membership/student makes access ineffective. The DTO does **not** identify which underlying condition caused ineffective access or whether a role grant itself is revoked: display “Access currently unavailable,” not a fabricated reason. Inspectable disabled students have all effective flags false. Disable tutor assignment and practice enabling for disabled students; retain link cleanup, practice disabling and grant revocation (server may return a conflict for an already revoked grant). Cantor edits remain available from eligible tutors independently of a selected disabled student.

## Authority, review and lifecycle

- No generic membership authority revision is published for these admin forms. Use the exact link/grant revisions above, link UUID plus expected active state for removals, and expected unassigned state for tutor creation. Do not substitute student revision for a grant revision. Student revision/disabled state and relevant linked identity/grant snapshots form a local review fingerprint; it is UI freshness evidence, never server authority.
- Immediately before an access-change POST, re-read the authoritative target snapshots and require an exact match to the reviewed identity/state fingerprint. A mismatch discards review and requires another explicit review. The subsequent service mutation still provides authorization and compare-and-swap protection.
- Parent role revocation affects that parent's access to **all** linked children in the congregation; tutor role revocation affects **all** assigned students; student role revocation removes that identity's congregation student access. Link removal affects only the selected student. Practice disabling preserves ordinary parent reading access. State this precisely in the review, with explicit Confirm/Cancel and focused review heading.
- Relationship flag writes may return the same revision for an already-selected value; validate identity/value and nondecreasing revision. Grant revocation increments revision; link-removal HTTP responses intentionally omit guardian revision. Refresh authoritative relationships and tutor list after success before presenting current-state claims.
- Use existing `RequireRole`/`registerReload`. Each loader aborts superseded reads and uses generation/lifetime guards; stale completions cannot restore another student, tutor page, draft or review. On focus/pageshow/visible return, provider hides/inerts the workspace while session and registered reads reauthorize. A changed/failed session binding unmounts private local state. Same-session drafts may survive, but reviewed actions must match fresh data; changed snapshots clear review.
- Keep CSV text, contacts, selected reviews and opaque bindings in component memory only; no URL payloads, browser storage, logs, download fixtures or telemetry. Invalidate a CSV binding on any byte/duplicate-choice change and on lifecycle revalidation; do not decode its encrypted payload.
- Single synchronous mutation latch prevents double submission. No automatic POST retries. 409 clears review and requires explicit reload/review; expired/rejected CSV binding requires fresh preview. 401/403/404 clear protected projections/review and call for access reload; a denial is not a blanket invitation to resubmit.
- Disconnect, timeout, malformed success or lost response creates an **unknown outcome**. Preserve the draft as an unresolved draft, disable mutation confirmation, and require explicit authoritative reload. A confirmed mutation followed by failed refresh remains “saved; current view unavailable,” not “failed.”
- Unknown CSV commit is especially consequential: there is no import receipt lookup or idempotency key. Reload the roster and show an explicit “Check the roster before starting another import” acknowledgment. Never automatically re-preview/reconfirm or turn on duplicate override after an uncertain commit. Any later preview is a new deliberate action; server exact-duplicate detection is additional evidence, not proof the earlier import failed.

## CSV truth and presentation

The parser requires exactly `firstName,lastName,ceremonyDate,parentEmail,ownEmail` in that order, with one to 500 data rows and five cells per row. `parentEmail` is required; `ownEmail` may be empty, but its header/cell must exist and a nonempty value must differ from parent email. Dates are real `YYYY-MM-DD` dates; names are trimmed, 1–100 characters; email is normalized by server validation. Quoted commas, escaped double quotes, quoted line breaks and CRLF are supported. No extra columns or BOM normalization is promised.

Raw CSV is limited to 1 MiB UTF-8; JSON transport has a separate 2 MiB body cap. Check both locally with clear size feedback, while treating the server as authoritative. Do not import the server-only validator into the browser. The UI displays the bounded raw draft for review and server row-number results; no parallel client parser claiming server-valid rows is needed. Row labels mean parsed CSV record numbers including header, not physical newline positions in quoted fields.

Duplicate detection compares all five normalized fields against existing records (including disabled) and earlier input rows. Duplicate opt-in permits creating additional records; it does not merge/update/skip. Any invalid row blocks the entire commit. Duplicate choice changes require another server preview. Preview's opaque binding expires after five minutes and binds actor/session/admin grant, exact CSV bytes, duplicate choice and roster IDs/revisions. A roster change yields 409; there is no editable preview row payload or returned expiration timestamp. Locally start the five-minute expiry clock **before the preview request**, not when its response arrives, and require a new preview after server rejection or lifecycle refresh.

## Ownership and verification

Eventual worker footprint, subject to approval:

- New `src/components/portal/workspace/relationships/{api,workspace,tutors,review}.ts(x)` and `csv-import/{api,workspace}.ts(x)`; split rendering further only if readability requires it.
- New route wrappers under the three proposed admin paths; narrow `roster.tsx` navigation and `src/app/globals.css` additions using incumbent controls.
- New focused `tests/app/relationship-ui-api.test.ts`, `tests/app/csv-import-ui-api.test.ts` and `tests/http-browser/roster-controls-ui.test.ts` (or split browser files for independent route fixtures).
- Final scoped documenter appends inventory only to existing `.impeccable/surfaces/src-app-workspace-page-tsx.md`, preserving DESIGN.md and its token sidecar/seed. Write short `ROSTER-CONTROLS-RETURN.md`. Astra retains STATE.md and integration. Shared `tests/http-browser/fixture.ts` requires coordination: the student-work worker owns its narrow service initialization; request any separate fixture needs before editing. No server/runtime/schema edits.

Checks: targeted parser acceptance/rejection/identity/revision tests; actual SDK + restricted PostgreSQL browser tests for successful reviewed mutations, all three link removals, cross-child role impact, disabled student behavior, stale revision, duplicate/invalid CSV, changed draft/roster/binding, unknown mutation, denied access, two-tab revocation, same-session revalidation and delayed stale reads. Reuse existing service/route security evidence rather than duplicate a broad audit; independent adversarial authority review remains Astra's integration gate.

Use root-managed PostgreSQL 55439 without credential/start/stop changes. All names/emails/CSV are synthetic; no live provider requests. Run focused app/browser checks, typecheck and required build; root owns broader integration. After complete UI, run one detector across changed targets, batch desktop/phone long-identity/review/error captures, obtain an independent fresh finish review through Astra, fix findings in one batch and confirm at most once. No repeated polish cycle. Return evidence and limitations; hosted CI/deploy and student release remain separate gates.

## Astra approval

Astra approved the three-route composition and API-limited identity pickers; disabled-student cleanup without access enabling; review copy distinguishing student links from congregation-wide ordinary grants; raw-draft/server-only CSV validation; and explicit roster review plus unknown-import acknowledgment before any new preview. Pre-POST authoritative snapshot reads, conservative preview timing and brief-only documentation updates are required refinements. No backend change is needed for this bounded slice. The absence of a full member directory and import receipt/idempotency endpoint is disclosed rather than silently expanded into backend work.
