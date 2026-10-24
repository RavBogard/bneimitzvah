# 1.8.2, 1.9 and the rest of 2.0: one combined build plan (CRC Torah)

Written 2026-10-24 from the product review (`../2026-10-24-product-review/REPORT.md`, "the REPORT"), its brief, the redesign direction (`REDESIGN.md` and mocks, in the review's scratchpad; its substance is REPORT §2.4) and the 2.0 plan (`../2026-10-24-release-2-0/PLAN.md`, including its "Cut" section of the same day). This is a plan only. It contains no product code, no dates and no schedule: sizes are relative cost (S is about a day for one builder, M a few days, L about a week). Daniel's order ruling lets builders reorder freely. Dependencies still bind, and so does the file-ownership rule below.

Main at writing: `a9bbd6e`. Live: v1.8.0 (`7c13cac`), prod ledger 43 (newest migration `0042_curated_discussions`). In flight: PR #71 (1.8.1 defects), PR #72 (AD-01 refresh loop), PR #73 (2.0 SC1, the course skeleton), and F1 (rate limit, started by a separate builder). The DV1 branch was stopped and deleted unmerged when D'var Torah was cut.

## Settled decisions (Daniel, binding)

### The fifteen review decisions (REPORT §6, 2026-10-24 popups, verbatim)

1. **Tab bar and Today:** "Yes, tab bar + Today". Bottom tab bar for signed-in roles; student Today · Reading · Learn · Account; a Today screen with one next step. (Option (a) also fixed the other roles "as in §2.4": Parent Today · Practice · Honors · Account; Tutor This week · Students · Lessons · More; Rabbi/admin This week · Students · People · More. Public /read, /learn, /trope-chart and /print have no tab bar; a laptop gets a left rail.)
2. **Aliyot:** "Page by aliyah". Aliyah 1–7, Maftir and triennial in Lein and Study with a picker; one aliyah per page. Amends the Passage First Rule.
3. **Visual system:** "Yes, full system". Six type steps, 17 px body, one Button, the reading tools docked at the bottom. Keeps the Song session colours and fonts. Amends DESIGN.md's phone toolbar rule.
4. **Portion summary:** "Claude drafts, you approve". Claude drafts through MCP; nothing shows until Daniel approves; credit "Rabbi Daniel Bogard" once approved.
5. **Curated insights column:** "Sources only". Rabbi-curated sources beside the verses (Chabad Torah in depth right-hand column), built on the 1.8 curated discussions. No "Think about it" questions. Members collect nothing.
6. **Hear yourself:** "Revisit with 2.5". The no-recording ruling stands until the 2.5 listening work.
7. **Practice visibility:** "Wider view". The assigned tutor sees which verses were practised each day and which marks changed, plus Learn's "Can hear" line and the most-confused pair; parents see counts only; the student is told what the tutor sees; no durations or scores. Adversarial privacy review before release. Widens ruling 45.
8. **Google sign-in script:** "Load only on sign-in". Our own "Continue with Google" button; Google's code loads only when chosen.
9. **Rashi English:** Daniel verbatim: "Keep the current one, but let's see if there is a modern one that is available with a license that works for us". **Updated the same day (REPORT, "Update to decision 9"):** Daniel chose "Make Metsudah the default": "Rashi Chumash, Metsudah Publications, 2009" (Sefaria, labelled CC-BY) shows first on screen, credited as Sefaria serves it, with the 1929 Rosenbaum-Silbermann as the alternative. **Licence ruling, later the same day (REPORT, verbatim):** "Sefaria feeds it via their mcp. We don't need a special liscense". Metsudah 2009 is treated like any other Sefaria text under its stated licence (CC-BY): on screen with its credit, and in print under the existing appendix licence filter, with no written confirmation required.
10. **Qamats qatan:** "Note now + adopt font". Word-card note "This vowel says o (qamats katan)." and switch the reading text to Taamey Frank CLM (Culmus, GPL with font exception).
11. **New wording batch (section 3, item 11):** "Keep all".
12. **Invitations:** "7 days, clearer email". Parent invitations last 7 days; the email names the congregation, the role and the expiry, never the child; staff get "Copy link".
13. **After the ceremony:** "'Ceremony done' state". The student keeps Learn and Study sign-in and leaves the active roster; Disable stays for mistakes and warns "This can't be undone here".
14. **Install and offline:** "Work on both". torah.centralreform.org stays the intended main address; install and offline also work on beitmitzvah.centralreform.org now; the student's assigned reading is saved for offline.
15. **Holiday readings:** Daniel verbatim: "We observe 2 days". The two-day list is correct for CRC; F-SITE-REVIEW finding 8 is closed with no change.

### 2.0 scope and order (2.0 PLAN "Cut", 2026-10-24)

- **D'var Torah is out of the app entirely.** Daniel: "No dvar Torah guide.. that all happens with the rabbi not in the app. Cut all related pieces. The app is just for study". DV1, DV2, DV3 and the D'var migration are removed.
- **Family logistics (Track E) stay out.** "The app is just for study." Also cut from 2.0: melody audio (2.1), notifications, the second congregation (2.5).
- **2.0 is 14 milestones:** G0 (done), F1–F6, SC1–SC7.
- **"Fix the public-page rate limit first."** F1 leads the order (in progress). SC2 (public text), SC4 (signed-in sync) and SC5 (finished mark) each get an adversarial review before merge.
- **Order is the builders' call.** Daniel, 2026-10-24: "I don't care about order. Feel free to reorder however, and continue until they are all finished."
- **Strings already approved for 2.0:** A7-STRINGS "Keep all" (the `au.*` Hear-it strings stay unused), and the five F-fix lines "Keep all": the 429 message, the uninvited sign-in line, "Tap verse numbers to choose them.", "Sign in to save", "page 23, after Mi Shebeirach" (`../2026-10-24-release-2-0/cowork/F-SITE-REVIEW.md`).

### Earlier rulings these milestones must respect

- **Never in the repo** (CLAUDE.md): JPS or any licensed text, student or family data, recordings, rendered audio, model weights, credentials. `tests/never-in-repo.test.mjs` stays green and is never weakened.
- **G3 gate** (CLAUDE.md): no student hears generated chant until Daniel passes the listening review. Nothing here serves a render.
- **The Passage First Rule** (DESIGN.md, before amendment): "Consecutive assigned verses stay in one Hebrew flow. Break at an actual open paragraph, chapter/book change, assignment discontinuity or recorded aliyah section". Decision 2 amends it to flow within a section.
- **The phone toolbar rule** (DESIGN.md, before amendment): "On phones the toolbar stays in flow above the passage"; "Don't … overlay the passage with the phone toolbar." Decision 3 moves the tools to a bottom dock; "never covers the passage" still holds by padding.
- **Ruling 45** (PLAN-REVIEW): "nothing finer than days-practiced is reported to anyone else, and nothing is reported across students." Widened for the service course (Batch 3 Q12, per-part finished mark) and now by decision 7. Nothing is ever reported across students.
- **No streaks, no daily goal, no score** (upheld, REPORT RC7).
- **A study and learning companion, not a source-sheet builder** (Daniel, 2026-10-24, BRIEF): members collect nothing; only a rabbi curates.
- **Stop and ask** (CLAUDE.md): money past $10 a month, anything student-visible before it ships, any licence question, a second tenant, a MISSION ruling that proves wrong. MISSION popup rulings: Daniel is interrupted only at release tags and true blockers ("money, licences, wording with no precedent, security findings").
- **Account-promise rule** (MISSION 2026-10-23): an account string that names what an account keeps ships only once each named thing really is kept.
- **JPS 2023 in print** is covered (MISSION item 16); never-in-repo is unchanged.
- **E3** (MISSION 2026-10-23): no note is sent to Sefaria.

## Decided here

1. **One order, four lanes, three releases.** 1.8.2, 1.9 and the rest of 2.0 are one queue. Lanes follow file ownership (Reading surface; Shell and people; Learn and the course; Accounts and privacy), so two builders never hold the same hot files.
2. **Folded 2.0 fixes, so nothing is built twice:**
   - **F2 (dark mode) → P1.** F2 has not started; the REPORT says take it into 1.8.2. P1 also owns the light focus ring (D5), so both rings land in one pass.
   - **F5 (word card in Lein, word names, verse-number targets, tab stops) → N4**, the one bottom Sheet. Building F5's sheet first and the redesign's Sheet second would be double work.
   - **F6 (polish) → P4**, with the Learn files it touches. It drops what #71 already does (F-SITE 14 most, 15 gloss, 17).
   - **F4 (Choose verses and print) → N3**, because the aliyah picker carries `&pick=` to Print, Save and Choose verses on the same files. F4's signed-out "Sign in to save" label goes to N20 with the other sign-in surfaces.
   - **F3 (ask for an account) → N20**, the sign-in milestone, together with its mirror (G20: hide "Ask for an account" from a signed-in student).
   - **F1** stays its own milestone (in progress).
3. **Folded defects:** D21 (hidden admin tabs) closes with N10's "More" tab; D10's Service-parts jump-link part closes with N10 (the jump link disappears); D11 (hero line breaks) closes with N11 Today (the hero is rebuilt); D20 (/offline empty) closes with N24 (offline on both domains); D3's front-door part closes with N20 (the Google script leaves the front door in the same change); D24's Noto Serif Hebrew part closes with N8 (the reading face changes to Taamey Frank, so subsetting Noto first would be wasted on the reading surfaces). G14 (lens speed) folds into N3 (paging is its structural fix). G23 (wider word targets) folds into N4.
4. **Hebrew font licence handling.** Taamey Frank CLM is vendored exactly as Stam Ashkenaz CLM was (original TTF, the release's GPL text as `LICENSE.txt`, the `.sfd` source served beside it, pins in `scripts/font-assets.mjs`, `.gitattributes`, a PROVENANCE section). It is served unmodified: no subsetting or WOFF2 conversion of a GPL font without a licence check, because that makes a modified version. If its licence file differs from Stam's GPL v2 plus font exception, it is a licence question for Daniel and N8's font switch waits.
5. **Ceremony done narrows access, never widens it.** The student keeps sign-in, Learn progress and saved readings; the student leaves the active roster; assigned-tutor access ends with the tutor assignment; a parent keeps the existing read-only child view; admins and rabbis see the student in a ceremony-done list and can reverse the state. Logged as a decision because nothing in it widens anyone's view; the N21 adversarial review attacks it.
6. **Practice visibility is server first.** N23 builds the data, RLS and API and the student's disclosure (Opus, adversarial). The tutor and parent lines render inside the screens N13 and N14 build, so the screens are not built twice. Nothing of decision 7 is visible until the adversarial review passes.
7. **Strings are in three tiers** (see "Strings"). Tier A ships. Tier B is drafted but was not in decision 11's list, so it goes to Daniel as one batch; until answered, a milestone builds the structure and leaves that one string's feature off (not rendered), rather than inventing or substituting copy. Tier C has no draft anywhere and is listed as a gap.
8. **Print link labels:** the student lens's pair ("Print practice sheet" / "Print the whole reading") is used, not the tutor lens's single "Print reading", because the pair names both links (decision 11 approved "the print link labels").
9. **The ⋯ sheet on /read** is labelled "More" for assistive technology, reusing decision 1's approved tab label. MCP tool instructions are not product copy and need no approval.
10. **Model per milestone:** Opus for auth, RLS, migrations, privacy, licence checks and every adversarial review; Sonnet for UI and mechanical work.
11. **Versions:** see "Versions and tags".
12. **Migration numbers** are proposals; whoever merges second renumbers (house practice). With DV1 cut, `0043` is free again. The 2.0 proposals stand (0043 SC4, 0044 SC2, 0045 SC5); 1.9's start at 0046.

## Versions and tags

| Tag | When | Contents |
|---|---|---|
| v1.8.1 | #71 and #72 merged and deployed | 1.8.1 defects (X1–X12) and AD-01 |
| v1.8.2 | P1–P5 merged and deployed | the 1.8.2 defect set, plus F2 and F6 folded in |
| v1.9.0 | N1–N25 merged, deployed and re-measured (N16's exit) | the 1.9 set |
| v1.9.1 | N26 merged | MCP for members (G24, "later" in the REPORT) |
| v2.0.0 | F1, SC1–SC7 merged and deployed, and v1.9.0 already cut | the 2.0 set |

Deploys happen at will as milestones merge (Daniel 2026-10-17 and 2026-10-23); tags mark sets. A 2.0 milestone that lands early ships under whatever version is current. If the 2.0 set finishes before the 1.9 set, v2.0.0 waits for v1.9.0 so versions stay in order. Hot fixes between tags are v1.8.x or v1.9.x patches. A deploy that breaks the live site is rolled back at once and fixed forward (MISSION item 6). Release check-ins: a short terminal note under 15 lines at v1.8.2, v1.9.0 and v2.0.0.

## Overlap with open work

- **PR #71** touches `globals.css`, `public-reading/view.tsx`, `workspace/reading.tsx`, `students.tsx`, `entry.tsx`, `study/view.tsx`, `verse-panel.tsx`, `word-tools.tsx`, `lift.tsx`, `commentary.module.css`, `trope-chart/page.tsx` and `chart.module.css`, and Learn's hero and home. **P1, P2, P3, P4 and N4 start from main after #71 merges.** Until then a builder may start only on files #71 does not touch.
- **PR #72** touches `workspace/provider.tsx` only. N10 and N11 rebase on it.
- **PR #73 (SC1)** adds `learn/service/*`, `lib/service-course/*` and edits `scripts/repo-policy.mjs`. P5 and N2 edit `scripts/font-assets.mjs` (read by repo-policy), so whoever merges second rebases. P4 (F6's locked path state) and SC1's path list share the Learn path frame: if #73 merges first, P4 fixes both lists; otherwise SC1 rebases on P4.
- **F1** (in progress) touches the public routes' cache headers. N3 and N25 add or change public reading routes and rebase on it; SC2 depends on it.
- **Draft PR #22** stays parked (voice, 2.5).

## Hot-file groups (one open PR per group at a time)

| Group | Files | Owner lane |
|---|---|---|
| Reading text | `study/annotations.tsx`, `annotations.module.css`, `study/view.tsx`, `verse-panel.tsx`, `word-tools*`, `lift.tsx`, `commentary-view.tsx`, `public-reading/*`, `print/document.tsx` | 1 |
| Shell | `app/workspace/layout.tsx`, `workspace/reading.tsx`, `students.tsx`, `parent-summary.tsx`, `roster.tsx`, `admin-nav.tsx`, `entry.tsx` | 2 |
| Learn | `components/learn/*`, `app/learn/*`, `app/trope-chart/*` | 3 |
| Auth and access | `google-sign-in.tsx`, `app/sign-in/*`, `front-door/*`, `server/auth/*`, `server/invitations/*`, `server/access/*`, `server/students/*`, `lib/offline/*` | 4 |
| `app/globals.css` | everyone, by hunk | P1 and N9 land first; later edits are small and rebase |

## Lanes and order

A builder who finishes a lane takes the next unblocked milestone from any lane, as long as its hot-file group is free.

| Lane | Order |
|---|---|
| 1. Reading surface | P1 → P2 → P5 → N1 → N2 → N3 → N25 → N4 → N5 → N6 → N7 → N8 |
| 2. Shell and people | P3 → N9 → N10 → N11 → N12 → N13 → N14 → N15 → N16 |
| 3. Learn and the course | P4 → (merge #73, SC1) → SC2 → SC3 → N17 → N18 → N19 → SC7 → SC6 |
| 4. Accounts and privacy | F1 (in progress) → N20 → SC4 → SC5 → N21 → N22 → N23 → N24 → N26 |

**First milestones now:** lane 1 P1 (M, Sonnet), lane 2 P3 (S, Sonnet), lane 3 P4 (S, Sonnet), lane 4 F1 (M, Sonnet, in progress) then N20 (M, Opus).

## Dependencies

```
#71 ─► P1, P2, P3, P4, N4          #72 ─► N10      #73 (SC1) ─► SC2, SC3, SC4, SC7
F1 ─► SC2, N3, N25
P1 ─► N9 ─► N4, N10 ─► N11, N13, N14 ─► N15, N16
N3 ─► N4, N5, N11, N25, N7      N3 + N4 ─► N7 ◄─ N6
N1 ─► N5 (commentary files)     N2 ─► N8 (font)       P5 ─► N8 (font-assets pins)
N12 ─► N11 shows "Before next time" (either order; N11 renders it when present)
N20 ─► N22 (sign-in surfaces), N3 (save-reading.tsx: whoever merges second rebases)
SC2 ─► SC3 (f5–f6, Review, Quick ten) ─► SC6;  SC1 ─► SC3 (f1–f4);  SC1, SC2 ─► SC7
SC4 ─► SC5 ─► SC6;  N10 ─► SC5's tutor display;  N24 ─► SC6 (one offline packer)
N13, N14 ─► N23's display;  N21 ─► N14's active roster filter (either order; N14 reads the state when present)
all N1–N25 ─► N16's final re-measure ─► v1.9.0
```

---

## 1.8.2: defects (no new wording, no ruling)

### P1. Hebrew text, contrast and dark mode (M, Sonnet) — lane 1

- **Covers:** D1 (qere pushed off-screen), D2 (maqaf phrases split), D5 (light focus ring), D6 (forced colours), D7 (stranded verse numbers), D8 (English inside Hebrew; copy handler), D9 (Practice up close dimming), D15 (Study credit and dibbur targets), D17 (sticky hover underline), D18 (Hebrew inside Rashi's English: face and `lang`), D19 (print drops a Rashi lemma), **F2** (dark mode: trope samples, verse numbers, dark focus ring).
- **Files:** `app/globals.css` (`.study-alternative` ~589, `.lift-phrasing` ~536, `forced-colors` block), `study/annotations.tsx` (`parts()`, `FlowVerse` ~195–201), `annotations.module.css` (:16, :24), `print/document.tsx` and the print commentary cleaner, `learn/bits.tsx` (maqaf chain only), `study/commentary-view.tsx`, `commentary.module.css`, `app/trope-chart/chart.module.css`.
- **Depends on:** #71 merged.
- **Exit tests:**
  - At Pixel 7 Huge, iPhone SE Huge and 320 px Large, no glyph of Gen 24:33 starts left of x=0.
  - At 320 px Huge, no rendered line ends in U+05BE (Gen 24:30–36; Gen 18:1–14 side by side; print of 24:30).
  - No verse number ends a line in Gen 18 at Pixel 7 Standard or iPhone SE Large.
  - Copying Gen 18:1 pastes "18:1", the Hebrew and a newline, with no English legend; the sr-only headings and legends carry `lang="en" dir="ltr"`.
  - Focus ring at least 3:1 on white and on every phrase fill (light); dark mode: every trope-chart sample and every /read verse number and its ring at least 4.5:1 (F2's exit test).
  - With `forced-colors: active`, pressed Torah/Haftarah, Lein/Study and Colors differ from their neighbours; "Start reading" keeps a border.
  - Practice up close's dimmed words at least 4.5:1; axe finds no `target-size` failure in Study's commentary.
  - On a touch emulation, no underline remains after a tap; the print appendix shows all three Rashi lemmas on Gen 18:1 as the screen does.

### P2. Public reader layout (S, Sonnet) — lane 1

- **Covers:** D3 (/read and Study layout shift), D4 (/read "Find a date" row at 200% text), D10 (Start reading focus on /read).
- **Files:** `public-reading/view.tsx` (the signed-out aside at ~100 moves after the reading or into a fixed slot; reserve the reading block's height), the date row's styles.
- **Depends on:** #71 merged.
- **Exit tests:** `S/visual/cls.cjs` (copy the script into the repo's e2e or a scratch run) reads below 0.1 on /read and Study at 4× CPU; at a 200% root font on a Pixel 7, /read is no wider than the viewport; after "Start reading", `document.activeElement` is the reading heading or first verse.

### P3. Workspace and admin defects (S, Sonnet) — lane 2

- **Covers:** D4 (workspace: `.button-text`, student-card date), D13 (tab titles "{h1} | CRC Torah", the student's name as h1 on tutor and admin student pages), D14 (one footer landmark), D16 (roster labels start with the visible words), D22 (blank CSV service slot = `unknown`).
- **Files:** `app/layout.tsx`, page metadata under `app/*/page.tsx`, `front-door.tsx:92`, `entry.tsx:214`, `connect.tsx:133`, the relationships access workspace, `server/students/validation.ts:42,93`, `students.tsx`.
- **Depends on:** #71 merged.
- **Exit tests:** every signed-in page has a distinct `<title>`; each page has exactly one `contentinfo` landmark; "Remove from Noa: Tamar Levin" is the accessible name; a CSV row with a blank `service_slot` imports as unknown; at a 200% root font the student page and parent child cards fit 412 px.

### P4. Learn and trope chart defects, plus 2.0 F6 (S–M, Sonnet) — lane 3

- **Covers:** D12 (Learn, Quick ten and Review headings; heading levels), D23 (each trope-chart family links to its lesson by its existing title), **F6** (F-SITE 10, 11, 12, 19, 20, 22, 23, 25, 27 and what remains of 14, 15 and 21 after #71: the path's locked state, the blessings links on every reading, the haftarah page label, trope-chart copy, the drill live region, Quick ten's tab title), G19's visual part (a wrong choice gets ✕ and a muted fill, not the heavier outline).
- **Files:** `learn/lesson.tsx:56`, `quick-ten.tsx:37`, `review.tsx:44`, `drills.tsx`, `learn/home.tsx`, `app/trope-chart/page.tsx`, the study heading levels named in D12.
- **Strings:** F6's own lines are approved (Batch 4 "Keep all"). G19's "one more try" is tier B and stays off.
- **Depends on:** #71 merged. Coordinate with #73 (see "Overlap").
- **Exit tests:** each Learn page has one h1 and no skipped level; every chart family is a link to its lesson; each F6 finding re-walked and closed, or recorded as left with its reason; a wrong drill choice is not the most prominent button.

### P5. Bricolage as a WOFF2 subset (S, Sonnet; second-agent repository-protection review) — lane 1

- **Covers:** D24's Bricolage part. Latin subset at the weights in use (after N9 that is 400/600/750, so include 400–800 now), width 100, with `size-adjust` fallbacks.
- **Files:** `public/fonts/bricolage-grotesque/*`, `app/globals.css:5–12`, `scripts/font-assets.mjs` (new pins), `.gitattributes`, `public/fonts/PROVENANCE.md` (a new entry: the subset's tool, command, input hash and output hash; OFL permits subsetting; the OFL text stays beside it).
- **Exit tests:** `npm test` (repo-policy font pins) green; LCP on / and /read lower than before at 4× CPU; no fallback glyphs in the UI at 320–1440 px. The reviewer checks the PROVENANCE record against the bytes.

**Tag v1.8.2** when P1–P5 are live.

---

## 1.9

### Lane 1: the reading surface

#### N1. Metsudah 2009 as the default Rashi English (S, Sonnet) — decision 9 as updated

- Add Sefaria's "Rashi Chumash, Metsudah Publications, 2009" (CC-BY) as the first Torah English edition of Rashi in `lib/readings/commentary.ts`, credited exactly as Sefaria serves it; Rosenbaum-Silbermann 1929–1934 stays as the alternative (its existing title already carries the dates).
- **Print:** Metsudah prints under the existing appendix licence filter (CC-BY passes) with its credit, like any other Sefaria text (Daniel's licence ruling: no written confirmation needed). No new licence code path.
- Verify the edition title and licence live against Sefaria's versions API at build time (as the 2026-10-22 note in `commentary.ts` did) and record the date in the comment. If Sefaria's served licence is ever not CC-BY, the existing filter drops it and the 1929 edition shows.
- **Exit tests:** Study's Rashi on Gen 18:1 shows Metsudah first with its credit; the alternative is one tap away; `/print` with the commentary appendix shows Metsudah with its CC-BY credit; an edition with a non-open licence is still refused by the filter; no Metsudah text in fixtures or the repo (never-in-repo green).

#### N2. Taamey Frank CLM: licence check and vendoring (S, Opus) — decision 10

- Locate Taamey Frank CLM in the official Culmus release on SourceForge (the Taamey faces may be a separate archive from `culmus-0.140`; record which). Read its licence file and the font's name-table notice. **If it is GPL v2 with the same font exception Stam Ashkenaz CLM carries, proceed** (Daniel already ruled the font in). If it differs in any way, stop: it is a licence question for Daniel.
- Vendor as Stam was (Decided here 4): the original TTF, the GPL text as `LICENSE.txt`, the `.sfd` source from the matching source archive, exact pins and hashes in `scripts/font-assets.mjs`, `.gitattributes` entries, and a PROVENANCE section quoting the exception.
- Check before the switch: the cmap covers U+0591–U+05C7 including U+05C7 (qamats qatan) and a visibly distinct qamats qatan glyph; `mark`/`mkmk` stacking renders Gen 18 and Gen 24:30–36 correctly in Chrome and Safari (page PDFs).
- **Exit tests:** repo-policy font tests green; PROVENANCE matches the bytes; a short rendering note with screenshots in this folder. No product surface uses the face yet (N8 switches it).

#### N3. Aliyot, the picker and paging by aliyah (L, Sonnet) — decision 2; G1 (reader parts), G14, F4

- Aliyah labels in both lenses, reusing print's wording; pass `sections` to `StudyRows`/`FlowingStudyText` in `PassageReading` (`public-reading/view.tsx` ~441–444) as the workspace already does.
- The picker: Full, Triennial year N, Aliyah 1–7, Maftir, addressable as `&pick=aliyah-4` and carried to Print, Save and Choose verses.
- **One aliyah per page** (or one tutor section per page in the workspace), continuous flow inside it, "Next section" at the end with the next section's first verse previewed faintly. The section chip row (a tablist; "Service parts" is the last chip in the workspace) is built here as a component; N10 places it in the shell.
- **F4 folded:** a second tap after one verse makes the range; the empty bar says how to choose ("Tap verse numbers to choose them.", approved); chosen verses and Torah/Haftarah carry into /print.
- **G14 folded:** `startTransition` on the lens and colour switches; the passage is not re-mounted on a lens change; `content-visibility:auto` on off-screen verse groups only if a section is still slow.
- Amend DESIGN.md's Passage First Rule (flow within a section; decision 2, dated).
- **Files:** `public-reading/view.tsx`, `choose-verses.tsx`, `reading-chooser.tsx`, `study/view.tsx`, `study-rows.tsx`, `workspace/reading-toolbar.tsx`, `print/sheet.tsx` and `print/api.ts` (accept `pick`), `saved/*` (carry `pick`), DESIGN.md.
- **Depends on:** P1, P2, F1.
- **Exit tests:** Vayera shows Aliyah 1–7 and Maftir in Lein and Study; `&pick=aliyah-4` opens aliyah 4 and survives Print and Save; page 1 never ends mid-aliyah; Study's DOM at least 5× smaller than before on Vayera; longest lens-switch event under 500 ms at 4× CPU (INP target 200 ms is N16's); tapping 18:1 then 18:10 gives "Genesis 18:1–10" and /print prints those verses only.

#### N25. Claude can name an aliyah (S, Sonnet; second-agent check) — G1 (MCP part)

- `portion` and `pick` on the MCP `study_link` and the saved-reading tools; a read-only `get_reading` (parashah, aliyot, triennial, haftarah refs). Instructions line from DP-14.
- **Files:** `server/mcp/study-tools.ts`, `saved-tools.ts`, `instructions.ts`.
- **Check:** no new tool reaches anyone else's saved readings; `get_reading` reads public data only.
- **Exit tests:** "set up my Shabbat with aliyah 4 of Vayera" works as one call chain in the MCP tests; owner scoping tests unchanged and green.

#### N4. One Sheet and the tool dock (L, Sonnet) — decision 3 (dock); F5; G2 (verse tools); G23; decision 10 (note)

- Every detail opens in N9's Sheet: word card, verse tools (for the selected verse only), View up close's notes. It rises from the bottom at every phone width, is modal with focus trapped, and Esc or swipe-down returns focus to the word.
- **F5 folded:** Lein opens the word card in the sheet; one tab stop for the words with arrow keys inside; each word's accessible name is the Hebrew word, the action in `aria-describedby`; verse-numbered control names; 44 px verse-number targets.
- **G23 folded:** word hit areas widened by padding or a pseudo-element without moving the text.
- **G2 part:** "Sources (n)" only when there are sources (tier B: the "(n)" form is REPORT G2's draft).
- **Tool dock:** Colors · English · Size · Hear in the thumb zone, above the tab bar where there is one; the passage gets matching bottom padding. Amend DESIGN.md's phone toolbar rule (dated).
- **Qamats qatan note** in the word card: "This vowel says o (qamats katan)." Shown when the word carries U+05C7. If the text source never marks qamats qatan, record that and show the note only where it is marked (no word list is invented).
- **Files:** `study/word-tools.tsx`, `word-panel.tsx`, `verse-panel.tsx`, `lift.tsx`, `annotations.tsx`, `reading-toolbar.tsx`, `public-reading/view.tsx`, DESIGN.md.
- **Depends on:** #71, N3, N9.
- **Exit tests:** at 390 px, tapping a word in Lein or Study opens its card without scrolling; a screen reader reads the Hebrew word; keyboard focus reaches the page controls in under ten tab presses; no verse shows a "Sources" control when it has none; the dock never covers a verse at 320–430 px.

#### N5. Public /read header and Study polish (M, Sonnet) — G15, G17

- **G15:** a 2-line header (eyebrow date, parashah at title size, week arrows, "More"), then Torah|Haftarah and Lein|Study, then the aliyah chips; everything else (Find a date, Choose a reading, Choose verses, Print, Trope chart, Save, siddur blessings) in the "More" sheet; a one-row Choose verses bar.
- **G17:** commentary Hebrew scales with the size control; the "English" tag and English-first order on More on this verse (tier B); "Back to the reading" on /print (tier B); Saturday's home leads with next Shabbat (tier B line); the rare-trope reader note (tier B).
- **Depends on:** N3, N4, N1 (commentary files).
- **Exit tests:** on a Pixel 7, the first Hebrew starts above y≈320 px on /read; CLS on /read stays below 0.1; commentary Hebrew grows with each size step.

#### N6. Portion summary and the curated insights column: data and MCP (M, Opus; adversarial review of the approval gate) — decisions 4, 5; G9

- Migration (proposed `0046_portion_summary.sql`): per tenant, per parashah, a summary and a one-line outline per aliyah, with `status` (`draft` | `approved`), `approved_by`, `approved_at`, revision; forced RLS; public read of **approved rows only** through a view; insert and update only by staff through MCP.
- MCP tools: draft a summary (Claude), list drafts, approve (Daniel or a rabbi), withdraw. Credit on approval: "Rabbi Daniel Bogard".
- The insights column reads the existing 1.8 M6 curated discussions (sources only, no questions); add only what the column needs (aliyah or verse anchor) and only if M6 lacks it.
- **Adversarial review (Opus):** no route, page, pack, print or MCP read returns an unapproved summary to anyone but staff in MCP; approval cannot be forged by a non-rabbi; nothing a member writes reaches the column.
- **Exit tests:** a draft is invisible on /read, Study, print and offline; approving it shows it everywhere with the credit; withdrawing hides it.

#### N7. Portion summary block and insights column on screen (M, Sonnet) — decisions 4, 5; G9 UI

- A summary block atop Study with the per-aliyah outline jumping to each aliyah (N3); the right-hand sources column beside the verses on laptop, a section in the sheet on phone.
- Heading "This portion" is tier B; the column reuses M6's existing headings where they fit. "Show the halves" (G9) is tier B and stays off until approved.
- **Depends on:** N3, N4, N6.
- **Exit tests:** Vayera with an approved summary shows it with "Rabbi Daniel Bogard"; outline lines jump to the right aliyah; at 360 px the column is reachable in one tap and covers no verse.

#### N8. Hebrew display and the Taamey Frank switch (M, Sonnet) — decision 10; G18; D24 (Hebrew part)

- Switch the reading text (Lein, Study, Practice up close, print's vowelled Hebrew) to Taamey Frank CLM via `styles/hebrew-font.module.css`. Noto Serif Hebrew stays wherever the reading text is not (chart labels, UI Hebrew) and gets a WOFF2 subset there (OFL), keeping `mark`/`mkmk`, checked against every mark.
- **G18:** qere full size with the ketiv small and a "read" chip (tier B); phrase colour pairs fixed for protan/deutan (ΔE above the agreed floor) plus a non-colour phrase-end cue and night phrase inks; trope samples on a bare carrier at 56–64 px; side-by-side tikkun stacks at Large and Huge on phones; small ס/פ paragraph markers on screen; "Letters only" print uses Stam Ashkenaz CLM and drops the qere apparatus.
- **Depends on:** N2, P5, N4.
- **Exit tests:** qamats qatan visibly distinct from qamats in a known word; P1's maqaf and qere tests still pass in the new face; colour-blind simulation finds no adjacent phrase pair below the floor; LCP on /read no worse than after P5.

### Lane 2: shell and people

#### N9. Visual system foundation (M, Sonnet) — decision 3

- Tokens: six type steps (display 40, title 26, heading 19, body 17, callout 15, caption 13), weights 400/600/750, radii per object, semantic staff tokens (`attention`, `done`, `info`, `danger`, always with a word), one focus ring (P1's).
- Components: Button (primary, secondary, quiet; destructive opens a confirm sheet), Sheet, ListRow, PageHeader, EmptyState, Segmented, Chip.
- DESIGN.md: the type scale and body 17 px (dated amendment, decision 3).
- **Depends on:** P1.
- **Exit tests:** component tests for Sheet focus trap and return; axe clean on a component page; student pages unchanged at a glance except body size (screenshot diff reviewed).

#### N10. Tab bar and role shells (L, Sonnet) — decision 1; G2 (tabs, `?tab=`); closes D21 and D10 (Service parts)

- Bottom `<nav aria-label>` with `aria-current="page"`, icons always labelled, 44 px targets, hidden only while the keyboard is open; a left rail at 1000 px and up. Tabs per role exactly as decision 1. Public /read, /learn, /trope-chart, /print have none.
- Student and parent Reading get the segmented views (Reading · Service parts · Lessons) staff have, remembered in `?tab=`; N3's section chip row sits in the sticky bar; the 20,000 px jump link goes.
- Admin "More" holds settings, email, Claude, reference review and the staff Sheet (closes D21). Print link labels: "Print practice sheet" / "Print the whole reading".
- **Files:** `app/workspace/layout.tsx`, new `components/portal/shell/*`, `admin-nav.tsx` (retired), `workspace/reading.tsx`, `students.tsx`, `entry.tsx`.
- **Depends on:** N9, #72.
- **Exit tests:** at 390 px every role reaches each tab in one tap; reload keeps the tab; no admin area is off-screen; keyboard users reach the tab bar in one skip link; the bar never covers content.

#### N11. Student Today (M, Sonnet) — decision 1; G3; closes D11

- The lake field (parashah, countdown, readings as chips), one Next card with one button ("Start where you left off"; the "Practice verses {range}" form is tier B), seven quiet practice dots (no streak), reading sections as rows with their state (dot plus the existing words not started / working / solid), the latest lesson note pinned, "Rehearsal today" / "Next rehearsal: {day}", rehearsals and the ceremony marked on the calendar with forward months, "Need help?" in Account.
- **Depends on:** N10, N3. Shows N12's field when present.
- **Exit tests:** Today fits in 1.5 screens at 390×844; on Noa's first rehearsal day it says "Rehearsal today"; no hero text breaks a reference or date across lines at 375–412 px; the calendar shows the ceremony month.

#### N12. "Before next time" on lesson notes (S, Opus) — G3

- Migration (proposed `0047_lesson_note_before_next.sql`): an optional bounded text column on the lesson note, same readers and RLS as the note; tutor input with the if-then prompt; the student sees it on Today.
- **Check:** RLS and readers unchanged (a second agent confirms; not a widening).
- **Exit tests:** saved and shown to the student and parent who already read the note; nobody else reads it; too long is refused with one error (as X11).

#### N13. Parent screens and learner wording (M, Sonnet) — G8 (minus counts); G20

- The TP-14 wording table; the child's name as the heading once chosen; one compact practice bar (its text is tier B); the honors row after the summary; the parent "This week" card with the next date in relative words and the latest note open (counts arrive with N23).
- **G20:** the learner service-parts line; the adult honors labels "Blessing from family" / "Not part of my service", placed after the reading; "Send a new code" after 60 s (tier B).
- **Depends on:** N10.
- **Exit tests:** every TP-14 row replaced; no "Choose a child" heading after a choice; an adult's honors entry sits after her reading.

#### N14. Staff "This week" and "Needs you" (L, Sonnet) — G10; G7 (non-privacy parts)

- A "Needs you" list (ceremonies within 8 weeks: no tutor, family not joined, invitation expired, no reading, reading needs review, service not set, honors not started); students sorted by ceremony date with countdown chips; status chips per row; the admin service-slot line with "Edit details"; "Added {name}. Next: choose a tutor, invite a parent, assign the reading" as three links; the "Reading needs review" chip and its clearing action; the Sunday hint.
- **G7 parts that widen nothing:** a "Needs work" block from the marks tutors already see; a verse picker and "Add note for this verse" in Practice up close (lift is N4's file: land after N4); a Settings link in the tutor workspace.
- Row and heading strings beyond decision 11 are tier B or gaps (see Strings); each stays off until answered.
- **Depends on:** N10; N4 for the lift parts.
- **Exit tests:** a seeded ceremony in 6 weeks with no tutor appears in Needs you with one verb; the admin never sees "Your rabbi needs to…"; reaching 23:10 in Practice up close takes at most 3 taps.

#### N15. Tutor hand-over, honors status, family line (M, Opus; adversarial: access and privacy) — G11, G12, G7 (family line)

- G11: "Teaches n students" under each tutor; the removal review lists them and offers "Move these students to: [tutor]" (writes `tutor_student` rows).
- G12: the tutor sees status only, "family is waiting for aliyah divisions", with a link to divisions; no honoree names.
- G7: "Family: invitation sent / joined" on the tutor's student page; no contact details.
- **Adversarial review:** the hand-over cannot grant a tutor a student outside the tenant or outside the admin's authority; old access ends in the same transaction; the honors line carries no names; the family line carries no email or name beyond what tutors already see.
- **Depends on:** N14.

#### N16. Admin and tutor polish, the token pass, and the re-measure (M, Sonnet) — G21, G22, REPORT §2.4 system

- G21 (CSV example row, same-name-and-date warning, import the ready rows, bad rows as a table; Sheet update timeout and label; Settings focus and hide "Roster sheet ID" for CRC; recording review's empty vs error state and its move under More; consistent danger styling). "Members" for Accounts is tier B.
- G22: the Claude connections empty state (tier B).
- The token pass: staff screens move to N9's Button, ListRow and PageHeader (VA-16: one h1 size, one button family, one header).
- **Re-measure (the v1.9.0 gate):** CLS below 0.1 and INP below 200 ms at 4× CPU on /, /read, Study and the student Reading; axe clean on every route the review swept.
- **Depends on:** every other N1–N25 milestone.

### Lane 3: Learn

#### N17. Learn wired to the student's own reading (M, Sonnet) — G4

- Signed-in students see items from their assigned ranges; the first-verse lesson uses their own verse; a "first phrase of your verse" step after unit 2; a haftarah-assigned student sees the haftarah path first; a link back to their reading. All of these strings are tier B; until answered, only the behaviour without new copy ships (own verse in the existing first-verse lesson, haftarah path first).
- **Files:** `learn/week-data.ts:25`, `first-verse.tsx`, `home.tsx`, `verses-api.ts`. Reads the student's assignment through the existing workspace API only; no new access.
- **Exit tests:** Noa's first-verse lesson shows Gen 23:1, not this week's verse; a signed-out visitor sees this week's verse as before.

#### N18. Producing the chant (M, Sonnet) — G5

- A "Your turn" step after chant-along with the celebration moved after it; from zakef on, where-does-it-end plays no audio until answered; box 3+ review cards get the harder items; correct-answer feedback underlines the closing mark; Hear it plays once on open. The "Read it, then pick the tune" drill's strings are tier B; its code may land behind an off switch.
- Still no recording of the learner (decision 6).
- **Exit tests:** the first-verse path cannot show "You can lein this verse." before Your turn; where-does-it-end from zakef on makes no sound before an answer.

#### N19. Review and readiness for the student's own verses (M–L, Opus) — G6

- Got it and Solid verses become review cards with the same boxes and the ceremony-date cap; a Run-through (no audio, colours off, per-verse result) whose stumbles feed review; the Got it / Solid criteria; a suggested fade, never a lock.
- Data stays the student's own: cards sync like Learn progress. If the progress row needs a shape change, it is a migration (proposed `0048_*`), owner-only, with a second-agent RLS check. Tutors see nothing new here (decision 7 does not cover run-throughs).
- Run-through, its result words and the fade strings are tier B.
- **Exit tests:** a verse marked Got it comes back in review within its box interval and never after the ceremony date; no other account reads the cards.

### Lane 4: accounts and privacy

#### N20. Sign-in: Google on demand, return to your place, the account route (M, Opus; adversarial: auth) — decision 8; G16; F3; G20 (hide); D3 (front door)

- Our own "Continue with Google" button; Google's script loads only after it is chosen; the front door renders its signed-in/out branch on the server or with a stable min-height (closes D3's / part).
- A validated return address: same-origin relative paths only (no `//`, no backslash, no scheme, no encoded host), carried through code sign-in and the Google redirect state; on return, offer to save the reading.
- The /read sign-in card (approved wording; it promises "your place", so it ships only once the return works, per the account-promise rule). "Sign in to save" signed out (F4's label, approved).
- **F3:** the route to the request form on /, /sign-in and /account before sign-in; hidden from a signed-in student (G20).
- **Adversarial review:** open redirect, state tampering, CSRF on the Google redirect, the script loading before the button is chosen, no tracking beacon on the front door, no third-party request on / signed out.
- **Exit tests:** signed out, / and /read make no request to `accounts.google.com`; Save → sign in → back on the same reading with the same selection; `?return=//evil.example` and `?return=https://…` land on the default page.

#### SC4, SC5 (2.0) — see the 2.0 PLAN; here for order

- **SC4** (L, Opus, adversarial: privacy and auth): migration proposed 0043 (owner-only), course sync, the path route, Your parts.
- **SC5** (M, Opus, adversarial: privacy): migration proposed 0045, the per-part finished mark; its tutor display lands in N10's Service parts view.

#### N21. "Ceremony done" (M, Opus; adversarial: auth and access) — decision 13

- Migration (proposed `0049_ceremony_done.sql`): a ceremony-done state with who and when, reversible by an admin or rabbi; audit actions.
- Effects (Decided here 5): the student keeps sign-in, Learn progress, saved readings and Study; leaves the active roster, Needs you and the staff Sheet's active list; tutor assignments end; parents keep the existing read-only child view; staff see a ceremony-done list. Disable stays for mistakes and warns "This can't be undone here".
- **Adversarial review:** no widened read; ended tutor access is really ended (RLS, MCP, Sheet, exports); reversing restores no tutor row silently; the state cannot be set by a tutor or parent.
- **Exit tests:** a ceremony-done student signs in and opens Learn and Study; their old tutor reads nothing; they appear in no active list; Disable's warning shows.

#### N22. Invitations: 7 days, clearer email, Copy link (M, Opus; adversarial: auth) — decision 12; G13

- Parent invitations last 7 days (others unchanged at 72 hours); the email names the congregation, the role and the expiry, never the child; "Copy link" for staff who may invite; the "Expires tomorrow" flag and the "Needs a parent invitation" action after an account request (tier B strings).
- **Copy link design:** tokens are stored hashed, so copying issues a fresh link (rotating the old one) shown once to that staff member; never logged, audited without the token.
- **Adversarial review:** the token never reaches logs, audit rows, MCP or another staff member; rotation invalidates the old link; expiry enforced server-side; no child's name in subject or body.
- **Depends on:** N20 (shared sign-in surfaces).
- **Exit tests:** a parent link works on day 6 and fails on day 8; the email text has no child's name; a copied link works once and the previous one fails.

#### N23. Practice visibility, decision 7 (L, Opus; adversarial: privacy, before anything shows) — decision 7

- **Server:** a staff-readable, tenant-scoped read of practice events for the **assigned** tutor only: per day, which verses were opened and which marks changed (from `practice_event.target` and the mark history), no durations, no counts of plays, no scores. Learn's "Can hear" line and the most-confused pair for the assigned tutor. Parents: mark counts only. Marks record whether they were made with a parent (`sourceMode`, as practice events already do). Migration proposed `0050_practice_visibility.sql` (view or security-barrier function plus the mark column), forced RLS.
- **The student is told what the tutor sees**, on Account and in Learn (LD-10's draft covers the Learn part only; the full disclosure is a gap).
- **Display** in N14 (tutor: per-day line, Needs work, roster card line) and N13 (parent counts), after the review passes.
- **Adversarial review:** no reader beyond the assigned tutor (not other tutors, not parents beyond counts, not MCP, cron, the Sheet or exports); no cross-student or cross-tenant row; no duration or play count reachable by any route; the disclosure ships with the first visible line.
- **Depends on:** N13, N14 for display.
- **Exit tests:** a tutor without an active `tutor_student` row reads nothing; a parent reads counts and nothing per day; the student's disclosure is present before any tutor line renders.

#### N24. Install and offline on both domains; the assigned reading packed (M, Opus; adversarial: privacy and never-in-repo) — decision 14; closes D20

- `lib/offline/policy.ts`: install, the worker and packs on both `torah.centralreform.org` (still the main address) and `beitmitzvah.centralreform.org`.
- Pack the signed-in learner's assigned reading through the existing owner `ref` pack (`PackDescriptor` type `ref`), public data routes only (`packAssetAllowed`); cleared on sign-out and on account change (shared device).
- /offline renders its heading and "Nothing is saved on this device yet." on both domains (D20).
- **Adversarial review:** no private or signed-in route ever enters a pack; another account on the same device never sees the pack; nothing generated or unreleased is packed (G3); no licensed text enters the repo or fixtures.
- **Exit tests:** installed on the beitmitzvah domain with the network cut, Noa's assigned reading opens; after sign-out it is gone; /offline is never empty.

#### N26. MCP for members (M, Opus; adversarial: auth scope) — G24; tags v1.9.1

- Open the link tools and owner-only saved tools to any member with saved readings, after a scope review. Never another person's work.

### The rest of 2.0, placed in the lanes

As written in `../2026-10-24-release-2-0/PLAN.md` (sizes, models, exit tests unchanged), with these placements:

| Milestone | Lane | Note |
|---|---|---|
| F1 rate limit | 4 | **In progress** (separate builder). Leads the order (Daniel). |
| F2 | 1 | Folded into P1. |
| F3 | 4 | Folded into N20. |
| F4 | 1 | Folded into N3 (label into N20). |
| F5 | 1 | Folded into N4. |
| F6 | 3 | Folded into P4. |
| SC1 | 3 | PR #73 open; merge when green (see Overlap for P4). |
| SC2 public text | 3 | L, Opus, **adversarial: licensed text**. After F1, SC1. |
| SC3 | 3 | M, Sonnet. |
| SC4 signed-in sync | 4 | L, Opus, **adversarial: privacy and auth**. |
| SC5 finished mark | 4 | M, Opus, **adversarial: privacy**. Tutor display after N10. |
| SC6 offline | 3 | M, Sonnet. After SC2, SC4 and N24 (one packer). |
| SC7 evening and Havdalah | 3 | L, Sonnet. Public-lane text check first; licensed-only text → Daniel. |

## Adversarial reviews (a second Opus agent, before merge)

| Milestone | Why | What the reviewer attacks |
|---|---|---|
| N20 | Auth (decision 8, G16) | Open redirect, state and CSRF, script before choice, third-party requests signed out |
| N21 | Access (decision 13) | Widened reads, tutor access surviving, who may set or reverse |
| N22 | Auth (invitation tokens) | Token in logs/audit/MCP, rotation, server expiry, child's name |
| N23 | Privacy (decision 7, widens ruling 45) | Readers beyond the assigned tutor, cross-student or tenant, durations or play counts, disclosure order |
| N24 | Privacy and never-in-repo (decision 14) | Private routes in packs, shared devices, unreleased renders, licensed text |
| N15 | Access and privacy | Hand-over authority, honoree names, family details |
| N6 | The approval gate (decision 4) | Unapproved summaries on any surface, forged approval |
| N26 | Auth scope | Any reach into another person's saved work |
| SC2, SC4, SC5 | 2.0 PLAN | As listed there |

Lighter second-agent checks: P5 and N2 (font pins and provenance), N12 and N19 (RLS unchanged), N25 (MCP scope).

## Strings

### Tier A: approved, ship verbatim

Decision 11 approved REPORT §3 item 11's drafts ("Keep all"). The draft texts live in the review lenses' findings (scratchpad); they are copied here so the repo holds them.

| Where | String | Source |
|---|---|---|
| N11 Today | "Rehearsal today" / "Next rehearsal: {day}" (e.g. "Next rehearsal: Sat, Oct 31") | ST-03 |
| N18 Your turn | Step "Your turn": "Chant it without the recording. Then hear the reader."; answers "Same as the reader" / "Not yet"; the existing "You can lein this verse." moves after it | LD-03 |
| N19 criteria | Student: "Got it means you chanted this verse twice without the recording and it matched the reader." Tutor: "Solid means they chanted it to you without help." | LD-09 |
| N12 field | "Before next time"; student sees "Before your next lesson: {text}"; prompt "When ___, I will ___" | LD-11, REPORT G3 |
| N13 parent table | "Sit down with Noa and tap Practice with Noa to go through her verses together." · "from Tamar Levin" · "Practised this week: Sat" · (remove "This tab only…") · "You'll be able to follow Sam's reading and practise with Sam." · "Saved" · "Remember to tap Save honors." (names are the child's and tutor's, filled in) | TP-14 |
| N13 service parts | "Your service parts will show up here soon. Nothing you've practised is lost." | ST-09 |
| N13 adult honors | "Blessing from family"; "Not part of my service" | ST-10 |
| N14 admin slot | "Choose a service for this student, then the reading can be shown" with "Edit details"; "Added {name}. Next: choose a tutor, invite a parent, assign the reading" | AD-02 |
| N20 /read card | "Sign in to keep this reading, your place and your preferred commentaries. Everything on this page is open to anyone." | DP-13 |
| N11 / Account | "Start where you left off"; "Need help?" | REDESIGN |
| N10 print links | "Print practice sheet" / "Print the whole reading" | ST (print), Decided here 8 |
| N10 tabs | Today · Reading · Learn · Account; Today · Practice · Honors · Account; This week · Students · Lessons · More; This week · Students · People · More | Decision 1 |
| N4 word card | "This vowel says o (qamats katan)." | Decision 10 |
| N20 | "Continue with Google" | Decision 8 |
| N22 | "Copy link" | Decision 12 |
| N21 | "Ceremony done"; "This can't be undone here" | Decision 13 |
| N6/N7 | "Rabbi Daniel Bogard" (credit) | Decision 4 |
| N3, N20 | "Tap verse numbers to choose them."; "Sign in to save" | Batch 4 F-fix lines |
| N24 | "Nothing is saved on this device yet." and the rest of `lib/offline/copy.ts` | 2026-10-23 approvals |
| N3 | Aliyah labels as print words them | Precedent (print) |

### Tier B: drafted in the review, not in decision 11's list (one batch for Daniel)

Each stays off until answered. Source IDs point to the lens findings.

- **N11:** "Practice verses {range}" (Next button shape); "Latest from {tutor} · {date}: …" (ST-03); "Days you practised · a day fills when you open your reading up close" (ST-12); "Skip past the reading" (REDESIGN).
- **N13:** "Sit with Noa while she reads each verse. Tap Got it only when she reads it without stopping." (TP-03); "Practising with Noa · Switch to Eli · Done" (TP-16); "Family honors · 6 of 7 sections saved · Edit" (TP-15); "Open the honors form" (ST-10); "Send a new code" (ST-17).
- **N14:** "Needs you" (heading); "Needs work"; "Noa is still working on 3 verses: Gen 23:1, 23:10, 24:7" and "Nothing marked yet. Marks appear here when Noa uses Still working or Got it." (TP-01); "Note for Noa on 23:10" (TP-24); "Reading needs review" and "Confirm reading is still right" (AD-05); "This is a Sunday. Is that right?" (AD-12); "Service (needed to suggest the reading)" (AD-02 label).
- **N15:** "Teaches 3 students: Noa, Eli, Leah" and "Move these students to: [tutor]" (AD-04); "Noa's family is waiting for aliyah divisions to name aliyah honorees. Set divisions." (TP-05); "Family: invitation sent, not yet accepted" / "Family: {name} (joined)" (TP-12).
- **N16:** "This is taking a while. Try again in a minute." and "Update the staff roster Sheet" (AD-11); "Email is on/off for this portal" (AD-13); "Nothing to review yet" (AD-14); "Import the 2 ready rows" (AD-10); "Members" (AD-17); "To connect, add this portal as a connector in Claude (Settings -> Connectors) using <address>, then sign in here when Claude asks." (TP-21).
- **N17:** "In your reading"; "Back to my reading"; "First phrase of your verse" (LD-05, LD-16, ST-07).
- **N18:** "Read it, then pick the tune"; "Sing it (in your head or out loud), then check."; "Same" / "Not quite"; "Here is a zakef from another verse. Tap the zakef in this one."; "More about {family}" (LD-02, LD-01, LD-20).
- **N19:** "Run-through"; "Clean" / "Stumbled"; "Clean: 7 of 9. Practise verses 3 and 8."; "Help: Colours → Marks only → Tikkun"; "Try it in the tikkun."; "Chant this verse" (LD-07, LD-12, LD-13).
- **N4/N5/N7:** "Sources ({n})" (REPORT G2); "English" tag (DP-05); "Back to the reading" (DP-11); "Next Shabbat: Vayera, October 31" (DP-19); "Rare trope this week: shalshelet, 19:16" (DP-10); "This portion" (DP-03); "Show the halves" and "The pause in the tune is a pause in the sense." (LD-15).
- **N8:** "read" chip and "Chant this word (qere). The scroll writes it differently (ketiv)." (HB-03).
- **N22:** "Central Reform Congregation invited you as a parent on CRC Torah, to follow your child's Beit Mitzvah preparation. The link works until {date}." (TP-09, matches decision 12); "Expires tomorrow" (G13); "Needs a parent invitation" (G13); approver line "Asking about a child? Approve, then ask the office to send a parent invitation." and approval-email line "To follow a student's preparation, ask the congregation for a parent invitation." (TP-06).
- **N23:** "Tue Oct 20 · Torah 23:1–23:9 · marked 23:4 Got it" (TP-02); "Often mixed up: tevir and etnachta" and "Your tutor sees which phrases you can hear." (LD-10); "Practised 3 of last 7 days · Last lesson Oct 17 · 2 verses still working" (TP-11); "Student (with parent): got it" (TP-20).
- **P4 (G19):** "one more try".

### Tier C: gaps (no draft anywhere; not invented here)

- **N23:** the student's full disclosure of what the tutor sees (per-day verses and mark changes, beyond the Learn line); the parent's count line.
- **N21:** the confirmation before "Ceremony done"; the staff list heading for ceremony-done students; anything the student sees after the state is set.
- **N22:** the invitation email's subject line.
- **N14:** one sentence per Needs-you condition not drafted above (no tutor, invitation expired, no reading, service not set, honors not started).
- **N7:** a heading for the insights column, if M6's existing headings don't fit.
- **N24:** a label for the packed assigned reading on /offline, if `copy.ts` has none that fits.
- **N1:** none expected (Sefaria's credit is used as served); if the UI needs a sentence to choose the alternative edition, it is a gap.

## Exit for the whole plan

- v1.8.2, v1.9.0 and v2.0.0 tagged in order, each with tests green on Windows and in CI and a deploy Daniel can open.
- N16's re-measure passes (CLS below 0.1, INP below 200 ms, axe clean).
- Every adversarial review recorded beside its PR, with its fixes in the merged head.
- STATE.md's resume point updated at each tag.

## Open items that wait on Daniel

1. **The tier B string batch** (about 60 drafted strings above), as one popup batch. Recommended: send it now, so N11, N13, N14 and N17–N19 are not held.
2. **The tier C gaps**, drafted by Claude into the same batch once each milestone's screen exists.
3. **Taamey Frank CLM**, only if N2 finds its licence differs from Stam Ashkenaz CLM's GPL v2 with font exception, or if a subset or WOFF2 of it is wanted later.
4. **Still open from before:** the beta word; the pilot kit; licence questions for any evening or Havdalah prayer whose text is only in a licensed lane (SC7); DNS for torah.centralreform.org (waiting on others).
