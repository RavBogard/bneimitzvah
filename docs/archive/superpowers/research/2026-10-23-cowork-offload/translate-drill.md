# The translate drill (1.4 part 3)

2026-10-23. Research and one screen design for Claude Code. Sources with dates are in `SOURCES-drill-sefaria.md`.

The spec line is in the leyning platform spec §3.4 (the handoff calls it §3.6): "Hide the English, read the Hebrew aloud in your own English, then reveal JPS and your draft." The build detail is already in `docs/superpowers/plans/2026-10-22-accounts-1-4.md` §5, "Study (PR 3)". This design follows that plan and only adds the strings and the states it leaves open.

---

## 1. Findings

1. **Learners are taught to translate in small units, from the root out.** Day-school Chumash programs teach a verse word by word: find the root, peel off prefixes and suffixes, then put the words back together in English order. Brackets mark the words English needs that Hebrew doesn't have ("[the] house [of] Levi"). This is the main scaffold for children and for adults starting out. CRC Torah already has it: Word tools give the meaning in this verse, dictionary senses, and syllables. So the drill doesn't need a new scaffold. It needs Word tools to stay open while the English is hidden.
2. **Live translation is a different skill from written translation.** Court interpreters train for "sight translation", which means reading a text aloud in another language. Their drills are reading ahead, finding the subject and verb first, breaking long sentences into units of meaning, and reading aloud for pace. This is the skill Daniel describes ("live translate"). Two things follow for the drill:
   - it should invite speaking phrase by phrase;
   - the trope's own pauses, the etnachta and the sof pasuk, are the natural units to speak in.
3. **Trying before you see the answer helps, even when you get it wrong.** Pretesting research found that guessing the translation of an unfamiliar word, then seeing the right one, improves later memory more than studying the pair alone. This held even when the guesses were wrong (Seabrooke et al., Memory & Cognition, 2021–22). Near misses helped more than wild guesses. So a "say it, then see it" drill is well grounded. The learner doesn't have to be right for it to work, and a hint like Word tools makes the attempt closer.
4. **A reveal turns into a test only when the app grades it.** Two models are worth comparing:
   - **Flashcard apps** reveal the answer and then ask you to grade yourself. Anki's buttons are Again, Hard, Good and Easy. That grading step is what makes a reveal feel like an exam.
   - **Audio courses** like Pimsleur use "anticipation": a prompt, a pause for you to answer aloud, then the answer, with no grade at all.
   
   The drill should follow the second model: reveal, then compare, then move on. That means:
   - no self-rating;
   - no "correct" or "check";
   - no count of verses done.
5. **Published translations are one reading among several.** Comparing translations is how adult study groups talk about meaning. The comparison works best when the reveal shows a published translation beside the learner's own words as two readings, rather than as an answer key with an attempt to grade. Label it "JPS", not "Answer".
6. **Glosses for rare words are a known adult scaffold.** Reader's editions of the Hebrew Bible footnote only the less common words, so the reader keeps going without reaching for a dictionary. This is a later variation (§4.4), because the app has no word-frequency data yet.

## 2. Two points for Claude Code to settle

- **Where the control sits.** The accounts plan puts "Translate drill" in "the selected verse's tools". That is Lein's model. The spec puts the drill in Study, and Study rows have no selected-verse toolbar.
  - Recommendation: show it in both places. In Study, it is a quiet control on each verse row, beside Hear. In Lein, it is in the selected verse's tools.
  - The drill state is the same in both, and it starts on the verse where you pressed it.
- **What "hide the English" covers.** If only the drill verse hides its English, the next verse's English is already showing on the page.
  - Recommendation: while the drill is on, hide the English on every verse in the passage. Also close inline Rashi, because Rashi's English carries its own translation.
  - This is a view state only. It never writes the English preference. Ending the drill restores exactly what was showing before.

## 3. The screen

### States

**A. Off.** The verse row looks as it does today, plus one control.

**B. On, before the reveal**, for the drill verse:
- Hebrew as usual, with colours if they're on, and Hear.
- In place of the English, a quiet placeholder of one line ("English hidden"), so the row doesn't jump.
- One prompt line under the Hebrew.
- Word tools still work: tap a word for its meaning. Hear still works.
- Two actions: Reveal (the primary button) and End drill (a quiet text button).
- Every other verse in the passage shows "English hidden" too. The drill verse is the selected verse, and it is scrolled into view.

**C. Revealed:**
- **JPS**, under a small label, in the usual English style.
- **My translation**, under its own small label. Members on a saved reading only, and only when a draft exists for this verse.
- One line inviting a comparison.
- Three actions:
  - Next verse (primary);
  - Hide again;
  - End drill.

**D. Last verse revealed:** Next verse is replaced by a plain line and Start from the first verse.

**E. Member on a saved reading, no draft for this verse:** after the reveal, one quiet line with a link that opens the Yours row. Nothing is saved unless they press Save in Yours, as today.

Signed out, or on an unsaved reading: there is no Yours content, no sign-in prompt and no upsell. The drill is complete without an account.

### Strings

| Where | String | Notes |
|---|---|---|
| Control, off | Translate drill | `aria-pressed="false"`. "Translate aloud" is a plainer alternative if Daniel prefers. |
| Control, on | Translate drill | `aria-pressed="true"` |
| Placeholder where English was | English hidden | Muted ink, one line |
| Prompt, state B | Read the Hebrew aloud in your own English, then reveal. | |
| Hint under the prompt | Tap a word for its meaning. Hear plays the verse. | Shown on the first drill verse only, per page view |
| Primary, state B | Reveal | |
| Quiet, states B–D | End drill | Restores the English view as it was |
| Label, state C | JPS | Edition credit at the foot of the row, as today |
| Label, state C (member) | My translation | |
| Compare line, state C | Compare it with what you said. | |
| Primary, state C | Next verse | Moves to the next verse in state B and hides it again |
| Quiet, state C | Hide again | Back to state B on the same verse |
| Last verse line | That is the last verse of this reading. | |
| Last verse action | Start from the first verse | |
| No draft yet (member, saved) | No translation of this verse yet. Write one in Yours. | "Write one in Yours" links to and opens the Yours row |
| Screen reader, on reveal | JPS translation shown. | Polite live region. Focus moves to the JPS label. |
| Screen reader, on Next verse | Verse {n}. English hidden. | Polite live region. Focus moves to Reveal. |
| Translation missing for this verse | No JPS translation is available for this verse. | Uses the existing partial-translation state. Next verse still works. |

### Behaviour

- **Nothing is stored.** The drill makes no network write, no history entry and no local-storage write. Reloading the page ends it.
- **Next verse:**
  - stays within the passage on screen;
  - in Study, scrolls the next row to the top of the view;
  - in Lein, moves the selection.
- **The keyboard:**
  - Reveal, Next verse and End drill are ordinary buttons in tab order;
  - no single-key shortcuts in v1;
  - Escape ends the drill only when focus is inside the drill controls.
- **Motion:** none. The JPS text appears in place. Reduced motion needs nothing extra.
- **Layout:** 44 px controls, and no horizontal scroll at 360 px. On a phone the three actions in state C sit in one row, with Next verse first, because it is the primary action.
- **Audio:** pressing Reveal or Next verse never starts or stops audio by itself.

### Words never used

The drill never uses these words: correct, right, wrong, check, answer, score, try again, nice, great, done, streak, progress, or any count of verses done.

## 4. Later variations (small, each one control or one setting)

1. **Half verse at a time.** Split the Hebrew at the etnachta: speak the first half, then the second, then reveal the whole JPS verse. It uses the trope engine's existing disjunctive data and needs no new text. Strings:
   - control: "Half verse at a time";
   - prompt: "Read the first half aloud." then "Now the second half.";
   - action: "Next half".
   
   Grounding: chunking in sight translation (finding 2).
2. **Hear it first.** For ear-first learners, play the verse once, then hide the audio controls until Reveal. This matches spec §3.3's "Hear it first" recall drill and shares its control. Strings:
   - prompt: "Listen, then say it in your own English.";
   - action: "Play once".
3. **Reveal another translation too.** At the reveal, also show one translation the person already chose in Compare, such as Onkelos with its English. This rehearses Daniel's own practice of translating between readings. String: "Also show {translation name}". It shows only when Compare has a choice; there is no new menu.
4. **Rare words glossed.** Before the reveal, show a short gloss under the less common words, as reader's Bibles do.
   - It needs word-frequency data for the Torah and the haftarot, which is new data. Claude Code should confirm it can be computed from texts already served, with nothing licensed stored.
   - String: "Show meanings of rare words".
5. **Whole aliyah, reveal at the end.** Hide the English for a run of verses, speak them all in a row, then reveal them all. This is closest to translating live after an aliyah. Strings:
   - control: "Whole passage";
   - action: "Reveal all".
   
   It is still nothing stored and no count.

One idea is left out on purpose: a "write down what you said" box that saves to My translation. It would break "saves nothing", and the Yours row already does that job. It is Daniel's call if he wants it later.
