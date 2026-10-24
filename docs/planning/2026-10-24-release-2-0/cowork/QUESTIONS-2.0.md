# Questions for Daniel on 2.0, and his answers

Answers are recorded verbatim with their date. Recommendation first in every question.

## Batch 1: the decisions that shape everything (asked 2026-10-24)

1. **D'var Torah drafting (B1).** Rec: (c) the student drafts in a shared document; the app tracks stages, dates and the link. Reason: 12-year-olds can't hold Claude accounts (18+ terms) and students can't connect Claude to the portal (MCPD L13), so (a) fails for children; (c) needs no exception to "writing stays in Claude". Detail: `B1-DVAR-TORAH-OPTIONS.md`.
   - **Daniel, 2026-10-24:** "it will be a shared Google doc."
   - **Resulting decision:** model (c). The student drafts in a shared Google Doc; the app tracks stages, dates and the doc's link. No drafting in the app or in Claude.
2. **Open to everyone, or signed-in only (RM2 Q17, with A6).** Rec: open to everyone. Prayer text in the course comes from the public Shabbat Morning book (CC BY-NC-SA) where it matches; a licensed Beit Mitzvah page is reached only by the "In the siddur, page N" link, never shown in the app. Note: that public book is the one hidden from the reader's shelf since 2026-09-04.
   - **Daniel, 2026-10-24:** "open"
   - **Resulting decision:** the service course is open to everyone, signed in or not. Licensed Beit Mitzvah text is never shown in the app; it is reached by the siddur page link. [Inferred: "open" accepts the recommendation as given, including prayer text from the public Shabbat Morning book.]
3. **Which service first (RM2 Q18).** Rec: Shabbat morning, Beit Mitzvah book pp. 1–31, starting with the six default parts (Torah blessings before and after, haftarah blessings before and after, Sh'ma, V'ahavta), then the rest in service order.
   - **Daniel, 2026-10-24:** "huh?" (the question was unclear; re-asked in plain words: Shabbat morning first, Saturday evening and Havdalah after)
   - **Daniel, 2026-10-24:** "Go"
   - **Resulting decision:** the course teaches Shabbat morning (BM pp. 1–31) first, then Saturday evening with Havdalah (pp. 33–63).
4. **Who signs off on extracted teaching (RM2 Q20).** Rec: Daniel reads each prayer's extracts once before it goes live, in 15-minute sittings of a few prayers each.
   - **Answer:** superseded by the 2026-10-24 teaching ruling below: Daniel approves each drafted teaching.
5. **What "out of beta" means, and is it 2.0 (C1).** Rec: decouple. 2.0 is the course, D'var Torah and notifications; the beta label is Daniel's word after a short pilot and the phone checks. Detail: `C1-BETA-DEFINITION.md`.
   - **Daniel, 2026-10-24:** "beta when I say so"
   - **Resulting decision:** the beta label is Daniel's word alone, not tied to 2.0 or to exit criteria. 2.0 is the service course, D'var Torah stages and the chosen notifications. The exit criteria in C1 are at most a checklist Daniel may use; nothing waits on them.

## Ruling on the teaching (2026-10-24), replaces "quote only, never write teaching"

**Daniel, 2026-10-24, verbatim:** "Except don't always quote it. I want you to get my understanding and then draft each one for my approval, developing an evolving algorithm that can predict my next teaching on a prayer in my voice, progressively. Make sense? Ask pop up qs about each prayer to develop this, is my thought? A lot of this should already be in shireishabbat repo though...so I'm hopeful you might just be able to do it." And: "Always a humanistic approach that leaves room for more theistic people to still resonate."

**Resulting decision:** for each prayer, Cowork gathers Daniel's existing teaching (verbatim, cited), drafts a teaching in his voice, and asks short pop-up questions where the sources don't settle it. Nothing goes live without his approval. A voice model (`A3-VOICE-MODEL.md`) records what each approval and edit teaches, so later drafts need fewer questions. Stance: humanistic, leaving room for theistic readers. This supersedes the brief's "Claude does not write that teaching fresh" and answers Q4 (Daniel approves each one). Precedent for the label until approval is recorded: "Written by Claude for CRC · not yet reviewed by Rabbi Daniel Bogard" (study-voice handback, 2026-10-21).

## Batch 2 (asked 2026-10-24)

Context given: CRC Music holds band charts behind the band app, with no public page or recording, so ruling 51's link-out can't teach a melody.

6. **Melodies.** Rec: no link in 2.0; the tutor teaches the melody.
   - **Daniel, 2026-10-24:** "No link yet. You should give me a list of things to record"
   - **Resulting decision:** no CRC Music link yet. Daniel records the prayers himself; Cowork writes the recording list (`A5-RECORDING-LIST.md`). Open: where the recordings are hosted (REVIEW ruling 51 said the portal hosts no prayer recordings).
   - **Daniel, 2026-10-24 (on where the recordings live):** "I'll handle the readings here as a part of two point one"
   - **Resulting decision:** [Inferred: "readings" = the prayer recordings] the recordings and their hosting move to release 2.1, and Daniel handles them. 2.0's course ships with no melody audio; the "Hear it" step is out of 2.0.
7. **Reading fluency strand.** Rec: yes, short.
   - **Daniel, 2026-10-24:** "Yes, a short strand (Recommended)"
8. **Transliteration.** Rec: on request.
   - **Daniel, 2026-10-24:** "On request (Recommended)"
9. **Credit on approved teachings.** Rec: "Written by Claude for CRC · reviewed by Rabbi Daniel Bogard".
   - **Daniel, 2026-10-24:** "Rabbi Daniel Bogard"
   - **Resulting decision:** approved teachings carry his name alone. This overrides, for the service course, MISSION's rule that generated text carries its label (noted for Claude Code). The pre-approval label still applies to anything not yet approved.
10. **Choreography.** Not asked: the approved teachings already carry the "some of us…" practice lines. [Inferred: no separate choreography activity.]

## Batch 3 (asked 2026-10-24)

11. **Notifications at 2.0 (D).** Rec: the tutor notice only, rebuilt for D'var Torah stages.
   - **Daniel, 2026-10-24:** "None yet"
   - **Resulting decision:** no notification switches on at 2.0. Only sign-in and the two account emails send. `D-NOTIFICATIONS.md` stays as the design for later.
12. **Tutor's view of course progress.** Rec: days practiced only.
   - **Daniel, 2026-10-24:** "Per-part 'finished' mark"
   - **Resulting decision:** tutors see, per assigned part, whether the student has finished that part's lesson. Needs a new staff-readable record (`course_progress` is owner-only, 0037:18-21). This widens REVIEW ruling 45 ("nothing finer than days-practiced") for the service course; it touches privacy, so it gets the adversarial review.
13. **Key-word glosses (~150).** Rec: Claude drafts, live as lesson text.
   - **Daniel, 2026-10-24:** "Claude drafts, live (Recommended)"
14. **D'var Torah: what parents see.** Rec: stages and dates, not the doc link.
   - **Daniel, 2026-10-24:** "Stages and dates (Recommended)"
15. **The binder** (B2, E): not yet supplied.
   - **Daniel, 2026-10-24:** "We will develop and find and create the dvar guide next. I'll tell code your work is done"
   - **Resulting decision:** the D'var Torah guide is the next piece of work, to be found or written; B2's stage list is provisional until then. Cowork's 2.0 handoff is complete.

## Ruling: no D'var Torah in the app (2026-10-24), replaces Q1, Q14, Q15, Q19

**Daniel, 2026-10-24, verbatim:** "No dvar Torah guide.. that all happens with the rabbi not in the app. Cut all related pieces. The app is just for study"

**Resulting decision:** D'var Torah is out of the app entirely: no guide, no stages, no doc link, no tracking, no notices. The d'var is worked on with the rabbi outside the app. Track B is cut. [Inferred from "the app is just for study": family logistics (Track E) also stay out of the app; E's "portal" items move to the office's tools or paper.]

## Batch 3b: questions raised by G (asked 2026-10-24)

16. **Which part list is the student's path** (A4 Q3). **Daniel:** "Tutor's service plan (Recommended)". Falls back to the six default parts when there is no plan.
17. **Approved teachings in the public app repo.** **Daniel:** "Yes, public is fine (Recommended)".
18. **Parents see the per-part finished mark.** **Daniel:** "No (Recommended)". Tutors and rabbis only.
19. **D'var Torah sign-off.** **Daniel:** "Rabbi owns feedback and final (Recommended)". Tutors may mark feedback given; only a rabbi approves the final text; no free-text focus stored.

Not asked, decided by Cowork as a build detail: the course reads prayer text from a public build of the Shabbat Morning volume (the public mirror's feed or a public-lane build), pinned by hash, never the licensed build. Daniel approved showing that book's text (Batch 1 Q2, "open").
