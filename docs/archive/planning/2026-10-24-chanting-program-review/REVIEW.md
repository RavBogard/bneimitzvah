# From wanting to chant Torah to being able to do it

24 October 2026. Structural review of the learning program. **Consultation and planning only; coordinate with the active Claude Code stream before implementation.** No application changes, tests, installation, commits, messages to another task or deployment accompanied this review.

## Judgment

**The current system has valuable learning resources and practice tools. Its present instructional structure does not justify a reliable promise that a person new to chanting will become an independent Torah chanter by completing it.** Daniel clarified that basic Hebrew phonetic ability is assumed. The core outcome therefore starts with someone who can decode pointed Hebrew; teaching initial Hebrew literacy is outside that promise. Musical experience, prior chanting knowledge and support still vary substantially.

The review must also assess whether people with partial, rusty or advanced chanting ability can enter at a useful point and address their actual gaps. [ENTRY-POINTS-AND-SUPPORT.md](ENTRY-POINTS-AND-SUPPORT.md) records the clarified baseline and proposed flexible paths. Lack of a complete Hebrew-literacy bridge is no longer a core deficiency against this scope; passage-specific words, stress and spoken forms still need usable support.

The largest gap is the connection between its parts: hearing and reading a model, producing the chant, identifying an error, choosing useful practice, joining a passage, reducing support, and preparing the next passage. The app often provides a tool or a completion mark where a learner needs a taught method and feedback.

The earlier [learning-path review](../2026-10-24-learning-path-review/REVIEW.md) diagnoses exercises and sequencing. This review goes above that level: it asks what capability the whole program must develop, how its components cause that development, and what evidence could support the product's claim. The earlier 24-lesson inventory remains valid; it is not duplicated here.

Read [PROGRAM-ARCHITECTURE.md](PROGRAM-ARCHITECTURE.md), [READINESS-AND-VALIDATION.md](READINESS-AND-VALIDATION.md), [EVIDENCE.md](EVIDENCE.md), and [CLAUDE-CODE-HANDOFF.md](CLAUDE-CODE-HANDOFF.md) alongside this report.

## 1. Define the promise before selecting exercises

Working outcome for design, subject to Daniel's musical and congregational judgment:

> A person who can decode pointed Hebrew can prepare an appropriate Torah passage using available resources, chant the prepared text without a voice leading them, notice and repair common problems, and use a repeatable process to prepare another passage.

For public scroll reading, add the transition to unpointed text and the relevant performance context. This is a proposed operational definition, not a new ritual ruling or permission to claim the outcome has been achieved.

Several accomplishments must be distinguished:

| Accomplishment | What it establishes | What it does not establish |
| --- | --- | --- |
| Recognize a family sound | A useful perceptual distinction | Accurate pronunciation or ability to sing it from text |
| Echo a phrase | A first auditory-vocal connection | Ability to retrieve it later without the model |
| Chant one prepared passage | A real and worthwhile performance | A general method for preparing another passage |
| Prepare a new suitable passage using normal resources | More transferable preparation ability | Immediate sight-chanting of any text or mastery of special melodies |
| Chant prepared material from unpointed text | An important scroll-reading capability | Every aspect of public performance or indefinite retention |

**Independent preparation can include recordings, a tikkun, dictionaries and other references.** Independence is not defined as never using a tool. Ear-first preparation and trope-based preparation are both valid paths; memorizing a carefully prepared reading is not dismissed as an illegitimate accomplishment. The stronger promise is that the person has learned a reusable way to prepare, rather than only one recording.

Do not promise universal sight-reading, every melody, every special passage or identical progress for all starting points. State the ordinary-reading scope and teach people when to seek an appropriate model or help.

## 2. The actual skill is a coordinated performance

Successful chanting draws on more than family recognition:

1. **Text:** identify and pronounce the intended words, apply appropriate syllables/stress, and handle the spoken reading where written/read forms differ.
2. **Sound:** hear the characteristic melodic shapes and imitate them in a comfortable voice/register.
3. **Written cues:** connect relevant signs and text patterns to a usable sound, to the extent the learner's chosen preparation method requires.
4. **Phrasing:** join words into phrases and phrases into verses without losing pronunciation, structure or the musical frame.
5. **Preparation strategy:** break down a passage, identify the next difficulty, use a model effectively and target repetition.
6. **Self-monitoring:** notice what is wrong or uncertain, distinguish a word problem from a tune/transition problem, and choose a correction.
7. **Independence:** gradually work without continuous reference playback or visual scaffolding; use unpointed text where required.
8. **Continuity and recovery:** sustain a passage, retain place and recover from a stumble or interruption.
9. **Retention and transfer:** return after a delay and prepare another suitable passage without being led through every decision.

No single family quiz measures all of this. A course needs repeated opportunities to combine these capabilities, not merely a list of separate modules that assumes the combination will happen.

## 3. Current coverage against that capability chain

Classification distinguishes an active teaching sequence from an available tool and from proposed/in-flight work. Baseline: main `4a99b7f`, `C:/Users/dsbog/bneimitzvah-study`.

| Capability | Present contribution | Structural gap |
| --- | --- | --- |
| Using decoded Hebrew in a chant | Basic phonetic decoding is assumed; pointed text, human recordings and word aids support actual words | Teach how to resolve difficult words and carry them into the phrase; a complete initial-literacy course is not required by the clarified scope |
| Syllables/stress/read forms | Word-card information and qere/ketiv apparatus | Explanations are available; applying them to new words is not developed as a systematic learning progression |
| Hear family sounds | Exemplar recordings, descriptions, contours and recognition drills | Real curriculum exists, but starter assessment and uncontrolled voice/context changes can outrun instruction |
| Produce from text | Marks, phrase colors and examples; later chant-along | Recognition and tile arrangement do not supply a recurring model–attempt–check production sequence |
| Join a passage | First-verse phrase/whole/slow/normal flow; Up close navigation | No explicit cumulative method for word joins, phrase joins, verse transitions and sustained reading |
| Prepare independently | Strong reader, word/verse repeat and speed controls | The method for using those tools to prepare is mostly implicit |
| Fade support/scroll text | Colors and pointed/side-by-side/tikkun-only views | Controls provide states; the course does not fully teach how to move between them or recover when support is removed |
| Perform and recover | Passage navigation, service context and playback | No established learning sequence for continuous reading, retaining place and restarting after difficulty |
| Monitor/correct | Answer feedback, personal marks and staff marks | A learner's own sung errors do not become known simply because a naming answer was marked correct or the learner clicked Got it |
| Retain/transfer | Spaced family cards, variable excerpts and practice-day tools | Review is weighted toward recognition; delayed independent production and preparation of new material are unestablished |

Source anchors: word aids in `study/word-tools.tsx:101`; read forms in `study/annotations.tsx:101`; active playback controls in `study/reading-player.tsx:67–80`; support controls in `reading-toolbar.tsx:31,39–43` and `reading-prefs.ts:19–27`; Up close in `study/lift.tsx:93–115`; first verse in `learn/first-verse.tsx:32–57`; family practice in `learn/drills.tsx`; review in `lib/learn/progress.ts:77–115,150–159` and `learn/review.tsx:18–31`. The Hebrew-strand feature flag is false in `lib/service-course/course.json:3–5`, with reachability controlled by `course.ts:270–274`.

These gaps do not mean the features are absent everywhere. They mean the instructional connections and evidence for the claimed capability are incomplete.

## 4. Does it follow best practice?

There is no single scientifically certified best Torah-chanting curriculum in the evidence examined. General learning research, a complex-skills design model, relevant music research and practitioner cantillation instruction provide useful principles. Their application here remains a design judgment that needs domain and learner validation.

### Strong principles to retain

- Clear human models, understandable examples and explicit instruction.
- Manageable practice followed by progressively more demanding use.
- Frequent application in real text.
- Targeted drills alongside meaningful complete performances.
- Informative feedback and a chance to apply the correction.
- Spaced returns, gradually reduced assistance and deliberate variation.
- Teaching learners how to manage their own preparation.

### Conclusions the current research rationale does not warrant

- Every screen after the first listening must be a quiz.
- Recognition of categories will naturally become accurate chanting.
- A family catalogue is the right organizing structure for the whole learner journey.
- Randomizing books and voices supplies suitable novice examples.
- A fixed review schedule is known to be optimal for this skill.
- Completion counts or self-reports establish independent capability.
- One final unaccompanied attempt repairs an otherwise recognition-heavy curriculum.
- A six-lesson, currently unavailable Hebrew strand establishes a complete foundational pathway.

The original research report contains useful material and acknowledges limitations, but some statements marked as research conclusions are implementation choices or extrapolations. Its “make every screen a small question” rule, specific box intervals, assumed lesson lengths and implication of comprehensive teaching-order consensus need narrower claims. A source may support retrieval or spacing without supporting those exact mechanisms.

[EVIDENCE.md](EVIDENCE.md) maps each principle to sources and states its limits. The review identifies no learner-outcome study of this application. Code tests and an expert walkthrough cannot substitute for one.

## 5. The structural change: a preparation-and-performance spine

**Organize the program around increasingly independent acts of preparing and chanting real Torah.** Family lessons, Hebrew help and recognition drills become supporting strands that learners use within that progression.

Proposed spine:

1. Want to chant → understand what the activity involves and try one approachable phrase.
2. Hear and echo → connect words, sound and an understandable cue.
3. Prepare a short verse → resolve words, learn its phrases and join them.
4. Prepare a short passage → manage transitions, repetition and useful correction.
5. Chant it without a leading voice → reduce support and check what remains uncertain.
6. Prepare for the intended text/performance conditions → unpointed text and continuous run-through where relevant.
7. Return after a delay and prepare another passage → demonstrate the reusable preparation method.

This proposal is not a requirement to attempt an entire reading on the first day. Start with a small authentic task that includes words, melody and an attempt, then expand it. Keep easy sound-recognition practice where it helps. A complete performance and a targeted drill serve different purposes and should reinforce each other.

The [program architecture](PROGRAM-ARCHITECTURE.md) specifies the support strands and the teaching loop in more detail. It reuses the app's existing reader and learning assets; it does not require a replacement visual world or a parallel codebase.

## 6. Entry must address real starting points

**Daniel's clarified baseline is basic Hebrew phonetic ability.** Do not treat initial literacy as a core course responsibility or force literate learners through it. Decoding still does not establish chanting skill, fluent handling of every word, stress, trope knowledge or unpointed reading.

Review four useful starting situations: new to chanting; learns by ear or knows a memorized reading; has partial/rusty trope knowledge; can already prepare readings and needs focused help. These are flexible entry profiles, not ranks. Someone can have strong auditory imitation and weak sign knowledge, or know signs but struggle to produce and join phrases.

Use one common experience with optional starting suggestions, direct access to a reading, skippable familiar teaching, targeted support and a reversible next-step recommendation. Keep sounds, production, signs, joins, preparation, recovery and transfer distinct when considering ability. Neither Hebrew fluency nor a family-name quiz is an adequate placement measure.

The detailed [entry/support proposal](ENTRY-POINTS-AND-SUPPORT.md) specifies how each profile can reach a useful task without a mandatory diagnostic examination, microphone, account gate or permanent learner label. A shared reading does not share its owner's skill profile or private progress.

## 7. Feedback is an instructional function that needs an explicit answer

The current app can know which option was clicked. It does not hear whether the learner pronounced the words correctly, retained stress, sang an appropriate contour or joined phrases coherently. Adding “Your turn” creates an opportunity to attempt the task; it does not by itself provide feedback on that attempt.

A credible self-guided program must teach comparison and self-correction: one feature at a time, a usable reference, clear examples, manageable attempts, explanations and appropriate help. Some users will learn successfully this way. It still should not claim that an unchecked self-report validates musical accuracy.

Human feedback can supply correction in an existing lesson or live listening session. It must be identified as a contribution to learning, rather than silently assumed to rescue missing curriculum. The public app can remain usable without a tutor. Evaluating program outcomes with competent listeners is also different from requiring a tutor's approval for every person to use the app.

**No recording upload, automatic pronunciation scoring, generated voice or new instructor service is introduced here.** Those constraints remain. The review describes the feedback function to solve within them, not a demand to reopen them.

## 8. Transfer must be designed and examined

Varied multiple-choice excerpts establish practice in recognizing varied excerpts. Transfer to chanting a new passage requires a person to choose and apply a preparation process, not just recognize another item.

For a future evaluation, give a suitable passage not used as the main teaching example, allow normal preparation resources, and observe how the person approaches it and what assistance they need. After preparation, listen without a model leading. Return to familiar material after a delay. This is not a surprise sight-reading test and does not require denying tools that an actual reader would normally use.

An ear-first learner can demonstrate transfer by independently using a new reference well, resolving text and preparing a coherent reading. A mark-based learner may rely less on a full reference. Both routes can be evaluated against the intended outcome without declaring one illegitimate.

## 9. The existing roadmap is useful but insufficient alone

P4 improves presentation, accessibility and feedback defects. N17 adds relevance to the learner's reading. N18 adds production attempts. N19 adds actual-verse review and support fading. These are useful parts of the architecture.

Together they still do not fully specify foundation-to-Torah practice, cumulative joining, a repeatable preparation method, learning to recognize one's own errors, recovery during a passage, or delayed transfer. Finishing them should not automatically be reported as proving the beginner-to-capable promise.

Reconcile their work under the program spine; do not discard completed tools or start a second implementation stream. [CLAUDE-CODE-HANDOFF.md](CLAUDE-CODE-HANDOFF.md) identifies the coordination decisions before coding.

## 10. What can truthfully be claimed now, and what would establish more

**Now:** the app provides public models, study/preparation tools and structured family-recognition practice. It can support learning and independent practice. Source inspection does not establish that completing it reliably produces an independent chanter across the intended starting points.

**After an instructional redesign but before validation:** it would offer a deliberately constructed beginner-to-preparation pathway. That is a stronger design, not yet evidence of effectiveness.

**After authorized outcome evaluation:** evidence could support claims about the learners, passage types and conditions actually examined. A few successful examples would not justify a guarantee for everyone. [READINESS-AND-VALIDATION.md](READINESS-AND-VALIDATION.md) proposes practical, task-aligned checks without learner scores, new recordings or premature pilots.

## Recommendation

Treat this as program design rather than a collection of lesson fixes. First settle the capability claim and its scope, then map the preparation/performance spine, its foundation support and its feedback loop. Retain easy taught-sound drills inside that design. Align P4/N17/N18/N19 and the Hebrew/service work to it before expanding the exercise catalogue.

The product can plausibly become a strong route into Torah chanting. Its resources make that worth pursuing. The present course structure and evidence do not yet demonstrate that the full stated goal is accomplished.
