# Selected-word backend checkpoint

This slice adds the closed `study-word-details/v1` contract, one selected-word producer, and an authorized GET endpoint. Occurrence meaning and factual grammar stay separate from dictionary senses. The client must bind results to its independently projected actual Hebrew reading text, hash, canonical word vector, verse and index. No transliteration or guessed roots are exposed.

The service composes the unchanged study service's first and final authorization around text and public STEP work, including warm-cache reads. One module-scoped public source factory performs no constructor I/O and caches no actor or authorized result. The HTTP boundary accepts a strict selection and explicitly projects a private/no-store response capped at32KiB. Two existing fixtures gained only actual-service wiring with fixed offline source stubs. Auth, tenancy, source/parser, numeric syllable delivery and frontend source remain unchanged.

Canonical reconstruction and bounds holds return unavailable with no invented hash/count and no STEP I/O. Only a syntactically invalid index or an index outside a ready, proved canonical vector is invalid-request. Exact whole-verse ordered correspondence remains required; no repeated-word fallback or forced divine-name correspondence was added.

## Verification

- Author selected-word checks16/16 passed. Composed with unchanged word-aid/grammar checks:55/55 passed.
- A different Sol independently accepted the frozen implementation:19/19 passed on first execution, using actual SDK/PGlite HTTP authorization and invented source bytes. It covers revocation while source work is held, final authorization with warm public facts, sibling/context changes, original session expiry despite a replacement cookie, grant/student/assignment drift, abort, concurrent selected indices, strict methods/query/projection and malformed/bounded DTOs.
- Final typecheck, diff checks and repository protection/isolation6/6 passed. Root reviewed the producer, immutable client parser, request-local service, runtime composition and explicit HTTP projection without a blocker.
- Initial author fixture and typing failures were corrected before freeze: inconsistent independently computed text binding, an NFD example that was already NFC, and projection/readonly fixture typing. Failed logs remain ignored; no check was weakened. The independent execution required no repairs.

This is a local internal backend checkpoint. Full hosted CI, production delivery, actual source usability and a student interface are not claimed. Current direct-playback release testing is separate: a640f88 encountered a unit fixture synchronization race and remains held; never treat its failed CI as acceptance for this backend. Source delivery75d4818's earlier CI was canceled, not passed. The eventual composed release must pass the complete required exact gate.

## Next action

After the main-reading correction is released, implement the optional secondary panel described in [the word-tools design](../../superpowers/specs/2026-10-17-main-reading-word-tools-design.md). Clicking main Hebrew continues to hear it; automatic playback highlighting never opens or changes the study panel. The full study scope still includes commentary/source assignments, additional dictionary/cross-reference tools and translation editions; this selected-word foundation does not claim those are complete.

No native browser, live source fetch, provider operation, migration, real roster import, mail, new spend or production action occurred in this slice. Generated voices and student recordings remain parked.
