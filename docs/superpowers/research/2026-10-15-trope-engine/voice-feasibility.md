# Voice feasibility: the prompt voice, the 6 GB card, and one rendered Hebrew verse (2026-10-15)

Research-and-experiment report. Scratchpad: `C:\Users\dsbog\AppData\Local\Temp\claude\C--Users-dsbog-haftarah\a7f4aefe-3700-425e-87ab-0020f95626f2\scratchpad\voice\` (referred to below as `S\`). Nothing in the repo was changed except this file. No money was spent; the only compute used was the free Hugging Face ZeroGPU tier and this PC.

Tags: **[V]** verified at the URL given; **[M]** measured here (command shown); **[I]** inferred.

---

## 0. Bottom line

1. **The mechanics work.** I Samuel 20:18 was rendered end to end through the official SoulX-Singer Space from a score JSON built by hand from the Binder/Avery cells: 42 notes, 14.25 s, Hebrew through English ARPAbet, melisma as slur notes. The result is at `S\work\variantA.wav`. A pyin pitch track puts **33 of 33 pitched notes within +/-0.5 semitone of the intended scale degree (median error 0.11 st, max 0.41 st)**, which is the same accuracy the model achieves on its own English demo (19/20, median 0.11 st) [M]. Melisma on CHO-desh (3-1-3-5-4), KAD-ta (5-3-1-4) and KED (5-3-7_) tracks every note. What I cannot verify without ears: Hebrew intelligibility, how American the ח/ר sound, and whether the chant "reads" as haftarah rather than pop. **Daniel must listen** (section 4).
2. **Prompt voice.** The demo prompts shipped with SoulX-Singer are separated stems of commercial pop recordings (the English one is Adele's "Someone Like You", the target is Selena Gomez's "Who Says"); the Space's SVC examples include `obama.wav`. They are fine for a mechanics test and unusable for a published voice. **Recommended default: Daniel's own 20-30 s prompt** (consent-trivial, zero licence stack, and the model's cross-lingual prompting means an English or Hebrew prompt both work). **Fallback: a VocalSet male singer (CC BY 4.0, anonymised "male1..male11", a cappella, studio booth)**, with the honest caveat that the 2018 singers were recruited for a research dataset and never consented to voice cloning; the licence permits it, the ethics are grey, and the anonymity is what makes it tolerable for a labeled AI voice on a nonprofit site. Nothing "nobody's" is clean: SoulX has no speaker embedding to interpolate, and a public-domain Rosenblatt 78 is both a famous named cantor and acoustically too poor.
3. **This PC runs it.** SoulX-Singer ran **Windows-native on the GTX 1660 Ti, fp16, Python 3.12, no WSL, no Triton**: 704.3 M parameters, **1.53 GB peak allocated / 2.84 GB peak reserved / 2.9 GB by nvidia-smi**, 12 s to load, **86 s to render the 14.25 s verse** (about 6x real time) [M, section 2.4]. The output is pitch-identical to the Space's (33/33 within +/-0.5 st). The maintainers' "~12 GB" / "~10 GB fp16" figures [V issues #16, #25] are for the WebUI, which also loads separation, ASR and note-transcription models; the CLI in score mode loads only the synthesizer. A full haftarah (~25 verses) is ~35 min on this card; the annual cycle (~1,900 verses) ~45 h, i.e. a few overnight batches. **Baseline: local. The Space is for quick A/Bs.**
4. **Free compute.** The official Space (`Soul-AILab/SoulX-Singer`) runs on ZeroGPU and takes a score JSON directly through `gradio_client` (`/synthesis_function`). Each call is billed as 60 s of quota whatever it actually takes (~10-14 s); the unauthenticated allowance is 2 min/day, a free HF account gets 5 min/day, PRO 40 min [V]. **Three renders a day without a token, five with one.** YingMusic-Singer's official Space is PAUSED; a community duplicate of the Plus model is up but takes melody audio only (no MIDI) and plain-text lyrics (no phoneme entry), so it is a second-tier option.
5. **Phoneme set.** SoulX's tokenizer is exactly CMU ARPAbet (39 phones, stress digits 0/1/2 on vowels) plus 1,201 Mandarin pinyin syllables and 1,529 Cantonese jyutping syllables [V, `phone_set.json`]. No /x/, /ʕ/, /ʔ/, /ʁ/ or single /ts/ token. Mandarin `zh_h*` syllables are a velar fricative [x], i.e. a real ח, and `zh_z*`/`zh_c*` are [ts]/[tsʰ], i.e. a real צ; mixing them into an English note sequence is syntactically allowed by the data processor (each note is one token or one `en_` word) but untested here because the daily quota ran out (section 3.4).

---

## 1. The prompt voice when it is not Josh

How SoulX uses the prompt [V, `soulxsinger/models/soulxsinger.py` `infer()`]: the prompt is a waveform plus its own metadata (phonemes, note pitches, note types, durations, f0). The model concatenates prompt and target note sequences, feeds the prompt's mel as in-context conditioning to the flow-matching decoder, and generates the target mel. There is **no speaker embedding**: timbre lives in the prompt mel and its alignment. Consequences: (a) the prompt needs transcribed metadata, not just audio; (b) anything you can transcribe can be a prompt, including speech; (c) there is nothing to interpolate.

### 1a. Demo/prompt audio shipped with the models

| Source | Files | What they are | Licence as shipped | Verdict |
|---|---|---|---|---|
| SoulX-Singer GitHub `example/audio/` | `en_prompt.mp3` (5.06 s, "Ooh... I wish nothing [but] the best"), `en_target.mp3` ("Who says you're not pretty... who says you're not beautiful"), `zh_prompt.mp3`, `zh_target.mp3`, `yue_target.mp3`, `music.mp3`, `svc_*_demo.mp3` | Vocal stems separated from commercial recordings. The English prompt lyric is Adele, "Someone Like You" (2011); the English target is Selena Gomez & The Scene, "Who Says" (2011) [V lyrics in `en_prompt.json` / `en_target.json`; identification [I] from the lyric lines]. | Repo is Apache-2.0 [V https://github.com/Soul-AILab/SoulX-Singer/blob/main/LICENSE]; the audio files carry no separate notice. Apache-2.0 from Soul AI Lab cannot license Adele's performance. | Mechanics tests only. Never in a product. |
| SoulX-Singer HF Space root | `anita.wav`, `everybody_loves.wav`, `happy_birthday.mp3`, `obama.wav`, `raven.wav` | SVC tab examples. `obama.wav` speaks for itself. | None stated [V https://huggingface.co/spaces/Soul-AILab/SoulX-Singer/tree/main]. | Same. |
| SoulX-Singer-Eval-Dataset | 100 segments, 50 singers (25 zh, 25 en), 4-13.5 s each | Mandarin singers "consented to open-source their voice data for academic purposes"; English segments from Mixing Secrets [V paper https://arxiv.org/html/2602.07803v2 and https://huggingface.co/datasets/Soul-AILab/SoulX-Singer-Eval-Dataset] | **CC-BY-NC-4.0** | Consent is for academic use; NC. Not for the site. |
| YingMusic-Singer `resources/audios/` | `male.wav`, `female.wav`, `female_speech.wav`, one R&B clip + `.mid` | Chinese pop vocals; no provenance given | Repo says MIT; the audio has no notice [V https://github.com/GiantAILab/YingMusic-Singer] | Same as SoulX demos. |

### 1b. Permissively licensed singing corpora

| Corpus | Licence | Singers / content | Consent to cloning? | Usable as a public prompt? |
|---|---|---|---|---|
| **VocalSet** (Wilkins et al., ISMIR 2018) | **CC BY 4.0** [V https://zenodo.org/records/1492453 and the paper's own CC BY footer] | 20 professional singers (11 m, 9 f), 10.1 h a cappella, vowels/scales/arpeggios/long tones, 17 techniques; recorded "in a studio-quality recording booth with an Audio-Technica AT2020 condenser microphone, cardioid" [V paper §3.2, text extracted at `S\downloads\vocalset_paper.txt`]. Singers are anonymised: the data record is one `VocalSet11.zip` (2.1 GB) whose `readme-anon.txt` maps filenames to voice types [V https://zenodo.org/records/1203819], and the paper refers to them as "Female 2" etc. [V Table 2]. | **No statement.** Recruited as "professional singers... vocal training leading to a bachelor's or graduate degree" (§3.1) for technique/singer-ID research. 2018 predates zero-shot cloning; they consented to a dataset, not to a product voice. | **Legally yes** (CC BY allows derivatives and commercial use with attribution). **Ethically grey**: no consent to cloning, mitigated by anonymity (the voice is not attributable to a named person) and by labeling the output as AI. Flag it in the decisions log if used. Technically ideal: dry, a cappella, long sustained vowels, prompt metadata is trivial (`en_AA1` per note). |
| **PJS** (Koguchi & Takamichi 2020) | **CC BY-SA 4.0**, explicitly "available for both research and commercial use, unlike existing corpora" [V paper text at `S\downloads\pjs_paper.txt` lines 55-58] | One "native Japanese male in his twenties" who composed and sang all 100 songs; 27.2 min singing + 12.1 min speech, 48 kHz/24-bit [V §2.2, §3.1] | The singer built the corpus to be shared; the paper does not say whether he is an author. Closest thing to informed consent among the corpora. | Yes, but share-alike: whether a synthesized output is a "derivative" of a 10 s prompt is untested law; and the voice is a young Japanese male singing Japanese, which may colour the Hebrew. Second fallback. |
| OpenSinger | CC BY-NC-SA (2.0 text linked) [V https://github.com/Multi-Singer/Multi-Singer.github.io] | Mandarin, multi-singer | "anyone who downloads this dataset will be deemed to agree" | NC. No. |
| M4Singer | CC BY-NC-SA 4.0 plus an indemnity clause [V https://github.com/M4Singer/M4Singer/blob/master/dataset_license.md] | 20 Mandarin singers | None | NC. No. |
| GTSinger | CC BY-NC-SA 4.0; README: prohibited "to generate someone's singing without his/her consent" [V https://github.com/AaronZ345/GTSinger] | 20 singers, 9 languages, 80.6 h | None for the singers themselves | NC. No. |
| Opencpop | CC BY-NC-ND (one professional female Mandarin singer) [V via ACE-Opencpop paper table https://arxiv.org/html/2401.17619; secondary] | 5.2 h | None | NC-ND. No. |
| NUS-48E | research-only [V same table; secondary] | 12 singers, English | None | No. |
| CSD (KAIST) | CC BY-NC-SA 4.0; "must not defame the original singer" [V https://zenodo.org/records/4785016] | 1 Korean female pop singer, Korean + English children's songs | None | NC. No. |
| PocketTorah (from synthesis-survey §6) | CC BY-SA 3.0 | one named reader chanting actual haftarot | None for cloning | The most on-task audio there is, and the most clearly a *specific person's* voice. Fine for the private mechanics test; for the public voice, ask him. |

**Consent vs licence, stated plainly.** A CC licence is a copyright licence from the dataset author; it says nothing about the singer's personality/publicity rights or about their expectations. In 2018-2021 none of these singers were told their voice might become a zero-shot clone. Of the lot, only PJS's singer released his own voice on purpose for synthesis. VocalSet is legally the cleanest and ethically defensible only because the singers are anonymous and the output will be labeled AI.

### 1c. Daniel's own voice as the prompt

Consent-trivial and licence-free. What it needs, from the code and the Space's behaviour [V `webui.py` in the Space, `_run_transcription_internal`; `cli/inference.py`]:

- **Audio**: mono, any sample rate (resampled to 44.1 kHz, then 24 kHz internally), **trimmed to the first 30 s**; dry room, no reverb, no music. The paper's prompts are 2-16 s in stage 1 and up to 30-90 s in stage 2; the shipped English prompt is 5 s. 15-25 s of sung material is a good target [I].
- **Content**: it does not have to be Hebrew. Cross-lingual prompting is the model's headline feature (Mandarin prompt -> English target WER 0.110 in the paper), and this verse was rendered from an English prompt. But a Hebrew prompt removes one source of accent [I]. Best: Daniel chants a verse the engine already scores (so the prompt metadata is computed, not transcribed), e.g. this verse or Isaiah 42:5, plus 5 s on "la" across the range.
- **Metadata**: the prompt needs `phoneme`, `duration`, `note_pitch`, `note_type`, `f0`. Three ways: (i) the Space's `/transcription_function` (English ASR + ROSVOT notes + RMVPE f0; ASR on Hebrew will produce wrong phonemes, which probably matters less than the notes [I, untested]); (ii) compute it from the score engine for a verse he chants to the score, align with the MIDI editor Space; (iii) sing on "la" and write `en_L-AA1` per note, like the shipped `Ooh` = `en_UW1` notes. (ii) is right for the production prompt; (iii) is the 10-minute version.
- **Pitch**: `auto_shift` moves the target's median MIDI to the prompt's. For a chant tonic in Daniel's range, set the tonic explicitly and `auto_shift=False` as done here.

### 1d. A voice that is nobody's

- **Embedding interpolation**: not available. SoulX-Singer conditions on the prompt mel in context; there is no speaker vector [V code]. YingMusic-Singer likewise conditions on reference audio [V README]. One could concatenate two singers' clips into one prompt; the model's behaviour on a two-speaker prompt is undefined and would be an experiment, not a design [I].
- **Synthetic prompt from a TTS**: Kokoro-82M (Apache-2.0) states it "was trained exclusively on permissive/non-copyrighted audio data" including "synthetic audio from closed TTS models by large providers" and excludes "custom voice clones" [V https://huggingface.co/hexgrad/Kokoro-82M]; its American male voices (`am_adam`, `am_michael`, `am_liam`, `am_fenrir`) have no named human behind them in VOICES.md [V]. A Kokoro-spoken prompt fed to SoulX gives a speech-timbre singer; chant sits between speech and song, so this might be acceptable or might sound like a reading robot [I, untested; costs one render]. Hebrew TTS for a Hebrew-speaking synthetic prompt: Robo-Shaul/SASPEECH is a named journalist's voice under a custom **non-commercial** licence owned by the Israeli Public Broadcasting Corporation [V https://www.openslr.org/134/], so no.
- **Second-generation voice**: render once with a VocalSet prompt, then use that render as the prompt for production. The identity drifts from the source each generation [I]. Cheap to try; ethically it only launders, it does not remove, the source.
- **Public-domain recordings**: under the Music Modernization Act, US sound recordings published before 1923 entered the public domain on 1 Jan 2022, and 1923-1946 recordings get 100 years, so **recordings published through 1925 are public domain as of 2026** [V https://www.copyright.gov/music-modernization/pre1972-soundrecordings/]. FAU's Recorded Sound Archives holds Yossele Rosenblatt volumes 1908-1923 and states "These recordings were produced prior to 1923 and are in the public domain" [V https://rsa.fau.edu/josef-rosenblatt]. Two problems: acoustic-era 78 transfers are band-limited (~250-3,000 Hz) and noisy, and SoulX clones what it hears, so the output would be a thin, hissy voice [I]; and a synthetic "Rosenblatt" is a deepfake of the most famous cantor who ever lived, which is a worse look for a synagogue site than a labeled anonymous voice. Not recommended.

### Recommendation

- **Default: Daniel's voice**, recorded as in 1c (one evening, no studio). It is the only option with no licence stack and no consent question, and the quality bar ("melodically correct, slight American accent") is met by the model regardless of prompt, per section 4.
- **Fallback: VocalSet `male*` singer, CC BY 4.0**, chosen by ear from the long-tone files, with attribution on the site's credits page and a line in the decisions log that the singers did not consent to cloning. PJS is the alternate if share-alike is acceptable.
- If Josh records later, his clip replaces the prompt and nothing else changes (the score JSON is the contract).

---

## 2. Running it here

### 2.1 Model size and VRAM

- Checkpoint `model.pt` **2.82 GB**, `model-svc.pt` 2.79 GB [V https://huggingface.co/Soul-AILab/SoulX-Singer/tree/main]. At fp32 that is ~705 M parameters; fp16 weights ~1.4 GB [I from size]. Config [V `soulxsinger/config/soulxsinger.yaml`]: flow-matching DiT hidden 1024, 22 layers, 16 heads; 4-layer ConvNeXt text/pitch/type encoder, vocab 3000; 24 kHz, hop 480 (20 ms frames), 128 mels; inference 32 steps, CFG 3. Vocoder is bundled in the checkpoint (`Vocoder()` in the model, no separate download) [V code].
- Maintainer figures, issue #16 (2026-03-05), RTX 4090: "SVS inference only (example pipeline): ~12GB VRAM; Transcription + SVS inference: ~22GB VRAM" [V https://github.com/Soul-AILab/SoulX-Singer/issues/16]. Issue #25: "On Linux with fp16, SVS needs about 10GB of VRAM and SVC about 8GB"; the WebUI also loads vocal-separation and F0 models; the reporter with an **RTX 2060 6 GB on Windows got no output after 10 minutes** even with `--fp16`, and a 4 GB user reported "progress stayed at 0 after an hour" [V https://github.com/Soul-AILab/SoulX-Singer/issues/25]. Issue #4 asks for CPU fallback; no answer [V].
- The ComfyUI node (Saganaki22) ships bf16 weights (~2 GB) and advertises "low VRAM" without a number [V https://github.com/Saganaki22/ComfyUI-SoulX-Singer]; bf16 is not supported on Turing, so that path would run fp16 or fp32 here [I].
- Why the CLI should need less than the WebUI: `cli/inference.py` loads only `SoulXSinger` (no BS-RoFormer separation, no NeMo ASR, no ROSVOT, no RMVPE), and in score mode no f0 extractor runs at all [V code]. A 14 s target + 5 s prompt is ~960 mel frames; the DiT's attention over ~1,000 frames with CFG (batch 2) at fp16 is modest [I]. Whether that fits in 6 GB is exactly what section 2.4 tests.

### 2.2 Windows-native vs WSL2

- WSL is **not installed** on this PC: `wsl -l -v` -> "The Windows Subsystem for Linux is not installed" [M]. Installing it is `wsl --install` plus a reboot (~20 min), and the 1660 Ti is supported by WSL2 CUDA.
- `requirements.txt` pins `torch==2.2.0`, `torchaudio==2.2.0`, `transformers==4.41.2`, `numpy<2.0.0`, plus heavy preprocessing deps (`nemo_toolkit==2.6.1`, `funasr==1.3.0`, `sageattention==1.0.6`) [V]. **Inference imports none of those three**: the model files import only torch, torchaudio, transformers (LlamaModel, Whisper for SVC), accelerate, omegaconf, librosa, soundfile, numpy, scipy, tqdm [M: `grep import` over `cli/` and `soulxsinger/`]. SageAttention is never imported by the SVS model (it is used by the vocal-separation preprocessing) [M]. So a Windows-native inference venv does not need Triton/SageAttention/NeMo.
- Python: the repo says 3.10; this PC has 3.14 (default) and **3.12** (`py -0`) [M]. PyTorch 2.2.0+cu121 and +cu118 Windows wheels exist for cp312 [M: `pip index versions torch --index-url .../cu121` lists 2.2.0+cu121]. Python 3.14 is out.
- No ffmpeg installed [M: `where ffmpeg` fails]. Not needed: librosa 0.11 / soundfile 0.13 decode the mp3 prompts through libsndfile [M: the mp3 example loaded fine in the venv].

### 2.3 Exact install steps (Windows-native, inference only)

```powershell
py -3.12 -m venv venv-gpu
.\venv-gpu\Scripts\python -m pip install torch==2.2.0 torchaudio==2.2.0 --index-url https://download.pytorch.org/whl/cu121
.\venv-gpu\Scripts\python -m pip install "numpy<2" transformers==4.41.2 accelerate omegaconf librosa soundfile scipy tqdm
git clone --depth 1 https://github.com/Soul-AILab/SoulX-Singer
# weights (2.82 GB):
curl -L -o SoulX-Singer\pretrained_models\SoulX-Singer\model.pt https://huggingface.co/Soul-AILab/SoulX-Singer/resolve/main/model.pt
cd SoulX-Singer
$env:PYTHONPATH="."
.\..\venv-gpu\Scripts\python -m cli.inference --device cuda --fp16 --control score --model_path pretrained_models\SoulX-Singer\model.pt --config soulxsinger\config\soulxsinger.yaml --phoneset_path soulxsinger\utils\phoneme\phone_set.json --prompt_wav_path example\audio\en_prompt.mp3 --prompt_metadata_path example\audio\en_prompt.json --target_metadata_path <target.json> --save_dir out --pitch_shift 0
```
Notes: `--fp16` calls `model.half()` and keeps the mel front end in fp32 (`build_model`) [V]; `--auto_shift` is a flag, omit it for an explicit tonic; output is `out/generated.wav` at 24 kHz. The preprocessing pipeline (`example/preprocess.sh`) is **not** needed when the score engine writes the JSON.

### 2.4 Local run on the GTX 1660 Ti (6 GB, Turing) [M]

Done exactly as in 2.3 (venv `S\venv-gpu`, torch 2.2.0+cu121 cp312, `transformers 4.41.2`, `numpy 1.26.4`; checkpoint at `S\downloads\model\model.pt`, 2,818,092,278 bytes; runner `S\scripts\run_local.py`, which wraps `cli.inference.build_model/process` with `torch.cuda` peak-memory counters while `nvidia-smi -l 2` logs alongside).

```
Model parameters: 704.344578 M
Model converted to FP16 (mel kept in FP32).
load 12.1s
after load allocated MB 1344.2
Inferring segments: 100%|██████████| 1/1 [01:26<00:00, 86.29s/it]
infer 86.4s
peak allocated MB 1530.3   peak reserved MB 2838.0
nvidia-smi peak used: 2937 MiB
```

- Output `S\work\local_fp16\generated.wav` (14.25 s, 24 kHz): pyin check **33/33 within +/-0.5 st, median |err| 0.21 st, max 0.49 st**, i.e. the same melody as the Space render (which was fp32 on a Blackwell card; the small difference is fp16 plus a different seed path).
- A second render (variant C, section 3.2) took 86.6 s with identical peak memory, so the figure is stable.
- Headroom: 2.9 GB used of 6 GB; the 32-step flow-matching loop dominates the time (CFG doubles the batch). A 30 s prompt + 60 s target would roughly quadruple attention memory and is the first thing to re-measure if verses get long; at this verse length there is no risk.
- No warnings about Turing/fp16: `model.half()` + `torch.amp.autocast` worked; no bf16 anywhere in the inference path [V code].
- Not measured: CPU-only speed (likely 10-20 min per verse by scaling [I]); fp32 on the GPU (weights alone 2.8 GB, would probably still fit but was not needed).

So **WSL2 is not required**, the 6 GB card is sufficient for pre-rendering, and the only cost is time (~1.5 min per verse).

### 2.5 Free alternatives

| Route | Status today | Cost | Limits |
|---|---|---|---|
| **Official HF Space** `Soul-AILab/SoulX-Singer` | Up, ZeroGPU (`suggested_hardware: zero-a10g` in its README; ZeroGPU now backs onto half an RTX Pro 6000, 48 GB) [V Space README; https://huggingface.co/docs/hub/en/spaces-zerogpu]. Accepts a prompt wav + prompt JSON + target JSON through `gradio_client` at `api_name="/synthesis_function"` [M]. | $0 | **Each call reserves 60 s of quota** (`@spaces.GPU` default duration) regardless of the ~10-14 s it takes [M: error text "60s requested vs. 0s left"]. Unauthenticated: 2 min/day; free account token: 5 min/day; PRO ($9/mo): 40 min/day, then $1 per 10 min [V docs]. The Space also silently returns `None` on any inference exception (no error text reaches the client) [V `webui.py`]. |
| HF ZeroGPU, own duplicate | Free accounts "in good standing (verified email, account older than 30 days) can host up to 2 ZeroGPU Spaces" [V docs]; duplicating the Space and setting `@spaces.GPU(duration=20)` would make the same quota go 3x further [I]. ZeroGPU requires torch >= 2.8 and Python 3.10/3.12 [V docs], and the Space already runs under those (its `requirements.txt` differs from the repo's [M diff]). | $0 | Same daily quota, your own queue. |
| Google Colab free | No SoulX notebook exists [V search]. The CLI install above on a T4 (16 GB) should run in fp16 with margin [I]; sessions are not guaranteed a GPU and cap at 12 h [V]. | $0 | ~5 min setup per session for the 2.8 GB download. |
| YingMusic-Singer | Official Space `ASLP-lab/YingMusic-Singer-Plus` is **PAUSED** [M: `gradio_client` -> "The current space is in the invalid state: PAUSED"]. Community duplicate `TGPro1/YingMusic-SingerGPU` is up on ZeroGPU with `/synthesize(ref_audio, melody_audio, ref_text, target_text, ...)`: melody from audio only (no MIDI in the Space), lyrics as text [M `view_api`; V its `app.py`]. V1 (not Plus) is the MIT-licensed one; Plus is ASLP-lab's follow-up. Install is Linux + flash-attn + Python 3.12 + torch 2.9.1/cu126 [V README]; no VRAM figure published. | $0 | Hebrew only as English pseudo-words; the melody would have to be supplied as audio (e.g. the SoulX render). Second tier. |
| Rented 4090 | Not used; ~$0.34/h per synthesis-survey §7. | money | Not this round. |

---

## 3. The render: I Samuel 20:18 through the Space

### 3.1 Score construction [M, `S\scripts\build_score.py`]

Verse: `וַיֹּאמֶר־ל֥וֹ יְהוֹנָתָ֖ן מָחָ֣ר חֹ֑דֶשׁ וְנִפְקַ֕דְתָּ כִּ֥י יִפָּקֵ֖ד מוֹשָׁבֶֽךָ׃`
Syllables and stress (given): va-yo-mer-LO | ye-ho-na-TAN | ma-CHAR | CHO-desh | ve-nif-KAD-ta | KI | yip-pa-KED | mo-sha-VE-cha.
Trope: mercha (on the maqaf chain, stressed on לוֹ), tipcha, munach, etnachta, zakef gadol, mercha, tipcha, sof pasuk.
Cells (trope-grammar.md §2.3, Binder/Avery, D minor), fitted by the §2.2 rules (upbeats absorb pre-tonic syllables, first upbeat repeated when short; core = melisma on the stressed syllable; the last core note detaches onto a post-tonic syllable for mil'el words):

| Word | Cell | Fitted (degree per syllable; `-` = slur) |
|---|---|---|
| vayomer-lo | mercha before tipcha `[1] 3,1` | va 1, yo 1, mer 1, LO 3-1 |
| yehonatan | tipcha before etnachta `[3] 4` held | ye 3, ho 3, na 3, TAN 4 (0.8 s) |
| machar | munach before etnachta `[4] 3` | ma 4, CHAR 3 |
| chodesh | etnachta `[1] 3,1,3,5,4` held, mil'el | CHO 3-1-3-5, desh 4 (0.8 s) |
| venifkadta | zakef gadol `[1] 5,3,1,4,3` held, mil'el | ve 1, nif 1, KAD 5-3-1-4, ta 3 (0.8 s) |
| ki | mercha in sof-pasuk group `[1] 3` | KI 3 |
| yippaked | tipcha in sof-pasuk group `[4] 5,3,7_` held | yip 4, pa 4, KED 5-3-7_ (last 0.8 s) |
| moshavecha | sof pasuk `[7_,1] 3,1` held, mil'el | mo 7_, sha 1, VE 3, cha 1 (0.8 s) |

Tonic D4 = MIDI 62 (so 7_ = 60, 3 = 65, 4 = 67, 5 = 69) because the only prompt available was the female Adele stem; for a male prompt use D3 = 50 and the same script (`build_score.py 50 out.json`). Durations: upbeat 0.30 s, single core note 0.45 s, melisma notes 0.28 s, held notes 0.80 s, 0.12 s `<SP>` between words. 42 notes, 14.25 s. Full plan: `S\work\target_1sam20_18_plan.tsv`.

SoulX metadata format [V `preprocess/tools/midi_parser.py`, `soulxsinger/utils/data_processor.py`, shipped examples]: one JSON list of segments; each segment has `index`, `language`, `time` `[start_ms, end_ms]`, and five space-separated parallel strings: `duration` (s per note), `text` (display only), `phoneme` (one token per note: `<SP>` for rests, `en_P1-P2-P3` for an English "word", `zh_syl` / `yue_syl` for Chinese), `note_pitch` (MIDI, 0 for rest), `note_type` (1 rest, 2 note that starts a syllable/word, 3 slur continuation, with the same phoneme token repeated), and `f0` (one value per 20 ms frame). Each Hebrew **syllable** is one `en_` word; a melisma is the syllable token repeated with `note_type 3`. The data processor wraps each note's phones in `<BOW> ... <SEP> <EOW>`.

Emitted phoneme string:
```
<SP> en_V-AA0 en_Y-OW0 en_M-EH0-R en_L-OW1 en_L-OW1 <SP> en_Y-EH0 en_HH-OW0 en_N-AA0 en_T-AA1-N <SP> en_M-AA0 en_HH-AA1-R <SP> en_HH-OW1 en_HH-OW1 en_HH-OW1 en_HH-OW1 en_D-EH0-SH <SP> en_V-EH0 en_N-IY0-F en_K-AA1-D en_K-AA1-D en_K-AA1-D en_K-AA1-D en_T-AA0 <SP> en_K-IY1 <SP> en_Y-IY0-P en_P-AA0 en_K-EH1-D en_K-EH1-D en_K-EH1-D <SP> en_M-OW0 en_SH-AA0 en_V-EH1 en_HH-AA0 <SP>
```

### 3.2 Calls and what happened [M, `S\scripts\run_space2.py`]

Venv: `py -3.12 -m venv venv; pip install gradio_client librosa soundfile numpy scipy` (gradio_client 2.7.2, librosa 1.0.0). Prompt = the repo's `en_prompt.mp3` + `en_prompt.json`. `control="score"`, `auto_shift=False`, `pitch_shift=0`, `seed=12306`, `prompt_vocal_sep=False`, `target_vocal_sep=False`. `target_audio` is a required input of the endpoint even when metadata is supplied; it is only used to name the session directory, so the repo's `en_target.mp3` was passed.

| # | Input | Result |
|---|---|---|
| 1 | my JSON with `"f0": ""` | returned `(None, {'__type__': 'update'}, {'__type__': 'update'})` after 8.7 s. **Silent failure.** Cause found by diffing the Space's code against GitHub: the Space's `data_processor.py` line 153 does `torch.tensor([float(x) for x in meta["f0"].split()])` and then `min(mel2note.shape[1], f0.shape[0])` -> an empty f0 truncates the target to 0 frames; GitHub's version treats empty f0 as `None` [M diff `S\downloads\space\` vs `S\repos\SoulX-Singer\`]. Locally the GitHub `DataProcessor` accepted the JSON (`mel2note (1, 712)`). |
| 2 | control: repo's `en_target.json` | `generated.wav` in 11.4 s -> `S\work\control_en_example.wav` (331 KB, 6.9 s). |
| 3 | my JSON with `f0` = 712 zeros (`S\work\variantA_f0zeros.json`) | **`generated.wav` in 14.3 s -> `S\work\variantA.wav`** (684 KB, 24 kHz mono 16-bit, 14.25 s). |
| 4 | variant C: same, with `zh_huo1` for CHO and `zh_ha1` for the final cha (Mandarin velar fricative for ח) | Space: `AppError: You have exceeded your ZeroGPU quota (60s requested vs. 0s left). Try again in 0:00:00. Authenticate with a Hugging Face token for more quota` after 4.3 s. **Rendered locally instead** (section 2.4) -> `S\work\local_variantC\generated.wav`. The mixed `zh_`/`en_` sequence is accepted by the model; pyin: 31/33 within +/-0.5 st (max 0.61 st), the five `zh_` notes themselves 64.74/62.19/64.59/68.49/61.99 vs 65/62/65/69/62. |
| 5 | variant A again, locally, fp16 | `S\work\local_fp16\generated.wav`, 33/33 within +/-0.5 st (section 2.4). |

Rule for the score engine: **always emit an `f0` string of `0.0` x (total_s x 50) frames** in score mode; it is ignored by the model but required by the Space's parser.

### 3.3 Files

- `S\work\variantA.wav` : the Hebrew render (prompt: Adele stem; tonic D4). **This is the file to listen to.**
- `S\work\local_fp16\generated.wav` : the same score rendered on this PC (fp16, GTX 1660 Ti).
- `S\work\local_variantC\generated.wav` : variant C, Mandarin `zh_h*` tokens for ח, rendered on this PC.
- `S\work\control_en_example.wav` : the model's own English example, same settings, for A/B.
- `S\venv-gpu\`, `S\downloads\model\model.pt`, `S\scripts\run_local.py` : the working local install (move it out of the scratchpad; see next steps).
- `S\work\variantA_f0zeros.json`, `S\work\target_1sam20_18_plan.tsv` : the score as sent and as a table.
- `S\scripts\build_score.py`, `S\scripts\run_space2.py`, `S\scripts\f0_check.py` : the three scripts; all stand-alone.
- `S\repos\SoulX-Singer`, `S\repos\YingMusic-Singer` : shallow clones; `S\downloads\space\` : the Space's own `webui.py`, `app.py`, `cli/inference.py`, `data_processor.py`, `requirements.txt`.

### 3.4 Not done

- A VocalSet-prompt render: not done (would need the 2.1 GB VocalSet download plus hand-written prompt metadata; ~1 h, now feasible locally).
- A Daniel-voice prompt: no recording exists on this machine.
- YingMusic-Singer: blocked by the same per-user ZeroGPU quota; the plan was `ref_audio=en_prompt.mp3`, `ref_text="I wish nothing but the best"`, `melody_audio=variantA.wav` (the SoulX render carries the correct melody), `target_text` = transliteration. Untested.

---

## 4. Listening notes (instrumental, not aural)

Method [M, `S\scripts\f0_check.py`]: `librosa.pyin` (fmin 80, fmax 900, frame 2048, hop 256) on the 24 kHz WAV; for each planned note window (skipping the first 40 ms and last 20 ms) the median voiced f0 converted to MIDI, compared with the target. Loudness as RMS dBFS; silence as 20 ms frames under -45 dBFS.

**`variantA.wav`**: 14.25 s, peak -0.7 dBFS, RMS -14.9 dBFS, no clipped samples, 0.59 s trailing silence, the 0.3 s leading `<SP>` is partly voiced (52%: a breath/onset, consistent with the model treating a leading rest as a breath).

| Word | Target degrees | Measured (MIDI, error in semitones) |
|---|---|---|
| va yo mer LO | 62 62 62 65-62 | 61.94 (-0.06), 62.09 (+0.09), 62.29 (+0.29), 64.69 (-0.31), 62.29 (+0.29) |
| ye ho na TAN | 65 65 65 67 | 64.79, 64.79, 64.59 (-0.41, 77% voiced), 66.99 (-0.01) |
| ma CHAR | 67 65 | 66.99, 64.89 (-0.11, 89% voiced) |
| CHO desh | 65-62-65-69, 67 | 64.59, 62.29, 64.59, 68.69 (-0.31), 66.99 (-0.01) |
| ve nif KAD ta | 62 62 69-65-62-67 65 | 61.79, 61.99 (65% voiced: the f), 68.89, 64.89, 62.19, 66.84, 64.89 |
| KI | 65 | 64.89 |
| yip pa KED | 67 67 69-65-60 | 66.89, 67.09, 68.89, 64.89, 60.09 (+0.09) |
| mo sha VE cha | 60 62 65 62 | 59.69 (-0.31), 62.09, 64.79 (62% voiced), 62.29 |

**33/33 pitched notes within +/-0.5 st; median |error| 0.11 st; max 0.41 st.** The control (`control_en_example.wav`, the model's own demo) scores 19/20, median 0.11, max 0.51 under the same script, so the Hebrew score is tracked as faithfully as English pop. Every slur note changes pitch where the score says (the four-note etnachta melisma, the four-note zakef gadol melisma, the 5-3-7_ tipcha). The sof pasuk lands on the tonic. The slight flatness (most errors are -0.1 to -0.4) is uniform, i.e. intonation, not wrong notes; pyin also reads a hair flat on the control.

Voicing: the lowest voiced fractions are on syllables with fricative onsets (`N-IY0-F` 65%, `V-EH1` 62%, `N-AA0` 77%), which is expected and suggests the consonants are being articulated rather than swallowed [I].

**Local renders** [M]: `S\work\local_fp16\generated.wav` (variant A, fp16 on the 1660 Ti): 33/33, median 0.21 st, max 0.49 st, peak -1.3 dBFS, RMS -14.6 dBFS, no clipping. `S\work\local_variantC\generated.wav` (Mandarin ח tokens): 31/33, median 0.19 st, max 0.61 st (the two misses are 0.51 and 0.61 st on `zh_huo1` at 69 and on one `en_` note), RMS -14.8 dBFS. Switching language tokens mid-phrase did not break the melody.

**Did the Mandarin token produce a fricative?** A crude spectral comparison of the first 80 ms of the two ח syllables (share of energy in 1.5-5 kHz; centroid; level) [M]: on CHO the `en_HH` onset is loud and vowel-like (level 46.6 dB, centroid 643 Hz, high-band share -32 dB) while the `zh_huo1` onset is 20 dB quieter and noisier (25.0 dB, 966 Hz, -15 dB), consistent with a fricative rather than an aspirate; on the final cha, the `zh_ha1` version still shows noise-like spectrum 150-250 ms into the note (centroid 1437 Hz, level 28.6 dB where variant A already has the vowel at 44 dB), which could be a long [x] or a weak vowel. Weak evidence that `zh_h*` yields a real ח; whether it also drags in a Mandarin vowel colour only ears can say.

What this does **not** tell you, and only ears can: whether `HH` reads as ח or as English h; whether `R` is a flagrant American r; whether `AA` on קמץ sounds Israeli; whether 0.28 s melisma notes are too fast for chant; whether the voice sounds like singing (Adele-ish) rather than chanting; and whether a 0.12 s gap between words is audible as choppiness. The control file is there for Daniel to calibrate against.

---

## 5. Hebrew through ARPAbet, refined against `phone_set.json`

Tokens available [V `S\repos\SoulX-Singer\soulxsinger\utils\phoneme\phone_set.json`, 2,820 entries]: 20 specials (`<PAD> <SP> <AP> <UNK> <BOW> <EOW> <BOS> <EOS> <MASK> <SEP>`, 10 `<SPECIAL_TOKEN_n>`), **70 `en_`** = the 39 CMU phones with stress digits 0/1/2 on the 15 vowels (plus a stray `en_UW` with no digit), **1,201 `zh_`** pinyin syllables with tone digits, **1,529 `yue_`** jyutping syllables with tone digits. The English g2p is `g2p_en` (CMUdict) [V `preprocess/tools/g2p.py`], so anything CMUdict would emit is in-distribution.

| Hebrew | Phonikud/IPA | Token | Note |
|---|---|---|---|
| א, silent ה | ∅ / ʔ | none; onset dropped | A vowel-initial `en_` word is normal in CMUdict (`en_AA1-N`). For an audible glottal, no token; do not use `HH` (it adds breath) [I]. |
| ע | ∅ (Israeli) / ʕ | none | Same as א. A pharyngeal has no stand-in anywhere in the set. Ask Josh which he uses. |
| ב / בּ | v / b | `V` / `B` | |
| ג | g | `G` | |
| ד | d | `D` | |
| ה | h | `HH` | |
| ו | v (w) | `V` (`W`) | |
| ז | z | `Z` | |
| **ח, כ rafe, ך** | x (χ) | `HH` (default); **`zh_h*` syllable** when the whole syllable is a Mandarin syllable | Mandarin pinyin `h` is a velar fricative [x] [V https://www.polyu.edu.hk/bepth/introduction-to-phonetics/initials/initial-groups/]. Available: `zh_ha1 hai1 han1 hang1 hao1 he1 hei1 hen2 heng1 hong1 hou1 hu1 hua1 huai2 huan1 huang1 hui1 hun1 huo1` (and other tones). Covers ha/chai/chan/chao/che/chei/chen/chu/chua/chui/chun/chuo; not char, chod, chet-with-coda. `yue_` has no [x] (Cantonese h is glottal). The `KH`-free ARPAbet is the one real gap. Test: variant C. |
| ט, ת | t | `T` | ת rafe as `S` only for Ashkenazi pronunciation. |
| י | j | `Y` | Diphthong codas: ־ַי `AY`, ־ֵי `EY`, ־וֹי `OY`, ־וּי `UW-Y`. |
| כּ, ק | k | `K` | |
| ל | l | `L` | English dark l in codas; acceptable. |
| מ, ם | m | `M` | |
| נ, ן | n | `N` | |
| ס, שׂ | s | `S` | |
| פּ / פ, ף | p / f | `P` / `F` | |
| **צ, ץ** | ts | `T-S` inside the word (`en_T-S-AA1-R`) | Two phones in one note is normal (`en_B-EH1-S-T`). Alternative: Mandarin `zh_z*` ([ts], unaspirated) / `zh_c*` ([tsʰ]): `za zai zan zao ze zi zou zu zuo zun ca cai can cao ce ci cu cuo` etc. |
| **ר** | ʁ / r | `R` | The American approximant is the accent Daniel ruled shippable. Mandarin `zh_r*` is retroflex [ɻ], no better. No uvular anywhere in the set. A trilled/tapped r: none. |
| שׁ | ʃ | `SH` | |
| dagesh forte | gemination | ignore | ARPAbet has no length; split the consonant across the syllable boundary (`en_Y-IY0-P` + `en_P-AA0`) as done for יִפָּקֵד, which gives a hint of it [I]. |
| פתח, קמץ | a | `AA` | `AA` is a back [ɑ]; Israeli a is central. `AH1` is more central but CMUdict uses it mostly for [ʌ]; try both by ear. |
| סגול | e | `EH` | |
| צירה | e (ej) | `EH` (Israeli) / `EY` (Ashkenazi/diphthongal) | |
| חיריק | i | `IY` (long) / `IH` (short, closed syllable) | |
| חולם | o | `OW` (American diphthong [oʊ]) / `AO` (monophthong, more Israeli) | Rendered here with `OW`; `AO` is worth one A/B. |
| קובוץ, שורוק | u | `UW` | `UH` for a short closed u. |
| שווא נע | ə / e | `AH0` (schwa) / `EH0` (Israeli [e]) | Phonikud marks vocal shva [V survey]. |
| חטף | ă ĕ ŏ | `AH0`, `EH0`, `AO0` | |
| Stress | | digit 1 on the stressed syllable's vowel, 0 elsewhere, 2 for secondary (e.g. the first syllable of a maqaf chain) | SoulX trains on g2p output with digits; untested whether the digit changes anything audible [I]. |
| Rest / breath | | `<SP>` (`<AP>` is mapped to `<SP>` by the processor) | 0.12 s between words was enough to keep words separate in the f0 track. |

Mixing `zh_` syllables into an English note sequence: the data processor branches per token on the `en_` prefix only, so `zh_ha1` beside `en_` words is accepted structurally [V `data_processor.preprocess`], and the local variant C render confirms the model synthesizes such a sequence with the melody intact [M, section 4]. Whether the timbre and vowel quality survive the switch is for Daniel's ears (`S\work\local_variantC\generated.wav` vs `S\work\local_fp16\generated.wav`, syllables at 4.57 s and 12.95 s).

---

## Questions only Daniel can answer

1. **Listen to `S\work\variantA.wav` (Space) and `S\work\local_fp16\generated.wav` (this PC) against `S\work\control_en_example.wav`, then `S\work\local_variantC\generated.wav` for the Mandarin ח.** Is the Hebrew intelligible? Does it read as chant? Which of ח, ר, קמץ, חולם offends most? Does the `zh_h*` ח sound Hebrew or Chinese? This decides the phoneme table's two open rows and whether `AO`/`AH` vowel swaps are worth rendering.
2. **Will you record the prompt yourself** (15-25 s, dry, one scored verse plus "la" on three pitches)? If yes, section 1c; if no, the VocalSet male fallback goes in the decisions log with its consent caveat.
3. **Is CC BY audio of anonymous 2018 research singers acceptable as the public voice** given they never consented to cloning? Legally clean, ethically grey; your call, not mine.
4. **Is ~1.5 min per verse on this PC acceptable for pre-rendering** (a haftarah in ~35 min, the cycle in a few overnight runs), or do you want HF PRO ($9/month, 40 min/day of ZeroGPU, ~40 renders/day at the Space's 60 s billing) for faster iteration? Both fit the $20/month ceiling; nothing else is needed.
5. **Where should the 2.8 GB checkpoint and the GPU venv live permanently?** They are in the session scratchpad now (`S\downloads\model\model.pt`, `S\venv-gpu`) and will be lost when it is cleaned; a `C:\tools\soulx\` or similar outside the repo is the obvious home (never in the repo or Blob).
6. **Tonic and range for the male voice**: D3 (MIDI 50) was assumed for a cantor; for your own prompt, what is your comfortable low note?

## Next steps (to finish the mechanics test)

1. **Move the checkpoint and venv out of the scratchpad** (copy `S\downloads\model\model.pt`, `S\venv-gpu`, `S\repos\SoulX-Singer`, `S\scripts\` to a permanent folder outside the repo). 10 min, before the session ends.
2. **Daniel listens** to the four WAVs and files reason codes per the evaluation plan (prior-art-and-evaluation.md). 30 min.
3. **Record Daniel's prompt** (section 1c) and render the same verse with it at tonic D3, locally. ~1 h recording + metadata, 1.5 min render.
4. **Vowel/consonant A/Bs locally** (`AO` cholam, `AH` kamatz, `T-S` tsadi on a verse that has one, `R` alternatives): 5-6 renders, ~20 min of GPU time, 1 h with f0 checks.
5. **VocalSet fallback prompt**: download `VocalSet11.zip` (2.1 GB), pick a `male*` long-tone file, write its metadata, render. 1 h.
6. **Wire the score engine to emit this JSON** (syllable tokens, `note_type` slurs, `f0` zeros, `time` in ms): 2-3 h in JS; `build_score.py` is the reference.
7. **Batch script**: loop the CLI over a haftarah's verse JSONs with one model load (the 12 s load is per process; keep the model resident). 1 h.
8. **YingMusic-Singer Plus as a second opinion**, when the ZeroGPU quota resets: one call with `melody_audio=variantA.wav` and transliterated lyrics. 30 min.
9. Then the SVC pass and the DiffSinger weekend from synthesis-survey §6.
