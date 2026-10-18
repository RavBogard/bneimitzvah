# Authenticated honoree link management

## Settled decisions (Daniel, binding)

Continue family honors and scoped honoree links within revised1.0. Only base guardian/admin may manage links; no tutor, student, practice or adult self-edit authority. Invitations/mail remain separate explicit actions, with none sent by these controls. Real blessing permission and exact notices/projector remain unresolved; no material approval or production mapping is inferred. Preserve Song session/code-first and the accepted family form/standalone guest page.

## Root architecture

Extend the existing honoree contract and landing spec, after the local integration of reviewed C314 into B at33990f9. C production release still awaits its own hosted gate. Backend owns service/HTTP/dispatcher and focused tests; frontend later owns new honors/honoree-api, honoree-owner, honoree-controls plus narrowly needed sheet/fields/CSS integration. Preserve shared changes and existing guest transport fences; no recursive delegation or global auth/design audit.

Activate only three exact POST management paths: /api/students/:studentId/honoree-links, /receipt and /status. Preserve current closed mutation/receipt intent; status accepts only mode/startVerse. No query parameters, GET/list API, aliases, client-supplied tenant/expiry/approval or SDK endpoints. Use trusted host/tenant resolution, existing strict cookie and Origin/fetch-site mutation boundary, base capabilities and bounded private/no-store/no-referrer JSON. Existing per-student original UUID, CAS/context checks, one-current-record semantics and permanent invalidation remain authoritative. Status reports a non-revoked record, never a claim that its credential is currently valid.

Existing private service methods must preserve their public result shape and current COMMIT barriers. Transport-specific adapters share the same single operation/authorization transaction and pair the DTO with an opaque synchronous assertReturnLive closure over immutable request binding and authenticated session expiry; a newly issued URL additionally retains its original absolute credential expiry and authoritative database/wall/monotonic anchor. No new public clock/authority field, second authorization/database read or async unwrap after the final barrier.

The HTTP layer checks the closure before serialization and binds it to the exact successful/conflict Response with private WeakMap metadata. After awaited runtime cleanup, a synchronous management-only finalizer checks original Response provenance, cancellation and the same captured expiry fence, then returns without another await. Known session/credential expiry during cleanup withholds output. This does not claim universal recall or eliminate authorization changes after the decision instant. Existing guest finalizer remains unchanged. A refusal after COMMIT does not undo committed rows or permit remint; receipts/replays return metadata only, never recovered plaintext.

## Management interaction contract

Keep a separate in-memory link owner, bound to one student/base session/mode; do not reuse or rotate honors save intents. Issue only from a clean saved reviewed current snapshot, known confirmed reading/slot/cuts and a nonempty exact saved group. Replacement requires an explicit confirmation and known recorded link; it invalidates the old credential. Revoke stays available for a known record even when reading review is stale, while avoiding conflicting in-flight/unknown operations. Server checks remain authoritative. Absent approved material produces honest unavailable behavior.

Show raw URL only for an original acknowledged result in a clearly labeled read-only field, with explicit Copy. No token-bearing href, persistence, automatic send/open/copy, analytics, logs or clipboard readback. Explain that full URLs cannot be recovered from status or receipts. An uncertain operation retains its exact immutable intent/UUID in memory; allow original receipt check or deliberate same-intent retry, never implicit fresh issue/replacement. An unconfirmed receipt stays uncertain. Clearing this state does not prove rollback or cancel a possibly committed action.

Concealment, departure, bfcache return, student/mode/session changes and disposal synchronously clear displayed URL and invalidate late work. Workspace pause/reload/quiet/departure hooks must cover the separate link owner; paused uncertain intent may remain in memory only for later reconciliation. Serialize link mutations versus form save/edit/review/printing, or invalidate their bound snapshot; no status reload may discard an honors draft or alter its UUID. Printing excludes links/secrets and still prints the verified saved form only. Preserve completed honors unknown-save/departure/quiet-return behavior.

Private management HTTP404 is ambiguous (for example unavailable material versus missing scope): clear management secrets and show local unavailable; do not claim it proves the entire family workspace lost authority. Actual401/403 still follow existing workspace authority failure handling, and the established honors owner retains its own authoritative revalidation/clear behavior. Never retain a URL on any denied management operation.

## Bounded acceptance and release

Focused backend tests cover exact private dispatch/CSRF/body/tenancy/mode boundaries, original UUID replay/lost response/no plaintext recovery, and after-COMMIT/runtime-cleanup session/credential expiry, clock movement, cancellation and Response provenance. Preserve existing guest and private form checks. Focused client tests cover saved-snapshot gating, stale record wording, revoke/replacement confirmation, uncertainty serialization, memory-only secret clearing and late copy/response suppression. Real browser/native checks are root-coordinated after a complete prototype; one bounded capture/detector/review/documentation cycle, no redesign.

Independent high-stakes review and exact hosted integration gates precede release. Dedicated0023 operator and real material permission/credits/projector remain separate requirements. No production SQL, real invitations/mail, prayer/audio acquisition, credentials, provider scopes or new spending is authorized by this design.

## Open items that wait on Daniel

Existing pending invited-honoree permission/required credits and adult self-edit policy remain unanswered; real material and adult self-edit stay unavailable. No repeated input or dashboard action is needed for this implementation.
