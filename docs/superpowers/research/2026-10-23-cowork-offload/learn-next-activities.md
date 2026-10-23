# Learn to lein: content for three later activities

2026-10-23. Cowork, for Claude Code. Handoff §4.5. Covers ACTIVITIES.md #9 Same sign, different place (`look-alikes`), #12 Which half of the verse (`which-half`) and #13 Quick ten (`quick-ten`). None of them needs new data: each uses per-word accents, phrase index per word and word timings, which exist today.

**Every example below is proposed; Claude Code verifies against the engine.** Word numbers count from 0, as in lessons.json, with a maqaf-joined pair as one word (as lessons.json does for Genesis 22:2 [1,1] קַח־נָ֠א) and the paseq not counted. Two kinds of source:
- **From lessons.json**: the mark comes from that example's `tropes` and the word number from its `words` range.
- **Read on Sefaria** (Miqra according to the Masorah, read 2026-10-23): Genesis 1:2, 1:29, 6:9 and 22:2. The marks were read off the text by eye; the word numbers are a hand count. All four verses are already in lessons.json, so all are word-ready in the engine.

## Findings first

1. **Validator limits that the new types hit.** `course.ts` caps each activity's `items` at 8 (Quick ten needs 10), lets a lesson's drills total 8 to 22 items, and refuses unknown `type` and unknown params. Each new type needs a `parseActivity` case, an entry in `DRILL_TYPES` if it is a drill, and a `drillSkill` answer. The placements below keep every lesson within 22 items.
2. **Which half, heard alone, is not reliable.** Played on its own, a phrase sounds the same in either half: zakef, revia and tevir are sung the same way before and after etnachta. So "which half" from one isolated phrase would be a guess. The fix: play the verse from its first word through the phrase (`"audio": "lead-in"`), so the learner hears whether the rest has gone by. The second mode, with the text on screen and the phrase alone, is a reading item. Both are below. This changes ACTIVITIES.md #12's line "the tune tells you which you are in": it should say the verse up to the phrase tells you.
3. **Geresh against azla is about what comes before, not where the mark sits.** The course (torah-azla body) calls the slanted stroke "azla" after a kadma and "geresh" when it stands alone, and the engine tags both `geresh`. So that pair is decided by the word before, and its examples have to be found by rule: a `geresh` word whose previous word carries no `kadma`. There is no lone geresh in lessons.json, and I found none in the verses I read. The related pair the eye really confuses is kadma against azla, two strokes leaning opposite ways on neighbouring words. I give both pairs below.
4. **Review cards.** Recommend that look-alikes and which-half create no review cards for now (the card model is family × melody × skill, and these teach marks and halves, not families). Quick ten answers the existing `name` cards, exactly like hear-and-name.

## 1. Same sign, different place (`look-alikes`)

**What happens.** Two words appear side by side at Hebrew Large, each carrying a look-alike sign.
- **Read mode** (default): "Which one is kadma?" The learner taps a word. No audio is needed until after the answer.
- **Hear mode**: one of the two words' phrases plays. "Hear it, then tap the word it came from." Both words must come from the same melody.

After the answer, both words show their mark names under them, the tapped word plays, then the other one, and the one-line tell for the right answer appears. A miss comes back three to five items later, as in every drill. There is no score.

### Strings

| Key | String |
|---|---|
| title | Same sign, different place |
| intro (first item only) | Some marks look alike. Where they sit tells you which one it is. |
| read prompt | Which one is {mark}? |
| hear prompt | Hear it, then tap the word it came from. |
| tell: pashta | Pashta sits on the last letter of the word, wherever the stress falls. |
| tell: pashta, doubled | Two pashtas on one word: the first shows the stressed syllable, the last is the pashta itself. |
| tell: kadma | Kadma sits on the stressed syllable, so it can be inside the word. |
| tell: kadma, near the end | Kadma is close to the end here, but not on the last letter. |
| tell: mahpach | Mahpach sits under the stressed syllable and leads into the next word. |
| tell: yetiv | Yetiv sits before the first letter, to the right of its vowel. |
| tell: azla | Azla comes right after a kadma. Its stroke leans the other way from kadma's. |
| tell: geresh | The same stroke with no kadma before it is geresh. |

### Pairs and examples

Each item shows one word from column A and one from column B; the item's answer is either one.

**Pashta or kadma** (`pashta-kadma`)

| # | A: pashta | B: kadma | Source | Why this pair |
|---|---|---|---|---|
| 1 | Numbers 6:26 word 2 פָּנָיו֙ | Numbers 6:26 word 0 יִשָּׂ֨א | lessons.json (torah-zakef, [0,3]) | Same verse: pashta at the very end, kadma one letter short of it. A hard item; use it after the easy ones. |
| 2 | Genesis 1:29 word 8 אֲשֶׁר֙ | Genesis 1:29 word 3 נָתַ֨תִּי | Sefaria | Kadma plainly inside the word, on the stressed syllable. The easy item. |
| 3 | Genesis 1:2 word 2 תֹ֙הוּ֙ | Exodus 40:18 word 0 וַיָּ֨קֶם | Sefaria; lessons.json (torah-azla) | The doubled pashta, against a kadma inside the word. Uses the "doubled" tell. |
| 4 | Genesis 22:2 word 10 שָׁם֙ | Numbers 6:25 word 0 יָאֵ֨ר | Sefaria; lessons.json (torah-tevir) | One-syllable pashta word against a kadma just before the last letter. |
| 5 (haftarah) | Isaiah 43:21 word 0 עַם־זוּ֙ | Isaiah 54:11 word 4 הִנֵּ֨ה | lessons.json (haftarah-zakef, haftarah-azla) | For hear mode in the haftarah tune. |

**Mahpach or yetiv** (`mahpach-yetiv`)

| # | A: mahpach | B: yetiv | Source | Why this pair |
|---|---|---|---|---|
| 1 | Leviticus 1:1 word 2 וַיְדַבֵּ֤ר | Genesis 6:9 word 0 אֵ֚לֶּה | lessons.json (torah-zakef) | The clearest shapes: mahpach under a middle letter, yetiv before the first. |
| 2 | Genesis 22:2 word 9 וְהַעֲלֵ֤הוּ | Genesis 22:2 word 12 עַ֚ל | Sefaria | Both in one verse. |
| 3 | Leviticus 19:16 word 0 לֹא־תֵלֵ֤ךְ | Genesis 6:9 word 0 אֵ֚לֶּה | lessons.json (torah-zakef) | Mahpach on a maqaf-joined pair. |
| 4 (haftarah) | Isaiah 49:15 word 0 הֲתִשְׁכַּ֤ח | Hosea 14:2 word 0 שׁ֚וּבָה | lessons.json (haftarah-zakef) | Hard item: in שׁ֚וּבָה the first letter is also the stressed one, so position before the vowel is the only clue. |

**Kadma or azla** (`kadma-azla`): same item shape. The two words are neighbours, so one example gives both.

| # | Verse, words | Source |
|---|---|---|
| 1 | Genesis 22:11 words 0–1 וַיִּקְרָ֨א אֵלָ֜יו | lessons.json (torah-azla) |
| 2 | Deuteronomy 34:5 words 0–1 וַיָּ֨מׇת שָׁ֜ם | lessons.json (torah-azla) |
| 3 | Genesis 1:29 words 3–4 נָתַ֨תִּי לָכֶ֜ם | Sefaria |
| 4 (haftarah) | Amos 9:12 words 0–1 לְמַ֨עַן יִֽירְשׁ֜וּ | lessons.json (haftarah-azla) |

**Azla or geresh** (`azla-geresh`), reading only (ruled by Daniel, 2026-10-23: no listening version). The learner sees each word with the word before it, and the question is "Azla or geresh?"
- A side, azla: any kadma-azla example above.
- B side, geresh: found by rule. A `geresh` word whose previous word has no `kadma`, in a word-ready verse, outside the special-melody passages. Claude Code picks four, two Torah and two haftarah.
- Hear mode for this pair is dropped. Daniel ruled on 2026-10-23 that azla against geresh is a reading-only item, so no listening variant is built, now or later.

### Schema, in lessons.json's style

A new top-level `lookAlikes` object, beside `families`:

```json
"lookAlikes": {
  "pashta-kadma": {
    "title": "Pashta or kadma",
    "marks": ["pashta", "kadma"],
    "examples": [
      { "a": { "ref": "Numbers 6:26", "word": 2, "text": "פָּנָיו֙", "mark": "pashta" },
        "b": { "ref": "Numbers 6:26", "word": 0, "text": "יִשָּׂ֨א", "mark": "kadma" },
        "why": "Same verse: pashta at the very end, kadma one letter short of it.", "hard": true },
      { "a": { "ref": "Genesis 1:29", "word": 8, "text": "אֲשֶׁר֙", "mark": "pashta" },
        "b": { "ref": "Genesis 1:29", "word": 3, "text": "נָתַ֨תִּי", "mark": "kadma" },
        "why": "Kadma plainly inside the word, on the stressed syllable." }
    ]
  },
  "mahpach-yetiv": {
    "title": "Mahpach or yetiv",
    "marks": ["mahpach", "yetiv"],
    "examples": [
      { "a": { "ref": "Leviticus 1:1", "word": 2, "text": "וַיְדַבֵּ֤ר", "mark": "mahpach" },
        "b": { "ref": "Genesis 6:9", "word": 0, "text": "אֵ֚לֶּה", "mark": "yetiv" },
        "why": "Mahpach under a middle letter, yetiv before the first." }
    ]
  },
  "azla-geresh": {
    "title": "Azla or geresh",
    "marks": ["geresh", "geresh"],
    "context": "previous-word",
    "rule": { "a": "geresh after kadma", "b": "geresh with no kadma on the word before" }
  }
}
```

The activity, inside a lesson's `activities`:

```json
{ "type": "look-alikes", "params": { "pairs": ["pashta-kadma", "kadma-azla"], "items": 3, "mode": "read" } }
```

Validator checks Claude Code would add: `mark` equals the engine's accent on that word; `text` equals the engine's word (NFC); hear mode only when both words are word-ready in the lesson's melody; `hard` items never first in a run.

### Placement

| Lesson | Add | Drill items after |
|---|---|---|
| torah-zakef | `look-alikes`, pairs `mahpach-yetiv`, items 3, read | 12 → 15 |
| torah-azla | `look-alikes`, pairs `pashta-kadma` and `kadma-azla`, items 4, read | 12 → 16 |
| haftarah-azla | `look-alikes`, pairs `pashta-kadma` (haftarah item) and `azla-geresh`, items 3, read | 10 → 13 |

## 2. Which half of the verse (`which-half`)

**What happens.** The verse is shown uncoloured with a hairline gap after the etnachta word.
- **Lead-in mode** (default): the recording plays from the verse's first word through the end of one phrase, then stops, and that phrase is underlined.
- **Phrase mode**: only the phrase plays, and the learner finds it in the text.

The learner taps one of two buttons. After the answer, the half the phrase is in takes a light tint, the etnachta phrase takes its colour, and the tell line appears. Misses come back later. There is no score.

**Pool rule.** Phrases of the listed families in verses that have exactly one etnachta, 6 to 18 words long (longer than the usual 5 to 12, because the lead-in needs room for phrases on both sides of the rest). Leave out the etnachta phrase and the sof pasuk phrase themselves, which are trivially one half or the other. Keep the special-melody exclusions. Items are about half before and half after.

### Strings

| Key | String |
|---|---|
| title | Which half of the verse |
| prompt, lead-in | The verse plays up to one phrase. Is that phrase before the rest, or after it? |
| prompt, phrase | Find the phrase you heard. Is it before the rest, or after it? |
| button 1 | Before the rest |
| button 2 | After the rest |
| tell, before | Before the rest: this phrase is in the first half. |
| tell, after | After the rest: this phrase is in the second half, on the way to the ending. |

### Examples (proposed; Claude Code verifies)

| Verse | Phrase | Half | Source |
|---|---|---|---|
| Genesis 1:2 | zakef on word 3 וָבֹ֔הוּ | before | Sefaria |
| Genesis 1:2 | zakef on word 8 אֱלֹהִ֔ים | after | Sefaria |
| Genesis 22:2 | zakef on word 5 אֶת־יִצְחָ֔ק | before | Sefaria |
| Genesis 22:2 | zakef on word 11 לְעֹלָ֔ה | after | Sefaria |

These are good because each verse has the same family on both sides of the rest, so only the lead-in can settle the answer.

### Schema

```json
{ "type": "which-half", "params": { "families": ["zakef"], "items": 4, "audio": "lead-in", "verseWords": [6, 18] } }
```

`audio` is `"lead-in"` (default) or `"phrase"`. In `intro-phrases`, where no family names are taught yet, `families` can be every family in the melody, because the learner answers only before or after.

### Placement

| Lesson | Add | Drill items after |
|---|---|---|
| intro-phrases | `which-half`, all families, items 4, lead-in | 8 → 12 |
| torah-zakef | `which-half`, `["zakef"]`, items 4, lead-in | 15 → 19 (with look-alikes) |
| haftarah-zakef | `which-half`, `["zakef"]`, items 4, lead-in | 14 → 18 |

## 3. Quick ten (`quick-ten`)

**What happens.** Ten hear-and-name items over the families the learner has heard, three choices each. After each answer, the right chip settles and the phrase shows in its verse for about 1.5 seconds. Then the next phrase plays on its own, so there is no Next button. There is no timer. A plain "Stop here" link stays at the bottom. Missed items come back at the end of the ten, as in every run. Answers update the `name` cards.

It lives on the course home and on the review page, not inside a lesson. It appears once three families are heard in that melody.

### Strings

| Key | String |
|---|---|
| home row | Quick ten: ten phrases, one after another, about 2 minutes |
| title | Quick ten |
| prompt | Which phrase is this? |
| stop link | Stop here |
| end, no misses | Done. |
| end, with misses | Done. The ones you missed come back in review. |
| empty (fewer than three heard) | Quick ten opens after three phrases. |

### Schema

A new top-level `practice` array, beside `units`, for runs that are not lessons:

```json
"practice": [
  { "id": "quick-ten-torah", "melody": "torah", "title": "Quick ten", "summary": "Ten phrases, one after another",
    "unlockAfter": "torah-zakef",
    "activity": { "type": "quick-ten", "params": { "families": "heard", "items": 10, "choices": 3, "autoAdvanceMs": 1500 } } },
  { "id": "quick-ten-haftarah", "melody": "haftarah", "title": "Quick ten", "summary": "Ten phrases, one after another",
    "unlockAfter": "haftarah-zakef",
    "activity": { "type": "quick-ten", "params": { "families": "heard", "items": 10, "choices": 3, "autoAdvanceMs": 1500 } } }
]
```

`unlockAfter` is the lesson that makes three families heard (sof pasuk, etnachta, zakef). `"families": "heard"` is new: the families done in that melody at run time, with distractors weighted by `confusedWith` as usual. The validator needs an `items` cap of 10 for this type only.

## Tone check

I grepped every string above for exclamation points and the banned list in `src/lib/learn/tone.ts`: none found. All prompts and labels are 80 characters or less, which fits the validator's limit for `label` and `prompt`.
