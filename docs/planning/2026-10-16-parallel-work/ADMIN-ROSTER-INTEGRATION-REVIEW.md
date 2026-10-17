# Frozen admin roster — independent source review

Reviewed `design/song-session-admin-roster` at `3bc99ea3d7ceb9496c4f98f210131d02474e3f55` against accepted roster `add56e7`. Both owner checkouts were clean. No product/test edits, database/browser runs, private roster reads, provider operations, pushes or deployment were performed. Source accepted provisionally; the narrow missing runtime evidence and root visual acceptance below remain integration gates.

## Preserved contracts

The 24-file diff changes admin presentation, shared reading staff gates and browser selectors, plus the owner return. Git comparison confirms no changes to server/schema/migrations, the old/rich workspace and CSV API validators, provider, or work coordinator. `src/` is identical between the fully checked owner tree `38b126e` and final `3bc99ea`.

CSV retains all four supported headers, exact client DTO validation, pending tutor proposals, second-contact warnings, widened row errors and the student/audit-only promise. The numbered cards and navigation do not change preview/confirm logic. Roster editing constructs only the original student fields; omitted Hebrew name, secondary contact and metadata are preserved by the accepted backend. It does not turn a pending tutor/contact into a relationship or invitation.

Student/People/Tutor/invitation surfaces remain behind RequireRole(admin). Invitation prefill accepts only a loaded active student and parent/student role and fills a draft once; confirmation still reloads and checks its reviewed fingerprint before a latched POST. Relationship confirmation similarly retains current-target checks, latches and uncertain-outcome blocking. New display names/contact labels do not change the existing safe projections or expose intake to other roles.

Admin now uses the existing staff reading tabs and verse sheet. Reading, service and lesson panels remain mounted; the reviewed `work.departure` and `serviceDepartureActive` physical-sheet suspension is preserved. No progress store, lesson lifecycle or material authority behavior changes. Old browser assertions are adapted for the new tabs, sheets and labels; inspected persistence, count, no-retry, no-authority and overflow assertions remain present.

Native controls retain labels, radio fieldsets, named row actions, focusable dialog headings, close buttons and opener restoration. New sheets use the existing conceal-aware hook; role/session replacement still remounts the protected workspace. CSS mainly adds role-specific admin/roster/people/invitation selectors and extends existing sheet styling; no student Hebrew typography, font assets or 820px requirement changes.

## Findings and required bounded verification

No confirmed blocking source defect was found. This is not independent runtime or accessibility certification.

The remaining meaningful gap is the new roster/access/invitation sheets while requests are pending. Each adds native closedby, a document-capture Escape fallback and onClose state synchronization/reopen logic. The owner explicitly records that invitation pending-Escape/second-Escape was not tested. Existing workspace tests cover retained drafts, visibility return, new-session discard, stale CAS and uncertain saves; invitation tests cover changed targets, fresh writes and role denial. Those are useful evidence but do not prove the new pending-close handlers.

Before final integration acceptance, run one small synthetic regression covering these three new sheets: hold the actual mutation, repeat Escape (including attribute-removed fallback), require one active modal and disabled dismissal with one POST; hold an authority refresh and require zero physical modals while concealed, then exactly one rightful review/draft on success and no resumed private review on real denial/session replacement; verify idle cancel/opener focus. Reuse existing fixture and accepted backend evidence rather than rerunning all 24 files solely for this gap. Root owns desktop/mobile visual acceptance separately. No speculative source fix or generic modal framework is requested.

## Attributed checks and detector limits

Owner `SONG-SESSION-RETURN.md` reports typecheck/build, Node 208, app 840 plus one existing skip, repository guard and all 24 browser files on `38b126e`, individually on disposable WSL PostgreSQL16. It explicitly corrects the prior missing service-modal file. After merging final roster `add56e7`, it reports changed auth 16/16 plus typecheck; source identity to `38b126e` was independently checked. These are owner results, not fresh independent executions on `3bc99ea`; app test count must account for the later parameterized auth split.

Applied Impeccable's bounded technical audit guidance, preserving the chosen product world. Context loaded once, detector ran once on changed components and CSS; ignored output `.local-logs/admin-frozen-independent-detector.json`. It returned 69 entries: 62 type-step, four radius and two color advisories, plus one font warning. The latter is the CSV textarea's system monospace fallback `SFMono-Regular`, not a new downloaded font or replacement Hebrew font. These mechanical entries do not establish a functional defect or justify advisory polish. Visual contrast, scaled-text layout and native interactions remain runtime observations, not source claims.

## Separate voice handoff — no release approval

Read only `39c8770c4c07977d1cbf0966ab778966a23349e1` in the voice checkout. `docs/planning/2026-10-16-voice/HUMAN-ALIGNMENT-RETURN.md`, “Generation parked” (line328), records Daniel's instruction to park every generated lane with no more tuning/listening. Preserve it. Do not merge/release the voice engine or enable generated fallback.

The model-independent next contract is “Verse player hand-off for Codex” (line366): private `pockettorah-verse-index/v1`, recording/verse coverage, bounded start/end cuts and ordered `{he,start,label?}` word timings. Use aligned start rather than archive label for highlighting; validate exact authoritative Hebrew/qere word mapping rather than splitting on spaces or replacing the existing passage blindly. Keep attribution “PocketTorah (not-a-box media lab), CC BY-SA 3.0”. Coverage gaps show unavailable audio under the current park. The handoff reports 431 recordings/7,073 verses, 36 review-flagged starts and a 26-verse human spot check still pending; these claims were not independently validated against private audio/index contents here. A bounded data-contract/coverage/timing validator is assignable without generation, audio processing, storage provisioning or player release.

## Subsequent bounded runtime acceptance

The identified sheet verification gap was filled in the managed pinned integration. See `../2026-10-17-roster-admin-release/ADMIN-SHEET-REVIEW.md` for exact owned test hashes, the initial access-focus expectation failure, source-grounded correction and root's cumulative three passing cases. Root also reports four existing admin/import cases passed and accepted the batched desktop/mobile captures. No product source correction was required. These are attributed root runtime/visual results, not an independent browser rerun. Final repository, committed candidate and hosted release gates remain root-owned.
