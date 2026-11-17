# Practice recipes and correction behavior

24 October 2026. Detailed design draft for the [lesson specifications](LESSON-SPECIFICATIONS.md) and [passage progression](PASSAGE-AND-INDEPENDENCE.md). All sample learner copy is proposed. Nothing here changes the approved release strings or claims that the app can hear a learner.

## Core behavior

Teach before asking for a distinction. Keep early practice easy enough to focus on the intended skill. An uncertain answer leads to explanation/model and another useful action, not a harder retry or a completion trap. Offer more practice without requiring everyone to complete the same count.

Separate three kinds of feedback:

| Attempt | What the system can know | Appropriate response |
| --- | --- | --- |
| Selecting a known sound/mark answer | Whether the choice matches the authored question's target | Explain the target, replay the relevant anchor and allow another attempt |
| Singing without app recording/analysis | Only that an action was taken or what the person reports | Guide a specific comparison and repair; allow uncertainty; do not issue a vocal score |
| Preparing/performing for a competent listener | What that listener actually observes under those conditions | Optional relevant feedback through existing relationships; no new compulsory tutor gate |

Listening-model playback must show the sounding word with the outline treatment throughout lesson/drill contexts. A written answer must not visually imply that it was the active playback word. Instructional family colors retain their separate purpose.

## Recipe P1: hear, follow and echo

**Purpose:** first auditory/vocal connection to actual words. **Before:** basic decoding and a suitable short model, not knowledge of a family name.

Show one phrase, play the model on a clear action, then let the learner echo without a sounding leader. Prompt: “Listen to the phrase. When it stops, chant it back.” Replay and accurate slower playback remain available. Let an experienced learner proceed without repeated introduction.

If difficult, choose a smaller musically sensible unit or work on the words, then return to the whole phrase. No family quiz at this stage. Continuing records participation under existing contracts, not correct singing.

## Recipe P2: two familiar sound anchors

**Purpose:** easy recognition after teaching. **Before:** both alternatives have been modeled and echoed separately in the chosen melody/tradition.

Keep two replayable anchors visible, using stable, clearly identified examples. Prompt: “Listen, then choose the ending you hear.” Options identify the taught anchors and can include their names, signs and sound controls; color alone is insufficient. A listening control must not accidentally submit its answer.

Start with the known examples. Introduce a fresh example only after explaining that words may change while the target pattern remains relevant. Prefer controlled source context; do not make changing singer/timbre the initial challenge. No compulsory opening same/different question.

On an incorrect choice: “This example uses {taught target}. Listen to it again, then compare the two models.” Highlight/show the relevant cue and let the person replay before retrying or returning to teaching. A miss does not lower their overall level. If the item is ambiguous or the model unavailable, withdraw it rather than insist the learner is wrong.

## Recipe P3: connect sound and written cue

**Purpose:** help a learner reuse a sound from text. **Before:** a taught sound and a clear actual-text example.

Show the mark on the sounded word, hear the phrase, and offer a supported find-the-mark/phrase action. Prompt: “Here is the mark for this example. Find it in the phrase.” Then use that phrase in a sung attempt. An ear-first learner can open this depth without having to pass a naming task.

On a miss, reveal the actual cue in its word and replay the phrase. Do not infer a listening deficit from a sign-selection mistake. Build-sign tiles and look-alikes are optional extensions after meaningful examples.

## Recipe P4: try from text, then check

**Purpose:** retrieve a learned chant without following a currently sounding voice. **Before:** usable text and a modeled/practiced unit.

Prompt: “Chant this phrase without the recording. Then listen to the reader.” Keep the reference user-controlled after the attempt. Offer one check focus at a time: words/stress, the taught pattern, or a connection. Do not ask novices to assess every feature simultaneously.

Useful actions: “Work on a word”, “Practice the tune”, “Try again”, “I'm not sure”. Uncertainty opens a narrower model/comparison and optional help; no voice accuracy is inferred. When copy discusses matching, explicitly refer to the relevant words/pattern rather than copying the reader's timbre or range.

## Recipe P5: bridge a join

**Purpose:** combine locally familiar parts. **Before:** each part has been attempted separately.

Model enough text across the boundary to preserve musical sense. Prompt: “Listen across the join, then try it.” Let the learner rehearse the bridge and immediately return to the whole verse or two-verse span.

If A and B each work but A→B fails, offer the bridge; do not send the person to unrelated taxonomy. No default instruction to pause at every visual phrase division. Existing verified word boundaries and reference playback supply the range; no invented timestamps.

## Recipe P6: delayed return

**Purpose:** retain production and the ability to repair. **Before:** earlier supported work on that text.

Prompt on a later visit: “Try this verse before replaying it. Then choose anything to revisit.” Reference and word help stay available afterward. A learner who forgets can restore a relevant aid and practice, without being demoted or forced to start the course again.

Recognition cards can continue alongside this task; they do not replace it. Use the existing review/privacy contracts and coordinate with N19. This draft prescribes no new algorithm, universal day interval or notification.

## Recipe P7: deliberately varied listening

**Purpose:** recognize a taught target beyond the exact starter. **Before:** that target is familiar in a stable model/context.

Vary one important source of difficulty at a time where the asset set permits: new words or location before an unexplained new voice. Explain a later voice change: “A different reader can sound different. Listen for the pattern you practiced.” Let the person revisit anchors.

Content authors must check that the new example realizes the stated target and that context/variant differences do not invalidate the answer. Do not promise uniform variants or acoustically identical phrases across legitimate traditions. A failed generalized item is a reason for targeted help or item review, not proof that earlier progress was false.

## Recipe P8: prepare fresh material

**Purpose:** reuse a preparation method, beyond recognition transfer. **Before:** experience preparing a short passage with the loop.

Give a suitable different passage with normal reference resources. Prompt: “Choose a manageable part. Decide what you need to practice, then connect it to the rest.” Let learners plan, prepare, attempt and repair. Do not impose surprise sight-reading or forbid recordings.

Ask a useful reflection: “What would you work on next?” Offer word/pattern/join/whole-reading choices and a direct action. The app can support this process without independently verifying the sung result. Later authorized outcome observation can examine what help was actually needed.

## Catalogue labels and question validity

Current `lessons.json` groups some related signs/patterns under a broader family heading: azla includes geresh/gershayim; pazer includes examples tagged telisha gedola. Current `pools.ts` can score family-based same/different using bucket equality. This source behavior does not establish that every pair within a bucket sounds the same, or that a novice has been taught the distinction being scored.

For new easy recognition, author explicit target examples and taught alternatives. Keep variant/pattern identity clear in instructional content even if the library navigation retains broad headings. Do not silently expand strict reference-source parsers with unverified speaker metadata. Source creator credit is not proof of singer identity; unknown identity stays unknown.

## Content authoring record

For each recognition/model set, specify reference, melody/tradition, existing unit range, exact taught target, alternate answers, source/context comparability, known variants, actual explanation and the return-to-reading action. Check runtime audio/timing availability through existing contracts. The next document, [STARTER-EXAMPLES.md](STARTER-EXAMPLES.md), supplies concrete catalogue candidates without copying protected media.

Examples are ordinary content QA, not a new release-approval requirement for already-open human recordings. No new audio is generated or learner recording collected. These recipes are an implementation-ready description of intended behavior, with actual audibility and learning outcomes still unverified in this planning pass.
