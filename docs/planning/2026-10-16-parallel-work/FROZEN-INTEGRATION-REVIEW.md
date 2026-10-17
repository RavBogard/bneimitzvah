# Independent frozen integration review — 2026-10-16

**Accept the bounded source and guard integration through `13379f5f296dcd837b72c38a078baf5d1d763202`, with exact-tree browser and broader integration gates pending.** One concrete P2 accessibility regression was found and repaired; the independent rendered re-probe accepts the repair. This is not student-visible release, production, provider, model, private-audio, G1/G2/G3 or new-screen approval.

## Scope and frozen identity

- UI reviewed as Git objects `25accb7..f345972c3af0abda94bc5329084903087368449d`; note-only follow-up `5968f2d6fac71073087d9c045c26e771b450f4a8`.
- Accepted voice checkpoint `24778d30953ab73ed1e623ab3030b018b09d67e4`, coordination-only follow-up `2f8119b67c854ac79aeca66d72ec98c4ea3691f1`.
- Combined tree reviewed in `C:/Users/dsbog/.codex/worktrees/recording-core/bneimitzvah`, branch `codex/frozen-stream-integration`. Union correction `c5a0a4e9dbfc0bdb346774f4dc7cdbc48992411c`; semantic correction `b037c619b6ea45cf103175a3f40d9a7b9f8830fe`; readonly synthetic-fixture typing correction `8440e8ef3a2e3eb4f44df554f0b6ea23b98582fb`.
- `git merge-base --is-ancestor 97f0977 HEAD` returned 1: the newer word-review/proposer checkpoint is excluded. No acceptance of it is claimed.
- Read CLAUDE, kickoff MISSION/STATE, current coordination, and Impeccable technical-audit guidance. Latest Song session direction governs this review. Existing independent recording, decoded-guard and accepted voice evidence is reused for identical source; this was not a whole-project audit.
- UI checkout had subsequent uncommitted provider/students/tutor-route changes at observation. They were not read as the frozen implementation, changed, staged or reviewed here. Both live Claude checkouts remained read-only.

## Finding and disposition

**P2, corrected and accepted: colored reading words referenced missing phrase descriptions.** In frozen `study/annotations.tsx`, `StudyHebrew` emitted `aria-describedby="<group>-<verse>-phrase-<number>"`, while `AnnotatedStudyVerse` no longer mounted `PhraseLegend`. The reading list therefore lost its textual phrase-family equivalent for assistive technology. The lifted dialog already mounted a valid legend.

Independent React SSR of the exact frozen component blobs produced two descriptions and two unresolved references in the synthetic reading card; the lifted dialog's two descriptions resolved. The author restored `PhraseLegend` in an `sr-only` wrapper at `b037c61`, preserving visible layout. A separate semantic regression test covers resolved, nonempty descriptions, colors-off behavior and simultaneous list/dialog IDs.

Independent re-probe at `8440e8e`: list 2/2 and lift 2/2 descriptions resolve; all IDs across the simultaneous card/dialog are unique. No remaining source blocker was found in the assigned surface.

## Authority, privacy, unsent work and reading correctness

- Frozen provider/student changes alter presentation and single-role navigation visibility; they do not change server role grants, child-practice handles, authority revalidation or session binding. Existing hidden/inert checking boundaries remain. Reading loads retain abort/sequence/binding checks, and study clear/reload removes the lifted page together with stale text. This source inspection supplements existing adversarial boundary evidence; it is not a fresh browser proof of revocation.
- Unsent-work coordination, save recovery and departure guards remain. New preference and lift controls operate on presentation state; reading/edition/page transitions retain the existing guarded loading path. Frozen browser tests retain unknown-save/unsent-typing, sibling, late-response, revocation and storage/URL assertions.
- Eight independent runtime preference probes pass: distinct synthetic student scopes, no raw student ID in keys, defaults, change persistence, sibling isolation, returning-child persistence, storage-event invalidation and invalid-value fallback. Stored JSON contains only `colors`, `translation`, `size` with boolean/enum values. The FNV key is explicitly not an authorization or cryptographic boundary.
- The list and lift reuse `StudyHebrew` and the existing projection. Synthetic rendered probes confirm colored/plain text equality, explicit qere label, ketiv without read-word indexing, read-word indexes `0,1`, and trailing paragraph apparatus outside the Hebrew line. These are renderer probes with a controlled projection; they do not replace existing projection/normalization tests or real-text browser shaping evidence.
- Lift uses a native labelled modal dialog, explicit close control, Escape cancellation and focus restoration to its opening control. Its key handler preserves native Enter/Space activation on buttons; phrase/page keys call the same navigation functions. Source logic is appropriate, but actual keyboard/focus behavior requires the pending browser run.

## Combined private-record, font and private-path union

The combined policy has one `privateBenchmarkProblem(text, data)` invocation. It preserves decoded nested/escaped/BOM/line-record inspection and the inherited malformed-literal rule without duplicate voice reporting. Font inspection remains exact-pin-only and pair checking is per family in candidate and index views. Both Bricolage and Noto bytes, notices, provenance and exact `-text` attributes moved together.

Identical Git blobs establish the reused boundaries:

| Source | Combined blob | Identical accepted source |
| --- | --- | --- |
| `scripts/private-benchmark-policy.mjs` | `80a4753aff372c45cd8c81ef7e7813d83aa2cb83` | `cbee044` guard |
| `scripts/font-assets.mjs` | `689d1c7ec08d3f8a5b6ba8a0c6183dd30c89a4cc` | `f345972` frozen UI |
| `scripts/private-paths.mjs` | `73b0cd6668137c713706adb5a1b9ed540b07cdc2` | `24778d3` accepted voice |

Combined `scripts/repo-policy.mjs` blob is `7dfbe921f0eaeb5aa7522598f05fe72eaef7779f`. Voice benchmark/retime/private-path files have no diff from `24778d3`. The earlier [guard integration review](GUARD-INTEGRATION-REVIEW.md) and [decoded guard review](PRIVATE-BENCHMARK-GUARD-REVIEW.md) remain the accepted evidence for their wider adversarial cases and documented scanner limits.

**23 independent union probes pass** against the actual combined imports: escaped-schema, nested/BOM and separate valid line records at admitted engine/fixture and both font-notice paths; exactly one private-record reason per tested case; all four asset pins; harmless source declaration; path-only attachment rejection; repository root/nonexistent descendant rejection; fresh outside destination acceptance; junction into a repository and junction escaping a repository both rejected. No private input was read or generated. These complement, rather than duplicate, the accepted candidate/index suite.

## Impeccable technical audit interpretation

One detector run covered the frozen changed CSS/reading/preferences/annotations/lift/view surface, using copied frozen project design/config context. Raw output is ignored `.local-logs/frozen-ui-review/detector.json` (22,376 bytes); stderr was empty. Result: **38 advisories, zero primary findings** — 33 documented-type-ramp size mismatches and five radius mismatches. Context inspection identifies stylesheet/design-document drift; none establishes a functional defect or justifies new polishing in this milestone.

Source positives: explicit names and pressed states, native buttons/dialog/popover, Hebrew direction and font class, constrained scrollable lift stage, pointer cancellation, touch scrolling and reduced-motion alternatives. The detector is static regex analysis. It does not prove contrast, clipping, Hebrew shaping, touch gestures, focus movement, scrolling or 200% layout. A numerical visual-health score would overstate this evidence and is intentionally not assigned.

## Keyboard and phone gates still pending execution

The original frozen workspace test replaced its old summary/Enter behavior with only a Tab-to-Start assertion. That was a verification regression, not proof of broken Start behavior. Integration now asserts Tab reaches Start, Enter opens the expected `Genesis 1:1` dialog, Escape removes it, and focus returns to Start. Source review accepts this behavioral correction; all later sibling/revocation/late-response assertions remain.

The phone gate remains **390×844, scrollY 0, first Hebrew bottom at or above 820px**, with reference/aliyah marker ordering preserved. The 200% check remains document horizontal-overflow testing; it alone does not prove all controls and long text remain usable.

**Standard/Huge long-verse browser evidence is not yet available in this review.** UI handoff explicitly lacked it because its fixture used one-word verses. The integrator is adding synthetic long-verse fixture/captures and will run the owned isolated browser lane. Author/browser captures and exact final-tree broader checks remain required; screenshots of one-word text and source assertions are not substitutes. Root will inspect actual captures. This reviewer launched no browser, DB or server and did not interact with occupied port 3187 or another stream's fixture.

**Follow-up source review at `13379f5`: accepted test changes, browser execution pending.** The new helper repeats invented Hebrew syllables 12 times and includes synthetic ketiv/qere plus paragraph apparatus; it copies no passage. The test reuses the existing authorized student tab, requests the synthetic long page, selects Standard then Huge, waits for fonts, requires more than two rendered text-line tops and 390×844/no document horizontal overflow, compares exact list/lift text, checks dialog horizontal overflow and captures each list/lift size. It asserts Tab→Start, Enter→expected dialog, Escape→closed and Start focus restoration. A finally block restores fixture mode, size and text. No authority or strict 820px assertion is removed. These assertions meaningfully cover the requested test gap; scroll-to-final-word usability, real-script shaping and visual legibility still require capture/runtime inspection. The patch changes tests/helper only, so it does not invalidate the source SSR/guard probes above.

## Independent commands and reproducibility

Run from the original checkout unless noted; all probe artifacts are ignored under `.local-logs/frozen-ui-review/`:

```powershell
node .local-logs/frozen-ui-review/probe.cjs
node .local-logs/frozen-ui-review/prefs-probe.cjs
node .local-logs/frozen-ui-review/union-probe.mjs
$env:REVIEW_REF='8440e8e'
$env:REVIEW_REPO='C:/Users/dsbog/.codex/worktrees/recording-core/bneimitzvah'
node .local-logs/frozen-ui-review/probe.cjs
Remove-Item Env:REVIEW_REF
Remove-Item Env:REVIEW_REPO
```

Detector command, run once from the copied frozen snapshot:

```powershell
& C:/Users/dsbog/.agents/skills/impeccable/scripts/impeccable.cmd detect --json src/app/globals.css src/components/portal/workspace/reading.tsx src/components/portal/workspace/reading-toolbar.tsx src/components/portal/workspace/reading-prefs.ts src/components/portal/workspace/study/annotations.tsx src/components/portal/workspace/study/annotations.module.css src/components/portal/workspace/study/view.tsx src/components/portal/workspace/study/lift.tsx
```

Initial probe setup hit the installed TypeScript 7 version-only runtime export; the harness uses existing Next SWC instead, with no dependency installation. An initial union vector used a schema outside the protected family and was corrected to the supported human-reference family. Neither was an application failure. Final probe outcomes above are from successful runs. This report does not claim the author's full suites, hosted CI or browser checks as independently executed evidence.

**Next action:** author completes the coordinated exact-tree browser and integration checks; root inspects long-verse captures and final integration. No source changes or publication are queued by this reviewer.

## Final vertical-usability test follow-up — `178992f`

**Source-only acceptance extends through `178992fba250786e0e0eea6d95550be2776d6e48`.** This test-only addition preserves the first indexed word's top ≥ 0 and bottom ≤ 820px at both Standard and Huge on the existing 390×844 viewport. The existing strict first-Hebrew gate remains unchanged. Huge must produce actual vertical stage overflow; the test then scrolls that stage to its end, selects the final indexed read word (the synthetic final qere), and requires its complete rectangle to fit inside the intersection of the stage and dialog, with only a 1px bottom/right rounding allowance. It saves an additional `huge-lift-end.png` capture before the existing Escape and Start-focus assertions.

The added assertions meaningfully test vertical reachability rather than relying on `toBeVisible()` alone. They use synthetic text and add no product, fixture-authority or release changes. This review inspected the exact commit diff only: no browser, suite or detector was rerun. Passing execution, font shaping, readable emphasis and actual capture inspection remain pending the coordinated author/root lane; programmatic scroll reachability does not independently establish touch-gesture usability.

## Scroll-target correction — `c9668f8`

**Accept the narrow test-only correction at `c9668f80948837d65ff5335d4920cc4d33014196`.** The author reports the initial targeted browser run as 7/8: all three workspace cases and four prior study cases passed; the new Huge assertion failed because scrolling to the stage's maximum went beyond the final Hebrew word into trailing apparatus and the 13-item phrase legend. This is recorded as a failed test run, not silently counted as passed.

The exact correction changes only the scroll target. Inside `.lift-stage`, it finds the actual final `[data-word-index]` element and adds the difference between that word's vertical center and the stage's vertical center to this stage's `scrollTop`. It does not scroll the page or remove content. The real vertical-overflow requirement and subsequent complete word-rectangle containment inside stage∩dialog remain byte-for-byte unchanged, as do 820px, Standard/Huge, text equality, keyboard/focus and security assertions. This corrects the probe's assumption about content ordering without relaxing its usability criterion.

Root reports inspecting the four initial Standard/Huge list/lift captures plus `huge-lift-end.png` and accepts the synthetic phone layout and final qere-word reachability; no further visual round is requested. That visual acceptance belongs to root, not this source-only reviewer. The coordinated confirmation browser run is still pending at this append. No independent browser, full suite, source edit or detector rerun occurred. A confirmation result must be recorded against the corrected tree before the targeted gate is called green; real-device touch usability and learner release remain outside this acceptance.

## Final reported author/root evidence

The author reports the corrected confirmation at `c9668f80948837d65ff5335d4920cc4d33014196` **passed 8/8 across two browser files in 63.52 seconds**, with exact server bytes restored and the owned temporary anchor login removed. Root visually accepted all five synthetic Standard/Huge phone captures, including the final Huge qere word. This closes the targeted pending browser/capture gate recorded above, on author execution and root visual inspection; **this reviewer did not independently rerun a browser or inspect those captures**.

The author also reports a root-requested Impeccable context/detector follow-up on the actual corrected surface: the same 38 advisories (33 type-ramp, five radius), zero primary findings. This is attributed author evidence, separate from the reviewer's earlier single frozen-snapshot detector run. No further source, tests, browser runs or visual rounds are requested by this report. These bounded checks do not grant learner, production, provider or generated-chant release approval.
