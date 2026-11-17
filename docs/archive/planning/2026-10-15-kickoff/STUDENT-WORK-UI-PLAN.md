# Student translations and tutor notes — UI plan, 2026-10-16

Design approved by Astra on 2026-10-16; implementation follows publication of the
backend/admin-controls milestone under a separate bounded assignment. It extends the accepted backend in
`STUDENT-WORK-PLAN.md` and `STUDENT-WORK-RETURN.md`; it requests no server/schema
change. MISSION, PRODUCT, DESIGN and the workspace surface brief remain binding.
Impeccable context/Shape guidance was read; the established Annotated score world,
code-first workflow and supplied task decisions replace a new interview/chooser.

## Job and visual direction

Students write their own translation while reading the assigned Hebrew; a parent
in active child practice can help under their own recorded attribution. Linked
parents inspect work read-only. Assigned tutors and admins read translations and
leave clearly student-visible notes. Success means a learner can tell which verse
they are writing, whether its latest edit is confirmed saved, and what to do when
another tab or an uncertain request prevents saving. This is an Operate surface
within the existing reading experience, not another workspace route.

Keep the white field, fine verse rules, system UI type, restrained burgundy actions,
teal confirmed state and the existing Hebrew size/line height. State always has
words. No decorative score imagery, new global tokens or raster assets. Hebrew,
canonical verse label and aligned JPS reference remain the primary reading content.
Do not add headings, an expanded editor or work-status banners above the first
Hebrew passage. Preserve the reviewed first-phone-viewport Hebrew geometry on both
Windows and CI fonts; adding controls after the verse cannot consume that margin.

On wide screens each verse becomes a reading column plus a neighboring work column
with a quiet separating rule. Avoid a cramped nested rail: the existing outer
`reading-workspace` becomes one reading span for this surface, and the per-verse
grid supplies the desktop rail. The existing static tools explanation/parent entry
action moves to a compact practice-context section after the passage; revise its
now-inaccurate translation-unavailable copy. No audio capability is implied.
At tablet/phone widths each work disclosure follows that verse's Hebrew and English.
It is initially collapsed on phones, and opening it never moves controls ahead of
the Hebrew. Keep one active verse's editor/history open at a time, with an explicit
reference in its label; other verse summaries remain compact. Switching the open
disclosure retains known unsent work in mounted memory, subject to the departure
rules below. It never silently saves a note or discards another verse's edit.

Use native disclosures for compact verse tools and two clearly labelled controls
inside: “My translation” / “Notes from your teachers” for the learner, or “Student
translation” / “Student-visible notes” for other modes. Ordinary pressed buttons
with labelled regions are sufficient; do not introduce tab roles without keyboard
tab behavior. History is a separate disclosure within the selected stream.

## Visible behavior and permissions

| Mode | Translation | Notes |
| --- | --- | --- |
| Student | Own editable draft, automatic save plus Save now | Read |
| Active child practice | Editable draft; “Helping as [parent label]”/existing child context remains explicit | Read; no staff controls even for a parent who is also a tutor |
| Parent | Read-only saved translation; explicit cleared/never-started state | Read |
| Assigned tutor/admin | Read-only saved student translation | Explicit “Add student-visible note” form and submit |

Use plain React text nodes, `white-space: pre-wrap`, wrapping long words and bidi
isolation for reference/author labels. Textareas use `dir="auto"` and a visible
verse-specific label; Hebrew content keeps its existing RTL/lang attributes. Do not
interpret HTML/Markdown or normalize user Unicode beyond server-compatible newline
normalization. Count UTF-8 bytes against 4096, report a labelled error before send,
and support composition/IME without saving halfway through a composition. Notes
must contain non-whitespace text. Empty translation is a real cleared version:
“Translation cleared · Saved”, distinct from “No translation saved yet”. Do not
append repeated empty versions when the saved value is already empty.

Keep reference English visually distinct from “My translation”; do not prefill it
as the student's draft or imply the student's work is JPS. A compact helper says
“Your tutor can read saved translations.” Notes say “Visible to the student and
their authorized readers” before staff submit, use the server's safe displayName,
role/mode, assisted marker and time, and offer no private/edit/delete/retract action.
The fallback `Portal member` is an intentional safe label; do not infer an email or
create a member-directory request. Staff correct a note by adding another note.

## One coordinator and two explicit save contracts

Keep a small work coordinator outside the conditional successful-text branch of
`AssignedStudyText`, so a temporary text-provider failure cannot unmount and lose
an in-progress editor. Scope it to the opaque session binding, mode, learner,
child-context ID (if any), kind and assignment ID/revision. Verse and stream complete
the operation key. Raw practice handles stay in the provider's mounted memory and
travel only in the existing header; they never become a cache key, URL or log.

Per verse keep separate values: last verified saved head/version; current editable
text; latest queued edit; and at most one immutable in-flight logical request
containing UUID, original assignment binding, expectedVersion and normalized text.
Freeze that request once dispatched. Editing while it is saving only replaces the
queued value. Do not mutate the body associated with an existing UUID. Bound memory
to the current assignment/visible work activity; do not prefetch full histories or
store drafts, receipts or handles in local/session storage, IndexedDB, a service
worker, analytics, console output or clipboard automatically.

For translations, after roughly 800 ms of idle input (and not during composition),
save the current queued value if the binding is verified, no request is unresolved
and it differs from the saved head. Save now/blur may flush immediately. Save now
does not manufacture a second request when one is already pending. On successful
acknowledgement, schedule the latest queued edit only when the acknowledged commit
is still the verified latest head. Its next logical request gets a fresh UUID and
uses that acknowledged version. Staff notes use the same stream/version/receipt
rules but only explicit submit, with a deliberate second submit after conflicts;
they never autosubmit queued typing.

| State | Honest copy and available action |
| --- | --- |
| Pristine | “No translation saved yet”, or the saved version/time; no write on opening |
| Changed, queued | “Not saved yet”; editable, Save now available |
| In flight | “Saving…”; keep typing into the queued edit, no parallel write for this verse/stream |
| Confirmed latest | “Saved”; only when the displayed editable value equals the acknowledged/current head and no queued change remains |
| Confirmed earlier commit, newer head | “An earlier save succeeded. A newer version is saved”; enter comparison/conflict state |
| CAS conflict | “Another version was saved. Review before saving yours”; show current saved text beside/below retained unsent text |
| Unknown outcome | “Save not confirmed. Your text is still in this tab”; Check save / Retry the same save; freeze dispatch of later edits |
| Definite validation rejection | “Not saved” plus the field error; retain local text for correction |
| Work unavailable on read | “Saved work unavailable”; Retry work; do not show an old head as current or enable new saves without a verified baseline |
| Authority lost | Clear work/history/notes/local drafts immediately; use the existing access-changed/sign-in state |

Abort, timeout, transport failure, malformed/truncated reply and 503 after dispatch
are unknown outcomes, not proof of rollback. Do not label them “Saved” or “Failed to
save” and do not send a fresh UUID for the uncertain edit. A 409 JSON response must
distinguish `conflict` from `stale-revision`; the existing generic API helper drops
that distinction, so the new work transport parses its closed result DTO itself.

Recovery always uses the current authorized assignment binding. Receipt 200 proves
the original committedVersion, not that its text is the current head. Load the
current work head; if currentLatestVersion is newer, preserve the local staged edit
and require explicit comparison. Receipt 404 alone proves neither non-commit nor
continued authority. Revalidate the current work scope, then allow only the original
UUID/body POST retry while that original binding remains current. If that binding
has changed, never rewrite the uncertain request to the new revision/context.
An identical retry's acknowledged receipt resolves the original operation safely.

Conflict recovery has two explicit choices: “Use the saved version” discards the
local staged text after confirmation; “Continue with my text” preserves it for
manual revision and a separate Save action against the freshly reviewed version.
The comparison states what will be replaced. No automatic rebase, merge, note
resubmit or overwrite, even when texts happen to look similar. Refreshing a saved
head never replaces a dirty textarea. Histories remain read-only; copying old text
into the editor requires an explicit action and later save, never a restore call.

## Lifecycle and departure safety

Extend the existing provider lifecycle narrowly with registered work activity:
suspend/cancel debounces synchronously when checking begins; invalidate all content
when scope/authority changes; await tracked mutation outcomes before the same-session
reload completes; and ask a registered departure guard before controlled transitions.
The ReadingPanel reload promise must now encompass metadata, selected study text,
current work pages and receipt recovery. Do not reveal the retained subtree after
metadata alone. Existing hidden/inert behavior stays in force.

On focus/visible/pageshow, pause new dispatch immediately. Keep staged values hidden
in memory only while checking the same stable session/context/assignment. Await
already-started client mutation promises through their bounded timeout; an aborted
request becomes unknown because server completion may still occur. Revalidate
assignment metadata, text and work, reconcile receipts, then reveal either a usable
current editor or a clearly frozen unknown/conflict/unavailable panel. A request
still labelled Saving cannot outlive that barrier. Missing upstream text may show
its existing unavailable state, but does not erase staged work for an otherwise
verified same binding; expose recovery without asserting text-provider success.

Every read/mutation captures its full scope plus a request generation and operation
UUID. Fence all completions against the current scope/generation and latest matching
operation before changing state, including late error handlers. Provider pause can
discard a mutation response from its old generation; recover by its retained UUID
after revalidation. Session replacement, denied scope, child switch/exit/expiry,
student/role/kind or assignment change clears the old coordinator, debounces,
projections and late callbacks immediately. Never transfer queued text into the new
learner or assignment. If assignment drift is detected externally, explain that the
previous assignment's unsent edits were cleared; an uncertain earlier operation
may still have committed under its original assignment. Do not claim its absence.

For app-controlled changes (child selection/exit, student/role selection, reading
kind/page, assignment confirmation and workspace/account links), run a small
registered departure guard before the existing action, without changing authority
or navigation until the choice is settled. A local kind/text-page change may retain
the same mounted verse coordinator, but still guards unresolved work before hiding
its panel. One accessible inline review/dialog provides:

- Known unsent edit: Keep working; Save and continue; explicitly Discard unsent edits
  and continue. A failed/conflicting save does not continue automatically.
- Saving: wait for its bounded outcome, then use the saved/conflict/unknown choices.
- Unknown: Check save and continue; Keep working; explicitly Leave without confirming.
  The last choice explains that the request may have saved and that this tab's
  unsent/queued text will be discarded. It never retries under the next child.

Forced authority/context expiry bypasses the guard and clears immediately. Never
delay sign-out, revocation or privacy clearing to preserve an edit. For external
full-page navigation/reload/tab close, register the browser's native beforeunload
warning only while unsent or uncertain work exists. Do not use sendBeacon/unload
saves or claim the browser guarantees a prompt or delivery.

Known limitation to disclose in helper/recovery copy and acceptance: a bounded
App Router change cannot reliably cancel arbitrary browser Back/Forward, process
termination or all outside navigation. Controlled app links are guarded; unexpected
route/context loss clears memory, fences responses and retains only a non-sensitive
notice that unsent work was discarded / a save was unconfirmed. The app cannot
restore lost tab memory after reload or close. Do not build a global router/history
interceptor or durable draft store in this slice. This is an explicit limitation,
not a promise of lossless autosave.

## Existing API mapping and bounds

Use `/api/students/:id/work` and its literal `history`, `receipt`, `draft`, `note`
subpaths. GET binding is mode/kind/current assignment ID/revision; POST additionally
carries verseRef, text, expectedVersion and mutationId. No client actor, author,
visibility, tenant or context ID fields are sent. The provider injects the active
child handle only after matching learner/context, as it does for study reads.

Work pages contain at most ten verses and may end earlier for the 256 KiB byte cap;
honor returned nextOffset and exact canonical refs rather than incrementing by ten.
Study pages remain their existing up-to-100-verse/eight-chapter pages. Initially load
work at the current study offset; opening tools for an uncached verse loads work
starting at that verse's canonical assignment ordinal. Do not eagerly fetch all
work on a long text page. Cache only bounded current-scope pages, never evict staged
or unresolved requests without the departure choice. If retaining another page
would exceed the small in-memory page budget, require save/discard/recovery first.

Each verse history request fetches at most twenty versions and follows the exclusive
`nextBeforeVersion` cursor; current head lookups are not history pagination. Versions
are per learner/verse/stream across assignment revisions. Display original assignment
revision and distinguish “Saved under an earlier assignment” when applicable.
Removed verses cannot be queried through old history/receipts; re-added verses may
show their retained work. Notes from revoked staff remain labelled and visible to
currently authorized readers. Do not filter history to current revision or invent
another list of removed verses.

The client transport has a 256 KiB bounded streaming reader, same-origin credentials,
no-store/referrer safeguards, fixed deadlines and strict closed DTO parsers matching
the accepted endpoints. Unlike licensed study text, draft text accepts the backend's
Unicode/whitespace contract; do not reuse the study parser's NFC/nonempty rules.
Parse actual adaptive offsets, full positive int32 versions/revisions, the absent
draft versus empty clear, safe author shape, timestamps and exact requested scope.
No study/public-cache/provider changes are needed.

## Minimum implementation ownership after approval

One bounded frontend worker owns new `workspace/work/api.ts`, `coordinator.ts`,
`verse-tools.tsx`, `history.tsx` and a small departure review component (split only
when it keeps responsibilities clear). The same worker owns narrowly required
integration in `study/view.tsx`, `reading.tsx`, `provider.tsx` and scoped work rules in
`src/app/globals.css`. Provider work wrappers, lifecycle/departure registration and
the ReadingPanel completion barrier are the only shared orchestration additions.
Targeted selector/role-navigation call sites may need to use the same departure
guard; name them in the implementation brief after tracing current handlers. Avoid
unrelated admin UI changes and preserve concurrent work. No runtime/schema/source
server edits are planned. Existing backend fixtures already compose the service.

Focused new unit files cover DTO bounds/closed shapes, coordinator transitions,
operation UUID retention, composition-aware debounce and stale-scope fencing. Add
one actual SDK/PostgreSQL HTTP-browser suite for this flow; reuse existing fixtures
and real API dispatch rather than replacing auth or fabricating successful work
responses. Update DESIGN/workspace inventory and a short UI return/finish record
only after implementation and independent finish review, not as an approval claim
in this design-only assignment.

## Acceptance before root integration

1. Student and active-child draft writes/read-only parent/staff draft views and staff
   explicit student-visible note writes work through actual SDK cookies and PG.
   Assisted attribution and safe author fallback remain visible; child mode exposes
   no staff role union. HTML-looking text, Hebrew, emoji, whitespace, empty clear,
   byte bounds and IME do not mutate display content or execute markup.
2. Debounce plus rapid typing yields one in-flight request and the latest queued
   value. Hold a real POST reply after `route.fetch()` has committed, time it out,
   resolve through receipt/same-UUID retry and prove one PG version/audit. A later
   real version before recovery yields committed-versus-latest comparison without
   clobbering the textarea or automatically issuing a new write. Two-tab same-base
   contention exposes conflict; explicit review is required before another save.
3. Hold work/text reads and writes independently across focus/pageshow/visible
   return. Workspace stays hidden until mutation settlement/recovery and current
   metadata/text/work checks finish; unknown stays honestly labelled and frozen.
   Session replacement, expiry, link/grant revocation, child switch and assignment
   replacement clear old content immediately and fence late success/error replies.
4. Exercise controlled leave with known unsent, saving and unknown states; cancel
   keeps the correct verse; successful save permits departure; explicit discard or
   unconfirmed leave never sends old text under the next child. Verify fallback
   notice on unexpected in-app history navigation and native unload registration,
   without claiming control over browser termination or persistent recovery.
5. Exercise adaptive work-page sizes, a study page with over ten verses, twenty-plus
   history versions, original assignment labels, remove/re-add visibility and text
   provider unavailability while staged work exists. No unbounded history fetch or
   local browser persistence. Sensitive response bodies/handles never enter logs.
6. Capture one batched desktop/390×844 phone set for student editing, read-only
   parent, staff student-visible note and conflict/unknown. Verify keyboard/focus
   restoration, labelled validation/status, zoom/reflow, mixed direction, wrapping
   and first complete Hebrew text range inside the initial phone viewport after
   fonts settle. Run the mechanical detector once over changed UI; independent
   finish review permits one bounded fix batch and confirmation capture pass.

Root owns independent auth/tenancy/lifecycle review, broader tests/build/CI and
integration. Existing backend PG 15/15 and SQL 6/6 evidence is reused unless server
code or schema changes; this plan schedules only the new UI/browser evidence.
No product-policy decision is reopened. Astra approved this composition and bounded
departure limitation: guard controlled transitions, keep forced privacy clearing
immediate, use existing context labels, and retain the coordinator outside transient
text-success rendering. No global router rewrite or persistent draft storage.
