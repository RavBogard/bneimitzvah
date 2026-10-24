# Release 2.0 for CRC Torah: research, questions, design and copy (Cowork handoff)

2026-10-24. Claude Code wrote this for a new Cowork thread. It is a large, long-running project. Work through it over several sessions.

## Daniel's request

Daniel, verbatim: "give me a handoff for cowork to go start working on re 2.0. It should be an expansive and large project we pass to them".

**Your job.** Claude Code is finishing 1.7.x and 1.8 now. You prepare 2.0 so that Claude Code can build it straight from your folder, with no further interview of Daniel:

1. **Research.** Read the siddur repositories, the live site, the plans and the outside world. Report what is there, with paths and page numbers.
2. **Questions.** Ask Daniel what only he can decide, in short batches. Record his answers in his own words.
3. **Design.** Write the designs for each 2.0 track, down to screens, states and data. Then size the work as milestones.
4. **Copy.** Draft every learner-facing string in the house voice, ready to paste.
5. **Critique.** Say where a ruling, a plan or one of these tracks looks wrong. Daniel asked Claude Code for critical reading once ("You do not have to accept it blindly"). He values it. Bring the problem with a recommendation, never a silent workaround.

You deliver decisions, research, designs and finished text. You write no code.

**Where things are.** Every path is on Daniel's Windows machine.

- **Read, don't edit:**
  - the app repo at `C:/Users/dsbog/bneimitzvah-study/` (branch `main`; run `git pull --ff-only` there first, since that is all you may do in it);
  - the siddur repo at `C:/Users/dsbog/shireishabbat/` (GitHub `RavBogard/ShireiShabbat`; it calls itself Shirei Tfilah);
  - `C:/Users/dsbog/shirei-tshuvah-web/` (the web reader that serves the siddur at https://siddur.centralreform.org).

  Their own `CLAUDE.md` and `COORDINATION.md` rules apply while you read them. You never write to them.
- **The public Shirei Tfilah repo** is `RavBogard/shirei-tfilah` on GitHub, licensed CC BY-NC-SA 4.0 per its README. Settle in R1 whether it is the public mirror of `shireishabbat` or a separate source. If you need a local copy, clone it to `C:/Users/dsbog/shirei-tfilah-readonly/` and never commit or push from it.
- **Write only to** `C:/Users/dsbog/cowork-offload/2.0/`. Keep it outside every Git repository.
- **Earlier Cowork work** sits beside this folder, and it all still applies:
  - `../QUESTIONS.md` (Daniel's answers to date);
  - `../ROADMAP-2.md` (your first 2.0 and 2.5 draft);
  - `../research/`.

  Build on them. Don't repeat them.

**The site** is live at https://beitmitzvah.centralreform.org (moving to torah.centralreform.org).
- Readable signed out:
  - `/read` (Lein, Study, Choose verses, print);
  - `/learn` (Learn to lein, with Quick ten);
  - `/trope-chart`;
  - `/print`.
- The siddur is at https://siddur.centralreform.org/?book=legacy-beit-mitzvah&p=N. A page takes about 4 seconds to load.

---

## 1. Where the project stands (2026-10-24)

| Release | State |
|---|---|
| 1.0–1.4 | Live. The B'nei Mitzvah portal; Lein and Study with Rashi; any reading by name; accounts, saved readings, Members and approvers. |
| 1.5 | Live, v1.5.0. Course progress on the account, the typed sign-in code, the installable app, 14-day offline reading. The torah.centralreform.org switch waits on DNS. |
| 1.6 | Live, v1.6.0. Learn to lein's next three activities. |
| 1.7 | v1.7.0 is live. Friday preparation, built readings-first: Choose verses, Change verses, the Study word card, writing kept in Claude, the print appendix. 1.7.x is being finished now: preferences kept on the account; Claude's tools for your own saved readings; curated discussions with credited Claude translations. |
| 1.8 | Live inside 1.7, to be tagged v1.8.0. The web siddur integration: each assigned service part links to its printed page ("Open in the siddur, page {page}"), the whole service links from its first page, and /read shows the Torah and haftarah blessings pages (CRC only). |
| **2.0** | **This handoff.** |
| 2.5 | All voice work (generated chant per trope system, G3), the second congregation, megillot, High Holy Day trope, blessings. |

**What 2.0 is, as ruled.** Read `../ROADMAP-2.md` §1 and MISSION's amendments in `docs/planning/2026-10-15-kickoff/MISSION.md`. In short:

- **The service course** (D12, E2), Daniel verbatim:
  - "Should have ways for students to learn the service".
  - "A course, that also teaches about the prayers, using my understanding for each, pulled from shireishabbat and shirei tfilah repos".
- **D'var Torah drafting and tutor feedback.** R1.5 ruling 4 says "D'var Torah stays in 2.0".
- **The notifications Daniel chooses.** The code is built and switched off.
- **Family logistics from the binder,** in outline only.
- **"Anything the beta teaches us"** (SPEC §6).
- **"Out of beta"** was the old meaning of 2.0. Since 2026-10-23 the beta label comes only on Daniel's word, and he hasn't given it yet. Treat what 2.0 means for beta as an open question (Q-C1). Don't assume it.

---

## 2. Rulings you must work within (binding)

| Area | Ruling |
|---|---|
| **Tone** | Every learner-facing string is in sentence case, with plain verbs, and respects an adult reader. The same words serve a 12-year-old and a 60-year-old. Never use exclamation points, emoji, mascots, confetti, streaks, badges, scores, pep talk ("great job", "you got this"), slang or a youth-group voice. Learn to lein has no streak and no daily goal. |
| **Daniel's teaching** | The service course teaches about each prayer from Daniel's own commentary and framing in the siddur repos. Claude does not write that teaching fresh. Where none exists, there's a gap for Daniel, not an invented paragraph. |
| **Licences** | The CRC Beit Mitzvah siddur (`legacy-beit-mitzvah`) carries third-party text. It is licensed for CRC's non-commercial use only. It never enters the app repo and never goes to the public mirror. Never paste its text into your files: cite it by volume, page and prayer. The public Shirei Tfilah volumes are CC BY-NC-SA 4.0. Sefaria texts may be shown live with edition, licence and credit. JPS 2023 may be printed with its credit. Any new licence question goes to Daniel. |
| **Audio** | No recording of learners, of any kind. No generated audio before 2.5 and G3. The trope-song activity waits for a human recording. CRC Music (centralreform.live) is the melody link-out (REVIEW ruling 51). |
| **Writing** | Since 1.7, writing happens in Claude, not the app. The note and My translation editors were cut. Collide this with D'var Torah drafting in Track B. |
| **Privacy** | Members' saved readings and notes are private, even from staff and Daniel. No student or family data leaves the app. Never put a real person's name, email or data in your files. Use invented examples. |
| **Notifications** | Off. The only emails are the two account emails and sign-in mail, until Daniel chooses. |
| **The beta label and indexing** | Only on Daniel's word. Public pages stay noindex. Draft nothing that says "beta" as if it were live. |
| **Announcements** | None until the pilot, and Daniel says when the pilot starts. You may draft pilot material. You send nothing. |
| **Money** | Portal spend stays inside $10 a month. Flag anything that costs money. Sign up for nothing. |
| **Outward actions** | You send no email, post, form or message to anyone. Daniel sends what you draft. |
| **Daniel's time** | Questions come in batches of at most five. Each must be answerable in a line, with your recommendation first and a one-line reason. Any review session (listening, a device, reading teaching extracts) is 15 minutes at most. |
| **The second congregation** | It comes in 2.5. Design 2.0 so a second congregation could later bring its own service, teaching and siddur. Build nothing for one now. |

---

## 3. The tracks

The tracks are in priority order. Track A is the core of 2.0 and should take most of your effort. B through F can interleave with A while you wait on Daniel's answers.

### Track A. The service course (largest)

The goal is a course, in the Learn to lein pattern, through which a student learns to lead the parts of the service they lead, and comes to understand each prayer through Daniel's own teaching.

**A1. Learn the Learn to lein pattern first.** Read:

- `docs/superpowers/specs/2026-10-22-learn-to-lein.md`;
- `src/lib/learn/course.ts` and `lessons.json`;
- `../research/learn-next-activities.md`.

Then use `/learn` signed out, on a phone-sized window. Write `A1-PATTERN.md`, one page on:

- what a unit, a lesson, a practice and Quick ten are;
- how progress is kept;
- what the word card does;
- what a service course can reuse, and what it must not copy (trope melody paths make no sense for prayers).

**A2. The prayer inventory** (`A2-INVENTORY.md`, the backbone of everything else). Cover:

- every prayer and part in the CRC Beit Mitzvah volume (86 pages);
- and the Shabbat morning service in the public Shabbat Morning volume (151 pages).

For each prayer, give:

- its name, in Hebrew and as CRC says it;
- its page in `legacy-beit-mitzvah`;
- its page or section in the public `shabbat-shacharit` volume, if it is there;
- its `content/shared/` source file;
- whether the text is public (CC BY-NC-SA) or licensed (legacy, third-party);
- which service it belongs to (Shabbat morning, Friday evening, Havdalah);
- its role in the service (the leader sings; the congregation sings with the leader; it is read in silence; a responsive reading);
- the choreography marks (stand, bow, face the ark, the ritual marks) as the siddur encodes them;
- whether transliteration exists;
- whether a CRC Music melody exists (see A5).

Cross-check against the parts a student is assigned in the portal. Find them in the app's `src/lib/siddur/pages.ts` and the service-part model. The 1.8 plan lists checked pages: p1, p10, p11, p22, p23, p24, p33 and p60.

**A3. Daniel's teaching, per prayer** (`A3-TEACHING/`, one file per prayer, plus `A3-INDEX.md`).

- Find where Daniel's commentary lives. It may be in:
  - teaching footnotes;
  - intros;
  - the "moments" work;
  - the English roles and translator's notes;
  - margin rails;
  - planning docs and rulings ledgers that explain a choice.
- Search `shireishabbat` (including `content/shared/`, `planning/` and the rulings ledger), the public `shirei-tfilah`, and `shirei-tshuvah-web`.
- For each prayer, quote his words exactly, with the file path and line. Mark which surface each extract comes from: public, or app only.
- Flag any extract that lifted out of the page loses its sense.
- **Do not paraphrase, summarise into new teaching, or fill gaps.**
- `A3-GAPS.md` lists the prayers with no teaching found, ordered by how central they are to a student's part.

**A4. Course design** (`A4-COURSE-DESIGN.md`). Propose:

- the units and their order (recommend starting with what a Beit Mitzvah student leads on Shabbat morning);
- the lesson anatomy for a prayer.

Candidate activities, to keep or drop with reasons:

- hear it (a CRC Music link-out only);
- read the Hebrew phrase by phrase, with transliteration available but not default;
- the meaning of key words (reuse the Study word card);
- where it sits in the service (the arc of the service as a map);
- the choreography (what your body does, and when);
- Daniel's teaching on it;
- a short check that tests reading and meaning, never scores;
- "In the siddur, page {page}" (the 1.8 link).

Then:

- Say what can be practised offline. 1.5 made Learn to lein work offline.
- Address prayer-Hebrew decoding. It is a different skill from trope, and many students need it. Should there be a reading-fluency strand?
- Show how progress and Quick ten carry over.
- Describe how a tutor sees a student's course progress, using the existing tutor views.
- Explain how the course meets the student's own assigned parts. Their part list should be their personal path through it.

Include ASCII wireframes for a phone (360 px wide), for each screen and its empty, loading, offline and error states.

**A5. Melodies** (`A5-MELODIES.md`).

- Find out what centralreform.live (CRC Music) holds per prayer. If the CRC Music connector is available to you, use only its read tools (`search_library`, `get_song`, `list_library`). Write nothing there, ever.
- Map each prayer in A2 to its melody or melodies, and how a link-out would look.
- Note where several melodies exist (which one does CRC use for Beit Mitzvah services?) and where none exists.

**A6. Text display: the licence question in practice** (`A6-TEXT-LICENSING.md`). The course must show prayer text, but the Beit Mitzvah volume's text is licensed and app-only. Lay out the options:

- public-volume text where it matches;
- link out to the siddur page for licensed text;
- signed-in CRC-only display;
- Sefaria liturgy texts.

Say what each means for signed-out visitors, offline use, the second congregation in 2.5, and the never-in-repo rule. Recommend one, then ask Daniel.

**A7. Course copy** (`A7-STRINGS.md`). Draft every string: unit titles and summaries (under 60 and 160 characters, per `course.ts`), lesson names, instructions, empty states, the offline note, link labels, errors. Everything in house voice.

**A8. A pilot lesson on paper** (`A8-SAMPLE-LESSON.md`). Write one full lesson end to end for a central prayer, the Sh'ma (p10) or the Torah blessings (p22), using only real extracts from A3. It shows Daniel and Claude Code exactly what a lesson is.

### Track B. D'var Torah drafting and tutor feedback

The ruling is that D'var Torah is in 2.0. But since 1.7, "writing stays in Claude", and the in-app editors were cut. These collide.

**B1. Frame the tension** (`B1-DVAR-TORAH-OPTIONS.md`). Lay out three models:

- (a) The student drafts in Claude through the MCP. The app shows the draft read-only, with tutor and rabbi comments.
- (b) An in-app writing screen, as an exception to the 1.7 ruling.
- (c) Drafting outside both (a shared document), with the app only tracking stages.

For each, cover:

- its privacy (who may read drafts: tutors, rabbis, parents; MCP consent scope; R1.5 §3D);
- what students actually have: do 12-year-olds have Claude accounts? Is that appropriate, and who pays?
- the effort it takes;
- whether it fits Daniel's direction.

Recommend one. This is a real decision for Daniel. Ask him early, in Batch 1.

**B2. How CRC teaches D'var Torah now.** Ask Daniel for the binder or the current guide. Don't search his mail or Drive without his say. Research common practice (structure, length, stages, timelines before the date) and cite it. Write `B2-PRACTICE.md`.

**B3. Design and copy** for the chosen model: the stages, the tutor feedback loop, what the rabbi sees, deadlines relative to the date, wireframes and strings. Write `B3-DESIGN.md` and `B3-STRINGS.md`.

### Track C. Beta, the pilot and "out of beta"

**C1. Define it.** What does "beta" mean now that it waits on Daniel's word, and is 2.0 still "out of beta"? Write `C1-BETA-DEFINITION.md`. Propose concrete exit criteria, for example:

- a pilot with N families over M weeks;
- the iPhone and Android checks passed;
- no open security finding;
- the listening round done;
- indexing on.

Then ask.

**C2. A pilot kit, drafted and not sent** (`C2-PILOT-KIT/`):

- a one-page welcome for families;
- a one-page guide for tutors;
- the iPhone install steps (reuse `../IPHONE-CHECK.md`);
- a short feedback form, written as questions in a text file. Don't create a Google Form;
- a schedule template for the first four weeks;
- what Daniel watches each week.

**C3. Feedback intake.** How beta feedback reaches Claude Code: a format, triage labels, and what counts as a blocker. Write `C3-FEEDBACK.md`.

### Track D. Notifications

The code exists and is switched off with `PORTAL_NOTIFICATIONS_ENABLED`. It covers three kinds: tutor draft notices, the weekly parent digest and student reminders.

- Read the code paths, read-only, and describe exactly what each would send, to whom and when.
- Draft each message in house voice.
- Recommend which to switch on at 2.0. The earlier recommendation was the tutor draft notice only.
- Check the opt-outs, quiet hours and the second-congregation sender (ROADMAP-2 Q4).

Write `D-NOTIFICATIONS.md`.

### Track E. Family logistics, in outline only

"Anything from the binder's family logistics" is 2.0, in outline. Ask Daniel for the binder, or where it lives. List what it covers (dates, the tallit, the aliyot honours list, rehearsal times, the kiddush, photography rules). Sort each item into one of four groups:

- belongs in the portal;
- belongs in the office's existing tools;
- belongs on paper;
- drop it.

Write `E-FAMILY-LOGISTICS.md`. Write no designs past the outline unless Daniel asks.

### Track F. An expert walk-through of the live site

Use the public pages as a newcomer would, at phone and desktop widths. Cover:

- `/read`: choose a reading, Lein, Study, the word card, Choose verses, print;
- `/learn` and Quick ten;
- `/trope-chart`;
- `/print`;
- the sign-in and account request flow, up to the email step only. Don't submit a request.

For each finding, record:

- the page;
- what you did;
- what happened;
- why it matters;
- its severity (blocks, confuses or polish);
- a suggested fix.

Check accessibility basics: focus, labels, contrast, 44 px targets, reduced motion and Hebrew rendering. Write `F-SITE-REVIEW.md`. This feeds 2.0's "anything the beta teaches us".

### Track G. The 2.0 plan

Assemble A through F into `G-PLAN-2.0.md`:

- milestones in build order, each a bounded slice with an exit test, sized S, M or L;
- the dependencies;
- what can run in parallel (Claude Code runs 3–4 builders);
- what needs a migration;
- what is high-stakes and needs an adversarial review (anything touching auth, privacy or licensed text);
- the questions still open.

Follow the house plan style in `docs/superpowers/plans/`.

### Track H. 2.5 groundwork, light, and only after A–G

Keep this to short notes in `H-2.5-NOTES.md`:

- the second congregation's onboarding (what its rabbi needs to bring: name, host, settings, its own siddur or none, its own teaching or none);
- whether the Binder/Avery permission covers megillot and High Holy Day tables (ROADMAP-2 Q11);
- which High Holy Day readings CRC uses (Q13).

Ask none of these yet unless Daniel opens 2.5.

---

## 4. Questions for Daniel

Ask in batches of at most five, with your recommendation first. Record each answer verbatim, with its date, in `QUESTIONS-2.0.md`. These are starting points. Add the questions your research raises, and drop any that your research answers.

**Batch 1: the decisions that shape everything** (ask in the first session).

1. **B1:** How should D'var Torah drafting work, given "writing stays in Claude"? Give the three models, with your recommendation.
2. **ROADMAP Q17:** Is the service course open to everyone, like Learn to lein, or only to signed-in students? It depends on A6. Bring A6's recommendation with it.
3. **ROADMAP Q18:** Which service comes first? The recommendation is Shabbat morning, the parts a Beit Mitzvah student leads.
4. **ROADMAP Q20:** Who signs off on the teaching as extracted? The recommendation is that Daniel reviews each prayer's extracts once, in 15-minute sittings, before it goes live.
5. **C1:** What does "out of beta" mean now, and is it still 2.0?

**Batch 2: after A2–A3** (the inventory and teaching found).

6. **The gap list:** for each prayer with no teaching, Daniel either writes it, points to where it is, or the prayer ships without it (ROADMAP Q19).
7. **Reading fluency:** a decoding strand for prayer Hebrew, yes or no.
8. **Transliteration:** shown by default, on request, or never in drills.
9. **Melodies:** which CRC Music arrangement is the Beit Mitzvah default per prayer, where several exist.
10. **Choreography:** taught in the course, or left to rehearsal.

**Batch 3: notifications, logistics and the pilot.**

11. **D:** Which notifications go on at 2.0?
12. **E:** Where is the binder, and which logistics belong in the portal?
13. **C2:** The pilot kit, approved or edited.
14. **The tutor's view of course progress:** how much detail.
15. **D'var Torah:** may parents read drafts?

**Batch 4: copy sign-off.** A7, B3 and D strings, a section at a time, each "keep or edit".

---

## 5. How to hand back

- Keep `cowork-offload/2.0/STATUS.md` current. For each track, give its state (not started, in research, waiting on Daniel, done), the file names and the open questions. Claude Code reads this first.
- When a track is done, add a section to `cowork-offload/2.0/HANDOFF-TO-CLAUDE-CODE.md`:
  - what was decided (quoting Daniel);
  - what to build;
  - the strings, final;
  - what stays open.
- Cite everything: a repo path and line, a siddur page, a URL, or a dated answer from Daniel. Mark anything inferred as **[Inferred]**.
- Every extract of Daniel's teaching carries its path and whether its surface is public or app only.
- Don't put licensed Beit Mitzvah siddur text in any file. Cite it by page.

## 6. Suggested order

1. **Session 1:**
   - read the rulings (§2) and A1;
   - start A2;
   - frame B1 and C1;
   - ask Batch 1.
2. **Sessions 2–4:** A2 and A3 (the heavy reading), with A5 and A6 alongside.
3. Ask Batch 2.
4. Then A4, A7 and A8.
5. Interleave B, C, D and F while you wait on answers. E waits for the binder.
6. Then G, the plan.
7. H only if time remains.

## 7. Documents to read

- `docs/planning/2026-10-15-kickoff/MISSION.md`. Read every dated amendment. They override older lines.
- `docs/planning/2026-10-15-kickoff/STATE.md`, especially the 1.5 rulings and the popup answers.
- `docs/planning/2026-10-16-review/PLAN-REVIEW.md`, rulings 30, 44, 51 and 58 and §6.
- `docs/superpowers/specs/2026-10-22-learn-to-lein.md` and `docs/superpowers/plans/2026-10-23-web-siddur-integration.md`.
- `docs/planning/2026-10-23-friday-preparation/` (the 1.7 direction; "writing stays in Claude").
- `docs/superpowers/specs/2026-10-23-reader-print-sheet-design.md` (the print work the course may reuse).
- `../ROADMAP-2.md`, `../QUESTIONS.md` and `../research/`.
- In `shireishabbat`: `CLAUDE.md`, `COORDINATION.md`, `LICENSE.md`, `build/volumes.json`, `content/shared/`, and the rulings ledger.
