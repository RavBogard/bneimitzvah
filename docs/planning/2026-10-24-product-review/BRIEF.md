# Product review brief (2026-10-24)

The live product is v1.8.0 (7c13cac) at https://beitmitzvah.centralreform.org. This review looks for problems in UI, UX, usability, feature gaps, learning gaps and best practice. It runs while Cowork works on 2.0.

## Settled decisions (Daniel, binding, 2026-10-24 popups)

- **Audiences.** All of these:
  - Daniel himself, getting ready to read and to teach on Shabbat;
  - students aged 12–13;
  - tutors and parents;
  - adults preparing a reading;
  - admins and staff.
- **Areas:** usability and flows, learning design, feature gaps, and visual, accessibility and phone.
- **Learning goal.** The app is measured against all three:
  - the student chants their portion on their own;
  - they understand it well enough for a d'var Torah;
  - they can prepare a new reading on their own years later.
- **Hebrew readiness is out of scope.** Assume the student can already decode Hebrew.
- **Benchmarks:**
  - Daniel's current preparation tools: Chabad's in-depth Torah, Torah reading, parashah summary and haftarah pages;
  - Sefaria;
  - trope and leyning apps (Trope Trainer, PocketTorah, Navigating the Bible and similar);
  - language-learning apps;
  - the tools rabbis use to prepare (AlHaTorah, Mechon Mamre and similar).
- **Daniel's own preparation:** the aim is to *replace* his current tools. He should be able to prepare to read and teach from this app alone.
- **Accessibility:** WCAG 2.2 AA, including the size of Hebrew text.
- **Devices:** phone first for everyone. Laptop and tablet are secondary.
- **Visual changes:** a full redesign is welcome if the review supports it.
- **Earlier rulings** (no streaks, no recording the learner, no daily goal, the tone rules): the review is free to argue for reversing any of them, with evidence. Daniel decides.
- **A study and learning companion, not a source-sheet builder** (Daniel, 2026-10-24, during the review):
  - Members, students and staff do not collect, keep or assemble their own sources. Findings that propose this are out of scope.
  - The only source-sheet work is a rabbi curating sources for b'nei mitzvah students.
  - The model is the right-hand column of Chabad's Torah in depth, the curated insights beside the text, not its summary column on the left. The curated discussions (1.8 M6) are where this already lives.
  - The aim is a curated experience that brings the best texts to the surface.
- **Out of scope:**
  - 2.0 (the service course and siddur work) is with Cowork. Notes on it go to `C:/Users/dsbog/cowork-offload/2.0/` and are not reviewed here.
  - Voice and chant audio (2.5): only the experience of listening is reviewed, such as where audio is missing or where it should be. No judgments of audio quality. These findings go in a separate 2.5 list.
- **Hebrew text has its own reviewer:** fonts, vowels and trope marks, sizes, right-to-left layout, line breaks, the tikkun view and print.
- **Signed-in screens** are reviewed on a local copy with made-up example.test data. Production is checked signed out only. No real family data is touched.
- **Scale:** thorough. About 8–10 agents, run 3–4 at a time, with a second agent that verifies the findings.
- **Starting point:** reviewers start fresh, with no seeded list of known problems. At synthesis time, the findings are compared with the 2026-10-20 external review (R-01…R-22) to mark which of those are still open.
- **Ranking:** by impact on a real user, weighted toward students and Daniel's Shabbat preparation. Each finding is tagged S, M or L for effort.
- **Clear defects** (broken links, accessibility bugs, typos, layout breaks) that need no new wording or ruling are fixed during the review and shipped as a 1.8.x patch.
- **After the report:**
  - Daniel answers up to 10–15 popups on the real choices: redesigns, reversed rulings and new wording.
  - The approved set is built as 1.9, before 2.0.
- **Where the report goes:**
  - the full report: `REPORT.md` in this folder;
  - a shareable private page with screenshots.

## Standing rules that still hold

- These never enter the repo:
  - JPS or any other licensed text;
  - student or family data;
  - recordings;
  - credentials.
- Reviewers' screenshots and notes stay in the scratchpad until synthesis. Only made-up data may appear in a screenshot.
- Never print or log a token, cookie, connection string or full email address.
- Reviewers write no product code. Defect fixes are separate, bounded slices.

## Lenses and agents

| Wave | Agent | What it reviews |
|---|---|---|
| 1 | Benchmarks | What the benchmark tools do. A feature matrix and what our users would expect. |
| 1 | Daniel's Shabbat prep | Preparing to read and to teach, signed out on production, then signed in locally. |
| 1 | Learning design | Learn to lein, practice, review and Study, against learning science and the three goals. |
| 1 | Sandbox | Builds the local copy with made-up data so the other agents can see the signed-in screens. |
| 2 | Student on a phone | The student workspace, practice, Learn and Study. |
| 2 | Tutors and parents | The tutor workspace, a student's detail page, the parent view, and email and approvals. |
| 2 | Admins and staff | Roster, invitations, settings, reference review and accounts. |
| 2 | Hebrew text | On screen and on paper. |
| 3 | Visual and accessibility | WCAG 2.2 AA, phone layout, performance, consistency, and a possible redesign direction. |
| 3 | Verifier | Re-checks every high-impact finding against the product and drops what doesn't hold. |

## Open items that wait on Daniel

The popups after the report, as described under "After the report" above.
