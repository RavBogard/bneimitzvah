# Independent reading assignment review â€” 2026-10-18

Scope is the staff assignment editor in [DIRECTION.md](DIRECTION.md): automatic date suggestions, one Passage selector, canonical range controls, folded advanced references and Hebrew preview. Existing auth, study and release contracts remain binding.

## Source review

The reviewed implementation requests the existing read-only `reading/prepare` operation only for an actually open, unconcealed editor. Its result is bound to session identity, workspace epoch, student/revision/date, reading kind and current assignment identity/revision. A separate generation plus effect cleanup and visible-state guard reject delayed responses. Suggestion state cannot expose a confirmation binding.

Custom selection stays primary. Choosing a calendar option only stages that explicit choice; it requires Review reading and Confirm assigned reading. Canonical book/chapter/verse controls derive their limits from the existing catalog. Multiple manual ranges remain ordered and disable the single-passage controls rather than flattening them.

Confirmed Torah assignments initialize the existing cut-only draft path. The signed server review still owns exact ranges, cuts and provenance. Editing references leaves cut-only mode. Existing conflict, uncertain-save recovery and protected pending-dialog behavior are retained. No new server authorization, provider or schema surface was added.

No source blocker found. Final author commit `c82d53d` was independently reviewed, including the single Passage selector, folded source details and affected test changes. Existing conflict, uncertain-write, pending-modal and privacy assertions were retained; preview tests separately count automatic kind suggestion reads and prohibit prepared mutation attempts.

## Verification

- Independent helper tests: **2 passed**, including dependent endpoint changes across every canonical Tanakh book/chapter and rejection of multi-range/invalid/foreign-kind single-passage conversion.
- TypeScript check passed with the independent browser suite present.
- Independent browser suite prepared for hidden/open automatic suggestions with no save, native keyboard selection, late kind/closed-editor responses, multi-range cut-only confirmation preserving provenance, and actual SDK expiry during a delayed suggestion.
- Native harness prepared in ignored `.local-logs/reading-assignment-native.mjs`. It uses an owned random disposable WSL cluster on 55447, probes 55447 and 3187 before starting, uses `isolatedEnv`, verifies root's accepted source freeze before/after and retains only synthetic screenshot/log output in ignored paths. It cannot run without root's accepted freeze manifest.
- Root-authorized frozen native browser lane: **40/40 passed across 7 suites** in 238 seconds, including all 4 independent checks and 36 original reading, preview, modal privacy, service modal privacy, service learning and study cases. The tested source was author commit `c82d53d` plus the independent tests, fenced by root's accepted source manifest. Full log: ignored `.local-logs/reading-assignment-native-5f36ed5411449db9.log`.
- The lane preserved original actual relationship-revocation, session-expiry, conflict, uncertain-save, pending-modal and unchanged-assignment assertions. Initial automatic reads, selecting an optional calendar passage and keyboard passage selection made no assignment write; only final confirmation saved the independent cut-only case.
- Native cleanup succeeded: owned WSL cluster stopped and its verified random path removed; Windows 55447/3187 probes were clear, WSL 55447 listener absent, and all accepted source hashes matched after the run. No other process or cluster was stopped.
- Existing vendored Havarot source-map warnings were emitted for missing `.js.map` files. They did not cause a failed test; the full warning output is retained in the log.

## Visual finish

One synthetic capture batch produced eight images in ignored `.impeccable/review/`, named `reading-assignment-{initial,review}-{desktop,phone}-{light,dark}.png`. All eight were inspected directly at 1440×1000 and 390×844.

The current date and suggested portion are immediately readable; the single Passage selector and canonical endpoint controls have clear labels and comfortable targets. Phone controls form two columns and wrap without horizontal overflow. Advanced references and optional Hebrew preview remain secondary. The staged review exposes exact references, verse count, boundary status and the explicit confirm action, with detailed calendar provenance available through disclosure. Light and dark contrast remain consistent with the existing interface. The fixed close control remains clear in both layouts.

No visual blocker or corrective implementation round was needed. This accepts the bounded local editor finish; root owns final integration. This review does not authorize publishing or claim hosted CI, deployment, real-source acceptance or Daniel's acceptance.
