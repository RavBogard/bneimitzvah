# Selected-child preparation summary

Settled decisions (Daniel, binding): parent dashboards are read-only except honors; child practice is a separate explicit selection. Parents may see lesson notes and a days-only practice summary. Student self-check and tutor assessment remain distinct. Continuous reading stays the student default. The existing Annotated score/code-first direction and quiet authorization behavior remain.

## Bounded product decision

Add one compact summary within the existing selected-child parent view. Keep the current reading summaries, service section, full lesson history, honors and practice-selection controls. No new route, screen, navigation, form, backend endpoint or schema.

- Latest saved lesson: date and author, labeled as the lesson's author rather than the current assigned tutor. An optional native disclosure may show that saved note as plain text; it starts closed so a long note cannot crowd the reading. Distinguish loading, no saved lesson and unavailable states.
- Practice dates: dates recorded in the seven days ending on the returned server day. Show dates or a truthful empty/unavailable state. Do not imply singing duration, mastery, a streak or a completion percentage. No raw activity, writes or student visit reports.

Current tutor assignment and a structured next step do not exist in these projections. Do not infer them from imported names, authorship or prose. They wait for a separate reviewed slice. Service and reading data already appear elsewhere in this view and need no duplicate fetch.

## Architecture and privacy

Use the already-authorized newest lesson page from `lessons/panel.tsx`; publish a scope-bound snapshot through a small optional callback instead of fetching the history twice. Clear the projection on the same pause/clear/unmount/scope transitions as its source. Parent rendering must reject stale callbacks synchronously, not rely only on an effect clearing the screen later.

Use a separate read-only date projection through the existing `readPracticeCalendar` calendar operation with explicit parent mode. Do not enable the current mixed read/write student calendar store for parents. Reuse date validation and the existing bounded server-day correction pattern; an uncovered or stale interval must not appear as an empty week. Do not fetch before an authorized child is selected. Calendar unavailability must not block reading or lesson display.

Bind all projected data to the current session, epoch, parent mode, child and authorized reading scope. Abort and generation checks must reject late responses after sibling switches, revocation, identity change, expiry and unmount. Concealment hides private summary data immediately. Preserve existing server authorization and the full lesson editor's drafts, receipts and departure behavior. A parent with overlapping staff grants still receives only parent-mode read capabilities here.

## Ownership and acceptance

One Sol implementer owns `workspace/reading.tsx`, the minimal optional snapshot surface in `workspace/lessons/panel.tsx`, a small new parent-summary module, necessary narrow styles, and focused existing app/HTTP tests. No provider/server/auth/migration/import/mail changes. Root reviews product behavior and privacy independently before release.

Verify truthful empty/error states and current-child data, no duplicate lesson request, calendar-only operations, zero parent writes/raw-event requests, old-child late-response rejection and clearing on actual denial/expiry. Reuse existing synthetic fixtures and real authority transitions. Preserve student phone first-Hebrew geometry, quiet-return retention and the current reading/player behavior. Use isolated environments, proportional focused checks, type checking and repository protection; prepare a bounded native check only after root review. No commits, push, production operation or recursive delegation by the worker.

Open items that wait on Daniel: none for this bounded slice. Real listening and phone acceptance remain open on the separate release milestone; this work does not satisfy them.

## Reviewed implementation checkpoint, 2026-10-20

The seven-file implementation is independently source/privacy reviewed. Parent-only saved lesson snapshots reuse the existing newest page; dates use a separate calendar-only read and require a fully covered server-day week. Quiet unchanged return preserves the summary/disclosure and request counts. Root found and Sol repaired a concealed blocking-refresh startup defect before acceptance: date loading and receiver attachment now begin in one visible-authorized layout effect.

Thirty-nine focused checks, normal types, syntax and repository protection pass. Whole native browser file passes7/7, including unchanged quiet return, changed-reading recovery, stale sibling responses, real guardian revocation and actual session expiry. The first run3pass/4fail remains retained: its cleanup illegally un-revoked a guardian and poisoned later cases. Test-only cleanup now creates fresh grants only for previously active pairs, leaving revoked identities revoked; no access rule changed. Full owned cleanup and source/tool preservation pass. Local browser acceptance served an isolated development copy; the four preserved typegen artifacts are not a production-build claim. Four accepted synthetic desktop/mobile closed/open region captures are reused from the first run’s passed main case; they are not physical-phone or full-page evidence. One detector pass found75 incumbent CSS advisories/warning, none in the added module/CSS.

Source is checkpointed separately from the reading/auth/adult release. Exact hosted gates and deployment remain pending; no production or outreach operation is part of this parent slice.
