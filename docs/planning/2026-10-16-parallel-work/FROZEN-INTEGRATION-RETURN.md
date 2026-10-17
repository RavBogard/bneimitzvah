# Frozen UI and reviewed voice integration return

## Scope and refs

Owned checkout: `C:/Users/dsbog/.codex/worktrees/recording-core/bneimitzvah`, branch `codex/frozen-stream-integration`, starting at `d2fdea3`. The backend-only green branch remains at `472bff6ee2e10e94e26df466521acff85414d88c`; its history was not rewritten.

- UI `f345972` merged at `551cd11`; note-only follow-up `5968f2d` merged at `d0eff88`.
- Reviewed voice `24778d3` merged at `36f6898`; note-only follow-up `2f8119b` merged at `4b32e00`.
- New voice checkpoint `97f0977` is excluded. No moving source checkout was used as an integration input.
- Daniel's locked Song session direction governs the frozen student UI; older Annotated score text is historical.

No production/provider operation, application schema/import change, real audio/model run, new screen, staff redesign, worker push or deployment is part of this integration. Only synthetic test fixtures and their disposable local migrations are used. Root is authorized to publish the accepted review branch and run hosted CI; production/deployment remains held.

## Resolutions and corrections

The repository-policy merge retains `scripts/private-benchmark-policy.mjs` and exactly one call from `entryProblems`. Correction `c5a0a4e` removes the voice commit's duplicated schema literal and duplicated finding. The reviewed decoded JSON/BOM/nested/index protections and UI per-family font pairing remain effective. The UI's actual font registry, pinned asset, notice, provenance and attributes were merged together.

The sole Git conflict was `workspace-ui.test.ts`. The new first keyboard destination is Start. The merge preserves locator focus, Enter opening the practice dialog, Escape closing it and focus restoration to Start. A synthetic study loader provides real test text. All subsequent sibling, copied-URL, revocation, delayed-response, storage, role-navigation and late-exit assertions remain intact.

Independent review found a frozen UI accessibility defect: reading-list colored words referenced phrase descriptions that were no longer rendered. Root authorized the narrow fix `b037c61`: render the existing PhraseLegend inside the existing `sr-only` utility. It changes no visible layout or palette. Two SSR semantic regressions require every description to resolve uniquely alongside an open dialog and to disappear with colors disabled. `8440e8e` makes the synthetic client fixture type-correct. The independent reviewer accepts the corrected list/lift references, unique simultaneous IDs, exact Hebrew/qere/read-index preservation and apparatus placement.

Test-only `13379f5` adds a long verse made from repeated invented syllables, Standard/Huge phone wrapping, exact list/lift text, keyboard activation and focus restoration. Existing 390×844 / first-Hebrew-at-820px checks are unchanged. The initial student tab is reused to avoid adding sign-in rate-limit pressure.

Follow-up `178992f` additionally requires the first long-verse word to fit the unchanged 820px boundary at both sizes and verifies that the final Huge word is reachable within the usable scroll-stage/dialog bounds. It adds the bottom-of-stage capture `huge-lift-end.png`. These are test-only additions after the independently reviewed source correction.

The first targeted browser run was **7/8**, honestly retained in `frozen-browser-initial.log`: only the new final-word assertion failed. Maximum scroll went below the Hebrew into the trailing apparatus and 13-phrase legend. Independently accepted test-only `c9668f8` instead centers the actual final indexed/qere word using only the stage's `scrollTop`. It retains real vertical overflow, complete rectangle containment, text equality, 820px and keyboard/security assertions. No product/style change was needed.

## Verification

Dependencies were installed independently with `npm ci --no-audit --no-fund`; `node_modules` is a normal local directory, not a junction/shared install. `package-lock.json` is unchanged. Test and build children use `isolatedEnv.mjs`, with production/provider credentials absent. Logs and requested long-verse captures stay ignored under `.local-logs`; the existing browser suite's general captures stay ignored under `.impeccable/review`.

- Focused repository/font/private-path/voice checks: **64/64** pass, including private helper, candidate/index guard, font policy, private containment and synthetic alignment/DSP/CLI cases (`frozen-focused-node.log`).
- Focused recording checks: **92/92** pass (`frozen-focused-recording.log`).
- Phrase-accessibility checks: **2/2** pass (`frozen-phrase-accessibility.log`). Initial fixture-only failures (missing server-only mock and readonly segments) were corrected before final typecheck.
- Full Node gate: **185/185** pass (`frozen-full-node.log`).
- Typecheck and production build pass (`frozen-typecheck.log`, `frozen-build.log`).
- Full app gate: **779 passed, one existing skip**, 81 files, 296.77s (`frozen-full-app.log`).
- Corrected targeted browser confirmation: **8/8**, two files, 63.52s (`frozen-browser.log`), at source `c9668f8`. All workspace sibling/revocation/late-response/URL/storage and prior study cases pass alongside Standard/Huge long-verse and Start/Enter/Escape/focus tests. This is author-executed evidence, separate from the reviewer's source-only checks.
- Corrected-surface Impeccable context/detector pass: **38 advisories, zero primary findings**, matching the reviewer's frozen scan (33 type-ramp mismatches, five radius mismatches). Saved `frozen-impeccable-{context,detector}.json` and stderr files; no polishing or documentation redesign was performed.
- Final staged candidate/index repository guard and `git diff --check` pass (`frozen-final-repo-guard.log`). The accepted review and this return are included in the staged scan.

Independent combined guard/font/containment probes pass **23/23**. Independent review belongs to [FROZEN-INTEGRATION-REVIEW.md](FROZEN-INTEGRATION-REVIEW.md); the reviewer owns that file.

## Browser isolation and remaining gates

The ignored runner `.local-logs/frozen-browser-isolated.mjs` verifies free loopback port **3191** immediately before use, asserts the previously identified local disposable PostgreSQL cluster, creates a unique temporary anchor login, and lets the existing fixture generate its own database and restricted runtime roles. It restores the exact server source bytes and drops only its owned login in `finally`. It does not rotate a shared role password, reset a cluster or stop another process.

Both browser runs report **exact source bytes restored: true; owned anchor login removed: true**, and fixture cleanup returned successfully. The temporary port change is absent from the committed tree.

Requested synthetic phone captures are written under `.local-logs/frozen-longverse-review/` as `standard-reading.png`, `standard-lift.png`, `huge-reading.png`, `huge-lift.png` and `huge-lift-end.png`. Root inspected all five and accepts the synthetic phone layout and final read/qere word reachability. This visual inspection belongs to root; it is not an independent browser rerun or real-device touch proof.

Remaining gates: fresh hosted Windows/Linux/PostgreSQL/public and full authenticated browser CI for the exact combined commit, Daniel's screen/wording review and any later authorized release. The local browser pass covers the two affected files, not the entire browser suite. No Daniel approval, G1/G2/G3 approval, real-device touch proof or production release is claimed here. Root publishes the accepted review branch and watches exact-tree CI next; the worker does not push.
