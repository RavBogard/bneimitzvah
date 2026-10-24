# A4. The service course: design (CRC Torah 2.0)

2026-10-24. Design only; no code. Claude Code builds from this file, `A7-STRINGS.md` (every string) and `A8-SAMPLE-LESSON.md` (one lesson on paper).

App paths are relative to `C:/Users/dsbog/bneimitzvah-study/` (main at `cfba020`, read only; see STATUS.md). Line numbers are from that checkout. Anything not read in code or ruled by Daniel is marked **[Inferred]**.

## 0. What is already decided (do not reopen)

| Decision | Source |
|---|---|
| The course is open to everyone, signed in or not | QUESTIONS-2.0.md Batch 1 Q2, "open" |
| Licensed Beit Mitzvah text is never shown; the course links to the siddur page instead | Batch 1 Q2; A6-TEXT-LICENSING.md |
| Public Shabbat Morning volume text is shown where it matches; transliteration on request | A6; Batch 2 Q8, "On request" |
| Shabbat morning first (BM pp. 1–31), then Saturday evening with Havdalah (pp. 33–63) | Batch 1 Q3, "Go" |
| One approved teaching per prayer, credited "Rabbi Daniel Bogard" | Batch 2 Q9; A3-VOICE-MODEL.md rule 16 |
| No melody audio and no "Hear it" step in 2.0; recordings come in 2.1 | Batch 2 Q6 ("I'll handle the readings here as a part of two point one") |
| A short reading-fluency strand for prayer Hebrew | Batch 2 Q7, "Yes, a short strand" |
| Choreography lives in the teachings' "Some of us…" lines; no separate activity | Batch 2 Q10 note |
| No recordings of learners; no generated audio | COWORK-HANDOFF-2.0.md §2 Audio |
| Tone: sentence case, plain verbs, adult-respecting; no "!", emoji, streaks, badges, scores, pep talk | §2 Tone; `src/lib/learn/tone.ts:1-20` |
| The learner's own assigned parts are their personal path | Brief A4 |
| Offline under the 14-day rule | `src/lib/offline/policy.ts:19-20` |
| A second congregation later: design per-tenant volume and teaching, build nothing for it | §2 Second congregation |

## 1. The course in one paragraph

A new course beside Learn to lein, at `/learn/service` [Inferred route]. Each prayer is one lesson with up to six steps: **About this prayer** (Daniel's approved teaching), **Where it is in the service** (a map of the service), **Read it** (the public volume's Hebrew, line by line, transliteration and English on request, words tappable), **Key words** (three to six words with plain meanings), **Check** (a few reading and meaning questions, never scored), and **Done** (with "Open in the siddur, page {page}"). A six-lesson **Reading Hebrew** strand teaches letters, vowels, dots, words and lines, and gates nothing. A signed-in student sees **Your parts** first: their assigned parts, in service order. Progress works like Learn to lein's: in the browser signed out, on the account signed in, owner-only. A reading-only **Quick ten** and a **Review** carry words forward. A tutor sees the days a student practised, and nothing finer unless Daniel chooses otherwise (§9, Q2).

## 2. Units and order

Order follows the brief's recommendation: what a Beit Mitzvah student leads first, then the morning service in order, then (phase 2) Saturday evening and Havdalah. "Reading Hebrew" sits at the top of the list but is optional.

| Unit | Title (A7) | BM printed pages | Lessons | Phase |
|---|---|---|---|---|
| U0 | Reading Hebrew | — | f1–f6 (6) | 2.0 |
| U1 | The parts every student leads | 10, 11, 22, 23–24 | shma, vahavta, torah-before, torah-after, haftarah-before, haftarah-after (6) | 2.0 |
| U2 | Morning blessings | 2–6 | modeh-ani, tallit, mah-tovu, hineih-mah-tov, birchot-hashachar, psukei-dzimrah, chatzi-kaddish (7) | 2.0 |
| U3 | The Sh'ma and its blessings | 7–12 | barchu, yotzeir-or, ahavah-rabbah, mi-chamochah (4; the map shows Sh'ma and V'ahavta in place, linking to U1) | 2.0 |
| U4 | The Amidah | 13–20 | tfilah, avot-vimahot, gvurot, kdushah, vshamru, avodah, hodaah, sim-shalom, oseh-shalom (9) | 2.0 |
| U5 | The Torah service | 21–25 | torah-service, torah-reading, mi-shebeirach, haftarah-reading, commentary, eitz-chayim (6; the four blessings sit in U1 and appear in this unit's map) | 2.0 |
| U6 | Closing the service | 26–31 | aleinu, mourners-kaddish, adon-olam, parents-blessing, closing-blessing (5) | 2.0 |
| U7 | Saturday evening: the Sh'ma and its blessings | 37, 38, 42, 50 | maariv-aravim, ahavat-olam, hashkiveinu, shalom-rav (4) | 2.0 phase 2 |
| U8 | Havdalah | 60–62 | yayin, bsamim, eish, havdalah, eliyahu, miryam, shavua-tov (7) | 2.0 phase 2 |

**54 lessons** in all (6 fluency, 37 morning, 11 evening). Every morning prayer lesson has an approved teaching in `A3-DRAFTS/` (01–38, less 28 V'zot HaTorah, which is not in the BM book: A2 row SH48). Evening lessons use the approved evening file `A3-DRAFTS/evening-33-63.md`.

**Evening reuse.** The evening service repeats most morning prayers (A2 rows BM44–BM76, BM84–85). They are **the same lessons**: one lesson per prayer, with a morning page and an evening page in the tenant file. A student whose service slot is `havdalah` (`src/server/db/migrations/0013_student_service_slot.sql:1-2`) sees evening pages. Where the evening teaching differs from the morning one (the evening file edits several reused texts, e.g. "morning" to "[service]" in the Torah-service teaching, evening-33-63.md:131), the tenant file holds both versions and the lesson shows the one for the learner's slot (signed out: morning). [Inferred]

**Front matter** (Welcome, An explanation of our siddur: BM1–2, BM42–43) is not a lesson. It is not prayer, and the teaching it would carry is the course's About page. [Inferred]

### 2.1 Lesson table (the build's content map)

`kind`: **prayer** has all steps; **moment** (no Hebrew prayer text in the BM book) has About, Where and Done only. "Public unit" is the `shabbat-shacharit` feed unit the Read step shows (A2 section C); "none" means the Read step shows the siddur link only. "Card" is the word-card source (§7). BM base ids for the six default parts are from `src/server/service-learning/feed.ts:313-314`; the rest are matched at build time against the live feed by printed page and name [Inferred; their exact ids were not read].

| Lesson | Kind | BM base unit | Morning p. | Evening p. | Public unit (A2) | Card | Teaching |
|---|---|---|---|---|---|---|---|
| modeh-ani | prayer | (match p. 2) | 2 | — | `awakening.modeh-ani@shabbat-shacharit` | glossary | 01 |
| tallit | prayer | (match p. 2) | 2 | 34 | feed `front` block (`content/shared/tallit.typ`) [Inferred] | glossary | 02 |
| mah-tovu | prayer | (match p. 3) | 3 | — | `awakening.mah-tovu@shabbat-shacharit` | Numbers 24:5, first line only | 03 |
| hineih-mah-tov | prayer | (match p. 3) | 3 | 34 | `awakening.hineh-mah-tov@shabbat-shacharit` [Inferred match] | glossary | 04 |
| birchot-hashachar | prayer | (match p. 4) | 4 | — | `awakening.birchot-hashachar@shabbat-shacharit` | glossary | 05 |
| psukei-dzimrah | prayer | (match p. 5) | 5 | — | none (shacharit splits it, SH12–SH19) | — | 06 |
| chatzi-kaddish | prayer | (match p. 6) | 6 | 35 | `psukei.chatzi-kaddish@shabbat-shacharit` [Inferred match] | glossary | 07 |
| barchu | prayer | (match p. 7) | 7 | 36 | `shma.barchu@shabbat-shacharit` | glossary | 08 |
| yotzeir-or | prayer | (match p. 8) | 8 | — | `shma.yotzer-or@shabbat-shacharit` [Inferred match] | glossary | 09 |
| ahavah-rabbah | prayer | (match p. 9) | 9 | — | `shma.ahavah-rabbah@shabbat-shacharit` [Inferred match] | glossary | 10 |
| shma | prayer | `shma.the-shma` | 10 | 39 | `shma.the-shma@shabbat-shacharit` | Deuteronomy 6:4 | 11 |
| vahavta | prayer | `shma.vahavta` | 11 | 40 | `shma.vahavta-tzitzit@shabbat-shacharit`, first paragraph's blocks [Inferred match] | Deuteronomy 6:5–9 | 12 |
| mi-chamochah | prayer | (match p. 12) | 12 | 41 | `shma.mi-chamocha@shabbat-shacharit` [Inferred match] | Exodus 15:11 line | 13 |
| tfilah | prayer | (match p. 13) | 13 | 43 | `amidah.we-open-our-lips@shabbat-maariv` [Inferred match] | glossary | 14 |
| avot-vimahot | prayer | (match p. 14) | 14 | 44 | `amidah.avot-vimahot@shabbat-maariv` | glossary | 15 |
| gvurot | prayer | (match p. 15) | 15 | 45 | `amidah.gvurot@shabbat-maariv` | glossary | 16 |
| kdushah | prayer | (match p. 16) | 16 | 46 | `amidah.kdushah@shabbat-shacharit` | Isaiah 6:3 line | 17 |
| vshamru | prayer | (match p. 17) | 17 | 47 | `amidah.kdushat-hayom@shabbat-shacharit`, V'shamru blocks only [Inferred] | Exodus 31:16–17 | 18 |
| avodah | prayer | (match p. 18) | 18 | 48 | `amidah.avodah@shabbat-maariv` | glossary | 19 |
| hodaah | prayer | (match p. 19) | 19 | 49 | `amidah.modim@shabbat-maariv` [Inferred match] | glossary | 20 |
| sim-shalom | prayer | (match p. 20) | 20 | — | `amidah.sim-shalom@shabbat-shacharit` | glossary | 21 |
| oseh-shalom | prayer | (match p. 20) | 20 | 50 | `amidah.elohai-ntzor@shabbat-maariv` [Inferred match] | glossary | 22 |
| torah-service | moment | (match p. 21) | 21 | 51 | none (Hakafot is CRC-original, no Hebrew: A2 BM26) | — | 23 |
| torah-before | prayer | `torah.blessing-before-the-torah-reading` | 22 | 52 | `torah.blessing-before-the-torah@shabbat-shacharit` [Inferred match] | glossary | 24 |
| torah-reading | moment | (match p. 22) | 22 | 52 | none | — | 25 |
| torah-after | prayer | `torah.blessing-following-the-torah-reading` | 22 | 52 | `torah.blessing-after-the-torah@shabbat-shacharit` [Inferred match] | glossary | 26 |
| mi-shebeirach | prayer | (match p. 23) | 23 | 53 | none in 2.0: the public unit is "mixed" (licensed verses in the app build, A2 discrepancy 13) | — | 27 |
| haftarah-before | prayer | `torah.blessing-before-the-haftarah-reading` | 23 | 53 | `torah.blessing-before-the-haftarah@shabbat-shacharit` [Inferred match] | glossary | 29 |
| haftarah-reading | moment | (match p. 24) | 24 | 54 | none | — | 30 |
| haftarah-after | prayer | `torah.blessing-following-the-haftarah-reading` | 24 | 54 | `torah.blessings-after-the-haftarah@shabbat-shacharit` [Inferred match] | glossary | 31 |
| commentary | moment | (match p. 25) | 25 | 55 | none | — | 32 |
| eitz-chayim | prayer | (match p. 25) | 25 | 55 | `torah.eitz-chayim@shabbat-shacharit` | glossary | 33 |
| aleinu | prayer | (match p. 26) | 26 | 56 | `concluding.aleinu@shabbat-maariv` | glossary | 34 |
| mourners-kaddish | prayer | (match p. 28) | 28 | 58 | `concluding.mourners-kaddish@shabbat-maariv` | glossary | 35 |
| adon-olam | prayer | (match p. 30) | 30 | — | `concluding.adon-olam@shabbat-maariv` | glossary | 36 |
| parents-blessing | moment | (match p. 31) | 31 | 63 | none | — | 37 |
| closing-blessing | prayer | (match p. 31) | 31 | 63 | `concluding.birkat-kohanim@shabbat-shacharit` [Inferred match] | Numbers 6:24–26 | 38 |
| maariv-aravim | prayer | (match p. 37) | — | 37 | none (not in the public volume) | — | evening BM48 |
| ahavat-olam | prayer | (match p. 38) | — | 38 | none | — | evening BM49 |
| hashkiveinu | prayer | (match p. 42) | — | 42 | none | — | evening BM53 |
| shalom-rav | prayer | (match p. 50) | — | 50 | none | — | evening BM61 |
| yayin, bsamim, eish, havdalah | prayer | (match pp. 60–61) | — | 60, 60, 61, 61 | none | — | evening BM77–80 |
| eliyahu, miryam, shavua-tov | prayer | (match p. 62) | — | 62 | none | — | evening BM81–83 |

Three things to notice in this table:

1. **30 of the 37 morning lessons have a Read step from the public volume.** The other 7 (the five moments, P'sukei D'zimrah and Mi Shebeirach) and all 11 evening lessons do not. Without public text, a prayer lesson's Read step says "This prayer's text is in the siddur." and gives the siddur link (A7 `read.inSiddur`). Its Key words and Check steps are dropped, because both are built from the text on screen.
2. **Evening-only prayers and Havdalah have no public text at all.** A6 allows Sefaria liturgy as a fallback "only for a prayer missing from both" (A6 Decision, last bullet). Phase 2 decides that per prayer; it does not block the morning build. [Inferred]
3. **The public text and CRC's page can differ.** Every Read step carries the note "Your siddur may print this prayer a little differently. Read it there too." beside the siddur link (A6 "Things Claude Code must check" 1).

## 3. Lesson anatomy for a prayer

### 3.1 Each candidate activity from the brief, kept or dropped

| Candidate (brief A4) | Decision | Reason |
|---|---|---|
| Hear it (CRC Music link-out) | **Drop in 2.0; keep a switched-off slot for 2.1** | Batch 2 Q6: no link and no audio in 2.0; Daniel records in 2.1. The step type `hear` exists in the schema and its strings exist (A7 `au.*`), but the validator refuses any lesson that uses it while the course's `recordings` flag is false (§5.3). |
| Read the Hebrew phrase by phrase, transliteration available, not default | **Keep, as "Read it"** | Core of leading a prayer. Line by line (the public feed's blocks), not phrase by phrase: prayer text has no trope phrases, and the feed's block is the line the siddur prints [Inferred]. Transliteration is a toggle, off by default (Batch 2 Q8). |
| Meaning of key words (reuse the Study word card) | **Keep, as "Key words"** | Three to six words per prayer. Torah-verse lines open the real word card; other lines use a short glossary in the course file (§7). |
| Where it sits in the service (the arc as a map) | **Keep, as "Where it is in the service"** | Cheap (built from the course file's order), works offline, and answers the question a student actually has on the bimah: what comes before and after. |
| The choreography (what your body does) | **Drop as a step** | Ruled: it lives in the teachings' "Some of us…" lines (Batch 2 Q10). No separate screen, no instructions to stand or bow. |
| Daniel's teaching | **Keep, as "About this prayer", first** | The point of the course (MISSION E2). First, so the meaning frames the reading. Credited "Rabbi Daniel Bogard". |
| A short check of reading and meaning, never scored | **Keep, as "Check"** | Three to six items from the words on screen. Misses come back three to five items later (`src/lib/learn/run.ts:15-33`). No count of right answers anywhere. |
| "In the siddur, page {page}" (the 1.8 link) | **Keep, not as a step** | It sits on the Read step and on Done (§11), using the approved string "Open in the siddur, page {page}" (`src/components/portal/workspace/service-learning/my-service.tsx:83`). |
| Listening drills (hear-and-name, tap-the-phrase, same-or-different) | **Drop** | All need prayer audio inside the app (A1 §5 "With changes"). None exists in 2.0. |
| Trope drills (build-the-phrase, look-alikes, which-half, where-does-it-end) | **Drop** | Prayers have no trope (A1 §5 "Must NOT copy"). |

### 3.2 Step order

```
prayer, with public text:  About → Where → Read → Key words → Check → Done
prayer, no public text:    About → Where → Read (siddur link only) → Done
moment:                    About → Where → Done
fluency (U0):              Intro → drills → Done
2.1 slot (off):            About → Where → Hear → Read → Key words → Check → Done
```

- One forward action at the thumb ("Next"), the close button and the step rail, as Learn's lesson frame does (`src/components/learn/lesson.tsx:52-69`).
- Check skips itself when the loaded text yields fewer than three usable items (a word needs a transliteration that lines up with it, §8.2). Then the rail shows one step fewer. [Inferred]
- **Done** marks the lesson done when it opens, as Learn does (`lesson.tsx:186-187`). A prayer lesson whose public text fails to load shows "The prayer text did not load. Try again." and is never marked done, as Learn does for a recording (`lesson.tsx:63`). A moment lesson needs no network and can be done offline.
- Lesson length: about 3–6 minutes; the home shows "about {n} minutes" as Learn does (`src/lib/learn/course.ts:394`; `home.tsx:62`).

## 4. The reading-fluency strand (U0, "Reading Hebrew")

**What it drills.** Decoding prayer Hebrew with vowels, which is a different skill from trope (brief A4). It drills recognition only: there is no audio and nothing listens to the learner. The learner reads aloud to themselves; the app checks with choices and with transliteration shown after the attempt.

| Lesson | Drills | Text used | Item types |
|---|---|---|---|
| f1 Letters, part one | Alef to Kaf/Chaf (11 letters); look-alikes bet/kaf, dalet/reish, hei/chet/tav, vav/zayin | the alphabet table in the course file (single letters, not prayer text) | "Which letter is this?" (3 names); "These two look alike. Which one is {name}?" |
| f2 Letters, part two | Lamed to Tav (11 letters) and the five final forms | alphabet table | same, plus "This letter comes only at the end of a word…" |
| f3 Vowels | kamatz and patach (a), segol and tzere (e), chirik (i), cholam and cholam male (o), kubutz and shuruk (u), sh'va | letter plus vowel pairs generated from the table | "Which sound does this make?" (3 syllables, e.g. ba / bi / bo) |
| f4 Dots that change a letter | bet/vet, kaf/chaf, pei/fei, shin/sin, vav as a vowel | generated syllables | "With the dot or without it?"; "Is this shin or sin?" |
| f5 Reading words | words split into syllables | words from public units `shma.the-shma@shabbat-shacharit`, `shma.barchu@shabbat-shacharit` and `torah.blessing-before-the-torah@shabbat-shacharit` (the blessing formula), by block and word index, never copied into the repo | read, then "Show transliteration"; then "Which word says {translit}?" |
| f6 Reading lines | whole lines | the first line of each of those three units | read the line, reveal transliteration word by word, then "I read it" / "Not yet" (a self-check that is stored nowhere but the run), then two choice items |

- **How many lessons:** six, each about five minutes (8–14 items), so the strand is about half an hour. "Short" per Batch 2 Q7.
- **Gating: none outward.** No prayer lesson requires the strand. Inside it, f1 → f6 each require the one before, so the path reads in order (Learn's prerequisites, `src/lib/learn/progress.ts:106`). The home shows "New to Hebrew letters? Start with Reading Hebrew." until f1 is done, and the Read step of every prayer shows the same quiet link (A7 `home.fluency.row`, `read.newToHebrew`).
- **Cards:** each letter, final form and vowel becomes a review card (`letter:{id}:name`, `vowel:{id}:sound`) when its lesson is done, and moves in Review exactly as Learn's cards do (§8).
- **The alphabet table** is the only Hebrew the course file may hold: single letters, vowel marks and generated letter-vowel pairs. They are not prayer text and carry no licence (§5.3 rule 9). Letter names use the transliteration in A7 (Alef, Bet/Vet, … Tav).
- **Offline:** f1–f4 need nothing but the bundle; f5–f6 need the public-text pack (§10).

## 5. The course file and its validator

### 5.1 Why a new file

Learn to lein's validator is hard-wired to trope (A1 §6): `Melody` is only torah/haftarah and every lesson, unit and practice run must carry one (`src/lib/learn/course.ts:11-12`); `families` must be the trope chart's eleven ids (course.ts:116-123); the validator demands the lesson `haftarah-sof-pasuk` (course.ts:210-211); examples must be Bible refs (course.ts:86); and progress drops any lesson id `lessons.json` does not know (`src/lib/learn/progress.ts:46-51`). A prayer course cannot live in `lessons.json`, and its progress cannot share `learn-progress/v1`.

### 5.2 Files

| File | Holds | Never holds |
|---|---|---|
| `src/lib/service-course/course.json` (new, schema `service-course/v1`) | units, lessons, step kinds, public unit ids with block and word indices, key-word glosses (English), check settings, the alphabet table, Quick ten settings, the `recordings: false` flag | any prayer text, Hebrew or English; any licensed text; any page number (pages are per tenant) |
| `src/lib/service-course/tenants/crc.json` (new) | `tenant: "crc"`, `enabled: true`, `siddurBook: "legacy-beit-mitzvah"`, `publicVolume: "shabbat-shacharit"`, `credit: "Rabbi Daniel Bogard"`, the approved teachings verbatim (morning and evening versions where they differ, each with its approval date), per lesson the BM base unit ids and the printed pages for morning and evening, the default path (the six U1 lessons) | licensed text; student data |
| `src/lib/service-course/course.ts` (new) | `validateServiceCourse(course, tenants)`, run once at module load like `COURSE` (course.ts:379) so a bad edit fails the build, never a learner's page (course.ts:5-9) | — |

A6's never-in-repo rule is met by construction: course data files hold unit ids, page numbers and approved teaching only (A6 "Things Claude Code must check" 5).

### 5.3 Validator rules

1. Schema id `service-course/v1`; every problem collected and thrown together as one `CourseError` (import it: `src/lib/learn/course.ts:80`).
2. Lesson id `^[a-z][a-z0-9-]{1,40}$` (same rule as course.ts:127-129); at most 96 lessons.
3. Unit `{ id, title ≤60, summary ≤160, phase: "morning" | "evening", lessons[] }`; every lesson in exactly one unit.
4. Lesson `{ id, kind: "fluency" | "prayer" | "moment", title ≤60, summary ≤60, goal ≤240, section, read?, keyWords[0–6], check?, prerequisites[], hear: null }`. The goal starts "After this you can" (reuse `presentGoal`, course.ts:100, and the rule at course.ts:143-144). Prerequisites exist and form no loop (course.ts:200-209 logic).
5. `read` is `{ unit, blocks: [first, last], torahRef?: { ref, kind: "torah" | "haftarah", words: [first, last] } }`. `unit` matches `^[a-z0-9-]+\.[a-z0-9-]+@[a-z-]+$`; the suffix may be `@shabbat-shacharit` or `@shabbat-maariv` (A2 discrepancy 9: ten shacharit units carry the maariv suffix).
6. `keyWords[i]` is `{ block, word, gloss ≤60, root? ≤12 }`, indices inside `read.blocks`. A `moment` lesson has no `read`, `keyWords` or `check`.
7. **The 2.1 slot.** `hear` must be `null` while `recordings` is `false`. Turning the flag on in 2.1 makes `hear: { source }` legal; the shape of `source` is left to 2.1. [Inferred]
8. Cross-file: every `prayer` and `moment` lesson has an approved teaching in every enabled tenant file, 60–200 words [Inferred margin around the approved 80–160]; every tenant's default path names existing lessons; every lesson with a BM base unit has at least one page.
9. **No Hebrew outside the alphabet table.** Any character in U+0590–U+05FF anywhere in `course.json` except `alphabet` fails the build. This keeps prayer text, licensed or public, out of the repo mechanically.
10. The tone rule on every learner-facing string, the approved teachings included (`toneProblems`, `src/lib/learn/tone.ts:13-20`, as course.ts:213 calls it).
11. A test (not the validator, since `src/server/service-learning/feed.ts:1` is server-only) checks that each of `DEFAULT_SERVICE_PARTS` (feed.ts:313-314) maps to a lesson in the CRC tenant file.

### 5.4 Reuse versus fork, by path

**Import as is (no change to the file):**
- `src/lib/learn/tone.ts` (`toneProblems`).
- `src/lib/learn/run.ts`: `startRun`, `answerRun`, `currentItem`, `runDone` (run.ts:8-33). **Not** `LessonPace`/`pace`/`mayStopEarly` (run.ts:35-40): checks are short and need no early stop, and the field name `streak` should not spread (A1 §2).
- `src/lib/learn/progress.ts` pure helpers that know nothing of trope: `BOX_DAYS` (:12), `localDay` (:29), `addDays` (:33), `gapDays` (:71), `answerCard` (:77), `effectiveDue` (:121), `REVIEW_LIMITS` (:119).
- `src/lib/learn/pools.ts` seeded random and shuffle (pools.ts:45-60, per A1 §5).
- `presentGoal` and `CourseError` from `src/lib/learn/course.ts:80, 100`.
- `src/components/learn/word-card.tsx` `WordCardScope` and the sheet (word-card.tsx:28-40), through a small adapter (§7).
- `src/components/learn/home.tsx` `LearnAppBar` (home.tsx:12-14); `learn.module.css` classes (bar, rail, footer, path, step, dot, next, review, doneHead, doneLine, state).
- `src/lib/siddur/link.ts` `siddurPageLink` (link.ts:13-23) with the tenant's `siddurBook`. **Not** `crcSiddurPageLink` (`src/lib/siddur/pages.ts:12-14`), which hard-codes `SIDDUR_BOOK` (pages.ts:5).
- `src/components/portal/siddur-link.tsx` `SiddurLink` (siddur-link.tsx:5-7).
- The service-learning read: `createServiceLearningService(...).metadata` (`src/server/service-learning/service.ts:121-136`), for the personal path (§6.3).

**Fork (copy into `service-course/` and change):**
- `course.ts` → `src/lib/service-course/course.ts` (new validator, §5.3).
- `progress.ts` parse, serialize, merge and browser store (progress.ts:37-64, 177-206) → `src/lib/service-course/progress.ts`, because the parser checks ids against Learn's `COURSE` and `parseCardId` (progress.ts:46-56).
- `src/components/learn/progress-sync.ts` → `src/components/learn/service/progress-sync.ts`, pointed at the new routes; keep every shared-device and sign-out rule (A1 §2; plan items 26, 28, 35).
- `src/server/course-progress/{access,service,validation}.ts` and `src/server/http/course-progress.ts` → `src/server/service-course/…` and `src/server/http/service-course-progress.ts`.
- `src/server/service-learning/feed.ts` parser → `src/server/service-course/public-feed.ts`: it accepts only `volume: "legacy-beit-mitzvah"` and lane `licensed` (feed.ts:226-235, 241) and deliberately drops transliteration (feed.ts:121). The fork accepts the public volume, requires the public lane, and projects `tr`. Keep the pre-parse scanner (feed.ts:71-103) unchanged.
- `src/components/learn/quick-ten.tsx` → `src/components/learn/service/quick-ten.tsx`: today's screen is built around hear-and-name and waits on audio (quick-ten.tsx:65, 87).
- `src/components/learn/lesson.tsx` frame → `src/components/learn/service/lesson.tsx`: the step list and the "recording did not load" path are trope-specific (lesson.tsx:17-21, 63).

**Change in place (small, shared):**
- `src/lib/offline/policy.ts`: `PackDescriptor` (:68) and `descriptorOf` (:85-93) gain `{ type: "service-course" }`; `PACK_DATA_PATH` (:46) gains `service-text`; `SHELL_BASE_PAGES` (:38) gains the course pages (§10).
- `src/lib/offline/packer.ts`: a builder for the new pack.
- `src/lib/offline/copy.ts`: the pack's list label (A7 `off.packLabel`).
- The Learn home gets one link row to the new course [Inferred].
- The copy-scan test that runs `toneProblems` over Learn's strings also covers the new copy module.

## 6. Data model

### 6.1 What is stored, and where

| Data | Where | Who reads it |
|---|---|---|
| Course structure, glosses, alphabet | `course.json` in the bundle | everyone |
| Teachings, pages, BM base ids | `tenants/crc.json` in the bundle | everyone |
| Public-volume text (Hebrew, transliteration, English) | a pinned public-lane feed in the database (§6.2, migration B), served by `GET /api/public/service-text?unit=` | everyone; cacheable |
| Learner progress, signed out | localStorage `crc-torah:service-progress/v1` | that browser |
| Learner progress, signed in | table `service_course_progress` (migration A) | the owner only |
| The personal path (lesson ids and pages) | derived on request from `student_service_plan` (0015) | the student (and a parent in child practice) |
| The path's last copy, for offline | localStorage `crc-torah:service-path/v1`, `{ owner, items, fetchedAt }`, cleared on sign-out like progress | that browser |
| Practice days | existing `practice_day` / `practice_event` (0018) | the student; assigned tutors and admins see dates only |
| Per-part finished mark (Batch 3 Q12) | table `service_part_finished` (migration C, `0045`, §9) | the student; assigned tutors; rabbis and admins; parents open (P1). **Adversarial review: privacy** |

### 6.2 Migrations

**Migration A, `0043_service_course_progress.sql`.** A copy of 0037 (`src/server/db/migrations/0037_course_progress.sql:1-35`) with three changes: the table name; the document check `progress->>'schema' = 'service-course-progress/v1'` (0037:10); and its own transaction-local owner setting (for example `app.service_course_owner`), set only by `src/server/service-course/access.ts`, as plan item 23 did for Learn. Same forced `owner_only` policy (0037:35), same grants (0037:31-33: SELECT, INSERT, UPDATE of progress, version, updated_at; no DELETE). Staff, Daniel, MCP, cron and the Sheet never set the owner and see no rows (0037:18-21). **Adversarial review: yes** (privacy).

A new table rather than a column on `course_progress`: that table's primary key is one document per member (0037:9) and its check pins `learn-progress/v1` (0037:10), so a second document needs a key change on live data. A copy is the smaller risk. [Inferred]

**Migration B, `0044_course_text_catalog.sql`.** A tenant-scoped, immutable store for the public volume's pinned feed: a copy of `service_catalog` and `service_catalog_lifecycle` (`0015_service_learning_foundation.sql:1-29, 60, 80-98`) with a `volume` column and a check that the lane is public. `service_catalog` itself cannot hold it: one active lifecycle per tenant (0015:60), and its parser refuses any volume but the Beit Mitzvah one. **Adversarial review: yes** (licensed-text boundary). It depends on Q1 (where the public-lane feed comes from).

**No migration** for practice days (0018 already allows a `service-unit` target, `0018_practice_calendar_foundation.sql:29-36`) or for the path (it reads 0015 as it is).

### 6.3 How DEFAULT_SERVICE_PARTS and `selected_ids` become the personal path

1. A new private route `GET /api/learn/service/path` (no-store, exact Origin, signed in) calls the existing `metadata` read (`service.ts:121-136`) in the learner's mode (`student`, or `child-practice` for a parent practising with a child, service.ts:112-117).
2. `metadata` returns the plan's state and, when assigned, the selected units in service order (`canonical` keeps feed order, service.ts:38-42), each with its printed page (service.ts:59-63), plus the service's first page (service.ts:64-69).
3. The route strips each unit id's family suffix (`@bm-shacharit` / `@bm-maariv`, the pattern at feed.ts:169) and maps the base id to a lesson through the tenant file. It returns **lesson ids, pages, the slot, `serviceStart`, and the plan id, revision, catalog id and identity** (needed for practice days, §9). It drops `name` and `caption` (service.ts:62-63): those come from the licensed feed, and the course shows its own titles.
4. States, each with its copy in A7:

| `metadata` state | What the home shows |
|---|---|
| `assigned` | "Your parts": the mapped lessons in order. A selected unit with no lesson (front matter, for example) is left out silently. |
| `no-plan` (service.ts:124) | The default path from the tenant file (the six U1 lessons, which are `DEFAULT_SERVICE_PARTS`, feed.ts:310-314), under "Your tutor hasn't chosen your parts yet. These are the parts most students lead." |
| `cleared` (service.ts:127) | No "Your parts" list; "No service parts are assigned to you right now." The whole service stays open. |
| `stale` or `needsReview` (service.ts:86, 125) | The list, with "Your parts may change. Your tutor will review them with you." |
| `withdrawn` (service.ts:128) | No list; "Your parts are being updated. Ask your tutor which ones you lead." |
| Slot `unknown` (0013:2) | Pages from the morning service, with "Page numbers are from the morning service until your service time is set." |
| Route error | "Your parts could not be loaded. The whole service is below." The course still works. |

5. Signed out, or signed in without a student grant: no "Your parts"; the next lesson is the first undone lesson of U1.
6. **Next lesson** is the first undone lesson on the path (signed-in student) or in U1 (everyone else), then in unit order. The fluency strand never becomes "Next" unless the learner has started it. [Inferred]
7. **A second part model exists.** The Music-connected service (`student_service_part`, `0025_service_ecosystem.sql:47-61`) also lists the parts a student leads (`leads`), with a self-reported `progress` of not-started / practicing / ready that tutors already see (`my-service.tsx:85`). This design uses the plan (0015), as the brief asks. See Q3.

## 7. The word card for prayer words

**The problem.** The card's data is keyed by Bible verse: `/api/public/word-aids` and `/api/public/word-details` take a ref and a kind of torah or haftarah (`src/components/learn/word-card.tsx:11-18, 57-69`; A1 §3). Most liturgy is not a verse.

**Proposal: two sources, chosen per line in the course file.**

| Line | Source | Cost | Licence |
|---|---|---|---|
| A Torah or Prophets verse inside a prayer (Sh'ma, V'ahavta, Mi Chamochah, K'dushah, V'shamru, Mah Tovu's first line, the closing Birkat Kohanim) | **The existing card**, unchanged: the line declares `torahRef` (§5.3 rule 5); the app loads that verse through the existing public text route and opens the same `WordCard` | none: no new route, no new data | as /read today (Sefaria edition and dictionary credits, shown by the card) |
| Any other line | **A key-word glossary in `course.json`**: three to six words per prayer, each `{ block, word, gloss, root? }`, shown as a small card with the word (from the loaded public text), its gloss, its root, and the line it comes from | authoring: about 150 glosses for the morning, drafted by Claude from the public volume's English and standard lexicons; no runtime cost | English glosses are ours; the Hebrew comes at runtime from the public feed and never enters the repo |

- **Alignment check.** A `torahRef` line opens the real card only if its word count matches the verse's, as Learn checks example drift (plan item 1). Otherwise that line falls back to the glossary. Some public texts may print the divine name differently from the Masoretic verse [Inferred]; the check catches it.
- **Not proposed:** a per-word morphology source for liturgy. None exists in the app; building one (or licensing one) is a cost item to flag, not to start. A Sefaria lexicon lookup at runtime would add per-word network calls and give senses with no grammar for liturgical forms [Inferred].
- **Glosses: Claude drafts, live as lesson text (Daniel 2026-10-24).** They go live as lesson text with no review of each one, and are editable later.

## 8. Progress, Review and Quick ten

### 8.1 Progress document

`service-course-progress/v1`, the same shape as Learn's (progress.ts:15):

```
{ schema: "service-course-progress/v1",
  lessons: { [lessonId]: { done: ISO } },
  cards:   { [cardId]: { box: 0..5, due: YYYY-MM-DD } } }
```

- Card ids: `letter:{id}:name`, `vowel:{id}:sound` (fluency), `word:{lessonId}:read` and `word:{lessonId}:meaning` (prayer lessons with a Check). A lesson's cards enter box 1 when it is done, as `completeLesson` does (progress.ts:98-103).
- Boxes, the one-box-per-run rule, the known-date cap and the merge rule are Learn's (progress.ts:12, 71-90, 120-125, 177-189), through the imported helpers.
- Limits: at most 96 lessons; cards bounded by the alphabet table plus two per lesson (about 250); 64 KB as Learn (progress.ts:10).
- Signed out: one localStorage key, every access guarded, bad data means a fresh start (progress.ts:191-206 pattern). The home says "Progress is saved on this device. Sign in to keep it." (home.tsx:68).
- Signed in: routes `GET /api/learn/service/progress`, `POST …/put`, `POST …/merge`, the same contract as Learn's (plan item 25). Who keeps progress: the same eligibility rule as Learn (plan item 35).
- **Learn to lein progress does not carry over into this course,** and the reverse: they teach different skills and have separate documents. The two homes link to each other. [Inferred]

### 8.2 Check items (inside a lesson)

- Built at runtime from the lesson's loaded public text and its key words.
- **Reading item:** "Which word says {translit}?" with three Hebrew words from the lesson's lines. It uses a word only when the block's transliteration splits into the same number of words as its Hebrew; otherwise that word is skipped. [Inferred rule]
- **Meaning item:** "What does this word mean?" (a key word, three glosses) or "Which word means {gloss}?" (three key words). Wrong glosses come from the same lesson, then from lessons already done.
- 3–6 items per lesson: about half reading, half meaning. A miss shows the one-line tell ("That one is {translit}." / "That one means {gloss}.") and comes back 3–5 items later, at most twice (`run.ts:10, 15-33`); after that its card carries it into Review.
- Every answer moves the word card one box at most per run (progress.ts:82-90).
- Nothing is counted on screen. Done says what the learner can now do, never how many they got right.

### 8.3 Review

`/learn/service/review`: 8–12 due cards (`REVIEW_LIMITS`, progress.ts:119), mixed, letter and vowel cards included. The home line is "Review: {n} words, about {m} minutes" only when something is due (shape of home.tsx:64).

### 8.4 Quick ten (reading only)

- A practice run, never a lesson step, as in Learn (A1 §1).
- Ten items of one kind only: a word is named by its transliteration and the learner taps it among three Hebrew words ("Which says {translit}?"). No meaning items, no audio.
- Words come from the Read steps of lessons done, plus f5–f6 words.
- **Opens** after three prayer lessons with a Read step are done, or after f6. Until then its row is absent, and a direct link says "Quick ten opens after three prayers you have read."
- After an answer the word shows in its line for 1.5 seconds and the next item follows on its own; "Stop here" ends it; misses come back after the ten (Learn's settings: lessons.json:488; quick-ten.tsx:63-70, 78). With no audio, nothing else holds the advance except an open word card (quick-ten.tsx:65).
- It moves `word:{lessonId}:read` cards, one box per run.
- It ends on "Done." or "Done. The ones you missed come back in review." (reused, `src/components/learn/activity-copy.ts:40-41`).

## 9. The tutor's view of course progress

**What exists.** Course progress is owner-only: no staff, Daniel, MCP or cron can read `course_progress` (0037:18-21; `src/server/db/course-progress-schema.ts:5-9`). Ruling 45: "nothing finer than days-practiced is reported to anyone else, and nothing is reported across students" (RULINGS-DIGEST (g), REVIEW L42). The staff view of a student's practice is the practice-days calendar: "Days {firstName} practiced here, alone or with a parent. Dates only." (`src/components/portal/workspace/practice-calendar/view.tsx:33-45`), fed by `practice_event` rows, which already accept a `service-unit` target (0018:29-36; `src/lib/practice-calendar/types.ts:5-8`). The existing Service parts panel (`src/components/portal/workspace/service-learning/panel.tsx:68-87`) is where a tutor already looks at a student's parts.

**Decided (Daniel, 2026-10-24, Batch 3 Q12): a per-part "finished" mark.** Tutors see, for each part assigned to a student, whether the student has finished that part's lesson. This widens ruling 45 ("nothing finer than days-practiced") for the service course only. It replaces the earlier days-only recommendation.

**What is stored.** One row per student and part, in a new staff-readable table (working name `service_part_finished`):
- `tenant_id`, `student_id`, `lesson_id` (the part's lesson id from the tenant file, never the feed unit id with its family suffix), `finished_at`.
- Nothing else: no answers, no times of day beyond `finished_at`, no attempt counts, no scores, no Check results.
- Written only for a lesson that is one of the student's own assigned parts (the path route, §6.3). Lessons outside the parts, and all fluency and Review work, write nothing.
- Insert-only. Unmarking does not exist: a part, once finished, stays finished. [Inferred]

**Who reads it (RLS, forced, tenant-scoped).**
- The student (owner) and a parent in child practice acting for them.
- The student's assigned tutor or tutors (active `tutor_student` row).
- Rabbis and admins.
- Parents: **do not read it.** Decided (Daniel, 2026-10-24, Batch 3b Q18): "No (Recommended)". Tutors and rabbis only; the table's parent policy stays off.
- No MCP, cron, Sheet or Claude access, as for `course_progress` (0037:18-21).

**Migration.** New, `0045_service_part_finished.sql` [Inferred number: after 0043 and 0044]. Do not extend 0043: that table is owner-only by design and stays so. The new table follows the house RLS loop (`ENABLE` and `FORCE ROW LEVEL SECURITY`, `REVOKE ALL FROM PUBLIC, portal_runtime`, grants of SELECT and INSERT only, a `tenant_isolation` policy, plus a role-scoped read policy for the readers above, and the `portal_immutable_audit` trigger against UPDATE and DELETE). Add an audit action for the write. The reader check uses the same live checks the Service parts panel already uses.

**When "finished" is set.** On the Done screen of that part's lesson (step 6), once, for a signed-in student or a parent in child practice, when the lesson is one of the student's assigned parts. Reaching Done is the only trigger; the course counts no right answers, and a teaching-only (moment) lesson is finished when its Done screen shows. The write is a side effect of the existing progress sync, not a new button. Signed-out learners write nothing.

**What the student sees.** One line on the Done screen and on Your parts: "Your tutor can see which of your parts you've finished." (A7 `tu.student.line`). The student can also see their own finished parts on Your parts, as now.

**What the tutor sees.** On the student's page, under "Learn the service": one row per assigned part, in service order, "Finished" with a date or "Not yet". No percent, no count, no ordering of students (W13).

**Privacy: adversarial review required.** This slice is marked **adversarial review: privacy**. Tests to include: no row across students or tenants; a tutor without an active `tutor_student` row reads nothing; a parent in parent view reads nothing (P1, decided: parents do not see it); no route, MCP tool or export returns the rows to anyone else; a lesson outside the student's parts writes nothing.

**Existing practice days.** Unchanged: the calendar keeps showing the days a student practiced. Whether a visit to a part also writes a `visit` practice event with the part's `service-unit` target (the earlier option A) is no longer needed for the tutor view and is left out of 2.0 unless Claude Code finds the calendar needs it. [Inferred]

**Decided 2026-10-24.** Q2 (tutor view): per-part finished mark. Q4 (glosses): Claude drafts, live as lesson text. Batch 3 Q11 (notifications): none yet. Batch 3 Q14 (parents and D'var Torah): stages and dates, not the link.

## 10. Offline

Under the 14-day rule: a pack is served only within 14 days of the last successful online open (`policy.ts:18-20, 78-82`).

| Works offline (installed app) | Needs a connection |
|---|---|
| The course home and every lesson page (app shell: add `/learn/service`, `/learn/service/about`, `/learn/service/review`, `/learn/service/practice/quick-ten` and one page per lesson, as shell.ts adds Learn's lessons, `policy.ts:36-38`) | The siddur link: shown as "Needs a connection" (reuse `src/lib/offline/copy.ts:23`) |
| About and Where (teachings and order are in the bundle) | The path refresh (offline shows the last copy, "Your parts as of {date}.") |
| Read, Key words and Check, from the **service-course pack**: `/api/public/service-text?unit=…` for every course unit with a Read step (about 30 small JSON responses) | The word card for `torahRef` lines, unless the verse is in the pack: add those verses' `/api/public/text` requests to the same pack [Inferred] |
| The fluency strand (f1–f4 from the bundle; f5–f6 from the pack) | Sync of progress (queued, as Learn, `src/components/learn/services.tsx:57-58`) |
| Review and Quick ten | |

- The pack is public (`owner: "public"`, `policy.ts:69-73`), like Learn's course pack. It holds only public-lane text; the licensed BM text is never fetched by the course at all, so it can never be cached (A6 table).
- Without the pack, the Read step says "This prayer's text isn't saved on this device. Connect to read it." and "You can still read about this prayer."; the lesson is not marked done (§3.2).
- The /offline list shows the pack as "Learn the service" (A7 `off.packLabel`).

## 11. Where the 1.8 siddur link goes

- **Read step**, under the last line: the note "Your siddur may print this prayer a little differently. Read it there too." and the link "Open in the siddur, page {page}". On a prayer with no public text, the Read step is only "This prayer's text is in the siddur." and the link.
- **Done**, above "Start next lesson".
- **Course home**, for a signed-in student with a path: "Your whole service in the siddur, from page {page}" (the 1.8 string, `panel.tsx:70`), from `serviceStart` (service.ts:64-69).
- **Which page:** the student's own printed page from the path route when the lesson is one of their parts (service.ts:59-63); otherwise the tenant file's page for the learner's slot; signed out, the morning page.
- **Built with** `siddurPageLink(siddurUrl, tenant.siddurBook, page)` (link.ts:13-23); it returns null for any reader that is not the recognised one, and then no link is drawn (siddur-link.tsx:9-16). Opens in its own tab with no opener or referrer (siddur-link.tsx:5-7). The reader has no in-page anchor (SIDDUR L68), so a page with two prayers (p. 22, p. 23) lands at the top; the note covers it.
- Never a moment or prayer without a page: no page, no link.

## 12. A second congregation (designed, not built)

- Everything congregation-specific is in `tenants/{tenant}.json`: whether the course is on, its siddur book, its public volume, its teachings, its credit line, its pages and its default path.
- No tenant file, or `enabled: false`: `/learn/service` says "The service course isn't available here yet." and no link to it is drawn.
- The public text store (migration B) is tenant-scoped with a `volume` column, so a second congregation can pin its own volume.
- Nothing in 2.0 hard-codes CRC's book into the course model beyond the CRC tenant file (A6 check 4). `pages.ts`'s CRC constants stay where they are for /read and the workspace.

## 13. States

| Screen | Loading | Empty | Offline | Error |
|---|---|---|---|---|
| Home | "Loading the course…" (progress not yet read) | Signed out: no "Your parts"; first lesson is Next. Path cleared or withdrawn: see §6.3 | Works; path from last copy with its date; siddur line hidden | Path error line; the course works |
| Lesson, About/Where | none (bundle) | — | Works | "This lesson isn't in the course." for an unknown id |
| Lesson, Read | "Loading the lesson…" | No public text: siddur link only | No pack: offline lines; not marked done | "The prayer text did not load. Try again." with Try again; not marked done |
| Key words | — | Lesson has none: step absent | Works with the pack | Glossary card shows; real card says "Needs a connection" (existing card behaviour, A1 §3) |
| Check | — | Fewer than 3 items: step absent | Works with the pack | — |
| Done | — | — | Siddur link becomes "Needs a connection" | — |
| Quick ten | "Loading the words…" | "Quick ten opens after three prayers you have read." | Works with the pack | "The prayer text did not load. Try again." |
| Review | "Loading the review…" | "Nothing to review today." | Works | as Quick ten |
| Tenant off | — | "The service course isn't available here yet." | — | — |

## 14. Wireframes at 360 px

Each frame is 38 characters wide, about 360 px at the app's text size. `[ ]` is a button; `( )` a toggle; `>` a link row; `●` done, `◉` next, `○` later.

**W1. Home, signed out**
```
+--------------------------------------+
| CRC Torah                            |
|--------------------------------------|
| Learn the service                    |
| Each prayer in the Shabbat morning   |
| service: what it is, how to read it, |
| and where it is in the siddur.       |
| +----------------------------------+ |
| | Next                             | |
| | Sh'ma                            | |
| | All of existence is one, and we  | |
| | stand inside it.                 | |
| | [ Start ]   about 5 minutes      | |
| +----------------------------------+ |
| > New to Hebrew letters? Start with  |
|   Reading Hebrew.                    |
| Learn to lein · About                |
| Progress is saved on this device.    |
| Sign in to keep it.                  |
|                                      |
| Reading Hebrew                       |
|  ○ Letters, part one                 |
|  ○ Letters, part two   ...           |
| The parts every student leads        |
|  ◉ Sh'ma                             |
|  ○ V'ahavta                          |
|  ○ Blessing before the Torah reading |
|  ○ ...                               |
| Morning blessings                    |
|  ○ Modeh Ani   ...                   |
| Saturday evening and Havdalah come   |
| next.                                |
+--------------------------------------+
```

**W2. Home, signed-in student with a path (review due, Quick ten open)**
```
+--------------------------------------+
| CRC Torah                            |
|--------------------------------------|
| Learn the service                    |
| +----------------------------------+ |
| | Next                             | |
| | Blessing before the haftarah     | |
| | [ Start ]   about 4 minutes      | |
| +----------------------------------+ |
| > Review: 6 words, about 2 minutes   |
| > Quick ten: ten words from your     |
|   prayers, about 2 minutes           |
|                                      |
| Your parts                           |
| The prayers you lead, in service     |
| order.                               |
|  ● Sh'ma                     p. 10   |
|  ● V'ahavta                  p. 11   |
|  ● Blessing before the Torah p. 22   |
|  ● Blessing after the Torah  p. 22   |
|  ◉ Blessing before the       p. 23   |
|    haftarah                          |
|  ○ Blessings after the       p. 24   |
|    haftarah                          |
|  ○ Adon Olam                 p. 30   |
| Your whole service in the siddur,    |
| from page 1  ↗                       |
|                                      |
| The whole service                    |
| Reading Hebrew  ...                  |
+--------------------------------------+
```

**W3. Home states (only the part that changes)**
```
Loading                       Path loading
+--------------------------+  +--------------------------+
| Learn the service        |  | Your parts               |
| Loading the course…      |  | Checking your parts…     |
+--------------------------+  +--------------------------+

No plan yet                   Cleared
+--------------------------+  +--------------------------+
| Your parts               |  | No service parts are     |
| Your tutor hasn't chosen |  | assigned to you right    |
| your parts yet. These    |  | now.                     |
| are the parts most       |  | The whole service        |
| students lead.           |  |  ...                     |
|  ○ Sh'ma  ...            |  +--------------------------+
+--------------------------+
                              Withdrawn
Needs review                  +--------------------------+
+--------------------------+  | Your parts are being     |
| Your parts               |  | updated. Ask your tutor  |
| Your parts may change.   |  | which ones you lead.     |
| Your tutor will review   |  +--------------------------+
| them with you.           |
|  ● Sh'ma  ...            |  Path error
+--------------------------+  +--------------------------+
                              | Your parts could not be  |
Offline                       | loaded. The whole        |
+--------------------------+  | service is below.        |
| Your parts               |  +--------------------------+
| Your parts as of Oct 20. |
| They update when you are |  Tenant off
| online.                  |  +--------------------------+
|  ● Sh'ma          p. 10  |  | The service course isn't |
+--------------------------+  | available here yet.      |
                              +--------------------------+
Slot unknown
+--------------------------+
| Page numbers are from    |
| the morning service      |
| until your service time  |
| is set.                  |
+--------------------------+
```

**W4. Lesson, step 1: About this prayer**
```
+--------------------------------------+
| ×   Sh'ma            ■□□□□□          |
|--------------------------------------|
| About this prayer                    |
|                                      |
| The Sh'ma (Deuteronomy 6:4) is among |
| the oldest fixed parts of Jewish     |
| prayer; ...                          |
| ... the one who says it bears        |
| witness.                             |
|                                      |
| Rabbi Daniel Bogard                  |
|                                      |
|--------------------------------------|
|              [ Next ]                |
+--------------------------------------+
```

**W5. Step 2: Where it is in the service**
```
+--------------------------------------+
| ×   Sh'ma            ■■□□□□          |
|--------------------------------------|
| Where it is in the service           |
|                                      |
|  ○ Morning blessings                 |
|  ● The Sh'ma and its blessings       |
|     · Bar'chu                        |
|     · Yotzeir Or                     |
|     · Ahavah Rabbah                  |
|     ▶ Sh'ma                          |
|     · V'ahavta                       |
|     · Mi Chamochah                   |
|  ○ The Amidah                        |
|  ○ The Torah service                 |
|  ○ Closing the service               |
|                                      |
| Sh'ma comes after Ahavah Rabbah and  |
| before V'ahavta.                     |
| In your siddur it is on page 10.     |
|--------------------------------------|
|              [ Next ]                |
+--------------------------------------+
```

**W6. Step 3: Read it (transliteration off, then on)**
```
+--------------------------------------+  +--------------------------------------+
| ×   Sh'ma            ■■■□□□          |  | ×   Sh'ma            ■■■□□□          |
|--------------------------------------|  |--------------------------------------|
| Read it                              |  | Read it                              |
| Read each line aloud at your own     |  | ( Hide transliteration )             |
| pace. Tap a word to see what it      |  | ( Show English )                     |
| means.                               |  |                                      |
| ( Show transliteration )             |  |      [Hebrew line 1, right to left]  |
| ( Show English )                     |  |   Sh'ma Yisrael Adonai Eloheinu      |
|                                      |  |   Adonai echad                       |
|      [Hebrew line 1, right to left]  |  |      [Hebrew line 2]                 |
|      [Hebrew line 2]                 |  |   [transliteration line 2]           |
|                                      |  |                                      |
| New to Hebrew letters? Start with    |  | Text: Shirei Tfilah, CC BY-NC-SA 4.0 |
| Reading Hebrew.                      |  | Your siddur may print this prayer a  |
| Text: Shirei Tfilah, CC BY-NC-SA 4.0 |  | little differently. Read it there    |
| Your siddur may print this prayer a  |  | too.                                 |
| little differently. Read it there    |  | Open in the siddur, page 10  ↗       |
| too.                                 |  |--------------------------------------|
| Open in the siddur, page 10  ↗       |  |              [ Next ]                |
|--------------------------------------|  +--------------------------------------+
|              [ Next ]                |
+--------------------------------------+
```

**W6b. Read it, other states**
```
No public text               Loading                    Offline, no pack
+------------------------+   +------------------------+ +------------------------+
| Read it                |   | Read it                | | Read it                |
| This prayer's text is  |   | Loading the lesson…    | | This prayer's text     |
| in the siddur.         |   |                        | | isn't saved on this    |
| Open in the siddur,    |   +------------------------+ | device. Connect to     |
| page 23  ↗             |                              | read it.               |
|------------------------|   Text error                 | You can still read     |
|        [ Next ]        |   +------------------------+ | about this prayer.     |
+------------------------+   | The prayer text did    | | Needs a connection     |
                             | not load. Try again.   | |------------------------|
                             | [ Try again ]          | | [ Back to the course ] |
                             +------------------------+ +------------------------+
```

**W7. Step 4: Key words, and the card**
```
+--------------------------------------+  +--------------------------------------+
| ×   Sh'ma            ■■■■□□          |  | (scrim over the step)                |
|--------------------------------------|  |                                      |
| Key words                            |  +--------------------------------------+
| A few words to know in this prayer.  |  | [Hebrew word]                [Close] |
| Tap one for more.                    |  | Deuteronomy 6:4 · Word 1 of 6        |
|                                      |  | Meaning in this verse                |
|  [Hebrew]  sh'ma     hear, listen    |  |   hear                               |
|  [Hebrew]  Yisrael   Israel          |  | Syllables and stress  ...            |
|  [Hebrew]  Eloheinu  our God         |  | Grammar  ...                         |
|  [Hebrew]  echad     one             |  | Dictionary senses  ...               |
|                                      |  | (the existing WordCard, unchanged)   |
|--------------------------------------|  +--------------------------------------+
|              [ Next ]                |
+--------------------------------------+
Glossary card (a line that is not a verse): the word, its gloss, its root, the line it is in, [Close].
```

**W8. Step 5: Check (question, right, miss)**
```
+------------------------------+ +------------------------------+ +------------------------------+
| ×  Sh'ma        ■■■■■□       | | ×  Sh'ma        ■■■■■□       | | ×  Sh'ma        ■■■■■□       |
|------------------------------| |------------------------------| |------------------------------|
| Check                        | | Which word says echad?       | | What does this word mean?    |
| A few questions on what you  | |                              | |        [Hebrew word]         |
| just read. Answer before you | | [ (Hebrew)     ]             | | [ one         ]              |
| look.                        | | [ (Hebrew)  ✓  ]             | | [ hear, listen]  ← tapped    |
|                              | | [ (Hebrew)     ]             | | [ our God     ]              |
| Which word says echad?       | |                              | |                              |
| [ (Hebrew) ]                 | | Yes. (Hebrew) is echad.      | | That one means hear, listen. |
| [ (Hebrew) ]                 | |                              | | This one comes back in a     |
| [ (Hebrew) ]                 | |                              | | moment.                      |
|------------------------------| |------------------------------| |------------------------------|
|      [ Next ] (disabled)     | |          [ Next ]            | |          [ Next ]            |
+------------------------------+ +------------------------------+ +------------------------------+
```

**W9. Step 6: Done (online, then offline)**
```
+--------------------------------------+  +--------------------------------------+
| ×   Sh'ma            ■■■■■■          |  | ×   Sh'ma            ■■■■■■          |
|--------------------------------------|  |--------------------------------------|
| Sh'ma                                |  | Sh'ma                                |
| Done                                 |  | Done                                 |
| You can read the Sh'ma's first line  |  | You can read the Sh'ma's first line  |
| and say what its key words mean.     |  | and say what its key words mean.     |
| Open in the siddur, page 10  ↗       |  | Needs a connection                   |
| Next of your parts: V'ahavta         |  | Next of your parts: V'ahavta         |
|--------------------------------------|  |--------------------------------------|
|        [ Start next lesson ]         |  |        [ Start next lesson ]         |
|         Back to the course           |  |         Back to the course           |
+--------------------------------------+  +--------------------------------------+
```
(The goal line is `presentGoal` applied to the lesson goal, as Learn's Done does, lesson.tsx:192.)

**W10. Fluency items (letter, vowel, line)**
```
+------------------------------+ +------------------------------+ +------------------------------+
| ×  Letters, part one ■■□□□   | | ×  Vowels            ■■■□□   | | ×  Reading lines     ■■■■□   |
|------------------------------| |------------------------------| |------------------------------|
| Which letter is this?        | | Which sound does this make?  | | Read the whole line aloud.   |
|                              | |                              | | Then show the                |
|            [ב]               | |            [בִּ]              | | transliteration, one word at |
|                              | |                              | | a time.                      |
| [ Bet  ] [ Kaf ] [ Reish ]   | | [ ba ]  [ bi ]  [ bo ]       | |   [Hebrew line, RTL]         |
|                              | |                              | |   Bar'chu  et  ___  ___      |
| Bet has a dot inside.        | | Chirik sounds like "ee".     | | [ Show the next word ]       |
|------------------------------| |------------------------------| | [ I read it ] [ Not yet ]    |
|          [ Next ]            | |          [ Next ]            | |------------------------------|
+------------------------------+ +------------------------------+ |          [ Next ]            |
                                                                  +------------------------------+
```
(The glyphs in W10 are single letters from the alphabet table, not prayer text. "Bet has a dot inside" fills A7's `fl.letter.tell`.)

**W11. Quick ten (running, empty, end)**
```
+------------------------------+ +------------------------------+ +------------------------------+
| ×  Quick ten                 | | ×  Quick ten                 | | ×  Quick ten                 |
|------------------------------| |------------------------------| |------------------------------|
| Which says Eloheinu?         | | Quick ten opens after three  | | Quick ten                    |
| [ (Hebrew) ]                 | | prayers you have read.       | | Done. The ones you missed    |
| [ (Hebrew) ]                 | |                              | | come back in review.         |
| [ (Hebrew) ]                 | |------------------------------| |------------------------------|
|  (after the answer the word  | |      Back to the course      | |      Back to the course      |
|   shows in its line, 1.5 s)  | +------------------------------+ +------------------------------+
|------------------------------|
|          Stop here           |
+------------------------------+
```

**W12. Review (running, empty)**
```
+------------------------------+ +------------------------------+
| ×  Review                    | | ×  Review                    |
|------------------------------| |------------------------------|
| Which letter is this?  ...   | | Nothing to review today.     |
| (any item type, mixed)       | |------------------------------|
|------------------------------| |      Back to the course      |
|          [ Next ]            | +------------------------------+
+------------------------------+
```

**W13. Tutor's view of a student (staff workspace, student page)**
```
Decided: per-part finished mark (Batch 3 Q12), shown beside the existing practice days
+--------------------------------------+
| Practice days                        |
| Days Maya practiced here, alone or   |
| with a parent. Dates only.           |
|  S  M  T  W  T  F  S                 |
|  ·  ✓  ·  ✓  ✓  ·  ·                 |
| > Practice calendar                  |
+--------------------------------------+
+--------------------------------------+
| Learn the service                    |
| Parts Maya has finished. Nothing     |
| else is shared.                      |
| Part                      Status     |
| Sh'ma                     Finished   |
|                           Oct 12     |
| V'ahavta                  Finished   |
|                           Oct 19     |
| Blessing before the       Not yet    |
| Torah reading                        |
+--------------------------------------+
Empty (no parts assigned): "No service parts are assigned yet."
```
("Maya" is an invented example name.)

**W14. /offline list row**
```
+--------------------------------------+
| Learn the service                    |
| Saved until Nov 7                    |
+--------------------------------------+
```

**W15. 2.1 audio slot (switched off in 2.0; shown for 2.1's builder only)**
```
+--------------------------------------+
| ×   Sh'ma            ■■■□□□□         |
|--------------------------------------|
| Hear it                              |
| Listen to the melody CRC uses. Then  |
| read along.                          |
|   [ ▶ ]  ───────────────  0:42       |
| Sung by Rabbi Daniel Bogard          |
|--------------------------------------|
|              [ Next ]                |
+--------------------------------------+
```

## 15. Build slices (house plan style)

Following `docs/superpowers/plans/2026-10-22-learn-to-lein.md` (settled decisions, decided here, then slices with files and tests).

1. **Slice 1, signed out, morning, no new tables.** `course.json` (U0–U6), `tenants/crc.json`, the validator and its tests (every rule in §5.3, including "no Hebrew outside the alphabet"); the home, the lesson frame, About, Where, Done; moment lessons; the siddur link; browser progress. Read, Key words and Check wait for slice 2. Exit test: every morning lesson opens at 360 px, a moment lesson is marked done, the tone scan passes, and the siddur link opens the right printed page for the six U1 lessons (pages 10, 11, 22, 22, 23, 24).
2. **Slice 2, the public text.** Migration B, the public-feed parser fork, `/api/public/service-text`, Read with the two toggles, Key words (glossary and `torahRef` cards), Check. **Adversarial review** (licensed-text boundary). Q1 decided: text comes from a public build of the Shabbat Morning volume, pinned by hash, never the licensed build. Exit test: no response of the new route ever carries a `legacy-beit-mitzvah` unit, and the build fails if `course.json` gains a Hebrew prayer word.
3. **Slice 3, fluency, Review and Quick ten.** U0, cards, `/learn/service/review`, `/learn/service/practice/quick-ten`.
4. **Slice 4, signed in.** Migration A, the progress routes and sync, the path route, "Your parts", and the tutor's per-part finished mark (§9; Migration C, `0045_service_part_finished.sql`). **Adversarial review: privacy** (auth and the new staff-readable record). Q3 decided: the path is the tutor's service plan (0015), falling back to the six default parts.
5. **Slice 5, offline.** The pack, shell pages, offline states.
6. **Phase 2, evening and Havdalah.** U7–U8, evening pages and teaching variants, and a per-prayer text decision for prayers missing from the public volume (A6's Sefaria fallback).

Slices 1 and 3 can run in parallel; 2 and 4 can run in parallel after 1.

## 16. Open questions found while designing

Nothing here blocks the build any more. All three are decided, 2026-10-24 (Batch 3b); kept for the record.

1. **Q1. Public text source. DECIDED, build detail by Cowork (QUESTIONS-2.0.md, Batch 3b note; Daniel approved showing that book's text, Batch 1 Q2 "open"): a public build of the Shabbat Morning volume (the public mirror's feed or a public-lane build), pinned by hash, never the licensed build.** Original rec: the course reads a public-lane build of the Shabbat Morning volume (published by the siddur repo's CI or the public mirror), pinned by hash, never the app's licensed build. Why: the only shacharit feed read so far is built `-LICENSED` and its Mi Shebeirach selects licensed verses (A2 discrepancy 13), and the volume is still off the reader's shelf ("not really ready for primetime yet", 2026-09-04, A2 discrepancy 10). Daniel needs to say that its text may be shown publicly in the course now, and where the public build comes from. Blocks slice 2.
2. **P1. Parents and the finished mark. DECIDED, Daniel, 2026-10-24 (Batch 3b Q18): "No (Recommended)". Parents do not see it; tutors and rabbis only.** Original rec: parents in ordinary parent view do not see it until Daniel says so. Why: same-as-other-progress is a guess, and the tutor ruling named tutors only. Blocks nothing; the table's parent policy stays off.
3. **Q3. Which part list is the path when a student has both. DECIDED, Daniel, 2026-10-24 (Batch 3b Q16): "Tutor's service plan (Recommended)". Falls back to the six default parts when there is no plan.** Original rec: the tutor's service plan (`student_service_plan`), with the default six when there is no plan. Why: it is what the brief names, it has the BM unit ids the course maps, and the Music-connected list (0025) can differ. Blocks slice 4.
Also decided 2026-10-24 (removed from this list): tutor view detail is a per-part finished mark; key-word glosses are drafted by Claude and go live as lesson text; no notifications at 2.0; parents see D'var Torah stages and dates, not the link.
