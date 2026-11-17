# Rulings in force

Daniel's binding rulings as they stand on 2026-11-17, one or two lines each, grouped by topic. Where a later ruling reversed an earlier one, only the one in force is listed, with "replaces <date>". Nothing here is new: each line points to where Daniel said it. Where the sources disagree and this page cannot tell which holds, the item is under "Unclear, ask Daniel" at the end and nowhere else.

MISSION.md is still the authority document and is not edited; this page is the index to it and to the rulings that live only in STATE and the plans. If this page and a source disagree, the source wins and this page is wrong.

Source keys:
- **M**: `docs/planning/2026-10-15-kickoff/MISSION.md` (its links into dated folders now resolve under `docs/archive/` with the same layout)
- **S**: `docs/archive/STATE-through-2026-11-16.md` (the old STATE, unchanged)
- **PR**: `docs/archive/planning/2026-10-16-review/PLAN-REVIEW.md`, section 1 (rulings 27 to 59)
- **P19**: `docs/archive/planning/2026-10-24-release-1-9/PLAN.md`, "Settled decisions"
- **P20**: `docs/planning/2026-10-24-release-2-0/PLAN.md`, "Cut" and "Settled decisions"
- **RN**: `docs/archive/superpowers/specs/2026-10-27-finding-and-keeping-readings-design.md`
- **BK**: `docs/superpowers/plans/2026-10-28-replacing-the-study-guide-booklet.md`, "Settled decisions"
- **FK**: `docs/planning/2026-10-30-second-congregation-copy/PLAN.md`, "Daniel's rulings"
- **MC**: `docs/planning/2026-10-31-music-card-details/DECIDED.md`
- **PT**: `docs/planning/2026-11-03-people-tutor/SPEC-2.md` and S "2026-11-03"
- **RV**: `docs/planning/2026-11-16-project-review/REPORT.md`, section 5
- **C**: `CLAUDE.md`

## 1. What the product is

- CRC's place to lein and learn to lein, for everyone at CRC, not only Beit Mitzvah students; also Daniel's own weekly preparation. 2026-10-22. M "Current 1.0 scope", amendment of 2026-10-22 evening.
- A study and learning companion, not a source-sheet builder: members collect nothing; only a rabbi curates. 2026-10-24. P19 "Earlier rulings".
- "The app is just for study": D'var Torah, family logistics and mitzvah projects are out of the app entirely. 2026-10-24. P20 "Cut". Replaces the D'var plans of 2026-10-16 (PR 30) and 2026-10-24 (Batch 1 Q1).
- Everything serves weekday preparation, not the bimah. 2026-10-22. M "Current 1.0 scope".
- Name per congregation (`productName`); CRC's is "CRC Torah", main address torah.centralreform.org once the cutover is done; existing addresses keep working. 2026-10-22 and 2026-10-23 (E1). M "Current 1.0 scope" and "Daniel's rulings, 2026-10-23" E1. Replaces "CRC Beit Mitzvah" (PR 27).
- The logo is Siona Benjamin's CRC floor; copies of 512 px and under may be committed. 2026-10-26. S "Return point, 2026-10-26 evening". Replaces the yad (M B5, 2026-10-23).
- Visual direction "Song session" (locked 2026-10-16) with the 1.9 visual system (six type steps, 17 px body, docked reading tools), keeping its colours and fonts. 2026-10-24. P19 decision 3; `DESIGN.md`. Replaces "Annotated score" (2026-10-15).
- Release state: beta since v2.0.0 went live: a "Beta" label in the header and `/read`, `/learn` and `/trope-chart` indexable; signed-in pages stay noindex. 2026-10-26. M "Amended 2026-10-26 (Daniel, beta)". Replaces "No alpha or beta label" (2026-10-22) and "v1.5.0 is the beta tag" (2026-10-23).
- Real-family pilot: "I'll say when". Nothing goes to families before it; beta sends nothing to families. 2026-10-23, restated 2026-10-26. M "Popup rulings" and "Amended 2026-10-26".
- Roadmap: 2.1 is Daniel's prayer recordings; 2.5 is all voice work and generated chant per trope system. 2026-10-23 and 2026-10-24. M "Amended 2026-10-23, roadmap" and "Amended 2026-10-24 (G0)" (ruling 51).

## 2. Never in the repo, texts and licences

- Never in the repo: JPS or any licensed text (the Beit Mitzvah siddur included), student or family data, recordings, rendered audio, model weights, credentials. `tests/never-in-repo.test.mjs` stays green and is never weakened. 2026-10-15, restated throughout. M ruling 24; C "Rules".
- JPS 2023 may be shown publicly (CRC's licence) and printed, each printed page carrying the edition and its credit. 2026-10-22 and 2026-10-23. M "Amended 2026-10-22 (show rather than hide)" and "Amended 2026-10-23, later" item 16.
- JPS 2023 for another congregation: "Yes, it's covered". 2026-10-23. M D-b.
- Sefaria texts: "use all, don't stress": any edition Sefaria serves may be displayed live with its edition, licence and Sefaria credit. Covers Sefaria only; never-in-repo unchanged. 2026-10-22. M "Current 1.0 scope".
- Rashi English: Metsudah 2009 is the default, Rosenbaum-Silbermann the alternative; no special licence needed ("Sefaria feeds it"). 2026-10-24. P19 decision 9 and its update.
- No note is sent to Sefaria; an identifying User-Agent and the CC BY credit on More on this verse still apply. 2026-10-23. M E3.
- Binder/Avery melody tables: noncommercial permission, allowed in this public repo; other congregations may use them non-commercially without asking. 2026-10-15 and 2026-10-30. M "The engine move"; FK 9.
- The CRC Beit Mitzvah siddur text may be shown in the evening and Havdalah course, CRC only, to anyone on the CRC site; offline only for signed-in CRC people; never in any repo or served to another tenant. 2026-10-25. M "Amended 2026-10-25". Replaces, for CRC, the 2.0 rule that it is never shown (2026-10-24).
- Other course prayer text comes from CRC's own texts in the shireishabbat and shirei-tfilah repos, public lane only; a text found only in a licensed lane goes back to Daniel. 2026-10-24. P20 "New rulings"; M "Amended 2026-10-24 (G0)".
- Honoree links may show the before and after Torah blessings from CRC's Beit Mitzvah booklet, with its English and credits, for the recipient's own aliyah only. 2026-10-18. M "Amended 2026-10-18 (explicit honoree material permission)".
- Fonts: the tikkun uses Stam Ashkenaz CLM (2026-10-21); the reading text uses Taamey Frank CLM (2026-10-24), both GPL with the font exception. S "Current return point, 2026-10-21 study guides"; P19 decision 10.
- The reference timing catalog is published openly as a GitHub Release file under CC BY-SA with the PocketTorah credit, not in the tracked tree. 2026-10-30. FK 10.
- The haftarah, shirei-shabbat and shirei-tfilah repos are read only from here. M "Boundaries" and "Amended 2026-10-25"; C "Git".

## 3. Audio and the chant gate (G1 to G3)

- G3: no student hears generated chant until Daniel passes the listening review: at least 95% of review verses on melody and zero "would teach wrong", after G1 (notes within ±50 cents) and G2 (technical checks). No code path serves an unreleased render. 2026-10-15. M ruling 17; C "G3 gate".
- G3 covers generated chant only. Human recordings play for everyone, signed-out visitors included, with no listening review; bad cuts are fixed as found. 2026-10-22. M "Amended 2026-10-22 (show rather than hide)".
- The portal plays PocketTorah only. Cantor Finkel's recordings are not played; his licensed, unrestricted package is the source material for the voice work. 2026-10-22. M "Amended 2026-10-22, later". Replaces the Finkel playback of 2026-10-22 earlier.
- The 168 Finkel objects stay in the private Blob store; no deletion without Daniel. 2026-10-22. S "Current return point, 2026-10-21 night" (rulings 10 and the Finkel cut).
- Once G3 passes, generated chant fills verses with no human recording (human recordings first) and plays for everyone, signed-out visitors included. 2026-10-22. M "Amended 2026-10-22"; S 1.5 rulings (5).
- Generated chant per trope system, each after its own blind review, with a recording by Daniel or a song leader as fallback; four ranges (bass, tenor, alto, soprano). 2026-10-23 and 2026-10-16. M D-5; PR 58.
- All voice work happens in 2.5. 2026-10-23. M "Amended 2026-10-23, roadmap".
- Sung practice uses Adonai/Elohim. 2026-10-16. M "Trope and audio".
- 2.0 has no melody link and no prayer audio; Daniel records the prayers in 2.1. 2026-10-24. M "Amended 2026-10-24 (G0)". Replaces ruling 51 (prayer audio links to CRC Music).
- The 18 special and festival haftarot with no recording stay text-only; no upload feature. 2026-10-22. M "Amended 2026-10-22".
- Student recordings are dropped ("I don't think this is really a useful thing for us"); the code was removed on 2026-11-16 and the table stays. 2026-10-22 and 2026-11-16. S "Daniel, 2026-10-22 (1.5 planning)"; RV S2. "Hear yourself": revisit with 2.5 (P19 decision 6).
- Learn's tap exercises: a tap answers while the question is open and plays nothing; once answered, any word opens its word card. 2026-10-23. M "Popup rulings".
- Tapping a word in the main reading plays its whole verse with word highlighting (Lein). 2026-10-18. M "Amended 2026-10-18 (verse-first playback)".

## 4. Privacy and what each role sees

- Show rather than hide: texts, human recordings and study tools are open, including to signed-out visitors; when a choice is between showing and hiding a text, recording or tool, show it. People data stays private. 2026-10-22. M "Amended 2026-10-22"; C "Show rather than hide".
- Anything about a student, family, tutor note, assignment or date is visible only to that family and staff. 2026-10-22. M "Amended 2026-10-22".
- Accounts are open to anyone; anyone who signs in gets their own shelf of readings with no approval and no age gate, children under 13 included. 2026-10-27. RN decisions 5 to 8; S "Return point, 2026-10-27". Replaces "I'll approve requests" (2026-10-22) for the shelf; see "Unclear".
- Readings are not private content: any tutor may see every signed-in learner's readings and claim them as a student. 2026-10-27. RN decisions 15 and 16.
- A member's own notes and drafts are private to that member, staff included; My notes and My translation left the reader, stored rows reachable only by their owner. 2026-10-22 and 2026-10-23. M "Current 1.0 scope" and "Friday preparation direction".
- Owner-authorized Claude access reaches only a person's own saved readings; staff never reach another person's work. 2026-10-23. M "Friday preparation direction".
- Practice: the assigned tutor sees which verses were practised each day and which marks changed, plus Learn's "Can hear" line and most-confused pair; parents see counts only; the student is told what the tutor sees; no durations or scores; nothing across students. 2026-10-24. P19 decision 7. Widens ruling 45 (PR 45).
- Service course: tutors, rabbis and admins see a per-part finished mark; parents do not. 2026-10-24. M "Amended 2026-10-24 (G0)".
- No streaks, no daily goal, no score; no leaderboards. Upheld 2026-10-24. P19 "Earlier rulings". Replaces the "quiet calendar or streak" of PR 45 (2026-10-16).
- Practice history: detailed activity for 90 days, then only dates practised until one year after the ceremony. 2026-10-16. M ruling 14 note. (Not enforced by any running job today: RV S8.)
- Approvers see a requester's verified email; admins see verified emails on People. 2026-10-23 and 2026-11-03. S "Daniel at the v1.4.0 check-in"; PT.
- A person may be both tutor and student; admins can Make tutor and Remove tutor; the page is "People". 2026-11-03. PT.
- Ceremony done: the student keeps sign-in, Learn and Study, and leaves the active roster; Disable stays for mistakes. 2026-10-24. P19 decision 13.
- Disabled students are hidden from the Students list ("Disable and hide it"); no true delete. 2026-10-26. S "GATE (2026-10-26, evening)".
- Music card: active students' names, citations and rehearsal dates may be sent to the music setlist's Beit Mitzvah card ("names can be in there"). 2026-10-31. MC.
- Google's one-time code and state may appear in Vercel request logs for the Google callback only, and only while Daniel is the sole Vercel team member. 2026-10-21. M "Authority", Google callback log exception.
- Notifications stay parked. Only sign-in mail, invitations, the account-request email to approvers and the approval email to the member are sent. 2026-10-22 and 2026-11-16. M "Amended 2026-10-22"; S "1.5 rulings" (1); RV S6.

## 5. Study, guides and Claude-written text

- Every portion and haftarah has a base guide; students see the overview only. Themes and verse notes are the rabbi's to write per student. 2026-10-28. BK 1 to 9; S "RULING (Daniel 2026-10-28)".
- A Claude-written guide is visible at once, labelled "Written by Claude for CRC · not yet reviewed by {rabbi}"; review changes the label, not visibility; an unattended routine never replaces reviewed work. 2026-10-21. M ruling 11 (S13, S25).
- "From Rabbi Daniel" is only for sources he adds himself. 2026-10-30. S "GATE (2026-10-30)".
- Portion summaries: Claude drafts, nothing shows until Daniel approves; credit "Rabbi Daniel Bogard" once approved. 2026-10-24. P19 decision 4.
- Curated insights column: sources only, curated by a rabbi; no "Think about it" questions. 2026-10-24. P19 decision 5.
- Service-course teachings: Claude drafts in Daniel's voice, he approves each; humanistic, leaving room for more theistic people; approved ones carry "Rabbi Daniel Bogard" alone and may live in the public repo. 2026-10-24. M "Amended 2026-10-24 (G0)".
- Course glosses: Claude drafts and they go live. Learn lesson text: Claude writes it, live at once, editable later. 2026-10-24 and 2026-10-22. P20 "Settled decisions"; S "1.5 rulings" (7).
- No talk-it-over questions; no licensing of Plaut or Fields. 2026-10-28. BK 3, 4.
- Booklet: per-student print route; the student's own verses in full, the rest summarised; trope colour by default; blessings, service parts, ceremony facts and a no-vowels practice page; new students first. 2026-10-28. BK 10 to 15.
- Study view: plain uncoloured Hebrew with the notes rail (Study v6 approved); chanting stays in Lein and Learn. 2026-10-28. S "Return point, 2026-10-28 evening" (#155, #157).
- Default commentaries: Rashi and The Torah: A Women's Commentary. 2026-10-22. M "Current 1.0 scope".
- No translation picker; the main text is JPS 2023. 2026-10-21. M ruling 12 amendment.
- No visible transliteration; syllables and stress in Hebrew letters instead. Exception: the service course offers transliteration on request. 2026-10-16 and 2026-10-24. M ruling 13 (PR 38); P20 "Settled decisions".
- Every page carries "A project of Rabbi Daniel Bogard", linking danielbogard.com (on CRC; a fork chooses). 2026-10-21 and 2026-10-30. S "Current return point, 2026-10-21 study guides"; FK 7.

## 6. Readings and the calendar

- CRC's weekly reading is the standard Hebcal reading; CRC observes two-day holidays. 2026-10-22 and 2026-10-24. M "Current 1.0 scope"; P19 decision 15.
- Morning service 10:00; Havdalah service 4:00 reads the following Shabbat's parashah; an unknown slot must be resolved, never assumed. 2026-10-16. M ruling 5 (PR 34).
- Readings are custom by default with the whole parashah shown; typical lengths are guidance, not caps. 2026-10-16. M ruling 5 (PR 35).
- Lein and Study page by aliyah with a picker. 2026-10-24. P19 decision 2.
- Navigation: one site bar; My Readings is home for every non-admin role; the admin alone keeps a tab bar; the week arrows are retired. 2026-10-27. RN decisions 17 to 25; S "Daniel, 2026-10-27, evening". Replaces the tab bar for every role (P19 decision 1).
- Offline: 14 days; install and offline work on both domains; a student's assigned reading and a member's three nearest saved readings go offline. 2026-10-22 to 2026-10-24. S "Daniel, 2026-10-22 (1.5 planning)" and "2026-10-23 late"; P19 decision 14.
- Analytics: aggregate, cookieless page counts on public pages only. 2026-10-23. M "Popup rulings" and item 9.

## 7. Roster, intake and Claude connections

- Maven is read only, reached through Cowork with Daniel's connector; the portal stores no Maven credential and never writes to Salesforce; quiet imports send nothing. 2026-10-16 and 2026-10-21. M ruling 4 (PR 41); S "Daniel, 2026-10-21 night" (4).
- The roster Sheet is written by a free Google service account. 2026-10-21. S "Daniel, 2026-10-21 night" (5).
- Admins can set students up through Claude ("It should be possible for me to do all of those pieces with the MCP"), with roster writes under a separate portal:roster consent. 2026-10-21 and 2026-10-26. S "Daniel, 2026-10-21 late" (8) and "GATE (2026-10-26, evening)".
- Invitations last 7 days; the email names the congregation, role and expiry, never the child; staff get "Copy link". 2026-10-24. P19 decision 12.
- Relax the 15-minute fresh sign-in rule for tutor assignment and invitations, with an adversarial review. Approved, not built. 2026-11-16. RV section 5 (A2).
- Google sign-in loads Google's code only when chosen. 2026-10-24. P19 decision 8.

## 8. Money

- Claude may approve hosting cost while total portal spend stays under $10 a month, logging each item in STATE; anything past $10 a month goes to Daniel. 2026-10-22, restated 2026-10-26. M "Amended 2026-10-22"; C "Stop and ask".
- Hosting cap: under $25 a month ideal, $50 acceptable. 2026-10-15. M ruling 22.
- Private Blob store approved in iad1, Production only, OIDC; planning target $5 to $8 a month, review a forecast above $10. 2026-10-17. M "Private media spending approved".
- Each congregation that runs its own copy owns and pays for its accounts. 2026-10-30. FK 2.

## 9. Other congregations

- Another congregation runs its own copy (its own fork, Vercel, Neon and accounts), rebranded by settings; CRC's identity and Siona Benjamin's art appear only on CRC's origins. 2026-10-30. FK 1, 13 and "Decided here".
- Actually provisioning a second tenant on CRC's deployment is Daniel's gate. 2026-10-16, restated 2026-10-23. M ruling 21 and D11; C "Stop and ask".
- Reviewed guides and summaries may be exported to another congregation, credited, arriving held. 2026-10-30. FK 11.

## 10. Wording and tone

- House voice: the child's name and never pronouns; no exclamation points, pep talk or emoji; plain verbs. "It can't be cheesy or cringe." 2026-10-16 and 2026-10-26. C "Small wording"; `DESIGN.md`.
- Labels, empty states, status lines, chips, errors and email details are the lead's call, logged in the plan's "Decided here". Ask Daniel only for a new promise to families, anything about privacy or what others can see, or a MISSION-level rule. 2026-10-26. C "Small wording".
- An account string that names what an account keeps ships only once each named thing really is kept. 2026-10-23. M "Friday preparation direction".

## 11. Process and authority

- Claude Code owns the whole product: integration, migrations, deploys and reviews. 2026-10-21. S "Current return point, 2026-10-21 handoff". Replaces Astra and Sol (2026-10-16) and Codex (2026-10-17).
- Deploy and version at will; version numbers are Claude's. Shabbat and yom tov put no limit on deploys. A deploy that breaks the live site is rolled back at once, fixed forward and reported. 2026-10-17 and 2026-10-23. M "Authority" and "Amended 2026-10-23, later" items 5 and 6.
- Stop and ask Daniel only for: money past $10 a month, licences, a second tenant, the beta label, irreversible production data changes, and messages to real people. Everything else: decide consistently with these rulings and log it. 2026-10-26. C "Rulings follow from his decisions". See "Unclear" on student-visible changes.
- Adversarial review by a second agent only for auth, tenant and cross-family isolation, never-in-repo and the chant gate. 2026-10-26. C "Proportion".
- Bundle work by area; one fix round per PR; no timed check-ins. 2026-10-26. C "Fewer round trips"; S "Way of working".
- CI runs once per pull request; tests that add nothing are not run. 2026-10-26. S "GATE: CI now runs once per pull request".
- Never force-push main or rewrite pushed history (one approved exception, 2026-10-21). C "Git"; S "Current return point, 2026-10-21 night".
- The engine (`trope/`) stays dependency-free Node with its vendored, licensed copies; the app never imports a Python side. 2026-10-15. M "Boundaries"; C "Engine".

## 12. Decisions of 2026-11-16 (project review)

From RV section 5, verbatim in substance:
- Remove: the old migration operators, student recordings and the build probes (the table stays), the voice experiments in `trope/`, the Finkel review page. Done on 2026-11-16.
- Notifications: leave parked.
- Service course: link it for students. Student-visible, so Daniel sees it before it ships.
- Fresh sign-in rule: relax for tutor assignment and invitations (section 7).
- Propose in detail: useful error logs (C1), open audio served openly (C6), fewer confirm steps and replay receipts (C6). Scope only: second-congregation plumbing (C6).
- Answered "Na" and treated as unanswered: the oversight views, and whether "My translation", the CSV roster import, the roster Sheet and tests on Windows are still in use.
- Still open: how a child without their own email signs in (G9).

## Unclear, ask Daniel

1. **Student-visible changes before they ship.** C "Stop and ask" and M "Authority" (2026-10-15) say anything student-visible goes to Daniel first, and RV section 5 (2026-11-16) applies that to the service-course link. M "Authority" (2026-10-17, "Deploy at will"; supersedes separate approval before each student-visible release) and C "Rulings follow from his decisions" (2026-10-26, a shorter stop-and-ask list without it) say it does not.
2. **"practise" or "practice" as the verb in visible copy.** C "Small wording" (2026-10-26) and `docs/planning/AGENT-BRIEF.md` say "practise". S "Return point, 2026-10-28 overnight" records the lead's decision under Daniel's "use your judgement" (2026-10-27) to use American "practice/practiced/practicing" in visible copy.
3. **Who else tests.** M "Outcome" (2026-10-15) and M "Authority" (2026-10-17): Daniel is the only human tester until feature completeness. Since 2026-10-26 the site is in public beta with open accounts (M "Amended 2026-10-26"; RN). Only the family pilot is clearly still held ("I'll say when").
4. **Account approval.** M E1/F1 and "Current 1.0 scope" (2026-10-22, 2026-10-23): approvers approve requests, declining only spam. RN decisions 5 to 8 (2026-10-27): anyone who signs in gets a shelf with no approval. Whether approval still gates anything is not stated.
5. **Several congregations on one deployment.** M D11 and D-a (2026-10-23): "One deployment" serving several congregations at 2.5. FK 1 (2026-10-30): the first other congregation runs a separate copy, "not a second tenant on CRC's site". RV section 5 (2026-11-16) asks only to scope the tenant plumbing.
6. **Windows.** C "Done" and M "Proof" (2026-10-15): green on Windows. RV section 5 (2026-11-16): "tests on Windows" came back "Na".
7. **Practice-history retention.** M ruling 14 note (2026-10-16) is binding, but RV S8 (2026-11-16) found the retention job is never run. Whether to wire it or change the ruling is open.

## Decided 2026-11-17 (Daniel, in session; resolves "Unclear" items 1, 2 and 6)

- No fixed launch date; no one is using the site now. Simplify the code now, alongside visible work, and move students, tutors and admin forward evenly.
- Student-visible changes ship when CI is green and Daniel is told afterwards with a short list; he can ask for a revert. Replaces "anything student-visible before it ships". Resolves Unclear 1.
- American spelling: "practice" for verb and noun. Replaces "practise". Resolves Unclear 2.
- Windows is dropped from CI: all coding goes through Claude and production is Linux. Resolves Unclear 6.
- Land on `main` directly after a green CI run; a pull request only when Daniel asks.
- Commits are authored as Claude. Replaces the RavBogard identity rule.
- The cleaned-up CLAUDE.md is adopted.
- Oversight stays as it is: no cross-student list of days practised, no Claude status tool, no tutor's private line, no dated timeline. The assigned tutor watches practice.
- Remove students' "My translation". Existing rows stay in the database.
- Remove the CSV roster upload and the roster Google Sheet. Maven through Claude and the Add student form remain.
- Build a web page for guides: see, hold, release and withdraw study guides, discussions and portion summaries.
- Not wanted now: weekly verse assignment, bulk family invitations, a dated timeline per student.
- Notifications stay parked (2026-11-16).
- Relax the fresh sign-in rule for assigning a tutor and for invitations, on the web and through Claude (2026-11-16).
- Later on 2026-11-17: release and hold of study guides on the web Guides page is wanted, with the production migration it needs (Daniel applies it). Parent invitations stay fully relaxed (Daniel: "whatever"; the lead's reasoning: the guarded case needs a stolen admin session, which already exposes every family's records). The read-only "Yours" translation row on saved readings is removed.
