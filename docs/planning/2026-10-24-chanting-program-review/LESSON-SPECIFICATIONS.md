# Lesson specifications and existing-content migration

24 October 2026. Detailed curriculum draft. Daniel reports that the coordination message was sent and authorized continuing. Application implementation remains with Claude's release stream. This document specifies teaching for all 24 existing lesson IDs, preserving link identities where practical while changing their instructional role.

Source: `src/lib/learn/lessons.json` in study main `02d8af2`. The Torah/haftarah curriculum files are unchanged from `4a99b7f`; the newer commit adds 2.0 service text. Ranges below are zero-based inclusive engine word-unit ranges from the existing catalogue, not manually invented audio timestamps. No Hebrew text or recording is reproduced. Existing catalogue entries identify candidates; they do not prove playback availability, clarity, or suitability for a particular learner.

## Shared lesson contract

Basic pointed-Hebrew decoding is assumed. The default route reaches a meaningful sung phrase and a short joined verse early. Every library lesson is directly reachable; familiar work can be bypassed. Ear-first, rusty, sign-knowledgeable and experienced learners can enter at the relevant step. Names and sign exercises remain available without becoming universal chanting prerequisites.

Each sound lesson uses: orient in real text → clear model → echo → optional sign/name explanation → easy practice with taught alternatives → production without a sounding leader → focused comparison/repair → return to a phrase or reading. Practice depth varies. No compulsory item quota or single successful quiz certifies vocal skill.

Use existing reference audio and timing contracts. Hearing/seeing a model, answering a recognition question, reporting practice and demonstrating a chant are distinct evidence. The app does not hear the learner. An unavailable model produces a useful retry/alternative, never a success state or a silent substitute for teaching.

For detailed drill recipes and correction copy, see [PRACTICE-AND-FEEDBACK.md](PRACTICE-AND-FEEDBACK.md). For the real-reading flow beyond this catalogue, see [PASSAGE-AND-INDEPENDENCE.md](PASSAGE-AND-INDEPENDENCE.md).

## Opening and first verse

### 1. `intro-phrases` — start making a chant

- **Job:** help someone follow and try a short real phrase; explain that a longer reading can be prepared in parts.
- **Candidate:** Genesis 1:1, full 0–6; catalogue A = 0–2, B = 3–6. These are useful source-defined segments, not universal equal halves.
- **Teach:** hear the verse; focus one segment; make its words comfortable; hear and echo; try without a leader; replay a specific uncertainty. Outline the sounding word throughout lesson playback.
- **Copy:** “Listen to this phrase. When it stops, chant it back.” Optional explanation: “We’ll prepare the verse in short parts, then connect them.”
- **Practice:** no same/different, endpoint or which-half entrance test. Replay, word help, an attempt and a return point are useful opening activities.
- **Next:** continue into the short-verse task or a relevant ending lesson; experienced readers can go directly to their reading. Finishing orientation does not assert family recognition or vocal accuracy.

### 2. `torah-first-verse` — prepare a short verse early

- **Job:** complete the smallest preparation loop, including a transition and an independent whole-verse attempt.
- **Candidate:** Genesis 1:1, 0–6, with A = 0–2 and B = 3–6. Alternatives already catalogued: Numbers 6:26 and Deuteronomy 6:4; review actual musical/text demands rather than choose by word count alone.
- **Teach:** use [WORKED-FIRST-READING.md](WORKED-FIRST-READING.md). Model/echo parts, practice the boundary with surrounding words, then attempt the whole and repair.
- **Practice:** reference after the attempt, targeted word/part/join replay, optional relevant sound lesson. Do not require completion of the ten-family catalogue first.
- **Evidence:** self-reported practice is distinct from checked performance. No claim that this is the person's assigned/weekly verse if a separate curated starter was used.
- **Next:** return to the selected reading, expand into a small passage, or revisit an uncertain family. This lesson is an early teaching task, not the endpoint of the whole program.

## Torah sound and sign library

### 3. `torah-sof-pasuk` — use an ordinary verse ending

- **Candidate:** Numbers 6:26, 4–6; existing tags mercha, tipcha, silluq.
- **Teach:** model/echo the complete ending phrase, show its closing mark, and put it back into the verse. An isolated final word can help locally but does not replace practicing its lead-in.
- **Practice:** produce this ending; after another anchor is taught, offer easy recognition using replayable anchors. Distinguish an ordinary verse ending from a special end-of-reading realization when applicable.
- **Repair:** separate uncertain words from uncertain melody; replay the ending, then its surrounding phrase.
- **Next:** use a real verse ending in the current reading; connect it to the preceding phrase.

### 4. `torah-etnachta` — use the other early structural anchor

- **Candidate:** Genesis 1:1, 0–2; tipcha, munach, etnachta.
- **Teach:** hear/echo this phrase, connect its written cue to the sound, and hear what follows in the complete verse. Do not describe every etnachta as an instruction to insert a literal silence.
- **Practice:** once this and the ordinary ending have been taught, use a stable-voice contrast from the starter verse. Begin with models available and a clear target; naming is optional depth.
- **Repair:** replay the relevant anchor and phrase, then produce it before the next part.
- **Next:** join the two parts of the first verse. An etnachta lesson need not precede all authentic singing.

### 5. `torah-zakef` — apply a common internal pattern

- **Candidate:** Genesis 2:24, 4–5; munach, zakef-katan.
- **Teach:** model the useful phrase and relevant lead-in; show the mark on its word; return it to the neighboring text.
- **Practice:** echo, produce from this text, then recognize among already-taught anchors. Introduce a further lead-in variant only with its own model.
- **Repair:** work on the lead-in or ending that is actually uncertain, then reconnect. Do not replace production with multiple sign/structure challenges on the default route.
- **Next:** use in a current verse; offer look-alikes and structural analysis as optional depth.

### 6. `torah-revia` — learn and retrieve another useful sound

- **Candidate:** Genesis 1:2, 0–0; revia. The short tagged unit is a starting model, not the complete surrounding preparation task.
- **Teach:** model the word, then the containing phrase; show the sign. Keep any contour explanation specific to the heard model rather than assert an unverified universal note sequence.
- **Practice:** echo → independent attempt → recognition among taught patterns → use in context. Compare to zakef only after both sounds are familiar.
- **Repair:** return to the short model, then immediately retry within the larger phrase.
- **Next:** bridge into what follows; retain the sound through a later phrase-level return.

### 7. `torah-tevir` — prepare a pattern with its lead-in

- **Candidate:** Genesis 1:4, 0–1; darga, tevir.
- **Teach:** hear how the two tagged words connect; echo the unit before separating any local difficulty. Show the relevant signs with this sound.
- **Practice:** produce the connected pattern; offer endpoint/pattern recognition only after the task and options are taught.
- **Repair:** rehearse across the lead-in-to-ending connection, then the surrounding verse.
- **Next:** apply at a real occurrence; arranging signs is optional and does not establish sung accuracy.

### 8. `torah-azla` — distinguish patterns collected under one library heading

- **Candidate:** Genesis 22:11, 0–1; kadma, geresh. The existing lesson also discusses geresh and gershayim.
- **Teach:** start with the specific kadma/geresh model; introduce another included pattern separately when needed. Explain the chart grouping without promising that everything under it is the same tune.
- **Practice:** imitate/apply the taught pattern. Later recognition must identify the actual taught target, not rely solely on a broad family bucket.
- **Repair:** replay the correct variant and its local context; make sign look-alikes optional after sound/mark teaching.
- **Next:** follow the encountered pattern back into the reading; no requirement to learn all included variants before a first verse.

### 9. `torah-segol` — prepare a connected longer unit

- **Candidate:** Genesis 1:7, 0–2; munach, zarka, segol.
- **Teach:** model the full unit, then manageable parts; retain enough context to show how they connect. Show the relevant marks on actual words.
- **Practice:** echo the connected model, focus a difficult part, then attempt the whole and join it to surrounding text.
- **Repair:** address the transition as well as the separate sounds; recognition is supporting practice after teaching.
- **Next:** apply where this pattern is needed; it is not a universal prerequisite to a beginner's first verse.

### 10. `torah-telisha-ketana` — carry a short pattern into what follows

- **Candidate:** Genesis 2:22, 0–0; telisha-ketana.
- **Teach:** model the tagged word and the next relevant words so a short sample is not mistaken for a complete stop. Explain the mark only as far as useful for the current attempt.
- **Practice:** imitate the local sound, then the continuation. Offer taught-option recognition later.
- **Repair:** if the one-word model works but the passage stalls, practice the join.
- **Next:** contextual reading/help. Visual naming and which-phrase work are optional depth.

### 11. `torah-pazer` — learn the needed extended pattern without conflating cousins

- **Candidate:** Genesis 1:21, 7–7; pazer. Existing lesson examples also include telisha gedola and the broader catalogue may include karnei farah.
- **Teach:** a specific pazer example, its actual words and its context. Give each included distinct pattern its own model when relevant; do not present the chart grouping as acoustic sameness.
- **Practice:** make a comfortable vocal attempt, then apply in context. No demand to imitate the model's range or exact timbre.
- **Repair:** choose a useful segment without breaking the musical unit arbitrarily; return to the complete realization and its continuation.
- **Next:** just-in-time help or optional library exploration. Whole-bucket same/different scoring is unsuitable without a defined, taught distinction.

### 12. `torah-zakef-gadol` — distinguish a related written and musical pattern

- **Candidate:** Genesis 9:13, 0–0; zakef-gadol.
- **Teach:** model it in context. If comparing with small zakef, teach/review each model first and describe the specific audible distinction for the selected examples.
- **Practice:** imitate and use the target. A side-by-side reference is more useful initially than an unexplained cross-voice discrimination test.
- **Repair:** keep the word and sign together, then include its neighbors.
- **Next:** apply in the current reading or revisit later; no default full-catalogue gate.

## Direct-entry haftarah library

The following lessons use haftarah models from the start. Torah exposure may help some learners, but is not a required entrance test or a source of substitute audio. Use the shared teaching loop with haftarah-specific content; comparisons with Torah are optional for learners who know both.

### 13. `haftarah-sof-pasuk` — ordinary haftarah verse ending

- **Candidate:** Isaiah 40:1, 3–4; tipcha, silluq.
- **Teach/practice:** hear, echo and produce the ordinary ending with its words; connect it to the whole verse. Show the relevant mark with this melody.
- **Check/repair:** a focused local model and retry, not a test of whether the person already distinguishes Torah from haftarah.
- **Next:** the early haftarah verse or the other anchor. Distinguish the special end-of-haftarah cadence when the actual context needs it.

### 14. `haftarah-etnachta` — prepare the first part of a short haftarah verse

- **Candidate:** Isaiah 40:1, 0–2; mercha, tipcha, etnachta.
- **Teach/practice:** echo this actual phrase, connect the sign, then hear/produce its join to 3–4 of the same verse.
- **Check/repair:** after both anchors are taught, replayable same-voice recognition can support the distinction. Do not test cross-melody identity first.
- **Next:** a complete Isaiah 40:1 attempt; no preceding full Torah catalogue.

### 15. `haftarah-zakef` — prepare a haftarah internal phrase

- **Candidate:** I Kings 19:12, 0–2; mahpach, pashta, zakef-katan.
- **Teach/practice:** model the actual lead-in and ending; echo, produce and apply. Optional sign explanation uses the marks in this example.
- **Check/repair:** practice the uncertain local sound or transition; do not assume a general contour sentence fits every lead-in. The existing candidate's tags and any prose about a different lead-in must be reconciled.
- **Next:** surrounding verse and a useful later example.

### 16. `haftarah-revia` — retrieve the haftarah realization in text

- **Candidate:** Isaiah 52:7, 2–3; munach, revia.
- **Teach/practice:** model/echo the connected words, show the relevant sign, try independently and put the unit back in its passage.
- **Check/repair:** compare one focus with the model, then retry; later compare with another familiar haftarah anchor.
- **Next:** join into neighboring material rather than stop at naming the family.

### 17. `haftarah-tevir` — connect lead-in and ending

- **Candidate:** Isaiah 6:3, 4–5; darga, tevir.
- **Teach/practice:** connected model, short echo, text-based attempt, surrounding phrase. Learners may already know the sign without knowing this melody.
- **Check/repair:** isolate the uncertain connection, then reintegrate. Do not infer skill from prior Torah drill completion.
- **Next:** actual occurrence in the selected haftarah.

### 18. `haftarah-azla` — prepare the specific included pattern

- **Candidate:** Isaiah 54:11, 4–5; kadma, geresh.
- **Teach/practice:** give this model before introducing other included variants such as gershayim; connect each taught sound to its actual marks/text.
- **Check/repair:** use variant-specific anchors. Shared chart membership does not make all included clips one audible target.
- **Next:** reading application or optional further variants, as needed.

### 19. `haftarah-segol` — integrate a multiword pattern

- **Candidate:** Jeremiah 32:17, 0–2; zarka, munach, segol.
- **Teach/practice:** hear the whole connected unit, work on manageable parts and reconnect before returning to the passage.
- **Check/repair:** practice where the transition fails; avoid treating isolated recall as sufficient.
- **Next:** relevant current-reading occurrence; supporting recognition after models.

### 20. `haftarah-telisha-ketana` — prepare its continuation

- **Candidate:** I Kings 19:7, 0–0; telisha-ketana.
- **Teach/practice:** model the local word and enough following context to learn the continuation, then produce the joined unit.
- **Check/repair:** repeat the bridge if the isolated word is secure; offer sign help separately.
- **Next:** current phrase, with no required memorization of comparisons to Torah.

### 21. `haftarah-pazer` — targeted help for an extended pattern

- **Candidate:** Isaiah 54:17, 9–9; pazer. Other existing examples under this heading include telisha gedola.
- **Teach/practice:** model the specific target in context; make the text comfortable; echo, attempt and rejoin. Separate included variants instructionally.
- **Check/repair:** useful smaller unit, reference comparison and return to the complete phrase; comfortable individual range remains valid.
- **Next:** actual passage or optional reference exploration. No whole-bucket sound-equivalence test.

### 22. `haftarah-zakef-gadol` — distinguish a taught related pattern

- **Candidate:** Isaiah 40:16, 0–0; zakef-gadol.
- **Teach/practice:** haftarah model, echo, mark connection and independent contextual attempt. Review small zakef if a comparison would help.
- **Check/repair:** keep two known models available before optional discrimination; do not make vocal identity the hidden task.
- **Next:** selected verse and its joins.

### 23. `haftarah-sof-haftarah` — use an actual end-of-reading cadence

- **Candidate:** Hosea 2:22, 3–4; catalogue marks tipcha, silluq; teaching target is the recorded closing realization in its end-of-reading context.
- **Teach/practice:** hear ordinary versus final context with each model explained, then prepare the actual final phrase and its approach.
- **Check/repair:** the sign sequence alone does not establish the special realization; validate context and model identity. Do not label every shortened shared selection's last verse a traditional haftarah ending without an appropriate model/decision.
- **Next:** integrate into a complete reading ending; ordinary first-verse practice need not wait for this special case.

### 24. `haftarah-first-verse` — an early complete haftarah preparation task

- **Candidate:** Isaiah 40:1, 0–4; A = 0–2, B = 3–4. Other existing candidates: Hosea 2:21 and Isaiah 43:21 with their own source-defined parts.
- **Teach/practice:** use the worked first-reading flow with haftarah models, words, joins and focused repair. Available early; a complete Torah path and every rare haftarah pattern are not prerequisites.
- **Check/repair:** independent whole-verse attempt followed by a useful comparison and targeted work. Unavailable weekly audio routes to an honestly labelled suitable example.
- **Next:** a short haftarah passage, contextual sound help and later fresh preparation. One verse is a useful accomplishment, not a certificate of whole-haftarah readiness.

## Migration semantics

Preserve existing lesson IDs and completed history wherever the current implementation can do so without false claims. Revising the sequence must not revoke a learner's access or silently convert old completion into demonstrated vocal competence. Existing link behavior should remain understandable; visible recommendations and direct access must agree.

No new schema is specified here. Claude should reconcile any activity/schema additions with current validators, progress and N19 before implementation. Additional passage/independence capabilities may be delivered in existing reading/practice surfaces rather than added as more catalogue lessons.

## Content QA, not a new approval gate

Existing authentic human recordings are already open under the current study checkout's CLAUDE/MISSION amendments. Selecting clear, appropriate examples and checking teaching cues is ordinary content QA; this document does not introduce a new Daniel listening-release requirement for them. Generated-chant G3 remains separate and unchanged. No recordings were auditioned in this milestone, and no actual sound-quality acceptance is claimed.
