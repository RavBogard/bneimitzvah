# Voice quality: clear Hebrew consonants and a smooth, human line (2026-10-15)

Research only; nothing was rendered, and no GPU was used. This follows `synthesis-survey.md` (the landscape) and `voice-feasibility.md` (SoulX-Singer running locally, Hebrew sent through English ARPAbet) and does not repeat them.

**The problem.** Daniel heard the first renders and said: "the consonants aren't always enunciated totally and clearly, and it sounds super computer-ey rather than smooth and connected." Another agent is fixing what our own score emitter causes (gaps between words, grid rhythm, unstressed ARPAbet vowels, f0). This report covers the other half: which renderers, available now, would give clearly enunciated, smooth, human-sounding Hebrew chant from our score.

**Rulings that apply** (README, plus this brief): whose voice it is doesn't matter. Open-source, permissively licensed or affordable commercial tools are all fine. Available hardware is the local GTX 1660 Ti (6 GB), the RTX 4070 laptop and Modal. Nobody records unless it is clearly worth it. A cantor friend has existing Torah-chanting recordings that could serve as data.

Tags: **[V]** verified at the source given (fetched or quoted from search results on 2026-10-15); **[I]** my inference or speculation; **[API]** from the GitHub or Hugging Face API on 2026-10-15.

---

## 0. Bottom line

The two complaints have different causes, and no single fix handles both:

| Cause | Where it comes from | What fixes it |
|---|---|---|
| Weak or unclear consonants | Hebrew is forced through 39 English phones. There is no χ, no ʁ or tap r, no single ts, and the vowels are diphthongized. SoulX was never trained on Hebrew sounds. | Something that has actually produced Hebrew sounds: a Hebrew speech model, a model fine-tuned on Hebrew chant, or a phone set closer to Hebrew (Spanish, Italian or Mandarin phones in a commercial SVS). |
| "Computer-ey", not connected | Partly our score (gaps, grid rhythm, flat f0; the other agent's job). Partly the model: each syllable is a separate English "word" token with no co-articulation across word boundaries. | Phrase-level co-articulation (a TTS speaking the whole phrase, or an SVS whose transition model is mature), a natural f0 with portamento and vibrato, and legato note timing. |
| Timbre ("whose voice", "sounds like a chanter") | Prompt choice | Voice conversion (SVC), or a chant prompt. **SVC does not repair diction** (section 2). |

**Ranked shortlist** (section 7 has the afternoon experiment for each):

1. **"Speak it in Hebrew, sing it with SVC."** A Hebrew TTS that takes our IPA (Phonikud-TTS, or a commercial he-IL voice) speaks each phrase connected. The speech is time-warped to the score's syllable durations. SoulX-Singer-SVC then re-sings it, using **our score f0 as a separate `.npy` input** and a sung prompt for timbre. The consonants come from a real Hebrew speech model; the phrase-level co-articulation comes from the TTS; the singing timbre comes from SVC. Cost $0. It runs on what is already installed plus a second 2.8 GB checkpoint. This attacks diction most directly. The speculative part is how sustained vowels sound after stretching.
2. **Synthesizer V Studio 2 Pro, driven by generated `.svp` projects, with a Spanish-based Hebrew phone map.** Pure five-vowel system, Spanish x for ח, tap and trill r for ר, English v/z/sh, Mandarin ts. Its pitch-transition, vibrato and phoneme-timing models are the most mature "smooth and human" engine you can buy. About $225 with two voices. The catch is that rendering can't be fully automated: there is no headless render, so it means one GUI export per reading (or GUI automation).
3. **Learn from the cantor friend's real chant.** Short term (an afternoon): use a 15 s clip as the SVC/SVS prompt, and fine-tune RVC or Seed-VC on 10-20 min of it as a style and timbre polish. Long term (2-3 weekends): a DiffSinger fine-tune with a real Hebrew phone set, auto-labeled from our scores and forced alignment. This has the highest ceiling on both complaints, because it is trained on actual Hebrew chant. It is the only path where his recordings are decisive; they are not needed for paths 1-2.

**Not worth chasing now:** newer zero-shot SVS models (none has Hebrew, IPA input or a better phone set than SoulX; section 1), song generators (no score control), speech TTS plus WORLD pitch-forcing (path 1 does the same job with a neural resynthesis stage instead of a vocoder that buzzes), and Vocaloid (no advantage).

---

## 1. Newer zero-shot or multilingual SVS (2025-2026)

| Model | Date | Phoneme input | Languages | Weights / licence | Verdict |
|---|---|---|---|---|---|
| SoulX-Singer (+ SVC) | 2026-02 / 03 | ARPAbet + pinyin + jyutping tokens | zh, en, yue | Apache-2.0 [API]. Last push 2026-05-29. **No training code in the repo** (tree has only `cli/`, `soulxsinger/`, `preprocess/`) [API] | Still the best open score-driven option. Fine-tuning it on Hebrew is not possible without writing a trainer. |
| YingMusic-Singer / -Plus | 2025-12 / 2026-03 (v2 2026-04) | **None.** "No manual alignment or precise phoneme annotation"; text lyrics; melody from audio [V https://arxiv.org/abs/2603.24589 ; HF Space README] | zh, en (code-switch) | V1 README MIT, no LICENSE file [API] | Hebrew only as English pseudo-spelling. Worse than SoulX for us. |
| Vevo2 (Amphion) | 2026-03 | text + reference audio | multi | **CC-BY-NC-ND-4.0** [API] | Private A/B only. |
| TCSinger 2 | ACL 2025 | multilingual phonemes | zh/en/+ | MIT code, **no checkpoints** [synthesis-survey] | Not usable. |
| Transinger | 2025 | **IPA decomposed into letters + diacritics, zero-shot to unseen languages** [V https://pmc.ncbi.nlm.nih.gov/articles/PMC12542845/] | multi | no weights found | The right idea for Hebrew; nothing to run. |
| VocalRender (2607.27768) | 2026-07 | score-native | ? | no code [V] | Watch. |
| UniVocal, MeloDISinger, HeartMuLa, ACE-Step 1.5 | 2026 | lyric editing / song generation | | release status unverified [V review list https://github.com/DaViD-Pigeon/SyntheticSingers] | Not score engines. |

**No Hebrew singing model, Hebrew SVS dataset or Hebrew OpenUtau phonemizer turned up in the searches** [V: searches of GitHub, Hugging Face datasets (`cantillation`, `torah`, `haftarah`, `hebrew singing`) and the OpenUtau phonemizer list]. The only Hebrew chant audio with a usable licence remains PocketTorah (CC-BY-SA). The Open Siddur Project itself notes "a paucity of free-culture licensed audio" of te'amim [V https://opensiddur.org/shared/readings-and-sourcetexts/cantillation/].

Two zero-cost SoulX tweaks are worth one render each, alongside path 1 [I]:
- **Hebrew in-context prompt.** SoulX has no speaker vector. It continues the prompt's mel and its token alignment (voice-feasibility §1). A prompt of real Hebrew chant, labeled with the same ARPAbet mapping our emitter uses (so `HH` is labeled where the singer actually says χ), may steer the target's `HH` toward χ. This is speculative, but it costs one prompt-metadata file.
- **Mandarin tokens for ח and צ** (`zh_h*`, `zh_z*`). Already shown to keep the melody (voice-feasibility variant C); not yet judged by ear.

---

## 2. Voice conversion over our render: timbre, not diction

- **Mechanism.** Every SVC in use encodes the *source's* phonetic content (HuBERT/ContentVec in RVC, Whisper in Seed-VC and SoulX-SVC) and re-synthesizes it in the target's timbre with the source's or a supplied f0. So **whatever consonant the source produced is the consonant you get.** An American `HH` stays an `HH`. The literature notes VC can even *add* mispronunciations when the content bottleneck drops information [V https://arxiv.org/pdf/2307.06040]. SVCC 2025 found identity can reach ground-truth level, but "naturalness and style modeling remained hard" [synthesis-survey].
- **The partial exception: retrieval and kNN.** RVC's index (`index_rate`) and kNN-SVC [V https://arxiv.org/abs/2504.05686, code github.com/SmoothKen/knn-svc, no licence file [API]] replace source frames with nearest frames from the target's data. If that data is real Hebrew chant, some frames may be pulled toward Hebrew realizations. That is the closest SVC comes to "accent conversion", and **it is untested; I found no source that measures it** [I].
- **Seed-VC v2's AR "accent & emotion conversion"** (`--convert-style true`, "best in suppressing source speaker traits") would re-generate content in the reference's accent [V Seed-VC README]. But it is a 22 kHz speech model without f0 conditioning, so the melody would not survive. The repo is also archived (GPL-3.0) [synthesis-survey].
- **Where SVC is genuinely strong for us.** (a) It gives a sung, human timbre to a source with good diction but the wrong voice, which is path 1. (b) It polishes timbre and style toward a real chanter, which is path 3's short-term step. **SoulX-Singer-SVC takes the target f0 as a separate `.npy` file** (`--target_f0_path`; `np.load` then `model.infer(gt_f0=...)`), with f0 ≤ 0 treated as unvoiced (`f0_to_coarse` UV mask). Its content encoder is Whisper (`whisper_encoder.py`), which was trained on Hebrew among its languages [V `cli/inference_svc.py`, `soulxsinger/models/soulxsinger_svc.py`]. **So the melody never has to be re-estimated from the source.** That is the property path 1 relies on.
- **Smoothness.** SVC inherits the source's timing, gaps and co-articulation. It cannot connect what the source chopped up.

**Verdict:** use SVC as the final stage of path 1 or as path 3's polish. Never use it as the diction fix.

---

## 3. Hebrew speech TTS plus pitch and time manipulation

Cantillation sits between speech and song. The idea is to borrow a Hebrew speech model's articulation and impose the melody and durations on it.

### 3a. Hebrew TTS sources

| Source | Input control | Licence / cost | Hebrew quality evidence | Use |
|---|---|---|---|---|
| **Phonikud-TTS** (Piper/VITS ONNX ~63 MB; StyleTTS2-light .pth; PyTorch Lightning .ckpt for VITS; voices `michael`, `shaul`, `ranlevi`) | **Takes phonemes (IPA with stress)**, so our emitter's pronunciation is used verbatim: vocal shva, qamats qatan, stress | **Non-commercial** (README "Non commercial"; HF card "cc-nc") [V https://github.com/phonikud/phonikud-tts ; https://huggingface.co/Phonikud/phonikud-tts-checkpoints]. Voices are named people (Shaul = Kan's Robo-Shaul, NC) | Paper: small local models with Phonikud input "approach large proprietary systems" [V https://arxiv.org/abs/2506.12311] | **First choice as the source for path 1.** Its timbre is replaced by SVC. NC on a free congregational study site is defensible but log it. CPU is enough. |
| ElevenLabs `eleven_v3`, `language_code: "he"` | text (nikud honoured? unverified); pronunciation dictionaries; char-level timestamps endpoint [I] | paid plan, commercial OK | "Good"; multilingual v2 "unintelligible" [V https://github.com/danielrosehill/Hebrew-TTS-Providers]; arena ~1541 Elo, tied for top [V search: ivrit-ai TTS arena via Deepdub] | Commercial fallback source. Less control over biblical pronunciation. |
| Gemini 3.1 Flash TTS / 2.5 | text | paid API | arena ~1542; "Good" (2025 snapshot) [V same] | Same role. |
| Azure he-IL (Avri, Hila) | SSML; **IPA `<phoneme>` for he-IL not documented** [V https://docs.azure.cn/en-us/ai-services/speech-service/speech-ssml-phonetic-sets lists no Hebrew set] | pay-as-you-go | "Good" via Edge TTS [V Rosehill] | Cheap, but weak pronunciation control. |
| Chatterbox Multilingual (MIT, 23 langs incl. he) | text | MIT [API] | "Poor ... generic" in the 2025 snapshot [V Rosehill] | Skip. |
| MMS-TTS heb | romanized text | **CC-BY-NC-4.0** [API] | dated | Skip. |
| Coqui XTTS-v2 | no Hebrew in its language list [I, well known] | CPML (non-commercial) | n/a | Skip. |
| kokoro-hebrew-nc, MamreVoice/MamreTTS | text/phonemes | "other"/NC; MamreVoice has no primary model card found [API; V alphaneural listing] | unverified | Possible later A/B. |

### 3b. Imposing the melody

- **WORLD/PSOLA directly on the speech** (pitch-shift to the score f0, stretch vowels) is a known technique with a known ceiling. It is intelligible, but buzzy on held notes and wide intervals, and the voice stays a speaking voice (synthesis-survey §(d), (e)). The ObEN "TTS-to-singing" work needed non-linear time warping plus a library of *sung* vowel exemplars, interpolated by pitch, just to make it sound "cleaner and healthier" than the baseline [V ObEN poster, Kaewtip et al., "Enhanced Virtual Singers Generation by Incorporating Singing Dynamics to Personalized Text-To-Speech-To-Singing", sigport fid=5538]. That is a lot of DSP for a mid-quality result.
- **Neural resynthesis instead of WORLD (path 1).** Warp the TTS audio in time only, then let SoulX-Singer-SVC (or Seed-VC's 44 kHz singing model, or RVC) regenerate the waveform with *our* f0 and a sung prompt's timbre. The vocoder-pitch-shift artifacts disappear because nothing is pitch-shifted; the SVC renders a sung voice at the new pitch. [I: no published evaluation of TTS-to-SVC exists for any language. The closest is the commercial "TorToiSe then RVC" chains [V replicate.com/zsxkib/tortoise-then-rvc], which report no quality figures.]
- **Two ways to get the durations:** (i) **impose them inside the TTS.** VITS (Piper) predicts per-phoneme durations `w_ceil` before the decoder. The PyTorch `.ckpt` lets us overwrite them with the score's frames, so vowels are *generated* long rather than stretched [I: standard VITS code path; a ~30-line patch]. (ii) **Align after the fact** (ctc-forced-aligner on uroman-romanized text; section 4c), then stretch each syllable's vowel span with a phase vocoder or WSOLA (PyTSMod, librosa). Do (ii) first in the afternoon test; do (i) if the stretched vowels sound frozen.
- **Musicality vs intelligibility.** TTS phrasing is speech phrasing. That is close to chant on reciting tones and syllabic upbeats, and furthest from it on melismas (etnachta, zakef gadol, the sof-pasuk cadence) and held notes, where the stretched source gives the SVC little to work with [I]. The f0 is ours either way, so melodic accuracy is unaffected; the risk is a "speaking singer" quality on long notes. **Splitting the TTS at major disjunctive accents** (etnachta, sof pasuk, zakef) keeps its phrasing aligned with the chant's breath points.

---

## 4. Fine-tuning on a small Hebrew chant dataset

### 4a. How much data
Unchanged from synthesis-survey (section a3/c). DiffSinger fine-tuned from an English base needs **15-30 min** (one thesis, no MOS). Community commissions ask for 30 min minimum. RVC needs 10 min minimum and 20-30 min recommended. Seed-VC fine-tuning needs "minimum 1 utterance", 100 steps, about 2 min on a T4. SoulX **cannot be fine-tuned** without writing a trainer [API: no training code]. VISinger2 and other ESPnet SVS models train from scratch on hours, not minutes [I].

### 4b. Existing Hebrew singing data
None found beyond PocketTorah (CC-BY-SA 3.0, one reader). The `abbaleh/whisper-torah-dataset` on HF is 85 clips with no card [API]. `tokeron/Piyyut` is text. Common Voice Hebrew and HebDB are speech, useful only for an aligner. **The cantor friend's recordings would be the largest chant corpus available to us.**

### 4c. Labeling from our own scores (we know the text and the trope)
1. **Segment by verse.** Use silence detection, then anchor with ivrit-ai Whisper word timestamps (`ivrit-ai/whisper-large-v3-turbo-ct2`, Apache-2.0 [API]).
2. **Phoneme transcript.** Our emitter (`trope/text.mjs`) already produces syllables, phonemes and stress per verse, so nothing is typed by hand.
3. **First-pass alignment.** ctc-forced-aligner (MMS) on uroman-romanized text. A Hebrew study did exactly this and found uroman works better on *pointed* text [V https://arxiv.org/pdf/2407.07566, HebDB]; we always have points. Then fine-tune SOFA (MIT) from `tgm_en_v100` with the Hebrew phone set added, and realign (synthesis-survey).
4. **Notes.** The pitch sequence is in our score, but the singer's actual timing and ornaments are not. Take f0 from RMVPE and let MakeDiffSinger's variance pipeline estimate notes, using our score's note count per syllable as a sanity check [I].
5. **Cleanup.** Synagogue recordings usually carry reverb and congregation noise. Run them through a vocal-separation and dereverb model (BS-RoFormer, as SoulX's own preprocessing does) and keep only the clean takes [I].

Effort [I]: one weekend to get labels to round-trip on 10 min, one weekend to train acoustic + variance + vocoder (4070 laptop at 8 GB is the documented minimum; Modal L4 at $0.80/h [V https://modal.com/pricing], 6-12 GPU-h ≈ $5-10), and one weekend for OpenUtau packaging and the `.ds` batch render. **Consent:** written permission from the cantor friend before training anything on his voice (the 2.0 survey's three grants).

---

## 5. Commercial SVS that takes lyrics plus MIDI

| Product | Languages / phones | Hebrew route | Automation | Licence for publishing | Cost |
|---|---|---|---|---|---|
| **Synthesizer V Studio 2 Pro** | Every Pro voice sings en, ja, zh, yue, **es**, ko by cross-lingual synthesis [V https://store.dreamtonics.com/?p=47318]. Language is set per note in the Notes panel [V https://sv2.docs.dreamtonics.com/en/enter-notes via search]; fan guide: "any phoneme in any combination" across languages [V xuuxuu Notion guide via search]. **No IPA input**; phones come from those languages only [V vi-control: "users can't add to the phonemes"]. | ח = Spanish or Mandarin `x` ("hh" + Spanish x reported working) [V https://forum.dreamtonics.com/t/phoneme-help-for-hebrew-german/7522 via search]. ר = Spanish tap `r` or trill `rr` [V users hand-adding `rr`, search snippet]. Vowels from Spanish (pure a e i o u). v/z/sh from English, ts from Mandarin. Uvular ʁ and pharyngeal ʕ: none. | Scripting (Lua 5.4 / JS) runs **inside the editor** and can add and edit notes, phonemes, pitch curves and retakes; **no render or export call or headless mode found** [V https://resource.dreamtonics.com.cn/scripting/ ; v2.1.1 notes via search]. `.svp` is JSON and LibreSVIP (MIT, active) reads and writes it [API: plugins list includes `svp`, `acep`, `ds`, `ustx`]. An MCP bridge exists for macOS only [V https://glama.ai/mcp/servers/tatat/svs-mcp]. | Dreamtonics voices: commercial use without royalty per user reports; Lite voices non-commercial [V forum via search]. **Read the voice EULA before publishing** [I]. | ~$225 (NI: Pro + Natalie 2 + Hayden 2) [V https://www.native-instruments.com/fr/pricing/synthesizer-v-studio-2-pro]; voices ~$79 [V SOS]. Basic is free but has **no cross-lingual synthesis** [V store comparison via search]. CPU rendering, no GPU. |
| **ACE Studio 2.0** | 8 languages: en, zh, ja, ko, es, **it**, fr, pt [V https://rekkerd.org/ace-studio-2-0-all-in-one-ai-music-studio-released/]. Phonemes are directly editable [V vi-control]. | Italian + Spanish cover Hebrew vowels, r, ts, v, z and ʃ better than English. **Whether languages can be mixed per note: not found.** | **No public API or MCP found** [V searches]. `.acep` via LibreSVIP. Rendering is cloud-backed in the app [I]. | "Royalty-free" on paid plans [V SoundCloud help via search]. Check the custom-voice and Hebrew terms. | ~$17-22/mo or a 24-month rent-to-own; sources disagree [V costbench, xpay, tetsu7017]. |
| Vocaloid 6 (6.13.3, 2026-09) | ja, en, zh (+es, ko per Wikipedia) [V https://en.wikipedia.org/wiki/Vocaloid_6] | Same trick, older engine | Job plugins (Lua) | per-library EULA | Skip: no advantage over SynthV. |
| Suno (Cover) | free text lyrics | Hebrew lyrics plausible; melody "interpreted", not reproduced [V jackrighteous guide] | No official API (resellers only); ToS restrict automated use and using output to train [V same] | paid plans own output | Not score-faithful, so it would teach wrong notes. Skip. |
| Eleven Music v2/v2.5 | "English, Spanish, German, Japanese and more"; no Hebrew named; Audio Reference guides *style*, not melody [V https://elevenlabs.io/docs/overview/capabilities/music] | none | API on paid plans | paid | Skip. |

**SynthV is the strongest commercial bet.** Its smoothness (auto pitch transitions, vibrato, AI retakes, vocal modes) is exactly what Daniel says is missing, and its Spanish phone set fits Hebrew far better than ARPAbet. Volume is manageable: ~60-80 haftarah readings plus 54 parashot is one project and one manual Export per reading. That is a few hours a year, or less with a resident script that loads the next `.svp` plus pywinauto clicking Export [I].

---

## 6. Objective evaluation we can automate

The other agent's in-progress `trope/asr_cer.py` already scores Whisper CER, skeleton CER (ו/י removed) and WER against unpointed MAM, with final forms folded and the divine name mapped to אדני. Additions that would make it a reliable diction gate:

1. **Use ivrit.ai's Hebrew fine-tunes** (`ivrit-ai/whisper-large-v3-turbo-ct2`, Apache-2.0, ~7-9% WER on ivrit's own speech sets per a third-party harness [V search: GigaAM-He comparison]). They are a stronger Hebrew ear than vanilla large-v3, and the turbo ct2 build runs int8 on CPU.
2. **Add a no-LM CTC check.** Whisper can "complete" a famous verse from memory, which inflates intelligibility. `imvladikon/wav2vec2-xls-r-300m-hebrew` (CTC, most-downloaded Hebrew ASR on HF [API]) has no language-model prior over Bible text. Report both scores; a large gap between them flags guessing.
3. **Add a phone-level diction metric.** `facebook/wav2vec2-xlsr-53-espeak-cv-ft` (Apache-2.0 [API]) outputs IPA phones language-independently. Align its output to our emitter's IPA and report per-class error for the consonants Daniel hears: χ (ח/כ), ʁ/r, ts, ʃ, and onsets in general. Of the three, this one measures "consonants enunciated" most directly [I].
4. **Calibrate against humans.** Run the same scripts on PocketTorah verses (real human chant) to get the human-chant CER and PER band. A render is "clear enough" when it sits inside that band, not when it hits some absolute number [I].
5. **Naturalness predictor.** SingMOS `singmos_pro` (MIT, `torch.hub.load("South-Twilight/SingMOS:v1.1.2", "singmos_pro")`, wav2vec2-large SSL-MOS trained on 7,981 Chinese and Japanese clips rated by professionals) [V https://github.com/South-Twilight/SingMOS ; https://arxiv.org/abs/2510.01812]. It is out of domain for Hebrew chant, so **use it only to rank renders of the same verse.** Meta Audiobox Aesthetics (CC-BY-4.0 [API]) "Production Quality" is a second opinion.
6. **Cheap smoothness proxies** [I]: share of 20 ms frames under -45 dBFS inside a phrase (gaps); voiced-frame continuity across word boundaries; f0 slope at note joins (instant jumps = "grid"); the onset energy ratio of consonant to vowel (a weak onset = swallowed consonant).

Gate per render: CER and PER inside the human band, SingMOS no worse than the previous engine, and then Daniel's ears (prior-art-and-evaluation.md, gate 3).

---

## 7. Ranked shortlist with afternoon experiments

| # | Path | Diction gain | Smoothness gain | Cost | Effort to production | Licence |
|---|---|---|---|---|---|---|
| 1 | Hebrew TTS → time-warp → SoulX-Singer-SVC with score f0 | **Large** [I]: real Hebrew consonants and pure vowels | Medium-large [I]: connected phrase co-articulation; risk on held notes | $0 (CPU TTS; SVC on the 4070 or Modal ≈ cents) | 2-4 days to wire into `trope/soulx_runner.py` | Phonikud-TTS NC (log it) or a paid commercial TTS; SoulX Apache-2.0 |
| 2 | Synthesizer V Studio 2 Pro, `.svp` generated from score, Spanish-based phone map | Medium-large [I]: x, r/rr, pure vowels; no ʁ/ʕ | **Large** [I]: mature transitions, vibrato, retakes | ~$225 one-time | 2-3 days for the generator; manual export per reading | Commercial EULA (check voice terms) |
| 3 | Cantor friend's recordings: prompt + RVC/Seed-VC polish now, DiffSinger fine-tune later | Small now (prompt/kNN effect, speculative); **largest later** (trained on Hebrew chant) | Medium now; large later | $0-15 GPU | Afternoon now; 2-3 weekends later | His written consent; Apache/MIT tooling |

### Experiment 1 (one afternoon, no new purchases)
Verse: I Samuel 20:18 (same as voice-feasibility, so results compare directly).
1. Install `phonikud-tts` (uv, CPU). Convert our emitter's phonemes for the verse to Phonikud IPA, keeping stress marks. Synthesize with the `michael` voice in **three chunks split at etnachta and sof pasuk**.
2. Align: `ctc-forced-aligner` on the uroman of the pointed text, giving word and character times; mark vowel spans by voicing.
3. Warp: for each syllable, keep the consonants at TTS length and stretch the vowel span to the score's syllable duration (PyTSMod WSOLA or librosa phase vocoder). Concatenate with no inserted silence inside a phrase.
4. f0: build a 50 fps `.npy` from the score notes (use the other agent's portamento/vibrato f0 if ready, otherwise linear 60 ms glides). Set f0 = 0 where the warped audio is unvoiced (pyin), so voiceless consonants stay voiceless.
5. Download `model-svc.pt` (2.79 GB). Run `python -m cli.inference_svc --target_wav_path warped.wav --target_f0_path score_f0.npy --prompt_wav_path <prompt> --prompt_f0_path <rmvpe f0> --fp16` on the 4070 laptop or Modal (not the busy 1660 Ti). For the prompt, use Daniel's chant clip or the existing prompt.
6. Variant B: the same warped speech through Seed-VC's 44 kHz singing model (`--f0-condition True`) after WORLD-forcing its f0 to the score, to see whether a second SVC behaves differently.
7. Score all of them plus the current SoulX render with `asr_cer.py` (ivrit model) and SingMOS. Daniel listens to three files: current, path-1 SoulX-SVC, path-1 Seed-VC.

**Go** if the consonants are clearly better and the held notes don't sound frozen. **If held notes are the only problem**, do the VITS duration-imposition patch (section 3b (i)) next.

### Experiment 2 (one afternoon, ~$225, or less if a trial or cheaper bundle is available)
1. Install SynthV Studio 2 Pro with a male voice. Check the Phoneme Viewer for the exact Spanish, English and Mandarin symbols (x, r, rr, ts, sh, v, z).
2. Enter the 42 notes of I Sam 20:18 by hand (≈1 h). One note per syllable plus slur notes for melismas. Set each note's language and phonemes from a draft map: vowels from Spanish; ח/כ = es `x`; ר = es `r` (try `rr` on stressed onsets); ב/ו rafe = en `v`; ז = en `z`; ש = en `sh`; צ = zh `ts`.
3. Render twice: default auto pitch, and with a "soft/chest" vocal mode and vibrato reduced on short notes. Export WAV.
4. Score as in experiment 1 and listen. **Go** if it is the smoothest of the set and the consonants are at least as clear as path 1. Then write `scripts/trope-svp.mjs` (score JSON → `.svp`; LibreSVIP's svp model is a reference for the schema).

### Experiment 3 (one afternoon, needs the cantor friend's OK)
1. Pick 15-20 min of his cleanest chanting. If it is reverberant, run separation and dereverb.
2. **Prompt test (10 min):** cut a dry 15 s phrase and make SoulX prompt metadata with `scripts/trope-prompt.mjs` (already on the branch). Re-render the current verse with it, and use it as the prompt in experiment 1.
3. **Polish test (2-3 h on the 4070):** train Applio/RVC for ~200 epochs on the 15-20 min (or fine-tune Seed-VC's singing model for a few hundred steps). Convert the best render from experiment 1 or 2 through it, at `index_rate` 0 and 0.75. Listen for whether the higher index rate also moves the consonants (the kNN effect, section 2).
4. **Labeling dry run (1 h):** run our score engine for 5 of his verses and align with ctc-forced-aligner. Count how many align cleanly. That number decides whether the DiffSinger fine-tune is a 2-weekend or a 4-weekend job.

---

## 8. Open questions for Daniel
1. Is Phonikud-TTS's **non-commercial** licence acceptable as an intermediate stage? Its voice is fully replaced by SVC, and the site is free. If not, path 1 uses ElevenLabs v3 or Gemini TTS as the source instead.
2. Is a one-time ~$225 for Synthesizer V acceptable for experiment 2?
3. Will the cantor friend give written consent to use his recordings as a prompt and for training, even unpublished?
4. Which ר do you want: tap or trill (traditional and Sephardi-leaning, possible in SynthV and in Phonikud's IPA) or uvular (modern Israeli, possible only through path 1 or 3)?
