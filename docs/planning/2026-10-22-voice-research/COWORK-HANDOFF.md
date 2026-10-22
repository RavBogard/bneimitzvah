# Generated chant voice: strategic research brief (Cowork handoff)

2026-10-22. Written by Claude Code for a Cowork research thread.

## Daniel's request

Daniel, verbatim: "I want some serious research on the best way to do this next generated voice/Hebrew. I want it to be great, or it's not worth doing. … It should be super wide ranging and thorough and strategic in the research."

**Your job:** find out whether a generated chant voice can be *great*, what the best path to great is, and what that path costs. Then give Daniel one clear recommendation, which may be "don't build it".

This is desk research plus reading code. It is not a build.

This brief is meant to stand alone. Every path below is on Daniel's Windows machine. Read the files it names when you need detail, but you should not need anything outside this brief to start.

---

## 1. What the product is, and where the voice would go

- **The product.** CRC B'nei Mitzvah is a web portal for Central Reform Congregation in St. Louis. It is live at https://beitmitzvah.centralreform.org.
- **Who uses it:**
  - Child (about 12 years old) and adult Beit Mitzvah students preparing a Torah reading and haftarah;
  - their parents;
  - tutors;
  - Daniel (rabbi, admin, and for now the sole judge of quality).
- **How students learn.** Students learn from the Hebrew text with te'amim (cantillation marks) and a translation. They also use word helps and a verse-by-verse player with word highlighting, speed control (0.5–1.25×) and looping. Practice happens on phones and laptops, and much of the tutoring is on Zoom.
- **The tradition.** It is Standard Reform cantillation: the Binder/Avery melodies, sung with modern Israeli ("Sephardic-style") pronunciation. In sung practice the divine name is read Adonai or Elohim, as at the ceremony.
- **Today's audio** is human recordings only. These come from PocketTorah (CC BY-SA 3.0, archive.org `PockettorahAudioFiles`, an unnamed Avery/Binder-style reader):
  - Torah: 99.4% of verses playable.
  - Haftarot: about 72% of verses playable.
  - The gap is mostly the **18 special-Shabbat and festival haftarot**, about 400 verses or about 2 hours of chant. Daniel has ruled that these stay text-only for now.

**Where generated chant would go once it passes the gate:**
1. **Fill verses with no human recording.** Human recordings always come first.
2. **Offer four vocal ranges** (bass, tenor, alto, soprano), chosen by the student or tutor. A 12-year-old's voice is not a cantor's voice, and boys' voices change mid-preparation.
3. **Power trope drills** and the play buttons on the printable trope chart.
4. **Allow any custom verse range** a tutor assigns.
5. **Give per-word timings for free**, because the score is known.

Every generated asset carries the fixed label "Claude-generated chant", with a "check with your tutor or cantor" note.

**The gate (G3, binding):** no student hears generated chant until Daniel passes a listening review, after two automatic gates:
- **G1:** every note within ±50 cents, none missing or extra.
- **G2:** technical checks — loudness, peaks, dropouts, completion.
- **G3 itself:** at least 95% of the review verses pass on melody, and zero "would teach wrong".

G3 is the floor, not the definition of great. Section 3 asks you to define great.

---

## 2. What has already been tried (don't redo; build on it)

This project already spent a week on chant synthesis in October 2026, then Daniel parked it ("Let's cut generation for now", 2026-10-16). Read these files before you search the web, so your research starts where ours stopped:

| File (under `C:/Users/dsbog/bneimitzvah-study/`) | What it holds |
|---|---|
| `docs/superpowers/research/2026-10-15-trope-engine/synthesis-survey.md` | First landscape survey of singing synthesis, commercial and open |
| `docs/superpowers/research/2026-10-15-trope-engine/voice-quality.md`, `voice-feasibility.md` | Quality analysis and data needs |
| `docs/superpowers/research/2026-10-15-trope-engine/hebrew-text-pipeline.md` | Text to syllables to stress to phonemes; open pronunciation questions |
| `docs/superpowers/research/2026-10-15-trope-engine/prior-art-and-evaluation.md` | Evaluation methods, pitch trackers, alignment precedent |
| `docs/superpowers/research/2026-10-15-trope-engine/nusach-tables.md`, `trope-grammar.md`, `torah-grammar.md` | How te'amim become melody; the traditions |
| `docs/superpowers/research/2026-10-15-trope-engine/speech2sing-experiment.md`, `legato-ab.md` | Measured experiments |
| `docs/superpowers/research/2026-10-16-chant-rendering-reassessment.md` | **The most careful document.** It corrects earlier overclaims; read it closely |
| `docs/superpowers/plans/2026-10-16-chant-renderer-benchmark.md` | The 12-passage benchmark and Daniel's scorecard |
| Branch `voice/human-alignment`, file `docs/planning/2026-10-16-voice/HUMAN-ALIGNMENT-RETURN.md` (view with `git show voice/human-alignment:<path>`) | The latest results and Daniel's verdicts; `main` has only a short version |
| `docs/planning/2026-10-22-finkel-finish/VOICE-HANDOFF.md` | Cantor Finkel's recordings as voice material |
| `trope/` (`melody.mjs`, `text.mjs`, `cells/*.json`, `pronunciation.json`, `speech2sing.*`, `soulx*`) | The working engine |

### What exists and works

- **The trope engine** (dependency-free Node).
  - It turns fully pointed Masoretic text (MAM via Sefaria) into syllables and stress, then into a melody score.
  - Stress comes from the accent position, so no lexicon is needed.
  - It handles qere/ketiv, the divine name and maqaf chains.
  - Melody tables: Binder/Avery Torah (62 cells), Binder/Avery haftarah (50 cells) and Moroccan (Idelsohn, public domain).
  - Rhythm is free. A syllable-timing model fitted to Daniel's own chant exists privately.
  - **Treat this layer as solved and reusable.** The renderer is the open problem.

### What was rendered and what Daniel heard

Daniel's ear is the calibration. Treat each verdict as data.

1. **Zero-shot score-to-singing (SoulX-Singer, Apache-2.0).**
   - The melody was faithful: 33 of 33 notes within ±0.5 semitone.
   - The diction failed. Daniel: "pretty awful… almost a Peruvian accent… speed is super inhumane."
   - The model has no Hebrew phones and published no training code. **Dead end.**
2. **Human Hebrew speech re-sung by a singing-voice converter (SoulX-SVC) with the score's pitch.**
   - First run: "really really fake, but it is an improvement."
   - It then improved, one fix at a time. The fixes were sung-time durations, phrase-final release, a voiced-closure boundary rule ("much better. We're getting there") and chant-pause removal.
   - One render was "Approved" as research, not G3.
   - Four passages: "really impressive. Much better", but 11 of 46 words were flagged.
3. **Hebrew TTS (Phonikud, voice `michael`) re-sung by SVC.**
   - Unread verses with modelled timing: "very impressive". 3 of 35 words were flagged.
   - **This is the closest anything has come.**
   - The flagged defects were three:
     - ה heard as ח (a voiceless h gets no pitch, so the converter makes it a fricative);
     - cut-off final vowels;
     - cramped consonant-heavy syllables.
   - Five known defects were left open when work parked.
   - Phonikud's TTS licence is non-commercial/academic. It is unclear whether a synagogue falls inside it.

### Never run

- A DiffSinger-style fine-tune. The earlier survey rated it "highest ceiling", but its data and cost were never established.
- Unit concatenation (WORLD/PSOLA).
- Synthesizer V or ACE Studio. Each would need money and a Hebrew phone map.
- The Modal cloud renderer. It was built but never run.
- A fair head-to-head of lanes.

### Ruled out for licence or control

- ElevenLabs: no singing, and no cloning of third parties.
- Suno and song generators: no per-note control.
- Vevo2: CC-BY-NC-ND weights.
- Seed-VC: GPL, archived.
- HQ-SVC: no licence.
- TCSinger2 and Transinger: no weights.
- CosyVoice 3: says singing is not supported.

Re-verify these: it is late 2026, and the field moves monthly.

---

## 3. The central question: what does "great" mean?

Daniel's word was "great, or it's not worth doing". Your first deliverable is a definition of great that Daniel can accept, with a way to measure it. Start from these, and push back where they are wrong:

- **Correct before beautiful.**
  - Zero wrong words, syllables, stress or sheva, and zero wrong notes.
  - A student imitates exactly what they hear, so one confidently wrong vowel is worse than an obviously synthetic voice.
  - Daniel's earlier ruling, "accented-but-correct ships", sets the floor. His later reactions show the bar he actually holds.
- **Sounds like a person chanting, not a machine singing.**
  - This covers natural Hebrew consonants (ח, ה, ע, ר, צ, gemination), connected legato, breath and phrase shape, and human rubato rather than a metronome.
- **Teaches well.**
  - Clear enough to imitate at 0.5×.
  - Stable across the four ranges.
  - Consistent from verse to verse, so a student's whole portion sounds like one reader.
- **A possible test.** In a blind test against held-out real recordings of the same reader, a cantor cannot reliably tell which is generated. Or great means something else. Propose the test, the listener panel and the pass threshold.
- **Respect Daniel's time.** He is the bottleneck reviewer, so design a review that costs him under 30 minutes per round.

---

## 4. Assets you can plan around

Report counts and paths only. **Never copy any recording, title, label or text from these into your output.**

### A. Cantor Josh Finkel's package

- **Where it is:** `%LOCALAPPDATA%/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/CRCBeitMitzvah/research-private/finkel-collection/prepared`
- **Size:** 322 clips, about 7 h 39 min. Lossless FLAC masters (44.1 or 48 kHz) plus 64 kbps MP3s.
- **What's in it:**
  - 174 chant clips, 86 spoken, 22 chant drills, 40 spoken drills.
  - The 265 machine-passed clips include 97 Torah chant and 31 haftarah chant.
  - 22 tempo variants.
  - About 378 distinct verses named.
- **Gaps:**
  - No human has listened to any clip.
  - There are no validated word or verse timings, only ASR guesses.
- **Licence:** Daniel says Finkel gave all recordings "unrestricted", and MISSION records that. Daniel's ruling is that this package is "the basis for the future work of the voice we are developing".
- **Overlap with the gaps:** Finkel covers only 16 of the ~400 missing special-haftarah verses. Recording more of the gaps was the earlier counter-proposal.

### B. PocketTorah

- **Where it is:** `C:/private/pockettorah`
- **Size:** about 31.9 hours of chant (Torah 25.4 h, haftarah 6.5 h) from one consistent-sounding Binder-style reader. It holds 7,073 verse cuts and 97,832 words.
- **Alignment:** already CTC word-aligned. Starts land a median 34 ms from sound onset.
- **Daniel on its pronunciation:** "sounds perfect actually".
- **The open question.** By the scale of singing-synthesis datasets this is a very large single-singer corpus. But Daniel's 2026-10-16 authorisation covers only "timing and melody statistics … only derived numbers enter the engine, never this audio." Training on it would be a new decision for Daniel.
  - Share-alike (BY-SA) may reach a trained model or its output.
  - The performer is anonymous.
  - Research both questions.

### C. Private benchmark material

`C:/private/chant-benchmark` holds Daniel's own chant takes, alignments, prompts, reviews and runs from the October lanes. There is also the 12-passage benchmark set (P01 Gen 1:1, P02 Ex 35:20, P09 I Sam 20:18, P11 I Sam 20:27 and others).

### D. Hardware

- An RTX 4070 laptop (8 GB VRAM) is the only compute authorised.
- A GTX 1660 Ti (6 GB) also exists.
- Cloud GPU is new spend.

### E. Possible new data

You may recommend new recording sessions: who, how much, what script and what it would cost. Example: a phonetically and trope-balanced script for Finkel, or a professional singer.

Never recommend using student or child voices. They are personal data, and that is out of scope.

---

## 5. Constraints that shape the answer

- **Money.**
  - The whole portal must stay under **$10 a month** in running cost, or Daniel decides.
  - Any one-off spend (GPU rental, software, a recording session, a consultant) is Daniel's decision.
  - Price every option. Assume pre-rendering offline and storing MP3s, so the runtime cost is storage only. Estimate it.
- **Never in the repository:** recordings, rendered audio, model weights, licensed text, student data or credentials. Anything we build must keep weights and audio off-repo.
- **Licences.** Check three layers for every option:
  - the code;
  - the weights;
  - the data the weights were trained on.

  Also check output and commercial-use terms. CRC is a nonprofit synagogue, and "non-commercial" or "academic" terms do not automatically cover it. GPL or AGPL code that we would run privately offline is less of a problem than code we would ship; say which case applies.
- **Maintenance.** The maintainer is Daniel plus Claude agents, over years. Favour paths that are reproducible, pinned and boring to run, over research code that rots.
- **The app and engine stay simple.** The trope engine stays dependency-free Node. Any Python or ML side runs off to the side and produces files.

---

## 6. Research workstreams

Go wide first, then deep. Each workstream should end with findings, evidence quality, and what it means for the decision.

### W1. The value case: is generation the right tool?

- For each use in §1, ask what the cheapest way to reach great is, and whether it needs generation at all. Candidates:
  - **Gap-fill:** one human recording session for ~400 verses (who, cost, time) against a generated voice.
  - **Vocal ranges:** formant-preserving pitch shift of the human recordings (rate the quality at ±3–7 semitones), or voice conversion of human recordings into other ranges, against full synthesis.
  - **Tempo:** already solved by pitch-preserving playback of human audio.
  - **Drills and the trope chart:** a small set of recorded motifs against generation.
  - **Custom ranges:** these are already mostly covered by verse-level human cuts.
- Give an honest verdict: which uses justify a voice, and is that enough to be worth doing?

### W2. The state of the art in singing voice synthesis, as of late 2026

- Survey academic, open-source and commercial work. Include score-driven singing synthesis; zero-shot and foundation singing models; flow-matching and diffusion models; codec-language-model approaches; singing voice conversion; and speech-to-singing.
- For each serious candidate, record:
  - phoneme-level and note-level control;
  - whether it can learn a new language's phones (Hebrew);
  - whether training or fine-tuning code is published;
  - how much data it needs;
  - its quality evidence: real listening tests against demo pages, and who measured;
  - VRAM needed for training and inference;
  - licences for code, weights and data;
  - maturity and maintenance.
- Leads to verify (some may be stale or wrong):
  - DiffSinger plus OpenUtau and the SOFA singing aligner;
  - VISinger2;
  - NNSVS/ENUNU;
  - so-vits-svc, RVC/Applio and newer SVC models;
  - SoulX-Singer updates;
  - YingMusic;
  - StyleSinger and TCSinger;
  - Vevo2 and newer Amphion work;
  - BigVGAN v2 and Vocos vocoders;
  - RMVPE and FCPE pitch extraction;
  - Synthesizer V Studio 2 (custom voice databases, phoneme mapping, scripting and headless export);
  - ACE Studio (consented custom voices, languages);
  - Vocaloid 6;
  - anything new in 2026.
- Find out who is doing singing synthesis for low-resource and unsupported languages, and how they handled new phones.

### W3. Hebrew language layer

- **Text to phones.** Assess how complete our rule-based path is from fully pointed text. The hard cases are:
  - sheva na/nach;
  - qamatz qatan (MAM marks it);
  - dagesh forte;
  - furtive patach;
  - mil'el and mil'ra;
  - two accents on one word.
- **Hebrew speech models in 2026.** Cover TTS (Phonikud and successors, MMS-TTS, others), ASR for evaluation (ivrit.ai Whisper fine-tunes and others) and forced aligners that cope with melisma. For each, give the licence and the quality evidence.
- **Hebrew datasets and their licences:** ivrit.ai, SASPEECH/Robo-Shaul, Common Voice and others.
- **Pronunciation choices.** Settle the open questions in `hebrew-text-pipeline.md`, or explain what they hinge on:
  - which ר (tap, trill or uvular);
  - pharyngeal ח and ע or not;
  - whether vocal sheva is a full e or reduced;
  - gemination.
- **What our reference readers do.** What do Finkel and PocketTorah actually do on each point? The voice should match its own reference recordings.

### W4. Data strategy

- **How much is needed.** How much aligned single-singer chant does each architecture need to reach great? Compare with known datasets (Opencpop, M4Singer, GTSinger, NUS-48E and others) and their reported quality.
- **What our data can provide:**
  - Finkel alone: 7.6 h, of which about 3–4 h is clean chant.
  - Finkel combined with PocketTorah's 31.9 h, used as pretraining, followed by a Finkel fine-tune.
  - PocketTorah alone.
- **Alignment and annotation.** What chant alignment needs: phone-level timing under melisma, and note labels from the score we already compute. The tools are CTC, MFA, SOFA, score-informed alignment or hand correction. Estimate the human hours and how to minimise them.
- **New recordings.** If new recording beats cleaning old data, specify the script design, its length, the session cost and the studio requirements.

### W5. Architectures to compare head to head

Score each against the "great" definition from §3. Include at least:

- **(a) A Hebrew chant model trained on our data.** A score-driven SVS (DiffSinger-class or newer), pretrained on PocketTorah and fine-tuned to Finkel, driven by the engine's notes and phones.
- **(b) The lane that came closest: Hebrew TTS, then SVC with score pitch.**
  - Can a TTS in Finkel's voice, or a properly licensed Hebrew TTS, replace Phonikud?
  - Are the ה→ח, final-vowel and cramped-syllable defects fixable, and how?
  - What is this lane's realistic ceiling?
- **(c) Motif and unit selection from real chant.**
  - Trope is formulaic, and the same ta'am in the same context recurs thousands of times in 39 hours of real chant.
  - Could we splice real sung units (syllable, ta'am motif or word) and smooth them neurally?
  - Is there prior art in concatenative singing (Vocaloid's origins, UTAU, unit-selection TTS)?
- **(d) Voice conversion of human performances.** PocketTorah into Finkel's timbre or into other ranges. This is great for timbre and range, but it cannot add verses that nobody recorded.
- **(e) Zero-shot singing foundation models** with phoneme control, if any now accept unseen-language phones.
- **(f) Commercial editors** (Synthesizer V, ACE Studio) with a Hebrew phone map, possibly with a custom voice database. Cover cost, terms, automation and quality ceiling.
- **(g) Hybrids** of the above. For example, (a) or (c) for content and (d) for range.

For each option, give its quality ceiling; its risk of teaching something wrong; its data and annotation cost; its compute and money; its licence status; its time to a first convincing result; and its maintenance burden.

### W6. Evaluation design

- **The review.** Design the listening review Daniel would run:
  - blind ABX or MUSHRA against held-out real verses;
  - a scorecard (the existing one is in the benchmark plan);
  - a "would teach wrong" taxonomy;
  - the sample size behind 95% G3 confidence.
- **Automatic checks.** Design checks that catch errors before Daniel hears anything:
  - pitch tracking against the score (G1);
  - Hebrew ASR character error rate;
  - stress placement;
  - phone-duration sanity;
  - loudness and peaks (G2).
- **The panel.** Should a second cantor or tutor review? Who, and how?
- **The cheapest decisive experiment.** What single small experiment would tell us fastest whether the leading path can reach great? Kill it early if it can't.

### W7. Consent, ethics, law and community

- **Finkel's consent.** "Unrestricted" was given for recordings. Earlier plans listed separate consent scopes: playback, prompting, cloud processing, training, derivative voice models and distribution. Does Finkel understand and agree that a synthetic voice with his sound would chant verses he never sang? Recommend what to confirm with him and how. **Do not contact him;** draft the question for Daniel.
- **Digital-replica and voice-likeness law** relevant to St. Louis, Missouri, and to US use generally, as of 2026. Include Tennessee's ELVIS Act as a reference point, New York's and California's digital-replica laws, any Missouri statute, and the right of publicity. What applies to a nonprofit's educational use?
- **Share-alike and derived models:** what CC BY-SA 3.0 means for a model trained on PocketTorah, and for its outputs.
- **Communal and religious perception.** How do Reform clergy, cantors and families feel about synthetic Torah chant as a study aid, not ritual? Look for published views (Reform, Conservative, Orthodox), cantorial-organisation statements (ACC, the Cantors Assembly) and any controversies. How should we disclose it?
- **Teaching risk:** what happens when a student learns a generated error, and how other learning tools handle trust.

### W8. Prior art in Jewish learning technology

- **Existing tools:** TropeTrainer/Kinnor, PocketTorah, Trope Tutor and the other bar/bat mitzvah apps, Mitzvah Tutor, and any 2024–2026 AI chant products or research.
- **What academics have done:** for example Dániel Péter Biró and colleagues on computational cantillation, and Ben-Shalom and Keshet on alignment.
- **What each reached and where it fell short.** Has anyone shipped a generated chant that cantors respect? If so, how did they do it?

### W9. Engineering, cost and operations for the leading paths

- **Training compute:** local 4070 (8 GB) or a one-off cloud rental. Give hours and dollars.
- **Rendering the whole corpus:** about 7,500 Torah and haftarah verses × 4 ranges. Give the time, the storage, and the monthly cost at Vercel Blob or equivalent rates.
- **Versioning:** how a model version becomes part of the release identity the G3 gate pins.
- **Reproducibility:** pinned environments, and what breaks in two years.

---

## 7. How to work

- **Primary sources.** Use papers, code, model cards and licence texts. Use vendor terms pages, not blog summaries.
- **Verify, don't relay.** Separate "the paper or demo claims" from "independently shown" from "we verified in the code". Label your confidence.
- **Date everything.** It is October 2026. Note the date of each source and the latest release of each repo. Treat anything older than about 12 months in this field as possibly stale.
- **Check licences at all three layers** — code, weights, training data — and read the actual LICENSE file.
- **Red-team your own recommendation.** Before you write it up, argue the strongest case for the second-best option and the case for not building at all. Keep what survives.
- **Reading code is fine.** GitHub, papers, model cards.
- **Running things.** Don't install anything into the repo. If one cheap local check would settle a big question (for example, "does model X's training code accept a custom phone set?"), describe it as a proposed experiment instead of running it, unless it reads code only.

### Hard limits. Ask Daniel instead of doing any of these:

- Spending money, signing up for paid trials, or starting cloud jobs.
- Uploading or sending any Finkel, PocketTorah, Daniel or other private audio to any website, demo, API or vendor. This includes "try your voice" demo pages.
- Contacting anyone: Finkel, vendors, researchers, cantors.
- Writing to the repository or to `C:/private/`, or copying any private recording, title, label or text into your notes.
- Printing any token, credential or full email address.

---

## 8. Deliverables

Write to **`C:/Users/dsbog/voice-research/`**, a folder outside every git tree. Create it. Claude Code will review your report and commit the shareable parts to `docs/superpowers/research/`.

1. **`REPORT.md`, the strategic report:**
   - **One page for Daniel first:**
     - the recommendation (build or don't build, and which path);
     - why;
     - the definition of great and how to test it;
     - money and time;
     - the first experiment and its kill criterion;
     - the decisions only Daniel can make.
   - **Then the full findings, workstream by workstream.**
   - **A comparison matrix of the options in W5**, with evidence-quality labels.
   - **A staged plan.** Each stage gets an exit test and a kill criterion, and the cheapest decisive experiment comes first. Note where G1, G2 and G3 sit.
   - **Risks,** and what would change the recommendation.
2. **`SOURCES.md`.** An annotated bibliography. For each source: URL, date, what it shows, how much to trust it, and its licence where relevant.
3. **`QUESTIONS-FOR-DANIEL.md`.** Each decision only he can make, written so he can answer in a line. Include:
   - the Finkel consent scope, and a draft message to Finkel for Daniel to send;
   - whether to train on PocketTorah;
   - pronunciation choices;
   - any spend, with amounts;
   - who else listens.
4. **`EXPERIMENT-1.md`.** The first experiment specified tightly enough for a Claude Code agent to run it: inputs, steps, tools with pinned versions, the expected outputs, the measurements, and the listening task for Daniel, which must take under 30 minutes.

**Length:** as long as the evidence needs, but the first page must stand alone. Write in plain words. Daniel reads closely and dislikes jargon he has to decode, so define each technical term once.
