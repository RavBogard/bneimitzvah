# Learn to lein: course, drills and activities (Cowork handoff)

2026-10-22. Claude Code wrote this for a Cowork thread.

## Daniel's request

Daniel, verbatim:
- "Let's create a handoff for cowork to do most of the learn to lein work."
- "It should also suggest best practice drills and little tests and fun activities to teach you. Eg Duolingo for learning to lein."

**Your job.** Research how people best learn to chant Torah and haftarah. Then design the course and its activities, and write the course content. Claude Code builds the screens, the audio cutting and the progress storage from what you deliver. Your deliverables are research, design and finished content, not code in the repository.

This brief stands alone. Every path is on Daniel's Windows machine. The repo checkout to read is `C:/Users/dsbog/bneimitzvah-study/` (branch `main`). Read it; don't edit it.

---

## 1. The product and where this goes

- **CRC Torah** is the leyning platform of Central Reform Congregation in St. Louis. It is moving to torah.centralreform.org and is live today at https://beitmitzvah.centralreform.org.
- **It serves:**
  - anyone at CRC who leins, or wants to learn to;
  - Beit Mitzvah students (about 12 years old) and adult students;
  - tutors;
  - Daniel, the rabbi.
- **Daniel's vision** (binding): "the way that users can lein and learn to lein at CRC, not just beit Mitzvah kids."
- **Signed-out visitors** already see this week's reading at `/read`, with:
  - Hebrew with te'amim, coloured by trope family;
  - the JPS translation;
  - human recordings with word highlighting;
  - word aids and a tikkun view.
- **Learn to lein** is one of the three doors on the new front page, next to This week and Beit Mitzvah. Today it links to the printable trope chart at `/trope-chart`.
- **Release.** Learn to lein ships in **1.5 beta**. The spec section is `docs/superpowers/specs/2026-10-22-leyning-platform-design.md` §3.5. Read it; your design replaces and extends it.

**The tradition.** The melodies are Standard Reform cantillation (Binder/Avery), as sung by the PocketTorah reader. Pronunciation is modern Israeli. There are separate Torah and haftarah melodies. High Holy Day trope, Megillot and blessings are out of scope (release 2.5).

---

## 2. Rulings you must design within (binding)

| Area | Ruling |
|---|---|
| Lesson text | **Claude writes it and it goes live at once**, editable later (Daniel, 2026-10-22). You are that author. Write final copy, not placeholders. |
| Audio | **Human recordings only.** PocketTorah clips are cut by word timings. Generated chant does not exist for learners; it is a later track behind a listening gate, so design nothing that needs it now. Optionally mark where it would help later. |
| Who | Everyone can use the course **signed out**. Signed-in people (Beit Mitzvah families now, approved members from 1.4) can have saved progress. Signed-out progress may live only in the browser. |
| Tone | Daniel's quality bar (PRODUCT.md): **"useful, intuitive and beautiful. Fun to use. Never cringe or boring or complicated."** His references: **Duolingo-style warmth** (encouraging, one clear next step, a little celebration) plus **Apple-native calm**. |
| Banned (current binding rule) | **No mascots, confetti, streaks, badges, emoji, exclamation points, pep-talk copy, slang or youth-group voice.** Warmth comes from colour, type, scale and **one quiet celebration moment**. Copy stays adult-respectful, because adults use the same screens. |
| Shown text | **No visible transliteration** of Hebrew text. Trope *names* such as "etnachta" may appear as labels. Apparatus stays outside the Hebrew line. Trope families need a **non-colour identifier** as well as their colour. |
| Learner surfaces | No technical status or provenance on the page. Credits sit in an "About" place. |
| Not for the bimah | Everything serves weekday preparation. |
| Spend and contact | No spend. No contact with anyone. Publish nothing. |

**Duolingo vs the ban.** Daniel asked for "Duolingo for learning to lein", and the tone rule bans streaks and badges. Don't quietly break the rule, and don't drop the request. Design the warmth first: bite-sized lessons, one clear next step, immediate feedback, gentle review, a visible path, one quiet celebration. Then list any mechanic you think is worth the rule change (for example, a streak or a daily goal) in `QUESTIONS-FOR-DANIEL.md`, with one line each and your recommendation. He decides.

---

## 3. What already exists that you can build on

All paths are under `C:/Users/dsbog/bneimitzvah-study/`.

**Trope families (11, in chart order).** Defined in `src/lib/trope/chart-catalog.ts` lines 5–17, with ids and colours:

| Id | Name | Colour |
|---|---|---|
| `zakef` | zakef | `#fff176` |
| `etnachta` | etnachta | `#9ec5ff` |
| `sof-pasuk` | sof pasuk | `#f59a9a` |
| `revia` | revia | `#ffc078` |
| `tevir` | tevir | `#9be29b` |
| `segol` | segol | `#eaa0ea` |
| `azla` | "kadma v'azla" | `#ffd2d2` |
| `telisha-ketana` | telisha ketana | `#ffb3c6` |
| `pazer` | pazer | `#d3c1ff` |
| `zakef-gadol` | zakef gadol | `#ffd9a3` |
| `sof-haftarah` | "end of the haftarah" | `#66c2c2` |

`CHART_ACCENTS` (lines 20–51) maps each accent to its family.

- **How a phrase forms.** A phrase ends at the word that carries a family's closing accent. Tipcha, pashta, yetiv and zarka join the following phrase. The last word of a verse is sof pasuk, or sof haftarah on the last haftarah verse.
- **Engine copy:** `trope/lib-trope.cjs` (`TROPE_FAMILIES`, `tropePhrases`, `tropeFamiliesUsed`).

**The trope chart** (`src/app/trope-chart/page.tsx`):
- It shows each family with its accents, drawn on a sample letter, plus the unfamilied signs: tipcha, pashta, yetiv, zarka, the conjunctives, ole and dehi.
- It has no play buttons yet.

**Melody tables:**
- `trope/cells/torah.json`: 62 cells over 26 trope ids.
- `trope/cells/haftarah.json`: 55 cells.

Each cell is `{id, trope, context, upbeats, core, source, variants}`, with notes in scale degrees. The permissions are in `trope/cells/README.md`. These say what each trope's melody *is* in context, which is useful for writing "listen for" lines.

**Trope per word:**
- `verseUnits(html, {final})` in `trope/text.mjs` line 433 gives one unit per maqaf chain, carrying `trope: {family, phrase, pos, of, accent}`.
- `unitTrope(unit)` in `trope/melody.mjs` line 35 gives the per-word trope id.
- The app's `colorStudyVerse` in `src/lib/hebrew/study-annotations.ts` line 15 returns `words[{index, family, phrase}]`.

**Recordings and word timings.**
- **Coverage.** About 7,036 verses are playable and word-ready: Torah 99.4%, haftarot about 72%. The 18 special-Shabbat and festival haftarot are text-only.
- **Timings.** Each verse has word `starts[]` (and usually `ends[]`) in seconds. The app can cut any word range from a verse with 5 ms fades (`src/lib/reference-audio/short-playback.ts`, `shortWordWav`). **So any phrase on any word-ready verse can be a playable example.**
- **Public route.** It looks up by Shabbat date, not by verse: `/api/public/reference/short?date=<Saturday>&kind=torah|haftarah&offset=<n>` (no sign-in).
- **Private index.** A derived index lives at `C:/private/pockettorah/verse-index-v2.json`. You may read it to check which refs are word-ready. Never copy it anywhere.

**This week's reading:**
- `thisShabbat()` in `src/lib/readings/public-shabbat.ts`.
- `GET https://beitmitzvah.centralreform.org/api/public/reading?date=<Saturday>` returns the week's Torah and haftarah ranges.
- CRC reads the standard Hebcal reading (full parashah).

**Progress.** No trope progress is stored yet. The nearest shape is per-item read state (`study_theme_read`). Claude Code adds what your design needs.

**Background reading.** The trope engine research has useful pedagogy and grammar:
- `docs/superpowers/research/2026-10-15-trope-engine/trope-grammar.md`
- `docs/superpowers/research/2026-10-15-trope-engine/torah-grammar.md`
- `docs/superpowers/research/2026-10-15-trope-engine/nusach-tables.md`

Also read `DESIGN.md` (the "Song session" visual world) and `PRODUCT.md`.

**Texts.** Use your Sefaria connector for Hebrew. The MAM edition, "Miqra according to the Masorah", is CC BY-SA and is what the site uses. **Never put JPS (or any other licensed translation) text in your files.** The site fetches translations itself at runtime.

---

## 4. The research (part A)

Be wide-ranging and practical. Cite sources and mark each claim: primary/verified, secondary, or your inference.

1. **How cantors and tutors actually teach trope.** Look at the standard teaching sequences:
   - Binder;
   - Jacobson, *Chanting the Hebrew Bible*;
   - Portnoy and Wolff;
   - Rosowsky;
   - Neeman.

   Also cover:
   - the **trope song** (singing the sequence of trope names: zarka segol munach revi'i…);
   - teaching by family versus by individual mark;
   - which families to teach first and why;
   - how Torah and haftarah melodies are taught relative to each other;
   - common beginner errors, and how teachers catch them.
2. **Learning science that fits:**
   - retrieval practice;
   - spaced repetition, and the schedules that work for audio and melody;
   - interleaving;
   - chunking;
   - immediate feedback;
   - dual coding (colour, shape, sound);
   - ear-training research (melodic recognition before production);
   - how long micro-lessons should be.
3. **Apps to learn from:**
   - Duolingo (path, lesson length, review, the celebration moment);
   - ear trainers such as EarMaster, Tenuto, Functional Ear Trainer and Perfect Ear;
   - Hebrew-reading and Torah apps (PocketTorah, Trope Trainer, LainingLab, Bar Mitzvah apps, Aleph Champ-style decoding);
   - language-tone trainers, which are a close analogy for melodic contour.

   What makes them sticky without being cheesy? What would clash with Daniel's tone rules?
4. **Singing back (production).** Is there a cheap, honest way for a learner to check their own chant, in-browser and with no new paid service? One example: record, then compare a pitch contour against the recording's contour. Assess feasibility and risk, given that a child's voice could be recorded. Recommend whether to include it, how, and what it would need to be safe. Daniel dropped student recordings from 1.5, so anything that records needs his yes. Put it in the questions file.

---

## 5. The design (part B)

**`ACTIVITIES.md`: a catalogue of drills, little tests and activities.** For each one, give:
- name;
- what the learner does, in one or two lines;
- what it teaches;
- feedback and how mistakes are handled;
- the data it needs (word timings, families, trope ids, melody cells or this week's reading), and whether that data exists today (section 3);
- phone fit (360 px, one thumb);
- signed out or signed in;
- build size (S, M or L);
- a one-line "why it's fun, not cheesy".

Rank them. Mark a **v1 set** of 5–8 activities that ships in 1.5, and a "later" list. Ideas to consider, not a requirement:
- **hear and name** the family;
- **see and hear**: tap the phrase that you just heard;
- **odd one out**;
- **spot the family in this week's reading**;
- **build the phrase**: order the accents;
- **trope song** call-and-response;
- **same or different**: two phrases;
- **where does the phrase end?**;
- **fill the gap**: hear the verse with one word silent and choose its trope;
- **speed rounds** (calm, untimed by default);
- **lein one verse**: a guided first verse using the existing Lein view;
- **review queue**: spaced items that come back.

**`COURSE.md`: the course map.**
- Units and lessons, in teaching order. Say why this order rather than chart order.
- Torah first, then haftarah, or interleaved. Recommend one.
- Prerequisites.
- How "in this week's reading" ties each family to the current Shabbat.
- What "done" means for a lesson and for the course.
- The **one quiet celebration moment**: when it happens and what it looks like, in words.
- Rough lesson length: target 3–5 minutes on a phone.
- The review model: what comes back, and when.
- The hand-off to "Your first verse" in Lein.

**Screen sketches.** For the course home, one lesson, three activity types and the end of a lesson: give ASCII wireframes at phone width plus one line of intent each. Stay inside DESIGN.md ("Song session"): flat inks, lake blue shell, marigold progress, one sans, and the Hebrew always the most important text. Claude Code will do the visual design, so keep these structural.

---

## 6. The content (part C)

**`lessons.json`: the finished course.** Write it to this schema, and propose additions if you need them. Use plain text only, with no markdown inside strings.

```json
{
  "schema": "learn-to-lein-course/v1",
  "melodies": ["torah", "haftarah"],
  "units": [
    { "id": "u1-first-phrases", "title": "…", "summary": "one sentence", "lessons": ["torah-sof-pasuk", "…"] }
  ],
  "lessons": [
    {
      "id": "torah-sof-pasuk",
      "melody": "torah",
      "family": "sof-pasuk",
      "accents": ["merkha", "tipcha", "silluq"],
      "title": "…",
      "goal": "One sentence: after this you can …",
      "body": ["Short paragraph.", "Short paragraph."],
      "listenFor": "One sentence describing the melodic shape in plain words.",
      "examples": [
        { "ref": "Genesis 1:1", "words": [3, 6], "firstWord": "אֵת", "lastWord": "הָאָרֶץ", "why": "short note" }
      ],
      "activities": [ { "type": "hear-and-name", "params": { "families": ["sof-pasuk", "etnachta"], "items": 8 } } ],
      "prerequisites": []
    }
  ]
}
```

**Content rules:**
- **`body`** is at most about 120 words a lesson. Use plain verbs, sentence case and no exclamation points. Say what to listen for and how it fits the phrase. No history lecture unless it helps the ear.
- **`examples`:** give 3–6 per lesson.
  - Choose **word-ready PocketTorah verses**, checked against the private index if you can.
  - Prefer short, clear, common verses, and spread them across books.
  - `words` is `[first, last]`. Indices are **zero-based over the verse's space-separated words as Sefaria's MAM text shows them, with maqaf-joined words counted as one**. Also give `firstWord` and `lastWord` as they appear, so Claude Code can verify each range against the engine and correct off-by-ones.
  - If you can't compute indices reliably, give the words and leave `words` as `null`.
- **Haftarah lessons:** cover what differs from Torah; don't repeat everything.
- **Activity params:** use types from your `ACTIVITIES.md`. Describe item generation as rules (which families, how many, distractor choice) rather than hand-written items, unless hand-picking matters, as with the trope song.
- **Short lines for the shared surfaces:**
  - the front door's Learn to lein card: a title and one line;
  - the course home intro: two lines at most;
  - empty, done and "come back tomorrow" states, if your review model has them.

  Put these in `COPY.md`.

---

## 7. Deliverables

Write everything to **`C:/Users/dsbog/learn-to-lein/`**. It is outside every repository; create it.

| File | What it holds |
|---|---|
| `REPORT.md` | Part A research and your recommendations, with one page of conclusions first |
| `ACTIVITIES.md` | The ranked catalogue and the v1 set |
| `COURSE.md` | The course map, review model and screen sketches |
| `lessons.json` | The finished course content (part C) |
| `COPY.md` | The shared-surface copy |
| `SOURCES.md` | Every source, with date and confidence |
| `QUESTIONS-FOR-DANIEL.md` | Only real decisions, as a table at the top, one line each, each with your recommendation: any banned mechanic you'd add, singing back with recording, anything that needs spend |
| `HANDOFF-TO-CLAUDE-CODE.md` | What to build first, the data each activity needs, anything you couldn't verify, and the checks Claude Code must run (index ranges, word-ready refs, family ids) |

Claude Code reads these and commits the shareable parts to the repo.
- Your files must not contain any JPS or licensed translation text, people data, or audio.
- Hebrew quoted from MAM is fine.

---

## 8. How to judge your own work

- **Daniel's bar.** A 12-year-old and a 60-year-old both find it fun, and neither finds it cringe. An adult with no trope finishes the course and leins one verse of this week's reading.
- **Every activity can be built from data that exists**, or names exactly what is missing.
- **Every example plays.** It is a word-ready PocketTorah verse with a correct word range.
- **The tone holds:** no banned mechanic anywhere except as a question for Daniel.
- **Daniel's own time** is at most a 15-minute read of `QUESTIONS-FOR-DANIEL.md`. Everything else should be decided by you or by Claude Code.

---

## Kickoff prompt (for Daniel to paste into Cowork)

> Read `C:/Users/dsbog/bneimitzvah-study/docs/planning/2026-10-22-learn-to-lein/COWORK-HANDOFF.md` and do everything it asks: the research, the activity catalogue, the course map and the finished lesson content. Write all the deliverables to `C:/Users/dsbog/learn-to-lein/`. Don't edit the repo, don't spend money, and don't contact anyone. Put only real decisions for me in `QUESTIONS-FOR-DANIEL.md`.
