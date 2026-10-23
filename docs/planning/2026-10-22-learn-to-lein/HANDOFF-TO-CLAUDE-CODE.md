# Handoff to Claude Code: Learn to lein, release 1.5

2026-10-23. From the Cowork thread that answered `docs/planning/2026-10-22-learn-to-lein/COWORK-HANDOFF.md`. Read COURSE.md and ACTIVITIES.md first; lessons.json is the content; COPY.md the shared strings; REPORT.md the reasons. Nothing in this folder touches the repo; you decide what to commit.

## Build order

1. Course data and progress. Load lessons.json; a `course_progress` shape per learner (lesson done, activity runs, review cards with box and due date); localStorage for signed-out learners with the same shape; migration on first sign-in if Daniel says yes (QUESTIONS 5).
2. The phrase cut. One function: given `{ref, words:[first,last]}` on a word-ready verse, play that range from the PocketTorah recording with the existing 5 ms fades (`shortWordWav`). The public route looks up by Shabbat date; the course needs a lookup by ref. Either add `ref` to `/api/public/reference/short` or resolve ref to `{date, kind, offset}` server-side. All 136 examples and every generated drill item go through this one function.
3. Item generation. A pool builder over the engine's per-word families (`colorStudyVerse` / `verseUnits`) and the word-ready set, using the rules at the end of ACTIVITIES.md. Build it as a pure function you can unit-test against the examples in lessons.json (every example must be a member of its family's pool).
4. The course home and the lesson shell (sketches in COURSE.md): hear it, hear it in verses, drills, done, in this week's reading.
5. Drills in this order: hear-and-name, same-or-different, where-does-it-end, tap-the-phrase, build-the-phrase, this-week, review, first-verse. The first three are enough to open the course for Daniel to try.
6. The celebration moment and the deep link into Lein (`/read?date=&kind=&verse=` or whatever `/read` prefers).
7. The front-door card copy (COPY.md).

## Data each activity needs, and whether it exists

| Activity | Needs | Exists |
|---|---|---|
| hear-and-name, same-or-different, odd-one-out, quick-ten | word timings; family per word; pools by family and melody | yes |
| tap-the-phrase, where-does-it-end, which-half | phrase index per word (`colorStudyVerse` gives `phrase`), timings | yes |
| build-the-phrase | accent names per word in order (`verseUnits` → `accents`, `trope.accent`), the chart's sample-letter rendering (`chart-catalog`) | yes |
| this-week | `thisShabbat()`, `/api/public/reading?date=`, families per word, timings (Torah 99.4%, haftarot about 72%; 18 haftarot text-only) | yes |
| review | a per-learner card schedule (COURSE.md, "The review model") | no; new, small |
| first-verse | this week's reading, the Lein page, a verse-selecting deep link into `/read` | all but the deep link |
| look-alikes, tap-the-stress | per-word accent position and the engine's syllables with stress (`verseUnits` → `syllables`) | yes |
| fill-the-gap | playback of two ranges with silence between | nearly; a small addition to the player |
| trope-song | a human recording of the trope names sung, Torah and haftarah | no; Daniel decides (QUESTIONS 4) |
| compare | microphone, in-browser pitch detection (pitchy, 0BSD), nothing stored | no; Daniel decides (QUESTIONS 3) |

## lessons.json: what is in it and what was added to the schema

Follows the handoff's `learn-to-lein-course/v1` schema with these additions:

- Top-level `families`: name and `confusedWith` per family id, for distractor weighting. Top-level `notes` holds two sentences of explanation; it is not data.
- `units[].melody`: `torah` or `haftarah`, so the course home can draw two paths.
- `lessons[].family` is `null` and `accents` is `[]` for the three non-family lessons (`intro-phrases`, `torah-first-verse`, `haftarah-first-verse`).
- `examples[]` carries, in addition to `ref`, `words`, `firstWord`, `lastWord`, `why`:
  - `indexWords: [first, last]`: the same range as `words`, but counted the way the PocketTorah index counts, with each maqaf-joined word counted separately. Use this when cutting audio by the index's `words[]` array; use `words` when talking to the engine. Checked on all 7,037 word-ready verses: the index's word count equals the engine's units split at maqaf, with no exceptions.
  - `recording`: the PocketTorah recording key (for example `Nasso-4`), for the cut.
  - `alignScore`: the index's alignment confidence for the verse (median across the corpus 0.58). Three examples are below 0.35 and are flagged below.
  - `tropes`: the per-word trope ids of the phrase, from `unitTrope`, in verse order (family lessons only).
  - `phrases`: for whole-verse examples, the engine's phrase list `[{family, words}]`.
- `activities[].params` use the type ids in ACTIVITIES.md. Common params: `families` (the answer set), `items`, `choices` (chips per item), `weight` (per-family multiplier among distractors), `verseWords` (verse length range), `audio` (where-does-it-end with or without playback), `patterns` (build-the-phrase trope sequences as `a-b-c` strings over `unitTrope` ids), `extraMarks` (decoy tiles), `melodies` (same-or-different across tunes), `kind`, `show`, `find` (this-week), `label` (a heading override), `prompt` (a prompt override), and the first-verse params `source`, `kind`, `pick`, `maxWords`, `steps`, `celebrate`, `openInLein`.

Accent names in `lessons[].accents` use the chart catalogue's spellings (`merkha`, `zakef-katan`, `karnei-para`); `tropes` inside examples use `unitTrope`'s ids (`mercha`, `silluq`). Both are already aliased in `trope/melody.mjs`.

## What was verified, and how

Every example in lessons.json was checked by script against the private PocketTorah index (`C:/private/pockettorah/verse-index-v2.json`, read only, not copied) and the repo's own engine (`trope/text.mjs` `verseUnits` and `trope/melody.mjs` `unitTrope` run over the MAM text cached at `C:/private/pockettorah/sefaria-mam/`):

- the verse is word-ready (in the index, not flagged for review);
- the verse is in the lesson's melody table (Torah recordings for Torah lessons, haftarah recordings for haftarah lessons);
- `words` is exactly one engine phrase, and its family is the lesson's family;
- `firstWord` and `lastWord` are the engine's unit texts at those indices (maqaf chains as one unit);
- for sof pasuk, the verse is not the last verse of its recording (that cadence differs); for end of the haftarah, it is;
- whole-verse examples span `[0, units-1]`;
- no special-melody verse is used (Gen 1:5, 8, 13, 19, 23, 31; Ex 15:1–19; Num 33:11–49; Ex 20; Deut 5; Gen 35:22);
- every prerequisite id exists; every lesson is in exactly one unit; bodies are under about 120 words; no exclamation points.

Result: 136 examples, all pass. The index's own `review` flag excludes 36 verses from the word-ready set; none of them is used.

## Checks you must still run

1. Re-run the range check with the app's own code path (`colorStudyVerse` on the live MAM text from Sefaria) before trusting an example, in case the live text differs from the cache (it should not; both are Miqra according to the Masorah).
2. Listen to the three low-alignment examples and drop or swap them if the cut clips a word: Numbers 6:24 (0.279, used twice), Exodus 3:14 (0.331, in `torah-revia`). Replacement candidates with the same family are easy to find by filtering the pool (sof pasuk: Numbers 6:26 [4,6]; revia on one word: Genesis 27:22 [5,5]).
3. Confirm the index-words mapping in your cut code with one maqaf example: Genesis 1:2, `words` [4,6] (three units, the middle one a maqaf pair) is `indexWords` [4,7].
4. Family ids: the course uses exactly the eleven ids in `chart-catalog.ts`. Geresh, geresh-muqdam and gershayim map to `azla`; telisha-gedola and karnei-para map to `pazer`; shalshelet to `segol`; the end-of-haftarah context to `sof-haftarah`. Munach legarmeh (munach + paseq) is `revia` in the engine; the pool builder must treat it as such.
5. This week: when `/api/public/reading` returns a text-only haftarah, the this-week section must degrade as COPY.md says, not error.
6. Pools: assert every lessons.json example is a member of its family's generated pool. If one is not, the pool rule is wrong, not the example.

## Things I could not verify

- Which contour each family's chip should draw is specified as "the closing cell's core degrees in the current table" (COURSE.md). I did not draw them. Sanity-check that the eleven Torah polylines look distinct at 16 px; if two collide (tevir and telisha ketana are both small turns), lengthen the polyline to include the upbeat.
- Lesson text describes melodies from the cell tables (`trope/cells/*.json`), which are transcriptions of Binder/Avery. If the PocketTorah reader sings a phrase differently from the table (the research notes sof pasuk variants and nine munach contexts), the text's "listen for" line may not match the audio. Daniel should listen to one example per lesson once the player works; the lines are editable and live.
- The haftarah recordings are 54 of 72 weekly haftarot; the course's this-week section will say "No recording for this haftarah yet" on those weeks. I did not check which weeks those are against the current calendar.
- I did not test whether `shortWordWav` cuts a range that spans a paseq or a pisqa cleanly; the examples avoid pisqa but Genesis 1:21 [4,6] and Numbers 10:35 include a paseq (legarmeh). Only Genesis 1:21 [7,7] is used, which avoids it.

## Tone checks before commit

Prayer names in example notes (Shema, Aleinu, Shabbat) are English-usage names, not transliteration of displayed Hebrew; the no-transliteration rule is about the Hebrew line. If Daniel reads them as transliteration, they are one-line edits in `why`.

Grep every learner-facing string for: exclamation points, emoji, "awesome", "great job", "keep it up", "streak", "badge", "level up", "you got this". None are present in these files; keep it that way in the components.

## The scripts I used (not delivered, easy to recreate)

Three small Node scripts on Daniel's machine, outside every repo: one ran `verseUnits` and `unitTrope` over every word-ready verse and wrote one JSON line per verse (`{ref, table, key, final, units[{i,text,family,phrase,pos,of,trope}], phrases[{family,first,last,tropes}]}`); one filtered that by family, phrase length and verse length to list candidate examples; one filled and checked lessons.json as described above. If you want them, the first is twenty lines over `trope/text.mjs` and `trope/melody.mjs`; the derived output is not in this folder because it lists which verses are word-ready, which comes from the private index.
