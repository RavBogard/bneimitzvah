# Generated chant voice: strategic report

2026-10-22. Desk research and code reading only. Nothing was installed, trained, uploaded, bought or sent. Sources are in `SOURCES.md`; the decisions only you can make are in `QUESTIONS-FOR-DANIEL.md`; the first experiment is specified in `EXPERIMENT-1.md`.

---

## Page one

**Recommendation.** Stop work on the three October approaches. They are called "lanes" below: SoulX-Singer, and speech converted into singing from your voice and from a Hebrew TTS. None shows a path to great. One approach has a real chance: a Hebrew chant model trained on real chant in our own tradition, using DiffSinger, a free open-source singing-synthesis program. It would learn from PocketTorah first, and from Cantor Finkel's lossless (full-quality, uncompressed) recordings for the final voice, and the trope engine would drive it. Test that once, with Experiment 1. It costs $0 and about 25 minutes of your listening. Build the voice only if it passes; one retry is allowed if only the engine-driven half fails. If it fails, close the question for good.

Separately, none of the uses on our list *needs* generation:

- **The 400-verse gap** is about two hours of chant. One recording session would close it (estimated $850–5,000).
- **Keys within a few semitones** can come from pitch-shifting the human recordings while keeping their natural vocal colour.
- **Trope drills** can be about 112 short recorded motifs.

A generated voice adds two things: any verse, and any key or voice type, all in one consistent voice.

**Why this path, and only this one.** Every failure you heard in October fits one explanation (we think so; it is untested): the system had never heard Hebrew chant.

- SoulX knew no Hebrew sounds.
- The TTS→SVC lanes started from *speech* and stretched it into singing. TTS is text-to-speech; SVC is singing voice conversion. That is where the ה→ח, the clipped endings and the "reverb" came from.
- A model trained on 32 hours of real chant in exactly the style you called "perfect" learns those sounds directly.
- The engine already supplies what this model takes as input: each sound, its length, and the pitch. So the melody stays exact.
- DiffSinger's code is under a permissive licence (Apache-2.0, which allows our use), is actively maintained, and can export a frozen model for boring long-term rendering.

**One new problem.** PocketTorah's files are heavily compressed MP3s, about 31 kbit/s on average (CD-quality MP3s are usually 128 kbit/s or more). I estimated that from file sizes; Experiment 1 confirms it. A voice trained only on PocketTorah would sound like a low-quality MP3, so it is good for teaching the model Hebrew chant but not for the final sound. That is why Finkel's recordings matter.

*(Correction, 2026-10-22: Finkel's FLAC files wrap lossy sources, mostly MP3s, a third of them at 256 kbit/s. About 1.65 h is clean chant. They are better than PocketTorah but not studio quality; see `FINKEL-DATA-COUNTS.md` and `VOICE-BUILD-PLAN.md`.)*

**What "great" means.** Three tests, with one choice for you:

1. **Correct.** Zero "would teach wrong" in the release review sample: 59 verses with no failures shows at least 95% correct with 95% confidence. G1 and G2 run automatically on every file. Per your ruling, the system is approved as a whole, not verse by verse.
2. **Fine to learn from.** In a blind review with real recordings mixed in, at least 95% of generated verses are rated "fine to learn from".
3. **Hard to tell from the real reader.** Same verse, same reader, blind, 36 pairs: you pick the real one 23 times or fewer, which is not reliably better than a coin flip. 24 or more means you can tell.

**Ruled 2026-10-22:** tests 1 and 2 are enough, and test 3 is not required. Each review round is 15 minutes at most.

**Money and time.**

- Experiment 1: $0, a few days of laptop and agent time, about 25 minutes of you.
- Full build if it passes: $0–250 of optional cloud GPU, plus possibly one Finkel session to fill gaps ($300–1,500 plus studio time).
- Running cost: $0 a month on Cloudflare R2 (a storage service with a free tier that covers this) for every verse in four voice ranges. On Vercel Blob it is only within budget if the portal is already on Vercel's paid Pro plan (§11).

**First experiment and its kill rule.** Train on PocketTorah, holding back 12 verses. Then render those 12 two ways. In the "perfect conditions" render, the model gets the reader's real timing and pitch. In the "engine" render, it gets only what our engine supplies. You hear both, blind, mixed with the real verses.

- **Kill:** the perfect-conditions render has any "would teach wrong", or fewer than 10 of 12 "fine to learn from".
- **Continue:** the engine-driven render passes the same bar.
- **One retry:** perfect-conditions passes but engine-driven does not.
- The full ordered rule is in `EXPERIMENT-1.md` §10.

**Answered 2026-10-22:**

- Yes to any verse and any key.
- Train on PocketTorah and Finkel. Finkel's consent is on record.
- OpenVPI vocoder approved for the pilot.
- Cloud spend up to $25 without asking.
- Experiment 1 is cleared to run.

**Later answers, same day** (the full list is in `QUESTIONS-FOR-DANIEL.md`):

| Topic | Ruling |
|---|---|
| Great | Correct plus fine to learn from; indistinguishability not required |
| Voice | Finkel's voice, unnamed |
| Style and pace | Plain teaching chant at PocketTorah's pace |
| ח, ע, ר | Modern Israeli, with ר always pronounced |
| ה | Always audible |
| Sheva and doubled consonants | Follow the reader |
| Gap haftarot | Generate them |
| Keys | Pitch-shift only; no upper voice for now |
| Other keys of human recordings | Pitch-shifted human recording |
| Blessings, High Holy Day trope, Megillot | Release 2.5 |
| Release gate | System-level approval: automatic checks on every file plus a sampled blind review; no second listener and no per-verse review |
| Listening rounds | 15 minutes at most |
| Hosting | Vercel Blob |

**Only you can decide** (each answerable in a line; details in `QUESTIONS-FOR-DANIEL.md`):

1. May we train privately on PocketTorah for the experiment?
2. Is test 3 required for great?
3. Will you send Finkel the consent note? It is needed before his voice is used, not before Experiment 1.
4. May the experiment use OpenVPI's non-commercial vocoder privately? (The vocoder is the stage that turns the model's output into sound.)
5. Should pronunciation match the PocketTorah reader on ר, ח, ע, sheva and doubled consonants?
6. Who else listens?
7. Spend later, if Experiment 1 passes.

---

## Contents

1. What has changed since 16 October
2. What "great" means, and how to measure it
3. W1 — Value case: is generation the right tool?
4. W2 — State of the art, late 2026
5. W3 — Hebrew language layer
6. W4 — Data strategy
7. W5 — Options compared (matrix)
8. W6 — Evaluation design
9. W7 — Consent, law, ethics and community
10. W8 — Prior art in Jewish learning technology
11. W9 — Engineering, cost and operations
12. Staged plan, with G1/G2/G3 placement
13. Red team: the case for the runner-up and for not building at all
14. Risks, and what would change the recommendation

Evidence labels used throughout: **Verified** means we read the licence file, code or statute ourselves. **Claimed** means the paper or vendor's own claim, not independently checked. **Ours** means measured or heard in this project. **Estimate** means our judgement, with no primary source.

**Glossary** (terms used more than once):

- **Acoustic model**: the part of a singing synthesiser that turns sounds, lengths and pitch into a sound picture.
- **Vocoder**: the part that turns that picture into audio.
- **TTS**: text-to-speech.
- **SVC**: singing voice conversion, which re-voices existing audio in another singer's timbre.
- **Phone**: one speech sound.
- **Alignment / aligner**: finding where each word or sound starts and ends in a recording. **CTC** and **MFA** (Montreal Forced Aligner) are two kinds of aligner.
- **Melisma**: several notes sung on one vowel.
- **Cents**: hundredths of a semitone.
- **Formants**: the resonances that give a voice its colour. **Formant-preserving** pitch shifting changes the note without making the voice sound chipmunk-like.
- **RMVPE / FCPE**: pitch trackers.
- **Whisper**: a speech-recognition model.
- **CER**: character error rate, the share of characters a recogniser gets wrong.
- **LUFS / dBTP**: loudness and peak-level units.
- **ONNX**: a frozen, portable model format.
- **Licences:**
  - **Apache-2.0 / MIT / BSD**: permissive; our use is allowed.
  - **GPL / AGPL**: permissive for private use; conditions apply if shipped.
  - **CC BY-NC**: non-commercial only.
  - **SA** (share-alike): derived works carry the same licence.

---

## 1. What has changed since 16 October

- **PocketTorah's audio is low bitrate.** The MP3 folder totals 442 MB for about 31.9 hours, about 31 kbit/s (estimate from file sizes; confirm with a file-inspection tool in Experiment 1). The format is fine for listening, but it caps how good a voice trained only on it can sound. Typical singing-synthesis datasets are recorded at 44.1–48 kHz, lossless, in a dry room. Finkel's package is lossless FLAC at 44.1/48 kHz (from the handoff).
- **DiffSinger is alive and fits our inputs.** OpenVPI DiffSinger is at v2.5.1 (2026-01-08), with commits through 2026-10-16. The code is Apache-2.0 (Verified). The model that produces sound takes a phone sequence, phone durations and a pitch curve. A phone is a single speech sound. Those are exactly what our engine produces. Custom phone sets were rebuilt in v2.5.0. Multi-speaker training and export to ONNX (a frozen, portable model format) are built in (Verified from repository docs).
- **The usual DiffSinger vocoder is non-commercial.** OpenVPI's shared vocoder weights (PC-NSF-HiFiGAN) are CC BY-NC-SA 4.0 (Verified). The maintainer said on 2026-10-04 that the licence covers the weights, not the audio they produce, and that no commercial licence exists. The clean fix is to train our own vocoder with OpenVPI's MIT-licensed training code.
- **Phonikud TTS is probably excluded for anything we publish.** Its licence is CC BY-NC 4.0, "intended only for academic research and educational use. Commercial use and non-academic non-commercial use are not permitted" (Verified). A synagogue's study portal is educational but not academic, so it most likely falls outside, though that is not certain. Only the authors could settle it, and contacting them is your call. Its paper (July 2026) says its voices were trained on Hebrew speech generated by Gemini.
- **BlueTTS, a newer Hebrew TTS, does not cleanly replace it.** Light-BlueTTS is MIT-licensed but takes plain Hebrew text, not phonemes. The BlueTTS 2.5 model that does take phonemes carries no licence tag, and its card warns to "check rights before shipping". Its training data is undisclosed and probably includes non-commercial corpora (Verified in the README and model card; data provenance unclear).
- **A likely cause of ה→ח, untested.** SoulX-SVC's code sends voiceless frames with pitch 0, and the model fills them from what it learned on Mandarin-heavy singing. Mandarin "h" is pronounced [x], almost the same sound as ח (code Verified; cause is a hypothesis). Two cheap fixes exist: keep pitch through ה between vowels, or splice the original audio back in on voiceless consonants. This matters only if a conversion lane is revived.
- **No commercial editor sings Hebrew.** Synthesizer V Studio 2 and ACE Studio have no Hebrew. Synthesizer V's voice licence forbids feeding its renders into "a singing synthesis or speech synthesis model … or any data-driven workflow", which rules out running them through conversion (Verified clause 3.2(3)). It also has no headless (unattended) export.
- **Nobody has shipped generated chant that cantors respect.** The only widely used generated chant was TropeTrainer's DECtalk voice (c. 1999–2019): clergy relied on it for twenty years despite an "eerie robot tenor", because it covered everything and could be controlled. Every product since 2012 uses human recordings. The "AI" bar mitzvah apps of 2026 use AI to align and give feedback, not to generate chant (Secondary).
- **Law.** Missouri has no voice or likeness statute. All 2026 bills died. Consent defeats both Missouri publicity torts, so the question is staying inside what was consented to. In a 2025 federal case (Lehrman v. Lovo, SDNY), the court let contract claims over "research only" limits in a voice-recording deal, and state publicity claims over an AI voice clone, go forward (a ruling on a motion to dismiss, not a final judgement). So Finkel's "unrestricted" recording licence should be backed by a separate written consent to build a voice model (Secondary: law-firm summary; not legal advice).
- **New automatic check.** Apache-2.0 Whisper models that write Hebrew as stressed IPA now exist (whisper-heb-ipa, licence and CER 1.54% on speech per its model card, which gives no date). IPA is the international phonetic alphabet. They are useful for catching wrong sounds before you listen, as a diagnostic only, since they are trained on speech.

Corrections the 16 October reassessment already made still stand. In particular, the earlier "15–30 minutes of DiffSinger data, two weekends" estimate rests on one thesis without listening tests, and pitch conditioning is not proof of correct words.

---

## 2. What "great" means, and how to measure it

Starting from the handoff's draft, here is what I keep and where I push back.

**Keep: correct before beautiful.** A student imitates what they hear. One confidently wrong vowel is worse than an obviously synthetic voice. Correctness is a gate, not a score.

**Push back: "a cantor cannot tell it from the real reader" should not be the only definition.**

- No singing-synthesis paper I found reports passing an expert forced-choice test. The best open single-singer systems score about 0.4–0.75 points below the real recording on a 1–5 listener scale (Claimed, authors' own tests).
- Students do not need indistinguishability. They need correctness, clarity at slow speed, and consistency.
- But your bar was "great, or it's not worth doing". So the third test below is offered as the strict reading, and you choose.

**The definition, as measurable tests:**

| # | Test | How measured | Pass |
|---|---|---|---|
| 1 | **Correct** | Automatic checks, then a human review of **every generated verse** that will be released. Zero "would teach wrong" cannot be shown by sampling. Key and range variants of verses that have already passed review are checked on a 59-verse sample per range (§8), because those transforms do not change words; that carries a small stated risk. | Zero "would teach wrong"; G1 (every note within ±50 cents, none missing or extra) on every file; G2 technical checks on every file |
| 2 | **Fine to learn from** | Blind review, generated verses mixed with hidden real recordings at matched loudness and audio quality. Each clip is marked: fine / flag words / would teach wrong. | At least 95% of generated verses "fine"; real recordings must themselves score at least 95% "fine", or the review is recalibrated |
| 3 | **Hard to tell** (strict reading of great) | Same verse, real against generated, "which is the real reader?", 36 pairs per round | You pick correctly 23 or fewer times out of 36, which is not reliably better than chance. 24 or more out of 36 (or 10 or more out of 12 in a single round) means you can reliably tell, and test 3 fails. |
| 4 | **Consistent and teachable** | The whole portion in one voice; clean at 0.5× speed; each voice range checked | No verse flagged as "different reader"; 0.5× playback flagged on no more verses than real recordings are |

**G1, G2 and G3** sit inside this. G1 and G2 are automatic and run on every file. G3 (at least 95% melody passes and zero "would teach wrong") is test 1 plus the melody part of test 2, on the release set. Tests 2–4 go beyond G3. That is the "great" bar.

**Your time.** Every round is designed to take 30 minutes or less (§8). Full-release correctness review is shared with a second listener (§8).

---

## 3. W1 — Value case: is generation the right tool?

| Use | Cheapest route to great | Needs generation? | Evidence |
|---|---|---|---|
| **Gap-fill: 18 special haftarot, about 400 verses, about 2 h of chant** | One recording session by a cantor or experienced tutor. Estimate: 6–12 h of preparation, 6–10 h of studio time, 4–8 h of editing. About $850–1,000 (tutor, recorded at CRC), about $2,700 (cantor in a studio), about $5,000 (senior cantor). Finkel is the obvious reader. His voice differs from PocketTorah's reader, but each haftarah is one whole reading, so a student hears one voice per portion. | **No.** You ruled that these stay text-only for now; this is the route if that changes. | Rates are Secondary: tutoring rates, St. Louis studios ($30–125/h) and audiobook production analogies. No published price exists for a commissioned portion recording. |
| **Other gaps** (36 Torah verses, 2 unrecorded haftarah verses, 22 muted by a duplicate-reference bug) | Fix the software bug and do review work; record the 2 verses | No | Ours (2026-10-22 coverage doc) |
| **Voice ranges / keys** | (a) Pitch-shift the human recordings while preserving their vocal colour (Rubber Band R3): likely natural within about ±2–4 semitones, needs a listening test at ±5–7. (b) A real alto or soprano requires a consenting adult upper voice, either by converting the human recordings into that voice (SVC) or by a model trained on that voice. Shifting a man up an octave does not sound like a woman. | Partly. Keys: no. True upper voices: conversion of human audio is enough, with no new verses. | Shift quality: Claimed and academic (formant studies; listener scores about 61/100 for the best classic method at 6 semitones). Conversion: Ours, on speech only. |
| **Tempo** | Already solved: pitch-preserving playback of human audio | No | Ours |
| **Trope drills and trope-chart buttons** | Record about 112 short motifs (62 Torah + 50 haftarah cells), about 8–12 minutes of finished audio, about $150–500 for one voice. Finkel's 22 drill clips may cover part. Pitch-shift for keys. | No | Estimate |
| **Custom verse ranges** | Verse-level human cuts already cover almost all Torah | No, except in the gaps | Ours |
| **Per-word timings** | Alignment of human audio, which is the same alignment work Experiment 1 needs | No | Ours |

**Verdict.** No use on the list strictly requires a generated voice. A generated voice is worth building only if you want a single system that chants any verse, in any key and any voice type, without commissioning recordings. That is a real advantage: it scales, and it makes the portal independent of finding readers. But it is a convenience, not a necessity. So it clears your bar only if the voice is truly good. That is why the plan spends almost nothing before a decisive test.

---

## 4. W2 — State of the art, late 2026

The full notes are summarised here. "Control" means we can dictate each sound, its length and its pitch.

**Score-driven singing synthesis** (makes singing from a score; the model learns a singer):

- **OpenVPI DiffSinger.** Full control: phones, durations and the pitch curve are inputs. It learns any phone set. Training code and data-prep tools are published (MakeDiffSinger BSD-3; aligners MFA MIT, HubertFA Apache-2.0). There is no official pretrained base, and with 32 h we do not need one. Code Apache-2.0; the weights would be ours. Very active. **First choice.** Training memory on 8 GB is an estimate: a reduced batch, mixed precision, and possibly training the two decoders separately. It is common on 16 GB cloud notebooks, so it is tight but plausible on the 4070.
- **VISinger2** (ESPnet version, Apache-2.0). A credible second choice; the official repository has no licence and has been stale since 2024-11.
- **NNSVS/ENUNU.** Dormant since 2023.
- **SoulX-Singer.** Still no training code; Mandarin, English and Cantonese only. Dead end, as heard.
- **TCSinger 2.** No weights.
- **TCSinger and StyleSinger.** Trained on non-commercial data; Chinese and English only.
- **Vevo2.** Weights CC BY-NC-ND.
- **YingMusic-Singer.** Takes its melody from audio, not notes.
- **Whole-song generators** (ACE-Step, DiffRhythm, LeVo, SongBloom, Seed-Music, Suno, ElevenLabs Music). No per-note or per-phone control. Not applicable.
- **Expected quality.** These are listener scores out of 5, from each paper's own authors (Claimed):

  | Dataset (size) | System | Generated | Real recording |
  |---|---|---|---|
  | PopCS (5.9 h) | DiffSinger | 3.85 | 4.30 |
  | Opencpop (5.2 h) | VISinger2 | 3.81 | 4.32 |
  | M4Singer (29.8 h) | best open system | 3.92 | 4.52 |
  | Ofuton-P (about 1 h) | best open system | 3.05–3.49 | 4.77 |

  So 3–30 hours of one good singer lands about half a point below real. Passing the real recording through a vocoder alone costs about 0.3. There are no peer-reviewed numbers for the 2024–26 DiffSinger.
- **New languages.** Low-resource singing synthesis handles new phones either by training on target-language audio (our case) or by mapping onto known phones. That earlier trick is what failed for SoulX. A 2025 MSc thesis adapted English DiffSinger to German with 30 minutes. Phone-mapping tricks matter only when target data is tiny; ours is not.
- **Melisma and free rhythm.** Not a problem for DiffSinger. A melisma is many notes sung on one vowel. Durations are in seconds with no beat grid, so a melisma is just a long vowel with a moving pitch curve (Verified in docs).

**Singing voice conversion** (re-voices existing audio):

- **SoulX-SVC** (Apache-2.0 code and weights; uses Whisper-base as its content encoder) remains the clean option, and accepts any target pitch file (Verified in code).
- **RVC/Applio** (MIT, revived July 2026) is the main permissive option we could train ourselves on about 10 minutes of a consenting voice.
- Excluded on licence or weights:
  - Seed-VC: GPL, archived 2025-11-21.
  - so-vits-svc: AGPL, archived.
  - YingMusic-SVC and FreeSVC: non-commercial weights.
  - HQ-SVC: GitHub has no licence, though Hugging Face now shows an Apache tag. Unclear.

**Vocoders** (turn the model's output into sound):

- PC-NSF-HiFiGAN takes pitch explicitly, which is the best guarantee for G1, but its shared weights are non-commercial. Train our own with the MIT code. 20–30 h of one voice is ample.
- BigVGAN v2 (MIT) is the fallback. It does not take pitch, so G1 must be checked carefully.

**Pitch trackers for checking:** RMVPE (Apache-2.0) and FCPE (MIT) both get about 95–97% of frames within 50 cents on singing benchmarks (Claimed). Use the median per note for G1.

**Commercial editors:**

- **Synthesizer V Studio 2.** No Hebrew. It allows per-note phoneme and language overrides, but scripting cannot export, and its licence bars conversion workflows.
- **ACE Studio.** No Hebrew. Custom voices need a 30–100 minute cloud upload, the subscription breaks the running budget, and use is limited to personal or internal purposes.
- **Vocaloid 6.** No Hebrew.

None is a path to great Hebrew.

---

## 5. W3 — Hebrew language layer

**Text to phones.** The engine already handles every hard case named in the handoff: sheva na/nach (havarotjs rules plus two local repairs), qamatz qatan from the MAM codepoint, dagesh forte, furtive patach, mil'el/mil'ra from MAM's doubled accents, two-accent words, qere/ketiv, and the divine name (Ours, from the prior digest). What is *open* is not the rules but **which sound to produce**. The profile is marked "not yet confirmed with Cantor Finkel", and no document records what the PocketTorah or Finkel readers actually do.

**Inconsistency to fix.** Lane B's speech plan dropped doubled consonants while the engine doubles them. In a trained model, the phones used for training labels and the phones used at render time **must be the same profile**, or the model learns a mismatch.

**Pronunciation choices** (proposed defaults; the deciding rule is that the voice should match its own reference reader, whom you called "perfect"):

| Point | Proposed default | What it hinges on |
|---|---|---|
| ר | Uvular, as in modern Israeli speech | What PocketTorah's reader does; measurable |
| ח | Velar/uvular fricative [χ], merged with כ, not pharyngeal | The reader. No open TTS can produce pharyngeal ħ anyway; a trained chant model *can* if the reader does it. |
| ע | Glottal catch between vowels, otherwise silent | The reader |
| ה | **Always audible** at the start of a syllable and with mappiq; voiced between vowels | Teaching value. The October ה→ח defect shows this must be treated explicitly. |
| Vocal sheva | Short full [e] | Careful readers sound sheva na. Matches the engine. |
| Doubled consonants | Follow the reader (modern speech does not double; some sung practice does) | The reader. Keep one profile for both training and rendering. |
| Stress | From the accent mark | Already settled |

Practical route: before asking anyone, measure what the PocketTorah reader does on these points. Use the Hebrew IPA recogniser plus simple acoustic cues on a few hundred aligned words (voicing at ה, the friction spectrum at ח, gap length at doubled consonants). This is derived numbers only, inside your existing authorisation.

**Hebrew speech models (2026):**

| Model | Status for us |
|---|---|
| Phonikud TTS | Blocked (academic-only licence) |
| BlueTTS | MIT, accepts phonemes, 44.1 kHz, runs on CPU; training data undisclosed (medium-low confidence that it is clean) |
| QwenTTS-he | Apache-2.0 adapter, IPA input; about 16 GB to train |
| Magpie-he | NVIDIA Open Model licence, IPA, no cloning |
| Chatterbox V3 | MIT, but takes letters not phonemes, and watermarks its output |
| MMS-TTS Hebrew | Non-commercial |
| HebTTS, LoTHM | No licence file |

None gives per-phone timing.

**Automatic recognition (ASR) for checking:**

- ivrit.ai Whisper fine-tunes (Apache-2.0; output words).
- whisper-heb-ipa and renikud/whisper-he-ipa (Apache-2.0; output stressed IPA). They have no ħ, ʕ, alveolar r or doubled consonants, so they cannot check those.
- All are trained on speech, so on chant they are triage only, and are compared against the same verse sung by a real reader.

**Aligners:**

- MFA has no Hebrew model but can train one on our own data.
- Singing aligners (SOFA, HubertFA) have MIT/Apache code, but their checkpoints are Mandarin/English and non-commercial.
- CTC aligners shorten held vowels. A CTC aligner is the kind of speech-recognition aligner used in October.
- Best for chant: **score-informed** alignment, meaning our known syllable-to-note map plus pitch tracking, with a phone aligner only inside each syllable. A 2018 paper doubled onset accuracy on opera singing this way (Claimed).

**Datasets:**

| Dataset | Licence and limits |
|---|---|
| ivrit.ai | "Only for training AI models"; forbids simulating speakers' voices |
| SASPEECH, ILSpeech | Non-commercial |
| Common Voice Hebrew | CC0, but only about 7 h |

There is no large, permissive, studio-quality Hebrew singing or speech corpus. Our two chant corpora are the asset.

---

## 6. W4 — Data strategy

**How much is needed.** Opencpop-scale (about 5 h of one singer) gives a usable DiffSinger voice. M4Singer-scale (about 30 h) is more robust. Under about 1 h, quality drops sharply (§4). Community makers treat 30 minutes as the floor and 1–8 h as normal, with every phone appearing at least 20 times.

**What we have:**

- **PocketTorah, about 31.9 h.** Quantity and coverage are excellent: every Hebrew sound and every trope pattern, many times, in the target style. It is word-aligned already. Its weaknesses are low-bitrate MP3, an anonymous reader, and a new licence decision.
- **Finkel, about 7.6 h, of which about 3–4 h is clean chant.** Lossless audio, with the licence settled. Its weaknesses: nobody has listened to it, there are no validated timings, and consent for a voice model is unconfirmed.
- **Recommended combination.** One model trained on both as two "speakers". PocketTorah teaches Hebrew chant; Finkel supplies the high-quality voice that is rendered. A vocoder trained on Finkel's lossless audio sets the final sound. The fallback is PocketTorah only, at PocketTorah quality.

**Alignment.** DiffSinger's acoustic model needs, per 5–15 s segment, the phone sequence and phone durations. Pitch is extracted from the audio. Our engine supplies the phones. PocketTorah already has CTC word alignment (median onset error 34 ms). The plan:

1. Constrain each word to its existing CTC span.
2. Train MFA on this corpus with an engine-generated dictionary to place phones inside words.
3. Use the score (the known notes per syllable) and the pitch track to place vowel onsets in melismas.
4. Hand-correct nothing for the pilot. In one study, automatic labels cost only about 0.1 points of listener score (Claimed).

**Human hours.** Fully manual phone labelling would cost about 400 hours per hour of audio (classic figure), which is not an option. Correcting automatic labels takes an estimated 5–15 person-hours per hour of audio (Estimate; no measured community figure exists). The plan avoids hand correction unless Experiment 1 points to labels as the problem. If it does, a 10-minute correction pilot measures the real rate.

**New recordings.** Recommend them only after Experiment 1 passes, and only to fill measured holes in Finkel's coverage. Script design:

- Choose verses from the 7,073 so that every phone appears at least 20 times and every trope cell (62 Torah, 50 haftarah) 5–10 times. Weight towards ה/ח, word-final vowels and the gap haftarot.
- Record a normal and a slow tempo, plus spoken versions of the same verses.
- Spec: 48 kHz/24-bit, a cardioid condenser about 15 cm away with a pop filter, a dry treated room, 15 s of room tone each day, and no processing.
- Cost: the only published singer fee is about $300 per hour of recorded audio, so about $300–1,500 for 1–5 h, plus studio time.

---

## 7. W5 — Options compared

Ceiling means the best quality the path could reach. Teach-wrong risk means the chance it produces a confident error. Evidence: Ours, Claimed, Verified or Estimate.

| Option | Quality ceiling | Teach-wrong risk | Data and annotation | Compute and money | Licence status | Time to first convincing result | Maintenance | Evidence |
|---|---|---|---|---|---|---|---|---|
| **(a) Hebrew chant model on our data** (DiffSinger; PocketTorah, then Finkel) | **High.** Learns real chant sounds; capped at PocketTorah's MP3 quality unless Finkel supplies the final voice. | **Medium-low.** Sounds are explicit and inspectable; errors trace to labels or the engine. | Mostly automated alignment; Finkel needs alignment plus consent | $0 on the laptop (if 8 GB suffices); $10–45 per cloud run; $100–250 for a whole programme | Code Apache-2.0; weights ours; vocoder must be self-trained; PocketTorah training needs your decision | Days (Experiment 1) | Medium: Python/PyTorch for training, ONNX for rendering | Claimed for architecture and quality on other languages; **no Hebrew result yet** |
| **(b) Hebrew TTS → SVC with score pitch** (October's closest) | **Medium.** Speech stretched into song is structurally limited: published listener scores of about 35–44/100 against about 66–74 for proper singing synthesis. | Medium. TTS can normalise pronunciation; ה→ח; endings. | None new | $0 | **Probably excluded as shipped** (Phonikud: academic and educational only, "non-academic" use not permitted). The BlueTTS replacement has unclear licence and data. | Exists (3/35 words flagged) | High: three models chained, each with its own environment | Ours (your verdicts), plus Claimed literature |
| **(c) Splicing real chant units** | High for drills and motifs; medium-low for arbitrary text, because the melody recurs but the words do not, so it becomes sound-by-sound splicing with join and stretch artefacts | Medium (bad joins) | Heavy segmentation | $0 | Depends on source (PocketTorah BY-SA) | Weeks | Medium | Claimed (Vocaloid/UTAU literature; an Ethiopian chant thesis scored 3.9/5); no Hebrew |
| **(c′) kNN-style re-rendering** (rebuild every frame from a real reader's own recordings; kNN-SVC, MIT) | Unknown; promising as a final polish on (a) or (b) | Low to medium | 5–8 minutes of reference | $0, 8 GB | MIT code; reference rights apply | Days | Medium | Claimed only (authors' 4.16/5) |
| **(d) Converting human performances** (PocketTorah into Finkel's voice or into other ranges) | **High for timbre and range**, because the Hebrew is real. **Cannot add unrecorded verses.** | Low (words are human); watch voiceless consonants | None | $0 | SoulX-SVC Apache-2.0; outputs derived from PocketTorah are BY-SA; your decision | Days | Low to medium | Claimed (SVC on real singing is the mainstream use); Ours only on stretched speech |
| **(e) Zero-shot singing foundation models** | Unknown | High (no Hebrew sounds) | — | — | None found with Hebrew sounds, note control and permissive weights | — | — | None found in a capped search, 2026-10 |
| **(f) Commercial editors with a Hebrew sound map** | Low to medium (foreign accent, the same failure as SoulX) | Medium to high | Manual phoneme entry | $99 + voices ($699 bundle) or a subscription | Synthesizer V forbids feeding renders to SVC and has no headless export; ACE is personal/internal use with a cloud upload | Weeks of manual work | High (GUI-bound) | Verified terms; no Hebrew listening evidence |
| **(g) Hybrid (recommended shape)**: (a) for any verse; (d) or pitch-shift for ranges and keys; (h) where a human recording exists | **Highest available** | Lowest available | As (a) | As (a) | As (a) and (d) | Days to first test | Medium | — |
| **(h) Human recording only** | Highest (it is real) | Lowest | One session | $850–5,000 one-off | Clean with a contract | One session | Lowest | Secondary (rates) |

---

## 8. W6 — Evaluation design

**Automatic checks, run before you hear anything:**

1. **G1 (pitch).** RMVPE pitch tracking; the median pitch per note against the score, ±50 cents; note count and order match; the final cadence is checked separately. Any failure is fixed or excluded before review.
2. **G2 (technical).** Loudness normalised to one target, true peak below −1 dBTP, no dropouts (no silent run inside a phrase longer than the score's rest plus 100 ms), full verse completed.
3. **Sound check.** Hebrew IPA recogniser on the generated verse and on a real reading of the same verse. Flag any word whose recognised sounds differ from the real reading's beyond a set tolerance. This is a diagnostic, never a pass.
4. **Voicing at ה.** The share of voiced frames at each ה, compared with the real reader. This directly targets the October ה→ח defect.
5. **Length sanity.** No vowel stretched beyond the longest the reader actually sings that ta'am. No consonant shorter than 30 ms (Estimate thresholds; tune in Experiment 1).
6. **Learned quality predictors** (SingMOS and similar) correlate weakly with listeners on singing. Use them as a smoke test only, never as a gate.

**"Would teach wrong" categories.** Each flag is one of these. The first five are teaching errors; the last two are quality notes.

1. Wrong or missing word or syllable.
2. Wrong vowel, or sheva sounded or dropped wrongly.
3. Wrong consonant (including ה↔ח, כ↔ח, missing final consonant).
4. Stress on the wrong syllable.
5. Wrong melody: wrong motif, motif on the wrong syllable, a wrong or missing note.
6. Phrasing that misleads: a break inside a word group, or no break at a major disjunctive.
7. Quality only: timbre, artefact, breath, unnatural length.

Categories 1–5 are "would teach wrong" when audible at normal speed. Category 6 is your call. Category 7 is never a teaching failure but counts against "fine to learn from".

**Your review, kept under 30 minutes:**

- Use the existing private flag page (it records taps per word).
- Clips are blind, loudness-matched and encoded identically, so audio format is not a giveaway. 10–20% of clips are hidden real recordings, which also show your own baseline.
- Each clip gets one tap: fine / flag word(s) / would teach wrong.
- A fixed set of A/B pairs asks "which is the real reader?"
- About 16 s per verse means about 36 clips plus 12 pairs fits in about 25 minutes.
- **Power of the "hard to tell" test.** Over 12 pairs, 10 or more correct means you can reliably tell (chance of that by guessing is about 2%). Fewer than 10 is a failure to show you can tell, not proof that you can't. A listener who is truly right 65% of the time would still often score under 10. That is why test 3, if you require it, uses 36 pairs gathered across rounds: 24 or more correct means you can tell.

**Sample size behind 95% at G3:**

- Zero failures in **59** verses shows at least a 95% pass rate with 95% confidence (exact binomial).
- Allowing failures: 1 failure needs 93 verses, 2 need 124, 3 need 153.
- Small tests are unfair to good systems: a system that truly fails 2% passes a 59-verse zero-failure test only about 30% of the time.
- **"Zero would teach wrong" cannot be shown by sampling.** So every *generated* verse released is reviewed in full.
- **What the release set is.** Generated chant is only rendered where no human recording exists: the gap verses (about 440 if they are not recorded by a person) and tutor-assigned ranges that fall in a gap.
  - For the gap that is about 1.8 hours of audio. Split it: a second reviewer hears every verse, and you hear every flagged verse plus a random 59 (about 16 minutes), over a few rounds of 30 minutes or less.
  - Key and range variants (most of the 30,000 files in §11 are variants of human recordings) are checked automatically on every file, plus a 59-verse listening sample per range. That bounds their failure rate at 5% or less with 95% confidence, but does not prove zero. That is the stated risk of offering ranges.

**The panel.** A second qualified listener for the full-release pass: Cantor Finkel (also the voice owner, whose consent includes a review and veto) and/or an experienced CRC tutor. A student-facing tutor's ear catches "would a 12-year-old copy this wrong?". A cantor's ear catches nusach. Your choice.

**The cheapest decisive experiment** is Experiment 1 (`EXPERIMENT-1.md`). It tests the only high-ceiling path. Its "perfect conditions" arm tells us whether the model can sound like the real reader at all. If it cannot, nothing downstream (engine timing, pitch curves, Finkel's voice, ranges) can rescue it, and we stop.

---

## 9. W7 — Consent, law, ethics and community

This is not legal advice.

**Finkel.**

- "Unrestricted" covers the recordings. A voice that chants verses he never sang is a different thing. Courts and new state laws (Tennessee ELVIS Act; California Labor Code §927; New York GOL §5-302; Illinois's 2024 act) all draw the line at a *specific description of the intended use*. Missouri has no statute, but its common-law torts turn on consent.
- So get a short separate written consent before his voice is used in a model. The draft message is in `QUESTIONS-FOR-DANIEL.md`.
- The consent should cover:
  - each process (training, conversion, range-shifting, mixing with other data);
  - the outputs (Torah, haftarah and drills on the CRC portal only);
  - labelling and his credit choice;
  - private weights;
  - his review and veto;
  - a term of 3–5 years;
  - withdrawal and deletion;
  - what happens if he leaves CRC;
  - compensation, stated even if none;
  - never presenting it as him live or using it in services.

**PocketTorah (CC BY-SA 3.0; the 2012 post says 2.5).**

- Share-alike is triggered only when an adaptation is *distributed*. Private weights trigger nothing.
- Creative Commons' own position is that training is likely fair use in the US, in which case the licence conditions do not attach. A 2024 academic analysis concludes models and outputs are generally not adaptations.
- Copyright exposure is low. Release outputs as BY-SA with the PocketTorah credit anyway; it costs nothing.
- The real issue is the **anonymous reader's voice**. Copyright licences do not grant personality rights. A voice that sings new verses *as that reader* is a replica made without his consent: low legal risk, real ethical cost.
- So the recommendation uses PocketTorah to teach the model Hebrew chant, and renders in **Finkel's** consented voice. Never publish the weights. Never mix in non-commercial material (for example Phonikud) if weights could ever be shared.

**Community.**

- I found no Reform, Conservative or cantorial-body statement on synthetic chant, and no controversy (search was capped: "none found", not "none exists").
- CCAR Responsum 5784.2 (AI and authorship) treats undisclosed AI as *g'neivat da'at*. That supports the fixed "Claude-generated chant" label, and also crediting the human sources.
- Orthodox decisors (Auerbach, Ovadia Yosef) hold that a reproduced voice is not the reader's voice, so a generated voice is only ever a study aid, which is our use.
- Some forbid listening to synthetic female singing. That affects only alto and soprano, and only for Orthodox-leaning users.

**Disclosure:**

- the label on every generated clip;
- a one-line "what this is" link;
- human recordings always preferred when available;
- a tutor-facing "report a mistake / pull this verse" control.

**Teaching risk.** I found no study of learners copying synthetic-speech errors. That is a gap in the evidence, not evidence of safety. Learner complaints about Duolingo's AI voices and choral teachers' worries about AI demo tracks point the same way. Hold generated audio to a stricter bar than human audio. That is what test 1 does.

---

## 10. W8 — Prior art in Jewish learning technology

- **TropeTrainer (Kinnor/Buchler, c. 1999–2019).**
  - DECtalk formant synthesis, built from rules with no recordings, with trope pitch and duration rules.
  - Six voice types, ±12 semitones, 29+ traditions.
  - Valued for coverage and control, not sound.
  - Source lost in 2019; stopped working with 2020 OS updates.
  - The 2021 Hazzan Solutions web revival launched without a voice; whether it now has audio, and whether that audio is recorded, is unverified.
- **PocketTorah (2012)** was called the first to use "a human, rather than a mechanical, voice". Its reader is not named in any source found.
- **Tikun Korim** uses a professional teacher's recordings.
- **Sefaria** uses PocketTorah audio for Torah.
- **2026 "AI" apps:**
  - LainingLab ($5.99/month) syncs the teacher's own recording.
  - Kol Torah offers AI feedback on the student's reading; whether its reference audio is recorded or synthesised is unclear.
  - None found generates chant.
- **Quran analogue.** Tarteel uses AI to listen and correct, with human reciters. Synthetic recitation exists only in papers.
- **Academic work.**
  - van Kranenburg, Biró et al. (ISMIR 2011) measured how stable each ta'am's melody is. Ashkenazi sof pasuq and tipcha are highly stable, which supports both trained models and motif reuse.
  - Biró's work is analysis, not synthesis.
  - Torah-chant alignment precedent: about 83% of boundaries within 50 ms from one hand-labelled chapter (project files cite this differently; check before relying on it).
  - **No paper or thesis was found that synthesises te'amim.**
- **Closest outside analogues.** CantusSVS (DiffSinger for Latin chant) and an Ethiopian chant concatenation thesis. Neither is Hebrew.

**Conclusion.** No one has shipped generated chant that cantors respect. The precedent is that a correct, controllable, clearly labelled study voice is welcome even when it is robotic. We are aiming higher.

---

## 11. W9 — Engineering, cost and operations

**Training compute:**

- **Local RTX 4070 (8 GB), no spend.**
  - Pilot acoustic model: about 1–1.5 days.
  - Full run: 2–4 days.
  - Self-trained vocoder: several more days.
  - All of these are estimates, and 8 GB fit is unverified. Experiment 1 profiles memory in its first 500 steps.
- **Rented (prices on 2026-10-22).**
  - RTX 4090: $0.34–0.89/h.
  - L40S: $0.67–1.95/h.
  - A100 80 GB: $1.00–2.79/h.
  - A full acoustic run is about $10–45. A whole programme with retries and a vocoder is about $100–250.
  - Renting means copying training audio to a rented machine. That is your decision, especially for Finkel's private audio.

**Rendering the corpus:**

- About 7,500 verses × 4 ranges at an average of about 16 s is 30,000 files, about 133 h of audio.
- ONNX inference is expected to run faster than real time on the 4070 (Estimate). At 10× real time that is about 13 h of laptop time, done once per approved model version.

**Storage and running cost.** The formula is GB = files × seconds × kbit/s × 125 / 10⁹.

| | 64 kbit/s | 96 kbit/s |
|---|---|---|
| Storage | 3.84 GB | 5.76 GB |
| Transfer, about 100 students × 30 min/day, cached | about 7.7 GB/month | about 11.5 GB/month |
| Transfer, nothing cached | about 43 GB/month | about 65 GB/month |

- **Cloudflare R2 (the costed default):** $0/month at this size (10 GB free storage, free egress).
- **Vercel Blob** ($0.023/GB-month, $0.05/GB transfer, $5 per million operations; Vercel's pricing page updated 2026-09-23):
  - Usage alone is about $0.50/month typical, and about $2.30–3.40/month worst case at 64–96 kbit/s, plus a one-off $0.15 for 30,000 uploads.
  - Cache misses add Fast Origin Transfer at about $0.06/GB. Serving private files through a Function adds data-transfer charges.
  - **Hobby does not fit:** it caps storage at 1 GB (the corpus is 3.8–5.8 GB) and uploads at 2,000 a month, and its terms exclude commercial use. Pro costs about $20/month in base fee, which breaks the $10 budget unless the portal is already on Pro for other reasons. Check which plan the existing private store is on.

**Versioning and the G3 pin.** A render's identity is the hash of:

- the engine version;
- the pronunciation profile;
- the acoustic model weights (SHA-256);
- the vocoder weights;
- the render config;
- the ONNX Runtime version.

G3 approval pins that identity. Any change means a re-render, plus at least a re-check of a 20-verse golden set, plus full G3 for any newly released verses. The weights are stored off-repo in two places. The MP3s plus a render manifest are the lasting artefact.

**Reproducibility over years:**

- Pin with a uv lock file and an explicit PyTorch CUDA index.
- Keep a saved container image pinned by digest.
- Fork DiffSinger at the used tag.
- Export to ONNX for rendering. ONNX Runtime promises backward compatibility, so rendering survives PyTorch churn. Training may not.

What breaks:

- Python 3.10 reached end of life on 2026-10-01.
- PyTorch keeps dropping old CUDA builds (11.8 ended after 2.7). Both our GPUs are still covered by current builds.
- Upstream repositories can disappear (Seed-VC was archived).

---

## 12. Staged plan

Each stage has an exit test and a kill rule. G1 and G2 run automatically on every rendered file from Stage 1 on. G3 is the Stage 4 release gate.

| Stage | What | Needs from you | Exit test | Kill rule |
|---|---|---|---|---|
| **0. Decide** | Answer Q1, Q2, Q4, Q5. Confirm the PocketTorah audio format. | About 5 minutes | Answers recorded | Q1 = no → go to Stage 1F, or stop |
| **1. Experiment 1** (content) | PocketTorah-only DiffSinger, 12 held-out verses, perfect-conditions and engine-driven renders, blind review | About 25 minutes of listening | Per the ordered rule in `EXPERIMENT-1.md` §10. Pass: engine-driven has zero teach-wrong, at least 10/12 fine, all G1/G2; real recordings at least 11/12 fine. | Perfect-conditions has any teach-wrong or fewer than 10/12 fine → **stop generated voice work** |
| 1b. One retry (only if perfect-conditions passes but engine-driven fails) | Train DiffSinger's pitch and duration predictors on PocketTorah; rerender | About 25 minutes | As Stage 1 | Fails again → stop, or keep only the human routes |
| 1F. Fallback if Q1 = no | Finkel-only pilot (needs consent and Finkel alignment first) | Consent; about 25 minutes | As Stage 1, against held-out Finkel recordings | As Stage 1 |
| **2. Voice and fidelity** | Add Finkel as a second speaker; train our own vocoder on his lossless audio; render in his voice | Signed Finkel consent; a short screening listen of the chosen clips by someone | Tests 1, 2 and 4 against held-out Finkel recordings; record test 3 | Finkel-voice fails while PocketTorah-voice passed → you choose: stop, or the PocketTorah voice at PocketTorah quality (ethics question in §9) |
| **3. Ranges and keys** | Pitch-shift preserving vocal colour (±1–4 semitones) for keys; for true alto and soprano, conversion into a consenting adult upper voice (SoulX-SVC, tested on human audio first) or a third speaker | Consent from that adult voice; about 20 minutes per range | At least 95% "fine to learn from" on 20 verses per range; G1 | A range that fails is not offered |
| **4. Release gate (G3)** | Render the release set; G1 and G2 on every file; full review of every new verse (second reviewer all, you flagged plus 59 random); range variants on a 59-verse zero-failure sample | About 30 minutes per round; second reviewer about 2 h | G3: at least 95% melody passes, zero teach-wrong; tests 2–4 as you set them in Q2 | Any teach-wrong → fix and re-review that verse; a pattern of them → back to Stage 2 |
| **5. Operate** | Store MP3s (Blob or R2); version pinning; golden-set re-check on any environment change | — | Manifest and hashes recorded | — |

Where spend can arise: cloud training (Stage 1 if 8 GB fails; Stage 2 vocoder), a Finkel coverage session (Stage 2, only if measured holes justify it), and a second reviewer's time. Each is your decision when it arises, with an amount.

---

## 13. Red team

**Strongest case for the runner-up generator, (b) TTS→SVC.**

- It is the only lane with Hebrew results. Its last unread-verse render had only 3 of 35 words flagged, the fixes are known, and it needs no training and no PocketTorah decision.
- *Why it still loses:*
  - Phonikud's TTS licence very probably excludes our use ("non-academic" use not permitted).
  - Its replacement (BlueTTS) has undisclosed, probably non-commercial training data.
  - Speech stretched into singing has a structural ceiling, both in the literature and in our own rounds: each fix surfaced new artefacts in breath, reverb and endings.
  - It chains three models to maintain.
  - It can reach "very impressive for a machine", but there is no evidence it can reach great.
- *What survives:* if you decline PocketTorah training **and** Finkel consents only to conversion, a TTS fine-tuned on Finkel's spoken clips, followed by conversion, is the remaining automated route. I would still not expect it to reach great.

**Strongest case for not building at all.**

- Human recordings already cover 99.4% of Torah verses.
- The haftarah gap can be recorded for a few thousand dollars.
- Keys come from pitch-shifting.
- No one in forty years has shipped generated chant that cantors respect.
- Every generated verse carries a teaching risk and costs your listening time.
- An ML stack is a multi-year maintenance burden for a congregation.
- *What survives:* all of this is true. It is why the plan spends $0 before a decisive test, why the human routes are recommended regardless, and why the kill rule is strict.
- *What the case misses:* the experiment is nearly free. If it passes, the portal gains any verse, in any key and any voice type, in one consistent voice, without depending on finding readers. If you do not value that, skip Experiment 1. That is a legitimate answer.

**Strongest case against the specific recommendation.** "Train on PocketTorah" may teach the model the reader's quirks, and his audio is low quality. *Answer:* you called his reading "perfect", so his habits are the target. The low quality is why Finkel's voice is used for final renders. The experiment compares at matched audio quality, so it tests chant correctness, not fidelity.

---

## 14. Risks, and what would change the recommendation

| Risk | Effect | Mitigation |
|---|---|---|
| The 4070 cannot train DiffSinger in 8 GB | Pilot blocked | Smaller batch, separate decoders; else cloud at about $10–45, your decision |
| PocketTorah phone labels too noisy | Smeared or wrong sounds | The perfect-conditions arm isolates this; a correction pilot measures cost |
| PocketTorah bandwidth worse than estimated (for example under 5 kHz) | Pilot renders sound muffled | The comparison is at matched quality; fidelity moves to Stage 2 (Finkel) |
| Finkel's chant quality, coverage or consent falls short | No clean final voice | Fallback options in Stage 2; a new recording script (§6) |
| Score-to-performance layer sounds mechanical | Engine-driven render fails while perfect-conditions passes | Stage 1b: learned pitch and duration from PocketTorah |
| Licence drift (vocoder, upstream) | Release blocked | Self-trained vocoder; fork and pin; no third-party weights in production |
| Your review time | Bottleneck | 25-minute rounds; second reviewer for full passes; automatic gates first |
| Model or environment rot | Cannot re-render in two years | ONNX export; pinned environment and image; MP3s plus manifest are the artefact |

**What would change the recommendation:**

- Perfect-conditions fails in Experiment 1 → stop generation; human routes only.
- Q1 = no → the Finkel-only pilot (weaker: 3–4 h, no timings), or stop.
- Finkel declines a voice model → the PocketTorah voice (replica ethics question) or stop.
- Q2 requires test 3 and Experiment 1 shows you can reliably tell (10 or more of 12 pairs) → a generated voice is unlikely to meet your bar soon; stop, or revisit in a year.
- A model appears with Hebrew sounds, per-note control and permissive weights → re-evaluate. None was found as of 2026-10-22.
- You decide any-verse/any-key flexibility is not worth having → skip Experiment 1. The human routes in §3 cover every listed use.
