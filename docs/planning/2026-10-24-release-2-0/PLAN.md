# 2.0 build plan (CRC Torah)

Imported into the repo 2026-10-24 (milestone G0) from Cowork's `G-PLAN-2.0.md`. Assembles tracks A–F into milestones Claude Code builds. No code, no dates: each milestone gives its cost (S, M, L) and shape, never a schedule (Daniel's rule), and Daniel's order ruling below lets builders reorder freely. Designs, strings and hand-backs are copied beside this file in `cowork/` (`A4-COURSE-DESIGN.md`, `A6-TEXT-LICENSING.md`, `B3-DESIGN.md`, `F-SITE-REVIEW.md`, `A7-STRINGS.md`, `B3-STRINGS.md`, `A8-SAMPLE-LESSON.md`, `A3-INDEX.md`, `A3-VOICE-MODEL.md`, `A3-DRAFTS/`, `HANDOFF-TO-CLAUDE-CODE.md`, `QUESTIONS-2.0.md`, `STATUS.md`). `D-NOTIFICATIONS.md`, `B2-PRACTICE.md`, `C1-BETA-DEFINITION.md`, `C2-PILOT-KIT/`, `C3-FEEDBACK.md`, `A5-*` and `A3-TEACHING/` stayed in Cowork's folder (`C:/Users/dsbog/cowork-offload/2.0/`); they are not needed to build and are not copied. Rulings: `cowork/QUESTIONS-2.0.md` (binding, quoted below). App paths are relative to the repo root. Cowork read the app at `cfba020`; main is now at `0bfed42` and contains M3b, M4, M6 and v1.8.0, so every line reference into app code in the designs must be re-checked by the builder. **[Inferred]** marks anything not ruled or read in code.

## Cut, 2026-10-24 (supersedes everything below about D'var Torah)

- **D'var Torah is out of the app entirely.** Daniel: "No dvar Torah guide.. that all happens with the rabbi not in the app. Cut all related pieces. The app is just for study". No guide, stages, doc link, tracking or notices. Milestones DV1, DV2, DV3 and the D'var migration are removed; `cowork/B3-DESIGN.md` and `cowork/B3-STRINGS.md` are kept for the record only. The D'var rulings below (Batch 1 Q1, Batch 3 Q14, Batch 3b Q19, the B3-STRINGS "Keep all") are moot. A DV1 branch that had started was stopped and deleted unmerged.
- **Family logistics (Track E) stay out of the app.** "The app is just for study."
- **2.0 is 14 milestones:** G0 (done), F1–F6, SC1–SC7. Daniel restated the scope to Claude Code the same day: the service course open to everyone, Shabbat morning first, then Saturday evening with Havdalah; the path is the tutor's service plan or the six default parts; a short reading-Hebrew strand; transliteration on request; a per-part finished mark for tutors and rabbis, not parents; Claude-drafted glosses go live; the approved teachings credited "Rabbi Daniel Bogard" may sit in the public repo; licensed siddur text is never shown, stored or cached, and the course links to the siddur page; prayer text comes from a public build pinned by hash. Cut: melody audio (2.1), D'var Torah, family logistics, notifications, the second congregation (2.5). The beta label only on his word.
- **"Fix the public-page rate limit first."** F1 leads the order. SC2 (public text), SC4 (signed-in sync) and SC5 (finished mark) each get an adversarial review before merge.
- Cowork's updated `STATUS.md`, `HANDOFF-TO-CLAUDE-CODE.md`, `QUESTIONS-2.0.md` and `G-PLAN-2.0.md` (15:26 on 2026-10-24) are copied into `cowork/`; where they and this file differ on the cut, the cut wins.

## Settled decisions (Daniel, binding)

Rulings dated 2026-10-24 unless stated. The first block is what Cowork recorded; the second is new today (Batch 4 popups, answered to Claude Code).

### From Cowork's sessions

- **The service course is open.** Batch 1 Q2: "open". Licensed Beit Mitzvah text is never shown, stored or cached by the app; the course reaches it only through "Open in the siddur, page {page}".
- **Shabbat morning first, then Saturday evening with Havdalah.** Batch 1 Q3: "Go".
- **Teaching is drafted in Daniel's voice and approved by him.** "I want you to get my understanding and then draft each one for my approval…" and "Always a humanistic approach that leaves room for more theistic people to still resonate." All 49 are approved: 38 Shabbat morning (`A3-DRAFTS/01-…` to `23-38-…`) and 11 evening/Havdalah with edits to reused texts (`A3-DRAFTS/evening-33-63.md`, "Approve all").
- **Credit on approved teachings:** Batch 2 Q9, "Rabbi Daniel Bogard". His name alone. This overrides MISSION's generated-text label for approved teachings only; anything not yet approved still carries "Written by Claude for CRC · not yet reviewed by Rabbi Daniel Bogard".
- **No melody link and no audio in 2.0.** Batch 2 Q6: "No link yet. You should give me a list of things to record", then "I'll handle the readings here as a part of two point one". The "Hear it" step is out of 2.0.
- **A short reading-fluency strand.** Batch 2 Q7: "Yes, a short strand (Recommended)".
- **Transliteration on request.** Batch 2 Q8: "On request (Recommended)".
- **Tutors see a per-part finished mark.** Batch 3 Q12: "Per-part 'finished' mark".
- **Key-word glosses:** Batch 3 Q13: "Claude drafts, live (Recommended)".
- **D'var Torah lives in a shared Google Doc.** Batch 1 Q1: "it will be a shared Google doc." The app tracks stages, dates and the link.
- **Parents see D'var stages and dates, never the link.** Batch 3 Q14: "Stages and dates (Recommended)".
- **No notifications at 2.0.** Batch 3 Q11: "None yet".
- **Path = the tutor's service plan.** Batch 3b Q16: "Tutor's service plan (Recommended)". Falls back to the six default parts when there is no plan.
- **Approved teachings may live in the public app repo.** Batch 3b Q17: "Yes, public is fine (Recommended)".
- **Parents do not see the per-part finished mark.** Batch 3b Q18: "No (Recommended)". Tutors and rabbis only.
- **D'var Torah sign-off.** Batch 3b Q19: "Rabbi owns feedback and final (Recommended)". Tutors may mark feedback given; only a rabbi approves the final text; no free-text focus line is stored.
- **Text source for the course.** Decided by Cowork as a build detail (QUESTIONS-2.0.md, Batch 3b note): a public build of the Shabbat Morning volume (the public mirror's feed or a public-lane build), pinned by hash, never the licensed build. Daniel approved showing that book's text (Batch 1 Q2, "open").
- **Beta is Daniel's word.** Batch 1 Q5: "beta when I say so". Nothing in 2.0 waits on or turns on the beta label or indexing. v1.5.0 is an ordinary version, not the beta tag.

### New rulings, 2026-10-24 (Batch 4 popups, to Claude Code)

- **A7-STRINGS (service course, 252 strings): "Keep all".** `cowork/A7-STRINGS.md` is approved as written, except the `au.*` (Hear it) strings, which stay unused until 2.1.
- **B3-STRINGS (D'var Torah): "Keep all".** `cowork/B3-STRINGS.md` is approved as written.
- **The F-fix lines: "Keep all".** The 429 message, the uninvited sign-in line, "Tap verse numbers to choose them.", "Sign in to save", and "page 23, after Mi Shebeirach", as proposed in `cowork/F-SITE-REVIEW.md` and its strings section. Batch 4 is therefore closed; no copy waits on Daniel except the pilot kit.
- **Prayer text comes from CRC's own texts in the shireishabbat and shirei-tfilah repos.** Daniel, verbatim, on the evening-only prayers' text: "Shouldn't they be in shireishabbat shirei tfolah repo for the actual CRC texts the kids have in the beit Mitzvah siddur? That's what we want". Recorded as: the course's prayer text, morning and evening/Havdalah alike, comes from CRC's own texts in the shireishabbat and shirei-tfilah repos, **public lane only**. The licensed Beit Mitzvah build never enters the app or this repo. **Builder duty (SC2 for morning, SC7 for evening and Havdalah):** confirm which evening and Havdalah texts exist in the public lane before building a Read step on them. Any prayer whose text exists only in a licensed lane is not shown; it goes back to Daniel as a licence question (stop-and-ask rule), and meanwhile ships as About, Where and the siddur link only. This replaces the earlier plan to fall back to Sefaria per prayer.
- **Order is the builders' call.** Daniel, 2026-10-24: "I don't care about order. Feel free to reorder however, and continue until they are all finished." The milestone order below is a suggested order, not a gate; dependencies still bind.

## Where a design file conflicts with a later ruling (the ruling wins)

| File and place | What it says | Ruling that replaces it |
|---|---|---|
| Brief §2 "Daniel's teaching"; RM2 Q19–Q20 | Claude does not write teaching; gaps stay gaps | Teaching ruling, 2026-10-24 (above). All 49 approved; there are no gaps to ship around |
| STATUS.md "For Claude Code" bullet | "[Inferred: whether approved teaching carries any credit line is Daniel's call]" | Batch 2 Q9: "Rabbi Daniel Bogard" |
| REVIEW ruling 51 | Prayer audio links out to CRC Music | Batch 2 Q6: no link in 2.0; Daniel records in 2.1 |
| REVIEW ruling 45 | "nothing finer than days-practiced is reported to anyone else" | Batch 3 Q12 widens it for the service course only: a per-part finished mark |
| A4 §1 last sentence | "A tutor sees the days a student practised, and nothing finer unless Daniel chooses otherwise" | Batch 3 Q12 (A4 §9 already carries the ruling; §1 is stale) |
| D-NOTIFICATIONS §0 and §8 | Switch on one tutor notice for D'var stages at 2.0 | Batch 3 Q11: "None yet" (the file's header already says so) |
| B3 §3.3 "My recommendation" | Parents: recommended stages and dates | Decided, Batch 3 Q14 |
| B3 §4.3 and A4 §6.2 | Both claim migration `0043` | Renumbered below; numbers are proposals only |
| MISSION L36, L52; STATE L3; SPEC L298, L306; RM2 L28 | v1.5.0 is the beta tag; 2.0 is "out of beta" | STATE L30 and Batch 1 Q5. MISSION was never amended until G0 (done 2026-10-24) |
| A4 §2.1 note 2; G-PLAN question 9 (this file's earlier text) | Evening-only prayers use Sefaria liturgy per prayer where it exists | Batch 4, 2026-10-24: text comes from CRC's own texts in the shireishabbat and shirei-tfilah repos, public lane only (see Settled decisions) |
| COWORK-HANDOFF.md and `../2026-10-23-cowork-offload/ROADMAP-2.md` ("Claude does not write that teaching fresh") | Gap for Daniel, no invented paragraph | Teaching ruling, 2026-10-24; all 49 approved |
| MISSION and REVIEW reserved name `dvar_torah_draft` | An empty reserved kind or table for in-app D'var drafting | Batch 1 Q1: shared Google Doc, no drafting in the app. `dvar_torah_progress` (DV1) replaces it; the name `dvar_torah_draft` is retired |
| COWORK-HANDOFF.md L101 and L369 | Learn-to-lein spec at `docs/superpowers/specs/2026-10-22-learn-to-lein.md` | No such file. The plan is `docs/superpowers/plans/2026-10-22-learn-to-lein.md`; the course docs are in `docs/planning/2026-10-22-learn-to-lein/` |
| Brief Batch 3 Q13 "pilot kit, approved or edited" | — | Never asked; Batch 3 Q13 became the glosses question. The pilot kit has no approval on record (open) |

## Decided here

1. **One plan, four lanes.** Service course, D'var Torah, 2.0 fixes, docs. Notifications and family logistics contribute no build.
2. **The fixes lane starts first with F1** (rate limit), because the course's Read step adds public text calls to the same limiter that F-SITE-REVIEW finding 1 shows tripping in ordinary browsing.
3. **The personal path rides with the signed-in sync (SC4), not with the finished mark,** as A4 slice 4 had it. The finished mark is its own slice (SC5) so its adversarial review is not diluted.
4. **The D'var settings function change ships in the D'var table's migration,** not a migration of its own (B3 had them as separate slices M1 and M2).
5. **Teachings enter the repo verbatim** in `src/lib/service-course/tenants/crc.json`, each with its approval date (A4 §5.2). They are Daniel's own text, not licensed text. Decided: Batch 3b Q17, "Yes, public is fine (Recommended)" publishes them with the repo.
6. **Model per milestone:** Opus for every adversarial slice and its review; Sonnet for the rest, as the 1.8 plan did.

## Migrations (confirmed against main on 2026-10-24; renumber at merge)

**Confirmed:** the newest migration on main (`0bfed42`) is `0042_curated_discussions.sql` (the journal holds 43 entries, 0000–0042), so **the next free number is 0043**. Both in-flight PRs add no migration: #71 (`review/patch-1-8-1`, 1.8.1 review defect fixes) and #72 (`review/fix-ad01-refresh-loop`, AD-01 refresh loop) touch no file under `src/server/db/migrations/`. Draft PR #22 (`claude/listening-review`, parked for the voice work) carries a `0034_listening_review.sql` that collides with main's existing `0034_crc_torah_production_host.sql`; it must renumber when it revives, which is outside 2.0. Re-run `ls src/server/db/migrations` and `gh pr list` before taking a number.

Numbers are taken at merge; whoever merges second renumbers (house practice, learn-to-lein plan item 23). The numbers below are proposals for planning only. The file names do not change when the number does.

| Proposed (renumber at merge) | File | Slice | Review |
|---|---|---|---|
| 0043 | `0043_service_course_progress.sql`: owner-only copy of 0037 (A4 §6.2 Migration A) | SC4 | Adversarial: privacy |
| 0044 | `0044_course_text_catalog.sql`: tenant-scoped public-lane store with a `volume` column and a public-lane check (A4 §6.2 Migration B) | SC2 | Adversarial: licensed text |
| 0045 | `0045_service_part_finished.sql`: staff-readable, insert-only, forced RLS (A4 §9) | SC5 | Adversarial: privacy |
| 0046 | `0046_dvar_torah_progress.sql`: the table, RLS, audit actions, and `portal_tenant_settings_valid` gaining `dvarTorah` (B3 §4.3, which numbered it 0043) | DV1 | Adversarial: privacy |

No migration for practice days (0018 already takes a `service-unit` target) or for the path (it reads 0015 as is). No notification migration.

**As built:** `0043_course_text_catalog` (SC2, #77), `0044_portion_summary` (1.9 N6, #75), `0045_service_course_progress` (SC4). SC5's table takes the next free number on main when it starts.

## Milestones in build order

Sizes: S is a day-sized slice for one builder, M a few, L a week-sized slice. [Inferred] These are relative cost, not calendar.

### G0. Docs catch up with the rulings (S, Sonnet, docs only)

- Amend MISSION and STATE: the beta lines (RULINGS-DIGEST §h item 1); the teaching ruling and credit rule; ruling 45 widened for the course; ruling 51 replaced for 2.0; `dvar_torah_draft` retired in favour of `dvar_torah_progress` (B3 §4.1), citing Daniel 2026-10-24; the bad learn-to-lein spec path (§h item 12).
- Confirm the next free migration number on main and fix the table above in this plan's copy in the repo.
- **Exit test:** no repo doc still says v1.5.0 is the beta tag or that Claude may not write teaching; the migration numbers are confirmed against main.
- **Done 2026-10-24.** MISSION and STATE carry dated amendments; migrations confirmed (next free is 0043); the plan and Cowork's designs are imported under this folder. Older planning documents that still carry the superseded wording (SPEC, the 1.5 research and plan files, ROADMAP-2, COWORK-HANDOFF) are historical and point to the MISSION amendment where it matters.

### 2.0 fixes ("anything the beta teaches us", from F-SITE-REVIEW)

The five top items, plus the polish that is cheap while those files are open. New strings these fixes need are drafts for Batch 4.

**F1. Public routes and the rate limit (M, Sonnet, second-agent check).** F-SITE-REVIEW finding 1.
- `Cache-Control: public, s-maxage` on the public text, commentary and word routes, so repeat reads never reach the limiter; a shared address is not one user; Study fetches commentary per reading, not per chapter and work.
- A 429 gets its own message; "The recording did not load" stays for a real audio failure.
- Check by a second agent: no private, signed-in or no-store route gains a public cache header.
- **Exit test:** the walk in finding 1 (/read, Study, Vayera, /print, first lesson) runs twice in a row without a 429, and a forced 429 shows the rate message, not the recording one.
- **Decided here (F1, built):**
  - The 429s come from the Vercel Firewall rule `rule_public_reading_rate_limit_4G2hTb` (waf_0VwRXd9QWcKV v1: path prefix `/api/public/`, fixed window, 120 requests per 60 s, keyed on IP alone, then 429), read through the Vercel API on 2026-10-24 and not changed. The app has no limiter of its own. That rule counts every request that reaches the edge, a CDN hit included, so `s-maxage` alone cannot keep a repeat read from it; only a browser that already holds the answer sends nothing.
  - The public routes already sent `public, max-age=300` and `s-maxage`. F1 keeps the complete, pinned answers (text page, word aids and details, short page, commentary with an edition, a complete translations set, a source text) in the browser for an hour and lets the CDN serve them stale for a day while it asks again (`KEPT` in `src/server/http/public-reading.ts`). The reading, aliyot, related, manifest, discussions and every partial, absent or failed answer keep their shorter lives or `no-store`.
  - The 429 line is the one Cowork proposed and Daniel approved ("Keep all"): "Too many requests from this connection. Try again in a minute." It shows on the Learn lesson, drills, Review and first verse, the Learn "This week" card, the reader (week, any reading, text page) and /print. A real audio failure and a 503 keep "The recording did not load. Try again."
  - Study still fetches commentary per chapter and work: that route is what gives every reader a 30-day CDN hit on the same URL, and a per-reading route would split that cache and reach the 2 MB response bound. Not a simple change; not done.
  - **For Daniel, platform only (not changed here):** the rule keys on IP alone, so a class or a family on one address is one user. Raising the 120 a minute, or keying on IP plus another field, is a Vercel Firewall change in the dashboard; it is also the only lever on the shared-address case, because the app cannot see the rule.

**F2. Dark mode (S, Sonnet).** Findings 2 and 4.
- **Exit test:** every trope-chart sample and every /read verse number and its focus ring measure at least 4.5:1 in the dark scheme.

**F3. A way to ask for an account (S, Sonnet).** Finding 3.
- **Exit test:** signed out, /, /sign-in and /account each show the route to the request form before sign-in.

**F4. Choose verses and print (M, Sonnet).** Findings 5 and 9.
- A second tap after one verse makes the range; the empty bar says how to choose; signed out, "Sign in to save" from the start; chosen verses and Torah/Haftarah carry into /print.
- **Exit test:** tapping 18:1 then 18:10 gives "Genesis 18:1–10", and /print from that selection prints those verses only.

**F5. The word card in Lein, and Hebrew for screen readers (M, Sonnet).** Findings 6, 7, 18, 24.
- Lein opens Learn's bottom-sheet word card; one tab stop for the words with arrow keys inside; each word's accessible name is the word, the action in `aria-describedby`; verse-numbered control names; 44 px verse-number targets.
- **Exit test:** at 390 px, tapping a word in Lein opens its card without scrolling; a screen reader reads the Hebrew word; keyboard focus reaches the page controls in under ten tab presses.

**F6. Polish batch (S, Sonnet).** Findings 10, 11, 12, 14, 15, 17, 19, 20, 21, 22, 23, 25, 27.
- Includes the Learn path's locked state (the service course reuses that path list), the blessings links on every reading, the haftarah page label, trope-chart copy, word-card gloss cleanup, the live region for drill feedback, and Quick ten's tab title.
- **Exit test:** each listed finding re-walked and closed or recorded as left, with its reason.

Left for Daniel, not built: finding 8 (holiday readings are the traditional two-day list) waits on which readings CRC uses (ROADMAP Q13, a 2.5 question); finding 16 (Rashi's old English) is a source choice.

### The service course

**SC1. Course skeleton, signed out, morning (L, Sonnet).** A4 §2, §3.2, §5, §11, §12, §13, §14 W1, W4, W5, W9; slice 1 of A4 §15.
- `src/lib/service-course/course.json` (U0–U6), `tenants/crc.json` with the 37 morning lessons' approved teachings verbatim (38 approved; 28 V'zot HaTorah is not in the BM book), the validator with every rule in A4 §5.3, including "no Hebrew outside the alphabet table".
- Home, lesson frame, About, Where, Done, moment lessons, the siddur link, browser progress.
- **Exit test:** every morning lesson opens at 360 px; a moment lesson is marked done; the tone scan passes over strings and teachings; the siddur link opens printed pages 10, 11, 22, 22, 23 and 24 for the six U1 lessons; a Hebrew prayer word added to `course.json` fails the build.
- **Built 2026-10-24 (branch `release-2-0/sc1-course-skeleton`).** Decided here: (1) the course lives at `/learn/service`, out of every nav, noindex, and the strand of letters (U0, f1-f6) is in `course.json` behind `features.fluency: false` until SC3 (its goals for f1, f3, f4, f5 are marked TODO because A7 has none; the validator refuses a TODO goal once the flag is on). (2) The service course does not import Learn to lein's `course.ts` or components: it forks `CourseError` and `presentGoal` and has its own small icons and app bar, so a course page never carries the 115 KB trope course. (3) A lesson's `section` is the Where-map unit it sits in (the Sh'ma and V'ahavta sit in "The Sh'ma and its blessings" although listed in U1). (4) Done's "Next" is the next undone lesson after this one in unit order, falling back to the home's Next. (5) Prayer goals use A7's `done.goal` template with the title for `{prayer}`; SC2 replaces them with per-lesson goals (A8 style) when Read and Key words exist. (6) `scripts/repo-policy.mjs` gained an exact allow-list for the two course data files with a Hebrew-only-in-the-alphabet guard (escaped and shadowed-key forms refused); the guard was added, nothing weakened. (7) `about.p2` ("The Hebrew here comes from Shirei Tfilah") and the Done goal describe SC2 behaviour; the course is not linked from anywhere until SC2 lands.

**SC2. Public prayer text (L, Opus, adversarial: licensed text).** Also confirms, for the morning, that the pinned public build is CRC's own text from the shireishabbat or shirei-tfilah repos (Daniel, Batch 4). A4 §5.4 (feed fork), §6.2 Migration B, §7, §8.2; A6 "Things Claude Code must check"; A8 (the Sh'ma end to end).
- Migration 0044, `src/server/service-course/public-feed.ts` (public volume, public lane, `tr` kept), `GET /api/public/service-text?unit=`, Read with the two toggles, Key words (glossary and `torahRef` cards), Check. About 150 glosses, Claude-drafted, live (Batch 3 Q13).
- **Unblocked:** text source is a public build of the Shabbat Morning volume pinned by hash, never the licensed build (A4 Q1, decided).
- **Exit test:** no response of the new route ever carries a `legacy-beit-mitzvah` unit or a licensed-lane block; the Mi Shebeirach public unit is refused (A2 discrepancy 13); the A8 Sh'ma lesson runs screen for screen as written.
- **Built 2026-10-24 (branch `release-2-0/sc2-public-text`).** Decided here:
  1. **The pinned build.** The public mirror (`RavBogard/shirei-tfilah`) has no successful build of the Shabbat Morning volume to pin: its sync commit `b710706` failed CI and its Pages site answers 404. The pin is therefore the producer repo's own public-lane artifact: `RavBogard/ShireiShabbat` CI run `35741258239` at `edfef85e1e06737d5fea1c33970f23961f599fc5`, artifact `shabbat-shacharit-edfef85` (id 10699992434), feed sha256 `aca598e7e6e202b7a64c9ef244f83b17b7f87cfa24265a5b99f5b19a65dc4e6b`. Its feed declares `printing.source.lane: "public"`, licence CC-BY-NC-SA-4.0, and carries the public placeholder Mi Shebeirach. It is the same run and commit as the app's licensed Beit Mitzvah pin (`booklet-projector.ts`), but a different artifact; `dist-app` is never read. The pin lives in code (`src/server/service-course/pin.ts`): a stored row must equal it key for key on every read, and its bytes are hashed against it once per server instance, on first read, so no operator row can show other text without a reviewed code change. The GitHub artifact expires 2026-12-21; the operator import must copy it before then.
  2. **Migration `0043_course_text_catalog.sql`**, the next free number on main when SC2 started (the plan proposed 0044). SC4's progress table and 1.9 N6 also add migrations; this one keeps 0043 and #75 (N6) renumbers to 0044 (coordinator, 2026-10-24). Two tables, `course_text_catalog` and `course_text_lifecycle`: tenant-isolated, forced row security, runtime SELECT only, catalog immutable, one active build per congregation and volume. The database's own CHECKs refuse a licensed lane, a `legacy-*` or `crc-*` volume, a `-LICENSED` source, any artifact name but `<volume>-<commit7>` (so never `dist-app`) and any pin key it does not know. Nothing was run against production. **Before the deploy that carries SC2, import the pinned bytes:** download the artifact into `.course-text/` (`gh run download 35741258239 -R RavBogard/ShireiShabbat -n shabbat-shacharit-edfef85 -D .course-text`; git ignores that folder and repo-policy refuses it, PDFs included), then `DATABASE_MIGRATION_URL=… node scripts/import-course-text.mjs --file .course-text/shabbat-shacharit-feed.json --tenant crc`. The script hashes the file against the pin before it connects, writes the catalog row and the active lifecycle in one transaction, does nothing on a second run, refuses when a different build is active, refuses to re-activate a withdrawn or superseded build unless `--reactivate` is passed, never touches `service_catalog` and prints only fixed messages (tested in `tests/app/course-text-import.test.ts`). Until the import runs, the route answers 503 and the 30 Read lessons show "The prayer text did not load. Try again." The course is still unlinked, so no learner meets it.
  3. **The route** `GET /api/public/service-text?unit=&build=` sits in the F1 public allowlist with F1's KEPT headers (browser an hour, CDN a day stale-while-revalidate) for a complete answer and `no-store` for every failure. `build` must be the pinned source sha (`SERVICE_TEXT_BUILD`, tested equal to the pin), so a moved pin moves every URL and no cache can pair an old build's lines with a new course file's word indices (adversarial review finding). Taking a build down quickly still needs a CDN purge of `/api/public/service-text`. It refuses, before the database, any unit course.json does not name (exactly 30) and anything matching `mi-shebeirach`. The public runtime reads only `course_text_*` in its tenant transaction; it never reads `service_catalog`.
  4. **The parser fork** (`src/server/service-course/public-feed.ts`) shares only the bounded pre-parse scanner with the licensed parser (exported from `feed.ts` unchanged). It accepts one public volume, keeps `tr`, fails closed on any key or block shape it does not know, and drops the Mi Shebeirach unit at parse. A line is a block with Hebrew; an English block joins the last line it translates; footnotes, rubrics, labels, folios and pages never leave it. The tallit blessing is the volume's front matter, addressed as `front.tallit@shabbat-shacharit`.
  5. **Which prayers show text.** 30 of the 37 morning lessons: modeh-ani, tallit, mah-tovu, hineih-mah-tov, birchot-hashachar, chatzi-kaddish, barchu, yotzeir-or, ahavah-rabbah, shma, vahavta, mi-chamochah, tfilah, avot-vimahot, gvurot, kdushah, vshamru, avodah, hodaah, sim-shalom, oseh-shalom, torah-before, torah-after, haftarah-before, haftarah-after, eitz-chayim, aleinu, mourners-kaddish, adon-olam, closing-blessing. Siddur link only: psukei-dzimrah (the public volume splits it into many units; no single public unit) and mi-shebeirach (licence question below). The five moments have no Read. Line ranges are short (one to eight lines); every key word's line, word index and transliteration alignment was checked locally against the pinned build.
  6. **Mi Shebeirach is refused in four places:** the course validator (no read unit may match `mi-shebeirach`), the route's cheap check, the parser (dropped), and the answer projection. Its lesson never requests text.
  7. **Key words and glosses.** 179 glosses over the 30 lessons (three to six each), drafted by Claude from the volume's English and standard lexicons and live (Batch 3 Q13), roots in Latin letters. The validator now requires three to six key words and a Check for every Read, no gloss or word twice, and a `torahRef` with its `block` and a single verse. Seven lessons have a verse line (Mah Tovu, Sh'ma, V'ahavta, Mi Chamochah, K'dushah, V'shamru, closing blessing); the client loads that verse through `/api/public/text`, finds the line's words in it by their letters (the divine name in either spelling, one place only), and opens Learn's own word card; any other key word, or a verse that does not load or align, opens a small glossary card.
  8. **Check** is built at runtime (`src/lib/service-course/check.ts`) as A4 8.2 says: reading items only on aligned lines and never on the divine name, meaning items from the key words, about half each. It forks Learn's run rules (a miss comes back three to five items later, at most twice) because `run.ts`'s re-ask spacing reads trope drill items. Nothing is counted.
  9. **Goals.** Every prayer keeps A7's `done.goal` template; the Sh'ma takes A8's goal ("After this you can read the Sh'ma's first line and say what its key words mean."). Word cards (`word:{lesson}:read/meaning`) and Review stay with SC3: Done does not add cards yet.
  10. **States.** Read waits for the text: Next stays disabled until it loads; on failure it shows `st.text.error` (or F1's 429 line) with Try again, and Done marks a Read lesson only once its text loaded. The transliteration and English toggles are off by default.
  11. **Guards added, none loosened.** `scripts/repo-policy.mjs` now refuses any `dist-app/` path, any `*-feed.json` or `feeds.json`, a feed's shape inside an allowed data file, and licensed-lane markers (`"lane": "licensed"`, `-LICENSED"`, `laneWhy`). A source scan test keeps the course modules and the public runtime off `service_catalog`, the licensed parser and `dist-app`, and keeps Hebrew prayer words out of course source (escaped letter ranges only).
  12. Two test-only fixes: `discussions-migration.test.ts` now migrates through 0042 only (it compared every policy after the whole folder, so any later migration broke it), and one assignment in `service-feed.test.ts` is cast explicitly because the native TypeScript checker flagged it depending on file order.
  13. **Adversarial review (second Opus agent, 2026-10-24): accept with fixes, no blockers.** Fixed: the build key in the URL (item 3); the operator import script (item 2); only prayer-text block types become lines, Hebrew in an English block or rubric now fails the build; a cached parse no longer re-reads the 2 MB bytes, and the pin comment says what is actually re-hashed (each instance's first read). Left, recorded: the 0043 CHECK does not repeat the code's format checks on `artifactRepo`, `artifactRunId` or the sha prefix (defence in depth only; the code pin is exact); repo-policy's feed-shape rule covers data files only, as before; the Read credit shows A7's "Text: Shirei Tfilah, CC BY-NC-SA 4.0." without the feed's attribution line (CRC is the licensor; revisit for a second tenant).
- **For Daniel (licence question):** CRC's printed Mi Shebeirach (Beit Mitzvah book p. 23) is the Friedman/Setel setting, licensed to CRC only; the public volume prints a classical-formula placeholder instead. The course shows neither and links to page 23. Is that what you want, or should the lesson show the public classical formula with a note that CRC sings a different setting?
- **String gaps (TODO, no approved draft):** a label for a key word's root on the glossary card (it shows the bare root); a goal for the two link-only prayers (they keep A7's template, which mentions key words they do not have). `read.newToHebrew` is not shown while the fluency strand is off.

**SC3. Reading Hebrew, Review and Quick ten (M, Sonnet).** A4 §4, §8.3, §8.4; W10–W12.
- f1–f4 need only SC1; f5–f6, Review of word cards and Quick ten need SC2.
- **Exit test:** the six fluency lessons run in order with no audio; Quick ten opens only after three prayers with a Read step or after f6; nothing on screen counts right answers.

**SC4. Signed-in sync and "Your parts" (L, Opus, adversarial: privacy and auth).** A4 §6.1–6.3, §8.1; W2, W3.
- Migration 0043 (owner-only), the progress routes and sync forked from Learn's with every shared-device and sign-out rule, the path route `GET /api/learn/service/path`, Your parts and its seven states.
- The path route drops each unit's `name` and `caption`, which come from the licensed feed (A4 §6.3 step 3).
- **Unblocked:** the path is the tutor's service plan (0015), with the six default parts when there is no plan (A4 Q3, decided; the Music list in 0025 is not used).
- **Exit test:** staff, Daniel, MCP, cron and the Sheet read no row of 0043; a shared device never folds another account's progress in; a signed-in student sees their assigned parts in service order with their own pages; no path response carries a licensed name or caption.
- **Built 2026-10-24 (branch `release-2-0/sc4-course-sync`).** Needs the adversarial privacy and auth review before merge. Decided here:
  1. **Migration `0045_service_course_progress.sql`**, the next free number on main (0043 is SC2's, 0044 N6's). A copy of 0037 with its own table, its own document check (`service-course-progress/v1`, 96 KB) and its own owner setting `app.service_course_owner`, set in one statement in `src/server/service-course/progress-access.ts` after the eligibility check. Forced row security, one `owner_only` policy, SELECT and INSERT plus UPDATE of `progress`, `version` and `updated_at` only; no DELETE, TRUNCATE or audit rows. SQL sha256 `5765d90aab4e8bd9b7a2e8a350b96489d5d846d98a7ac9c71e1511e7d2f7556d`. Nothing was run against production; the scratch operator (check, apply, verify, on 0044's model) checks the ledger at 45 with the journal at 46, TLS, the reviewed hash, then after the apply: ledger 46 with 0045's hash, forced RLS, the one policy and its exact expression, the grants, no PUBLIC grant, no trigger, the six constraints, an empty table, the nine newest tables and their rows unchanged, and tenants, hosts, audit, students, grants and memberships unchanged.
  2. **Progress routes** `GET /api/learn/service/progress`, `POST …/put`, `POST …/merge`: Learn to lein's contract (plan item 25) and eligibility (any live grant, or an approved Member; plan item 35), the same refusal naming only the refused account's own owner, `private, no-store` on every answer. Its own owner-name namespace and write-lock key, so neither course can name or lock the other's document. A signed-in student's own ceremony date comes back for the review cap the two courses share (A4 8.1). Learn to lein's progress does not carry over, in either direction.
  3. **Sync.** `src/components/learn/service/progress-sync.ts` is Learn's sync with only its routes and marker key (`crc-torah:service-sync/v1`) changed, so every shared-device and sign-out rule is the same code; the course's pages start it once per page. "Progress is saved on this device. Sign in to keep it." shows only until the account is synced, its "Sign in" a link to `/sign-in` as on Learn's home. No return address: N20's list does not include `/learn/service`, and widening it is an auth change left for its own review.
  4. **The path route** `GET /api/learn/service/path` (private, no-store, no query, no body) composes two existing reads and adds no authority: `listStudents` in student mode (the account's own student through its live student grant and student link; no practice context), then the service-learning `metadata` read in student mode, which re-checks the relationship. Exactly one student of one's own, or 403; signed out 401; a congregation without a course file 404; a plan that moves during the read is read once more, then 503. It answers `state`, `slot`, `review`, `items` (lesson id and printed page), `serviceStart` and the plan's own ids, copied field by field. Each unit's `name`, `caption` and section never leave the server. `src/server/service-course/path.ts` imports nothing of the service-learning side; the composition hands it the `metadata` read, so SC2's licensed-text source scan stands as it was.
  5. **Pages.** An assigned part shows its own printed page from the student's plan. With no plan, the six default parts show the congregation file's pages for the student's slot; an unset slot shows the morning's with `st.slot.unknown`; an evening student gets no page until SC7 adds the evening pages, rather than a morning page passed off as theirs.
  6. **Only six lessons carry Beit Mitzvah unit ids** in `tenants/crc.json` (the six default parts), so a tutor's other parts (Aleinu, Adon Olam and so on) are left out of Your parts silently, as A4 6.3 step 4 says. Adding the rest needs the licensed feed's unit ids (ids only, no text); that is for whoever next holds the feed (SC7 at the latest).
  7. **Student mode only.** A parent practising with a child sees the course without Your parts: the course pages carry no practice context, and the parent's progress is their own document.
  8. **Your parts** follows W2 and W3: loading, the list (heading, line, review line, slot line, each part's own page, the whole service's first page), no plan, cleared, withdrawn and error, and nothing at all signed out or for an account with no student of its own. Next is the first undone of the student's parts; Done says "Next of your parts: {lesson}" while one is left. "The whole service" heads the units below a Your parts answer. The path is held in memory per page; its offline copy is SC6's.
  9. **Tests:** the migration (`service-course-progress-migration.test.ts`: adds only its table, replays, Learn's row untouched, forced RLS as portal_runtime, Learn's and the saved layer's owner settings open nothing), the routes and the path (`service-course-progress.test.ts`), the staff and MCP canary, the browser sync (Learn's whole suite on the new routes), the path's pure half and Your parts' states (`service-course-path.test.ts`), the structural guards (`service-course-progress-structure.test.mjs`), and real-PostgreSQL RLS and lock races (`tests/postgres/service-course-progress-*`, run in CI).
- **Wording gaps (no approved string; nothing invented):** W2's short page label ("p. 10") is not in A7, so each part shows the approved "Open in the siddur, page {page}" instead; a plan whose parts map to no lesson shows only the heading and the whole-service link, since A7 has no line for it; there is no line for a parent practising with a child.

**SC5. Per-part finished mark (M, Opus, adversarial: privacy).** A4 §9; W13; A7 `tu.*` strings.
- Migration 0045; written only from the Done screen of one of the student's own assigned parts, as a side effect of sync; readers are the student, a parent in child practice, assigned tutors, rabbis and admins. Parents never read it (P1 decided: No).
- Depends on SC4.
- **Exit test (A4 §9):** no row across students or tenants; a tutor without an active `tutor_student` row reads nothing; a parent in parent view reads nothing; no route, MCP tool or export returns the rows to anyone else; a lesson outside the student's parts writes nothing.

**SC6. Offline (M, Sonnet).** A4 §10; W14.
- The `service-course` pack (public lane only), the shell pages, the offline states.
- Depends on SC2 (and SC4 for the path's last copy).
- **Exit test:** installed, with the network cut inside 14 days of the last open, a done lesson's Read, Key words and Check work; the siddur link reads "Needs a connection"; the licensed book is never requested.

**SC7. Saturday evening and Havdalah (L, Sonnet).** A4 §2 (U7, U8, evening reuse), A6 last bullet.
- The 11 new evening teachings and the edited reused ones from `A3-DRAFTS/evening-33-63.md`; evening pages per lesson; the slot picks the version (signed out: morning).
- Prayer text for evening and Havdalah comes from CRC's own texts in the shireishabbat and shirei-tfilah repos, public lane only (Daniel, Batch 4). **First task:** confirm which evening and Havdalah texts exist in the public lane. Where one does, build its Read step like the morning's. Where a text exists only in a licensed lane, show nothing of it, ship that prayer as About, Where and the siddur link only, and send Daniel a licence question (stop-and-ask). The Sefaria fallback in A4 §2.1 note 2 is superseded.
- **Exit test:** a Havdalah-slot student's parts link to pp. 33–63 and show the evening teaching; the morning lessons are unchanged for everyone else.

### D'var Torah

**DV1. The D'var link table and its API (M, Opus, adversarial: privacy).** B3 §2.2, §2.3, §3, §4.
- Migration 0046: `dvar_torah_progress` (append-only, no text column; `doc_id` only), RLS, audit actions `dvar.link-set`, `dvar.link-clear`, `dvar.stage-set`, `dvar.dates-set`, and `dvarTorah` in the settings function; the TS settings key; role-scoped read and compare-and-set write.
- Deploy before DV2, as 1.8 deployed field acceptance first.
- No focus line (B3 Q2 decided): `marks` carries no free text. The rabbi owns `feedback` and `final`; tutors may mark `feedback` given (B3 Q3 decided).
- **Exit test (B3 §10):** no `doc_id` across students or tenants; a tutor without `tutor_student` gets 404; a parent in parent mode gets stages and dates and no `doc_id`; a stale write gets 409; the doc id never appears in logs, audit rows, mail or any MCP result; published-to-web, Sheets, Drive-file and non-Google links are refused.

**DV2. Learner and tutor screens (M, Sonnet).** B3 §5, §6.1, §6.2; B3-STRINGS.
- **Exit test:** every state in B3 §6.1–6.2 at 360 px; the link opens with `noreferrer`; dates move when the ceremony date changes and overrides stay; the offline message shows and nothing is cached.

**DV3. The rabbi's list, the parent summary and the stage settings (S, Sonnet).** B3 §6.3, §6.4, §7.
- **Exit test:** "Waiting on you" follows B3 §6.3's rule and order; the parent summary shows stages and dates and no link; a bad stage list is refused with field names only.

Stage defaults are B2's placeholders until CRC's own list arrives with the binder; they are settings, so the binder changes data, not code.

## Dependencies

```
G0 ─────────────────────────────────────────────(docs; any time, before SC2/SC4/SC5/DV1 merge)
F1 ──► SC2 (the course adds public-text calls to the same limiter)
F6 (locked path state) ──► SC1's path list
SC1 ──► SC2 ──► SC3 (f5–f6, Review, Quick ten) ──► SC6
SC1 ──► SC3 (f1–f4)
SC1 ──► SC4 ──► SC5
SC4 ──► SC6 (path's offline copy)
SC1, SC2 ──► SC7
DV1 ──► DV2 ──► DV3
```

Nothing is blocked on Daniel: SC2 and SC4 are unblocked (Batch 3b).

## What runs in parallel (3–4 builders)

| Lane | Order |
|---|---|
| 1. Fixes | F1, then F2–F6 in any order |
| 2. Course content | SC1, then SC2, SC3, SC7 |
| 3. Course accounts | after SC1: SC4, SC5, then SC6 |
| 4. D'var Torah | DV1, DV2, DV3; G0 fits here first |

The four migrations land in four lanes; renumber on merge. Each adversarial slice gets its review from a second Opus agent before merge, as the 1.8 M2 and learn-to-lein slice 3 did.

## High-stakes slices: adversarial review

| Slice | Why | What the reviewer attacks |
|---|---|---|
| SC2, public text | Licensed text | Any path by which a `legacy-beit-mitzvah` or licensed-lane block reaches the new route, the pack or the repo; the mixed Mi Shebeirach unit; the build's Hebrew guard |
| SC4, signed-in course sync | Auth and privacy | Owner-only RLS on 0043; shared-device and sign-out rules; the path route leaking licensed names or another student's plan |
| SC5, per-part finished mark | Privacy (widens ruling 45) | Readers beyond the ruled set; cross-student and cross-tenant reads; writes for parts not assigned; parent view |
| DV1, the D'var link table | Privacy (a child's document address) | `doc_id` reaching parents, logs, audit, mail, MCP or another student; link shapes that make a doc public |

F1 gets a lighter second-agent check: public cache headers on public routes only.

## Explicitly out of 2.0

- **Melody audio and recordings: 2.1, Daniel handles them** (Batch 2 Q6). The `hear` step exists in the schema and is refused by the validator while `recordings` is false (A4 §5.3 rule 7). `A5-RECORDING-LIST.md` is Daniel's list.
- **Notifications: none** (Batch 3 Q11). `PORTAL_NOTIFICATIONS_ENABLED` stays unset; no congregation switch turns on. `D-NOTIFICATIONS.md` is the design for later.
- **The second congregation: 2.5.** Designed per tenant (A4 §12, B3 §2.2), nothing built for it.
- **Family logistics (Track E): outline only, waiting on the binder.** No build.
- **Voice work, megillot, High Holy Day trope, blessings:** 2.5.
- **The beta label and indexing:** on Daniel's word only; no 2.0 slice touches `PUBLIC_INDEXING`.
- **Claude access to D'var drafts or links:** none (B3 §9).
- **A per-word morphology source for liturgy:** not proposed (A4 §7).

## Questions still open (one line each, recommendation first)

Decided 2026-10-24, Batch 3b (removed from this list): A4 Q1 (public build of the Shabbat Morning volume, pinned by hash), A4 Q3 (tutor's service plan, default six as fallback), A4 P1 (parents don't see the finished mark), B3 Q2 (no focus line), B3 Q3 (rabbi owns feedback and final; tutors may mark feedback), and the public repo question (approved teachings may live in the public app repo).

6. **The binder** (B2 stage list and dates; Track E): still not supplied. Daniel: "We will develop and find and create the dvar guide next."
8. **The pilot kit** (`C2-PILOT-KIT/`, in Cowork's folder): keep or edit; the pilot starts on Daniel's word.
11. **D Q2, do students still type in "My translation"?** Matters only when notifications go on; not blocking.

Decided 2026-10-24, Batch 4 (removed from this list): question 7 (A7, B3-STRINGS and the F-fix strings: "Keep all") and question 9 (evening-only prayers' text: CRC's own public-lane texts; licensed-only ones come back to Daniel as a licence question).
