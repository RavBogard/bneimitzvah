# Progress UI design review — 2026-10-16

**Source review only; changes needed before integration acceptance.** Reviewed frozen UI `6398b3f30270177bf074dd937e28e039f2a1818f` through Git objects in the UI checkout, limited to its 11-file diff and targeted existing provider/practice semantics. Compared wire shapes and role rules against accepted backend `2689d94`. No moving UI files, source/test edits, browser/DB/heavy check, detector run or integration occurred. The reserved service-modal independent fixture remains the priority once its repair freezes.

## Contract alignment

The transport uses the accepted page/self-check/assessment endpoints, exact assignment ID/revision, selected mode and current child-context header. It validates closed bindings, row order, versions, stream/state and separate counts, and rejects mismatched response bindings. Student/child-practice controls select only self-check; tutor/admin controls select only assessment; parent is read-only. Both streams remain separate and the UI never infers assessment from self-check. Server authorization/CAS remain authoritative.

ProgressStore scopes cache to mode/student/child context ID and authority revision/current assignments. A changed scope clears state and aborts its controller. The provider's existing PracticeCoordinator generation fence rejects a response that crosses an access pause/context change, including adult modes. This is useful protection; this review does **not** recommend a new generic lifecycle registration layer to duplicate it. The reviewed browser file covers ordinary student/tutor writes, separate streams, clear-to-default and a conflict against another saved mark. It does not establish the ordering/privacy cases below.

## Consequential source findings

### 1. Unknown/conflict recovery is writable before verification, and failed recovery remains presented as current

`progress/store.ts` lines 94–102 restores the captured prior verse on write failure, publishes a notice saying the latest mark is shown, then deletes `pending` and emits before starting the authoritative GET. `progress/marks.tsx` disables handlers only while `pending`. Its unavailable message is shown only when no cached verse exists; a failed GET with a cached verse leaves that verse and its controls active.

Consequently, a committed POST whose response is lost can first show the old mark as if it were current, enable another intent while the recovery GET is held, and keep doing so if that GET fails. No automatic POST replay is present, and server CAS prevents an unauthorized or stale-version overwrite. This is a source-level stale-display/retry-readiness problem, **not an authorization bypass or proven browser failure**.

Minimal correction: distinguish an unverified/recovering verse from an acknowledged writable head; keep that verse non-writable through a successful authoritative reread, and show an honest unavailable/unknown state if the reread fails. Publish “latest mark” only after verification. Preserve one explicit intent at a time and never automatically replay POST. Avoid adding receipt/offline machinery absent from this backend slice.

### 2. Same-scope refresh can leave counts permanently behind a successful mark

`ReadingPanel.load` configures the store with the newly fetched baseline object (`reading.tsx:82`). For the same assignment scope, `ProgressStore.configure` retains the generation and cached state (`store.ts:31–35`). A page read skips a pending verse and declines to replace counts while any write is pending (`store.ts:63–68`). Write settlement then rereads only if `this.baseline === baseline`, an object-identity check (`store.ts:102`).

Concrete ordering to reproduce: hold a successful POST response **after the real server commit**; trigger local Refresh reading; allow fresh reading/text/progress GETs to finish for the same assignment while that POST response remains held; then release it. The refresh supplies a different baseline object with the same valid scope. Its progress page was skipped while pending, and the released receipt can update the mark while settlement skips its own GET because baseline identity changed. Existing counts can therefore remain old until another action. This sequence does not require stale server data and is separate from the provider's correctly enforced generation fence on access rechecks.

Minimal correction: bind the settlement reread to the current valid assignment/context generation rather than captured baseline object identity, or serialize this bounded refresh/write handoff equivalently. A late result from a different scope must still be ignored. No generic lifecycle layer is required merely to solve this race.

## Minimal uncovered verification

- Committed POST/lost response: hold recovery GET, then fail it; assert no second POST, honest uncertain/unavailable display, and no new write until authoritative heads are available. Restore GET and verify exact mark/version/counts; never resend the old intent.
- Conflict with delayed/failed GET: no premature “latest” assertion or stale writable head; eventual accepted result matches server state.
- Held successful POST plus same-assignment local refresh in the ordering above: assert current mark and both server-derived count streams reconcile, without a second POST.
- Child practice and overlapping roles: current selected mode determines stream, parent remains read-only, exact live child handle is sent, old-child requests cannot publish into the new context, and real expiry/revocation clears private marks with the rest of the reading.
- Same-authority conceal/resume and changed assignment: no retained response publishes from the prior generation; no automatic uncertain retry; current assignment/revision is re-read before controls resume. Include an independent tab and page/lift transition where useful rather than repeating the entire auth suite.
- Preserve existing keyboard, first-Hebrew phone and Standard/Huge scroll/containment gates when the added lift controls are integrated. Source inspection is not evidence of rendered fit or focus behavior.

No final runtime severity score, browser acceptance, hosted CI result or new source approval is asserted here. Root accepts the existing provider fence and the narrow recovery/re-read recommendations; the UI owner receives actionable feedback through root coordination. Service-modal privacy ownership remains reserved until its integrated source and exclusive fixture are ready.
