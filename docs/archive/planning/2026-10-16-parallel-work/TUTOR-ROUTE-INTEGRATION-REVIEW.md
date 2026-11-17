# Independent tutor-route integration review — 2026-10-16

**Accept the bounded source through repair `b9f12e9b56d2f337a57ac6f988c80e18d6e608f8`; author targeted browser and root visual gates are now accepted as attributed below. Exact-tree hosted CI remains required.** One confirmed P2 route-pagination defect is corrected and independently re-probed. No authority escalation, SSR private-data read or weakened existing security assertion was found in the frozen delta. This is a bounded review of the tutor task flow, not a new whole-project or student-design audit.

## Reviewed identity and boundaries

- Frozen source `94dae6572e003e05488d68106cb84dbbec586a51`, exact parent `1c3081227531995ab8f32e7554983f3c27aedc41`.
- Clean cherry-pick `37a4994260e6c2a26fe3c231dde881e104200796` on `codex/tutor-route-integration`, managed checkout `C:/Users/dsbog/.codex/worktrees/recording-core/bneimitzvah`.
- Read CLAUDE, current MISSION/STATE and shared coordination. Daniel approved the student interface at `1c30812`; this review does not reopen its design/wording. All-four-job green CI at that parent and accepted guard/voice/recording reviews remain the evidence for unchanged code.
- Reviewed only the frozen tutor route, provider link/nav changes, student cards/selection, tutor reading presentation and accompanying browser-test selector changes. Moving Claude editor work and newer voice/staff checkpoints are excluded.
- Reviewer owns this report and ignored synthetic probes only. No product, committed test, index, browser, database, fixture, provider, migration/import or private-audio operation was performed. Author owns repairs/browser runs; root owns final integration and visual inspection.

## Confirmed finding

**P2 integration blocker: an authorized tutor student after the first 100 rows cannot open on the stable route.** `StudentSelection.load(false)` fetches only the first authorized page. The new route ID is selected only if it appears in those fetched values. `loadMore()` appends subsequent cards without reconsidering route selection. A tutor can load a second page on the index and click its card, but the fresh focused route returns to page one and shows “Student not found.” Even manually loading its page on the focused route leaves it unselected.

An independent runtime harness transpiles and executes the exact frozen `students.tsx` with controlled hooks and a synthetic two-page authorized API. For row 101, the initial result is Not found/no `ReadingPanel`; after Load more, it remains Not found/no `ReadingPanel` despite two API pages including the target. Positive controls select an authorized first-page route and reject an unknown route. This is a task-completion defect, not a grant of access to a foreign ID.

Requested repair: resolve the focused route against authorized cursor pages until found/exhausted, preserving abort/generation checks and rejecting repeated/nonadvancing pages; keep route IDs as selectors only. A real authorized read with existing server checks would also require a carefully bounded contract, but no new backend is needed for the paging repair. Add direct/card navigation beyond 100 plus unknown-route exhaustion regression before source acceptance.

**Corrected and accepted at `b9f12e9`:** the author continues existing authorized cursor pages until the focused target is found or the list ends, checks abort/generation immediately after every page, rejects duplicate/backward entries and includes the route ID in callback dependencies. No new endpoint or authority rule is added. Independent execution of the repaired source selects row 101 in two API pages, keeps unknown routes unselected, rejects a repeated/nonadvancing page, and retains distinct keyed mounts plus aborted/late-result rejection. The twelve control probes remain green against the corrected ref.

## Source findings and positive evidence

- **Route lifecycle:** `StudentWorkspace` keys `StudentSelection` by `studentId`. A sibling URL produces a new keyed selection mount, invalidating the initial concern about `routeStudentId` being captured by a callback whose dependency array contains only mode. Independent runtime checks confirm distinct route keys and that unmount aborts the old request and discards its late result. Reading/study/work/service lifecycle and reload-barrier protections remain unchanged.
- **Authority:** route selection is conditional on the account's authorized list. `RequireRole` still omits children for an unavailable role. Every reading/study/work request uses existing live server checks; `withActor` still checks the current grant and tenant, rejects practice headers in base roles, and `withStudentCapability` still checks target and relationship. These files are unchanged; the route ID itself grants nothing. A revoked/missing relationship remains indistinguishable from another unavailable target.
- **SSR and prefetch:** the new async page reads only `params.studentId` and passes mode/id to the client workspace. It fetches no student record, text, notes or recording. The layout provider initially renders access-checking state; no new private server payload or persistent browser storage is introduced.
- **Unsent work and role switching:** tutor cards use existing `WorkspaceLink.guardDeparture`; parent cards use the same guard before local selection. WorkCoordinator save/recovery/departure logic, cancellation resolution, beforeunload handling and cleanup remain. Independent control probes confirm guard denial prevents router navigation and allowance pushes; modifier clicks retain native new-tab behavior. Provider pathname refresh, practice-context invalidation and route-revision protection remain. Actual focused-route held-response/unsent-note behavior still needs browser coverage.
- **Labels and adult data:** native links/buttons replace the select, retain explicit Student/Child list labels, expose current/pressed state, and isolate names with `bdi`. Nested tutor paths keep the Tutor role nav current. Card date/countdown consumes the existing validated Student projection; optional parent/adult contact fields are not accessed. Independent synthetic checks confirm Today/Tomorrow/future/past countdowns, escaped markup in names, and rendering with null optional contacts. Ceremony date is required and validated by the unchanged API; null ceremony dates are not an admitted contract.
- **Task-flow accessibility:** native controls, accessible headings, 44px compact-card minimum height and existing focus styles remain. This source inspection does not establish touch scrolling, contrast, actual focus order or phone clipping; those belong to the author's synthetic route captures and root's bounded visual review. No new full detector was run for these small token-reusing additions; the earlier 38 style-document advisories are not new scope.

## Browser-test review and meaningful remaining cases

Frozen test edits replace select-option interactions with card clicks scoped to the labelled Student/Child list. Existing role, parent/child-practice, copied-URL, sibling, unsent-work, revalidation, revocation and stale-response assertions are retained. The frozen study case adds a stable tutor pathname, random unknown route/no text, then direct valid route; it does not by itself establish all new lifecycle cases.

Before the author's first coordinated browser pass, reviewer requested:

1. Authorized direct tutor route plus nested Tutor `aria-current`; authorized route/card beyond the first page.
2. Foreign/malformed routes and student-only/anonymous access with no private reading/study/editor request, rather than only absent text.
3. A→B tutor-card transition with held A reading/study response and unsent tutor note: cancel preserves A, explicit departure permits B, and releasing A cannot overwrite B.
4. Relationship revocation while focused clears text/editor; retained parent role/copied-practice cases verify context/session separation.

These are requested regression gates, not claimed executed results. Root will inspect synthetic desktop/phone tutor captures after source acceptance; no old student screenshots or visual-direction choice needs repeating.

**Author regression source accepted at `b9f12e9`:** new `tests/http-browser/tutor-route-ui.test.ts` contains four bounded cases. It exercises keyboard Enter on a tutor card, stable/copied direct route, nested Tutor current state, cancel then explicit discard of a synthetic unsent note (zero note writes/no discarded note in DOM or storage), held old reading versus a new card route, foreign/unknown/malformed route exclusion and direct server denial, live tutor-link revocation, independent parent read authority, later-page card/direct access, pending-pagination loading before Not found, and admin/student-only/anonymous role denial with zero private reading/study/work reads. Prior multi-role/copied-practice security tests remain. Source review accepts these assertions; their actual browser result is pending. Captures are synthetic tutor home/reading at desktop/phone plus parent cards; root owns their visual judgment.

## Actual independent checks

From the original checkout, using existing Next SWC/React dependencies and only synthetic values:

```powershell
node .local-logs/tutor-route-review/selection-probe.cjs
node .local-logs/tutor-route-review/controls-probe.cjs
```

Selection probe: confirmed the pagination failure above; authorized first-page selection, unknown-route exclusion, distinct route keys and unmount-abort/late-response rejection pass. Controls probe: **12/12 pass**, covering guard cancel/allow, four modifiers, unavailable-role child exclusion, four countdown boundaries, and escaped adult-card rendering with null optional contacts. The controls harness initially compared HTML attribute case literally; correcting its case-insensitive assertion resolved that harness-only failure. No application failure was hidden.

These are controlled source/runtime probes, not React browser lifecycle, server authorization/RLS, keyboard or visual proof. No full suite or independent browser was run. Source acceptance is complete as recorded below; exact-tree hosted CI remains pending. Production, migration/import, G3 and newer staff/voice work stay held.

Repair confirmation commands, run only after the frozen source changed:

```powershell
$env:REVIEW_REF='b9f12e9'
node .local-logs/tutor-route-review/selection-probe.cjs
node .local-logs/tutor-route-review/controls-probe.cjs
Remove-Item Env:REVIEW_REF
```

Both complete successfully with the outcomes described above. **Source acceptance is complete through `b9f12e9`; browser, root visual and exact-tree hosted gates remain pending.** Unchanged guard/recording/voice code requires no new independent proof in this tutor-route slice. No further product change is requested by this reviewer.

## Final attributed author/root evidence

The author reports the actual SDK/restricted-PostgreSQL browser batch at exact `b9f12e9b56d2f337a57ac6f988c80e18d6e608f8` **passed 7/7 across two files in 48.45 seconds**: four new tutor-route cases plus the three retained workspace cases. The author confirms exact server-source byte restoration, removal of the owned temporary anchor login, and successful fixture closure. Typecheck and production build pass. These are author-executed results, not an independent browser or suite rerun by this reviewer.

Root inspected all five synthetic tutor/parent captures together and accepted them without correction. Tutor phone intentionally retains staff assignment metadata before Hebrew; no student 820px gate was relaxed. Root accepts the seven browser cases and cleanup/restoration; no further capture or confirmation round is requested. Capture judgment belongs to root; this reviewer did not independently inspect them.

The author's scoped detector reports **41 advisories only (37 type-ramp, four radius), zero primary findings**. This is separate author evidence, not a new independent detector run or a claim that the earlier 38 entries remained numerically identical. No new polishing or expanded surface work follows from those advisories.

The targeted browser/root-visual gates described as pending in earlier sections are now closed on this attributed evidence. Independent source/probe acceptance remains as documented above. Exact final-tree hosted CI is still the integration gate; production, migration/import and G3 remain held. No further source, probe, browser or visual work is queued by this reviewer.
