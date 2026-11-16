# 01. Dead code and the trope engine

Reviewer scope: provably dead code across `src/`, `scripts/`, `public/`, `trope/`, `tests/helpers`, `tests/fixtures`; and what `trope/` is still for.

## How this was checked

- `npx knip` (not saved to package.json), run twice: default mode (tests count as entry points) and `--production` (only the app's entry points). Raw output is beside this report: `_knip.txt`, `_knip_prod.txt`.
- Knip's 696 "unused exports" in production mode were re-classified by a script that counts every word-boundary occurrence of each name in the export's own file, the rest of `src/scripts/trope/public/.github`, and `tests/e2e`. Result in `_classified.tsv`:
  - 25 values + 29 types: **no reference anywhere** (DEAD).
  - 36 values + 2 types: **referenced only by tests** (TESTONLY).
  - 306 values/types: used only inside their own file (needlessly exported, not dead).
  - 314: used in own file and tests. 159: the name also appears elsewhere in src (not checked one by one; treated as alive).
- Every item in list A was then grepped by hand across `src tests e2e scripts .github docs/superpowers/specs` and config.
- CSS: a script extracted every class and custom property from the 39 CSS files and looked for a literal or a template-string prefix in `src tests e2e scripts`. Output: `_css2.txt`.
- Node engine suite timed locally: `node --test "tests/**/*.test.mjs"` is 472 tests, 13 s wall. 7 fail here only because this checkout is shallow (the release-migrate tests need full git history; see B1).
- Not verified: production environment variable values (no Vercel access used). Flag status below comes from DEPLOYING.md, STATE.md and the code defaults. The `voice/human-alignment` branch could not be inspected (shallow clone, branch not fetched).

Headline: knip finds **no unused npm dependency and no unreachable `src` file in default mode**. The dead weight is not stray files. It is (1) whole features that were parked or retired and are now kept alive only by their own tests, and (2) spent one-off operator tooling in `scripts/` with large test suites.

---

## A. Safe to delete now

Low risk, no decision needed. Total is small (about 330 lines of source, about 640 lines of tests) because the codebase has few stray files.

### A1. Exports with zero references anywhere (src, tests, e2e, scripts)

| Path:line | Export | Size | Note |
|---|---|---|---|
| `src/server/data/study-guides.ts:167,172,178` | `themeReads`, `lockThemeRead`, `changeThemeRead` | 24 lines | The "I read this" tick was retired (Study v6, Daniel 2026-10-28). `service.ts:324` `setThemeRead` now only throws 403. See B5 for the rest of that feature. |
| `src/server/data/study-guides.ts:111` | `guideStreams` | 6 lines | "what needs a guide" list; nothing calls it. |
| `src/server/data/mcp.ts:52` | `memberConnections` | 6 lines | |
| `src/server/data/authority.ts:28` | `lockActorRecords` | 6 lines | Auth-adjacent file: delete, but it is only an unused helper. |
| `src/server/db/runtime.ts:8` | `createRuntimeDatabase` | 7 lines | |
| `src/components/portal/workspace/staff/practice.tsx:83` | `ParentCountLine` | 12 lines | Unused component. |
| `src/components/portal/workspace/study/commentary-view.tsx:134` | `VerseCommentary` | 9 lines | Unused component (Study v6 leftovers). |
| `src/server/db/auth-schema.ts:97,102,109` | `userRelations`, `sessionRelations`, `accountRelations` | 19 lines | Generated better-auth relations; check `db/index.ts` does not spread `* as schema` into drizzle before deleting (it does not reference them by name). Confidence medium; leave if in doubt. |
| One-liners | `findVerse` (`components/learn/course-data.ts:82`), `invitationFingerprint` (`workspace/invitations/api.ts:58`), `useCongregationLinks` (`workspace/settings/links.ts:34`), `KIND_ORDER` (`study/study-notes.tsx:118`), `stateWord` (`today/model.ts:75`), `portionAvailable` (`lib/print/portions.ts:77`), `FORMAT_KEYS` (`lib/print/sheet-format.ts:60`), `isMcpPick` (`server/mcp/portion-reading.ts:20`), `SHARE_CARD_TYPE` (`server/public-site/share-card.tsx:14`), `PRODUCTION_ORIGINS` (`server/runtime/config.ts:30`), `EVENING_PIN_BUILD` (`server/service-course/evening.ts:164`), `studyCacheChapterUrl` (`server/study/cache.ts:53`), `STEP_SOURCE_ATTRIBUTION` (`server/study/lexical/source-manifest.ts:5`) | 1 to 2 lines each | `STEP_SOURCE_ATTRIBUTION` is a CC BY attribution string: confirm the credit is shown from somewhere else before deleting. |

Plus 29 exported types nothing uses (list: rows `DEAD t` in `_classified.tsv`, e.g. `AccountsService`, `StaffService`, `OfflineService`, `WorkerPolicy`). Harmless; remove the `export` or the alias when touching the file.

No guard test names any of these. No test edit needed.

### A2. The old whole-recording reference player (test-only)

The live player is the "short clip" path (`reading-player.tsx` → `short-main-playback.ts` → `lib/reference-audio/short-playback.ts`). The earlier whole-recording player is still in the tree and only tests import it:

- `src/components/portal/workspace/study/reference-player.tsx` (77 lines) and `reference-player.module.css` (15 lines). Only importer: `tests/app/reference-playback.test.ts`.
- `src/components/portal/workspace/study/main-playback.ts:8` `createReadingPlayback` (51 lines). The file's types (`ReadingSelection`, `ReadingPlaybackState`) are still used and stay.
- `src/lib/reference-audio/playback.ts`: every runtime export (`downloadReferenceAudio`, `createReferenceAudioReuse`, `createReferenceMediaReuse`, `createReferencePlayback`, `REFERENCE_PLAYBACK_LIMITS`), about 310 of 335 lines. Production imports only its types (`ReferenceAudioElement`, `ReferencePlaybackOptions`, `ReferencePlaybackState`) from `short-main-playback.ts`.
- Tests that exist only for it: `tests/app/reference-playback.test.ts` (247), `main-reading-playback.test.ts` (169), `main-reading-playback-review.test.ts` (170), `reference-preparation-performance.test.ts` (48).

About 450 source lines and 634 test lines. Risk low, confidence high for the client side. I did not trace whether the matching server read (`runtime.referenceAudio.read`, `src/server/http/portal.ts:351`, `server/reference-audio/service.ts`) is still called by any live client; that belongs to whoever reviews reference audio.

### A3. Unused CSS

- `src/app/globals.css`, 25 classes with no literal or template-string use in src, tests or e2e (roughly 50 rule lines): `.access-actions .access-assign .access-pages .access-section .csv-check .entry-ask .hero-days .hero-name .invitation-form-fields .invitation-record-details .invitation-student .practice-coach .selection-lede .study-verses-with-work` (9 rules) `.toolbar-soon .workspace-heading-row .roster-table` (9 rules) `.roster-scroll .roster-student-kind .roster-reading-link .reading-calendar-choices .reading-print-action .reading-print-sheet .reading-sources-dock .reading-sources-open`.
- `src/app/globals.css` custom properties never read: `--note-chip`, `--space-unit`.
- `src/components/learn/learn.module.css`: `.sheetActions .sheetHidden .sheetLine .sheetPrimary .sheetRef .sheetStage .sheetStep .stepItem` (an old "sheet" layout).
- `src/components/portal/public-reading/public-reading.module.css`: `.choiceRow`.

Risk low, confidence medium-high (class names built by string concatenation in a way my prefix check missed would be a false positive; `practice-cell-*`, `invite-status-*`, `col-*`, `--phrase-*` were recognised as dynamic and are NOT on this list). The CI visual specs would catch a wrong removal.

### A4. Small files and scripts

- `trope/vendor/havarotjs/schemas.js` (7 lines): nothing imports it. It is a vendored file, so update `trope/vendor/havarotjs/PROVENANCE.md` if that lists files.
- `package.json` script `db:auth-schema`, `scripts/db-auth-config.ts` (12 lines) and the `auth` devDependency (the better-auth CLI): referenced by nothing but each other and one old planning note (`docs/planning/2026-10-15-kickoff/PHASE2-RETURN.md`). It was a one-time schema generation aid. Removing `auth` also shrinks the lockfile. Risk low; confidence medium (a developer may still run it by hand when bumping better-auth; if so keep the script and say so in README).
- `package.json` script `check:repo`: nothing calls it (CI runs the whole node suite). Trivial; keep or drop.

---

## B. Probably dead, needs a decision

Ranked by payoff. These are the real savings.

### B1. The `release-migrate-*` operator family (biggest single item)

- What: 14 scripts, `scripts/release-migrate*.mjs`, 1,544 lines. Each is a bespoke, source-pinned operator that applied one early migration to production with catalog snapshots: 0019 roster intake, 0020 recording ledger, 0021 source assignments, 0022 honors, 0023 honoree links, 0024 adult honors.
- Why dead: production is at migration 0057. Migrations since then go through `scripts/db-migrate.mjs` (DEPLOYING.md §3.2) and per-migration check scripts that live in the session scratchpad, not here. These six operators can never run again: each refuses any database not exactly at its pinned predecessor.
- What it costs today:
  - Tests: `tests/release-*.test.mjs` (8 files), `tests/helpers/release-*-fixture.mjs` (6), `tests/helpers/adult-honors-upgrade.mjs`, `tests/postgres/release-*` (8 files): 2,067 lines.
  - Fixtures: `tests/fixtures/portal/release-*-reference.json`, 7 files, **3.6 MB** (the largest things in the repo after fonts).
  - CI: all four jobs check out with `fetch-depth: 0` solely so "Release tests verify the pinned historical migration ancestor" (`.github/workflows/ci.yml:28,48,108,150`). The tests fail in any shallow clone (7 failures in this sandbox).
- Do instead: delete scripts, tests, helpers and fixtures; drop `fetch-depth: 0`; the history stays in git. `tests/font-assets-policy.test.mjs:230-234` pins `.gitattributes` lines for these paths, so that test and `.gitattributes` need a matching edit. `tests/postgres/adult-honors-upgrade.integration.ts` should be checked for whether it tests live app behaviour or only the operator.
- Saved: about 3,600 lines, 3.6 MB, a faster checkout in every CI job, and the tests that break for anyone with a shallow clone.
- Risk low (nothing in `src` imports them). Confidence high that they are spent; "the migration check scripts" are on CLAUDE.md's never-relaxed list, so the lead should confirm that phrase means the current per-migration checks and not these six.

### B2. Student recordings (parked, then dropped)

- Status: MISSION parks them; Daniel 2026-10-22: dropped from 1.5, "I don't think this is really a useful thing for us". `PORTAL_RECORDINGS_ENABLED` is unset in production and DEPLOYING.md tells forks to leave it unset, so the flag is permanently off and every route is a 404.
- Code kept alive by the flag: `src/server/recordings/` (8 files, 548 lines), `src/server/http/recordings.ts` (39), `src/server/data/recordings.ts` (52), `src/components/portal/workspace/recordings/capture.ts` (128), `public/recording-capture-worklet.js` (36, publicly served), wiring in `src/server/runtime/composition.ts:65,218-219` and `config.ts:85,94`. Within it, `media-wav.ts`, `registration.ts`, `capture.ts` and four `policy.ts` exports are reachable only from tests even with the flag on: there is no UI and no upload route.
- Tests only for it: 14 files, about 1,740 lines (`tests/app/recording-*.test.ts` ×8, `recordings-parked.test.ts`, `tests/postgres/recording-*.integration.ts` ×3, `tests/http-browser/recording-capture*.test.ts` ×2). The two http-browser ones run real browsers in CI.
- Do instead: remove the feature code and tests; keep migration 0020 and `src/server/db/recording-schema.ts` (the table exists in production; dropping it is a separate, irreversible data change that needs Daniel).
- Saved: about 800 source lines, 1,740 test lines, two browser test files. Risk low-medium (touches `composition.ts`, `dispatch.ts`, the fixtures `tests/app/portal-routes-fixture.ts` and `tests/http-browser/fixture.ts`). Confidence high that it is dead today; the decision is whether 2.x ever wants it back.

### B3. Voice-experiment code in `trope/` (see Part 2)

About 5,500 lines and 57 tests. Detail below.

### B4. Finkel private listening review

- What: `/workspace/admin/reference-review` and its stack: `src/server/reference-review/` (6 files, 428 lines), `src/server/http/reference-review.ts` (53), `src/server/data/reference-review.ts` (42), `src/components/portal/workspace/reference-review/` (304), migration 0026. Tests: `finkel-review-import`, `reference-review*.test.ts` ×5, one postgres integration, one http-browser UI test, about 630 lines.
- Why probably dead: it was built for Daniel to review Cantor Finkel's clips privately before playback. On 2026-10-22 he cut Finkel playback ("use only pocket Torah"), and ruled human recordings need no listening review. STATE records the private batch "was never published". The service is only configured when `FINKEL_REVIEW_TENANT_ID` and `FINKEL_REVIEW_REVIEWER_USER_ID` are set (`src/server/reference-review/batch-contract.ts:29`); I could not check whether production still sets them.
- Decision needed: the 2.5 voice plan has Daniel doing blind listening rounds for generated chant. If that review is meant to reuse this screen, keep it; the VOICE-BUILD-PLAN does not say so. Otherwise remove about 830 source and 630 test lines and the More-menu row. Risk medium (schema stays; a menu entry goes). Confidence medium.

### B5. Retired "I read this" theme ticks

- `src/server/http/study-guides.ts:40-45` still parses a `theme-read` route and calls `setThemeRead`, which unconditionally throws 403 (`src/server/study-guides/service.ts:323-326`). Table `study_theme_read` remains (`src/server/db/study-guides-schema.ts:99-113`).
- Do instead: remove the route branch and the stub (it then 404s like any unknown route), plus the three data functions in A1. Two tests assert the 403 (`tests/app/study-guides-http.test.ts:55`, `study-guides-service.test.ts:188,274`) and need a one-line change. About 40 lines. Risk low. The table can stay.

### B6. Private-media build probes

- `package.json` `prebuild` runs `scripts/private-media-oidc-probe.mjs` (176) and `scripts/private-media-object-probe.mjs` (192) on **every build**. They are acceptance probes for the private Blob store, accepted 2026-10-17; without `PRIVATE_MEDIA_OIDC_PROBE_*` flags they do nothing. They hardcode CRC's Vercel project, team and store ids (`private-media-oidc-probe.mjs:6-10`), which is odd in a repo now meant to be forked.
- Tests: six files, 888 lines (`tests/private-media-*.test.mjs`).
- Do instead: delete the probes, the `prebuild` hook and the tests, or move them to an off-repo operator folder. Saved about 1,250 lines. Risk low. Confidence medium-high (DEPLOYING.md mentions `prebuild`; that paragraph would need editing).

### B7. Practice-calendar retention is never run

- `src/server/practice-calendar/maintenance.ts` (36 lines): its own comment says "Trusted internal composition only; no HTTP cleanup route or scheduler". Nothing in `src` constructs it; only three test files do. So the retention rules in `practice-calendar/policy.ts` and `data.deleteRaw/deleteDays/hasExpired` are tested but never executed in production.
- Decision: either wire it to the existing cron (`CRON_SECRET` route) or delete it and the retention helpers. For a few dozen students, deleting is defensible. Either way the current state (a privacy promise implemented but never run) is the worst of both.

### B8. One-off provider and pipeline tooling in `scripts/`

- `scripts/provider-bootstrap/` (neon-ws probe, 258 lines, own vitest config) plus `tests/app/provider-neon-probe.test.ts`: a one-time Neon WebSocket probe. Probably spent.
- `scripts/reference-*.mjs`: 16 files, 3,827 lines, with 12 node test files (2,213 lines; `reference-short-publish-native.test.mjs` alone is 664). This is the pipeline that cut PocketTorah into clips and published them. The output is now frozen as the `reference-kit-v1` GitHub Release, and STATE notes a fork "cannot rebuild byte-identically". Forks need only `reference-kit-install.mjs`, `reference-kit-shared.mjs` and whatever they import. The boundary-refine, short-build, publication, publish-native and manifest-rebind scripts are needed again only if clips are re-cut (the paused boundary repair). Candidate to move out of the repo with their tests; needs the reference-audio reviewer's view. Note `src/server/reference-audio/short-source-build.ts` (80 lines) is imported only by these scripts and tests.
- `scripts/test-local-db.mjs` (212) is alive (AGENT-BRIEF names `npm run test:local-db`).

### B9. Test-only exports worth a look

From the TESTONLY list, the ones that are features rather than helpers:

- `src/lib/learn/verse-review.ts:157-162` `JOIN_OFFER_ENABLED = false` and `joinWith`: a permanently-off constant; "its wording is a gap, so nothing renders it yet". Nothing reads the flag at all.
- `src/components/portal/workspace/today/model.ts:50,69` `readingRows`, `rowState` (20 lines) with `tests/app/student-today-model.test.ts`: model code the Today screen no longer calls.
- `src/components/portal/workspace/study/verse-panel.tsx:111,139` `DiscussionList`, `VerseActions`; `discussions.tsx:16` `DiscussionsProvider`; `portion-summary.tsx:29` `StudySummary`: components rendered only by tests since Study v6.
- `src/components/portal/saved/api.ts:169-184` `savedText`, `saveSavedWork`, `conflictWork`.
- `src/lib/navigation/canonical.ts:25` `canonicalNavigationEnabled`.

Each is small; together about 120 lines plus the test cases that keep them alive. Deleting them means deleting or rewriting those test cases, so it is a judgement call per item.

---

## C. Alive but looks dead

Do not delete these.

- `src/offline/service-worker.js`: knip calls it unused; it is read as text by `src/lib/offline/worker-source.ts` and served by `src/app/sw.js/route.ts`.
- `src/app/design-system/` (106 lines): no link reaches it and it 404s unless `CRC_COMPONENT_PAGE=1`. The built e2e server sets that (`tests/helpers/builtE2eServer.mjs`) and `e2e/visual-system.spec.ts`, `e2e/font-subset.spec.ts` and `tests/app/visual-system.test.ts` drive it.
- `public/fonts/**/*.sfd` (617 KB) and `TaameyFrankCLM.ttf`: not loaded by any page, but they are the GPL "corresponding source" for the subset WOFF2 (`public/fonts/PROVENANCE.md:61,77,119`) and pinned by `scripts/font-assets.mjs` and `tests/font-assets-policy.test.mjs`. They could live outside `public/` (they are served to the world for no reason), but that is a licence question, so it is Daniel's.
- `drizzle.config.ts`, `scripts/db-generate.mjs`: used by `npm run db:generate` through an out-of-tree drizzle-kit.
- `scripts/named-readings-extract.mjs`, `scripts/import-course-text.mjs`: provenance generators named by `src/lib/readings/named-readings.ts` and `src/server/service-course/pin.ts` and their tests.
- `tests/fixtures/e2e-server-probe.mjs`, `e2e-server-runner.mjs`: spawned by path from `tests/e2e-server-isolation.test.mjs`.
- `/unsubscribe`, `/honoree`, `/invitations/*`, `/auth/email`: reached from emails, not from in-app links. Every other page route has an in-app link.
- `e2e/*.ts` helpers flagged by knip (`HAFTARAH`, `binding`, `studyRow`): fixture exports.
- `scripts/trope-fetch.mjs`, `scripts/trope-score.mjs`: not imported, but they regenerate the engine fixtures (`tests/fixtures/trope/README.md`) and print scores.
- Flags that look permanent but are real switches: `PORTAL_OFFLINE_ENABLED` (on unless `"false"`; the kill switch for the service worker), `PORTAL_MCP_ENABLED`, `PORTAL_NOTIFICATIONS_ENABLED`, `PORTAL_MUSIC_DETAILS_ENABLED`, `REFERENCE_AUDIO_STUDENT_RELEASE`, `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE`, `CREDIT_UPSTREAM` (fork-only). `TIKKUN_SHOTS`, `LEARN16_SHOTS`, `HONOREE_CAPTURE` are opt-in screenshot switches in e2e specs.
- Dependencies: all ten runtime and nine dev dependencies are imported. Three packages are imported **without** being in package.json and work only by hoisting: `@vercel/oidc` (4 src files, e.g. `src/server/runtime/composition.ts:120`), `undici` (4 test files), `playwright` (56 files in `tests/http-browser`; only `@playwright/test` is declared). Not dead code, but `@vercel/oidc` in production code should be declared.
- 306 exports that are used only inside their own file: over-exported, not dead. Worth a lint rule, not a cleanup project.

---

## Part 2. `trope/`

### What the app actually uses

One import in all of `src/`: `src/server/study/word-aids.ts:3` takes `verseUnits` from `trope/text.mjs`. That pulls in `trope/lib-trope.cjs`, `trope/pronunciation.json`, `trope/vendor/havarotjs/` and `trope/text.d.mts`. Nothing else in `trope/` is loaded by the deployed app.

Three things in `src` are copies checked against the engine by tests rather than imports: `src/lib/trope/chart-catalog.ts` (phrase families, checked by `tests/trope-chart-catalog.test.mjs`), `src/lib/learn/contours.ts` (copied from `trope/cells/*.json`, checked by `tests/app/learn-contours.test.ts`), and `src/lib/learn/verse.ts` / `course.ts` (trope ids). App tests also read `tests/fixtures/trope/hebcal/*.json` and several calibration fixtures (`tests/app/tikkun-letters.test.ts`, `rare-tropes.test.ts`, `study-annotations.test.ts`).

### Where generated chant stands

- Parked, not dead. Daniel 2026-10-23: "All the voice work happens in 2.5", after 2.0. G3 is unchanged. Nothing in `src` can serve generated audio today; Listen plays PocketTorah only.
- The plan for 2.5 (`docs/superpowers/research/2026-10-22-voice/VOICE-BUILD-PLAN.md`) is a **DiffSinger fine-tune** on PocketTorah and Finkel, in a new `voice/` folder, with a new renderer-neutral contract `chant-performance/v1`. It reuses the score layer (`text.mjs`, `melody.mjs`, `cells/`, `pronunciation.json`), which the research handoff calls "solved and reusable".
- The lanes in the repo today are the earlier ones, with recorded verdicts in `docs/planning/2026-10-22-voice-research/COWORK-HANDOFF.md:82-106`:
  - SoulX-Singer zero-shot: "no Hebrew phones and published no training code. **Dead end.**"
  - Modal cloud renderer: "built but never run".
  - Speech re-sung by SoulX-SVC, and Hebrew TTS re-sung by SVC: closest so far, parked with five open defects, and superseded by the DiffSinger plan. The TTS licence (Phonikud) is non-commercial and unresolved.
- STATE.md:660 and the handoff say the fuller, current version of the alignment and retiming work lives on branch `voice/human-alignment` ("`main` has only a short version"), and the build plan says to bring `timing-model.mjs` and friends from that branch. So `main` carries a stale subset of the experiments, not the working copy.

### Classification

| Group | Files | Lines | Status |
|---|---|---|---|
| **App runtime** | `text.mjs`, `text.d.mts`, `lib-trope.cjs`, `pronunciation.json`, `vendor/havarotjs/`, `PROVENANCE.md` | about 930 + vendor | Keep. |
| **Score engine (the reusable layer)** | `melody.mjs`, `midi.mjs`, `hebcal.mjs`, `sefaria.mjs`, `cells/*`, `scripts/trope-score.mjs`, `scripts/trope-fetch.mjs`; tests `trope-engine`, `-melody`, `-torah`, `-moroccan`, `-hebcal`, `-text`, `-lib`, `-chart-catalog`, `phrase-colors` | about 560 + cells | Keep. Not used by the app at runtime, but it anchors the app's copied contours and colours and is the base for 2.5. 83 tests. |
| **SoulX-Singer zero-shot and Modal (dead end / never run)** | `soulx_runner.py` (169), `soulx_prompt.py` (507), `prompt.mjs` (105), `modal_render.py` (256), `render-cli.mjs` (126), `wav.mjs` (58), `gap_check.py` (86), `env/requirements.lock.txt`, `env/soulx-env-README.md`, `env/pitch_check.py`, `env/ab/*`; `scripts/trope-render.mjs` (253), `scripts/trope-prompt.mjs` (73); tests `trope-prompt` (6), `trope-render-cli` (10); fixtures `soulx-phone-set.json`, `SoulX-Singer.LICENSE` | about 2,100 | Remove. |
| **SVC / speech-to-singing lane (parked, superseded)** | `speech2sing.mjs` (220), `speech2sing.py` (297), `s2s_pitch.py` (60), `soulx_svc_runner.py` (57), `asr_cer.py` (102), `env/tts-requirements.lock.txt`; `scripts/trope-speech2sing.mjs` (94); test `trope-speech2sing` (8) | about 920 | Move out with the next group. |
| **Benchmark packs and human retiming** | `soulx.mjs` (334), `benchmark-pack.mjs` (198), `benchmark-run.mjs` (114), `human-alignment.mjs` (184), `human-retime.mjs` (277), `audio-dsp.mjs` (194); `scripts/trope-benchmark-pack.mjs` (147), `scripts/trope-human-retime.mjs` (144); tests `trope-soulx` (15), `trope-benchmark-pack` (7), `trope-human-retime` (11) | about 2,400 | Move out. `benchmark-pack.mjs` imports `soulx.mjs` and `speech2sing.mjs`, and `human-retime.mjs` imports `speech2sing.mjs`, so this group and the previous one go together or not at all. |

Totals for the three experiment groups: about **5,500 lines** (1,810 Node, 1,534 Python, 385 env files, 711 scripts, 1,073 tests) and **57 of the engine suite's 472 tests**.

### Recommendation

1. Delete the SoulX-Singer zero-shot and Modal group from `main` now. It has a recorded "dead end" verdict, the Modal path never ran, and the 2.5 plan does not use it. `scripts/trope-render.mjs` is the only caller of `render-cli.mjs` and `wav.mjs`. One catch: `soulx.mjs` itself must stay while `benchmark-pack.mjs` imports it (step 2).
2. Move the SVC and benchmark/retiming groups off `main` onto the existing `voice/human-alignment` branch (which already holds the newer versions) or tag the commit and delete. When 2.5 starts, the build plan creates `voice/` and pulls what it needs; it already plans to split `benchmarkIdentityMap` away from the SoulX token scheme, so nothing in 2.5 depends on these files staying on `main` in their current shape. This is the step to confirm with Daniel or the voice handoff owner, because VOICE-BUILD-PLAN §3 says "Keep `israeli-v1` unchanged for the existing benchmark packs", which implies someone expects the pack tooling to exist somewhere.
3. Keep `scripts/private-benchmark-policy.mjs` and its two tests. They are part of never-in-repo (they stop benchmark records and the PocketTorah index from being committed) and still matter with the experiment code gone.
4. After that, `trope/` is Node-only again (no `.py`, no lock files for a Python environment that CI never installs), which is what CLAUDE.md says it is: "dependency-free Node plus its vendored, licensed copies".
5. Guard tests to edit: `tests/repo-policy.test.mjs` references `trope/` paths in general terms only; `scripts/repo-policy.mjs:118` allows data files under `trope/` and `tests/fixtures/trope/` by prefix, so no allow-list entry names a removed file. `README.md:7,22` and `tests/fixtures/trope/NOTICE.md` (SoulX licence note) need a line each.

### Effect on tests and CI

- Test count: engine suite 472 → 415 (57 fewer). The app's Vitest and browser suites do not change.
- CI time: effectively none. The 57 tests take about 2.7 s of a 13 s node step; CI's roughly 25 minutes is Vitest shards on two operating systems, Postgres and the browser shards. The gain is 5,500 fewer lines, no Python in a Node repo, and a `trope/` folder whose contents match what the README says the engine is.
- For comparison, the items that would move CI: B1 (drops `fetch-depth: 0` from four jobs and 3.6 MB of fixtures) and B2 (two http-browser test files and three Postgres integration files).

---

## Rough totals

| Item | Source lines | Test lines | Other |
|---|---|---|---|
| A (safe now) | about 330 + 60 CSS rules | about 640 | `auth` devDependency |
| B1 release-migrate | 1,544 | 2,067 | 3.6 MB fixtures, `fetch-depth: 0` ×4 |
| B2 recordings | about 800 | about 1,740 | 2 browser test files |
| B3 trope experiments | about 4,440 | 1,073 | Python gone from repo |
| B4 Finkel review | about 830 | about 630 | |
| B6 media probes | 368 | 888 | `prebuild` hook |
| B8 reference pipeline + neon probe | up to about 3,700 | up to about 2,300 | needs reference-audio reviewer |
| **Total if all taken** | **about 12,000** | **about 9,300** | |
