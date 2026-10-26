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

### N6 (portion summary data and MCP), decided while building

- **N6.1 Migration number.** N6 takes `0044_portion_summary`: SC2 (#77) holds 0043 and merges first, so N6 renumbered from 0043 (item 12's house practice) rather than waiting for the proposed 0046. #77 merged first (production ledger 44), so 0044 sits after 0043 in the journal and its snapshot is regenerated on top of 0043's; the migration test reads every "adds only this table" check relative to 0043. SC4 and SC5 renumber after it.
- **N6.2 Revisions, not edits.** Each draft is a new revision whose words, parashah and drafter never change (trigger-enforced), so an approval approves exactly the text the rabbi read. States: draft → approved → withdrawn, or draft → withdrawn; withdrawn is final. At most one approved revision per parashah (a partial unique index); approving a new one withdraws the old in the same transaction, and withdrawing the approved one never brings an older one back.
- **N6.3 Who may do what.** All four tools are admin only (a tutor, parent or student never sees them; members cannot write at all, and no web route writes). Drafting and listing are open to an admin's scheduled routine ("Claude drafts each week"); approving and withdrawing are attended only, re-lock the admin grant (`lockRabbi`) in the write transaction, and the database itself refuses an approval unless it names a live admin grant of a live membership of the same tenant, stamped `now()`; the trigger also refuses a draft whose `drafted_by` holds no live admin grant (admin rather than "staff", because only admins draft). Stricter than "staff" in the plan's wording, so logged here (adversarial review, 2026-10-24).
- **N6.4 Credit.** The credit is stamped onto the revision at approval from a per-congregation table (`src/lib/portion-summary/credit.ts`, CRC: "Rabbi Daniel Bogard"), whoever of the rabbis or administrators approves, per decision 4. The trigger checks it against `public.portal_portion_summary_credit(tenant)` in SQL, which mirrors that table (a test holds them equal), so a write outside the service cannot stamp other text. A congregation without a credit cannot approve at all, rather than showing an uncredited summary.
- **N6.5 Shape.** A summary is guide-rules prose (no links, HTML or hidden characters), at most 4 KB; the outline is exactly seven plain lines, aliyot 1–7 (no maftir line). Parashiyot only (combined ones included); special Shabbatot, festivals and fasts have none.
- **N6.6 One public read.** `readApprovedPortionSummary` (through the security-invoker `portion_summary_public` view, approved rows only) behind `GET /api/public/portion-summary?reading=<slug>`, the same answer signed in or out; a change reaches every cache within about ten minutes (CDN 300 s, stale 60 s, browser 60 s). Until N7 renders it, an approval is public data no page shows, so the tools say it "will show once the reading page displays summaries" and never claim readers see it. /read, Study, print and the offline pack all read this one route (N7 renders it; N24 owns adding it to `PACK_DATA_PATH`, so until then no pack can hold it). The membership and grant ids (`drafted_by`, `approved_by`, `approved_grant_id`) are never readable by the runtime.
- **N6.7 Insights column needs no migration.** M6's `curated_discussion_source.anchor_ref` already anchors every source to one verse, and `/api/public/discussions?reading=` already returns a parashah's published sources in reading order; N7 builds the column on that unchanged. M6 is admin-only to write, so nothing a member writes can reach it.
- **P4.1 The word card's CC BY change notice stays.** F-SITE 15 asked to drop "Normalized into selected-word facts". That sentence is the change notice CC BY 4.0 requires for the adapted dictionary data, so it is kept. Removing it would be a licence question for Daniel, and keeping it needs no ruling.
- **L1 Codex's sound-first curriculum lands as #84, replacing #83 (Daniel, 2026-10-24, popups).** #84 merges `codex/chanting-curriculum` (78f6c9a), N17a and main into one Learn PR.
  - (1) Every drafted learner line is approved. Claude tidies them: straight apostrophes, "practise" as the verb, and nothing longer than two sentences.
  - (2) "Part n of m" stays. The home count "Can hear: n of m" is removed.
  - (3) "Start where you are" stays, collapsed below the main action, signed out too, with no level stored. This replaces the earlier no-starting-choice decision.
  - (4) Same/different is cut everywhere, review included. Recognition is optional naming on models the learner has already heard.
  - (5) "You can lein this verse." stands alone, without Codex's qualifier.
  - (6) Guided verse practice uses the approved LD-03 "Your turn" lines.
  - (7) A first-verse lesson counts as visited without "Same as the reader".
  - (8) N19a: the starter is Gen 1:1 (parts 0–2 and 3–6), with Ex 25:8 as the prepared alternative.
    - #84 merged (1e1c4c3) without making the switch. Its first-verse lesson takes this week's shortest Torah verse that has a ready recording (12 words or fewer). If none qualifies it falls back to Gen 1:1, then Num 6:26, then Deut 6:4.
    - Making Gen 1:1 the fixed starter is N19a's remaining work:
      - a course-verse source option in the validator;
      - `first-verse.tsx` taking the course verse ahead of this week's;
      - Ex 25:8 in the offline pack and its snapshot;
      - new wording for the lesson's title, summary, goal and body, which now say "this week's reading". This wording is tier C, drafted by Cowork in its 1.9 handoff T3.
    - Done on `release-1-9/learn-t3-n19a` (2026-10-25), with Daniel's T3 answers ("Keep all"):
      - The validator takes `source: "course"` with `pick: "course-order"`; the Torah first-verse lesson uses it and the haftarah lesson keeps `this-week`.
      - The lesson's examples run Genesis 1:1 (parts 0–2 and 3–6), then Exodus 25:8 (parts 0–2 and 3–4), then the two older fallbacks. `first-verse.tsx` shows a student's own reading (N17) first, and otherwise only those, never asking for this week's reading.
      - Exodus 25:8 was already an example of two Torah lessons, so the offline pack and its snapshot already held it; a test now pins both verses in the pack. Both verses have reference recordings with word timings (checked against the public short-resolution route), so no generated chant is involved.
      - The signed-out first-phrase row reads "This week's first phrase" and opens `/learn/prepare` (or `?kind=haftarah`), on both paths, once the account check has answered "none".
  - /learn/prepare joins the public page-view count.
- **C1 Daniel's answers in Cowork's 1.9 session (2026-10-25, recorded verbatim in `cowork-offload/1.9/QUESTIONS-1.9.md`).**
  - SC7 is held. Daniel's answer was "Hold the evening course". The public Shirei Tfilah mirror is two months behind and the local feeds are licensed builds. He also said "There is a beit Mitzvah siddur in the repo. That is the main one". Lane 3 runs N17 → N18 → N19 → SC6 without SC7. v2.0.0 waits on SC7 or on Daniel releasing it from the set.
  - Calendar: "Hebcal wins". T10's 11 live-site mismatches are fixed in a calendar PR, with T10-CALENDAR.json as test fixtures.
  - Rate limit: "600/min, IP only". Daniel changes the Vercel Firewall rule himself (Cowork T7-OPS-STEPS.md).
  - Pilot: "Pilot on torah.* once DNS is done".
  - Beta: "Checklist as a reminder; my word decides" (Cowork T9-BETA.md).
  - T12 (2.5 scoping) is skipped for now.
  - T1 and T2: the 10 portion summaries are approved. T2 takes the top six sources as they are, and each discussion is titled "Sources for {parashah}". Both load through the staff MCP: summaries as drafts, which Daniel approves himself in the app because approval stamps the credit.
  - T6: no licence differs from this plan. N2 and N8 follow T6-FONTS.md steps 1–8.

### N10 (tab bar and role shells), decided while building

- **N10.1 Interim destinations.** Until N11 (Today) and N14 (This week) build their own screens, those tabs open the role's current home, and tabs that share a home tell themselves apart by `?tab=`. Student: Today is `/workspace/student`, Reading is the same page at `?tab=reading`. Parent: Today `/workspace/parent`; Practice returns to the open child (`/workspace/practice/{id}`) or opens `?tab=reading`, where "Practice with {child}" lives; Honors is `?tab=honors`, which brings the family honors heading into focus once a child is chosen. Tutor: This week `/workspace/tutor`; Students `/workspace/tutor?tab=reading`; Lessons stays on the open student at `?tab=lessons` (or opens the list, whose cards carry the view). Admin: This week `/workspace/admin/students`; Students the same list at `?tab=students`. N11 and N14 replace the home each "This week" and "Today" tab opens, and the `?tab=` alias on the list pages can then go.
- **N10.2 One `?tab=`.** On a student's page `?tab=reading|service|lessons` is the view, for all four roles (student, parent, tutor, admin; child practice too). It is written in place with the History API (no request, no history entry), a reload keeps it, and none means Reading. The staff tablist and its panels are reused as they were, now for everyone; the learner's "Service parts" jump link (about 20,000 px) is gone.
- **N10.3 People and More.** Admin People opens a three-link strip (Invitations, Tutors, Accounts) that sits on those three pages; More is a new page, `/workspace/more`, listing the destinations that have no tab: Settings, Email settings, Claude connections, Recording review and, moved here from the Students header, "Update staff Sheet". A tutor's More lists Email settings and Claude connections, and Account requests when the tutor approves them. The seven-area `admin-nav` is deleted (D21 closed: nothing is off-screen).
- **N10.4 Account.** `/account` is outside `/workspace`, so its signed-in view carries the same tab bar; signed out it has none. Learn is a way out to the public `/learn`, which has no tab bar (decision 1), so it is never the current tab.
- **N10.5 Shared pages and role.** A page that is one role's (`/workspace/student`, `parent` or `practice`, `tutor`, `admin`) shows that role's tabs. Account, Email, Claude, More and `/workspace` keep the role last used while the page stays open (kept in page memory, never in web storage, as the student-work privacy test requires), else the highest role, which is also where a reload lands.
- **N10.6 The section chip row is a slot.** N3's chip component does not exist yet, so the Reading bar has a marked slot beside the Reading, Service parts, Lessons tabs in `reading.tsx`; N3 places its chip row there (the sticky bar is N3's).
- **N10.7 Skip link and landmark.** The bar is `<nav aria-label="Workspace">` with a second skip link ahead of the page, "Skip to workspace tabs", that lands on it. Both strings are wording gaps (see the report); they are read by assistive technology only.
- **N10.8 Keyboard.** The bar hides only while a text field has focus and the visible viewport has lost more than the larger of 120 px and 15 percent of the window; in the 1000 px rail it never hides.

### N11 (student Today), decided while building

- **N11.1 Where Today is.** `/workspace/student` with no `?tab=` (or one that is not reading, service or lessons) is Today; `?tab=reading|service|lessons` is the reading page exactly as before. So sign-in, the role choice and the Today tab all land on Today, and the Reading tab opens `?tab=reading`. No new route and no new API: Today reads through the workspace reads the Reading page already uses (student list, assigned reading, verse marks, practice-calendar dates, lesson notes), for the one signed-in student only. Opening Today records nothing as practice. The http-browser tests that opened `/workspace/student` for the reading now open `?tab=reading` (portal-ui's landing check now looks for Today itself).
- **N11.2 Section states.** A row is Solid only when the tutor's assessment is solid on every verse of it; any tutor assessment, or the student's own Still working or Got it on any verse, makes it Working; else Not started. A student's own Got it never reads as the tutor's Solid. A reading with no aliyot is one row for the Torah and one for the haftarah. If the marks cannot be read the rows show no state rather than a false "Not started".
- **N11.3 The Next card.** The first row that is not Solid. Once anything is practised (a practice day, or a mark) its one button is "Start where you left off"; before that it is "Practice verses {range}" (tier B, approved in the popups). Both open the Reading page: the workspace still has no address for one section (N3's left-for-others item (d) stands), so neither opens at the section. The calendar records dates only, so "where you left off" is the first section not yet Solid, not a remembered verse.
- **N11.4 The seven dots.** The seven days ending on the server's day, filled where the student's own practice calendar has that date. No number, count, total or streak is computed or said; each dot's spoken text is the weekday and "practiced" or "not practiced" (the words the week row already uses), never a date number.
- **N11.5 The calendar.** The existing "Practice calendar" month view (behind its disclosure), now taking marks and a last day: rehearsals as a lake ring and the ceremony as a marigold disc, each also said in words in the cell and in a two-word key, and the months run forward to the ceremony month. Staff views are unchanged.
- **N11.6 The lesson note.** The latest note, pinned: "Latest from {tutor} · {date}:" then the note (three lines, with "Lessons" beside it opening the Lessons view), and N12's line as "Before your next lesson: {text}" when the note has one. Nothing when there is no note.
- **N11.7 One and a half screens** is measured on Today itself (the main area), not the shell around it: with seven aliyot and a haftarah (eight rows) it is 1240 px at 390 wide against 1266. The shell (app bar, footer, tab bar) adds about 190 px that every screen carries.
- **N11.8 Kept from the old home.** An adult student's "Family honors" entry stays on Today (it was on the old home); the children's informational Family honors note stays on the Reading page only, to keep Today short.
- **N11.9 "Need help?"** on Account, for a student, links to the congregation's preparation guide (the same link, with the same attributes, as the reading page's "CRC preparation guide"). It is an external link, so it is a wording and destination choice to confirm.
- **N11.10 D11.** No date or reference in the hero is allowed to break across lines: each is one unbreakable unit and the line breaks between units. The old reading hero's dates got the same rule in CSS.
- **Left for others.** (a) Learn's "Back to my reading" link (N17's `learn/first-verse.tsx` and `learn/home.tsx`, not touched here) goes to `/workspace/student`, which is now Today; it should point at `?tab=reading`. (b) The old Reading hero's reference (`hero-reference`) still wraps by character on a narrow screen; it goes when N4 rebuilds that surface.

### N3 (aliyot, the picker and paging by aliyah), decided while building

- **N3.1 The pick is the section open.** `&pick=` takes print's words (`aliyah-1` to `aliyah-7`, `maftir`, `triennial`; `full` is left out of the address). Opening on an aliyah, or tapping its chip or "Next section", writes that aliyah as the pick, so Print, Save and the way back from sign-in carry it. `full` is the whole portion read from its first aliyah; choosing "Full calendar portion" returns to it. Print and Save of an aliyah are that aliyah only; Choose verses still chooses across the whole portion (the selection survives page changes). The triennial reading is its own passage (fetched by its ref) read in its own sections; a section of it is not a pick of its own, so the address keeps `pick=triennial`.
- **N3.2 Sections cut the server's pages, never new routes.** On /read a section is cut from the one or two of the server's 100-verse pages it lies on (cached per page, so the offline pack's by-date pages still serve it), with the next section's first verse taken from the same pages for the faint preview. In the workspace a section is a text page that starts where the aliyah does (the server cuts a page from any offset) and shows that page up to the aliyah's end; which section is open is simply the section the loaded page starts in. A section longer than a text page continues by the existing page controls (and, in the workspace, keeps "Aliyah n · continued from the previous text page"). A reading with no aliyot is paged exactly as before.
- **N3.3 What a week without a breakdown does.** A festival Saturday (Hebcal type holiday gives `full: []`), a week whose aliyot did not load, a haftarah, a named reading and any ref passage show no chips, no Portion control and no "Next section": Full only, the server's pages. When the calendar could not be asked, an asked-for `pick` is kept in the address so a reload can honour it, and Print then says Full. The reader is shown only once the aliyot have answered (or failed), so the first page is never one that is then replaced. One recorded aliyah (an explicit empty list) and one calendar aliyah are no paging, and the Portion control is not drawn for them.
- **N3.4 The chip row sits above the passage, not in the page-tab row.** N10.6 marked a slot in `reading.tsx` beside Reading, Service parts and Lessons, but a learner's tab row is under the reading (to keep the first verse above the fold), so the chips would have been at the foot. `SectionTabs` (in `components/ui`) is a sticky bar above the text for every role; in the workspace its last chip, "Service parts", opens that page tab (`onService`). The slot comment in `reading.tsx` now says so.
- **N3.5 F4 and G14.** A second tap after exactly one verse, on a later verse, makes the range (`tapVerse`); an earlier verse is its own verse; Shift and Select range extend from the last verse tapped as before. The Choose verses bar offers "Print" (existing label) for exactly the chosen verses (`/print?ref=Genesis+18%3A1-10&kind=torah`). Lens switches run in a transition with an optimistic pressed state (`LensSwitch`), so the tap returns at once and the section is set again in the background. The colour switch stays synchronous: the reading preferences live in an external store, whose updates cannot be transitions, and a first attempt to defer them where the text reads them made the existing browser tests that read the DOM straight after a toggle race (CI caught it), so it was taken out. On the longest aliyah (40 verses) the colour switch is about 180 ms at 4x CPU (208 ms on the old 100-verse page), under the 500 ms bar. `content-visibility` was not needed.
- **Measured (synthetic Vayera, verses of 10 to 15 invented words, built production server, desktop Chrome).** Study's DOM on its first page: before 5,299 nodes in the document (5,137 in the reading) for 100 verses; after 928 (742) for Aliyah 1's 14 verses, 5.7 and 6.9 times smaller. By section (verses: reading nodes): Aliyah 1 14: 742, 2 19: 1,010, 3 20: 1,069, 4 40: 2,081, 5 17: 910, 6 13: 704, 7 24: 1,267, Maftir 5: 293. The 5x holds for the pages Study opens on and for five of the eight sections; Aliyah 3 (4.8x), 7 (4.1x) and 4 (2.5x, the longest aliyah, 40 verses) are smaller by their verse count (each Study verse is about 50 nodes). Longest lens-switch event at 4x CPU: before 464 to 704 ms (Lein to Study, three runs), after 32 to 112 ms over several runs; the Colors switch 208 ms before and about 184 ms after on the 40-verse aliyah (it stays synchronous).
- **Left for others.** (a) N24: `/api/public/aliyot?date=` is not in the offline pack, so offline /read degrades to Full only. (b) A named parashah (`?reading=vayera`) has no date, so it has no aliyot; the calendar route is by date. N5's "More" sheet could offer a way to open a parashah by its week. (c) N4 and N5: the Portion control sits with Choose verses and moves into N5's "More" sheet; N4's dock and the sticky chip bar share the top and bottom edges. (d) N11: the workspace has no address for a section yet (`?tab=reading` opens the first, and the chips go on from there), so Today's section rows can open the reading but not a given section until one is added; /read has `&pick=`. (e) Wording gaps are in the N3 report.

### N4 (one Sheet and the tool dock), decided while building

- **N4.1 The ruling on Lein.** Daniel's Friday-preparation ruling ("Study opens a word's meaning and offers grammar. Lein hears the reading by default") overrides the line "Lein opens the word card in the sheet". A word tap in Lein is unchanged: it plays the verse where there is a recording, and where there is none it opens Word tools in place, exactly as on main. The Study word card is the Sheet. The one control that opens a word's meaning in Lein is the existing "Word tools" disclosure (inline, as before). **Gap: a way to open meaning from Lein, inside the Sheet, is not built.** What Lein did get from F5: each word is named by its Hebrew, the words are one Tab stop, the targets are wider.
- **N4.2 One Sheet.** `VersePanelScope` renders one `Sheet` (N9) for the word card, Compare, More on this verse and a verse's curated sources, at every width. The column beside the text on wide screens and the in-place panel on phones are gone. Opening moves no scroll; closing (Esc, a tap outside, Close, a swipe down) returns focus to the word the card was last on (scrolled into view only if Next word took it off screen), the action, or the list entry. `escapeClosesPanel` is deleted: Esc is the Sheet's. N9's Sheet had one bug, fixed here: Tab's wrap looked for a last stop inside a closed <details> (the browser still gives it boxes), so Tab left the sheet; closed details are now skipped except their summary.
- **N4.3 Verse tools, for the selected verse only (workspace).** The per-verse "Verse tools" cards (46 of them, 10,500 px on Noa's page) are one Sheet, "Verse tools · {ref}", holding the selected verse's mark, English (Lein), apparatus notes, study-guide notes, Rashi (Lein), Sources and "Your translation & notes". A verse is selected by tapping its number, one of its words or Up close; the first verse is selected until then. The bar under the passage ("Verse tools · {ref}", "View {ref} up close", the mark) opens it, and in Study each verse's own actions gain "Verse tools". Closing the sheet asks only the sources guard (the choices live in the sheet), never the work guard: unsent translation and notes live in the work coordinator, so closing loses nothing and reopening shows them. **Decision, logged:** /read keeps its inline tools for the focused verse (Rashi, the translate drill, Up close), which were already for one verse only; moving the drill into a sheet was not worth its risk. **View up close keeps its stage** (REPORT: the lifted line stays as it is); what moved is its opener, into the bar. **Gap: Lein with no recording has no silent way to select a verse** (a number is inert; a word tap selects and opens Word tools).
- **N4.4 G2: "Sources (n)", and only where there are sources.** Tier B's "Sources ({n})" was approved ("Keep all"). A verse with none shows no Sources control to a reader or a child; staff keep the bare "Sources" (the way to add the first). The count is its own read, so the panel's state machine is unchanged. A student can no longer browse related sources on a verse that has none (the companion ruling: members collect nothing).
- **N4.5 F5.** The words of a passage are one Tab stop (`WordGroup`), arrows cross verses (Home and End stay in the verse). A word's accessible name is its Hebrew; what a tap does is its `aria-describedby`: one hidden line per verse, not per word (per-word lines cost 2 DOM nodes per word and broke N3's 5x budget). Verse numbers are 44 px boxes whose negative margins leave the line as it was. **G23:** a pseudo-element reaches 0.35em above and below and 0.2em beside a tappable word; no text or colour block moves. "Skip to the reading" on /read now lands on the reading (the dock is the next stop); before, it landed on the page's main, 15 stops above the dock. Measured: skip, Tab reaches the dock on press 2 and the words on press 8.
- **N4.6 The dock.** On phones and tablets (1000px and narrower) the toolbar is fixed at the foot, above the tab bar (`--shell-bar-h`) or the home indicator; the passage keeps `--dock-clear` as bottom padding and as `scroll-padding-bottom`; Choose verses' bottom bar sits above it; the size menu opens above it; it hides only while the keyboard is open. The dock and N3's sticky chip bar do not meet: one is the top edge, the other the bottom. From 1000px the tab bar is a rail, so the dock stands above a bar only below that. DESIGN.md's phone toolbar rule is amended (2026-10-25).
- **N4.7 Qamats qatan.** The source marks it. Miqra according to the Masorah writes every qamats qatan with its own code point, U+05C7 (docs/superpowers/research/2026-10-15-trope-engine/hebrew-text-pipeline.md, verified against Sefaria's text; N2-RENDERING.md found it 6 times in Genesis 18 and 24:30-36: וַיָּ֤רׇץ, כׇּל, לְכׇל, וּכְשׇׁמְע֗וֹ). The card shows "This vowel says o (qamats katan)." only for a word that carries U+05C7, in the Study card and in Word tools; no word list.
- **Wording gaps (screen-reader only, not approved).** The description of what a tap on a word does is the old label without its number and verse: "Open word", "Select word for tools", "Focus phrase", "Hear whole verse; select word for tools", "Hear whole verse", "Hear word". "Verse tools" as the name of a Study verse's action (the heading "Verse tools · {ref}" is precedent). None is visible text.
- **Left for others.** N5: the header still puts 15 Tab stops before the dock (its two-line header and "More" sheet fix that); the Portion control and Choose verses move into "More". N7: the insights column and commentary Hebrew scaling; commentary and the word card now open in the same Sheet. N8: the word card's Hebrew uses the reading face when it changes. N14: tutor marks are no longer visible for every verse on the page (only the selected verse's); the "Needs work" block there is now the overview. Tests: seven http-browser files now open a verse's sheet first (`tests/http-browser/verse-tools.ts`).

### N5 (public /read header and Study polish), decided while building

- **N5.1 The header.** Two lines: the eyebrow ("This Shabbat" or "Shabbat" and the date as "October 31", the year only when it is not this year's, then the offline pill), then the name at title size with Previous week, Next week and More. The long date and both ranges, which were the old meta line, are the first line inside More. A named reading or any passage has the same header without the arrows; a member's saved reading keeps its earlier `Hero` (not changed here).
- **N5.2 More is one Sheet, with a slot.** The page keeps whether it is open (`MoreScope`); the passage, which owns Choose verses and the Portion control, puts those two into the sheet with a portal while it is open. Order: ranges, Start reading, Portion, Choose verses (and Whole portion or Back to selection), Print, Save, Find a date, This week (off this week), Choose a reading (its panel opens inside the sheet), Trope chart, the siddur blessings. **Start reading is also in More**, not in the header: the text is already at the top, and the dock's Hear verse plays. An action that moves focus closes the sheet first and then acts (`close(then)`), because the sheet gives focus back to More on close and would otherwise win over the reading or the Choose bar. Choosing a portion closes the sheet; Find a date leaves it open (a date typed in parts fires change before it is done). After a selection ends, focus returns to More.
- **N5.3 Save offered on the way back from sign-in opens More.** The Save card now lives in the sheet, which mounts it only while open, so a return from sign-in with the offer (and no chosen verses) opens the sheet at load and Save asks at once, as before. A return with chosen verses is the Choose bar's own Save and does not open it.
- **N5.4 First Hebrew on a Pixel 7 (412 x 915, with the aliyah chips and the haftarah): 1121 px before (Lein; Study 1176), 304 px after (Lein; Study 358).** What took the room: the app bar and page margins (tightened on /read at 640px and under), the lens row, the chips bar's padding, and the first section label, which repeats the selected chip: it stays for assistive technology (the panel is named by it too) and leaves the sight line. Study keeps its place row (the reference and the chapter jump) above the first verse, so it starts about 50 px lower; it is measured, not held to 320. **Tab stops before the dock: 15 before, 11 now** (skip link, brand, Sign in, two arrows, More, four lens buttons, the first chip); the skip link still lands on the reading.
- **N5.5 The reading block holds a screen, not 70svh.** With a two-line header the reading starts so high that 70svh no longer reached the foot of the screen, so the Save card showed while the text loaded and pushed itself away when it came (CLS 0.6 in Study, caught by P2's test). The block now holds `100svh - 3rem`. CLS at 4x CPU: Lein 0.0007 and Study 0.0066 with the chips and the aliyot answer.
- **N5.6 The Choose verses bar is the count line over one row of buttons** (compact 44px targets, Select range, Clear, Save, Print, Cancel), sharing the row from 700px; at 412px it is about 90 px tall instead of about 200. Below about 380px the buttons wrap to a second row rather than shrink.
- **N5.7 G17.** (a) Commentary Hebrew (`hebrewText`, the quoted words, Targum and Talmud text, Hebrew inside English) is `calc(base * --comment-scale)`; the scale is set by the same four steps as the reading (0.8125, 1, 1.25, 1.5625) on `.assigned-study` and on the verse panel in the Sheet, so Standard is unchanged (19 px) and Huge is 29.7 px. (b) More on this verse: an opened text names its English with an "English" chip, English is first (it already led; the credit lines now put English before Hebrew). (c) /print has "Back to the reading", the same reading and the same part of it. (d) On a Saturday (the congregation's day) the home leads with the Shabbat after it, with "Next Shabbat" as its label, that week's own address for Lein and Study, and "This Shabbat" as a link to the day's reading. (e) The rare-trope note, "Rare trope this week: shalshelet, 19:16", from a table of the four places in the Torah, checked against the week's Torah verses; it is the sheet's second line and a line at the foot of the Torah section, not above the reading, so the four weeks it shows in keep the first Hebrew above 320 px.
- **Strings.** All tier B lines used are approved ("Keep all", 2026-10-24). Gap: the full line "Next Shabbat: Vayera, October 31" is not used as one sentence, because the home already sets the parashah and the date in large type under the label; and "This Shabbat" as a link text is the existing label. The sheet's title "More" and the arrows' names ("Previous week", "Next week") are existing words. Nothing else is new.
- **Left for others.** A member's saved reading still has the earlier header, with its controls inline. The Study place row could be folded into the chips' bar. A parashah opened by name (`?reading=`) still has no week arrows.

### N7 (portion summary block and the sources column), decided while building

- **N7.1 Where the block shows.** "This portion" is atop Study, never in Lein (the chant-first page keeps its first Hebrew above the fold). It is drawn for a parashah's Torah only: /read by Shabbat date (the parashah's name from the week) or by name (`?reading=vayera`), and a signed-in student's Study whose confirmed reading carries a parashah `readingKey`. A haftarah, a special Shabbat, a festival, a fast, a passage by ref, a saved reading, print and the offline pack have none (print and the pack are not N7's; N24 owns adding the route to `PACK_DATA_PATH`). It reads only `/api/public/portion-summary`, so a draft or a withdrawn revision cannot reach it; a parashah with none, a failure or a malformed answer draws nothing at all (no heading, no placeholder).
- **N7.2 Words.** The heading is the approved tier B line "This portion" (answered "Keep all", 2026-10-24), written as the `<summary>` of a `<details open>` so a phone reader can fold the block and have the verses back (no new string). The credit is the revision's stamped `credit` verbatim ("Rabbi Daniel Bogard" at CRC), on its own line under the prose, with no "by" in front (none is approved). The summary is drawn with the guide's own markdown subset; the answer is parsed strictly (seven outline lines in order, a credit, no control or hidden characters).
- **N7.3 When an outline line jumps.** A line is a button to its aliyah only where the page has that aliyah as a section: /read's full calendar portion (the chips' own sections; the triennial reading's sections are different verses, so there the lines are plain text), and the workspace only where the tutor recorded the whole portion aliyah by aliyah (seven or more sections), because a student's own divisions are not the calendar's. Elsewhere the lines are plain, promising nothing. On /read a jump is the same move as the chips (`pick=aliyah-n`, the page and focus on its first verse; the aliyah already open only takes focus to its text); in the workspace it is `jumpTo` the section's first verse.
- **N7.4 The sources column.** Daniel's answer to T3 N7-1 ("Alternatives": "Sources" for "Sources for this reading") is the column's heading and the phone sheet's title: `DISCUSSION_LABELS.column`. `list` ("Sources for this reading") stays, only as print's choice and its status lines, which T3 did not ask to change. From 1180px the column is the reading layout's third column, to the right of the toolbar rail and the text, sticky, and it only makes the text column wrap more: the Hebrew keeps its size setting (measured 32px at Standard with the column, as without it). Below 1180px (phones and tablets, where the dock lives) the column is not drawn and a "Sources" button in flow above the text opens the same list in the Sheet: one tap, over no verse (the Sheet is the only thing that covers anything, and only while open). A source chosen there gives way to that verse's own sources in the one Sheet; Esc returns focus to the Sources button and "Back to this verse" to the verse. "Sources on this verse" (the marker) and "Back to this verse" are unchanged. The breakpoint is 1180, not the dock's 1000, so the text column keeps about 680px at 1280 and is never narrower than a verse line needs.
- **N7.5 "Show the halves" (G9) is not built.** Its string and its companion line are approved tier B text ("Keep all"), but splitting the English at the etnachta has no data to stand on: the translation is one licensed string per verse with no alignment to the Hebrew, and cutting a licensed text by guess is a decision about the licensed text, not a string. It stays off; the work is a design item for Daniel (an alignment source, or a halves-only treatment of the Hebrew).
- **N7.6 /read strings.** N20-1 and N20-2 (approved, "Keep it"): a signed-in account that cannot save, when it has the student role (asked from `/api/session` only after the 403), is told "Student accounts don’t save other readings. Your assigned reading is always under Reading." with the link "Open your reading" to `/workspace/student?tab=reading`; any other account that cannot save keeps "Ask for an account to save readings". **P4-8 (the hidden ", opens in a new tab" on siddur links) is not in N7** (lead, 2026-10-25): PR #108 adds it inside the shared `SiddurLink`, so the /read blessings links get it when that merges.
- **N7.7 MCP wording.** The approval note, the tool's description and the instructions no longer say an approved summary "will show once the reading page displays summaries"; they say it shows atop Study within about ten minutes, which is now true.
- **Gaps.** (a) "Show the halves" and its companion line, above. (b) Print and the offline pack carry no summary. (c) The signed-in Study draws the block only for a parashah the confirmed reading names (`readingKey`); a student assigned a part of a parashah sees the whole portion's summary, with plain lines. (d) No new words were needed beyond the approved ones.

### N19 (review and readiness for the student's own verses), decided while building

- **N19.1 Its own document and migration.** Verse cards are a separate `learn-verses/v1` document in a new table, `verse_review`, migration `0047_verse_review` (journal idx 47, renumbered from the proposed 0048 after N12 took 0045 and SC4 0046). It is a copy of 0037 with its own owner setting, `app.verse_review_owner`, set only in `src/server/verse-review/access.ts`, as SC4 forked 0037 for the service course. Every stored `learn-progress/v1` document and its strict parser are unchanged. Not applied to production here.
- **N19.2 Students only.** Only a membership with a live student grant keeps verse cards (403 for a tutor, parent, admin or Member). The routes are `GET /api/learn/verses` and `POST /api/learn/verses/put`, private and no-store; a stale version answers 409 with the current document and the browser merges (each card at the higher box). There is no staff, parent, MCP or Sheet reader, and no audit row.
- **N19.3 No copy on the device, and never into another account.** Unlike phrase progress, the cards live only in the account: fetched once per page, changed in memory, written back. A shared device never holds one student's verse list for the next person. Every answer names an opaque owner (its own `learn-verses-owner/v1` hash), and every write names the owner its cards were read from; the server refuses a mismatch with a bare 403 before reading or writing anything. A page that sees another owner, a refusal, or a sign-out drops the cards it holds and sends nothing more (the second-agent review's finding, fixed here: sibling A's open tab after sibling B signs in elsewhere).
- **N19.3a After the ceremony** no verse card is asked (`dueVerses` is empty once the date has passed); before it, no card is later than the day before.
- **N19.4 Where cards come from.** On Learn, a signed-in student's own Got it marks and the tutor's Solid marks are read through the same workspace progress API the student's Reading screen uses (`GET /api/students/{id}/progress?mode=student`), and each such verse becomes a card in box 1, due after box 1's gap, capped by the ceremony. A card is never removed when a mark is cleared. Lein's saved-reading marks are not a source.
- **N19.5 Results.** Clean moves a card up one box only when it is due, at most once per run. Stumbled drops it two boxes and brings it back today, and a stumbled verse with no card gets one in box 0, due today. Due verse cards follow the phrase items in `/learn/review` with the same Clean and Stumbled.
- **N19.6 The fade.** Help is Colors → Marks only → Tikkun, a suggestion by box (box 0–1 Colors, 2 Marks only, 3+ Tikkun); the Run-through never suggests Colors. Every level is one tap away. "Try it in the tikkun." shows when the tikkun is suggested and another level is open.
- **N19.7 The summary.** "Practise verses 3 and 8 again." names verses by number within a chapter, by chapter:verse across chapters, in full across books; one verse reads "Practise verse 3 again.". Nothing is said when nothing stumbled.
- **N19.8 The criteria.** The student's Got it line shows under the student's own marks; the tutor's Solid line shows under the tutor's and admin's assessment, with the child's first name in place of "they" (Daniel's name ruling for N13).
- **N19.9 Off until worded.** The stumble's join with its neighbour (CHANTING-RECONCILIATION §2) is built as a pure function and not rendered (`JOIN_OFFER_ENABLED = false`).

## Versions and tags

| Tag | When | Contents |
|---|---|---|
| v1.8.1 | #71 and #72 merged and deployed | 1.8.1 defects (X1–X12) and AD-01 |
| v1.8.2 | P1–P5 merged and deployed | the 1.8.2 defect set, plus F2 and F6 folded in |
| v1.9.0 | N1–N25 merged, deployed and re-measured (N16's exit) | the 1.9 set |
| ~~v1.9.1~~ | cut | MCP for members cut (Daniel, 2026-10-24) |
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
| 3. Learn and the course | P4 → N17a → SC3 → N17 → N18 → N19 → SC7 → SC6; N19a when Daniel approves its content (SC1 and SC2 merged). See CHANTING-RECONCILIATION.md |
| 4. Accounts and privacy | F1 (in progress) → N20 → SC4 → SC5 → N21 → N22 → N23 → N24 |

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

- **Covers:** D3 (/read and Study layout shift), D4 (/read "Find a date" row at 200% text), D10 (Start reading focus on /read), and two F6 findings P4 left because they live in `public-reading/*`: F-SITE 11 (the haftarah blessings label, approved as "page 23, after Mi Shebeirach") and F-SITE 25 (/read focus after navigation, with D10).
- **Files:** `public-reading/view.tsx` (the signed-out aside at ~100 moves after the reading or into a fixed slot; reserve the reading block's height), the date row's styles.
- **Depends on:** #71 merged.
- **Exit tests:** `S/visual/cls.cjs` (copy the script into the repo's e2e or a scratch run) reads below 0.1 on /read and Study at 4× CPU; at a 200% root font on a Pixel 7, /read is no wider than the viewport; after "Start reading", `document.activeElement` is the reading heading or first verse.
- **Done (1.8.2 P2).** Closed D3's /read part, D4's /read part, D10 and F-SITE 25 on /read, F-SITE 11, and F-SITE 19. Decided here:
  - The Save card (the aside) is added only once the reading's week or passage list has answered, below the reading, and the reading holds a screen of room (`min-height: 70svh`) while its text loads. The first paint draws the week navigation inert, with the date line and button row reserved. Measured with the repo spec `e2e/public-reader-layout.spec.ts` at 4x CPU and 120 ms of network delay: CLS 0 on desktop and tablet, at most 0.018 on a Pixel 7, in Lein and in Study (the baseline was 0.43 in Study). What remains on a phone is the loading title taking two lines and a parashah name one.
  - The date row wraps (`flex-wrap`, a 10rem field that may shrink to nothing); at a 200% root font on a Pixel 7 Lein, Study and the reading chooser fit 412 px. The check uses the configured device width, because Chrome's mobile emulation widens `innerWidth` to match overflowing content.
  - Start reading focuses the first verse's Hear button when verses can be heard, otherwise the labelled reading. A new text page (Previous/Next text page) does the same. Choosing a reading, and "This week" from a chosen reading, are full page loads, so they leave a 30-second note in session storage and the next reading focuses its heading once shown. Previous week, Next week and Find a date keep focus where it is: stepping through weeks by keyboard must not take the reader off the control, and a date field changes as digits are typed.
  - F-SITE 11 reads "Haftarah blessings: siddur page 23, after Mi Shebeirach" (the approved text, in the Torah line's form).
  - F-SITE 19: N20 had already made "Continue with Google" the one label on /sign-in and /; what still differed was /account's handoff link ("Continue to Google sign-in", now "Continue with Google") and the header. /sign-in and /trope-chart now wear the blue app bar; the chart's bar shows "Return to workspace" for a member and "Sign in" otherwise, after the session answers (the bar holds its height meanwhile); on paper the bar is plain. No new wording.

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
- **Done (#80, 8f3c7c5).** Closed D12, D23, G19's visual part, and F-SITE 10, 12 (already held), 20 and 22, plus most of 14, 21 and 23. What it left, and where it goes:
  - F-SITE 11 and 25 are in `public-reading/*`, so they move to P2.
  - F-SITE 19 (sign-in label and header drift) moves to N20's follow-up.
  - F-SITE 15: the "Normalized into selected-word facts" sentence is the CC BY 4.0 change notice, so it stays (Decided here P4.1). The dropped maqaf in "This word elsewhere" belongs to the word-details contract and goes with N1.
  - Tier C gaps (no approved draft): an "Other signs" heading for the poetic accents (14); the "3 of 10" position text (23); an announcement for Build the phrase (22); a "new tab" label (27).
  - Device check: the faded Hear it button before any tap needs iPhone Safari (23), so it waits for the pilot.

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
- **Done (1.9 N1).** Live check 2026-10-25: "Rashi Chumash, Metsudah Publications, 2009", CC-BY, English and Hebrew, present in all 187 Torah chapters. Decided here:
  - Metsudah's Hebrew is pinned first beside its English, because comments pair by index and its English matches its own Hebrew (two verses differ: Genesis 26:35, 49:24) but not the 1929 Hebrew (54 of 187 chapters, Numbers throughout). The 1929 edition stays next in both languages and answers any chapter Metsudah lacks.
  - No edition choice is stored anywhere, so no remembered choice is overridden; the Rashi on/off preference is untouched.
  - Print needed no code: the existing licence filter passes CC-BY and still refuses CC-BY-SA and unknown.
  - Gap (tier C, needs wording): an in-app control to switch a chapter to the 1929 edition. Today the credit links to Sefaria, where editions can be switched.
  - The dropped maqaf in "This word elsewhere" is not small: the word-details contract excludes the maqaf by design (`wordDetailsWord`, the wire alphabet and its binding hash), so it stays for the word-details work, not N1.

#### N2. Taamey Frank CLM: licence check and vendoring (S, Opus) — decision 10

- Locate Taamey Frank CLM in the official Culmus release on SourceForge (the Taamey faces may be a separate archive from `culmus-0.140`; record which). Read its licence file and the font's name-table notice. **If it is GPL v2 with the same font exception Stam Ashkenaz CLM carries, proceed** (Daniel already ruled the font in). If it differs in any way, stop: it is a licence question for Daniel.
- Vendor as Stam was (Decided here 4): the original TTF, the GPL text as `LICENSE.txt`, the `.sfd` source from the matching source archive, exact pins and hashes in `scripts/font-assets.mjs`, `.gitattributes` entries, and a PROVENANCE section quoting the exception.
- Check before the switch: the cmap covers U+0591–U+05C7 including U+05C7 (qamats qatan) and a visibly distinct qamats qatan glyph; `mark`/`mkmk` stacking renders Gen 18 and Gen 24:30–36 correctly in Chrome and Safari (page PDFs).
- **Exit tests:** repo-policy font tests green; PROVENANCE matches the bytes; a short rendering note with screenshots in this folder. No product surface uses the face yet (N8 switches it).
- **Done (1.9 N2).** Downloaded 2026-10-25: `TaameyFrankCLM.zip`, 705,731 bytes, SHA-256 `3b1674c4…97925`. Its Medium TTF, Medium SFD and `LICENSE` match T6's hashes exactly; the licence and name-table notice are GPL v2 with the Stam exception word for word, so no licence question arose. Vendored under `public/fonts/taamey-frank-clm/` with pins, `.gitattributes` and PROVENANCE; rendering note in `N2-RENDERING.md`. Decided here:
  - The screenshots are not in this folder, as the exit test asked: the repository policy refuses binary files outside the pinned fonts ("unreviewed binary content"), and that rule is not loosened for evidence. They are in `bneimitzvah-review-output/n2-taamey-rendering-2026-10-25/` and the note describes them.
  - "Safari" was checked with Playwright's WebKit on Windows; N8's switch gets one look on a real Apple device.

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
- **N8, decided while building (2026-10-26):**
  - **Floor:** CIEDE2000 of at least 7 between every pair of the eleven families (so no adjacent pair can fall below it), through normal vision, protanopia and deuteranopia (Machado 2009 and Vienot 1999), for the day set and the night set; the 1.0 colours put etnachta and pazer 0.8 apart for protanopia. Every fill carries the fixed dark ink at 5.4:1 or better. `tests/phrase-colors.test.mjs` measures it; the fills are CSS custom properties (`--phrase-<family>`) set in `globals.css`, night values under `prefers-color-scheme: dark`.
  - **Phrase-end cue (not colour):** the last word of a phrase carries a 0.14em bar of the fixed dark ink at its end edge. On a lifted line the bar shows only for the phrase being practised.
  - **Qere:** full size, and the tap target; the "read" chip follows it, then the ketiv at 0.62em, muted. The chip's sentence "Chant this word (qere). The scroll writes it differently (ketiv)." is read aloud (`sr-only`) and is the line under the verse in Study. Neither is copied with the Hebrew. On paper the same order; "Letters only" prints the ketiv alone, in Stam Ashkenaz CLM.
  - **Paragraph markers:** a small, muted samekh (closed) or pe (open) after the verse that ends a paragraph, hidden from screen readers (the spoken label stays) and skipped by copy.
  - **Tikkun on a phone at Large and Huge:** the pointed text and the scroll stack, line 1 then line 1 of the scroll, so the same words stay on a pair of lines and the type is no longer held at Standard.
  - **Subsets:** Hebrew-only WOFF2 of Taamey Frank CLM (26 KB) and Noto Serif Hebrew (67 KB); commands, hashes and the per-mark check are in `public/fonts/PROVENANCE.md`. Noto's `mkmk` is the one feature that goes, and it positions Hebrew marks only against Latin combining marks. Taamey keeps `mark` and `mkmk`.
  - **Learn and the service course also use Taamey Frank (Daniel, 2026-10-26):** the vowelled text in Learn lessons, the service course and the service-learning units. Left on Noto Serif Hebrew: the reference-review tool, the honoree landing page and the share card (the last two by Daniel's choice).
  - **LCP on /read:** checked locally, cheaply, on the production build: a local-only Playwright run (Pixel 7 emulation, 4x CPU slowdown, cold cache, synthetic Vayera, 5 runs) gave a median LCP of 1.08 s with the Hebrew font bytes on the page at 26 KB (the Taamey subset alone); before N8 the Hebrew face was the full 184 KB Noto TTF, so the bytes on the LCP path fall by 86 percent. An unrestricted Noto fallback had pulled in another 67 KB for the no-break space and en dash, which is why the reading stacks use the Hebrew-range fallback. CI's browser job is the real check.

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

- Migration (`0045_lesson_note_before_next.sql`; proposed as 0047, renumbered to merge before SC4): an optional bounded text column on the lesson note, same readers and RLS as the note; tutor input with the if-then prompt; the student sees it on Today.
- **Check:** RLS and readers unchanged (a second agent confirms; not a widening).
- **Exit tests:** saved and shown to the student and parent who already read the note; nobody else reads it; too long is refused with one error (as X11).
- **Built (1.9 N12, migration `0045_lesson_note_before_next`, not yet applied to production).** One nullable `before_next` column on `lesson_log` with a CHECK, plus `GRANT UPDATE (before_next)`; no new policy, table grant or trigger, so the readers are the note's own. Decided here:
  - The line is at most 1024 UTF-8 bytes (server, CHECK and form agree); blank is no line (stored null). Too long is one error, the existing "Too long to save. Shorten this note a little." under the field, and Save returns the writer to the field (as X11).
  - An edit that leaves `beforeNext` out keeps the saved line (a page from before this release never erases it); null or blank clears it; a deleted note keeps neither summary nor line. A create replay with a different line is a conflict.
  - The student (and child practice) reads the newest note's line as "Before your next lesson: {text}", in the Lessons view where the newest note already is; older notes, staff and the parent read "Before next time: {text}", the field's own approved label. The parent sees it in the "Latest saved lesson" card and in the list. N11's Today renders the same `latest.beforeNext` from the lesson snapshot when it is built.
  - Not added anywhere else: the lesson email (it selects its own columns), the MCP and the audit carry no line.
  - Wording gap (tier C): no approved parent form of "Before your next lesson"; the parent sees the field label "Before next time:" until Daniel words one.

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

Astra's chanting curriculum (`docs/planning/2026-10-24-chanting-program-review/`, read-only here) is reconciled in [CHANTING-RECONCILIATION.md](CHANTING-RECONCILIATION.md). P4 fixes F6 finding 10 by linking every lesson, with no new string, and leaves `lessons.json` alone. N17a re-orders the opening (sounds before recognition, no same/different in Torah lessons 1–3). N17's first-phrase step is a path row after unit 1, fed from one reading source (the assigned range, otherwise this week's verse). N18 shows the celebration only after "Same as the reader" and stores that answer nowhere. N19 keeps verse cards in a separate owner-only document. N19a, the worked first verse, waits on Daniel's content.

#### N17a. Opening re-order (S, Sonnet) — Astra's curriculum; CHANTING-RECONCILIATION.md §3

- intro-phrases becomes Hear it, In verses, Done, with per-half play controls cut from the same human recording. Same/different leaves torah-sof-pasuk and torah-etnachta. Review's one-family fallback stops naming untaught zakef. A new `learn-taught-first` test enforces sounds before recognition.
- **Files:** `lib/learn/lessons.json`, `course.ts`, `components/learn/lesson.tsx`, `review.tsx`, the Learn tests. No lesson is added, removed or renamed. No schema change.
- **Exit tests:** see CHANTING-RECONCILIATION.md §3. No "Same tune or different?" in lessons 1–3 over 20 seeded runs; `lessonCards`, `nextLesson` and `coursePassages` unchanged; a full v1 document opens unchanged.

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
- **Decided while building N20 (2026-10-24):**
  - "Continue with Google" on /, /sign-in and /account's sign-in is our own button on the existing redirect path (`GoogleContinue`); nothing from Google loads on those pages. The GIS popup stays only on /connect, which needs its in-page request; its popup tests moved there.
  - The return address (`src/lib/site/return-address.ts`) returns only to `/`, `/account` and `/read` (with the query URLSearchParams writes); anything else is the default landing. It travels in /sign-in's `return`, sealed in the code binding with the address, and in the SDK's stored Google state (re-checked on the way back). The email link and a failed Google return keep their fixed landings.
  - Save's way back adds a one-shot `save=1` (and `choose=` for a selection) to the reading's address; the reader opens choosing with those verses and asks for the account once, as if Save were pressed. The way back also carries the verse the reader is on ("your place").
  - /read still never asks for a session on its own: a local hint (`crc-torah:signed-in/v1`, set when the portal sees a session, cleared on sign-out or a 401) decides whether Save or "Sign in to save" shows first. It grants nothing.
  - The front door holds the signed-out sign-in's measured height while access is checked, and the app bar holds its link's height (D3's / part).
  - G20 hides the account request from any account with a student role. F3's route is an "Ask for an account" link to `/sign-in?return=/account`.

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

#### N26. MCP for members — CUT (Daniel, 2026-10-24)

- **Daniel, verbatim:** "No one but me and other staff/admin need mcp access". G24 and v1.9.1 are cut. The MCP stays staff and admin only; if any member, student or parent can connect today, closing that is a defect fix, not a feature.

~~Original scope (kept for the record):~~

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
| ~~N26~~ | cut | — |
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

**Answered (Daniel, 2026-10-24 popups): tier B is approved and ships, with these changes.**

- N11, N17, N14, N15, N16, N4/N5/N7, N8, N22, N23: "Keep all". N23's lines still wait for its adversarial privacy review before anything shows.
- N13: "Keep, with name fix". The app stores no pronouns, so lines about a child use the child's name. The tier A line becomes "Sit down with Noa and tap Practice with Noa to go through Noa's verses together." TP-03 becomes "Sit with Noa for each verse. Tap Got it only when Noa reads it without stopping."
- N18, N19, P4: "Keep, drop the tally". The run-through summary is "Practise verses 3 and 8 again." with no "Clean: 7 of 9". The help line is "Help: Colors → Marks only → Tikkun", spelled Colors as the app spells it. P4's "one more try" ships.

**Answered (Daniel, 2026-10-26 popups).**

- N21: the confirmation is "Mark Noa's ceremony done? Noa keeps the account, Learn and Study. Tutors stop seeing Noa. You can undo this." The staff list heading is "Ceremony done". The student sees nothing new.
- N22: the invitation email subject is "Central Reform Congregation invited you to CRC Torah".
- N14 Needs-you rows: "No tutor yet. Choose a tutor." · "The family's invitation expired. Send a new one." · "No reading yet. Assign the reading." · "No service date yet. Set the service." · "Honors not started. Open the honors form."
- SC5 (review note): "Count only signed-in." Finished marks come only from lessons done while signed in to that account; signed-out progress stays on the device and is never uploaded. Built as SC5a.

### Tier C: gaps (no draft anywhere; not invented here)

- **N23:** the student's full disclosure of what the tutor sees (per-day verses and mark changes, beyond the Learn line); the parent's count line.
- **N21:** the confirmation before "Ceremony done"; the staff list heading for ceremony-done students; anything the student sees after the state is set.
- **N22:** the invitation email's subject line.
- **N14:** one sentence per Needs-you condition not drafted above (no tutor, invitation expired, no reading, service not set, honors not started).
- **N7:** a heading for the insights column, if M6's existing headings don't fit.
- **N24:** a label for the packed assigned reading on /offline, if `copy.ts` has none that fits.
- **N1:** none expected (Sefaria's credit is used as served); if the UI needs a sentence to choose the alternative edition, it is a gap.
- **N19:** a home line when verse cards are due and no phrase card is (until then those cards wait for the Review screen or a Run-through); a closing line for a Run-through with no stumble (it shows only the way back); the stumble's offer to practise the verse with its neighbour (built, off).

## Exit for the whole plan

- v1.8.2, v1.9.0 and v2.0.0 tagged in order, each with tests green on Windows and in CI and a deploy Daniel can open.
- N16's re-measure passes (CLS below 0.1, INP below 200 ms, axe clean).
- Every adversarial review recorded beside its PR, with its fixes in the merged head.
- STATE.md's resume point updated at each tag.

## Open items that wait on Daniel

1. ~~The tier B string batch~~: answered 2026-10-24 (see Tier B).
2. **The tier C gaps**, drafted by Claude into the same batch once each milestone's screen exists.
3. **Taamey Frank CLM**, only if N2 finds its licence differs from Stam Ashkenaz CLM's GPL v2 with font exception, or if a subset or WOFF2 of it is wanted later.
4. **Still open from before:** the beta word; the pilot kit; licence questions for any evening or Havdalah prayer whose text is only in a licensed lane (SC7); DNS for torah.centralreform.org (waiting on others).
5. **Vercel Firewall rule for public pages (Daniel, dashboard only).** F1 (#74) found that the 429s come from the firewall rule `rule_public_reading_rate_limit_4G2hTb`: 120 requests a minute to `/api/public/*`, fixed window, keyed on IP alone, counting CDN hits too. Caching now keeps repeat answers in the browser, but a class or family behind one address still shares one budget. The fix is raising the limit or keying on IP plus another field. Claude does not change firewall settings.
