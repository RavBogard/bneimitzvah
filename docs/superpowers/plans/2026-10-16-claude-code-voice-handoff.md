# Claude Code handoff: trope voice benchmark and human-source alignment

Prepared 2026-10-16 at Daniel's explicit request. This is an implementation assignment for Claude Code, superseding older model-assignment language for this voice work. The portal team retains integration and teaching-release responsibility. Start the bounded work below; do not wait for recordings to implement and test the offline infrastructure.

**Continuation boundary, 2026-10-16:** Daniel explicitly reaffirmed continuing this model-independent voice work in the separate Claude Code workstream while a full UI/UX review informs the next portal design milestone. The existing checkout is `C:/Users/dsbog/bneimitzvah-voice`, branch `voice/human-alignment`. Preserve its in-progress voice files; do not start a duplicate implementation. New portal screens, forms, navigation and visual polishing are held. No unfinished service-learning UI, production migration/import or generated audio release is authorized by this continuation.

## Objective and architectural decision

Produce intelligible, teachable Biblical Hebrew chant from the deterministic trope score. We have enough of a plan to begin implementation, but **no renderer has won a fair comparison**. Preserve reviewed Hebrew, pronunciation/stress, syllable identities, note order, melisma attachment and cadence as the source of truth. Acoustic models must realize that performance; they must not invent the trope from a musical prompt.

Compare these lanes on the same reviewed targets:

- **A: existing SoulX SVS**, with deliberately chosen phrase timing. This is the control, not the presumed winner.
- **B-human: native Hebrew human speech → reviewed alignment/vowel retiming → score-conditioned SVC.** Keep direct human chant as the teaching reference. Separate conversion damage from source/alignment damage.
- **B-TTS: automatic Hebrew speech → the same controlled conversion path**, evaluated separately. Passing with human speech does not establish arbitrary-verse TTS quality.
- **C: Hebrew DiffSinger feasibility**, initially a phoneme/data/annotation audit. Do not begin a training project or promise that a small voice bank will suffice. A commercial challenger is optional later, subject to actual terms and spending approval.

## Read first, in this order

1. `CLAUDE.md`, `AGENTS.md` if present, and `docs/planning/2026-10-15-kickoff/MISSION.md`. Later Daniel rulings take precedence over historical assignments and checklists.
2. `docs/superpowers/research/2026-10-16-chant-rendering-reassessment.md`: primary-source research, actual existing implementation, unsupported earlier claims, licensing distinctions and architecture.
3. `docs/superpowers/plans/2026-10-16-chant-renderer-benchmark.md`: twelve reference-only passages, first four-passage subset, recording protocol, evaluation record, and **Offline target-pack delivery** section. Earlier paragraphs calling the pack “next” are superseded by that delivery section.
4. `docs/planning/2026-10-15-kickoff/BENCHMARK-PACK-REVIEW.md`: independent review and limits.
5. Targeted source listed below. Historical `docs/superpowers/research/2026-10-15-trope-engine/` reports are supporting evidence, not proof of a current successful renderer.

## Existing implementation: reuse it

- `trope/benchmark-pack.mjs`, `scripts/trope-benchmark-pack.mjs`, `tests/trope-benchmark-pack.test.mjs`: shipped offline target builder. Input is `chant-benchmark-input/v1`, with explicit rights/review record assertions, exact text hash, pronunciation/performance settings, and all cadence flags. Outputs per-passage units, score, A target, B speech plan, identity map and a hashed manifest. Every target remains pending review and private/unreleased.
- Stable IDs bind the full target hash and word/syllable/note coordinates. Parity covers note count/order/MIDI/slur, syllable attachment, rests, splits and executed milliseconds. Raw score time and emitted phrase timing are distinct. **A/B identical F0 is not established**: A's zero F0 metadata is a placeholder, while B still requires real F0/voicing preparation.
- `trope/render-cli.mjs`, `trope/soulx.mjs`, `trope/soulx_runner.py`, `trope/modal_render.py`, `scripts/trope-render.mjs`: existing SVS path. Local versus Modal is execution location, not a different voice model. The existing default style remains v1; explicitly select and record experimental settings.
- `trope/speech2sing.mjs`, `trope/speech2sing.py`, `trope/soulx_svc_runner.py`, `trope/s2s_pitch.py`, `scripts/trope-speech2sing.mjs`: existing TTS-duration/SVC experiment. It has actual implementation and limited historical smoke evidence, but no completed fair human-source chant comparison. Do not reuse TTS-generated duration labels for a different human waveform.
- `trope/env/pitch_check.py` and existing engine tests provide useful analysis seams. Do not change the score engine merely to improve a model's apparent benchmark result.

The existing render drivers fetch text live. They are not the frozen offline benchmark. Consume exact private target-pack inputs rather than silently re-fetching or normalizing text.

## First implementation milestone: reviewed human alignment and retiming

Own new voice-specific modules/CLIs/tests and narrowly necessary changes to the existing voice adapters. Keep the dependency-free Node engine and its vendored assets intact; Python environments and model dependencies belong outside `trope/`, and the web app must not import Python.

1. Define a versioned, bounded private alignment record binding the exact target-pack hash, passage/word/syllable IDs, original audio hash, sample rate/channels, consent-use record, and reviewed source spans. Record consonant spans, vowel nuclei, pauses/breaths and final consonants. Separate proposed boundaries from human-reviewed boundaries. Manual corrected annotations are a valid initial input; do not claim automatic alignment accuracy without evidence.
2. Validate monotonic intervals, bounds, completeness, duplicate/missing identities, text-to-note joins and review state. Reject mismatched recordings, stale targets and incomplete provenance before processing. Preserve original audio and annotations; no destructive overwrite.
3. Implement the human-source timing adapter against the existing executed score timeline. Preserve consonant identity/order and map sustained vowels to melismas without repeated consonants or invented syllables. Produce auditable source-to-target interval mapping and the matched F0/voicing representation required by B. Make resampling, time units, unvoiced regions and split joins explicit. Review the concrete retiming method; do not assume arbitrary waveform stretching is harmless.
4. Keep original speech, retimed speech, a DSP-only pitch baseline and the eventual neural output distinguishable. The first deliverable may stop before model inference while still proving deterministic alignment/timing and adapter contracts with synthetic waveforms.
5. Add execution-result manifests around the existing target pack: immutable input/output/config/model hashes, runtime/peak-memory/error records, all retries, and a separate opaque listening-label map. Do not rebuild the existing pack or add a student-facing page. Existing wrappers do not expose a verified seed control; record that limitation honestly.

Acceptance: synthetic/explicitly permitted fixtures prove identity and duration preservation, malformed input rejection, voiced/unvoiced handling, melisma/final-consonant/split behavior, deterministic metadata, private-path containment and sanitized errors. Run focused new tests, unchanged engine/target-pack tests and repository protection checks. Use `tests/helpers/isolatedEnv.mjs` for subprocess tests. Obtain an independent review of private-data handling and benchmark identity/parity before calling this milestone complete. Report implemented versus unexecuted paths precisely.

## Then execute the bounded voice comparison

The initial subset is **P01 Genesis 1:1, P02 Exodus 35:20, P09 I Samuel 20:18, P11 I Samuel 20:27**. The existing plan lists the complete twelve. Do not reproduce licensed passage text in source/docs/issues.

Before real voice processing, obtain the actual donor/use consent and target/pronunciation review. Start with four paired spoken/sung passages, one optional correction each, a 15–25-second dry sung prompt and room silence—roughly 3–5 minutes of accepted audio, not hours of training data. Existing phone/microphone equipment is sufficient to begin; the plan contains recording instructions. Daniel or a willing adult cantor/tutor may be the donor. Their willingness is not blanket authorization for training, cloud upload or voice distribution.

Run A and B-human first; only then assess B-TTS. Preserve every failed take/retry. Blind, loudness-matched review copies must retain untouched originals and a separate identity key. Measure GPU memory/time on the actual host; the prior read-only hardware check found an RTX 4070 Laptop with 8,188 MiB VRAM, not proof that any specific configuration fits. No cloud spend or new paid service is authorized by this handoff.

Before selecting/downloading a checkpoint, verify its exact revision's official model/code/vocoder terms. The dated research records a material distinction: Phonikud G2P and Phonikud TTS have different licenses; a nonprofit synagogue is not automatically within the TTS's academic/educational restriction. Do not treat an alternative's code license as proof of its weight or reference-voice rights. Research unresolved terms while continuing synthetic infrastructure work.

## Settled product and release boundaries

- Binder/Avery standard Reform is the default; melody tables are permitted for noncommercial use and may be in this public repo, with their separate notices preserved.
- Chant **Adonai/Elohim, as in the ceremony**. **No visible transliteration.** Internal phoneme representations remain necessary. The implemented `israeli-v1` profile is a prototype setting, not a substitute for confirming difficult pronunciation details with Daniel.
- Bass/tenor/alto/soprano choices are in scope. Four independently trained/rendered voices are not a settled mechanism. Range and renderer version must be in eventual release identity; test intelligibility and melody over the actual released ranges.
- Never commit licensed text, student/family data, voices, rendered audio, model weights or secrets. Real benchmark inputs, annotations, recordings and outputs stay outside the public checkout. Existing permitted engine fixtures do not authorize importing arbitrary new texts.
- Student submissions are retained for one year after the ceremony, then deleted. That rule does not establish retention or consent for an adult reference/training corpus.
- **No learner receives generated chant before G1, G2 and Daniel's G3 listening approval.** G1 includes the existing ±50-cent stable-note criterion; separately assess missing/extra notes, cadence, transitions and text attachment. G3 requires at least 95% melody passes and zero “would teach wrong.” ASR is diagnostic, not pronunciation certification. A pilot winner is not a release grant.
- Daniel remains the only human product tester until feature completeness. A consenting adult recording donor is not an invitation to run a student/family pilot.

## Workspace boundary and deliverable

The shared portal checkout has unrelated, uncommitted service-learning work. **Do not reset, stash, stage, commit, reformat or repair those files.** Do not edit portal UI/auth/database/provider code, `STATE.md`, or service-learning return notes from this voice assignment.

Prefer your own worktree/branch from the existing published `origin/main` (at handoff, `29854eb693642c37b12ad980ae7d6019b8861ab8`), which already includes the target pack. Read this handoff from the original checkout first; it is newly saved there. If a worktree is created, use independent dependencies; never junction `node_modules` back into the main checkout or recursively delete a linked dependency tree. If working in the shared checkout, restrict edits/commits to your explicitly owned voice files and coordinate before shared test/build operations.

Finish each bounded milestone with one voice-specific return note: changed files, commands/results, private artifact hashes without content, evidence versus hypotheses, remaining blockers, and the exact next action. Identify only the consequential requests for Daniel: pronunciation/key/target review, donor and voice-use scope, any later spend/rights decision, and blind listening. Do not wait for those answers to build the synthetic alignment/retiming infrastructure. Do not deploy or merge unrelated portal changes.
