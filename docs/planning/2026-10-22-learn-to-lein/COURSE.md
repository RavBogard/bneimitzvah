# Learn to lein: the course map

2026-10-23. For Daniel and for Claude Code. The lesson content itself is in lessons.json; the drills are in ACTIVITIES.md; the research behind the choices is in REPORT.md.

## In one paragraph

A short path of 3 to 5 minute lessons that takes someone with no trope from "what is a phrase" to chanting one verse of this week's Torah reading, then does the same for the haftarah tune. One lesson per trope family. Every example is a real phrase cut from a PocketTorah recording. Every screen after the first listen is a small question. There is no score, no streak and no badge; what the learner sees is a path, the families they can now hear, one clear next step, and one quiet moment at the end when their verse lights up and they can lein it.

## The map

Teaching order, not chart order. Why: every curriculum surveyed (Reform, Conservative, JTS, Hebrew College, the UK Learn to Leyn course) opens with the two verse endings, sof pasuk and etnachta, then zakef, because those three phrases are in nearly every verse and the endings anchor the key of everything else. Revia and tevir are common and distinct, so they come next. The rarer phrases follow, and the end-of-reading cadence last. The chart's order (zakef, etnachta, sof pasuk, …) is a display order; the chart stays as the reference page.

| Unit | Lessons (lesson ids in lessons.json) | What it gives you |
|---|---|---|
| 0. How a verse is built | `intro-phrases` | Phrases, marks, colours, the two halves of a verse |
| 1. The two endings | `torah-sof-pasuk`, `torah-etnachta` | You can hear where every verse rests and where it ends |
| 2. Inside the verse | `torah-zakef`, `torah-revia`, `torah-tevir` | The three phrases that fill most verses |
| 3. The rarer phrases | `torah-azla`, `torah-segol`, `torah-telisha-ketana`, `torah-pazer`, `torah-zakef-gadol` | Everything else the Torah tune uses |
| 4. Your first verse | `torah-first-verse` | Lein one verse of this week's reading |
| 5. Haftarah: the same phrases, a new tune | `haftarah-sof-pasuk`, `haftarah-etnachta`, `haftarah-zakef`, `haftarah-revia`, `haftarah-tevir` | The common families in the haftarah melody |
| 6. Haftarah: the rarer phrases | `haftarah-azla`, `haftarah-segol`, `haftarah-telisha-ketana`, `haftarah-pazer`, `haftarah-zakef-gadol`, `haftarah-sof-haftarah` | Everything else, and the ending of the whole haftarah |
| 7. Your first haftarah verse | `haftarah-first-verse` | Lein one verse of this week's haftarah |

Twenty-four lessons. An adult who does one a day reaches their first Torah verse in two weeks and finishes the whole course in about a month; nothing in the app says so, because only Daniel worries about dates.

Where the unfamilied signs live: geresh, gershayim, telisha gedola and karnei farah have no family of their own in the chart catalogue. The course puts geresh and gershayim inside the kadma v'azla lesson (the catalogue maps them to `azla`) and telisha gedola and karnei farah inside the pazer lesson (mapped to `pazer`), and says so in those lessons' text. Tipcha, pashta, yetiv and zarka are taught inside the phrase they lead into, as the engine groups them. The conjunctives (munach, mercha, mahpach, darga, kadma) are taught as the words that lead into each family, never as lessons of their own.

### Torah first, then haftarah

Recommendation: Torah first. The Reform handbooks found make Torah the main task; every curriculum found teaches Torah first; and the Torah tune's two endings (major, resting on the second degree, ending low) are the easiest cadences to hear. The haftarah path is the same families retuned, so its lessons are shorter and say only what differs.

The rest of the Torah path is not required first. A learner whose own assignment is a haftarah can start the haftarah path once How a verse is built and The two endings are done (three short lessons; the idea of a phrase and its ending carries over). The course home shows both paths; the haftarah path says "Best after The two endings" until then.

### Prerequisites

- Within a path, lessons unlock in order. Unit 0 before unit 1, and so on. Inside a unit the order is as listed.
- `haftarah-sof-pasuk` requires `torah-sof-pasuk` and `torah-etnachta`. Nothing else crosses between paths.
- Lessons are never relocked. A learner can reopen any finished lesson from the path.
- A tutor or Daniel can send someone straight to a lesson by link; the lesson opens, and the path shows the earlier ones as not yet done.

### In this week's reading

Each family lesson ends with "In this week's reading": the places where the family occurs in this Shabbat's Torah and haftarah, drawn live from `thisShabbat()` and `/api/public/reading?date=`, each playable. The learner finds three more themselves (ACTIVITIES.md, activity 6). When the haftarah is one of the 18 text-only ones, the row says "No recording for this haftarah yet" and the Torah rows stand alone. On a festival or a week with no reading, the section shows the coming Shabbat.

The first-verse lessons choose their verse from this week's reading too, so the course's last step is always something that will be read this week.

### What "done" means

- A drill run is done when every item has been answered right once (missed items come back at the end of the run).
- A lesson is done when its listening screens have been seen and every drill run in it is done. Nothing is scored; there is no pass mark.
- A family is "heard" (the word the path uses) when its lesson is done. The course home lists families as "Can hear: 6 of 10".
- The Torah path is done when `torah-first-verse` is done. The same for the haftarah path. The course is done when both paths are done; the course home then says "Done. Review when you like." and the review line stays.
- Signed out, done-ness lives in the browser; signing in later keeps it only if Claude Code chooses to migrate localStorage on first sign-in (recommended, it is cheap).

### Lesson length

Target 3 to 5 minutes on a phone. A family lesson is: hear it (30 s), hear it in verses (60 s), two or three short drills (2 to 3 min), done (10 s). The item counts in lessons.json are the plan; a lesson's drills may stop early once eight items in a row have been answered right with no miss, and a learner who misses stays for the re-asks, which is the point.

### The review model

- Cards. One card per family per melody per skill. Three skills: name it from sound (hear-and-name and same-or-different), find it in a verse (tap-the-phrase), and where it ends (where-does-it-end). So up to 11 × 2 × 3 cards; signed-out learners get the same.
- Boxes and gaps. A modified Leitner scheme (REPORT.md A2): box 0 asks again in the same session; then 1, 3, 7, 16 and 35 days. A right answer moves the card up one box. A wrong answer drops it two boxes and re-asks it in the current run. Nothing is asked twice in a row.
- When a lesson is done, its new cards enter box 1 (due tomorrow). The course home shows "Review: n phrases, about m minutes" when any card is due, and nothing when none is. The learner can also open review from the path any time; off-schedule reviews count.
- A review run is 8 to 12 items mixed across the due cards, confusable families placed back to back, never two items from the same verse.
- A known date. If the learner has an assigned reading with a date (signed in, Beit Mitzvah), gaps are capped so the last review lands within the final 10 to 20 percent of the time left; past the date the normal gaps resume.
- No notifications. Notifications stay off until Daniel says. The review line on the course home is the only reminder.
- No "come back tomorrow" state. When nothing is due the home simply shows the next lesson. The one empty state is "Nothing to review yet", before any lesson is done.

### The one quiet celebration moment

It happens once per path, at the end of `torah-first-verse` and again at the end of `haftarah-first-verse`, after the learner has chanted along with the recording at full speed.

What it looks like: the screen goes to the lake sheet (the same sheet as the lifted line). The learner's verse sits centred at the lifted size. The recording plays once more, and as it plays the phrase colours wipe in word by word with the ink pull, the only authored motion the app has, so this is reuse, not a second motion. When the last word colours, one line appears under the verse in the UI face: "You can lein this verse." Below it, the reference ("Genesis 12:1") and two plain actions: "Open in Lein" and "Back to the path". Nothing moves after that. No sound effect, no confetti, no count. Reduced motion: the colours appear at once with the first word.

Everywhere else, a lesson ends on a plain summary screen (sketch below) and a family card on the path simply fills with its colour.

### The hand-off to "Your first verse" in Lein

`torah-first-verse` and `haftarah-first-verse` end with "Open in Lein", which opens `/read` on this week's reading with the chosen verse selected, so the inline player's Repeat and Speed are already there. Claude Code needs a verse-selecting deep link into `/read` (for example `/read?date=<Saturday>&kind=torah&verse=<ref>`), nothing else. If the learner has a saved reading (signed in), the lesson offers that reading instead of this week's.

## Families: colour plus a mark that is not colour

Every family carries three identifiers everywhere in the course: its name (as the chart spells it: "sof pasuk", "etnachta", "zakef", "revia", "tevir", "segol", "kadma v'azla", "telisha ketana", "pazer", "zakef gadol", "end of the haftarah"), its chart colour, and a contour mark: a small line drawing of the family's closing melody, drawn as a polyline from the closing cell's core degrees in the current melody table (`trope/cells/torah.json` or `haftarah.json`). So sof pasuk's Torah mark is a drop to a low rest, etnachta's is a rise to a held note, zakef's a peak, revia's a staircase down, pazer's a tall arch. The haftarah marks are drawn from the haftarah table, so they differ, which is itself a lesson. The contour mark sits inside the family chip next to the name, in Ink, never in colour alone. The research says a contour cue in sync with the sound helps learners more than colour does (REPORT.md A2, Wei et al. 2022), so the mark can also animate along the phrase during "Hear it", with reduced motion showing it static.

## Screen sketches (360 px, structural only)

Everything sits inside DESIGN.md's Song session world: lake-blue app bar and primary buttons, lake canvas, white cards with hairlines, marigold only as a fill or ring, one sans (Bricolage) for UI, Noto Serif Hebrew for every Hebrew word, and the Hebrew always the largest and most important text on the screen. Claude Code owns the visual design; these show structure.

### Course home

```
┌──────────────────────────────────────┐
│ ◀  Learn to lein                     │  app bar (lake)
├──────────────────────────────────────┤
│  Hear the phrases, then lein a verse │  intro, 2 lines max (COPY.md)
│  of this week's reading.             │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Next                           │  │  white card, the one clear next step
│  │ Etnachta                       │  │  title
│  │ Where the verse rests          │  │  one line
│  │ [ Start ]  about 4 minutes     │  │  lake button 56 px
│  └────────────────────────────────┘  │
│                                      │
│  Review: 3 phrases, about 1 minute   │  only when due; plain link row
│                                      │
│  Torah                               │  path heading
│  ● How a verse is built              │  done: filled lake dot
│  ● Sof pasuk                         │
│  ○ Etnachta            ← next        │  next: marigold ring
│  ○ Zakef                             │  later: hairline dot
│  ○ Revia                             │
│  …                                   │
│  ○ Your first verse                  │
│                                      │
│  Haftarah  · best after The two endings
│  ○ Sof pasuk                         │
│  …                                   │
│                                      │
│  Can hear: 2 of 10 Torah phrases     │  the only progress line
│  Trope chart ›   About ›             │
└──────────────────────────────────────┘
```
Intent: one next step above the fold; the path below it is a list, not a map with islands; progress is a sentence.

### One lesson (the "Hear it" screen)

```
┌──────────────────────────────────────┐
│ ✕   Etnachta            ▪▪▪▫▫▫▫      │  close, title, 7-segment rail (marigold current)
├──────────────────────────────────────┤
│ ┌ etnachta  ⌒‾ ┐                      │  family chip: name + contour mark, family colour
│                                      │
│      בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים        │  the phrase, Hebrew Large, phrase colour behind
│                                      │
│  ▶  Hear it                          │  play tile, 56 px, replays on tap
│                                      │
│  Before the pause the tune steps     │  listenFor, one sentence
│  down, then rises and rests in the   │
│  middle of the verse.                │
│                                      │
│  Marks:  ֖ tipcha   ֣ munach   ֑ etnachta │  marks on sample letters, as the chart draws them
│                                      │
│  Genesis 1:1                         │  reference, muted
│                                      │
│ [            Next            ]       │  lake, full width
└──────────────────────────────────────┘
```
Intent: the Hebrew phrase is the biggest thing; one sentence says what to listen for; the marks sit under the Hebrew line, never inside it.

### Activity: Hear and name

```
┌──────────────────────────────────────┐
│ ✕   Etnachta            ▪▪▪▪▫▫▫      │
├──────────────────────────────────────┤
│  Which phrase is this?               │
│                                      │
│  ▶  (plays on open; tap to repeat)   │  56 px tile
│                                      │
│  ┌──────────────────────────────┐    │
│  │ ⌒‾  etnachta                 │    │  chip 56 px: contour mark + name
│  └──────────────────────────────┘    │
│  ┌──────────────────────────────┐    │
│  │ ↘_  sof pasuk                │    │
│  └──────────────────────────────┘    │
│                                      │
│  (after answer:)                     │
│      וְעָ֥שׂוּ לִ֖י מִקְדָּ֑שׁ   ← coloured │  the phrase shown in its verse
│  Exodus 25:8   ▶ whole verse         │
│                                      │
│ [            Next            ]       │
└──────────────────────────────────────┘
```
Intent: two to four big chips, nothing else to read until after the answer; the reward is the phrase arriving in colour.

### Activity: Tap the phrase you heard

```
┌──────────────────────────────────────┐
│ ✕   Zakef               ▪▪▪▪▪▫▫      │
├──────────────────────────────────────┤
│  ▶  Hear a phrase, then tap it       │
│                                      │
│    וַיֹּ֤אמֶר יְהֹוָה֙ אֶל־אַבְרָ֔ם   לֶךְ־לְךָ֛    │  whole verse, Hebrew Standard,
│    מֵאַרְצְךָ֥ וּמִמּֽוֹלַדְתְּךָ֖ וּמִבֵּ֣ית אָבִ֑יךָ  │  small gaps at phrase boundaries,
│    אֶל־הָאָ֖רֶץ אֲשֶׁ֥ר אַרְאֶֽךָּ׃            │  uncoloured until answered
│                                      │
│  Genesis 12:1                        │
│                                      │
│  (after answer: tapped phrase takes  │
│   its colour; legend chip appears)   │
│  ┌ zakef  ⌃ ┐                        │
│                                      │
│ [            Next            ]       │
└──────────────────────────────────────┘
```
Intent: the verse is the screen; tap targets are whole phrases; the play tile sits above so the thumb never hides the words.

### Activity: Build the phrase

```
┌──────────────────────────────────────┐
│ ✕   Sof pasuk           ▪▪▪▪▪▪▫      │
├──────────────────────────────────────┤
│  ▶  Hear it, then build it           │
│                                      │
│   ┌────┐ ┌────┐ ┌────┐               │  slots, right to left (Hebrew order)
│   │    │ │    │ │    │               │
│   └────┘ └────┘ └────┘               │
│                                      │
│   ┌ בָֽ׃ ┐ ┌ בָ֖ ┐ ┌ בָ֥ ┐ ┌ בָ֣ ┐        │  tray: marks on the chart's sample letter,
│   silluq  tipcha  mercha  munach     │  56 px tiles, one that does not belong
│                                      │
│  (each placed mark plays its word)   │
│                                      │
│ [            Next            ]       │
└──────────────────────────────────────┘
```
Intent: the only hands-on drill; the row plays itself as it grows.

### End of a lesson

```
┌──────────────────────────────────────┐
│     Etnachta                         │
│     Done                             │  title size, plain
│                                      │
│  You can hear etnachta: the rest in  │  one or two sentences from the lesson's goal
│  the middle of the verse.            │
│                                      │
│  In this week's reading              │  section
│    בְּרָחֵ֖ל שֶׁ֣בַע שָׁנִ֑ים     ▶       │  rows: phrase in colour + play
│    Genesis 29:20                     │
│    …  (3 rows)                       │
│  Find three more ›                   │  opens the small reader (activity 6)
│                                      │
│  Next: Zakef                         │
│ [         Start next lesson        ] │  lake
│  Back to the path                    │  text link
└──────────────────────────────────────┘
```
Intent: no fanfare; the summary is a fact about what you can now hear, then this week's reading, then the next step.
