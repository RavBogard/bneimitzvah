# 09. Competitors: what other b'nei mitzvah and trope products do that this portal does not

16 November 2026. Web research plus a short read of the repository. Read-only on the repo.

Privacy: no search query or URL carried anything about this project, the congregation or a person. Searches named only products and topics.

## How to read this

- **Verified (primary)** means I read the vendor's own page, help article or App Store listing in this session.
- **Secondary** means a press article or a search summary only.
- **Not verified** means I found nothing usable; no features are claimed.
- Earlier research already covers PocketTorah, the original TropeTrainer, TropeTrainer web, Tikun Korim, Trope Tools, Sefaria and the Stiebel patent as *learning* tools (`docs/superpowers/research/2026-10-22-learn-to-lein/REPORT.md`, section A3, lines 178 to 186). I did not repeat it. This report adds the programme-management products and the tutor workflow, which that research did not look at.
- Portal facts come from `PRODUCT.md`, the route list under `src/app`, `src/server/notifications/`, `src/components/portal/workspace/` and STATE.md. Where I did not open the code, the cell says so.

## 1. Main findings

1. **The field splits in two, and this portal sits almost wholly on one side.** One group is practice tools (TropeTrainer, PocketTorah, iTorah.life, Tikun Korim, Kol Torah, Virtual Tikkun). The other is programme managers (Mitzvah Tools, MitzvahManager, Aliyah). The portal is stronger than every practice tool on text, study and teaching. It is thinner than every programme manager on the one thing they all sell: a dated timeline of what each family owes and when.
2. **The largest gap is a milestone timeline.** All three programme managers compute or hold due dates per student from the ceremony date. The portal has a ceremony date, a slot and rehearsal dates, and no checklist. I found no milestone or checklist code (`grep -i 'checklist\|milestone' src/server src/components` returned only `src/components/ui/index.ts`).
3. **The second gap is the recording loop.** A student records, the tutor listens and replies. Six comparators have some form of it. Daniel dropped student recordings on 2026-10-22 ("I don't think this is really a useful thing for us", STATE.md line 261). The field treats it as the standard between-lessons loop, so it is worth one more conversation, not a build.
4. **The third gap is small and cheap: a structured weekly assignment.** MitzvahManager assigns verse by verse. The portal has a free-text "Before your next lesson" line in the lesson note (`src/components/portal/workspace/lessons/panel.tsx` line 33).
5. **Most of the rest is not worth having** for one congregation with a few dozen students: lesson scheduling, attendance, in-app messaging, synthesized voices in dozens of traditions, AI scoring of chant.
6. **A price benchmark.** MitzvahManager for 30 students is about $1,380 a year (30 at $46) and includes TropeTrainer seats. Tutor.iTorah.life's organisation plan is $320 a year for up to 20 students and tutors at a time. That is what the bought alternative costs, and it would not give the study side this portal has.

## 2. Products

### 2.1 Programme managers

**Mitzvah Tools (Shulware, the ShulCloud company).** Verified (primary).
- What: cloud b'nai mitzvah programme manager, first built about 2003 by a congregational rabbi, 2.0 in 2016, now a Shulware product.
- Admin ("Program Manager"): sees all students; other staff see only their team's students. Imports students from ShulCloud by date range, or manually. A synagogue task library; tasks are assigned per student with due dates, completion status, comments and attached resources. Resource library sorted as Torah, Haftarah, Prayer, Other. Reads every team message. Program settings include locations, custom aliyot, service details and a student progress report. Marketing page also lists milestone tracking, honors assignment, calendar sync and a one-click "Matbeah set-list".
- Tutor ("educator"): dashboard of assigned students, tasks waiting on them, appointments, team messages, internal staff notes, resources.
- Student and family: dashboard of assignments and milestones, practice audio, messages to the team. Students can add files to a task and submit. Parent gives COPPA consent before the child's account is activated.
- Scheduling: only through a paid Calendly subscription; no native booking.
- Not stated: whether a student records in the app; automated reminders to families; price (demo only).
- Sources: https://shulware.com/mitzvahtools ; https://shulware.zendesk.com/hc/en-us/articles/36406459252109 (Program Manager Dashboard) ; https://shulware.zendesk.com/hc/en-us/articles/36572575317901 (Setting Up a Student) ; https://shulware.zendesk.com/hc/en-us/articles/36653307898893 (Resources & Tasks) ; https://shulware.zendesk.com/hc/en-us/articles/36619287782925 (Appointments, Team Messages & Staff Notes) ; https://shulware.zendesk.com/hc/en-us/articles/36942263990157-Mitzvah-Tools-Teacher-Resource ; https://shulware.zendesk.com/hc/en-us/articles/36219775397005 (ShulCloud API).

**MitzvahManager (HazzanSolutions, the TropeTrainer company).** Verified (primary, vendor page only).
- What: b'nai mitzvah programme manager bundled with TropeTrainer for student practice.
- Admin: programme overview dashboard; Admin, Tutor and Staff roles; organisation-wide roster, calendar and assignments; centralised family messaging and reminders; milestone tracking with a pace status.
- Tutor: own roster with search; recurring lesson series; verse-by-verse assignments and per-portion progress; lesson outcomes (attended, missed, cancelled); "needs attention" alerts; lesson history; service-date countdowns and auto-calculated milestone dates.
- Student: practises in TropeTrainer (chanted audio with tempo and voice controls); "verse unlocks" release content as the student progresses; lesson and assignment reminders.
- Parent: one message thread with tutors and staff; automatic appointment and assignment reminders; sees only their own child.
- Also: service planning (readings, aliyot, honor and ceremony roles); Google Calendar and Outlook sync; syncs with iLeyn.
- Price: per student per year, $48 (1 to 19), $46 (20 to 39), $44 (40 to 69), down to $40. TropeTrainer included.
- Sources: https://mitzvahmanager.com/ ; https://hazzansolutions.com/

**Aliyah (getaliyah).** Verified that the landing page says this; **not verified that the product is in general use** (a single landing page on a pages.dev host, a 30-day pilot offer).
- Tutor: portions broken into checkable milestones; automated portion assignment by date; time-stamped voice notes on a student's recording; Hebrew calendar reconciled with Google or Outlook.
- Student: records specific verses in a "practice loop".
- Parent: read-only dashboard with In Progress, Mastered, Needs Attention.
- Admin (institutional tier): multi-admin permissions, director-level reporting.
- Price: $29 a month (up to 5 students), $49 a month (unlimited), institutional $49 a month plus $12 per student per year.
- Source: https://aliyah.pages.dev/

**iLeyn (HazzanSolutions).** Verified (primary). Not a b'nai mitzvah tool; a service scheduler.
- Schedules Torah, haftarah and megillah readers, service leaders and gabbaim; members claim readings; assignment history; printed bima sheet; built-in messaging; opens a reader's portion in TropeTrainer.
- Price: first year free, then $280 a year per organisation.
- Source: https://ileyn.com/

**Torah Readers (torahreaders.net).** Secondary (articles written by its maker).
- Synagogue platform to schedule, assign and track Torah readings; said to cost $480 a year per synagogue. Its tikkun also runs iTorah.life and the tutor product below.
- Source: https://blogs.timesofisrael.com/bringing-torah-reading-to-life-in-the-digital-age/ ; https://jewishjournal.com/community/384880/bringing-the-torah-to-life-in-the-digital-age/

**ShulCloud itself.** Partly verified. A Bar/Bat Mitzvah date field sits on a person's Lifecycles tab, and that date feeds Mitzvah Tools. I found no ShulCloud module that tracks milestones; that job is Mitzvah Tools. Source: https://shulware.zendesk.com/hc/en-us/articles/36219775397005

**Chaverware / ChaverWeb.** Not verified. Listings mention Hebrew-date handling and event registration; no b'nai mitzvah tracking module was found.

### 2.2 Practice tools with a tutor side

**Torah Readers Tutor (tutor.itorah.life).** Verified (primary).
- Student: step-by-step course for Torah, haftarah and blessings; expert recordings for each trope; records in the app and compares side by side with the original; follow-along tikkun; bookmarks; full, triennial and weekday readings.
- Tutor and organisation: tracks each student's progress; student reports and transcripts; tutors upload their own recordings, and a prayer library on the organisation plan.
- Reminders: said to exist in the maker's article (secondary); not on the product page.
- Price: individual $15 a month or $110 a year; organisation $45 a month or $320 a year, up to 20 students and tutors at a time, up to 15 tutors.
- Source: https://tutor.itorah.life/

**iTorah.life.** Verified (primary). Free digital tikkun with registration: both sides cross-highlighted, colour-coded trope patterns, vowel highlighting, custom colours and fonts, recordings for every Torah and haftarah reading, full, triennial and weekday schedules. Source: https://itorah.life/

**TropeTrainer web (HazzanSolutions).** Verified (primary); also in the earlier research.
- Student: any Torah, haftarah, megillah or holiday reading in "79+ voicing systems" and 12 voice styles (synthesized); playback by aliyah, verse, trope phrase or word at 0.25x to 2x with word highlighting; views with vowels and trope, scroll script, tikkun, Hebrew only; translation, transliteration and sheet music; custom trope colours; records in the browser and downloads the file; print and PDF; guided "Trope Tutor" lessons.
- Tutor: assigns readings; prints custom study sheets. No in-app feedback on recordings (the student downloads and sends the file).
- Price: $13 a month or $130 a year per person; organisation seats up to 35% off.
- Source: https://tropetrainer.com/

**Sof Pasuk (iPhone and iPad).** Verified (App Store listing). A tutor or coordinator sends assignments and recordings; the student hears model audio from Sefaria and PocketTorah and submits a recording for approval. Schedule from Hebcal, tikkun image from ScrollScraper. $0.99 once. Too few ratings to show. Source: https://apps.apple.com/us/app/sof-pasuk/id6771927704

**Tikun Korim (RustyBrick).** Verified (App Store listing). Tikkun in two columns, trope chart with audio, playback at 0.5x to 2x, records and e-mails the recording to a teacher. $19.99, and parashah audio is sold separately at about $4.99 each. 4.2 from 12 ratings. Source: https://apps.apple.com/app/id425161338

**Kol Torah (koltorah.app).** Verified (vendor page) for the claims; the quality of the feedback is not verified. Verse-by-verse practice, records the student, "AI" feedback on pronunciation and cantillation, comparison with rabbis' recordings, parents track progress, four reading traditions. No tutor tools described. Price not stated. Sources: https://www.koltorah.app/ ; https://jewishlink.news/from-a-small-idea-at-home-to-an-ai-torah-learning-platform/

**Virtual Tikkun.** Secondary (one news article). Practice from photographs of the congregation's own scroll; audio of tutors and students chanting portions; colour-coded trope; flash cards. First version June 2025. Price not stated. Source: https://jweekly.com/2026/02/10/from-scroll-to-screen-a-new-digital-tool-seeks-to-aid-torah-chanters/

**Kol Kore (Masorti movement).** Verified (primary). Free site: portion finder from a birth date, 177 recordings by 34 women readers, guides for students and teachers. No accounts or tracking described. Source: https://kol-kore.org/en/

### 2.3 Free reference tools

- **PocketTorah.** In the earlier research; this portal already serves its recordings (7,028 clips, CC BY-SA 3.0, STATE.md line 7). Source: https://apps.apple.com/us/app/pockettorah/id515833985
- **Hebcal.** Verified. Parashah pages open Sefaria's embedded PocketTorah player on desktop and tablet only; not on phones. Source: https://www.hebcal.com/home/498/torah-trope-chanting-audio-leyning
- **Navigating the Bible II (World ORT).** Gone. Hebcal reports the site stopped working in July or August 2022 after more than 20 years. Same source.
- **Sefaria.** In the earlier research: toggles vowels and cantillation, embeds PocketTorah audio, teaches no trope. Not re-fetched.
- **tikkun.io.** Verified. Open-source (MIT) web tikkun built on the Sefaria API; 521 commits, 79 stars. A reader only; no accounts. Source: https://github.com/akivajgordon/tikkun.io
- **Original Trope Trainer (Kinnor Software).** Defunct; see the earlier research.

### 2.4 Generic music-practice apps (the closest analogue for tutor workflow)

- **Tonara.** Shut down on 8 December 2023 (secondary: Wikipedia and teacher blogs). It was the model: assignments with audio and notes, student recordings, live practice time. Source: https://en.wikipedia.org/wiki/Tonara_(company)
- **Practito.** Verified (vendor page). Assignments with deadlines; e-mail and text reminders; student records in the browser and submits; teacher replies with time-stamped comments and revision requests; practice analytics. Price not on the page. Source: https://practito.com/features
- **Practice Space, Vivid Practice.** Secondary. Assignments with audio, video and PDF; student recording; practice goals; Practice Space adds points, gems and badges. Source: https://colourfulkeys.ie/piano-practice-apps/

### 2.5 Synagogue-built sites

- One large congregation runs a public resource site with recordings and text for services, trope lessons, Torah and haftarah readings, FAQs and forms; each family has a mentor. Static content, no tracking. Source: https://cybermitzvah.sinaitemple.org/
- Another publishes a personalised web page per student (seen in search results only; not opened, because the pages name children).
- I found no open-source b'nai mitzvah *portal* (accounts, roles, tracking). tikkun.io is the only open-source project of note, and it is a reader.

### 2.6 Looked for and not found

Behrman House, ShalomLearning, JLearnHub and JTeach tools specific to b'nai mitzvah preparation; "Scroll Scholar" and "iTikkun"; a "Ready Set B'nai Mitzvah" tracker (not searched by name). No features are claimed for any of them.

## 3. Feature matrix

Y = has it. P = partly. N = does not. ? = the vendor's pages do not say. Columns: **Portal**; **MT** = Mitzvah Tools; **MM** = MitzvahManager with TropeTrainer; **TRT** = Torah Readers Tutor with iTorah.life; **AL** = Aliyah (landing page only); **Free** = PocketTorah, Sefaria and Hebcal together.

### Student

| Capability | Portal | MT | MM | TRT | AL | Free |
|---|---|---|---|---|---|---|
| Opens on the assigned portion | Y | Y (portion from date) | Y | P (bookmarks) | Y | N |
| Verse-by-verse audio by a human | Y (PocketTorah and a cantor's takes, word and verse) | P (uploaded resources) | N (synthesized) | Y | ? | Y |
| Slowed playback and looping | Y (not re-tested here) | ? | Y (0.25x to 2x) | ? | ? | N |
| Trope-coloured text | Y | N | Y | Y | ? | N |
| Tikkun, with and without vowels | Y | N | Y | Y | ? | Y |
| Records own chanting | N (dropped 2026-10-22) | P (file upload to a task) | Y (download only) | Y, with side-by-side compare | Y | N |
| Tutor feedback on a recording | N | P (comments on a task) | N | ? | Y (time-stamped voice notes) | N |
| Practice reminders | Y (weekly e-mail, `src/server/notifications`) | ? | Y | ? (secondary: yes) | ? | N |
| Progress view | Y (verse status, practice calendar) | Y (tasks) | Y | Y | Y | N |
| Blessings and service parts | Y (service course, 2 routes) | Y (prayer resources) | Y | Y | ? | N |
| Course that teaches trope itself | Y (24 lessons, spaced review) | N | Y (Trope Tutor) | Y | N | N |
| Commentary and study guide on the portion | Y | N | N | N | N | P (Sefaria) |
| D'var Torah drafting help | N (planned for 2.0) | P (as a task) | ? | N | N | N |
| Print | Y (sheets and a per-student booklet) | ? | Y | ? | ? | N |
| Offline | P (`/offline`, 14-day window) | N | N | N | N | Y (PocketTorah app) |

### Tutor

| Capability | Portal | MT | MM | TRT | AL | Free |
|---|---|---|---|---|---|---|
| Student list with last practice | Y | P (tasks, not practice) | Y | Y | Y | N |
| Sets what to practise this week | P (free-text "Before next time") | Y (tasks with due dates) | Y (verse-by-verse) | ? | Y (milestones) | N |
| Text notes to the student | Y (verse notes, lesson notes) | Y | Y (thread) | ? | ? | N |
| Audio feedback | N | N | N | ? | Y | N |
| Lesson notes | Y | Y (staff notes, internal) | Y (lesson history, outcomes) | ? | ? | N |
| Scheduling and attendance | N (ruled out) | P (paid Calendly) | Y (recurring series) | N | P (calendar sync) | N |
| Uploads own model recordings | P (admin reference review; not per tutor) | Y | N | Y | ? | N |

### Admin

| Capability | Portal | MT | MM | TRT | AL | Free |
|---|---|---|---|---|---|---|
| Cohort view by ceremony date | Y (roster, "Needs you") | Y | Y | P | P | N |
| Milestone checklist with due dates | **N** | Y | Y (auto-calculated, pace status) | N | Y | N |
| Family messages and automated reminders | P (weekly digest, invitations; no thread) | P (thread; reminders not stated) | Y | ? | ? | N |
| Date and slot assignment | P (records them; no choosing workflow) | P (records date, time, location) | ? | N | N | N |
| Tutor assignment | Y | Y | Y | Y | Y | N |
| Tutor hours or pay | N (ruled out) | N | P (attendance only) | N | N | N |
| Honors collection | Y (parent-written, no-login honoree links) | Y (clergy assign) | Y (service planning) | N | N | N |
| Resource library (handbook, forms) | N | Y | ? | P (prayer library) | N | N |
| Mitzvah project tracking | N | P (as a task) | P (as a milestone) | N | N | N |
| Calendar integration | N (a roster Google Sheet instead) | P | Y (Google, Outlook) | N | Y | N |
| Roster import from the membership system | Y (Maven, CSV) | Y (ShulCloud) | ? | N | P (spreadsheet) | N |
| Reports | P (roster Sheet, Claude connector) | Y (progress report) | P | Y (transcripts) | Y | N |

## 4. What the others have that this portal lacks, ranked

| # | Gap | Who has it | Worth having here? | Rough size |
|---|---|---|---|---|
| 1 | **Milestone timeline per student**, dated back from the ceremony (first tutor meeting, d'var draft, rehearsal, honors due, mitzvah project) with an on-pace flag | MT, MM, AL | **Yes.** It is what every programme product sells and what an admin of a few dozen students asks weekly. One congregation template of 8 to 12 offsets, a tick per student, and a line in "Needs you" and in the parent digest. It also covers mitzvah project and d'var tracking without a feature for each. | Medium |
| 2 | **Verse-level weekly assignment** ("verses 4 to 6 by Thursday") shown on the student's first screen | MM, MT, AL | **Yes, small.** A verse range and an optional date added to the existing lesson note. | Small |
| 3 | **Student recording with tutor reply** | TRT, AL, Sof Pasuk, Tikun Korim, TropeTrainer (download), Practito | **Ask Daniel once more; do not build unasked.** He ruled it out. The field's evidence is that this is the usual loop between lessons. The cheapest honest form is record in the browser, the tutor listens, a text note comes back; no scoring. `recordings/capture.ts` and a retention rule already exist. | Medium |
| 4 | **Calendar file** of ceremony, rehearsals and milestone dates | MM, AL, MT | **Yes, tiny**, as one read-only .ics link per family. Not two-way sync. | Small |
| 5 | **Documents shelf** (handbook, forms, honors sheet) | MT | **Maybe.** A short list of links in congregation settings. Not a file library. | Small |
| 6 | Internal staff-only notes about a student | MT | Maybe. I did not check whether lesson notes can be staff-only. | Small |
| 7 | Lesson scheduling, recurring series, attendance | MM, MT (Calendly) | **No.** Already ruled out; tutors use their own calendars. | — |
| 8 | In-app message thread for family, tutor and staff | MT, MM | **No.** E-mail and text already work; a thread with children in it needs oversight. | — |
| 9 | Synthesized voice in many traditions, pitch and voice controls | TropeTrainer | **No.** One congregation, one melody, human recordings; generated chant is behind G3. | — |
| 10 | Automated scoring of chant | Kol Torah | **No.** Quality is unverified, and the earlier research (A4, "Honesty risks") argues against it. | — |
| 11 | Side-by-side compare of own take with the model | TRT | Only if item 3 is revived. | — |
| 12 | Practice from photos of the congregation's own scroll | Virtual Tikkun | **No.** Charming; a large content job for little gain. | — |
| 13 | Service planning: aliyot and roles to a printed bima sheet | iLeyn, MM, MT | **No.** Honors and the roster Sheet cover the b'nei mitzvah case. | — |
| 14 | Verse unlocks, points, gems, badges | MM, Practice Space | **No.** Against the product's stated tone. | — |
| 15 | Parental consent step before a child's account | MT | Note only. The portal gives notice without a consent gate by Daniel's ruling. | — |

## 5. What this portal has that none of the comparators document

"None" means none of the vendor pages read here describes it.

1. **Study beside the chant.** Commentaries, a reviewed study guide per reading, translation compare, a per-student printed study booklet. Every comparator stops at text and audio.
2. **A word card** with syllables and stress in Hebrew letters, and no transliteration by design. TropeTrainer and Kol Torah lean on transliteration.
3. **A sequenced trope course with spaced review and drills**, alongside the student's own verses. TropeTrainer and Torah Readers Tutor have lessons; neither describes recognition drills or spaced review.
4. **Human word-level audio with highlighting, free to signed-out visitors**, with the licensed translation. The free tools have the audio or the text, not this combination with trope colours.
5. **A Claude connector for the rabbi** (roster intake, readings, tutors, guides). No comparator offers any assistant or API for staff, other than ShulCloud import.
6. **No-login honoree links** to the blessings and their audio, managed by the parent.
7. **Free to the congregation and forkable.** A second congregation can run its own copy. The programme managers cost about $40 to $48 per student per year or $320 to $590 per organisation per year.
8. **A practice record without games**: days practised, no streak pressure or badges. The music apps go the other way.

## 6. Limits

- Vendor pages describe intent, not quality. I used no product and saw no screens behind a login.
- Aliyah may be a pilot or a concept. Kol Torah's feedback and Virtual Tikkun's features rest on one page each.
- Mitzvah Tools' student screens are not documented publicly; its student-side cells rest on the marketing page and one line of the tasks article.
- Portal cells marked "not re-tested" or "did not check" were read from documents, not exercised.
