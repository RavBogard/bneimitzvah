# 2.0 hand-back to Claude Code

2026-10-24. One section per track that is done or decided, in the format of `COWORK-HANDOFF-2.0.md` §5. Build order, sizes, migrations and reviews are in `G-PLAN-2.0.md` (milestone ids SC, DV, F, G0 below refer to it). Daniel's answers are verbatim from `QUESTIONS-2.0.md`. **[Inferred]** marks anything not ruled or read in code. This file is separate from `../HANDOFF-TO-CLAUDE-CODE.md` (the 1.x hand-back), which is unchanged.

**Strings, for every track.** Unless a line says otherwise, the strings files are **drafts awaiting Daniel's Batch 4 keep or edit** (Batch 4 has not been asked). Already approved, and to be shipped exactly: the 49 approved teachings; the credit "Rabbi Daniel Bogard"; the 1.8 siddur strings ("Open in the siddur, page {page}", "Your whole service in the siddur, from page {page}", "Torah blessings: siddur page 22", "Haftarah blessings: siddur pages 23–24"); and every string A7 marks **Reuse** (they already ship). Key-word glosses go live without Batch 4 (Batch 3 Q13).

---

## Track A. The service course

**Decided**
- Daniel, 2026-10-24: "open" (Batch 1 Q2). Open to everyone, signed in or not.
- Daniel, 2026-10-24: "Go" (Batch 1 Q3, re-asked plainly). Shabbat morning (BM pp. 1–31) first, then Saturday evening with Havdalah (pp. 33–63).
- Daniel, 2026-10-24, on teaching: "Except don't always quote it. I want you to get my understanding and then draft each one for my approval, developing an evolving algorithm that can predict my next teaching on a prayer in my voice, progressively." And: "Always a humanistic approach that leaves room for more theistic people to still resonate." This replaces the brief's "Claude does not write that teaching fresh".
- Daniel, 2026-10-24, credit: "Rabbi Daniel Bogard" (Batch 2 Q9). Approved teachings carry his name alone. This overrides MISSION's rule that generated text carries its label, for approved teachings only. Anything not yet approved shows "Written by Claude for CRC · not yet reviewed by Rabbi Daniel Bogard".
- Daniel, 2026-10-24: "Yes, a short strand (Recommended)" (fluency, Batch 2 Q7); "On request (Recommended)" (transliteration, Q8).
- Daniel, 2026-10-24: "No link yet. You should give me a list of things to record", then "I'll handle the readings here as a part of two point one" (Batch 2 Q6). No melody link or audio in 2.0. [Inferred: "readings" means the prayer recordings.]
- Daniel, 2026-10-24: "Per-part 'finished' mark" (Batch 3 Q12). Widens REVIEW ruling 45 for the course only.
- Daniel, 2026-10-24: "Claude drafts, live (Recommended)" (glosses, Batch 3 Q13).
- Daniel, 2026-10-24 (Batch 3b Q16): "Tutor's service plan (Recommended)". The student's path is the tutor's service plan (0015); with no plan, the six default parts.
- Daniel, 2026-10-24 (Batch 3b Q17): "Yes, public is fine (Recommended)". Approved teachings may live in the public app repo.
- Daniel, 2026-10-24 (Batch 3b Q18): "No (Recommended)". Parents do not see the per-part finished mark; tutors and rabbis only.
- Text source (decided by Cowork as a build detail, QUESTIONS-2.0.md Batch 3b note; Daniel approved showing that book's text, Batch 1 Q2 "open"): the course reads a public build of the Shabbat Morning volume (the public mirror's feed or a public-lane build), pinned by hash, never the licensed build.
- Choreography: not asked; it lives in the teachings' "Some of us…" lines, no separate step [Inferred, Batch 2 Q10 note].

**Approved teachings: where they are**
- Shabbat morning, 38, all approved 2026-10-24: `A3-DRAFTS/01-07-morning-blessings.md`, `08-13-shma-and-blessings.md`, `11-shma.md` (draft 2), `12-vahavta.md` (draft 1), `14-22-amidah.md`, `23-38-torah-service-to-close.md`, `24-26-torah-blessings.md` (drafts 2: 24, 26), `29-31-haftarah-blessings.md` (drafts 1: 29, 31). Take the approved draft named in `A3-VOICE-MODEL.md` "Approved examples" where a file holds more than one.
- Saturday evening and Havdalah, 11 new plus edited reused texts: `A3-DRAFTS/evening-33-63.md` ("Approve all").
- Teaching 28 (V'zot HaTorah) is approved but not in the BM book (A2 row SH48); no lesson uses it in 2.0.
- Each is 80–160 words, one per blessing (Torah before, Torah after, haftarah before, haftarah after are separate).
- They describe the traditional prayers; the licensed BM pages were never read, so a line may differ from what a student holds (flagged per file). The Read step's note covers it.
- Copy them verbatim into `src/lib/service-course/tenants/crc.json` with their approval dates (A4 §5.2). They are Daniel's own text, not licensed text. The app repo is public and Daniel said that is fine (2026-10-24, Batch 3b Q17: "Yes, public is fine (Recommended)").
- `A3-VOICE-MODEL.md` is how future teachings get drafted; it is not runtime data.

**What to build**
- `A4-COURSE-DESIGN.md`: §2 units and the lesson table (54 lessons: 6 fluency, 37 morning, 11 evening), §3 lesson anatomy, §4 fluency, §5 course file and validator, §6 data and the personal path, §7 word card, §8 progress, Review and Quick ten, §9 finished mark, §10 offline, §11 siddur link, §12 second congregation, §13 states, §14 wireframes W1–W15 (W15 is the 2.1 slot, off).
- `A8-SAMPLE-LESSON.md`: the Sh'ma lesson end to end, the acceptance case for SC2.
- G-PLAN milestones SC1–SC7. Adversarial reviews: SC2 (licensed text), SC4 (sync and path), SC5 (finished mark).
- Stale line to ignore: A4 §1's "nothing finer [than days practised] unless Daniel chooses otherwise". §9 carries the ruling.

**Strings**
- `A7-STRINGS.md`: 252 strings by id, all tone-checked. Drafts for Batch 4, except rows marked Reuse and the 1.8 strings.
- `au.*` (Hear it) strings are for 2.1 and stay unused.
- Teachings and glosses are not in A7 (see above).

**Still open**
- Nothing blocks SC2 or SC4 now (A4 Q1, Q3 and P1 are decided; see above).
- Evening-only prayers' text, per prayer (SC7).
- Melody recordings and hosting: 2.1, Daniel's (`A5-RECORDING-LIST.md`, 7 sittings, about 77 minutes).

---

## A6. Prayer text and the licence

**Decided**
- Daniel, 2026-10-24: "open" (Batch 1 Q2), answering the recommendation that course text come from the public Shabbat Morning book where it matches and the licensed page be reached only by the siddur link. [Inferred: "open" accepts that recommendation as given, including the public book.]

**What to build**
- `A6-TEXT-LICENSING.md`, all of it, especially "Things Claude Code must check" 1–5.
- Licensed `legacy-beit-mitzvah` text is never shown, stored in the repo, or cached offline. The course reaches it only through `siddurPageLink(siddurUrl, tenant.siddurBook, page)`.
- Public `shabbat-shacharit` text (CC BY-NC-SA 4.0) is read at runtime, by stable unit id, from a public-lane build only (SC2), with its credit line.
- The validator fails the build on any Hebrew character in `course.json` outside the alphabet table (A4 §5.3 rule 9).
- Using the Shabbat Morning text in the course does not unhide that book on the reader's shelf (hidden by Daniel 2026-09-04).
- The public Mi Shebeirach unit is "mixed" (A2 discrepancy 13) and is not used.

**Strings**
- The credit "Text: Shirei Tfilah, CC BY-NC-SA 4.0" and the Read-step notes are in A7 (drafts for Batch 4).

**Still open**
- Nothing: A4 Q1 is decided (a public build of the Shabbat Morning volume pinned by hash, never the licensed build).

---

## Track B. D'var Torah

**Decided**
- Daniel, 2026-10-24: "it will be a shared Google doc." (Batch 1 Q1). Model (c): the student drafts in a Google Doc shared with the tutor and rabbi; the app tracks stages, dates and the link. No drafting in the app or in Claude.
- Daniel, 2026-10-24: "Stages and dates (Recommended)" (Batch 3 Q14). Parents see stages and dates, never the link.
- Daniel, 2026-10-24 (Batch 3b Q19): "Rabbi owns feedback and final (Recommended)". Tutors may mark feedback given; only a rabbi approves the final text; no free-text focus line is stored.
- Students can't use Claude for it anyway: "Parents and students cannot consent" (MCPD L13), and Claude's consumer terms are 18+ (B1).

**What to build**
- `B3-DESIGN.md`: §1 what the app never does, §2 stages and who marks what, §3 the link (accepted shapes, refusals, no network check, privacy), §4 the table, §5 deadlines, §6 screens, §7 settings, §9 no MCP access.
- G-PLAN milestones DV1–DV3. DV1 is the adversarial slice (the D'var link table). Its migration is proposed as `0046_dvar_torah_progress.sql` [Inferred — check latest]; B3 §4.3's "0043" collides with the course's migration and is superseded by G-PLAN's table.
- Retire the reserved `dvar_torah_draft` name in MISSION and REVIEW (G0), citing the 2026-10-24 ruling.
- B3 §8 notices are not built (Track D).
- Stage defaults are B2's placeholders (`B2-PRACTICE.md` §6), stored as settings. CRC's own list replaces them as data when the binder arrives.

**Strings**
- `B3-STRINGS.md`: student and child practice, tutor, rabbi, parent, settings, errors (`D-ERR-*`). Drafts for Batch 4.

**Still open**
- Nothing on B3 Q2 or Q3: decided (no focus line; the rabbi owns feedback and final). Build `marks` with no free text.
- The binder: CRC's stage list and dates.

---

## Track C. Beta, the pilot and feedback

**Decided**
- Daniel, 2026-10-24: "beta when I say so" (Batch 1 Q5). The beta label is his word alone, not tied to 2.0 or to exit criteria. C1's criteria are at most a checklist he may use; nothing waits on them.
- Standing, STATE L30: "You may continue deploying and versioning at will. The beta label comes when I say so, and not until then."

**What to build**
- Nothing in the app. `PUBLIC_INDEXING` stays false, robots keeps disallowing, no "beta" wording on screen (MISSION L78).
- G0: amend MISSION and the other stale docs listed in `C1-BETA-DEFINITION.md` ("What is stale").
- Feedback intake, `C3-FEEDBACK.md`: reports live in `C:/Users/dsbog/cowork-offload/PILOT-REPORTS.md`, outside every repo, with reporter codes and no names. Claude Code updates each report's Status with a one-line reason, rewrites a report as a generic bug before anything reaches the public tracker, and never copies report text into commits or issues. Privacy and wrong-text reports are same-day. Pilot fixes go into the fixes lane (G-PLAN F slices) as new F items.

**Strings**
- `C2-PILOT-KIT/` (welcome, tutor guide, iPhone install, feedback questions, first four weeks, Daniel's weekly watch list). Drafts; Daniel sends them. Nothing is sent by Claude Code or Cowork.

**Still open**
- The pilot kit has no keep or edit on record.
- The pilot starts on Daniel's word.
- Whether "beta" ever appears on screen (C1 "Open").

---

## Track D. Notifications

**Decided**
- Daniel, 2026-10-24: "None yet" (Batch 3 Q11). No notification switches on at 2.0. Only sign-in mail and the two account emails send (STATE L116).

**What to build**
- Nothing. `PORTAL_NOTIFICATIONS_ENABLED` stays unset and every congregation switch stays off.
- No 2.0 slice adds a notification kind, a quiet-hours change or a sender change. `D-NOTIFICATIONS.md` §0's and §8's recommendation to switch on a tutor notice is superseded by the ruling.
- Facts for whoever turns notifications on later (`D-NOTIFICATIONS.md` §1–§3, §6, §7): the tutor-draft notice still fires on the workspace's "My translation" saves; the weekly update quotes tutors' full names and summaries; there are no quiet hours; one `RESEND_FROM` serves every congregation; everything at CRC's size fits Resend's free plan, and a second sending domain would need a paid plan (over $10).

**Strings**
- `D-NOTIFICATIONS.md` §5: redrafted messages, the design for later. Drafts; not in 2.0.

**Still open**
- Which notifications, when Daniel chooses.
- D Q2: whether students still type in "My translation" (not blocking).

---

## Track F. Site fixes from the walk-through

**Decided**
- No ruling needed: these are fixes to the live site, folded into 2.0 as "anything the beta teaches us" (SPEC §6). F-SITE-REVIEW's walk was signed out, on an emulated phone, with no audio heard; the real-device checks still stand.

**What to build**
- `F-SITE-REVIEW.md`, findings 1–27 and the accessibility table, as grouped in G-PLAN F1–F6. The top five ("Top 5 for 2.0"): the rate limit and an honest 429 (1); dark mode (2, 4); asking for an account (3); Choose verses ranges and print (5, 9); the word card in Lein and Hebrew names for screen readers (6, 7).
- F1 comes first: the service course adds public text calls to the same limiter.
- F6's locked-path fix (finding 10) matters to the course, which reuses the path list.
- The A1 walk of /learn is in F-SITE-REVIEW's last section and closes A1's pending item.

**Strings**
- F proposes a few new lines (the 429 message, the sign-in line for an uninvited person, "Tap verse numbers to choose them.", "Sign in to save", "page 23, after Mi Shebeirach"). Drafts for Batch 4.

**Still open**
- Finding 8: which holiday readings CRC uses (ROADMAP Q13, a 2.5 question).
- Finding 16: Rashi's English translation is a source choice for Daniel.

---

## Not done here

- **Track E, family logistics:** waiting on the binder; outline only, no build.
- **Track H, 2.5 notes:** not started; asked only if Daniel opens 2.5.
