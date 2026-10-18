# Claude UX return

Branch `claude/product-ux` in its own worktree (`C:/Users/dsbog/bneimitzvah-ux`), started from main `3f1c357`. Not pushed, merged or deployed: the integration stream owns that. No server, schema, auth, permission, token or provider change in any milestone below.

## 1. Reading assignment — UX-03, V03–V04 · commit `39364a4`

Reuses the undeployed candidate (`c82d53d`, `3c8fcb1`, `c590bc0`, cherry-picked with `-x`) and finishes the journey it left open.

- Ceremony date and service are shown in words and reused; the date's reading appears as "Suggested for this service" with its reason, or the existing honest fallback when the slot, holiday or calendar makes a suggestion unsafe.
- Every plain passage gets book / chapter / verse pickers; **Add another passage** and **Remove passage N** make multi-range selection ordinary. Typed references remain under Advanced and are never flattened.
- **Divide into aliyot (optional)** picks each aliyah start from the chosen verses and edits the same draft as the typed field. Divisions that no longer fit new verses are shown as a mismatch with **Start divisions again**; they are never dropped silently, because the server refuses them.
- One review lists ceremony, verses and count, aliyot, and what it **Replaces** (or "only the aliyah divisions" for a cut-only review). **Save assignment** then shows "Saved. The current reading above shows what the student will see."
- A reading flagged by a ceremony change shows a notice in the editor; nothing is replaced (V04).
- Recovery says what happened and offers one action, **Check what saved**. Uncertain saves still say they may have saved and never retry automatically.

## 2. Context and navigation — UX-02, UX-05, UX-06 (partial UX-01) · see branch log

- One product name, CRC Beit Mitzvah, on the entry page, titles and trope chart.
- The account page is titled "Your account"; each role link says what it is for; sign-out explains why to use it on a shared device; accepted invitations end with one **Continue**.
- Parents see "Read-only overview" and a named **Practice with [child]** action. In practice mode, the sibling switch now sits above the reading instead of below it.
- **Start** became **Practice up close** and the toolbar **Hear** became **Close-up**: both open the close-up, which may or may not have a released recording, so neither label promises audio.
- Not done: automatic continuation for single non-student roles. The portal privacy tests depend on the signed-in entry page, so this was left as a recorded choice rather than changed.

## 3. Predictable editing — UX-10 (roster) · see branch log

Student details now match lessons and honors. An unchanged form closes at once. A changed form asks **Keep editing** / **Discard changes** on X, Cancel, Escape and controlled navigation, and warns on page unload. After an unclear save the draft is not treated as unsaved: the existing "may have saved" message stays on the list.

## Verification

- Private disposable Postgres in WSL (port 56817) and the repo's isolated browser server. No shared database and no production data.
- Milestone 1: the reading browser files pass (7 files, 42 tests), plus unit tests for the selection helpers. New browser cases cover a two-passage assignment divided by pickers and saved exactly as reviewed, and a date-change flag that leaves the reading untouched.
- After milestones 2–3: the whole browser suite passes, all 40 files (one full run, then the files whose tests deliberately changed were rerun). The three files that need a production server ran after a local `npm run build`. `npm test` passes (engine 357, app 1,738), as do `npm run typecheck` and `npm run check:repo`.
- Updated browser tests follow only deliberate wording changes, plus the new roster rule: Escape on a typed draft now asks before discarding.
- Synthetic desktop and phone captures, light and dark, were inspected locally (ignored `.impeccable/review/`). This is Chromium emulation, not iPhone/Safari or VoiceOver acceptance.

## Dependencies and decisions for the integration owner / Daniel

- **Test wording:** the candidate's and main's browser tests were updated only where labels or copy deliberately changed. Conflicts are likely if `codex/reading-assignment-flow` is merged separately; take this branch's version.
- **Clearing a date-change flag:** a cut-only Torah review keeps `needsReview` by design. There is no ordinary "keep this reading" action that clears it. Adding one is a server-contract decision.
- **Single-role auto-continue (UX-01):** deferred, as described above.
