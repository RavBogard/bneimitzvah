# A8. A sample lesson on paper: the Sh'ma (BM p. 10)

2026-10-24. One full lesson of the service course, end to end, every screen in order with its exact copy. Design: `A4-COURSE-DESIGN.md`. Strings: `A7-STRINGS.md` (ids in brackets below). App paths are relative to `C:/Users/dsbog/bneimitzvah-study/`.

## What this lesson is built from

| Piece | Source |
|---|---|
| Teaching | `A3-DRAFTS/11-shma.md`, draft 2, approved by Daniel 2026-10-24 (A3-VOICE-MODEL.md log: "Sh'ma, Draft 2: Approve"). Quoted verbatim below. |
| Hebrew shown | The public Shabbat Morning volume, unit `shma.the-shma@shabbat-shacharit` (fol. 39; A2 row SH24), loaded at runtime from the public-lane feed (A4 §6.2, Q1). Nothing from the Beit Mitzvah book. |
| The six words shown in this file | Deuteronomy 6:4, a Torah verse, which the public unit's first line carries. They are the only prayer text in this file. |
| CRC's page | `legacy-beit-mitzvah` printed page 10 (A2 row BM13; 1.8 live link check, SIDDUR L57-66); evening page 39 (A2 row BM50). The BM unit is `shma.the-shma@bm-shacharit` / `@bm-maariv`, one of `DEFAULT_SERVICE_PARTS` (`src/server/service-learning/feed.ts:313-314`). |
| Word card | The existing card, asked for Deuteronomy 6:4 (A4 §7), because the line is a Torah verse. |

## The lesson's entries in the course files (no Hebrew)

`src/lib/service-course/course.json`, lesson entry [shape per A4 §5.3; values are this design's]:

```json
{
  "id": "shma",
  "kind": "prayer",
  "title": "Sh'ma",
  "summary": "All of existence is one, and we stand inside it.",
  "goal": "After this you can read the Sh'ma's first line and say what its key words mean.",
  "section": "shma-and-blessings",
  "read": {
    "unit": "shma.the-shma@shabbat-shacharit",
    "blocks": [0, 1],
    "torahRef": { "ref": "Deuteronomy 6:4", "kind": "torah", "words": [0, 5] }
  },
  "keyWords": [
    { "block": 0, "word": 0, "gloss": "hear, listen", "root": "sh-m-a" },
    { "block": 0, "word": 1, "gloss": "Israel, the Jewish people" },
    { "block": 0, "word": 2, "gloss": "God's name, said as Adonai", "check": false },
    { "block": 0, "word": 3, "gloss": "our God" },
    { "block": 0, "word": 5, "gloss": "one", "root": "e-ch-d" }
  ],
  "check": { "items": 5 },
  "prerequisites": [],
  "hear": null
}
```

- `blocks: [0, 1]` assumes the unit's first block is the verse and its second the line said after it [Inferred; the build reads the unit and sets the range]. Only block 0 has key words and check words.
- `"check": false` on the divine name keeps it out of the reading items: its written letters and its spoken "Adonai" do not match, so "Which word says Adonai?" would test a convention, not decoding [Inferred rule].
- Roots are written in Latin letters because rule 9 (A4 §5.3) allows Hebrew only in the alphabet table.

`src/lib/service-course/tenants/crc.json`, the Sh'ma's entry:

```json
"shma": {
  "bm": ["shma.the-shma"],
  "pages": { "morning": 10, "evening": 39 },
  "teaching": { "text": "(the approved teaching below, verbatim)", "approved": "2026-10-24" }
}
```

## Before the lesson: the course home

A signed-in student (invented example: "Maya", morning service, plan assigned) sees the Sh'ma first under "Your parts":

```
Your parts                                   [home.mine.heading]
The prayers you lead, in service order.      [home.mine.line]
 ◉ Sh'ma                         p. 10
 ○ V'ahavta                      p. 11
 ...
```

She taps **Start** [home.next.start]. The lesson opens at `/learn/service/shma`.

If Maya's tutor has assigned her the Sh'ma, opening the lesson writes one `visit` practice event for that part (A4 §9, option A). Her tutor will see that day in the practice calendar. Nothing else about this lesson reaches anyone.

## Screen 1 of 6: About this prayer

Bar: close button labelled "Back to the course" [frame.close], the title "Sh'ma" [lesson.shma.title], the rail "Step 1 of 6" [frame.rail].

> **About this prayer** [step.about]
>
> The Sh'ma (Deuteronomy 6:4) is among the oldest fixed parts of Jewish prayer; the Mishnah already takes for granted that it is said each evening and morning. It is less a statement of belief than a statement of relationship: that all of existence is one, and that we stand inside that oneness rather than at its center. Jews have long called that oneness God. Two letters are written large in the Torah scroll, the last of the first word and the last of the last, and together they spell *ed*, "witness": the one who says it bears witness.
>
> Rabbi Daniel Bogard [about.credit]

Footer: **Next** [frame.next].

Notes:
- The teaching is shown exactly as approved, *ed* in italics. No label "Written by Claude…": approval is recorded (A7 about.unapproved is for unapproved text only).
- This teaching has no "Some of us…" practice line. The course adds none (choreography is not a separate activity, Batch 2 Q10).
- Works offline: the teaching is in the bundle.

## Screen 2 of 6: Where it is in the service

> **Where it is in the service** [step.where]
>
> ○ Morning blessings
> ● The Sh'ma and its blessings
> &nbsp;&nbsp;· Bar'chu
> &nbsp;&nbsp;· Yotzeir Or
> &nbsp;&nbsp;· Ahavah Rabbah
> &nbsp;&nbsp;▶ **Sh'ma**
> &nbsp;&nbsp;· V'ahavta
> &nbsp;&nbsp;· Mi Chamochah
> ○ The Amidah
> ○ The Torah service
> ○ Closing the service
>
> Sh'ma comes after Ahavah Rabbah and before V'ahavta. [where.line]
> Part of the Sh'ma and its blessings. [where.section]
> In your siddur it is on page 10. [where.page]

Footer: **Next**.

Notes:
- The map is the morning units in order, with the current unit open. Names inside it are lesson titles; each is a link to its lesson.
- `where.section` lowercases a unit title's leading "The" mid-sentence. [Inferred build rule]
- `where.page` uses Maya's own page from her plan (service.ts:59-63). Signed out it uses the tenant file's morning page, 10; a student on the Saturday evening service sees 39.

## Screen 3 of 6: Read it

> **Read it** [step.read]
>
> Read each line aloud at your own pace. Tap a word to see what it means. [read.instruction]
>
> ( Show transliteration ) [read.translit.show]   ( Show English ) [read.english.show]

Then the lines of `shma.the-shma@shabbat-shacharit`, blocks 0–1, right to left, large type. Block 0, the verse:

<p dir="rtl" lang="he">שְׁמַע יִשְׂרָאֵל יְהוָה אֱלֹהֵינוּ יְהוָה אֶחָד</p>

(Deuteronomy 6:4 as the Masoretic text spells it. The build shows whatever block 0 of the public unit holds, which may print the divine name in another form [Inferred]; the word-count check in A4 §7 decides whether the word card opens.)

Block 1 is shown as the feed has it. It is not reproduced here.

With **Show transliteration** on, each line gets its transliteration beneath it, from the feed's own `tr` field. For block 0 it reads, for example, *Sh'ma Yisrael Adonai Eloheinu Adonai echad* [the build uses the feed's spelling]. The toggle then reads **Hide transliteration** [read.translit.hide]. **Show English** works the same way with the volume's English for each line, and its credit (A2 discrepancy 13: this unit's English is JPS 2023 through Sefaria, which "may be printed with its credit", COWORK-HANDOFF-2.0.md §2 Licences).

Under the lines:

> New to Hebrew letters? Start with Reading Hebrew. [read.newToHebrew] (shown until lesson f1 is done)
>
> Text: Shirei Tfilah, CC BY-NC-SA 4.0. [read.credit]
>
> Your siddur may print this prayer a little differently. Read it there too. [read.siddurNote]
>
> Open in the siddur, page 10 ↗ [done.siddur]

Footer: **Next**.

Taps: every word of block 0 opens the existing word card for Deuteronomy 6:4 (bottom sheet on a phone, `src/components/learn/word-card.tsx:42, 82-93`). Words of block 1 open the glossary card only if they are key words; here none are, so they are plain text.

States on this screen (A4 §13): "Loading the lesson…" [st.lesson.loading]; on failure "The prayer text did not load. Try again." with **Try again** [st.text.error, st.retry]; installed and offline without the pack, "This prayer's text isn't saved on this device. Connect to read it." and "You can still read about this prayer." [st.text.offline, st.offline.teachingOk]. In each of those the lesson is not marked done.

## Screen 4 of 6: Key words

> **Key words** [step.words]
>
> A few words to know in this prayer. Tap one for more. [words.instruction]

| Hebrew (from the loaded line) | Transliteration (feed) | Gloss (course file) |
|---|---|---|
| <span dir="rtl" lang="he">שְׁמַע</span> | sh'ma | hear, listen |
| <span dir="rtl" lang="he">יִשְׂרָאֵל</span> | Yisrael | Israel, the Jewish people |
| <span dir="rtl" lang="he">יְהוָה</span> | Adonai | God's name, said as Adonai |
| <span dir="rtl" lang="he">אֱלֹהֵינוּ</span> | Eloheinu | our God |
| <span dir="rtl" lang="he">אֶחָד</span> | echad | one |

Tapping a row opens the full word card for that word of Deuteronomy 6:4 (meaning in this verse, syllables and stress, grammar, dictionary senses with their credit; A1 §3). Offline, the card's own "Needs a connection" line shows inside it.

Footer: **Next**.

## Screen 5 of 6: Check

> **Check** [step.check]
>
> A few questions on what you just read. Answer before you look. [check.instruction]

Five items, in a seeded random order. The choices are shown with no colour until the learner answers. **Next** stays disabled until an answer is given. Here is one possible run, with one miss:

**Item 1 (reading).** "Which word says echad?" [check.whichSays]
Choices: <span lang="he">אֱלֹהֵינוּ</span> · <span lang="he">אֶחָד</span> · <span lang="he">שְׁמַע</span>
Maya taps <span lang="he">אֶחָד</span>. The choice is marked right; the line reads "Yes. <span lang="he">אֶחָד</span> is echad." [check.right]

**Item 2 (meaning).** "What does this word mean?" [check.whatMeans], over <span lang="he">שְׁמַע</span>
Choices: one · hear, listen · our God
Maya taps "one". The right choice is shown; the line reads "That one means one." [check.missMeaning] and under it "This one comes back in a moment." [check.again]

**Item 3 (reading).** "Which word says Yisrael?"
Choices: <span lang="he">יִשְׂרָאֵל</span> · <span lang="he">אֶחָד</span> · <span lang="he">שְׁמַע</span>
Right: "Yes. <span lang="he">יִשְׂרָאֵל</span> is Yisrael."

**Item 4 (meaning).** "Which word means one?" [check.whichMeans]
Choices: <span lang="he">אֱלֹהֵינוּ</span> · <span lang="he">אֶחָד</span> · <span lang="he">יִשְׂרָאֵל</span>
Right: "Yes. <span lang="he">אֶחָד</span> means one." [check.rightMeaning]

**Item 5 (reading).** "Which word says Eloheinu?"
Choices: <span lang="he">שְׁמַע</span> · <span lang="he">יִשְׂרָאֵל</span> · <span lang="he">אֱלֹהֵינוּ</span>
Right.

**Item 2 again** (the miss comes back 3 to 5 items later, `src/lib/learn/run.ts:15-21`; here it lands at the end because the run is short). Maya taps "hear, listen": "Yes. <span lang="he">שְׁמַע</span> means hear, listen."

Then the Check ends. No count, no summary of right and wrong. After any answer, every Hebrew word on screen is a word-card target (as Learn does after an answer, plan item 32).

What moved: the lesson's two cards, `word:shma:read` and `word:shma:meaning`, do not exist until the lesson is done, so nothing moves during the first run. (In later reviews, a miss drops a card two boxes and a right answer moves it up one, at most once per run: `src/lib/learn/progress.ts:76-90`.)

## Screen 6 of 6: Done

> **Sh'ma**
> **Done** [step.done]
>
> You can read the Sh'ma's first line and say what its key words mean. (the lesson goal through `presentGoal`, `src/lib/learn/course.ts:100-103`)
>
> Open in the siddur, page 10 ↗ [done.siddur]
>
> Next of your parts: V'ahavta [done.nextMine]

Footer: **Start next lesson** [done.startNext], and **Back to the course** [done.back].

What happens when this screen opens:
- The lesson is marked done (time saved), and `word:shma:read` and `word:shma:meaning` enter box 1, due tomorrow, or sooner before Maya's date (the known-date cap, progress.ts:66-75, 98-103).
- Signed out, this is saved in the browser under `crc-torah:service-progress/v1`. Signed in, it syncs to her own `service_course_progress` row, which no one else can read (A4 §6.2).
- The home's Next becomes V'ahavta. The Sh'ma's row in "Your parts" shows ● with ", done" for screen readers [home.state.dot.done].
- Offline, the siddur link is replaced by "Needs a connection" [st.needsConnection].

A learner who is signed out, or has no plan, sees "Next: V'ahavta" [done.nextName] instead of "Next of your parts".

## Afterwards

- **Review.** From tomorrow, the home may show "Review: 2 words, about 1 minute" [home.review.row]. Review asks one reading and one meaning item for the Sh'ma among the other due cards.
- **Quick ten** stays closed: it opens after three prayers with a Read step are done [qt.empty]. Once open, the Sh'ma's words (except the divine name) are among its items.
- **The tutor** sees one practice day, the day Maya opened the lesson (option A). Under option B (only on Daniel's word, A4 Q2) the student page would also show "Sh'ma: finished" [tu.done].

## Timing

About 5 minutes: the teaching (about 100 words), a short map, two lines to read, five key words, five or six check items.
