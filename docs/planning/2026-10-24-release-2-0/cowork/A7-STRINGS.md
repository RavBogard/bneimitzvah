# A7. Service course strings (CRC Torah 2.0)

2026-10-24. Every learner-facing string of the service course, in the order a learner meets them. Design: `A4-COURSE-DESIGN.md`. A worked lesson: `A8-SAMPLE-LESSON.md`.

## How to read this file

- **id** is the key Claude Code should use in the course's copy module (one constant per id, as `src/components/learn/activity-copy.ts` and `src/lib/offline/copy.ts` do).
- **chars** counts characters with placeholders such as `{page}` left in. Limits: unit title and lesson title ≤60, unit summary ≤160 and lesson summary ≤60 (`src/lib/learn/course.ts:74-76`), a goal ≤240 (course.ts:74), an activity label or prompt ≤80 (course.ts:177-179). The service course's own validator keeps those limits (A4 §5). Where a row shows a limit in its note it was checked against it; every row passes.
- **Tone check.** Every string was run through the same test `toneProblems` applies (`src/lib/learn/tone.ts:13-20`): no `!`, no emoji, none of the 17 banned phrases (tone.ts:5-8). **All 252 strings pass.** They were also read against the house rules the code cannot test (COWORK-HANDOFF-2.0.md §2): sentence case, plain verbs, the same words for a 12-year-old and a 60-year-old, no pep talk, no score. Nothing on a Done screen counts right answers.
- **Reuse** marks a string that already ships, with its path and line. Keep those identical.
- **Apostrophes** are shown straight here for searchability. Ship them as the typographic ’ the app already uses (`src/lib/offline/copy.ts:11`, "this week’s"), including inside transliterations (Sh’ma, Bar’chu).
- **Prayer names are transliterated, not translated** (A3-VOICE-MODEL.md rule 12, from Daniel's DECISIONS-LOG.md:12002 ruling).
- **Teaching text is not in this file.** Each lesson's About step shows its approved teaching verbatim from `A3-DRAFTS/` (one per prayer), followed by `about.credit`.
- **Key-word glosses are not in this file.** They are lesson content in `course.json` (A4 §7): Claude drafts them and they go live as lesson text, editable later (Daniel 2026-10-24). A8 shows the Sh'ma's.
- Rows marked [Inferred] carry a wording or placement nobody has ruled on.


## Course home

| id | string | chars | note |
|---|---|---|---|
| `home.title` | Learn the service | 17 | Course home h1 and app bar title. [Inferred route /learn/service] |
| `home.intro` | Each prayer in the Shabbat morning service: what it is, how to read it, and where it is in the siddur. | 102 | Under the title |
| `home.next.label` | Next | 4 | Reuse: Learn to lein home.tsx:59 |
| `home.next.start` | Start | 5 | Reuse: home.tsx:62 |
| `home.next.minutes` | about {n} minutes | 17 | Reuse shape: home.tsx:62 |
| `home.mine.heading` | Your parts | 10 | Signed-in student with a path |
| `home.mine.line` | The prayers you lead, in service order. | 39 | Under Your parts |
| `home.all.heading` | The whole service | 17 | All units, below Your parts |
| `home.fluency.row` | New to Hebrew letters? Start with Reading Hebrew. | 49 | Row link to unit U0, shown until F1 is done |
| `home.done` | Done. Review when you like. | 27 | Reuse: home.tsx:57, when every lesson on the learner's path is done |
| `home.review.row` | Review: {n} words, about {m} minutes | 36 | Shape of home.tsx:64; counts word cards due |
| `home.saved` | Progress is saved on this device. Sign in to keep it. | 53 | Reuse: home.tsx:68 |
| `home.about` | About | 5 | Nav link to /learn/service/about |
| `home.lein` | Learn to lein | 13 | Nav link back to the trope course; existing title |
| `home.serviceStart` | Your whole service in the siddur, from page {page} | 50 | Reuse: 1.8 string, panel.tsx:70 |
| `home.state.dot.done` | , done | 6 | Screen-reader suffix, reuse home.tsx:24 |
| `home.state.dot.next` | , next | 6 | Reuse home.tsx:24 |
| `home.evening.later` | Saturday evening and Havdalah come next. | 40 | Shown under the morning units until phase 2 ships |

## Units (title ≤60, summary ≤160, course.ts:76, 197)

| id | string | chars | note |
|---|---|---|---|
| `unit.reading.title` | Reading Hebrew | 14 | U0, the fluency strand |
| `unit.reading.summary` | Letters, vowels and syllables, then whole lines from the prayers. Start here if Hebrew letters are new to you, or skip ahead. | 125 |  |
| `unit.leads.title` | The parts every student leads | 29 | U1, DEFAULT_SERVICE_PARTS |
| `unit.leads.summary` | The Sh'ma, the V'ahavta, and the blessings before and after the Torah and haftarah readings. Most students lead all six. | 120 |  |
| `unit.waking.title` | Morning blessings | 17 | U2, BM pp. 2-6 |
| `unit.waking.summary` | From waking up to the call to prayer: Modeh Ani, the tallit, Mah Tovu, the morning blessings and the verses of song. | 116 |  |
| `unit.shma.title` | The Sh'ma and its blessings | 27 | U3, BM pp. 7-12 |
| `unit.shma.summary` | Bar'chu calls us together. Two blessings lead to the Sh'ma, and Mi Chamochah carries us toward the Amidah. | 106 |  |
| `unit.amidah.title` | The Amidah | 10 | U4, BM pp. 13-20 |
| `unit.amidah.summary` | The standing prayer: seven blessings on Shabbat, from our ancestors to peace, then a moment of silence. | 103 |  |
| `unit.torah.title` | The Torah service | 17 | U5, BM pp. 21-25 |
| `unit.torah.summary` | Taking out the Torah, the readings, the healing prayer, and returning the scroll to the ark. | 92 |  |
| `unit.closing.title` | Closing the service | 19 | U6, BM pp. 26-31 |
| `unit.closing.summary` | Aleinu, the Mourner's Kaddish, Adon Olam and the blessings that send us out. | 76 |  |
| `unit.evening.title` | Saturday evening: the Sh'ma and its blessings | 45 | U7, phase 2, BM pp. 36-42 |
| `unit.evening.summary` | The evening forms of the prayers around the Sh'ma: Ma'ariv Aravim, Ahavat Olam and Hashkiveinu. | 95 |  |
| `unit.havdalah.title` | Havdalah | 8 | U8, phase 2, BM pp. 60-62 |
| `unit.havdalah.summary` | Wine, spices, fire and the blessing of separation, then songs for the week ahead. | 81 |  |

## Lessons (title ≤60, summary ≤60, course.ts:74-75)

Summaries are drawn from each prayer's approved teaching (A3-DRAFTS), shortened; they are course copy, not teaching.

| id | string | chars | note |
|---|---|---|---|
| `lesson.f1.title` | Letters, part one | 17 | Lesson name |
| `lesson.f1.summary` | The first eleven letters, and the ones that look alike. | 55 | Next card and path line |
| `lesson.f2.title` | Letters, part two | 17 | Lesson name |
| `lesson.f2.summary` | The other eleven letters and the five final forms. | 50 | Next card and path line |
| `lesson.f3.title` | Vowels | 6 | Lesson name |
| `lesson.f3.summary` | The marks under and over letters, and their sounds. | 51 | Next card and path line |
| `lesson.f4.title` | Dots that change a letter | 25 | Lesson name |
| `lesson.f4.summary` | Bet and vet, kaf and chaf, shin and sin. | 40 | Next card and path line |
| `lesson.f5.title` | Reading words | 13 | Lesson name |
| `lesson.f5.summary` | Words from the prayers, one syllable at a time. | 47 | Next card and path line |
| `lesson.f6.title` | Reading lines | 13 | Lesson name |
| `lesson.f6.summary` | Whole lines from Bar'chu, the Sh'ma and a blessing. | 51 | Next card and path line |
| `lesson.modeh-ani.title` | Modeh Ani | 9 | Lesson name |
| `lesson.modeh-ani.summary` | Thanks on waking, before anything else. | 39 | Next card and path line |
| `lesson.tallit.title` | The tallit blessing | 19 | Lesson name |
| `lesson.tallit.summary` | The blessing for the fringes on the prayer shawl. | 49 | Next card and path line |
| `lesson.mah-tovu.title` | Mah Tovu | 8 | Lesson name |
| `lesson.mah-tovu.summary` | A prayer of arrival, borrowed from a hired prophet. | 51 | Next card and path line |
| `lesson.hineih-mah-tov.title` | Hineih Mah Tov | 14 | Lesson name |
| `lesson.hineih-mah-tov.summary` | How good it is to be here together. | 35 | Next card and path line |
| `lesson.birchot-hashachar.title` | Birchot Hashachar | 17 | Lesson name |
| `lesson.birchot-hashachar.summary` | Blessings for the ordinary gifts of a morning. | 46 | Next card and path line |
| `lesson.psukei-dzimrah.title` | P'sukei D'zimrah | 16 | Lesson name |
| `lesson.psukei-dzimrah.summary` | Psalms and praise that carry us toward Bar'chu. | 47 | Next card and path line |
| `lesson.chatzi-kaddish.title` | Reader's Kaddish | 16 | Lesson name |
| `lesson.chatzi-kaddish.summary` | A short Kaddish that marks the end of a section. | 48 | Next card and path line |
| `lesson.barchu.title` | Bar'chu | 7 | Lesson name |
| `lesson.barchu.summary` | The call to prayer: a room becomes a community. | 47 | Next card and path line |
| `lesson.yotzeir-or.title` | Yotzeir Or | 10 | Lesson name |
| `lesson.yotzeir-or.summary` | Morning light, and how small we are. | 36 | Next card and path line |
| `lesson.ahavah-rabbah.title` | Ahavah Rabbah | 13 | Lesson name |
| `lesson.ahavah-rabbah.summary` | Love that comes before we are asked to love. | 44 | Next card and path line |
| `lesson.shma.title` | Sh'ma | 5 | Lesson name |
| `lesson.shma.summary` | All of existence is one, and we stand inside it. | 48 | Next card and path line |
| `lesson.vahavta.title` | V'ahavta | 8 | Lesson name |
| `lesson.vahavta.summary` | What that oneness asks of us: love as practice. | 47 | Next card and path line |
| `lesson.mi-chamochah.title` | Mi Chamochah | 12 | Lesson name |
| `lesson.mi-chamochah.summary` | The song at the sea, and a redemption unfinished. | 49 | Next card and path line |
| `lesson.tfilah.title` | T'filah | 7 | Lesson name |
| `lesson.tfilah.summary` | The Amidah opens: we ask for the words to pray. | 47 | Next card and path line |
| `lesson.avot-vimahot.title` | Avot v'Imahot | 13 | Lesson name |
| `lesson.avot-vimahot.summary` | The first blessing begins with names. | 37 | Next card and path line |
| `lesson.gvurot.title` | G'vurot | 7 | Lesson name |
| `lesson.gvurot.summary` | The power that holds up those who fall. | 39 | Next card and path line |
| `lesson.kdushah.title` | K'dushah | 8 | Lesson name |
| `lesson.kdushah.summary` | Holiness, borrowed from the song of the angels. | 47 | Next card and path line |
| `lesson.vshamru.title` | V'shamru | 8 | Lesson name |
| `lesson.vshamru.summary` | Keeping Shabbat, a sign for every generation. | 45 | Next card and path line |
| `lesson.avodah.title` | Avodah | 6 | Lesson name |
| `lesson.avodah.summary` | What service means after the Temple. | 36 | Next card and path line |
| `lesson.hodaah.title` | Hoda'ah | 7 | Lesson name |
| `lesson.hodaah.summary` | Thanks for the miracles of every day. | 37 | Next card and path line |
| `lesson.sim-shalom.title` | Sim Shalom | 10 | Lesson name |
| `lesson.sim-shalom.summary` | The Amidah ends by asking for peace. | 36 | Next card and path line |
| `lesson.oseh-shalom.title` | Silent meditation and Oseh Shalom | 33 | Lesson name |
| `lesson.oseh-shalom.summary` | Our own words in silence, then peace. | 37 | Next card and path line |
| `lesson.torah-service.title` | Taking out the Torah | 20 | Lesson name |
| `lesson.torah-service.summary` | The ark opens and the scroll comes out. | 39 | Next card and path line |
| `lesson.torah-before.title` | Blessing before the Torah reading | 33 | Lesson name |
| `lesson.torah-before.summary` | The blessing said before each Torah reading. | 44 | Next card and path line |
| `lesson.torah-reading.title` | Reading of the Torah | 20 | Lesson name |
| `lesson.torah-reading.summary` | The reading itself, from the scroll. | 36 | Next card and path line |
| `lesson.torah-after.title` | Blessing after the Torah reading | 32 | Lesson name |
| `lesson.torah-after.summary` | The blessing said after each Torah reading. | 43 | Next card and path line |
| `lesson.mi-shebeirach.title` | Mi Shebeirach | 13 | Lesson name |
| `lesson.mi-shebeirach.summary` | A prayer for healing, for those we name. | 40 | Next card and path line |
| `lesson.haftarah-before.title` | Blessing before the haftarah | 28 | Lesson name |
| `lesson.haftarah-before.summary` | The blessing said before the prophets are read. | 47 | Next card and path line |
| `lesson.haftarah-reading.title` | Reading of the haftarah | 23 | Lesson name |
| `lesson.haftarah-reading.summary` | A reading from the prophets. | 28 | Next card and path line |
| `lesson.haftarah-after.title` | Blessings after the haftarah | 28 | Lesson name |
| `lesson.haftarah-after.summary` | The blessings said after the haftarah. | 38 | Next card and path line |
| `lesson.commentary.title` | Commentary and presentation | 27 | Lesson name |
| `lesson.commentary.summary` | Your words on the reading, and the community's. | 47 | Next card and path line |
| `lesson.eitz-chayim.title` | Returning the Torah | 19 | Lesson name |
| `lesson.eitz-chayim.summary` | The scroll goes back, and Eitz Chayim. | 38 | Next card and path line |
| `lesson.aleinu.title` | Aleinu | 6 | Lesson name |
| `lesson.aleinu.summary` | It is upon us: the close of every service. | 42 | Next card and path line |
| `lesson.mourners-kaddish.title` | Mourner's Kaddish | 17 | Lesson name |
| `lesson.mourners-kaddish.summary` | Praise said by those who remember. | 34 | Next card and path line |
| `lesson.adon-olam.title` | Adon Olam | 9 | Lesson name |
| `lesson.adon-olam.summary` | A song about everything, sung at the end. | 41 | Next card and path line |
| `lesson.parents-blessing.title` | Parent's blessing | 17 | Lesson name |
| `lesson.parents-blessing.summary` | A parent blesses their child. | 29 | Next card and path line |
| `lesson.closing-blessing.title` | Closing blessing | 16 | Lesson name |
| `lesson.closing-blessing.summary` | Birkat Kohanim, a blessing we give each other. | 46 | Next card and path line |
| `lesson.maariv-aravim.title` | Ma'ariv Aravim | 14 | Lesson name |
| `lesson.maariv-aravim.summary` | Evening falls, and the day turns over. | 38 | Next card and path line |
| `lesson.ahavat-olam.title` | Ahavat Olam | 11 | Lesson name |
| `lesson.ahavat-olam.summary` | Everlasting love, the evening's second blessing. | 48 | Next card and path line |
| `lesson.hashkiveinu.title` | Hashkiveinu | 11 | Lesson name |
| `lesson.hashkiveinu.summary` | Shelter for the night, and hope of light. | 41 | Next card and path line |
| `lesson.shalom-rav.title` | Shalom Rav | 10 | Lesson name |
| `lesson.shalom-rav.summary` | The evening Amidah's prayer for peace. | 38 | Next card and path line |
| `lesson.yayin.title` | The wine | 8 | Lesson name |
| `lesson.yayin.summary` | Havdalah begins, as Shabbat did, with wine. | 43 | Next card and path line |
| `lesson.bsamim.title` | The spices | 10 | Lesson name |
| `lesson.bsamim.summary` | Spices passed hand to hand. | 27 | Next card and path line |
| `lesson.eish.title` | The light of the fire | 21 | Lesson name |
| `lesson.eish.summary` | A flame with more than one wick. | 32 | Next card and path line |
| `lesson.havdalah.title` | The blessing of separation | 26 | Lesson name |
| `lesson.havdalah.summary` | Holy and ordinary, and the line between. | 40 | Next card and path line |
| `lesson.eliyahu.title` | Eliyahu HaNavi | 14 | Lesson name |
| `lesson.eliyahu.summary` | A song for the prophet of a better time. | 40 | Next card and path line |
| `lesson.miryam.title` | Miryam HaN'viah | 15 | Lesson name |
| `lesson.miryam.summary` | A song for Miriam, who led the singing. | 39 | Next card and path line |
| `lesson.shavua-tov.title` | Shavua Tov | 10 | Lesson name |
| `lesson.shavua-tov.summary` | A good week: what we say to each other. | 39 | Next card and path line |

## Lesson frame

| id | string | chars | note |
|---|---|---|---|
| `frame.close` | Back to the course | 18 | aria-label of the close button (shape of lesson.tsx:55) |
| `frame.skip` | Skip to the lesson | 18 | Reuse lesson.tsx:53 |
| `frame.rail` | Step {n} of {total} | 19 | Reuse lesson.tsx:57 |
| `frame.next` | Next | 4 | Reuse lesson.tsx:171 |

## Step labels

| id | string | chars | note |
|---|---|---|---|
| `step.about` | About this prayer | 17 | Step 1 heading |
| `step.where` | Where it is in the service | 26 | Step 2 heading |
| `step.read` | Read it | 7 | Step 3 heading |
| `step.words` | Key words | 9 | Step 4 heading |
| `step.check` | Check | 5 | Step 5 heading |
| `step.done` | Done | 4 | Reuse lesson.tsx:191 |

## Step 1: About this prayer

| id | string | chars | note |
|---|---|---|---|
| `about.credit` | Rabbi Daniel Bogard | 19 | Credit line under every approved teaching (Batch 2 Q9, 2026-10-24) |
| `about.unapproved` | Written by Claude for CRC · not yet reviewed by Rabbi Daniel Bogard | 67 | Shown only on a teaching whose approval is not recorded; none in 2.0 (all approved) |
| `about.moment` | This part of the service has no prayer text to read. It is here so you know what happens and when. | 98 | Teaching-only lessons: Taking out the Torah, Reading of the Torah, Reading of the haftarah, Commentary, Parent's blessing |

## Step 2: Where it is in the service

| id | string | chars | note |
|---|---|---|---|
| `where.line` | {prayer} comes after {before} and before {after}. | 49 | Under the service map |
| `where.first` | {prayer} opens the service. | 27 | Variant for the first prayer |
| `where.last` | {prayer} closes the service. | 28 | Variant for the last prayer |
| `where.section` | Part of {section}. | 18 | Section line under the map; a unit title's leading "The" is lowercased here [Inferred] |
| `where.page` | In your siddur it is on page {page}. | 36 | When a page is known for this learner |

## Step 3: Read it

| id | string | chars | note |
|---|---|---|---|
| `read.instruction` | Read each line aloud at your own pace. Tap a word to see what it means. | 71 | Above the first line |
| `read.instruction.nocard` | Read each line aloud at your own pace. | 38 | When no line in the lesson has word cards |
| `read.translit.show` | Show transliteration | 20 | Toggle, off by default (Batch 2 Q8, on request) |
| `read.translit.hide` | Hide transliteration | 20 | Toggle when on |
| `read.english.show` | Show English | 12 | Toggle, off by default [Inferred] |
| `read.english.hide` | Hide English | 12 | Toggle when on |
| `read.siddurNote` | Your siddur may print this prayer a little differently. Read it there too. | 74 | Above the siddur link on the Read step (A6 check 1) |
| `read.inSiddur` | This prayer's text is in the siddur. | 36 | Read step for a prayer with no public text |
| `read.newToHebrew` | New to Hebrew letters? Start with Reading Hebrew. | 49 | Quiet link on the Read step until F1 is done |
| `read.credit` | Text: {volume}, {licence}. | 26 | Licence line from the public feed, e.g. Shirei Tfilah, CC BY-NC-SA 4.0 |

## Step 4: Key words

| id | string | chars | note |
|---|---|---|---|
| `words.instruction` | A few words to know in this prayer. Tap one for more. | 53 | Key words step |
| `words.more` | More about this word | 20 | Opens the existing word card where the line is a Torah verse |

## Step 5: Check

| id | string | chars | note |
|---|---|---|---|
| `check.instruction` | A few questions on what you just read. Answer before you look. | 62 | Before the first item |
| `check.whichSays` | Which word says {translit}? | 27 | Reading item |
| `check.whichMeans` | Which word means {gloss}? | 25 | Meaning item, Hebrew choices |
| `check.whatMeans` | What does this word mean? | 25 | Meaning item, English choices |
| `check.right` | Yes. {word} is {translit}. | 26 | After a right reading answer |
| `check.rightMeaning` | Yes. {word} means {gloss}. | 26 | After a right meaning answer |
| `check.miss` | That one is {translit}. | 23 | After a wrong reading answer; the item comes back later (run.ts:23-33) |
| `check.missMeaning` | That one means {gloss}. | 23 | After a wrong meaning answer |
| `check.again` | This one comes back in a moment. | 32 | Under a miss |

## Step 6: Done

| id | string | chars | note |
|---|---|---|---|
| `done.goal` | After this you can read {prayer} and say what its key words mean. | 65 | Goal template; shown through presentGoal (course.ts:100-103) as "You can…"; rule at course.ts:143-144 |
| `done.goal.moment` | After this you can say what happens at this point in the service. | 65 | Goal for teaching-only lessons |
| `done.siddur` | Open in the siddur, page {page} | 31 | Approved 1.8 string, reused verbatim (my-service.tsx:83) |
| `done.nextName` | Next: {lesson} | 14 | Reuse lesson.tsx:194 |
| `done.startNext` | Start next lesson | 17 | Reuse lesson.tsx:196 |
| `done.back` | Back to the course | 18 | Shape of lesson.tsx:197 |
| `done.nextMine` | Next of your parts: {lesson} | 28 | When the learner has a path |

## Reading Hebrew (the fluency strand)

| id | string | chars | note |
|---|---|---|---|
| `fl.letter.prompt` | Which letter is this? | 21 | F1, F2 |
| `fl.letter.lookalike` | These two look alike. Which one is {name}? | 42 | F1, F2 look-alike pairs |
| `fl.letter.tell` | {name} has {feature}. | 21 | Tell line after an answer, e.g. Bet has a dot inside |
| `fl.final.prompt` | This letter comes only at the end of a word. Which letter is it? | 64 | F2 final forms |
| `fl.vowel.prompt` | Which sound does this make? | 27 | F3: letter plus vowel, three syllable choices |
| `fl.vowel.tell` | {vowel} sounds like {sound}. | 28 | F3 tell |
| `fl.vowel.same` | These two vowels sound the same. | 32 | F3, kamatz and patach; segol and tzere |
| `fl.dot.prompt` | With the dot or without it? | 27 | F4: bet and vet, kaf and chaf, pei and fei |
| `fl.dot.shin` | Is this shin or sin? | 20 | F4 |
| `fl.dot.tell` | The dot makes {a}. Without it, {b}. | 35 | F4 tell |
| `fl.word.instruction` | Read the word one syllable at a time. Then show the transliteration to check yourself. | 86 | F5 |
| `fl.word.show` | Show transliteration | 20 | Same as the Read toggle |
| `fl.word.prompt` | Which word says {translit}? | 27 | F5, F6, same as check.whichSays |
| `fl.line.instruction` | Read the whole line aloud. Then show the transliteration, one word at a time. | 77 | F6 |
| `fl.line.reveal` | Show the next word | 18 | F6 reveal button |
| `fl.line.readIt` | I read it | 9 | F6 self-check; records nothing to anyone |
| `fl.line.notYet` | Not yet | 7 | F6 self-check; brings the line back once |
| `fl.done.f2` | After this you can name every Hebrew letter, including the final forms. | 71 | Goal F2 |
| `fl.done.f6` | After this you can read a whole line of a prayer on your own. | 61 | Goal F6 |

Letter names for `{name}` (F1, F2): Alef, Bet, Vet, Gimel, Dalet, Hei, Vav, Zayin, Chet, Tet, Yod, Kaf, Chaf, Lamed, Mem, Nun, Samech, Ayin, Pei, Fei, Tzadi, Kuf, Reish, Shin, Sin, Tav; final Chaf, final Mem, final Nun, final Fei, final Tzadi. Vowel names for `{vowel}` (F3): kamatz, patach, segol, tzere, chirik, cholam, kubutz, shuruk, sh'va. [Inferred spellings; they follow the house transliteration of Chet/Chaf with "ch".]

## Quick ten (reading only)

| id | string | chars | note |
|---|---|---|---|
| `qt.homeRow` | Quick ten: ten words from your prayers, about 2 minutes | 55 | Shape of activity-copy.ts:36 |
| `qt.title` | Quick ten | 9 | Reuse activity-copy.ts:37 |
| `qt.prompt` | Which says {translit}? | 22 | Reading item; Hebrew choices |
| `qt.stop` | Stop here | 9 | Reuse activity-copy.ts:39 |
| `qt.endClean` | Done. | 5 | Reuse activity-copy.ts:40 |
| `qt.endMissed` | Done. The ones you missed come back in review. | 46 | Reuse activity-copy.ts:41 |
| `qt.empty` | Quick ten opens after three prayers you have read. | 50 | Shape of activity-copy.ts:42 |
| `qt.loading` | Loading the words… | 18 | Shape of activity-copy.ts:49 |

## Review

| id | string | chars | note |
|---|---|---|---|
| `rv.title` | Review | 6 | Existing Learn word |
| `rv.loading` | Loading the review… | 19 | Reuse (plan item 22) |
| `rv.empty` | Nothing to review today. | 24 | Review with no card due |

## Empty, loading, offline and error states

| id | string | chars | note |
|---|---|---|---|
| `st.home.loading` | Loading the course… | 19 | Course home before progress loads |
| `st.lesson.loading` | Loading the lesson… | 19 | Reuse lesson.tsx:62 |
| `st.text.error` | The prayer text did not load. Try again. | 40 | Shape of lesson.tsx:63; the lesson is not marked done |
| `st.retry` | Try again | 9 | Reuse lesson.tsx:63 |
| `st.text.offline` | This prayer's text isn't saved on this device. Connect to read it. | 66 | Read step offline, no pack |
| `st.offline.teachingOk` | You can still read about this prayer. | 37 | With the offline line; About and Where steps work offline |
| `st.needsConnection` | Needs a connection | 18 | Reuse copy.ts:23; shown in place of the siddur link offline |
| `st.path.loading` | Checking your parts… | 20 | Your parts section |
| `st.path.error` | Your parts could not be loaded. The whole service is below. | 59 | Path read failed; the course still works |
| `st.path.noplan` | Your tutor hasn't chosen your parts yet. These are the parts most students lead. | 80 | metadata state no-plan (service.ts:124) |
| `st.path.cleared` | No service parts are assigned to you right now. | 47 | metadata state cleared (service.ts:127) |
| `st.path.review` | Your parts may change. Your tutor will review them with you. | 60 | plan.needsReview or stale (service.ts:86, 125) |
| `st.path.withdrawn` | Your parts are being updated. Ask your tutor which ones you lead. | 65 | metadata state withdrawn (service.ts:128) |
| `st.path.offline` | Your parts as of {date}. They update when you are online. | 57 | Offline, from the device's last copy |
| `st.slot.unknown` | Page numbers are from the morning service until your service time is set. | 73 | student.service_slot unknown (0013) |
| `st.tenant.off` | The service course isn't available here yet. | 44 | A congregation without its own course file |
| `st.notfound` | This lesson isn't in the course. | 32 | Unknown lesson id |

## Offline list

| id | string | chars | note |
|---|---|---|---|
| `off.packLabel` | Learn the service | 17 | /offline list label of the course pack; shape of copy.ts:33 |

## Tutor view (staff only)

| id | string | chars | note |
|---|---|---|---|
| `tu.heading` | Learn the service | 17 | Staff student page, above the per-part list (Batch 3 Q12, decided 2026-10-24) |
| `tu.line` | Parts {firstName} has finished. Nothing else is shared. | 56 | Under the heading |
| `tu.col.part` | Part | 4 | Column header |
| `tu.col.status` | Status | 6 | Column header |
| `tu.finished` | Finished | 8 | Status when the part's lesson is finished |
| `tu.finished.on` | Finished {date} | 15 | Status with the date, e.g. Finished Oct 12 |
| `tu.notyet` | Not yet | 7 | Status when not finished |
| `tu.empty` | No service parts are assigned yet. | 34 | No parts on the student's plan |
| `tu.error` | The list couldn't be loaded. | 28 | Load failed; shows nothing rather than a partial list |
| `tu.loading` | Loading the parts… | 18 | Loading |
| `tu.student.line` | Your tutor can see which of your parts you've finished. | 56 | Student-side transparency line, on the Done screen of an assigned part and under Your parts. Same wording for a child and an adult |
| `tu.daysNote` | Days {firstName} practiced here, alone or with a parent. Dates only. | 68 | Existing string, view.tsx:42; unchanged |

## About page

| id | string | chars | note |
|---|---|---|---|
| `ab.title` | About this course | 17 | /learn/service/about |
| `ab.p1` | Each lesson teaches one prayer: what it is, where it sits in the service, how to read it, and a few words to know. The teaching on each prayer is by Rabbi Daniel Bogard. | 169 |  |
| `ab.p2` | The Hebrew here comes from Shirei Tfilah, a public siddur. Your own siddur may differ in places, so each lesson links to its page there. | 136 | Depends on A4 Q1 |
| `ab.p3` | Nothing here records you. Progress stays on this device unless you sign in. | 75 |  |

## 2.1 audio slot: hidden copy, switched off in 2.0

| id | string | chars | note |
|---|---|---|---|
| `au.step` | Hear it | 7 | 2.1 only. Step label; flag off in 2.0 |
| `au.instruction` | Listen to the melody CRC uses. Then read along. | 47 | 2.1 only |
| `au.credit` | Sung by Rabbi Daniel Bogard | 27 | 2.1 only [Inferred credit form; Daniel to confirm in 2.1] |
| `au.error` | The recording did not load. Try again. | 38 | 2.1 only; reuse lesson.tsx:63 |
| `au.offline` | Recordings need a connection. | 29 | 2.1 only [Inferred: hosting not yet decided] |

## Strings deliberately not written

- **Choreography.** No separate string. Where a practice belongs, it is already inside the approved teaching as a "Some of us…" line (Batch 2 Q10, [Inferred: no separate activity]).
- **Scores and counts of right answers.** None, anywhere. The Check and Quick ten end on "Done." or the existing missed line.
- **Encouragement.** None ("Nice", "Almost", "You did it" and similar are all out).
- **Melody link-out to CRC Music.** None in 2.0 (Batch 2 Q6).
- **"Beta".** No string uses the word (STATE L30).
- **Licensed text.** No string quotes the Beit Mitzvah siddur. Page numbers only.
