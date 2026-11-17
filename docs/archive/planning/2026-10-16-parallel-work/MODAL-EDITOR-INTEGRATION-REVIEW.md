# Independent modal/editor integration review — 2026-10-16

**Accepted for the bounded integration at final checkpoint `2496d04c94a146ed2492e582f45490cebdba276f`, product correction `b7c1c9d9da74044cbcff5d1dc648e663df5ce6bf`. No remaining blocking finding in the reviewed scope.** Independent source review and reviewer-authored regressions are distinguished below from author-executed browser checks and root's visual acceptance. This is not production approval or an independently rerun browser suite. Exact hosted CI remains the integration gate.

Initial source review covered frozen `3b3d73a89dea07c6e2d200561cc608c8f50cf2d1`, parent `94dae6572e003e05488d68106cb84dbbec586a51`, through Git objects in the read-only Song checkout. The chronological provisional findings below record what required correction; they are superseded by the final acceptance section. Reviewer made no product edits, started no browser/database, and ran no detector or heavy suite. Reviewer owns only this report and the explicitly assigned privacy regression file. Existing tutor pagination and progress foundation are preserved; moving UI changes are excluded.

## Actual changed contract

- `provider.tsx` exposes `concealed = checking || failure !== null` and adds `useWorkspaceModal(ref, open)`. Its layout effect closes the dialog while globally concealed and shows it only when requested and visible.
- `reading.tsx` moves the tutor's existing editor into a labelled native dialog; admin remains inline. Assign/Change verses opens it, pending editor operations disable close/Escape dismissal, and explicit close restores the connected opener or the replacement Change verses control.
- **`reading-editor.tsx` is changed:** optional `onBusy` plus a pending-state reporting effect. The return note's “reading-editor.tsx untouched” sentence is inaccurate, although its later note acknowledges this callback. Existing preparation/confirmation binding, generation, uncertainty/conflict handling and departure guard logic are otherwise unchanged. `reading-preview.tsx` is unchanged; CSS restyles its existing picker.
- Lift now captures its opener in a layout effect before using the shared visibility hook; cleanup closes and restores focus. Its existing data/page generation and read-word projection remain.

No backend authority grant or prepare/confirm validation is changed by this delta. New modal presentation must preserve existing guarded requests, clear-on-revocation and rightful-context draft lifetime.

## Global versus local hiding

Global workspace concealment is the helper's concern. The tutor editor dialog is a sibling **after** the closing `.reading-workspace` div, outside that div's local `hidden/inert={current.loading}` boundary. Confirm/reload local loading therefore does not, by source structure, hide the editor sheet. It should remain visible and busy until the outcome is shown. This is an expected runtime assertion, not an alleged local-hide defect.

Lift is inside `AssignedStudyText` within the locally hidden reading region. `ReadingPanel.load()` invokes `study.clear()` before reload, which clears lift state. A local/global recheck should remove the old lifted page and permit a fresh Start afterward, not reopen old content.

## Required narrow integration follow-up

**Known concealment gap:** existing `work/departure-review.tsx` still directly calls `showModal()` in its own effect. `WorkCoordinator.pause()` preserves `departure`; only `clear()` resolves/removes it. Therefore the new helper does not yet cover an open departure review during an access check. The UI owner identifies this same gap. It must receive a narrow integrated adaptation; preserve unsent text, unknown-save recovery and explicit cancel/save/discard semantics. Source alone does not prove the owner's stronger claim that every failed check remains locked: provider failure also clears work/unmounts the subtree. Test the actual failure and checking states rather than repeating that claim.

**Resume ordering to reproduce:** if the editor and a departure review are both open, blindly making both use layout-opening hooks may reorder them on conceal→reveal. DepartureReview is a child; ReadingPanel owns the editor hook. A child layout effect can reopen departure before the parent reopens the editor, placing the editor above the still-pending departure decision. This is a concrete source-order risk to probe, not a claimed observed browser defect. Prefer a bounded ordering/cancellation solution after reproduction; no generalized modal framework or workflow redesign is requested.

**Busy propagation to test:** ReadingEditor reports pending through a passive `onBusy` effect. Parent close/Escape checks therefore depend on propagation of pending state. Hold prepare/confirm and exercise immediate as well as settled Escape/close; do not infer full coverage merely from a disabled button assertion after effects settle. No actual early-dismissal failure has been reproduced here.

Focus restoration must target a connected control in the current visible workspace, preserve rightful draft/context, and avoid focus on removed/hidden old routes. Global revocation, session change or a different student/role must destroy the old dialog/draft subtree rather than revive it after access resumes.

## Bounded runtime/browser matrix

| Scenario | Required evidence |
| --- | --- |
| Editor idle→held global check→same-authority success | No `dialog:modal` while concealed; draft survives only in same rightful context; editor usable after reveal |
| Editor/departure→401/403/404 or revoked relationship | No invisible top-layer modal blocks sign-in/access recovery; old private draft/text is gone and does not reopen |
| Prepare/confirm/reload pending | Escape and Close cannot dismiss; local loading keeps editor visible; outcome/uncertain confirmation is seen; no automatic retry |
| Editor plus unsent-work departure→check→success | Correct top modal/focus; pending guard decision can cancel/save/discard; no hidden-modal trap or accidental departure |
| Explicit close, initial assignment and first confirmation | Keyboard Escape/close restores original Assign or replacement Change verses control; closing/reopening preserves same-context draft |
| Lift→held check or local reload | No concealed modal; stale lift removed; fresh Start and Escape/focus work afterward |
| Student/role/session transition and late response | Old draft/review/lift cannot migrate to new authority; existing generation/request fencing and departure checks remain |

Use the coordinated owned 3191 fixture with fresh database/roles and exact server-source restoration; never reuse another stream's 3187 harness or rotate its credentials. Author owns adaptation/normal tests; reviewer will coordinate distinct regression ownership if useful after the source freezes.

## Existing frozen test evidence and limits

Frozen reading tests now explicitly open/close the sheet and assert custom draft survival across reopening. Existing confirmation/revalidation/unknown-outcome assertions remain; captures target the sheet's outcome. Frozen study adds a held-session test requiring no `dialog:modal` during checking, old practice removal, then usable new Start/Escape. These are meaningful source assertions, but do not yet cover the full matrix above, particularly departure nesting, auth failure, busy dismissal and focus fallback.

The UI owner reports successful checks and all browser files on its own tree; those are stream evidence, not exact combined-tree acceptance. Root retains Daniel's approved student direction; no broad UX audit, new visual world, polishing or changed staff wording is requested. Next action is the author's bounded integration/reproduction, followed by independent frozen adaptation review and measured runtime results.

## Integrated source follow-up

Independently inspected the frozen integration cherry-pick `4b08fa8f76788597fd0e23cddf501ddf389c0e0e` and bounded correction `40e1e8411a9f72b9ca9a94ad7fcafd197ba90a26`. The earlier concealment gap is corrected in source. DepartureReview captures its opener in a layout effect before invoking the shared modal hook; the ReadingPanel sheet now requests physical visibility only while `sheetOpen && !work.departure`. Logical editor/draft state remains mounted. Departure is intentionally the sole physical modal while its decision is pending. This avoids relying on two dialogs' reopening order.

The hook returns intended visibility so DepartureReview does not focus Keep working while globally concealed. On cancellation its passive restoration rejects disconnected, hidden, inert, zero-rectangle and closed-dialog openers. If revalidation removes the original Confirm button, the reopened native sheet must still have usable focus; exact restoration to a removed button is not required. Session-binding change and failed access still clear existing work and remove the old subtree through the unchanged provider paths. No source-level authority or draft-lifetime regression was identified. The earlier local-loading distinction still applies: the editor is outside the reading's locally hidden region.

Reviewer authored the distinct `tests/http-browser/modal-privacy-ui.test.ts` in the managed integration checkout, SHA-256 `c05aeb2698ef0bc3ad3450788813546a60f19603dd11a3aaec7bd04aff88abb6`. Two groups require (1) sole departure modal, zero modals during a held real session request, successful same-authority reveal, actual Keep working click, usable editor focus, retained custom draft/note, real Escape and zero automatic confirmation/note writes; (2) actual session expiry and tutor-link revocation, no old dialog/private draft/text, zero confirmation, and usable Sign in or Parent navigation. The second group uses separate real sign-ins for its two failure scenarios. All data is synthetic; fixture mutations target only its fresh owned database.

Author owns normal pending prepare/confirm/local-reload, immediate Escape/disabled Close, outcome and lift assertions. Test-only `1fbaf96` makes the lift concealment case independently runnable. Author reports focused app 34/34, typecheck and build passing at this stage. These remain author evidence. Reviewer has not run a browser or database for this milestone; the coordinated combined author browser run is pending. Source acceptance is provisional until those actual modal/focus assertions pass.

## First combined browser result and owned correction

Author executed the selected combined batch at `f169410`: 11/14 passed in 99.73 seconds, with cleanup reported true. This is **not acceptance**. Reviewer inspected `.local-logs/modal-integration-browser.log`: fresh lift and seven preview cases passed; privacy expiry/revocation passed; the same-authority privacy case passed Keep working, resumed editor focus, draft and Escape/opener checks before failing because the note textbox was absent. The author's separate busy-editor case and final sign-in setup also failed and remain their responsibility to diagnose.

The privacy assertion assumed the previously selected note stream survived the study subtree reload. Source shows `VerseTools` remounts with local `stream = "draft"`, which is read-only for tutors and has no textbox. Reviewer corrected only the owned test to select the current authorized Student-visible notes control before asserting the **exact original unsent text**. The text, focus, custom-draft and zero-mutation assertions remain; none was removed. Corrected file SHA-256 is `1a68d33aada90aec36c5390b3e50647a71a6395f0dafc36295a1e54dd4226589`. Actual draft retention still requires the coordinated focused rerun; this source diagnosis alone does not claim a passing runtime result or a product data-loss defect.

Author's exact-three-failures confirmation passed 2/3 in 36.73 seconds: corrected same-authority privacy now passes its full exact-note/focus/zero-write assertions, and the empty-calendar/auth case passes after test-only role-specific reuse of real SDK cookies (`0d4b00b`). The reviewer correction is frozen `db60fce`. Product `ffd04b198be21e2f28847d6b7b95324426b82b75` moves the busy callback from passive to layout timing; reviewer inspected this narrow diff, but **it did not resolve the remaining prepare-held Escape failure**. Do not describe the ineffective timing change as the proven fix. The busy case remains blocking; all its immediate and repeated Escape/disabled-close assertions are retained with phase diagnostics.

Independent standards check identifies a bounded hypothesis: the HTML dialog's native cancel event derives cancelability from CloseWatcher; repeated close requests can become noncancelable without intervening user activation. See the [dialog close-watcher algorithm](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element) and [close-watcher user-activation rules](https://html.spec.whatwg.org/multipage/interaction.html#closewatcher). Author must measure actual `.editor-sheet.open`, `:modal`, native cancelability/default prevention/close events, and focus containment at each Escape before claiming this is the observed cause. This is primary-source reasoning, not an independently executed browser reproduction.

Author's subsequent phase-only native trace confirms that cause: first cancel was cancelable and prevented while pending/open/modal remained true; second cancel was noncancelable and not prevented, followed by native close with open/modal false. Workspace concealment was false and the accessible label remained present. Thus this is actual native closure, not a role-locator/name failure or established loss of busy state. No sheet keydown listener fired. Root approved native `closedby` protection while busy and a narrowly scoped document-capture Escape fallback for browsers lacking that attribute; the fallback must release during idle, concealment, suspension and unmount. Frozen source review and the unchanged busy-case runtime gate remain pending.

## Final corrections, evidence and acceptance

Independently reviewed native protection `2748e0c2e80d4ef41df79a96924c434f5560df96` and fallback `b7c1c9d9da74044cbcff5d1dc648e663df5ce6bf`. Native `closedby` is `none` while busy and `closerequest` while idle. The document-capture listener exists only while busy, checks Escape plus the actual sheet's `open`/`:modal` state and absence of hidden/inert ancestors, and removes the same callback with the same capture flag. Thus it does not intercept idle, concealed, suspended-departure or unmounted recovery controls. Existing cancellation logic remains; there is no forced reopen or generic modal stack. Layout publication now synchronizes the busy guard before keyboard interaction; it was not sufficient by itself.

The next author run passed all held prepare/confirm/post-confirm-reload native and simulated-fallback assertions, then failed on a separate test setup error: it requested Reload current reading after successful confirmation, although that control exists only for a blocked review. Reviewer verified the render condition and independently inspected test-only `2496d04c94a146ed2492e582f45490cebdba276f`: an actual authorized read-only prepare request is sent, its response is replaced by a fixed 409, and the existing blocked alert is required before exercising explicit reload. No product behavior changes or assertions were removed. Only already accepted repeat captures were omitted.

Author then executed:

```text
node .local-logs/frozen-browser-isolated.mjs modal-final-busy tests/http-browser/reading-ui.test.ts -t "keeps the tutor sheet"
```

Final selected case **1/1 passed**, three unselected cases skipped, **11.90 seconds**, log `.local-logs/modal-final-busy-browser.log`, exact final checkpoint above. Reviewer read this log and independently confirmed clean managed Git status plus no diff in `tests/http-browser/server.ts` or `tsconfig.json`. Author reports runner cleanup **Port source restored: true; owned role removed: true**, using its fresh owned fixture/3191 lane. Reviewer did not execute that runner or a separate browser.

The final case preserves immediate and repeated real Escape at held prepare, confirm, post-confirm metadata reload and explicit recovery reload; disabled Close and one physical modal; visible confirmed/recovery outcomes; idle Escape/focus restoration; and retained custom draft. It verifies Chromium native `closedBy` support, then removes/restores the attribute during held phases to exercise the fallback. This is not Safari, WebKit or Firefox execution evidence.

Across the bounded selected scenarios, results are **initial 11/14**, then **2/3 corrected failures**, native diagnostic failure establishing cause, a native/fallback run reaching the separate recovery setup error, and **final busy 1/1**. This is composite passing coverage of the 14 selected scenarios, **not a fabricated single 14/14 run at final HEAD**. Reuse of unaffected prior passing cases is deliberate. Author reports final typecheck and product build passing; focused app 34/34 is retained for unchanged coordinator behavior. Reviewer source inspection confirms no prepare/confirm authority path or backend data contract change.

Final tested file SHA-256 values:

- Reviewer privacy file, committed `db60fce976dee6208e7f7e1c25a3920cd87dd909`: `1a68d33aada90aec36c5390b3e50647a71a6395f0dafc36295a1e54dd4226589`.
- Author normal reading file at `2496d04`: `baa8dfb980c69872e9e8188d8051295c850b4c19c4caa18bd16cc5de35b9386a`.

Root separately accepted three synthetic staff-sheet captures: prepared phone, confirmed phone and prepared desktop. No new student design/820px gate, visual world or polishing was reopened. Author's scoped mechanical detector reports 47 advisories and zero primary findings; these are advisory output, not independently validated defects or browser proof, and do not authorize inherited polishing.

The blocking concealment/order and pending repeated-Escape issues are corrected and covered. Exact retained unsent note, editor focus, zero automatic confirmation/note writes, actual session expiry, tutor revocation and usable recovery are demonstrated by reviewer-authored tests executed by the author. No additional source blocker was found. Limits remain the explicitly bounded Chromium run and existing reused baseline evidence; exact hosted CI, production release and unrelated lesson/backend work are separate gates.

## Hosted fixture follow-up

Exact modal checkpoint `243d133` hosted run `38993244517` passed three jobs but **77/78 authenticated browsers**: the study old-child-switch setup hit the real magic-link limit at its sixth sign-in after the standalone lift case added another student sign-in. That earlier hosted gate remains red. Independent source/log review confirmed the count and no prior relevant expiry; author fixed only study fixture session reuse in `90038029ab434a80da97a5963ab9855e1ea227e0` on the subsequent lesson integration branch. Each role retains actual SDK authentication, new browser contexts copy only that role's cookies, and the final actual-expiry case signs in freshly. All security assertions and production auth limits remain.

Author's exclusive full-study run after broader lesson checks passed **6/6 in 45.25 seconds**, command `node .local-logs/frozen-browser-isolated.mjs lesson-study-ci-fixture tests/http-browser/study-ui.test.ts`. Reviewer read its ignored log and inspected the frozen test diff; no independent browser rerun is claimed. Author reports exact server-source restoration and owned-role removal true. Final combined hosted CI must verify the correction and supersede the failed modal gate; no bookkeeping rerun of the unchanged earlier checkpoint is requested. See [lesson integration evidence](LESSON-LOG-FOUNDATION-REVIEW.md) for the final source/test attribution.
