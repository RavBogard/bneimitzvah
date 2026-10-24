# 2.0 status (Claude Code reads this first)

Updated 2026-10-24, end of session 1. Read-only checkout: `bneimitzvah-study` main at `cfba020` (fetched 10:14 CDT 10-24); M3b, M4, M6 and the v1.8.0 tag are not in it. No `git pull` was run (no shell access to the repo this session).

## The big change this session

Daniel replaced "quote only, never write teaching" (2026-10-24, verbatim in `QUESTIONS-2.0.md`): Cowork drafts each prayer's teaching in his voice from his understanding in the repos, he approves each one, and a voice model learns from every answer. Stance: "Always a humanistic approach that leaves room for more theistic people to still resonate."

**Result: all 38 Shabbat-morning teachings are approved** (`A3-DRAFTS/`, per-file sources). The model is `A3-VOICE-MODEL.md`: rules, a log of every answer, the approved set. It drafted the Amidah and the last 19 prayers through separate agents with no further questions needed beyond approval.

## Tracks

| Track | State | Files | Open |
|---|---|---|---|
| Rulings read | done | `notes/RULINGS-DIGEST.md` | 16 contradictions in its §h |
| A1 pattern | done (site walk pending) | `A1-PATTERN.md` | signed-out phone walk of /learn |
| A2 inventory | first pass done, 179 rows | `A2-INVENTORY.md`, `notes/A2-WORKING.md` | CRC Music column (A5); 33 inferred cross-walk matches |
| A3 teaching | **done: both halves approved** (Shabbat morning 38; evening/Havdalah: 11 new + reuse with edits) | `A3-INDEX.md`, `A3-TEACHING/` (sources incl. `evening-sources.md`), `A3-DRAFTS/` (approved), `A3-VOICE-MODEL.md` | none |
| A4, A7, A8 | drafted (2026-10-24; Batch 3 rulings applied) | `A4-COURSE-DESIGN.md`, `A7-STRINGS.md`, `A8-SAMPLE-LESSON.md` | Q1, Q3, P1 decided (Batch 3b); tutor finished mark needs adversarial review: privacy |
| A5 melodies | decided: no melody link or audio in 2.0; Daniel records and handles hosting in **2.1** | `A5-MELODIES.md`, `A5-RECORDING-LIST.md` (7 sittings, ~77 min) | none for 2.0 |
| Batch 2 | answered 2026-10-24 | `QUESTIONS-2.0.md` | fluency strand yes; transliteration on request; credit "Rabbi Daniel Bogard" (overrides MISSION's generated-text label for approved teachings) |
| A6 licensing | decided: course open to all, licensed text never shown, siddur link instead | — | write-up |
| B1 D'var Torah | cut 2026-10-24 | `B1-DVAR-TORAH-OPTIONS.md` (record only) | none; not built |
| C1 beta | decided: "beta when I say so" (2026-10-24) | `C1-BETA-DEFINITION.md` | none |
| B2, B3 | cut 2026-10-24 | `B2-PRACTICE.md`, `B2-CRC-CURRENT.md`, `B3-DESIGN.md`, `B3-STRINGS.md` (record only) | none; not built ("The app is just for study") |
| C2, C3 | drafted | `C2-PILOT-KIT/`, `C3-FEEDBACK.md` | none recorded |
| D notifications | decided: "None yet" (2026-10-24) | `D-NOTIFICATIONS.md` (design for later) | none; nothing switches on at 2.0 |
| E family logistics | outline done, nothing in the app [Inferred] | `E-FAMILY-LOGISTICS.md` | none; no build |
| F site review | done | `F-SITE-REVIEW.md` | finding 8 (holiday readings, Q13) and 16 (Rashi English) are Daniel's |
| G plan | done (2026-10-24) | `G-PLAN-2.0.md` | 14 milestones (4 S, 6 M, 4 L; was 17 before the D'var cut); adversarial: SC2, SC4, SC5; G no longer blocked (SC2 and SC4 unblocked by Batch 3b); remaining open questions listed there |
| Hand-back | done for A, A6, B, C, D, F (2026-10-24) | `HANDOFF-TO-CLAUDE-CODE.md` (this folder; `../HANDOFF-TO-CLAUDE-CODE.md` untouched) | strings await Batch 4 except the 49 approved teachings and previously approved strings |
| H 2.5 notes | not started | — | only if Daniel opens 2.5 |
| Batch 3 | answered 2026-10-24 | `QUESTIONS-2.0.md` | Q11 none yet; Q12 per-part finished mark; Q13 glosses Claude drafts, live; Q14 parents see stages and dates. Q15 binder not yet supplied |
| Questions | Batch 3b answered 2026-10-24 (Q16 path = tutor's service plan, default six as fallback; Q17 approved teachings may live in the public repo; Q18 parents don't see the finished mark; Q19 rabbi owns D'var feedback and final, no focus line). **Ruling 2026-10-24: "No dvar Torah guide.. that all happens with the rabbi not in the app. Cut all related pieces. The app is just for study"; Track B cut, Q14 and Q19 moot** | `QUESTIONS-2.0.md` | none open in 2.0 except Batch 4 copy sign-off, pilot kit, evening-only prayer text |

## For Claude Code when building

- Each approved teaching is 80–160 words, voice "teacher's note", book-neutral. Show the label "Written by Claude for CRC · not yet reviewed by Rabbi Daniel Bogard" only until approval is recorded; all 38 are now approved (2026-10-24). [Inferred: whether approved teaching carries any credit line is Daniel's call]
- One teaching per blessing (Torah before, Torah after, haftarah before, haftarah after are separate).
- Drafts describe the traditional prayers; the licensed Beit Mitzvah pages were never read, so a line may differ from what a student sees (flagged per file).

## Findings that change the brief

1. **Page numbers.** The Beit Mitzvah book's "86 pages" is the internal typeset. Links use CRC's printed pages 1–63 (morning 1–31, evening 33–63).
2. **The evening half is Saturday evening with Havdalah,** not Friday evening.
3. **Daniel's teaching mostly lives in the Shabbat Morning book and the rulings ledger** (`liturgy-map/DECISIONS-LOG.md` ~12264–12404). The Beit Mitzvah book's 23 "Kavannah" notes are licensed text of unrecorded authorship.
4. **The Shabbat Morning book is hidden from the reader's shelf** (2026-09-04) and the app's feed accepts only the Beit Mitzvah volume (Batch 1 Q2).
5. **Learn to lein is hard-wired to trope** (A1 §6). The service course needs its own course file and validator.
6. **Service-learning code already exists** (`src/lib/service-learning/`, `src/server/service-learning/`, migration 0015, `DEFAULT_SERVICE_PARTS`).
7. **R1:** `RavBogard/shirei-tfilah` is the curated public mirror of `shireishabbat`, about a month behind.
8. **Beta/indexing docs are stale** (MISSION L36/L52 vs STATE L30).
9. **D'var Torah is not in the app** (Daniel, 2026-10-24); Track B is cut.
10. **Brief path error:** the learn-to-lein spec is at `docs/superpowers/plans/2026-10-22-learn-to-lein.md`.

## Next session

Saturday evening / Havdalah teachings with the same model; A5 melodies (CRC Music read tools); A6 once Q2 is answered; the /learn phone walk; then A4 course design.
