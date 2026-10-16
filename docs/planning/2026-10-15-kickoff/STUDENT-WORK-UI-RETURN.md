# Student work UI implementation return — 2026-10-16

## Assignment-revision recovery checkpoint — 2026-10-16

Released at `1030aa1c4e7888034a870072dd81c481339b0235`. All four hosted jobs pass in run `38961951488`; the exact commit is READY at deployment `dpl_iNp5w5xX12DAiwktqjfdyQTMq8tb`. The canonical native canary passes with five expected/observed route events, five matching native records and no secret canaries observed. No schema, provider configuration or owner-grant change accompanied recovery. Verse selection and aliyah cuts are the next implementation, not part of this release.

Before verse selection and aliyah cuts, unsent work now survives a strictly newer revision of the same assignment with exactly the same ordered verses and freshly verified student authority. Each reading is retained separately. Retained text is blocked for explicit review; automatic saves cannot cross the revision. Saved history remains available. This is mounted-tab recovery, not durable browser storage.

A separate body-only recovery POST binds the original frozen mutation, current assignment, verse, stream and domain-separated authority proof. Under the assignment lock it distinguishes a committed old save from explicit absence; ordinary receipt parsing remains revision-strict. An uncertain result never permits a new save identity. A confirmed old save is kept distinct from later typed text. Access/session/context changes still clear work.

Independent source review found and closed two gaps: missing verse/stream echoes in the recovery proof, and a manual recovery 404 that could preserve visible text after authority changed. The repaired path hides text during a fresh authority-page check, clears denied/mismatched authority and keeps failed checks hidden with the existing retry path. See PHASE2-SECURITY-REVIEW.md.

Current evidence: 66 focused cases, typecheck/build and four repository/isolation guards pass; full integration passes 152 engine and 493 app cases (one existing skip); actual local PostgreSQL 16 passes all 18 student-work cases including both lock orders and final expiry; all ten authenticated browser cases pass. The first browser run passed seven existing cases but stopped all three new cases in a helper fetching from an unopened tab. Entering the actual staff workspace fixes that helper without weakening acceptance. Four fresh synthetic desktop/mobile full-page captures and four analytical detail crops are private under `.impeccable/review/work-revision-*`; the single changed-target detector returned no findings. Fresh visual review found only an outdated workspace inventory; the documenter corrected it and the reviewer scored that sole fix resolved with disposition ship. Hosted CI and deployment acceptance subsequently passed as recorded above.

## Earlier implementation return (historical)

Status: implementation and the affected local acceptance gates pass. Fresh finish
review of the corrected unknown-state capture remains with Astra and the independent
reviewer. This note does not claim a local combined 38/38 pass, hosted CI/publication
or student release. No commits or pushes by the implementer.

## Implemented

- `src/components/portal/workspace/work/api.ts`: closed work page/history/receipt
  parsers, exact scope and frozen-operation checks, newline-only normalization,
  UTF-8/control validation, 256 KiB streaming bound, fixed 12-second transport,
  no-store/same-origin safeguards. Conflict and stale assignment remain distinct.
- `work/coordinator.ts`: mounted-memory drafts, 800 ms composition-aware
  autosave, explicit note submission, frozen UUID/body, one append per
  verse/stream, queued typing, CAS comparison, receipt/current-head recovery and
  original-body retry. Ordered reads and monotonic acknowledgement/head rules
  fence old pages and held receipts. Three current work pages plus staged work;
  opening beyond the staged page budget requires departure review.
- `work/verse-tools.tsx`, `history.tsx`, `departure-review.tsx`: per-verse native
  disclosure after Hebrew/English on small screens, adjacent desktop work column,
  explicit learner/read-only/staff modes, student-visible notes, safe attribution,
  empty clear versus never-started state, bounded exclusive history navigation,
  labelled recovery and accessible focused departure dialog.
- `provider.tsx` / `reading.tsx`: work transport injects the existing matched
  child handle; raw handles never enter work keys. Pause stops debounces and read
  continuations; the full provider/reading metadata + text + work barrier settles
  writes/recovery before reveal/resume. The coordinator survives transient text
  failure. Denied/session/context/assignment transitions clear mounted work and
  fence callbacks. Receipt 404 alone does not invalidate authority or prove absence.
- Controlled departure sites: provider role/account links, child select/exit,
  student selector, study kind/page controls, admin back link and assignment
  confirmation. Unexpected in-app view loss retains only a non-sensitive notice.
  Native beforeunload warning is registered while unsent/uncertain work exists.
  The UI discloses browser Back/Forward/termination and reload/close limitations.
- Scoped `globals.css` additions preserve the incumbent Annotated score world and
  first-phone-verse geometry; no tokens, fonts, assets or global router added.
  Astra subsequently assigned the narrow live-reading activation of the independently
  approved `src/styles/hebrew-font.module.css` Noto content class and a controlled
  `/trope-chart` link in the existing post-passage practice tools. Hebrew remains
  2rem with line height 2; the font/chart author owns the underlying assets/page.

The test-harness change is `tests/http-browser/server.ts`: recognize the
existing work route alongside auth/portal routes so real work requests reach the
injected restricted-runtime dispatcher. Without it they fell into Next's production
runtime and returned sanitized 503s. No schema/cache/account or fixture authority
changes were made. Synthetic SDK cookies are reused
in test memory to respect the real origin sign-in rate budget.

The actual dispatcher then exposed a production integration bug: its broad portal
handler returned 404 for owned `/api/students/.../work` paths before the exact work
handler could run. Astra approved the minimal `src/server/http/dispatch.ts` handler
order correction (auth, exact work, broad portal). A full dispatcher regression in
`tests/app/student-work.test.ts` now proves GET work and a persisted append, retaining
wrong-method/query, foreign-origin/student and unrelated-route denial checks. This
was missed by earlier handler-direct backend tests; it justifies root's broader
backend/HTTP integration checks. No schema or capability policy changed.

## Final local evidence

- Node suite: 145 passed. Final app suite: 381 passed, one POSIX-only skip.
- Typecheck and production build: pass. Production browser gate: 15 passed.
- Authenticated combined browser run: 35/38, followed by the three affected files
  passing 16/16 after the bounded fixes below. Those 16 cover all seven editor
  cases, six roster-control cases and three study cases. There is no local final
  combined 38/38 claim; root owns the hosted full integration gate.
- Capture-only standalone lost-ack/queued-edit rerun: 1/1 passed after normalizing
  unknown-state captures. Fresh images use the same unknown desktop/mobile paths;
  other validated scenario captures were preserved. Independent finish verdict is
  pending, so a passing capture command alone is not treated as visual acceptance.
- Focused Vitest work/study/reading/binding selection: 33/33 pass, including 16 new
  work DTO/coordinator cases. Covers immutable operation retention, IME/debounce,
  queued edits, receipt 404/original retry, plausible mismatched receipts, newer
  head recovery, held old read and held acknowledgement ordering, unknown/current
  head failure, pause epoch and two-stage reveal, recovery settlement, page budget,
  and departure choices.
- `tests/http-browser/student-work-ui.test.ts`: all seven actual SDK/PG cases pass
  in the affected-file gate. Uses real API dispatch, `route.fetch()` before holding committed
  replies, and PG version/audit assertions. Includes mode boundaries, escaped Unicode,
  lost acknowledgement + queued edits, later head/CAS conflict, identical-body retry,
  IME/byte/clear/history, work/text/metadata barriers and text outage, byte-adaptive
  pages, original assignment/remove/re-add behavior, revocation and SDK expiry.
- First browser run: 0/6 before the harness dispatch and SDK-cookie reuse fixes;
  root owns log `.local-logs/student-work-ui-browser-first.log`. Those failures are
  retained as evidence, not counted as successful acceptance. Second run: 0/7;
  targeted diagnostic proved metadata/text 200 but work 404 and found the production
  dispatch ordering bug above. After correction, first normal case passed (1/1
  selected, six skipped). Full seven-case run then passed 4/7. Its remaining three
  failures were duplicate attribution test scope, dialog focus while controls
  transitioned from disabled to enabled, and forced-revocation recovery remaining
  on the unavailable practice route. Narrow fixes are complete: require each note's
  attribution, focus Keep working after settlement, and redirect only a currently
  matching denied practice scope to a fresh hidden parent check. The actual unknown
  leave/sibling switch sequence and its old-queue fence had passed before the later
  forced-revocation assertion failed.
- The next combined run passed 35/38: editor 6/7. It confirmed the focus and forced
  parent recovery fixes. Remaining causes/fixes: the isolated harness omitted public
  font bytes (now copies only approved TTF and OFL); the old roster expectation
  assumed the superseded access screen (now requires fresh parent recovery while
  retaining 404/old-content/sibling checks); and study-page navigation started work
  after a handled text 409, removing its explicit recovery control. The latter now
  requires a successful current text result plus original controller/generation/
  metadata before starting the work page. Existing study regression assertions stay
  in place and click failures now identify only fixed, non-sensitive action names.
  Focused work/study 23/23 pass; the three affected files subsequently passed 16/16.
- After the production correction: backend/work UI 27/27 and typecheck pass.
- The focus/parent recovery repair batch also passed focused work/study/binding
  25/25 and typecheck before the actual browser verification.
- The fresh finish reviewer identified malformed blank paint in the initial
  `work-unknown-mobile.png` status/actions/history area. The capture helper had
  awaited fonts after viewport resize without resetting scroll or waiting for paint.
  Test-only normalization now checks the current private reading and exact expected
  unknown state/controls, awaits fonts, scrolls to zero, waits two animation frames,
  rechecks state/zero scroll/no overflow and the masthead in view, then captures.
  It does not hide controls, alter the app, stitch images or change save outcomes.
  The targeted capture rerun passed 1/1; the fresh reviewer owns image acceptance.
- Impeccable context/craft floor read. Mechanical detector run once; evidence is
  `.local-logs/student-work-ui-detector.json`. It reported the existing 19 palette/type
  advisories plus two new scoped advisories. The new font-size/backdrop literals
  were replaced by inherited type/existing color token; no detector rerun.

## Verified behavior and remaining boundary

The affected gate verifies explicit student-visible admin and assigned-tutor notes,
safe per-note attribution, read-only parent/staff translations and assisted child
draft attribution with no staff union in child mode. Staff-note Save-and-continue
works; cancel restores focus, including a dialog opened while a save is settling.
An unknown original-child save can be explicitly left before a sibling switch;
the queued old text never posts under the new child/context. Forced current-child
revocation clears immediately and returns to a freshly checked parent picker;
late replies cannot restore the old work.

The live first Hebrew-only span passed CDP platform-font inspection: custom Noto
Serif Hebrew supplies a positive glyph count and every returned glyph font is
custom. This verifies actual glyph use, beyond CSS/font readiness. The original
first complete Hebrew range remains within the unchanged 390×844 viewport after
fonts settle; Hebrew remains 2rem with line height 2. The capture set covers five
paired desktop/phone states and one representative 200% phone reflow. Only the
malformed unknown-state evidence needed the targeted recapture above.

All drafts, queues, receipts, history and practice handles remain in mounted tab
memory. There is no local/session storage, IndexedDB, service-worker draft storage,
automatic clipboard, beacon or unload save. Controlled departures are guarded;
forced authority loss clears immediately. Native beforeunload registration was
probed in dirty and clean states, but a browser need not show a warning or deliver
a save. Arbitrary Back/Forward, reload, tab close, process loss or an unexpected
route/context loss can discard unsent memory. The app cannot restore it afterward;
an earlier unconfirmed server request may still have committed. These are the
approved disclosed limits, not a promise of lossless autosave.

Update DESIGN/workspace inventory and STATE only after independent finish review.
Root owns STATE/security, Git, hosted CI/publication and final acceptance. No app,
test, DESIGN or workspace-inventory change accompanies this final evidence update.

## Published-checkpoint CI repair — 2026-10-16

The initial exact-head hosted run for `74f798a` passed Windows/Linux unit/build and
public browser gates, SQL 6/6 and service 43/43, but authenticated browser checks
were 37/38 with an additional unhandled native-cache rejection. On Linux the loaded
Noto first Hebrew range had top 814.25 and bottom 852.25 against the required 844px
viewport. The bounded repair reduces only phone assigned-study/kind-selector/list
spacing before the verse; Hebrew 2rem/line-height 2, touch-control heights, font and
the complete-range assertion are unchanged. Real-browser verification is pending.

The pinned Next 16.4.2 cleanup selects native `project.shutdown()` only with
`__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN=1`; otherwise it uses `project.onExit()`.
The test-only close helper sets that flag throughout awaited close and restores the
exact prior value, including absence. Both NextCustomServer.close and its callback
set use `Promise.allSettled`, so resolution cannot positively confirm internal
cleanup success. Consequently the harness **unconditionally retains isolated
directories after Next starts**; it never deletes a cache possibly still used by
native tasks. They contain only synthetic fixture/source/build data beneath ignored
`.local-logs`. Copy failure before Next starts may still remove its incomplete copy.
No error listener suppresses unhandled failures and no shutdown sleep is added.

The isolation case now checks unchanged source tsconfig/production build, retained
private copy and a closed HTTP listener. Two focused non-PG tests pass for awaited
flag lifetime/exact restoration and propagation of an observed close failure;
`tsc --noEmit` passes. Root's subsequent full SDK/PostgreSQL browser run passed
38/38 across all 12 files in 173.68 seconds, with no unhandled-error report;
production build passed. Root inspected the updated phone capture and accepted the
bounded spacing correction. Exact-head hosted verification subsequently passed at 98863c6: all four jobs in run 38907284630, including 6 SQL, 43 service and all 38 authenticated-browser checks. Deployment 7120046197 succeeded; the stable public chart returns HTTP 200.

## Root integration and scoped verdict

Astra independently accepted the authority/lifecycle and dispatcher corrections. The fresh visual reviewer returned **ship** for its scored recovery-copy and persistence fixes; the full review and verdict are in EDITOR-CHART-FINISH-REVIEW.md. Recovery now renders one accessible announcement while preserving specific receipt/current-head/history explanations, all actions and retained text. The two actual SDK/PostgreSQL recovery cases passed again (2/2 selected, five skipped), including distinct missing-receipt text, valid description targets and identical-body retry. Typecheck and production build passed after the final rendering change. Earlier 381-app/145-Node, 16 affected browser and 15 production-page results retain their precise scope above. Publication and exact-head hosted all-suite verification passed at 98863c6 as recorded above; no complete-product or live-provider claim is made.
