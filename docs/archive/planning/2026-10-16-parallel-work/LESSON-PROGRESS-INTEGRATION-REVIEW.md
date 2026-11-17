# Lesson and progress UI integration review

**Accepted bounded source and cumulative focused runtime**, pending final broader/exact hosted gates. Frozen UI source5a14d73c456d6398992900f665cde0ccc878e842 includes reviewed progress32002c9/lesson785b233, progress reconciliation6eb3e44 and lesson cleanup-false5a14d73. Existing accepted backend progress2689d94/lessonf2aabe24 is unchanged. Later release operator318/0d11420/2a96fc6/dbc470e and WSb292c05 are separate scopes.

Own only tests/http-browser/lesson-progress-privacy-ui.test.ts and this original report. Final test SHA256: **424158db92659ce0ee6eaa83a6e8489c9e2c1113c860fa1e6355e5882a98fc88**. No product edits or new UI/dependency/detector scope. No moving Claude admin or newer voice source reviewed here.

## Source findings and repaired behavior

The original6398 progress review distinguished stale display/retry risk from persistence authorization: server CAS/current assignment capability already protects writes. Source6eb3e44 now marks unknown/conflict results unverified, disables further per-verse writes until an explicit/automatic current read succeeds, and leaves failed GET recovery read-only. It never replays POST. Same-scope fresh baseline object no longer suppresses save reconciliation: generation, rather than object identity, fences current context and refreshes both mark and server counts. Provider practice generation/selection checks already reject late results after concealment/context replacement; no generic lifecycle layer was added.

Lesson serviceRead wraps normal requests in fresh session checks and selected route/practice generation/handle checks. Panel list/write generations and AbortControllers reject stale work; selected scope includes session binding, epoch, mode and student. Live server entry permissions remain authoritative. Lesson's own dirty sheet yields to its own close/departure prompt and both shared-hook modals leave the top layer during access checks. Cleanup clears/aborts draft/task UI and resolves pending departure FALSE; clearing or unmounting cannot grant a waiting navigation. Pending writes retain native closedby-none and a bounded Escape capture fallback. This report does not invent a reachable simultaneous reading-editor/lesson guard pair or claim framework-wide stack coverage.

## Independent actual browser checks

One fixture file uses the real SDK, actual HTTP handlers and restricted PostgreSQL role, synthetic text/lesson fixtures, real role navigation and held network responses. Three role sign-ins are cached only while healthy; no handles/localStorage are copied and no expiry behavior is faked by session reuse. Loopback egress only, exclusive3191 and exact known disposable cluster. No provider/model/private audio or production operation.

Initial command `node .local-logs/frozen-browser-isolated.mjs lesson-progress-independent tests/http-browser/lesson-progress-privacy-ui.test.ts`: **1/4 passed,33.24s**, log lesson-progress-independent-browser.log. Lesson conceal/resume/pending/revocation group passed. Three test defects failed: Windows-encoded middle dot in a regex mismatched the correct hero text; early stop exposed unnecessary later assignment-order assumptions; admin uses existing plain #reading-heading rather than song-only .reading-hero. Corrected only owned test encoding/selectors and derive current binding/cardinality from each fresh fixture. No assertion was dropped or product source changed.

Corrected command `node .local-logs/frozen-browser-isolated.mjs lesson-progress-independent-corrected tests/http-browser/lesson-progress-privacy-ui.test.ts -t "reconciles a held|keeps overlapping|gives admin"`: **affected3/3 passed,23.25s**, one already-passed group unselected, log lesson-progress-independent-corrected-browser.log. There was no final single4/4 run; cumulative coverage is initial1 plus corrected3.

Verified:

- A real successful self-check POST held across same-scope Refresh reading reconciles exact API state/version, card and hero count after release, with exactly one POST. A second held old-assignment successful response cannot republish after actual authorized assignment replacement; new verse identities/zero marks and exactly two intentional writes remain.
- A tutor account's parent selected mode remains read-only. Explicit child practice writes self-check only, shows no assessment control, and a held child-A progress page cannot publish marks/counts after actual switch to sibling's distinct references.
- Lesson's actual dirty close prompt has exactly one modal, held same-authority access check has zero, resume has one and Keep writing restores exact draft/focus. Discard restores opener/zero modal and causes no write. Real pending authorized save remains visible through repeated Escape with disabled close; only one intentional POST. Real tutor relationship revocation clears private draft/list/prompt, gives actual tutor API404, leaves zero modal and usable Parent recovery; no extra write continuation. This verifies reachable own-close cleanup, not a fabricated pending-navigation pair.
- Admin reads/paginates beyond50, edits another tutor's entry and sees delete authority. Child practice reads both pages with no edit/add controls. A fetched authorized answer deliberately mutated to wrong studentId/private marker is rejected before display: zero entries/marker, explicit unavailable state, and successful clean retry. Total count derives from fresh fixture, not earlier test execution.

Corrected typecheck passed. Both browser runs report exact port/server restoration=true, owned anchor removed=true; final server.ts/tsconfig diff empty. All contexts/runtime/DB fixtures closed. Test file now frozen for author unchanged commit. No repeat browser requested.

## Attributed reused evidence and limits

Author reports pure6/6 and typecheck pass at frozen frontend; ordinary4/4 before cleanup-false repair, then targeted normal3/3 in70.36s at final source (uncertain progress lost-answer/held+failedGET/explicit retry/noPOST replay, study setup, Standard/Huge390x844 long verse/final-qere reachability), with source/config restoration and anchor cleanup true. Root accepted three ordinary synthetic captures and existing long-verse evidence; no independent new visual round claimed. No student820px relaxation was introduced.

No source blocker remains in this bounded flow. Full app/build/final guard and exact hosted CI remain pending at this report checkpoint. Prior green backend/recording/voice/auth evidence applies only to unchanged files. Release migration/private catalog/WS operator acceptance is separately reported; this UI review is not production deployment approval or a whole-project audit.

## Frozen test and bounded WebSocket probe review

Author committed the final reviewer test unchanged at **213a71c386659e69615b48bc515a7cf73f198a63**; no second reviewer commit was needed. Source5a14 remains unchanged.

Separately reviewed exact WS probe patch **b292c05e80e5dccce895f116c783437a6c23b8f9**, two files only: scripts/provider-bootstrap/neon-ws.ts and tests/app/provider-neon-probe.test.ts. Its fixed eight-table identifier list adds catalog RLS/FORCE completeness and SELECT-only zero-count checks in existing no/empty/wrong-context transactions. No persistent fixture or extra DML was added; existing student rollback/commit/physical connection, parallel context, restricted role/host/config/launcher guards remain. Independent focused **8/8 pass**, command `node .local-logs/run-isolated.mjs release-ws-independent npm run test:app -- tests/app/provider-neon-probe.test.ts`, duration2.74s, ignored release-ws-independent.log. This is source/unit acceptance only, not actual production WebSocket transport proof. Newly empty tables alone cannot establish populated-row isolation; existing real migration/RLS tests and exact catalog guard remain separate evidence. Root owns actual post-migration WS probe.

## Attributed final broader integration check

Root executed the full app suite in isolated exact-LF b292 candidate: **828 passed+1 existing skip,93 files,430.02s**. Root verified runtime/src/tests-app/dependency diff b292-to-cbd90af is empty; subsequent commits contain reviewer browser tests, fixture packaging and CI history only. This is attributed root broader evidence, not a second independent full suite. Final typecheck/build were still running when this report was finalized, and exact final hosted CI/deployment remain root-owned gates. No further local browser/PG run is requested by this reviewer.

Final root attribution: exact-LF cbd90af typecheck and production build **PASS**; unchanged repository candidate/index guard **PASS,36.88s**. Root fullapp828+1 existing skip/93 files/430.02s is recorded above or in the linked UI review, with runtime/app diff zero to cbd. Independent defaultCore/defaultSource sentinel at cbd passed as recorded. All local gates are now closed; exact final hosted CI and root deployment sequence remain pending, with no further reviewer test requested.
