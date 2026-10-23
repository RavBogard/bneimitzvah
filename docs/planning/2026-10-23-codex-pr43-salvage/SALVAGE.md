# Salvage record for Codex PR #43 (`codex/roster-release-coordination`)

Written 2026-10-23 on main at `85913c9`. Daniel ruled on 2026-10-23 to "Review and close now". This file records what the branch holds, what is already on main, what is worth keeping, and where it all lives. Nothing is copied into main and nothing is deleted; the branch stays on GitHub.

## What PR #43 is

- PR [#43](https://github.com/RavBogard/bneimitzvah/pull/43), opened 2026-10-23 with an empty body. Branch `codex/roster-release-coordination`, tip `5c663f8c36d3c39e2300cec46ad3c0b4722b959d`, 51 commits, all dated 2026-10-16 and 2026-10-17. Merge base with main is `d2fdea3`; main is now 516 commits long and has moved on a great deal.
- Title: "Save the independently reviewed frozen UI and voice integration with exact green hosted evidence and the remaining student review gate".
- Diff against its merge base: 56 files, +2,501 / -5. **It contains no application, engine or test code.** Every file is a planning record, spec or research note, or one of three small top-level files (`CLAUDE.md`, `PRODUCT.md`, `.gitignore`).
- Last hosted CI on record (2026-10-17): unit on Ubuntu and Windows passed, browser passed, `postgres` failed. That run is a week old and predates everything now on main; it says nothing about main.
- A plain merge would be harmful: it would write Codex-era versions of `CLAUDE.md`, `PRODUCT.md`, `MISSION.md` and `STATE.md` over text that has since moved on (see Contradictions). Not merging was right.

## Key finding: the "code" is already on main

The PR title says "frozen UI and voice integration". The code those words describe reached main through other Codex branches, which are now ancestors of main (checked with `git merge-base --is-ancestor`): `codex/student-recording-ledger` `f5b1721`, `codex/practice-calendar-integration` `1b18c68`, `codex/quiet-roster-import-current` `add56e7`, `codex/recording-ledger-integration`, `codex/roster-admin-release`, `codex/lesson-progress-integration`, `codex/editor-modal-integration`, `codex/frozen-stream-integration`, `codex/portal-ux-integration`, `codex/reference-player-release`, `codex/finkel-private-review-integration`, `codex/beit-service-ecosystem` and `codex/private-media-oidc-probe`. PR #43 carries only the coordination notes written around that work. Group (c) below is therefore a map of where the code lives on main, not a list of things to port.

## Classification

### (a) Already on main in another form

Of the 56 files: **41 are byte-identical on main today**, **13 exist on main in a later or different form** (including `CLAUDE.md`, `PRODUCT.md`, `MISSION.md` and `STATE.md`), and **2 are absent from main** (group b).

Identical on main (paths only, not copied):

- `docs/planning/2026-10-16-parallel-work/`: ADMIN-ROSTER-INTEGRATION-REVIEW, CATALOG-ACTIVATION-RELEASE-RETURN, COORDINATION, FROZEN-INTEGRATION-REVIEW, LESSON-LOG-DESIGN-REVIEW, LESSON-LOG-FOUNDATION-REVIEW, LESSON-PROGRESS-INTEGRATION-RETURN and -REVIEW, MODAL-EDITOR-INTEGRATION-REVIEW, PRACTICE-CALENDAR-DESIGN-REVIEW and -FOUNDATION-REVIEW, PROGRESS-FOUNDATION-REVIEW, RELEASE-MIGRATION-INDEPENDENT-REVIEW and -RETURN, SERVICE-CATALOG-ACTIVATION-REVIEW, SERVICE-DRAFT-MODAL-DESIGN-REVIEW and -INTEGRATION-REVIEW, TUTOR-ROUTE-INTEGRATION-REVIEW.
- `docs/planning/2026-10-17-practice-calendar/`: REVIEW, VISUAL-REVIEW.
- `docs/planning/2026-10-17-quiet-roster-import/`: CONTRACT, RELEASE-0019-RETURN.
- `docs/planning/2026-10-17-recording-foundation/`: DESIGN-REVIEW, IMPLEMENTATION-REVIEW, MEDIA-DESIGN-REVIEW, RECEIPT-DESIGN-PROPOSAL.
- `docs/planning/2026-10-17-reference-audio/`: CODEX-REVIEW, INTEGRATION-RETURN, REPO-GUARD-REVIEW.
- `docs/planning/2026-10-17-roster-admin-release/`: ADMIN-SHEET-REVIEW, CLAUDE-UI-NEXT, CLAUDE-VOICE-NEXT, MIGRATION-0019-INDEPENDENT-REVIEW.
- `docs/planning/2026-10-17-study-kq-order/` (RETURN, REVIEW) and `docs/planning/2026-10-17-study-markup/REVIEW.md`.
- `docs/superpowers/research/`: 2026-10-17-private-media-spend-notice, 2026-10-17-private-upload-quiescence.
- `docs/superpowers/specs/`: 2026-10-17-canonical-recording-pcm-design, 2026-10-17-private-recording-media-design.
- `.gitignore` (the `.local-data/` rule).

### (b) Docs worth keeping that main lacks or holds in a thinner form

Not on main at all (two files; they live on the branch at the cited commit):

| File | Added in | What it is |
|---|---|---|
| `docs/planning/2026-10-16-parallel-work/PROGRESS-UI-DESIGN-REVIEW.md` | `404d5c0` | Independent design review of the frozen progress UI ("changes needed before integration acceptance"). Historical; the UI shipped. |
| `docs/planning/2026-10-17-practice-calendar/CODEX-REVIEW.md` | `190dcad` | Short Codex-to-Claude note on two calendar lifecycle defects found in review. Historical; the repair is on main. |

On main, but missing some of the branch's lines (exact-line comparison; these lines are release evidence, not decisions):

| File | Lines main lacks | What they say | Value |
|---|---|---|---|
| `docs/planning/2026-10-16-parallel-work/RELEASE-READINESS.md` | 6 of 52 | The "Live release completed" section: canonical deployment, CI run, migration ledger 19, live checks. | Audit trail for the 2026-10-17 release. |
| `docs/planning/2026-10-17-roster-admin-release/RETURN.md` | 5 of 17 | Final acceptance of the roster and admin release, migration 0019 apply result, live checks. | Audit trail. |
| `docs/planning/2026-10-17-quiet-roster-import/RETURN.md`, `INDEPENDENT-REVIEW.md` | 3 of 24, 1 of 32 | Replacement CI evidence for the silent roster importer. | Audit trail. |
| `docs/planning/2026-10-17-practice-calendar/RETURN.md` | 2 of 24 | Calendar release and final technical acceptance. | Audit trail. |
| `docs/planning/2026-10-17-recording-foundation/RETURN.md` | 1 of 39 | Exact accepted checkpoint of the recording ledger. | Audit trail. |
| `docs/planning/2026-10-17-study-markup/RETURN.md` | 1 of 10 | Release of the eight-line study-markup fix. | Audit trail. |
| `docs/planning/2026-10-15-kickoff/STATE.md` | 1 of 41 | A "Current media milestone" paragraph about the private Blob store before native OIDC was accepted. | Superseded: STATE on main carries the accepted outcome (its "Native media acceptance" paragraph). |
| `CLAUDE.md`, `PRODUCT.md` | 1 of 1, 1 of 2 | The 2026-10-17 "continue until finished, deploy at will" authority line. | See Contradictions. Not worth restoring as written. |

`MISSION.md`, `DEPLOYED-RETURN.md` and the OIDC probe design differ from main only in wording or position; every line the branch added is present on main.

None of this needs copying. To read any of it, use the branch SHA:

```
git show 5c663f8c36d3c39e2300cec46ad3c0b4722b959d:<path>
```

Content check before writing this file: the branch's documents contain no licensed text, student or family data, recordings or credentials. They name commit SHAs, hosted CI run URLs, Vercel deployment IDs and one `example.test` address, and they state that private targets and logs stay outside Git. Nothing from them is quoted here beyond headings and commit subjects; everything else is linked by path and SHA.

### (c) Code: frozen UI and voice/reference-audio integration, now on main

None of this is on the PR branch. What each piece does, and whether it helps the voice track (M0 onward: `docs/superpowers/research/2026-10-22-voice/VOICE-BUILD-PLAN.md`, `docs/superpowers/plans/2026-10-16-claude-code-voice-handoff.md`, `docs/superpowers/plans/2026-10-16-chant-renderer-benchmark.md`):

| Piece (where on main) | What it does | Helps the voice track? |
|---|---|---|
| Frozen UI: tutor route, service-draft and editor modals, lesson log, progress UI, practice calendar (`src/components`, `src/app`, `src/server/*`) | The student, tutor and parent workspace shipped in 1.0. | No. Portal-side only. It matters to M7 only as the surface where the "Claude-generated chant" label and report-a-mistake would sit. |
| `scripts/reference-index-contract.mjs`, `reference-index-check.mjs`, `tests/reference-index-contract.test.mjs` | Validates a PocketTorah verse-index file: closed schema, finite and monotonic times, identity, qere and maqaf crosswalk, whole-verse versus word-highlight eligibility. 24 synthetic tests. | Yes. A tested way to read PocketTorah timing for M1 (Experiment 1) without writing a new parser; M2 data preparation can reuse its identity and timing rules. |
| `scripts/private-benchmark-policy.mjs` and its tests (refuses `pockettorah-verse-index/v1` data with the fixed reason `private reference-audio index`) | Repository guard that keeps private benchmark data and reference-audio indexes out of Git, with bounded parsing and fixed diagnostics. Independently reviewed in `docs/planning/2026-10-17-reference-audio/REPO-GUARD-REVIEW.md`. | Yes, directly. M0's guard exit test (a planted `.onnx`, `.ds` or private-schema JSON under `voice/` must be refused) extends this predicate; the review is the model for how to review that change. |
| `trope/human-alignment.mjs`, `human-retime.mjs`, `audio-dsp.mjs`, `benchmark-run.mjs`, `scripts/trope-human-retime.mjs` (from `24778d3`; return in `docs/planning/2026-10-16-voice/HUMAN-ALIGNMENT-RETURN.md`) | Reviewed human-speech alignment record, deterministic vowel-only retiming onto the score timeline, F0 and voicing output, run records, blind listening label map. | Yes, central. These are the "engine timing files" M0 lists. The branches `voice/human-alignment` `39c8770` and `voice/reference-index-contract` `4ea7284` are old-base ancestors of what main holds; main is the source. |
| `src/lib/reference-audio`, `src/server/reference-audio`, `src/components/portal/workspace/study/reference-player.tsx`, `scripts/reference-catalog-compile.mjs`, `reference-short-*.mjs`, `reference-boundary-*.mjs` | Serves PocketTorah human reference audio verse by verse with word highlighting; compiled private catalog; byte and digest verification. | Partly. It is the human-first source that generated audio fills in behind ("human recordings always come first", MISSION 2026-10-22). Its server-side authorization and digest-verification pattern is the template for serving a generated source behind G3. |
| `src/server/recordings`, `src/lib/recordings`, recording ledger and migration 0020 | Private student-recording ledger, canonical 24 kHz PCM seam, retention rules. Activation is gated. | Little. Student recordings are not donor or training audio, and MISSION keeps the two apart. The canonical-PCM spec is a useful reference for validating WAV bytes honestly, nothing more. |
| `scripts/private-media-oidc-probe.mjs`, `private-media-object-probe.mjs` and their tests | Metadata-only OIDC identity probe and synthetic object round trip for the private Blob store. | Yes, for M5 and M7 storage. The voice plan keeps weights and renders in the "existing private store"; this is what proved that store works Production-only with OIDC and no read-write token. |

## What to salvage for the voice track, and where it lives

Everything the voice track can use is already on main. In priority order:

1. **The M0 guard pattern.** `scripts/private-benchmark-policy.mjs` plus `docs/planning/2026-10-17-reference-audio/REPO-GUARD-REVIEW.md` (identical on main and on the branch at `5c663f8`). Extend the one predicate; do not add a second parser.
2. **The human-reference contract.** `docs/planning/2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md` and `REFERENCE-INDEX-RETURN.md` (on main only), with the validator under `scripts/`. These hold the PocketTorah timing and identity rules M1 and M2 need, and the licence and attribution points already settled (CC BY-SA, never encrypt the clips).
3. **The scope fence for delegated work.** `docs/planning/2026-10-17-roster-admin-release/CLAUDE-VOICE-NEXT.md` (identical on main) states the no-hosting, no-upload, aggregate-counts-only discipline; reuse it as the return template for M0.
4. **Private storage history.** The accepted outcome is in STATE on main. The failed first hosted identity round, the "do not rerun apply or create another store" warning and the fixed-failure-diagnostic idea are in the branch's late commits `ccad337` and `5c663f8` (`docs/superpowers/specs/2026-10-17-private-media-oidc-probe-design.md`; on main) and in `docs/planning/2026-10-17-recording-foundation/OIDC-PROBE-RETURN.md` and `OIDC-PROBE-REVIEW.md` (on main). They explain why the Blob store is OIDC-only.
5. **Storage cost basis.** `docs/superpowers/research/2026-10-17-private-media-spend-notice.md` (identical on main) is the basis for the $5 to $8 a month Blob planning target. M5's weights backup and M7's renders must be added to it before the $10 a month limit in CLAUDE.md is tested.

Nothing on the branch is code that main lacks. There is nothing to cherry-pick.

## Work that exists only in the primary checkout, not on the branch

At the start of this task the primary checkout `C:/Users/dsbog/bneimitzvah` was on `codex/roster-release-coordination` with uncommitted edits to `PRODUCT.md`, MISSION, STATE, PLAN-REVIEW, `DEPLOYED-RETURN.md` and the OIDC probe design, plus many untracked Codex records under `docs/planning/2026-10-17-recording-foundation/` (common-capacity, delegated-upload, identity, manifest, media-transport, object-probe, original-id and receipt reviews and returns). Those are not on GitHub and are not part of PR #43. They were left exactly as found. Closing the PR does not preserve them. If Daniel wants them kept, someone should commit them to a fresh branch from that checkout. They concern student recordings, which are parked, so what is at risk is audit history, not live work.

## Contradictions with current MISSION rulings

If any of the branch's text were merged or restored as written, these would contradict current rulings:

- **Spend.** The branch's `CLAUDE.md` still says to stop and ask Daniel for "money (new paid service, upgrade, spend notice)". Main's `CLAUDE.md` and MISSION 2026-10-22 let Claude approve hosting cost while total portal spend stays under $10 a month. The branch would restore the stricter, older rule.
- **"Deploy at will" line.** The branch adds "Current release authority, Daniel 2026-10-17: continue until the product is finished; deploy at will" to `CLAUDE.md` and `PRODUCT.md`. Main's `CLAUDE.md` deliberately keeps "stop and ask for anything student-visible before it ships", and MISSION 2026-10-22 (show rather than hide; human recordings need no listening review) settled the practical question. Do not restore the line.
- **Generated chant parked.** The branch's voice notes (`CLAUDE-VOICE-NEXT.md` and related returns) say generated chant is parked. Daniel resumed it on 2026-10-22 as a 1.5 beta workstream and then put it last, after releases 1.2 to 1.5 (STATE and `docs/planning/2026-10-22-release-1-5/PLAN.md`). G1, G2 and G3 in those notes are unchanged and still binding.
- **Daniel as the only human tester until feature complete.** Stated in the branch's STATE and in `PRODUCT.md` (an older wording of which the branch carries). The portal is now open to signed-out visitors (MISSION 2026-10-22), so that sentence is stale.
- **Finkel playback.** Branch-era notes treat Finkel playback as the planned first source. Daniel's later 2026-10-22 ruling removed Finkel playback from the portal and made his recordings voice-training material only.
- **Student recordings.** The branch's recording-foundation records read as if student upload and capture are the active milestone. MISSION parks them; the ledger code on main stays gated. This is a reading hazard, not a code conflict.
- **Retention.** Consistent with main: all student recordings expire one calendar year after the ceremony (MISSION 2026-10-17).

No credential, licensed text, student data or recording appears in the branch's documents, so there is no never-in-repo issue.

## The 51 commits

All 51 are on `origin/codex/roster-release-coordination`, oldest first. Every one is docs-only apart from three small top-level edits (`.gitignore`, `CLAUDE.md`, `PRODUCT.md`). `git cherry origin/main <branch>` marks all 51 as not on main by patch identity, because the same documents reached main through other branches in different commits; by content, 41 of the 56 files are identical on main already.

Class key: **a** means every file the commit touches is byte-identical on main now. **a+b** means it touches at least one file (mostly `STATE.md`) that main has since rewritten, so the commit's lines are either on main in later form or are group (b) release evidence.

| SHA | Date | Subject | Files | Class |
|---|---|---|---|---|
| `5f34080` | 2026-10-16 | Save the independently reviewed frozen UI and voice integration with exact green hosted evidence and the remaining student review gate | 3 | a+b |
| `df39d70` | 2026-10-16 | Record Daniel approval of the frozen student interface and current wording while keeping later staff and provider work separately scoped | 2 | a+b |
| `30e8544` | 2026-10-16 | Save accepted tutor route integration and full hosted evidence while preserving student approval and separate editor voice and production scopes | 3 | a+b |
| `21ea1ba` | 2026-10-16 | Continue approved product work across checkpoints and reserve the progress backend and modal access repair with the active Claude streams | 2 | a+b |
| `88e8337` | 2026-10-16 | Record independent verse progress acceptance and coordinate the next lesson summary backend while integration checks continue | 3 | a+b |
| `2a8ce9e` | 2026-10-16 | Approve the bounded lesson log contract and reserve integration of Claude's frozen editor and workspace modal helper | 2 | a |
| `7ea8d5c` | 2026-10-16 | Save the published progress backend checkpoint and continue the independently reviewed editor modal integration | 1 | a+b |
| `009eaac` | 2026-10-16 | Accept the exact Windows and Linux progress checkpoint and retain the unresolved modal Escape case as the next integration gate | 3 | a+b |
| `2bfae73` | 2026-10-16 | Save the independently reviewed modal repair and continue lesson log implementation while its published checkpoint runs CI | 3 | a+b |
| `be9a1c6` | 2026-10-16 | Record Daniel's separate practice history retention ruling and queue its bounded backend after the current lesson log | 3 | a+b |
| `b1da12a` | 2026-10-16 | Record independent lesson log acceptance and offer its client contract while full integration checks continue | 3 | a+b |
| `e7b286f` | 2026-10-16 | Record the hosted study fixture rate limit failure and preserve its narrow correction in the combined lesson integration lane | 2 | a+b |
| `842a735` | 2026-10-16 | Publish the combined lesson and modal checkpoint with measured fixture repair and continue the approved practice calendar contract | 4 | a+b |
| `5a2cf98` | 2026-10-16 | Approve the bounded online practice calendar contract with days only delegated views and exact retention before Sol implementation | 3 | a+b |
| `7696c80` | 2026-10-16 | Accept the complete lesson log and modal integration after all Windows Linux PostgreSQL and browser CI gates pass | 2 | a+b |
| `2405d27` | 2026-10-16 | Record independent calendar race evidence and bound the reserved service dialog integration | 4 | a+b |
| `f763aca` | 2026-10-16 | Unblock Claude lesson notes with the published green backend and separate voice review request | 1 | a |
| `c3b99ea` | 2026-10-16 | Add attributed full calendar app and build evidence while exact hosted validation remains pending | 1 | a |
| `b6be7bd` | 2026-10-16 | Normalize the calendar review report ending for a clean checkpoint | 1 | a |
| `966ce2d` | 2026-10-16 | Publish the calendar review checkpoint for exact CI and start the reserved service dialog integration | 2 | a+b |
| `01b2a1a` | 2026-10-16 | Give Claude the frozen progress UI recovery finding without duplicating its implementation | 1 | a |
| `b43a43a` | 2026-10-16 | Clarify the progress refresh ordering gap while preserving the existing provider generation fence | 1 | a |
| `404d5c0` | 2026-10-16 | Save the independent frozen progress UI review and its bounded recovery acceptance requirements | 2 | a+b |
| `4fa3201` | 2026-10-16 | Accept the exact calendar checkpoint after all hosted jobs pass and preserve the pending modal review boundary | 2 | a+b |
| `82dc91a` | 2026-10-16 | Accept independent service dialog privacy and focus evidence before broader integration checks | 2 | a+b |
| `c038a84` | 2026-10-16 | Publish the reviewed service dialog checkpoint for exact CI and describe the narrow UI reconciliation contract | 3 | a+b |
| `63fe9c8` | 2026-10-16 | Accept the fully green service dialog integration and hand Claude the final reconciliation checkpoint | 2 | a+b |
| `e7f41ea` | 2026-10-16 | Preserve the independently assigned dialog privacy fixture plan alongside its completed review | 1 | a |
| `33dc78a` | 2026-10-16 | Take ownership of the authorized release sequence and reserve frozen lesson and progress integration for Sol | 2 | a+b |
| `1877a4d` | 2026-10-16 | Record the independent release inventory and fresh read-only production history verification | 1 | a+b |
| `81dcfa3` | 2026-10-16 | Record current private recording storage evidence without provisioning or assuming portal authorization | 1 | a+b |
| `f86978e` | 2026-10-16 | Scope recovery verification to the additive cutover and remove the unnecessary console lookup blocker | 1 | a+b |
| `617deb0` | 2026-10-16 | Record the frozen lesson progress corrections and current guarded release verification without stale deployment holds | 2 | a+b |
| `b123ab6` | 2026-10-16 | Record the verified migration startup repair and preserve the required production channel binding before preflight | 3 | a+b |
| `bd023a1` | 2026-10-16 | Record the successful exact live read-only preflight and the remaining bounded release gates | 3 | a+b |
| `dd36c32` | 2026-10-16 | Publish the exact reviewed release candidate and its hosted verification handoff for the active Claude streams | 2 | a+b |
| `aef90bd` | 2026-10-16 | Track the isolated test harness correction and replacement exact CI without changing the reviewed runtime source | 2 | a+b |
| `5bcdb02` | 2026-10-17 | Record the verified production release with its committed database and catalog cutover and final live authentication evidence | 9 | a+b |
| `09defb9` | 2026-10-17 | Exclude private local rosters and contact data from the publishable checkout | 1 | a |
| `af22c58` | 2026-10-17 | Reserve the silent local roster import backend while Claude retains the current admin interface work | 1 | a |
| `015f030` | 2026-10-17 | Record the reviewed silent roster checkpoint, private dry-run preview and complete replacement CI evidence | 5 | a+b |
| `5513062` | 2026-10-17 | Record the verified roster and admin deployment and bounded next Claude assignments without claiming product completion [skip ci] | 9 | a+b |
| `39656b7` | 2026-10-17 | Reserve the local recording ledger milestone and preserve independent design review while Claude continues separate calendar and reference tooling work | 3 | a+b |
| `190dcad` | 2026-10-17 | Take ownership after retiring the Claude sessions and record the deployed Hebrew repair and Daniel's all recording retention decision [skip ci] | 9 | a+b |
| `0ec3122` | 2026-10-17 | Save the completed recording and parser review checkpoints while withholding calendar release for the session denial repair [skip ci] | 11 | a+b |
| `5c17259` | 2026-10-17 | Record the independently verified session privacy repair and all green exact candidate gates before Daniel reviews the calendar release [skip ci] | 4 | a+b |
| `d9374b1` | 2026-10-17 | Record Daniel's continuing deployment authority and the verified calendar release while starting the canonical recording verification milestone [skip ci] | 8 | a+b |
| `f7a01ca` | 2026-10-17 | Replace the placeholder media budget with account-aware workload costs and preserve the pending storage decision | 3 | a+b |
| `9a94a28` | 2026-10-17 | Record the deployed recording foundation and Daniel's approved private Blob budget while keeping media activation gated | 9 | a+b |
| `ccad337` | 2026-10-17 | Record the committed private media connection and bound native OIDC verification before enabling recording storage | 3 | a+b |
| `5c663f8` | 2026-10-17 | Preserve the failed hosted identity round and authorize only fixed failure diagnostics before a new reviewed probe | 2 | a+b |
