# Trope engine: synthesizing the cantor's chanted voice from minimal recordings (2025-26 survey)

Researched 2026-10-15. Read-only; nothing else in the repo was changed.
Builds on `docs/superpowers/research/2026-10-15-web-2-0/chant-audio.md` section 2 (the "record everything" survey) and does not repeat it. This document reorients around **minimum recording from Cantor Josh Finkel** and assumes the melody component already exists: a per-syllable score (pitch, duration, Hebrew phonemes, stress) computed from the te'amim. The question here is only the **voice**.

Each claim is tagged **[verified: URL]** or **[inferred]**. "Last push" dates come from the GitHub API on 2026-10-15.

---

## 0. Bottom line

1. **The landscape changed in February 2026.** Open-weights, Apache-2.0, **zero-shot, score-driven** singing synthesis now exists: **SoulX-Singer** (Soul AI Lab, released 2026-02-06) takes MIDI notes plus lyric phonemes plus a short prompt clip and sings in the prompt's timbre, including slur notes (melisma) and cross-lingual prompts. Its English path uses ARPAbet phonemes, which means Hebrew can be hand-mapped without training anything. That is the cheapest credible path and needs **about 2-5 minutes** of the cantor.
2. **DiffSinger (openvpi) fine-tuning is the quality ceiling** for a controllable, offline, CPU-renderable engine, and there is now evidence that **15-30 minutes of a new language fine-tuned onto an English base** matches 3 hours from scratch (a 2025 thesis, no MOS numbers). It needs a Hebrew phoneme dictionary, SOFA alignment, and a GPU for training. Expect 3-4 weekends.
3. **Singing voice conversion** (RVC/Applio, or zero-shot SoulX-Singer-SVC / YingMusic-SVC) remains the strongest **timbre** stage. Its weakness is unchanged: it needs a guide vocal with the right melody and words. With SoulX-Singer producing the guide, that weakness disappears, so "zero-shot SVS -> SVC polish" is a viable two-stage pipeline with 10-30 minutes of the cantor.
4. **Nothing has Hebrew.** No SVS model, no UTAU voicebank (two bare Hebrew reclists exist, no finished bank), no SOFA aligner model, no ACE Studio or Synthesizer V language. Every pipeline below includes a Hebrew-to-phoneme mapping step that Daniel will build. **Phonikud** (Hebrew G2P to IPA with stress, Interspeech 2026) is the right front end for it.
5. **Commercial cloning is a dead end for this use**: ElevenLabs forbids singing and forbids cloning anyone but yourself; Synthesizer V has no custom-voice training; Suno's Voices is self-only and not score-driven; ACE Studio allows consented third-party cloning but only in English/Spanish/Mandarin/Japanese.
6. **Record once, serve every pipeline.** A single 35-45 minute session (design in section 5.0) covers the zero-shot prompt clips, the SVC training set, the DiffSinger fine-tune set, and the concatenation fallback.

---

## 1. What is new since the earlier survey

| Date | Event | Why it matters here |
|---|---|---|
| 2025-11-21 | Seed-VC archived [verified: https://api.github.com/repos/Plachtaa/seed-vc, `archived: true`, last push 2025-04-20, GPL-3.0] | Zero-shot SVC needs a successor. |
| 2025-11-25/26 | **YingMusic-SVC** (Giant Network) released checkpoints, MIT, built on Seed-VC [verified: https://github.com/GiantAILab/YingMusic-SVC] | The direct Seed-VC successor. Last push 2025-12-29. |
| 2025-11-26 / 2026-02-09 | **YingMusic-Singer** beta then V1: zero-shot SVS from lyrics + MIDI or melody audio + 5-7 s timbre prompt, Chinese + English, MIT per README [verified: https://github.com/GiantAILab/YingMusic-Singer] | Second zero-shot score-driven option. Last push 2026-04-28. |
| 2025-12-24 | **HQ-SVC** (AAAI 2026) inference code + weights [verified: https://github.com/ShawnPi233/HQ-SVC] | Low-resource zero-shot SVC, trains in ~11 h on one RTX 3090 with <6 GB, but **no license file** (API `license: null`) and Linux/WSL only. |
| 2026-02-06 | **SoulX-Singer** inference code + weights, Apache-2.0, 42k hours of training data, MIDI- or F0-conditioned, Mandarin/English/Cantonese [verified: https://github.com/Soul-AILab/SoulX-Singer ; https://huggingface.co/Soul-AILab/SoulX-Singer] | The headline change. Last push 2026-05-29, 1,008 stars. |
| 2026-03-16 | **SoulX-Singer-SVC** released (Whisper-base content encoder swapped in) [verified: same README news list] | Zero-shot SVC from the same lab, Apache-2.0. |
| 2026-03-25 | **Vevo2** (Amphion) unified speech + singing, weights at RMSnow/Vevo2 [verified: https://github.com/open-mmlab/Amphion README; https://huggingface.co/RMSnow/Vevo2] | Weights are **CC-BY-NC-ND-4.0** (no derivatives, non-commercial). Private experiments only. |
| 2026-07-30 | **VocalRender** (arXiv 2607.27768): "score-native" SVS from lyrics, pitches, note values, tempo; no code link on the arXiv page [verified: https://arxiv.org/abs/2607.27768] | Direction of travel, not a tool yet. |
| 2025-2026 | openvpi **DiffSinger** still very active (last push 2026-10-15) with `finetune_enabled` / `finetune_ckpt_path`, multi-language dictionaries with ISO-639 tags, `merged_phoneme_groups` [verified: https://raw.githubusercontent.com/openvpi/DiffSinger/main/docs/BestPractices.md] | A Hebrew (`he`) dictionary is a first-class config, not a hack. |
| 2025 (thesis) | English-base DiffSinger (3 h GTSinger) fine-tuned on 15 and 30 min of phoneme-mapped German "can achieve comparable performance to training from scratch on a 3 hours German dataset" [verified: https://campus-fryslan.studenttheses.ub.rug.nl/669/1/BAs6124720Jiashu-Dong.pdf via search snippet; demo page https://dongjiashu.github.io/DiffSinger/ lists the 15 min / 30 min / 3 h conditions but reports no MOS] | The only quantified "DiffSinger from N minutes in a new language" evidence found. One student experiment. |
| 2026 | **Phonikud** Hebrew G2P accepted at Interspeech 2026; ONNX model, IPA with stress and vocal shva [verified: https://github.com/thewh1teagle/phonikud ; https://arxiv.org/abs/2506.12311]. Last push 2026-02-15. README says CC-BY-4.0 for code and data; GitHub API reports Apache-2.0. | Solves Hebrew-text-to-phonemes. The chant engine already has nikud, so Phonikud's stress prediction is the main value. |

---

## 2. Candidates

### (a) Score-driven singing voice synthesis with cloning / few-shot

#### a1. SoulX-Singer (zero-shot, open weights)
- **Input format** [verified: paper HTML https://arxiv.org/html/2602.07803v2 ; preprocess `midi_parser.py` at https://huggingface.co/spaces/Badjals/SoulX-Singer/blob/main/preprocess/tools/midi_parser.py]: a JSON of segments, each with a `time` offset and space-separated `text` tokens, `duration`, `note_pitch`, `note_type`, where "values 1, 2, and 3 correspond to rest, lyric, and slur notes." Mandarin/Cantonese tokens are pinyin; "English is represented using phonemes" wrapped in word-boundary tokens. Prompt audio supplies timbre; the paper uses "the first sentence" of a song as the prompt (training prompts 2-16 s, then 30-90 s). Two conditioning modes: score (MIDI) or melody (F0 contour).
- **Hebrew path** [inferred]: `requirements.txt` pins `g2p_en 2.1.0` [verified: https://raw.githubusercontent.com/Soul-AILab/SoulX-Singer/main/requirements.txt], so English tokens are ARPAbet. The computed score can emit ARPAbet directly for Hebrew syllables (e.g. "ba-ruch" -> `B AA1` / `R UW1 HH`), bypassing g2p. Three expected weak spots: ח/כ (nearest token `HH`; no `x`), ע (zero onset / glottal), and ר (English `R` is an approximant; the cantor's ר is likely uvular or alveolar). The Dreamtonics forum reports the same trick works in Synthesizer V "except for the guttural ch" [verified: https://forum.dreamtonics.com/t/phoneme-help-for-hebrew-german/7522].
- **Melisma**: slur notes (`note_type 3`) let one syllable span several notes [verified: paper]. This maps directly onto chant, where a trope motif usually sits on one stressed syllable.
- **Minimum data from the cantor**: zero training. A prompt clip; the README does not state a length, and YingMusic's comparable guidance is 5-7 s [verified: YingMusic-Singer README]. Record several candidate prompts (section 5.0) and pick the best by ear [inferred].
- **Hardware**: the official repo gives no VRAM figure; the HF Space suggests `zero-a10g` and recommends a "GPU T4 Small" [verified: https://huggingface.co/spaces/Soul-AILab/SoulX-Singer/blob/main/README.md]. Community reports: "under 8 GB VRAM with bf16", measured "just over 5 GB", bf16 weights ~2 GB, fp32 ~4 GB, 10-15 GB disk [verified via search: runcomfy / sonusahani / Pinokio listings; secondary sources]. **Windows**: "not officially supported, use WSL2" per community guides; a Pinokio one-click Windows installer exists (user on an RTX 4090). CPU-only inference: undocumented; [inferred] a flow-matching DiT of a few hundred million parameters would render a 20 s verse in minutes on CPU, so offline pre-rendering is possible, but a ~$0.34/h rented RTX 4090 is the practical route.
- **License**: Apache-2.0 for code and weights; the model card asks users to "Respect intellectual property, privacy, and personal consent" and not to "impersonate individuals without authorization" [verified: README]. A signed license from the cantor satisfies this.
- **Maintenance**: last push 2026-05-29, not archived, 1,008 stars; news through 2026-03-16 [verified: API].
- **Quality**: paper reports cross-lingual score-mode WER 0.110 with SIM 0.898 (Mandarin prompt -> English singing) vs 0.717 WER for Vevosing [verified: paper]. No evaluation of sustained notes or vibrato is reported; training on 42k hours of separated commercial vocals suggests robustness to long notes [inferred]. The paper warns automatic metadata "may not perfectly align" and recommends the MIDI editor; for us the score is computed, so alignment is exact.

#### a2. YingMusic-Singer V1 (zero-shot, open weights)
- **Input** [verified: https://github.com/GiantAILab/YingMusic-Singer]: `--timbre_audio_path` plus its transcript (`--timbre_audio_content`), "prompt audio duration is around 5-7 seconds, and the total duration does not exceed 45 seconds", melody as `--midi_file` or `--melody_audio_path`, `--lyrics` as text, `--pitch_shift`.
- **Language**: Chinese and English text lyrics. No phoneme entry point is documented, so Hebrew would have to be spelled as English pseudo-words ("bah rooch") [inferred]. Weaker than SoulX for this purpose.
- **License**: README says MIT; GitHub API reports `license: null` (no LICENSE file detected) [verified: both]. Confirm before relying on it.
- **Hardware**: not stated; `flash_attn` is in the install, which usually means NVIDIA + Linux [inferred].
- **Maintenance**: last push 2026-04-28, 77 stars [verified: API].

#### a3. DiffSinger (openvpi) + OpenUtau, fine-tuned on the cantor
- **Input**: an OpenUtau project (notes + lyrics through a phonemizer) or `.ds` files for the CLI; the variance model predicts phoneme durations, pitch curve, energy, breathiness from the score [verified: BestPractices.md]. This is the only candidate where the **engine runs on CPU in a desktop app**: "OpenUtau uses CPU to render by default", DirectML optional on Windows [verified: https://github.com/stakira/OpenUtau/wiki/DiffSinger-support].
- **Hebrew**: supported by design. Dictionaries are tab-separated `syllable<TAB>phonemes` text files; languages are tagged with ISO-639 codes; language-specific phonemes get a `he/` prefix; `merged_phoneme_groups` can share `a e i o u` with an English base; `extra_phonemes` adds missing ones [verified: BestPractices.md]. On the OpenUtau side a `dsdict.yaml` needs each phoneme typed as vowel or consonant for syllable splitting [verified: https://github-wiki-see.page/m/xunmengshe/OpenUtau/wiki/Phonemizer via search snippet].
- **Minimum data**: no official number. Community commissions ask for 30 minutes minimum [verified: https://ryankun-difcoms.carrd.co/ ; https://sites.google.com/view/utadroids/commissions/diffsinger-voicebank]. A 2023 ADC talk cites 1-8 hours from scratch [verified: https://data.audio.dev/talks/ADCxSF/2023/creating-your-own-singing-voice-synthesizer/slides.pdf]. **Fine-tuning** from a pretrained checkpoint is supported (`finetune_enabled`, `finetune_ckpt_path`, `finetune_ignored_params` for changed phoneme embeddings) [verified: BestPractices.md], and the German thesis reports 15-30 min fine-tune ~ 3 h from scratch [verified: thesis snippet]. The dataset "should contain all the phonemes in the language" [verified: OpenUtau wiki]. A pretrained singing vocoder (~70 h) is released and vocoder fine-tuning is "highly recommended" [verified: openvpi/vocoders releases; BestPractices.md].
- **Base model availability**: no official multi-speaker English base exists [verified: search returned none]. Options: the thesis base (3 h GTSinger, which is **CC-BY-NC-SA-4.0** [verified: GTSinger README]), community English DiffSinger datasets, or training a small base from PocketTorah's CC-BY-SA haftarah audio (section 6). Any base trained on GTSinger inherits NC-SA.
- **Labeling**: SOFA (MIT, last push 2026-09-02) aligns phonemes to singing; custom dictionary via `--dictionary` or a custom g2p; fine-tuning a SOFA model from a pretrained one is supported (`train.py -p`) [verified: https://github.com/qiuqiao/SOFA]. Shared SOFA models exist for zh, ja, yue, en, fr; none for Hebrew [verified: https://github.com/qiuqiao/SOFA/discussions/categories/pretrained-model-sharing]. The English `tgm_en_v100` model (2024-08) is the one to fine-tune; a public alternative `Silasimo/SOFA-combined` is CC-BY-NC-SA [verified: https://huggingface.co/Silasimo/SOFA-combined]. GUI wrappers: LabelMakr, vLabeler; local trainer DiffTrainer (Windows `.bat`, CUDA 11.8-12.9, last push 2026-10-05, no license file) [verified: https://github.com/agentasteriski/DiffTrainer ; API]; Colab trainer DiffSinger4Colab (last push 2026-06-22) [verified: API].
- **Hardware**: a deepwiki summary of the openvpi docs lists 8 GB VRAM minimum, 16 GB+ and 32 GB RAM recommended [verified via search: https://deepwiki.com/openvpi/DiffSinger/1.2-installation-and-requirements, secondary]. Original paper: V100, ~28 h for two 160k-step stages at batch 48 [verified: https://arxiv.org/abs/2105.02446]. Commissioners call 50k steps "usable" and 100k+ "optimal" [verified: Ryankun]. [inferred] A 30-minute fine-tune for 20-40k steps on a rented RTX 4090 (~$0.34/h community cloud [verified: hivenet/hostinger 2026 pricing pages via search]) is roughly 3-6 h, so **$1-3**; from scratch at 100k steps roughly 10-20 h, **$4-8**.
- **License**: Apache-2.0 [verified: API]. OpenUtau MIT, last push 2026-10-15 [verified: API].
- **Quality**: DiffSinger is the de facto standard for hobbyist SVS voicebanks; sustained vowels and vibrato are handled by the variance model's pitch predictor; melisma is expressed as slur notes in OpenUtau. The failure mode on small data is phoneme coverage, not sustain [inferred from community guidance that the dataset must cover all phonemes].

#### a4. Research systems without usable weights
- **TCSinger 2** (ACL 2025): MIT code released 2025-07, **no checkpoints** mentioned; training examples use 8 GPUs; last push 2026-04-19 [verified: https://github.com/aaronz345/tcsinger2 ; API]. StyleSinger 2: no release found. **GTSinger** is a dataset (CC-BY-NC-SA-4.0) [verified].
- **Everyone-Can-Sing** (ICASSP 2025, Dai/Dannenberg/Jin): 5 s speech reference, score + lyrics in; **no code or weights** on the project page [verified: https://everyone-can-sing.github.io/].
- **CoMelSinger**: demo only, no repo found [verified: search].
- **DiTSinger** (2510.09016): Chinese, 500 h synthetic, demo page only [verified: https://arxiv.org/abs/2510.09016].
- **VocalRender** (2607.27768): no code link on arXiv [verified].
- **Vevo2** (Amphion, 2026-03-25): six tasks incl. text-to-singing and SVS; AR 0.5B + FM 350M + Vocos 250M; **weights CC-BY-NC-ND-4.0** [verified: https://huggingface.co/RMSnow/Vevo2]. Inputs are text + reference audio; no documented MIDI entry [verified]. Fine for a private A/B, not for a published pipeline.
- **Song generators** (ACE-Step 1.5, YuE, SongBloom, LeVo, DiffRhythm): lyrics-to-song, prompt- or reference-driven, no per-note score control; ACE-Step last push 2026-10-09, license NOASSERTION on GitHub [verified: API]. Not score engines; skip.

### (b) UTAU / OpenUtau concatenative voicebank (Hebrew reclist)
- **What exists**: two bare Hebrew reclists, "Zanav CV" and "Zanav VCV", both "no base OTO", plus a CV-VC list by Yoyosama and an experimental "Element" CV list by AdamSnowflake (2022-08-30) with chet/ayin/resh entries [verified: https://utau.fandom.com/wiki/Reclist_Directory via search; https://utaulanguageresources.weebly.com/hebrew.html via search; https://www.deviantart.com/adamsnowflake/journal/Element-Hebrew-Reclist-expeiremntal-UTAU-927740510]. **No finished Hebrew voicebank** was found.
- **Size**: a Hebrew CV list is small. [inferred, my count] ~20 consonant phonemes (b v g d h z x t y k l m n s p f ts r sh) x 5 vowels + vocal shva = ~110-125 CV samples, plus ~20 vowel-initial and ~100 VC endings for a CVVC-style bank; about 250 samples. At one sample per 3-4 s with RecStar (Apache-2.0, last push 2026-04-14 [verified: API]) that is **15-25 minutes of recording** at one pitch; a second pitch doubles it. For scale, Salem's English CVVC lite is 209 strings, "about 1 hr to record", 1,635 oto lines [verified: https://utau.felinewasteland.com/en/overview].
- **Tooling**: RecStar for recording; vLabeler for oto; OpenUtau's built-in `worldline` resampler "works on all platforms" [verified: https://github.com/openutau/OpenUtau/wiki/Resamplers-and-Wavtools]. Auto-oto tools are Japanese/Korean-only (Otomata, AutoOTO v2) [verified: search], so Hebrew oto is manual: ~250 entries x 5 markers, a long evening with vLabeler [inferred].
- **Quality ceiling**: classic UTAU. Pitch-shifted WORLD resynthesis sounds robotic on wide intervals and sustained notes; `hifisampler`/`kuresampler` neural resamplers improve it [verified: wiki entries]. Below DiffSinger and below SVC on naturalness [inferred, consistent with the community's migration to DiffSinger].
- **Verdict**: the pragmatic **zero-GPU** baseline, and the same CV recordings double as phoneme-coverage data for DiffSinger (Voicebank2DiffSinger converts a UTAU bank into a DiffSinger dataset using SOFA [verified: https://github.com/Lqm1/Voicebank2DiffSinger]). Not the primary bet.

### (c) Singing voice conversion as the final timbre stage
- **RVC / Applio** (MIT; "Applio will no longer receive frequent updates", security and dependency patches only; Windows `run-install.bat`; last push 2026-10-14) [verified: https://github.com/IAHispano/Applio ; API]. RVC-WebUI upstream: MIT, last push 2026-08-04 [verified: API]. **Data**: Applio docs mirror: "recommended minimum is 10 minutes ... 20-30 minutes generally produces noticeably better results" [verified: https://mintlify.wiki/IAHispano/Applio/features/training]; AI Hub: 15 min "not counting silence" for beginners, 40+ for natural [verified: https://docs.aihub.gg/rvc/resources/dataset-isolation/]; community consensus that 10 min clean beats 60 min noisy [verified: search]. so-vits-svc is **archived** (AGPL, last push 2023-11-11) [verified: API].
- **Zero-shot successors**: SoulX-Singer-SVC (Apache-2.0, "waveform and F0 inputs", prompt timbre) [verified: README]; YingMusic-SVC (MIT, Seed-VC-based, checkpoints 2025-11-25, Linux-style install) [verified]; HQ-SVC (no license, Linux/WSL, <6 GB train, ~11 h RTX 3090) [verified]. Author-reported GMO-SVS numbers: SoulX-SVC SIM 0.904 on Chinese, YingMusic-SVC highest SIM, Vevo-SVC highest SingMOS [verified: SoulX paper]. SVCC 2025 (26 systems) found top systems reach ground-truth-level identity but "naturalness and style modeling remained hard, mainly for breathy, glissando, and vibrato" [verified: https://arxiv.org/pdf/2509.15629].
- **Seed-VC fine-tune guidance survives in the archived README**: "minimum 1 utterance per speaker", "minimum 100 steps, 2 min on T4", 44.1 kHz singing model 200M params [verified: https://github.com/Plachtaa/seed-vc].
- **Minimum clean data, with evidence**: zero-shot = one 5-30 s clip; RVC 5 min = "weak but functional" / "flat"; 10 min = documented minimum; 20-30 min = recommended; 40+ = diminishing returns [verified: sources above]. No controlled 5-vs-10-vs-30 benchmark exists; these are documentation and community reports.
- **Guide vocal**: either Daniel chants the verse (then SVC only fixes timbre, and Daniel's accuracy becomes the melody source of truth), or SoulX-Singer renders the guide from the computed score with a generic or the cantor's prompt. The second removes any human from the per-verse loop [inferred].
- **Quality**: sustained vowels are RVC's strong suit (it is the karaoke-cover standard); breath, consonant bursts and uvular ר are where artifacts cluster [inferred from SVCC 2025 findings and community reports].

### (d) Speech TTS with pitch control
- **CosyVoice 3**: the paper states singing "is not supported" in instructed generation and that it "does not perform quite well for generating singing voice" [verified: https://arxiv.org/html/2505.17589v2]. **Qwen3-TTS**: natural-language control of timbre/emotion/prosody; the only singing mention is a tokenizer "Singing Reconstruction" sample [verified: https://github.com/QwenLM/Qwen3-TTS]. **Fish Audio S2**, **IndexTTS2**: no singing or melody input documented [verified: search]. **ElevenLabs**: "Professional Voice Clones do not currently support singing" [verified: https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning]. **Vevo2** is the only "TTS that can sing", and its weights are NC-ND.
- Hebrew speech TTS plus pitch correction (WORLD/PSOLA to the computed F0) would produce an intelligible but spoken-timbre chant; [inferred] worse than (e) because the cantor's sung timbre is lost twice.
- **Verdict**: weak, as expected. Only use: a spoken reading voice, not asked for.

### (e) Signal-processing concatenation of the cantor's own units
- **Tools**: WORLD (modified-BSD, last push 2026-06-17) [verified: API]; `pyworld 0.3.5` on PyPI [verified: search]; PyTSMod (TD-PSOLA, WSOLA, phase vocoder; pitch-shift "planned") [verified: https://github.com/KAIST-MACLab/PyTSMod]; World.JS (Emscripten, MIT, **last push 2022-06-16**, 35 stars) [verified: API]. OpenUtau's `worldline` is the maintained C++ WORLD engine on all platforms [verified: wiki].
- **Design** [inferred]: record each trope-family motif on real words and on a neutral vowel, plus the CV inventory from (b). At render time, for each syllable pick the CV unit, stretch to the score duration with WORLD, impose the computed F0 curve (melisma is just an F0 contour over one vowel, which WORLD handles well), crossfade. This is TropeTrainer's architecture with a human voice.
- **Effort**: a weekend for a Python prototype with `pyworld`; a browser build would need a WASM WORLD (World.JS is stale; compiling `mmorise/World` with Emscripten yourself is a day) [inferred].
- **Quality**: deterministic and never melodically wrong; timbre is recognizably the cantor's on single notes; buzzy on long stretches and audibly seamed at consonant joins. Equivalent to the 2.0 survey's "path 3" [inferred].
- **Verdict**: the floor, not the ceiling. Worth building because it needs only the 35-minute session and no GPU, and because it is the fallback if every neural path accents the Hebrew.

### (f) Commercial
| Service | Singing? | Clone a consenting third party? | Score input? | Data | Notes |
|---|---|---|---|---|---|
| ElevenLabs PVC | **No** ("spoken voice only") | **No** ("Even with their consent, you cannot clone someone else's voice") | No | 30 min minimum, 2-3 h recommended | [verified: ElevenLabs docs] |
| ACE Studio Custom Voice | Yes | **Yes** with "explicit legal permission"; ACE may request written or recorded consent | AI singers follow MIDI; custom-voice-from-MIDI implied | "recommended duration is 30-100 minutes"; blog: 5 min basic, 10-30 better; 30-100 files of 10 s-10 min | Custom voices sing in **English, Spanish, Mandarin, Japanese only**; the usage guideline limits training audio to Chinese/Japanese/English [verified: https://acestudio.ai/custom-voice/ ; https://support.acestudio.ai/article/123-usage-guidelines-for-ace-custom-voice-model]. Hebrew would be sung through English phonemes. ~$22/mo tier. |
| Synthesizer V Studio 2 | Yes | **No training**: "doesn't have built-in functionality for creating your own unique voices"; Vocoflex voice-transform plugin is the workaround | Yes | n/a | [verified: https://dreamtonics.zendesk.com/hc/en-us/articles/44277851670681] No Hebrew. |
| Suno Voices (v5.5, 2026-03-26) | Yes | **Self only**, live verification of a random phrase; Pro/Premier; opt-in to training | No (prompt-driven) | 10 s-1 min | [verified: https://suno.com/voices and guides] Not score-driven; useless for trope. |
| Udio | n/a | UMG settlement, licensed successor pending | No | n/a | [verified: search] |
| kits.ai | Yes (SVC) | Terms not found; one review trained on 14 min in 38 min | No (SVC) | unstated | ~$10-20/mo; pricing inconsistent across reviews [verified: search]. Self-hosted RVC does the same. |
| Voice.ai | SVC | Terms not found | No | unstated | Skip. |

**Consent pattern across the industry** [verified: Azure, Resemble docs via search]: a recorded consent statement in the talent's own voice, matched to the training audio. Have the cantor record one as part of the session (section 5.0) regardless of which engine is used.

---

## 3. Repo status (GitHub API, 2026-10-15)

| Repo | Last push | Archived | License (API) | Stars |
|---|---|---|---|---|
| openvpi/DiffSinger | 2026-10-15 | no | Apache-2.0 | 3,221 |
| openutau/OpenUtau | 2026-10-15 | no | MIT | 4,414 |
| IAHispano/Applio | 2026-10-14 | no (reduced updates) | MIT | 3,835 |
| ace-step/ACE-Step | 2026-10-09 | no | NOASSERTION | 4,937 |
| agentasteriski/DiffTrainer | 2026-10-05 | no | none | 51 |
| qiuqiao/SOFA | 2026-09-02 | no | MIT | 245 |
| RVC-Project/RVC-WebUI | 2026-08-04 | no | MIT | 38,756 |
| usamireko/DiffSinger4Colab | 2026-06-22 | no | none | 15 |
| ShawnPi233/HQ-SVC | 2026-06-17 | no | **none** | 123 |
| mmorise/World | 2026-06-17 | no | NOASSERTION (modified BSD) | 1,351 |
| Soul-AILab/SoulX-Singer | 2026-05-29 | no | Apache-2.0 | 1,008 |
| GiantAILab/YingMusic-Singer | 2026-04-28 | no | none (README: MIT) | 77 |
| AaronZ345/TCSinger2 | 2026-04-19 | no | MIT (no weights) | 186 |
| sdercolin/recstar | 2026-04-14 | no | Apache-2.0 | 132 |
| open-mmlab/Amphion (Vevo2) | 2026-03-25 | no | MIT code; weights CC-BY-NC-ND | 10,311 |
| openvpi/MakeDiffSinger | 2026-03-11 | no | BSD-3-Clause | 153 |
| thewh1teagle/phonikud | 2026-02-15 | no | Apache-2.0 (API); README: CC-BY-4.0 | 132 |
| GiantAILab/YingMusic-SVC | 2025-12-29 | no | MIT | 170 |
| oatsu-gh/ENUNU | 2025-12-14 | no | MIT | 110 |
| Plachtaa/seed-vc | 2025-04-20 | **yes (2025-11-21)** | GPL-3.0 | 3,896 |
| nnsvs/nnsvs | 2023-10-09 | no (dormant) | MIT | 754 |
| svc-develop-team/so-vits-svc | 2023-11-11 | **yes** | AGPL-3.0 | 28,076 |
| GloomyGhost-MosquitoSeal/World.JS | 2022-06-16 | no (stale) | MIT | 35 |

---

## 4. Ranking

Scores are 1 (worst) to 5 (best). "Feasibility" means one developer with Claude Code, Windows 11, GPU unknown, a few weekends.

| Candidate | Minimal recording | Quality ceiling | Feasibility | Notes |
|---|---|---|---|---|
| **A. SoulX-Singer zero-shot, Hebrew via ARPAbet** | **5** (2-5 min) | 3-4 | **4** | Only unknown is the Hebrew accent through English phonemes. Rentable GPU, $1-2 total. |
| **B. SoulX-Singer guide -> SVC (SoulX-SVC zero-shot or RVC fine-tuned)** | 4 (zero-shot) / 3 (10-30 min RVC) | **4** | 4 | Adds a timbre pass that fixes most of A's "sounds like a generic singer" problem; cannot fix A's consonants. |
| **C. DiffSinger fine-tune (openvpi) + OpenUtau** | 3 (20-30 min, phoneme-balanced, labeled) | **5** | 2-3 | Real Hebrew phonemes, CPU inference in a desktop app, full variance control. Most engineering: dictionary, SOFA, training, export. |
| D. Daniel chants -> RVC of the cantor | 3 (10-30 min) | 4 | 5 | Fastest to a convincing demo; melody accuracy depends on Daniel each week. |
| E. WORLD concatenation of the cantor's units | 4 (30 min) | 2 | 4 | No GPU, deterministic, TropeTrainer parity. The fallback. |
| F. OpenUtau classic Hebrew voicebank | 4 (15-25 min + oto) | 2 | 3 | Superseded by C; its recordings feed C. |
| G. ACE Studio custom voice (commercial) | 3 (30-100 min recommended) | 3 | 4 | English-phoneme Hebrew, $22/mo, closed. Consent terms are acceptable. |
| H. Vevo2 / YingMusic-Singer | 5 | 3 | 2 | Vevo2 NC-ND; YingMusic has no phoneme entry. Private A/B references only. |
| I. Speech TTS + pitch correction | 5 | 1 | 3 | Not chant. |

---

## 5. Recommended pipelines to prototype

### 5.0 The one recording session (serves all three pipelines)

Design [inferred; my proposal], 48 kHz / 24-bit WAV, dry room, cardioid mic 15-20 cm, 2 s silence between items, RecStar or a DAW with a slate before each item. **Target 35-45 minutes of studio time, about 25-30 minutes of audio.**

| Block | Content | Minutes | Used by |
|---|---|---|---|
| 1. Consent statement | 20 s spoken, in his voice: name, date, what he consents to | 0.5 | Every engine's terms; the voice license |
| 2. Prompt candidates | 6-8 clips of 8-15 s each: one full verse at comfortable pitch, one high, one low, one slow, one with the haftarah closing cadence, one on "la" | 2 | A, B (zero-shot prompts) |
| 3. Trope-family motif set | every haftarah trope motif (incl. sof pasuk and the haftarah final cadence) on 2 real words each, in tempo | 6-8 | E (units), C (training), the existing trope drills |
| 4. Verses across range | 20-25 verses from 3-4 haftarot, chosen for phoneme coverage (ח ע ר ts sh, vocal shva, dagesh pairs), each as its own take | 8-10 | C, D (training), B (RVC) |
| 5. CV inventory | ~120 Hebrew CV syllables + 6 sustained vowels at 3 pitches, 3 s each, to a click | 8-10 | F, E, C (phoneme coverage) |
| 6. Sustains and slides | each vowel held 6 s at 3 pitches; 4 slow glissandi | 2 | C variance model, E |

Phoneme coverage check before the session: run the chosen verses through Phonikud, count phonemes, add verses until every Hebrew phoneme appears at least 10 times in a stressed and an unstressed position [inferred].

### 5.1 Pipeline A: zero-shot score-driven SVS (SoulX-Singer), Hebrew via hand-mapped ARPAbet
- **Recording**: blocks 1-2 (2-3 min). Nothing else is strictly required.
- **Labeling/alignment**: none. The score engine emits SoulX metadata JSON directly: per syllable `text` = ARPAbet tokens, `note_pitch` = MIDI, `duration` = seconds, `note_type` = 2 for the first note of a syllable, 3 for melisma continuation notes, 1 for rests [verified format: midi_parser.py]. Mapping table (first draft) [inferred]: א/ע -> no onset (or a short `HH` where a glottal is audible), ב `B`/`V`, ג `G`, ד `D`, ה `HH`, ו `V`, ז `Z`, ח/כ `HH` (test also `K` + `HH`), ט/ת `T`, י `Y`, כּ/ק `K`, ל `L`, מ `M`, נ `N`, ס/שׂ `S`, פ `P`/`F`, צ `T S`, ר `R` (test against a Mandarin prompt in melody mode if the approximant is too American), שׁ `SH`; vowels patach/kamatz `AA`, segol/tzere `EH`, chirik `IY`, cholam `OW` (or `AO`), kubutz/shuruk `UW`, vocal shva `AH0`. Stress from Phonikud -> ARPAbet stress digit.
- **Training cost**: $0. **Inference**: rented RTX 4090 at ~$0.34/h; [inferred] a 20 s verse renders in well under a minute, so a full haftarah (~25 verses) is a few minutes and the whole annual cycle (~1,900 verses) is a few hours, about $1-2. Pre-render offline, store MP3s in Blob as the 2.0 survey planned.
- **Biggest risk**: Hebrew through English phonemes sounds like an American singer chanting transliteration, especially ר and ח. Mitigations: compare English-token vs melody-mode rendering, try a Mandarin-tagged `x`-like token if the tokenizer allows, and apply pipeline B's SVC pass. If it still reads as accented, this pipeline becomes the guide-vocal generator for B rather than the final voice.
- **Second risk**: Windows. Plan on WSL2 or a cloud box from day one [verified: community guides say native Windows is unofficial].

### 5.2 Pipeline B: A's output as guide vocal -> singing voice conversion into the cantor
- **Recording**: blocks 1-2 for zero-shot SVC (SoulX-Singer-SVC, Apache-2.0); add block 4 (8-10 min) and block 3 for an RVC/Applio model (total 15-20 min of clean chant, which clears Applio's 10-minute documented minimum and approaches its 20-30-minute recommendation [verified: Applio docs mirror]).
- **Labeling**: none for SVC. Applio only needs sliced WAVs.
- **Training**: RVC on ~20 min, 200-300 epochs [verified: Applio CLI example uses 200 epochs], 1-3 h on a T4/4090, under $2. Zero-shot SVC: none.
- **Inference**: render the guide with A (any prompt voice, even a generic one), convert with SoulX-SVC (prompt = block 2) or RVC (model = blocks 3+4). Feed the computed F0 as the SVC's pitch input so melody is never re-estimated from the guide [inferred: SoulX-SVC takes "waveform and F0 inputs"].
- **Biggest risk**: the SVC inherits A's consonants and vowel colors; it fixes timbre, not accent. Secondary risk: RVC "flatness" on 5-10 minute sets; stay above 15 minutes.

### 5.3 Pipeline C: DiffSinger fine-tune with a real Hebrew phoneme set, rendered in OpenUtau on CPU
- **Recording**: blocks 3, 4, 5, 6 (25-30 min of audio). This is the full session.
- **Labeling/alignment**: (1) write a `he` dictionary (`syllable<TAB>phonemes`) with ~25 phonemes, merging vowels with the English base via `merged_phoneme_groups` [verified: BestPractices.md]; (2) transcriptions from the score engine (word -> phonemes), so `.lab` files are generated, not typed; (3) fine-tune SOFA's `tgm_en_v100` on the labeled verses with Hebrew consonants added, then align everything; (4) MakeDiffSinger `acoustic-forced-alignment` -> `variance-temp-solution` to build the variance set, with the MIDI coming from the score engine rather than SOME [verified: MakeDiffSinger README lists both pipelines].
- **Training**: acoustic fine-tune from an English base (`finetune_enabled`, ignore phoneme-embedding params), 20-40k steps; variance model (duration + pitch + energy + breathiness) on the same data; vocoder fine-tune from the openvpi pretrained NSF-HiFiGAN ("highly recommended"). [inferred] 6-12 GPU-hours on a 4090, $2-5; or free Colab via DiffSinger4Colab across several sessions; or DiffTrainer locally if the PC has an 8 GB+ NVIDIA card (DiffTrainer is Windows-native with CUDA 11.8-12.9 [verified]).
- **Inference**: export ONNX (`scripts/export.py acoustic|variance`), package as an OpenUtau singer with `dsdict.yaml` (vowel/consonant typed), render on CPU in OpenUtau; or drive the CLI with `.ds` files generated from the score engine for batch pre-rendering [verified: GettingStarted.md inference section].
- **Base-model licensing**: if the base is GTSinger-derived, the result is CC-BY-NC-SA-tainted; acceptable for a nonprofit study site but write it in the decisions log. Cleaner: build a small base from PocketTorah CC-BY-SA haftarah audio (section 6) [inferred].
- **Biggest risk**: engineering depth. Four tools (Phonikud, SOFA, DiffSinger, OpenUtau) each need a Hebrew-specific config, and the 15-30-minute claim rests on one thesis without reported MOS. Budget 3-4 weekends, and treat A+B as the shipping path if C slips.

### 5.4 Fallback E: WORLD concatenation
Build it in parallel because it costs an evening and needs only blocks 3 and 5. It is the "melodically correct, obviously synthetic" floor and a useful A/B reference for the cantor's blind review.

---

## 6. Smallest possible experiment (before the cantor records anything)

Goal: prove the mechanics end to end in one weekend, with zero cantor time, using **PocketTorah** haftarah audio (CC-BY-SA 3.0, 515 OGG files, `<Parsha>-H.ogg` naming) [verified: https://archive.org/details/PockettorahAudioFiles ; "-H" = haftarah is inferred from the naming and from the 2.0 survey's duration measurement of 54 weekly haftarot] and **Daniel's own voice**.

1. **Score -> SoulX JSON** (2-3 h): take one verse the engine already scores (e.g. Isaiah 42:5), emit the metadata JSON with ARPAbet tokens, MIDI pitches, durations, and `note_type` slurs for melisma. Validate with `midi_parser.py` and the MIDI-editor Space.
2. **Zero-shot render** (1-2 h on a rented 4090 or the HF Space): prompt = a 10 s clip of the PocketTorah reader, then a 10 s clip of Daniel. Listen for Hebrew intelligibility, ר/ח, melisma smoothness, and whether the sof-pasuk cadence survives. This is the go/no-go for pipeline A.
3. **SVC pass** (1 h): convert the render with SoulX-Singer-SVC using Daniel's clip as prompt. Then record Daniel chanting the same verse and convert that too. Compare the three: does the SVC fix what A gets wrong?
4. **RVC floor test** (optional, 2 h): train Applio on 10 min and on 20 min of PocketTorah reader audio; convert Daniel's chant into the reader. This calibrates the 10-vs-20-minute question with real haftarah material rather than pop vocals.
5. **DiffSinger dry run** (a second weekend): slice ~30 min of one PocketTorah reader's haftarot into verses (ffmpeg silencedetect), generate `.lab` from the engine's phonemes, align with SOFA `tgm_en` plus a Hebrew dictionary, fine-tune for 10k steps, export to OpenUtau, render a verse. Quality will be poor at 10k steps; the point is that every file format round-trips. This also yields a CC-BY-SA Hebrew base model that pipeline C can fine-tune later instead of a GTSinger-tainted one.
6. **Concatenation baseline** (one evening): `pyworld` on PocketTorah units for the same verse. Keep it as the floor for all later blind comparisons.

Deliverable: six renderings of one verse (A-generic, A-Daniel, A+SVC, Daniel+SVC, DiffSinger-dry-run, WORLD) and a one-page listening note. Only then schedule the cantor's 45-minute session, with the prompt-clip design tuned by what worked.

---

## 7. Costs

| Item | Estimate |
|---|---|
| Cloud GPU for experiments (RTX 4090 community cloud, ~$0.34/h [verified: hivenet/hostinger 2026 pricing pages]) | $5-15 total across the smallest experiment |
| RVC training | <$2 |
| DiffSinger fine-tune + variance + vocoder | $2-8 |
| Rendering the full annual cycle with A or C | $1-3 (A) / $0 on CPU (C) |
| ACE Studio, if tried | $22/mo for 1-2 months |
| Recording gear | as in the 2.0 survey ($0-450) |

All well inside the existing $20/month ceiling once pre-rendered.

---

## 8. Risks specific to minimal recording

- **Accent through borrowed phonemes** (A, B, G): the single biggest quality risk; only a listening test settles it.
- **Phoneme coverage in 25 minutes** (C): a few rare phonemes (ע as a true pharyngeal, if he uses one; vocal shva in unusual contexts) may be under-represented; the CV block (5) is the insurance.
- **Weights as a deepfake asset**: an RVC `.pth`, a DiffSinger ONNX, or even the 10 s prompt clips let anyone sing anything in his voice. The 2.0 survey's rule stands: never in the repo or Blob; encrypted local storage; deletion on revocation.
- **License stacking**: Apache (SoulX, DiffSinger) + MIT (OpenUtau, Applio, SOFA) + CC-BY-SA (PocketTorah-derived base) + CC-BY-4.0 (Phonikud) is clean; avoid Vevo2 (NC-ND), HQ-SVC (no license) and GTSinger-derived bases (NC-SA) in anything published.
- **Tool churn**: SoulX-Singer is 8 months old with one lab behind it; DiffSinger/OpenUtau is the durable platform. The WAVs and the score engine are the assets; models are disposable.

---

## 9. Questions only Daniel or the cantor can answer

1. **Cantor:** how do you pronounce ר (uvular, alveolar tap, or American), ח vs כ (same /x/ or distinguished), and ע (silent, glottal, or pharyngeal)? This decides the phoneme set for every pipeline and whether English ARPAbet can even approximate it.
2. **Cantor:** which haftarah nusach and reference book do you chant (Binder, Jacobson, teacher tradition), and is the score engine's motif table already matched to it? A zero-shot engine will sing whatever the score says; the score must be his.
3. **Cantor:** will you sign the three grants from the 2.0 survey (recordings, private model training, published synthetic voice), and will you record a spoken consent statement in the session?
4. **Cantor:** can you give one 45-minute session now (section 5.0), and are you willing to re-record a 10-minute block later if the phoneme coverage check finds gaps?
5. **Daniel:** does the PC have an NVIDIA GPU, and with how much VRAM? (8 GB makes DiffTrainer and SoulX local; otherwise everything neural runs on a ~$0.34/h rental and the only local engines are OpenUtau CPU rendering and WORLD.)
6. **Daniel:** is "sounds like Josh, with a slight American accent on ר and ח" acceptable for a labeled AI voice on the study sheet, or is only native-sounding Hebrew acceptable? That is the difference between pipelines A/B (weeks) and C (a season).
7. **Daniel:** may PocketTorah's CC-BY-SA haftarah recordings be used to train a Hebrew *base* model that the cantor's data then fine-tunes? The resulting model would be share-alike; it would never be published, but the decision should be logged.
8. **Daniel:** how much weekend time is this worth before deciding? Suggest one weekend for section 6 steps 1-4, then decide whether C is pursued at all.
9. **Daniel:** will you serve as the fallback guide vocalist (pipeline D) for weeks when a render fails review, and is your own chant accurate enough in the cantor's nusach for that?
10. **Daniel:** does the score engine already emit per-syllable stress and melisma grouping (which notes belong to one syllable)? Both are required inputs for A and C; if not, that is the first thing to build.
