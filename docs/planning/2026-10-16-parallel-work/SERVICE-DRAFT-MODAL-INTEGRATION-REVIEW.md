# Independent service draft / modal integration review — 2026-10-16

**Accepted within the bounded source/runtime scope; no blocking finding.** Broader integration checks and exact hosted CI remain separate gates. Frozen UI `dd28b2b29df42f1f5f1256390b2fe28a955090c8` was cherry-picked as `bfe85bf` on the calendar baseline. Reviewed repair source `185a94a8ffe49bc6631f1e05a2f53d865e3b9c33`; author normal-test assertions follow at `7cfe55be9bbfbec6eb4c7cc48cca6c0a29078ce9`. Only reviewer-owned `tests/http-browser/service-modal-privacy-ui.test.ts` is added independently. Author owns product/normal tests/return note; reviewer owns this original report and the prior [design review](SERVICE-DRAFT-MODAL-DESIGN-REVIEW.md). No recursive delegation or moving progress UI integration.

## Frozen source review

The three-file repair follows the approved bounded design. ServicePlanEditor publishes logical departure-active state through ServiceLearningPanel to ReadingPanel, which physically suspends the reading sheet for either service or work departure while retaining its logical state and draft. The service guard uses the shared conceal-aware modal hook; no provider/helper/backend/busy-editor change or generic modal stack was introduced.

The guard captures the actual opener/sheet before suspension. Focus restoration requires a connected, enabled, visible, non-inert control outside a closed dialog; a retained open sheet keeps its native initial focus if its previous confirmation button disappeared during reload. The service catalog button is a visible fallback for ordinary service editing. Clear/unmount resolve pending decisions as canceled, clear opener references and publish inactive. Idle native close cancels the decision; conceal-driven closure preserves it. These are source conclusions; runtime ordering must still pass the focused assertions below.

Author-reported baseline reproduction measured modal counts [2,1,2] before/held conceal/resume. Author normal repair run passed 2/2 in 16.11s and measured [1,0,1], with exact drafts/focus/Escape/native-close/discard and zero confirms. Author reports source restoration/owned-anchor cleanup true. Root separately accepted the two synthetic captures at the repaired source. These are attributed author/root evidence, not reviewer reproduction or visual inspection.

## Independent scope and checks

Reviewer-owned cases cover held same-authority service/sheet conceal/resume and healthy-tab independence; real committed note with a lost response, sequential service/work decisions and later cancellation stopping confirmation; explicit role-departure clear/unmount; actual session expiry and tutor-link revocation with usable recovery. Exact modal counts, retained ranges/choices/note and request counts are asserted. Healthy same-role cookies are reused in fresh BrowserContexts; intentional expiry gets a fresh actual SDK session. No browser storage or practice handles are copied and no auth limits changed.

Independent composed typecheck passed via `node .local-logs/run-isolated.mjs service-modal-independent-typecheck npm run typecheck`. Product diff against 185a94a was empty before execution. Test SHA-256: `97fdf7f0983f09c993c02e81453cc580541ee8e5bca0be802f35c9c3fe70465c`.

The initial combined browser batch selected the two final author normal cases plus the three independent cases:

```text
node .local-logs/frozen-browser-isolated.mjs service-modal-independent tests/http-browser/service-learning-ui.test.ts tests/http-browser/service-modal-privacy-ui.test.ts -t "suspends the reading sheet|puts a tutor|resumes only the rightful|serializes service and unknown|clears pending service"
```

The inspected isolated runner probes owned port3191, asserts the exact known disposable loopback PostgreSQL cluster, creates a fresh owned bootstrap anchor, uses existing restricted-runtime fresh-database fixtures, and restores exact server source bytes/removes its anchor in finally. No parallel browser/PG/heavy lane is active. Measured outcomes, precise test-target corrections and post-run identity are recorded below. No production, external-provider or cross-browser claim is made.

## First independent batch and precise test-target corrections

First independent combined batch: **3 passed / 2 failed / 12 unselected skipped across two files, 43.87s**, ignored log `.local-logs/service-modal-independent-browser.log`. Both final author normal cases and the independent same-authority/other-tab case passed. Session-expiry checks inside the third group also reached their assertions before its relationship subcase failed. Exact server source restoration and owned-anchor removal were true; server.ts/tsconfig/product diffs remained empty.

The sequential case passed sole service/work modal ordering, later guard cancellation, retained reading range, focus, and no confirmation, then could not find a textbox while the auto-revealed Service parts tab still hid Reading. Corrected only the target path: explicitly select Reading and Student-visible notes before asserting the exact original unknown note and status. No preservation or no-replay assertion was removed.

The relationship subcase expected Student not found, which the actual source renders only for a nonempty roster with a missing focused selection. This fixture revoked its only tutor link, so StudentSelection's preceding empty-roster branch is the correct recovery. Corrected to the exact empty-roster text and strengthened the check with a fresh actual reading API status assertion (401 for expired session, 404 for revoked link), retaining no private DOM/storage, no confirmation, zero modal and usable recovery checks. No extra relationship/grant was inserted and no product defect is inferred from these two mismatched test targets.

Corrected composed typecheck passed via `service-modal-independent-corrected-typecheck`. Corrected test SHA-256: `c6ce8b3aaacd30fd5871ea037bfc04c077beada91cedacd49174825d1aacd2b8`. Only the two affected cases were rerun:

```text
node .local-logs/frozen-browser-isolated.mjs service-modal-independent-confirmation tests/http-browser/service-modal-privacy-ui.test.ts -t "serializes service and unknown|clears pending service"
```


## Final independent result and limits

Affected-case confirmation **2/2 passed, 1 unselected skip, 16.32s**, ignored log `.local-logs/service-modal-independent-confirmation-browser.log`. The exact original unknown note and unknown status survived the rightful tab/stream selection; no second note POST or reading/service confirmation occurred. Both sole-modal guard transitions and later cancellation were usable, retained reading ranges and editor focus, and stopped the original reading request. Explicit controlled departure discarded the unknown local copy only after the explicit choice and unmounted modal owners with zero remaining modals. The failure group proved actual expired-session 401 and revoked-relationship 404, exact recovery UI, zero private modal/text/storage remnants and usable public/authorized recovery.

Cumulative evidence covers all **five selected scenarios as initial 3 passes plus corrected 2 passes**. This is deliberately not described as a single 5/5 run. Product source did not change between the runs; the two corrections were only to the reviewer's test targets, with the original privacy, exact text, no-replay and focus assertions preserved or strengthened. The same-authority case also proved the other healthy tab retained its distinct service choices while the first tab was concealed.

Final HEAD was `7cfe55be9bbfbec6eb4c7cc48cca6c0a29078ce9`; product diff from `185a94a8ffe49bc6631f1e05a2f53d865e3b9c33` was empty. Final test hash remained `c6ce8b3aaacd30fd5871ea037bfc04c077beada91cedacd49174825d1aacd2b8`. Both browser runners reported **exact port-source bytes restored: true; owned temporary anchor removed: true**. Fixtures/contexts/server closed; server.ts and tsconfig diffs were empty. The exclusive lane was released before author broader checks. Author committed the reviewer-owned test file unchanged as `7dfd0497d38d70a98901227594b16899d3d06fc5` after checking the final hash, and will copy this original report.

Author-reported normal focused app checks: **36/36**, typecheck passed; prior normal browser repair **2/2,16.11s** as attributed above. Root accepts the reviewed source/runtime scope and the two synthetic tutor/service tab captures, separately from the reviewer's execution. No reviewer visual-inspection claim is made. Final author broader app/typecheck/build results are attributed below; the staged repository guard and exact hosted CI remain pending. The calendar baseline's exact hosted CI was separately reported green by root; backend behavior was unchanged in this slice and not retested broadly here.

No new UI world, provider grant path, generic modal framework, production migration, provider call or Safari/device testing is claimed. No further reviewer runtime round is requested absent a new failure.
## Final attributed author integration checks

At product `185a94a8ffe49bc6631f1e05a2f53d865e3b9c33` plus unchanged reviewer test commit `7dfd0497d38d70a98901227594b16899d3d06fc5`, author reports full app **820 passed + 1 existing skip across 91 files, 308.11s**, using `node .local-logs/run-isolated.mjs service-modal-full-app npm run test:app`. Final typecheck and build both **exit 0**, recorded in ignored `service-modal-final-typecheck.log` and `service-modal-final-build.log`. These are author executions, not independent reruns.

Author's single scoped detector exited 0 with **48 advisory / 0 primary findings** (44 font, 4 radius). Author comparison attributes 47 to the previously reviewed surface and one to the frozen tab's 17px font at globals.css:587. Root accepted the actual phone/desktop captures; no advisory-driven polishing was added. Detector output is mechanical evidence, separate from root's visual acceptance.

Author reports product diff against 185a94a, server/config diffs and backend diff against calendar baseline ec91c9f all empty. The independent first 3 passes / 2 mismatched test targets and corrected 2-case pass remain the exact runtime history above. No source or tests were changed or rerun for this final report append. Staged repository guard, clean final checkpoint and exact hosted CI remain separate pending gates.
