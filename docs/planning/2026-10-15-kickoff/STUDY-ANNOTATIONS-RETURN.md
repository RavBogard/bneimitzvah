# Assigned-reading phrase colors — implementation return, 2026-10-16

**Scope:** colors only. Daniel paused visible transliteration for reconsideration;
Astra removed its unnecessary engine extraction from this milestone. No publication,
audio generation or human release occurred. Root owns integration and review.

## Implemented contract

- `src/lib/hebrew/study-tokens.ts` projects the existing normalized Hebrew DTO.
  Exact display slices, ketiv/qere, paragraph gaps and inverted nun signs remain
  ordered. Zero-based reading indexes count qere, split maqaf and omit ketiv/signs.
  Source spans use segment-local NFC UTF-16 offsets. Both canonical text views must
  reconstruct before the projection is accepted.
- `src/lib/hebrew/study-annotations.ts` returns versioned word/token family and phrase
  metadata through synchronous `colorStudyVerse`. It follows the existing chart IDs
  and `trope/lib-trope.cjs` grouping without a runtime engine dependency. Ketiv and
  gap/sign pieces remain uncolored. Unsupported-system, bounds and reconstruction
  failures disable colors while leaving Hebrew/work available.
- The confirmed assignment's final canonical haftarah verse receives the haftarah
  ending, including excerpts. Page boundaries and Torah do not supply that ending.
  Psalms, Proverbs and Job are unavailable for this 21-book implementation.
- Bounds precede source mapping: 4,096 segments, 8 KiB cumulative raw display/read
  data and 512 lexical words. Unicode-only munach/paseq grouping cannot recover
  discarded bold/small markup. The help explains the vertical-divider convention
  and asks the learner to check unusual markings with their tutor.

## UI and lifecycle

`study/annotations.tsx` and its CSS module preserve the original Hebrew/English
composition. A native Reading aids disclosure follows each English reference. One
is open at a time; Color phrases defaults off. Only enabling a verse derives its
projection. Subsequent toggles retain canonical word indexes within that mount.
The ordered legend names families and their reading-word ranges; colored word
spans reference the corresponding legend item. The chart opens in a labelled new
browser tab. Hebrew font, 2rem/line-height 2 rules and touch-sized controls remain.

The narrow `study/view.tsx` integration keys only the reading article by session,
assignment binding, kind, page offset and canonical verse. Work remains its existing
sibling with its independent coordinator. No fetch, save, departure interception,
cache/schema change or browser persistence was added. The existing loading/error
barriers unmount the aids; refresh conservatively resets their preferences, including
same-session checks. No obsolete projection can survive that unmount.

## Deferred sources

Eight exact source/test paths and a manifest are preserved in ignored
`.local-logs/deferred-reading-phonetics-20261016/`. Legacy `trope/text.mjs` was restored
only at its exact owned path. The untracked pure-reading entries, engine tests and
hash fixture were moved into the archive; phonetic exports/tests were removed from
active app files. No phonetic import/chunk or HTTP harness engine copy is needed.
The archive contains sources/tests only, with no credentials or private payloads.

## Local evidence and remaining gates

- Focused color/projection tests: **10/10 pass**.
- `npx tsc --noEmit`: **passes** with UI and SDK browser cases present.
- One scoped Impeccable detector pass: exit 0, no primary findings. Its single
  advisory notes the 0.9375rem disclosure size, matching incumbent secondary controls.
  Report: `.local-logs/study-colors-detector.json`.
- SDK cases added to `tests/http-browser/study-ui.test.ts`: default-off/lazy behavior,
  text identity, canonical indexes through toggles, uncolored ketiv, ordered legend,
  one-open disclosures, Torah/haftarah finality, page reset, child/revocation clearing,
  and queued typing/unknown-save preservation. Capture targets are desktop,
  390×844 mobile and CSS-zoom-2 desktop enlargement. Root's actual SDK/PostgreSQL
  run passed **10/11**, including the new color/unknown-save cases. The remaining
  staff lifecycle case failed at a sixth magic-link sign-in, before its assertions.
- The pinned magic-link plugin supplies a five-request/60-second path rule, and
  the adapter assigns an origin-wide bucket. The new case increased sign-ins from
  five to six within the observed 36-second study suite. The log retained only a
  boolean status assertion, so it does not independently show the expected 429.
  The staff lifecycle case now reuses the initial real admin session, preserving
  its same-session and explicit expiry coverage. Future sign-in assertion failures
  show only the HTTP status. No authentication or throttle setting changed.
- Fresh source/visual review: **ship** within this bounded scope; see
  `STUDY-COLORS-REVIEW.md`. Desktop, phone and enlargement captures were inspected.
  The scoped workspace inventory is updated; global design tokens are unchanged.

Root integration, 2026-10-16: the repaired study suite passes **4/4** with the real
SDK/PostgreSQL fixture. The unchanged student-work suite passed **7/7** in the
initial affected run. Together all 11 affected cases are green; the original
failure is retained above as history. Full local integration passes **145 Node +
393 app tests (one existing skip)**, typecheck and production build. No app code
changed for the fixture repair. Logs: `.local-logs/study-colors-browser-repair.log`,
`study-colors-browser.log`, `study-colors-integration-tests.log` and
`study-colors-build.log`. Hosted exact-commit CI/deployment are the remaining gate.

Next: root publishes and checks exact-commit hosted CI/deployment.
No wider audit, PostgreSQL runner, remote service or spending was performed by this
implementer. Daniel-only review and existing audio/release gates remain.
