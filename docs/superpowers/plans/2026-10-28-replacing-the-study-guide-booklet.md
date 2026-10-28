# Replacing the study-guide booklet: plan

Written 2026-10-28. The analysis it comes from is `docs/superpowers/research/2026-10-28-replacing-the-parashat-hashavua-study-guide.md`. Main at writing: `446d92d5`.

## Settled decisions (Daniel, binding, 2026-10-28)

On the analysis's four questions: "Yes, yes, no, no".

1. **Every portion and haftarah gets a base guide.** Each guide has an overview, three or four themes, and verse notes with sources.
2. **The print sheet grows into a per-student booklet.**
3. **No talk-it-over questions.** S3 stands.
4. **No licensing of Plaut or Fields.** The modern voice comes from the study voice.

Alignment popups, same day:

5. **Go-live:** sample first, then all. Claude drafts three portions and one haftarah. Daniel reads them and corrects the voice. Then the rest go live, labelled "not yet reviewed" (S13).
6. **Order:** all 54 portions in calendar order, Bereshit to V'zot HaBerachah.
7. **Depth:** overview, themes and verse notes, the full guide shape that already exists.
8. **Coverage:** everything CRC students read:
   - the regular haftarot;
   - the special-Shabbat haftarot (Shekalim, Zachor, Parah, HaChodesh, HaGadol, Shuvah, Chanukah, Rosh Chodesh, Machar Chodesh);
   - holiday Torah readings when a student has one.
9. **Sources:** a mix of classical and modern. The classical side is midrash, Rashi, Ramban and the like. The modern side, including women's voices, is whatever Sefaria serves under an open licence. All of it is read through the humanistic study voice.
10. **Who prints the booklet:** both. Families and tutors print a PDF at home. The office prints a copy to hand over when study begins.
11. **Text in the booklet:** the student's own verses in full. The rest of the portion appears only as a summary, never the full text.
12. **Colour:** trope colour by default, with a switch for black and white.
13. **Booklet extras:** all four:
    - blessings before and after;
    - the service parts the student leads, with Daniel's approved teaching;
    - ceremony facts;
    - a practice page without vowels for the student's verses.
14. **No transliteration** anywhere in the booklet.
15. **Rollout:** new students first. Current students keep their paperback and may use both.

## Out of scope

- Talk-it-over or reflection questions.
- Licensed commentary.
- D'var Torah, which stays cut (2026-10-24).
- Mitzvah projects.
- Transliteration.
- Changes to the guide's on-screen layout.
- A guide editor in the app (S10: authoring is through MCP or the operator bridge).

## What already exists (no change needed)

**Guide storage and publishing:**
- `src/server/study-guides/service.ts` stores and publishes guides.
- Guides are keyed by `(tenant, kind, readingKey, version)`.
- Every source is checked against Sefaria, so citations cannot be invented.
- A guide carries an origin of claude or rabbi, a reviewed flag, and a hold.

**MCP tools:**
- `get_study_voice`, `save_study_voice` (MCP channel only, so only Daniel in Cowork can change the voice)
- `list_guide_work`, `get_reading_for_guide`
- `get_guide`, `save_guide`, `publish_guide`

**Writing path:** the operator bridge may write only Claude-origin, unreviewed base guides. Database CHECKs enforce this.

**Reading keys:** `src/lib/readings/reading-key.ts` makes every key. Torah keys are the Hebcal name slugged; haftarah keys are the passage itself.

**Print:**
- `/print` renders `src/components/portal/print/sheet.tsx` and `document.tsx`, with sizes, Hebrew/English/both, and "marked".
- The appendix runs under the licence filter (`src/lib/print/appendix.ts`).
- The English is JPS 2023.
- Honors has its own print in `workspace/honors/print.tsx`.

**Blessings:** `public-reading/siddur-blessings.tsx`.

**Service course:** Daniel's 49 teachings are approved.

**Already live:** the Bamidbar base guide (version 1).

## Work

Two tracks run in parallel. They touch no common hot files.

### Track G — guides for every reading

**G1. List every key CRC uses.** This is the code part, about half a day.

`list_guide_work` lists only readings that current students are assigned. Add a read-only listing of every guide key in CRC's rite, with whether a base guide exists and its status. It covers:
- the 54 portions and the doubled weeks;
- each portion's regular haftarah;
- the special-Shabbat haftarot;
- the holiday Torah readings.

Add it as an MCP tool, `list_guide_catalog`, and to the operator. Derive it from the existing calendar and catalog code, never from a hand list. Check that holiday readings resolve to keys, and that `torahPassageVerses` and `haftarahRefForKey` return verses for each one.

- **Tests:** a golden of the key list, with no gaps, no duplicates, and verses for every key.
- **Access:** rabbi-only read, the same authority as `list_guide_work`. It shows no student data.

**G2. The sample.** This is content, and it waits on Daniel.

- Claude drafts Bereshit, Yitro, Ki Teitzei, and the haftarah for Va'etchanan (Isaiah 40, Nachamu). These cover three books and a haftarah.
- The drafts are saved through the operator bridge as **held** drafts, so students don't see them yet.
- First, read the live study voice with `get_study_voice`. If it is still the starter, say so in the sample note.
- Daniel reads the drafts in Cowork with `get_guide`. He corrects the voice there, either with `save_study_voice` or by marking up the drafts.
- **This is the one stop for Daniel in this plan.**

**G3. Drafting in bulk.** This is content, after Daniel's sample verdict.

- **Order:**
  1. The portions in calendar order, Bereshit to V'zot HaBerachah, with the doubled weeks as their own guides.
  2. Then each regular haftarah in the same order.
  3. Then the special-Shabbat haftarot.
  4. Then the holiday readings.
- **Agents:** batches of six readings for each drafting agent (the strongest model, because this is the text students read). Two or three agents at once.
- **Inputs:** each agent gets `get_reading_for_guide` pages and the voice body.
- **What an agent writes:** an overview, three or four themes, and verse notes on the verses that matter, including the verses students usually read. It cites only source ids the server listed for that verse.
- **Rules for every guide:**
  - Never paste English verse text.
  - Written for a twelve-year-old and an adult in the same sentence.
  - A classical and modern mix of sources.
  - Humanistic, with room for more theistic readers.
- **Second pass:** a second agent checks each batch against a fixed checklist:
  - facts true to the text;
  - no citation outside the listed ids;
  - voice;
  - length;
  - a mix of sources;
  - no verse text pasted.
  It returns fixes, the drafter applies them once, and the batch is published as unreviewed, live at once (S13).
- **Logging:** each batch goes in a guide ledger file outside the repo (key, version, date). There is one STATE line per finished book of the Torah.
- **Volume:** about 60 Torah keys and about 70 haftarah and special keys. At about six per agent, that is roughly 22 agent runs. The cost is Claude time only, no money.

**G4. A check that coverage is complete.** When G3 ends, `list_guide_catalog` shows every key with a published base guide. Spot-walk one reading per book on the phone.

### Track B — the per-student booklet

**B1. The booklet document.** This is code, one PR, Sonnet builder.

It is a new document mode at `/print?booklet=<studentId>`, with its own component beside `sheet.tsx`. It reuses `document.tsx` for the verse runs. The order:

1. **Cover:** the student's name, the portion and haftarah names, the ceremony date, rehearsal dates, the tutor, and which aliyot are theirs.
2. **Blessings before and after:** the Torah blessings, then the haftarah blessings, in Hebrew and English with no transliteration. Use the same source as `siddur-blessings.tsx`.
3. **About this portion:** the base guide's overview, and its theme titles with their intros. This is the summary of the whole portion; the full text of the rest is not printed.
4. **Your reading:** the student's own verses, Hebrew with trope colour and JPS 2023 English, aliyah by aliyah. The verse notes on those verses follow each aliyah, with their sources under the licence filter.
5. **Practice page:** the same verses without vowels or trope (the tikkun rendering).
6. **The haftarah:** the same sections (about, your reading, practice page) when the student reads haftarah.
7. **Your service parts:** each prayer the student leads, in Hebrew and English with Daniel's approved teaching. No transliteration.
8. **Credits:** editions, licences, and the guide's review label ("Written by Claude for CRC · not yet reviewed by Rabbi Daniel" or "Reviewed by Rabbi Daniel").

More rules:
- **Colour:** trope colour by default, with a "Black and white" switch that prints plain text. Reuse the existing colour and marked options; add no new palette.
- **Layout:** Letter size, page breaks between sections, and each aliyah kept whole where it fits.
- **Missing parts:** a section that has no data is left out silently. For example: no guide yet, no haftarah, no service parts, or no rehearsal dates.

**B2. Who may open it.** This is access work, so it gets the strongest model and a scoped access review.

- The booklet carries family data (the ceremony date, the tutor, rehearsals). It is **never** public or signed-out.
- It uses the same rule as the student's reading page today:
  - the learner themselves;
  - a linked parent;
  - a tutor who can view the learner under the A1 rule;
  - an admin.
- Anyone else gets the same 404 as an unknown student.
- No new data paths: reuse the reading, guide, honors and service-part reads that each role already has.
- The review attacks:
  - another tenant's student;
  - a tutor whose claim was revoked;
  - a parent of a different child;
  - the signed-out state;
  - a guessed student id;
  - whether any licence-filtered text can leak into the print.

**B3. Ways in.**
- "Print booklet" on the student's My Readings card, also seen by parents through their child.
- "Print booklet" on the tutor and admin student pages.
- A per-row action on the admin roster, for the office.
- Wording, decided here and logged: the button reads "Print booklet". The page title is "{Name}'s study booklet".

**B4. Tests.**
- Vitest on the access rule (the roles above), plus section assembly from a fixture, including the cases where a section is missing.
- One Playwright check that the booklet renders its sections by test id for a seeded student, on desktop only.
- No full-suite runs inside an agent.

## Order and pipeline

1. **Now, at the same time:** G1 (with a small builder) and B1–B3 (one PR). Different files: the MCP tools and catalog for G1, print and entrances for B.
2. G2 sample, as soon as G1 has merged and the sample is drafted. Stop for Daniel.
3. B goes through review and its one fix round, then `merge-if-green.sh`.
4. G3 bulk drafting after Daniel's sample verdict. It runs through the operator, needs no PRs, and produces one STATE commit per finished book.
5. G4 coverage check, then one STATE commit and a short report.

The re-walk fix PR ("One staff student header, no orphan separators, no empty shelf for staff") is in flight now. It touches `reading.tsx` and `students.tsx`. B3's entrance on the student page must wait for it to merge, or rebase onto it, so that two open PRs never share that hot file.

## Decided here (Claude, logged)

- **The sample portions are Bereshit, Yitro, Ki Teitzei and Isaiah 40 (Nachamu).** They cover three books, narrative and law, and the haftarah of consolation.
- **The booklet is a print route, not a stored PDF.** The browser's print-to-PDF makes the file. Nothing is stored, so no family data sits in Blob storage.
- **The booklet shows the guide's review label**, as the screen does. A printed draft must never look like the rabbi's text.
- **GATE: drafted guides publish unreviewed after the sample.** I proceeded because Daniel chose "Sample first, then all" and S13 allows labelled unreviewed guides.

## Open items that wait on Daniel

- His verdict on the G2 sample, and any corrections to the voice. Nothing in G3 starts before it.
