# Lesson-log foundation return — 2026-10-16

## Frozen scope and references

Branch `codex/lesson-log-foundation` starts at accepted modal checkpoint `243d133c95d81f64901d57403a3ec8c9fb7d779d`. Root-approved spec is [2026-10-16-lesson-log-design.md](../../superpowers/specs/2026-10-16-lesson-log-design.md), frozen `f169410`; its independent contract acceptance is preserved separately. Author implementation and local additive migration 0017 are frozen `f2aabe24c21688e1d8bf6d0df9236689914f15d4`; reviewer-owned tests are committed unchanged at `8264fcc`. No source correction was needed after independent review.

The backend stores student-scoped current lesson summaries independently of assignments/verses. Current original-author tutors still assigned to the student may edit/delete their own entries; current admin mode may edit/delete any entry. Other authorized tutors, students, parent dashboard and explicit linked-child practice read only. Existing read/note-write capability paths, server-derived tenancy/context, authority lock order and Origin protections are reused; no new grant path exists.

Each `(tenantId, studentId, client entry UUID)` owns a current head with immutable creator membership/user, normalized lesson date/plain summary and independent positive version. Edit/delete use exact CAS; same-state edits need current version and live authority. Create replay succeeds only for exact normalized content/date, original creator and live version 1. Edited, cycled or deleted entries cannot replay. Delete irreversibly clears text and increments the retained tombstone version; no runtime physical DELETE grant, restore or full-text history exists.

Summary is bounded to 4,096 UTF-8 bytes, normalizes CRLF/lone CR to LF and rejects blank/malformed/control-bearing input. Lesson date uses real Gregorian YYYY-MM-DD validation without scheduling/future-date restrictions. Safe public entries contain only entry ID/date/summary/version/display name and freshly derived edit/delete booleans. Lists exclude tombstones, page 50 by date/ID descending, and require refresh after concurrent date edits; no cross-request snapshot guarantee is claimed. Reads perform no mutation/audit/event inference. Audits contain server-derived actor/action/scoped entry identity, without lesson text.

Production application, migration apply, provider/import/model/audio/notification/offline/frontend work remains held. Daniel's separate practice-history retention ruling is not applied to lesson logs and no practice calendar/history was added. Original shared STATE/COORDINATION and moving UI/voice checkouts remain outside this implementer's ownership.

## Files and public API

- Client-safe [types](../../../src/lib/lesson-log/types.ts), server validation/service/data and private HTTP handler; no frontend implementation.
- `lessonLog` schema / SQL `lesson_log`, tenant-qualified student and creator-membership/user foreign keys, composite scoped primary key, FORCE RLS, matching USING/WITH CHECK, minimal grants, immutable identity and insert/update version/tombstone triggers.
- Generated `0017_lesson_log_foundation.sql`, snapshot and journal entry are additive; historical migrations including progress 0016 are unchanged. Migration generation and tests ran only against local/disposable resources; no deployment migration command was run.
- Minimal runtime/dispatch and injected app/browser fixture composition; browser server recognizes the new route without a new browser test lane or UI.

`createLessonLogService({access, practice})` exposes `page(request, {mode, studentId}, cursor?)`, `create(..., {entryId, lessonDate, summary})`, `edit(..., {entryId, expectedVersion, lessonDate, summary})`, and `remove(..., {entryId, expectedVersion})`. A cursor is the exact paired `{lessonDate, entryId}`. Mutations return safe changed entry, minimal removed ID/version, or `{ok:false,code:"conflict"}`; no deleted text is returned. Missing scoped entries use private 404; non-owning tutor mutations are 403 after current student capability authorization. Stale/deleted/replay mismatches are HTTP 409.

HTTP routes are GET/POST `/api/students/:studentId/lesson-log`, POST `/:entryId/edit` and POST `/:entryId/delete`. GET accepts only `mode` and paired `beforeDate`/`beforeId`; POST accepts only the exact spec body, no query. Ordinary JSON body/deadline/Origin and private error/caching policies apply; response cap is 512 KiB to accommodate fifty maximum-size escaped summaries. Canonical synthetic request/response examples live in the approved spec.

## Executed verification

| Gate | Evidence |
| --- | --- |
| Author normal HTTP/schema cases | 4/4, 7.15s; live private routes, no reads writing, exact CAS/replay/tombstone, validation/body/query/Origin, forced RLS/qualified creator/minimal grants/version/deletion SQL checks |
| Author migration upgrade/replay | 1/1, 2.41s; upgrades through 0017 and replays without changing assignment/verse identity, progress marks/versions or authority; empty forced-RLS lesson table and exact grants |
| Independent adversarial app | 5/5, 11.42s at `f2aabe24`; ownership/current-mode matrix, replay/text cycle/tombstone, scoped UUIDs/keyset ties/safe DTO/name/read-only behavior |
| Independent actual PostgreSQL | 17/17, 11.06s, sixteen observed `pg_blocking_pids` blocker edges: unique/CAS/entry expiry/unique expiry/audit wait/revocation/context read/context switch; actual SQL FK/RLS/identity/version/tombstone attacks |
| Full local app integration | 800 passed plus one existing skip, 87 files, 278.32s at frozen lesson source/reviewer tests |
| Final typecheck/build | Passed; final typecheck includes the carried test-only study fixture correction |
| Carried study browser fixture correction | Full file 6/6, 45.25s at `90038029`; old-child response fencing, independent tab, revocation and actual fresh-session expiry assertions passed |

The initial typecheck caught only an in-progress reviewer test helper's generic union inference; the reviewer corrected that owned helper to `PromiseLike<unknown>`, without changing product code or assertions. Subsequent typecheck passed. No product test failure or independent source blocker occurred.

Independent PG command was `node .local-logs/lesson-pg-isolated.mjs`, an inspected ignored copy of the prior safe runner with only target/log/role-label changes. It verifies exact loopback cluster identity, creates a fresh owned anchor and disposable fixture databases/restricted runtime roles, and cleans only those owned resources. Reviewer reports anchor removal true, all fixture closes complete and product source unchanged; no browser/PG/heavy-app overlap occurred. Author's full app/build run begins only after the reviewer released that lane. No shared role/password/cluster/process was changed.

Logs remain ignored: `.local-logs/lesson-schema-generation.log`, `lesson-normal-focused.log`, `lesson-normal-migration.log`, `lesson-source-typecheck.log`, `lesson-frozen-typecheck.log`, `lesson-independent-app.log`, `lesson-independent-pg.log`, `lesson-full-app.log`, `lesson-final-build.log`, `lesson-final-typecheck.log`, and `lesson-study-ci-fixture-browser.log`. Reviewer did execute its own app and PG checks; the report distinguishes those from author integration gates. Existing unchanged engine/Node evidence is reused locally; exact hosted CI must validate this final branch.

## Carried modal CI fixture correction

Historical modal checkpoint `243d133` hosted run `38993244517` had three successful jobs and one PostgreSQL/browser job failure: 77 browser cases passed, while study's old-child-switch setup received HTTP 429 on its sixth SDK magic-link request against the existing five-request window. The newly independent lift case added that sixth sign-in. Root authorized a test-only fix on this combined branch rather than rerunning the historical modal branch.

`90038029ab434a80da97a5963ab9855e1ea227e0` caches each role's first real SDK session cookie only within the fresh disposable study fixture, keeping new browser contexts, local/session storage and per-tab practice handles independent. The final intentional-expiry case explicitly acquires a fresh admin SDK session. All old-child/stale-response/revocation/other-tab/real-expiry assertions remain unchanged. The reviewer independently inspected this exact diff; no production throttle, auth configuration, backend or UI source changed. After app/build, author ran `node .local-logs/frozen-browser-isolated.mjs lesson-study-ci-fixture tests/http-browser/study-ui.test.ts` on the exclusive fresh owned 3191 fixture: 6/6 passed in 45.25s, exact temporary source restoration and owned-role removal both true. Git diff for server/tsconfig and lesson product source remained empty. This was a required fixture regression run, without reopening approved visual direction. All 78 combined hosted browser cases must pass before treating the modal-plus-lesson candidate as fully CI accepted.

Final staged candidate/index repository guard and `git diff --check` must pass before the documentation checkpoint; final handoff records the actual outcome. Publishing the accepted review branch is allowed for root's exact hosted CI; production/deploy/provider/migration apply remains held. Next product work follows root's separately reviewed practice-calendar contract, without inferring an offline lease or exposing raw practice history to parents/tutors.
