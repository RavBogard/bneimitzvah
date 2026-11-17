# Direct playback in the main reading

## Settled decisions (Daniel, binding)

Daniel rejected the separate lifted-player interaction on2026-10-17. Reference audio must play by clicking directly in the main text, in the spirit of TropeTrainer. Consecutive verses must read as a flowing block, so students learn their passage in context. Repeated blocking “Checking your access” screens on browser-tab return are unwanted. Preserve server authorization; change that disruptive client behavior. No transliteration, generated voices or student recording work.

The superseded lifted-guide experiment is preserved at local2b8cadf on codex/lifted-word-guide, including its unresolved native teardown defect. Do not merge it wholesale. Begin from accepted backend40d1d54; reuse only independently accepted foundations as appropriate.

## Main reading interaction

Use the incumbent visual system and main assigned-reading surface for all applicable roles, including Daniel's administrator view. Render consecutive Hebrew verses inline in a readable RTL block, with small actual verse-number/play controls. Preserve real chapter/paragraph/discontinuity/aliyah boundaries; do not fabricate continuity across gaps. Keep qere/ketiv, maqaf, colors-off, enlarged Hebrew and source credits correct. Translation and verse work/marks remain available without forcing the Hebrew into separate cards or losing draft buffers.

A canonical word click or keyboard equivalent is an explicit request to hear that word. Its first use performs authorization, source resolution, byte/hash/decode verification and play in one interaction; no manual Load step or modal is required. A verse control explicitly plays that verse. One shared inline transport shows the selected scope, Play/Pause, Repeat, speed and attribution. Source unavailable/timing holds must be clear: selecting a word without verified word timing must never silently play the whole verse. A browser gesture rejection may show a direct retry-play button, but do not make a second tap the normal designed flow. No audio on page visit, reload, tab return or automatic highlighting.

Maintain one active playback owner and bounded, latest-intent-wins authorization/load/seek/play transitions. New selection cancels obsolete work before late completion can play; actual student/context/session/assignment/page changes stop and dispose media. Backgrounding pauses and cancels pending playback without erasing the text; returning never resumes automatically. Same-verse word clicks reuse verified media. Avoid repeated full-file downloads when adjacent verses share an asset: propose a narrow one-asset verified-byte reuse seam, scoped to this reading/authority generation, keyed by exact immutable URL/digest/size; never cache permission, text, timing responses or an unverified object. Root reviews any controller/transport extension before it is added. Do not add a global/unbounded audio cache.

Retain optional close-up practice if useful, but it is no longer the required playback route. Start/Hear must act on the main reading. Audio ticks/repeats are not new practice visits. Syllable/grammar details are secondary tools; do not make a guide pop open on every audio word highlight.

## Quiet tab revalidation

Split quiet focus/pageshow/visibility-return checks from initial, route-changing and explicit full refresh. Coalesce event bursts. Keep the last authorized reading and scroll mounted during a quiet check; unchanged authority must not run clear-first reloaders. Do not merely hide the checking banner while reading loaders still clear the passage.

Session binding alone omits guardian/tutor/student relationships and assignment revisions. Verify currently registered reading metadata in its actual role/child context as well as the session, without committing it to UI first. An unchanged result retains DOM, drafts and scroll. Changed identity/authority, a real401/403/404, expired child context or changed reading scope triggers existing invalidation/blocking reconciliation. All server reads/writes, including both study authorization passes, remain unchanged. A transient network/503 failure may retain already loaded in-memory text; it grants no permission to a new server action and creates no offline/persistent cache.

**Integration correction:** assignment metadata changing under the same verified session, complete student record, mode and child context is a reconciliation event, not loss of authority. Preserve the existing work coordinator through its blocking refresh so unsent translations enter the existing explicit revision-review state. Quiet verification must distinguish this result from actual denial: session/mode/student/context drift or expiry clears immediately; a same-authority assignment change invokes blocking refresh without first clearing work, invalidating child selection or incrementing its epoch. Both outcomes retain the fresh trailing session check and stale-result fences. Actual denial still clears drafts; no draft is transferred to a different principal, student or context.

Quiet retention also covers a correctly bound, unexpired read-only preview and the rightful pending review/departure dialog. Focus alone no longer clears an unchanged review. Existing draft/baseline changes, explicit blocking refresh, actual denial and expiry still invalidate them. A held response is not known to be a denial until delivered; tests must prove terminal clearing after that actual result, rather than demand preknowledge. Preserve each existing write contract: client fresh-target preflight where present, and signed binding plus transactional stale-state refusal where present. Retaining a review grants no new write authority or automatic continuation.

Use a separate quiet request generation/inflight fence: starting a background check must not invalidate a concurrent write's outcome or abort a blocking refresh. Snapshot binding/path/current generation; ignore stale checks after route, child or identity changes. Retain exact child-context expiry timers and explicit sign-out cleanup. Never invent a session-expiry timer from a summary that carries no expiry. Hidden-tab audio pause belongs to media lifecycle, not wholesale workspace erasure.

## Ownership and gates

Sol A owns main text/annotations/layout, new shared inline playback host, optional legacy-player lifecycle and app/native playback tests. Sol B owns provider quiet revalidation, reading.tsx metadata-verification registration and separate quiet-refresh tests. B is sole editor of reading.tsx; A sends any Start/Hear toolbar changes for B to apply. Shared fixture changes must be coordinated explicitly. No recursive delegation, provider operations, schema/package changes, corpus, roster import or mail. Workers preserve each other's changes.

Root owns architecture, independent review of B's client authority changes, final integration and release. B independently reviews A's playback/authority lifecycle after its own source freezes; A may review B's source separately. Native browser evidence must cover immediate main-text word/verse play, keyboard, one playback owner, timing holds, bad bytes/hash, late intent/scope changes, colors/qere/maqaf and quiet focus with revocation/expiry enforcement. Follow Impeccable's craft floor; inspect complete desktop/phone together once, batch fixes, then at most one confirmation and one detector pass. No new visual-world choice or repeated context launch. Full required hosted checks precede deployment.

## Open items that wait on Daniel

None for these direct corrections. Real-device gesture behavior and source listening acceptance remain explicit evidence limits.
