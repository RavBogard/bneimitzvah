# SoulX-Singer environment for the trope engine (renderer step 2)

Windows-native inference environment for `scripts/trope-render.mjs` in the `haftarah` repo. Nothing under
`C:\Users\dsbog\haftarah-audio\` goes in git. Background and measurements:
`docs/superpowers/research/2026-10-15-trope-engine/voice-feasibility.md` (sections 2.3-2.4).

## What is here

| Path | What |
|---|---|
| `venv\` | Python 3.12.10 venv, packages pinned in `requirements.lock.txt` |
| `SoulX-Singer\` | shallow clone of https://github.com/Soul-AILab/SoulX-Singer at commit `81aeb3ae772c70093c3de74dc23c92d983801ae4` (2026-05-29), the commit the feasibility run used |
| `..\soulx\model.pt` | the checkpoint (2,818,092,278 bytes, from https://huggingface.co/Soul-AILab/SoulX-Singer); not copied, pointed to |
| `tools\pitch_check.py` | pyin per-note pitch check of a render folder (reads `manifest.json`) |
| `tools\f0_check.py`, `build_score.py`, `run_local.py` | the feasibility experiment's original scripts, kept for reference |

Key versions: torch 2.2.0+cu121, torchaudio 2.2.0+cu121, transformers 4.41.2, numpy 1.26.4 (must stay < 2),
accelerate 1.15.0, omegaconf 2.4.0, librosa 0.11.0, soundfile 0.14.0, scipy 1.17.1. Hardware: GTX 1660 Ti 6 GB
(Turing: fp16 yes, bf16 no). No WSL, Triton, SageAttention, NeMo or ffmpeg needed for score-mode inference.

## Prompt preparation (`scripts/trope-prompt.mjs`)

Turns any dry sung recording into a SoulX prompt (`<name>.wav` at 24 kHz + `<name>.json` metadata) with
`trope/soulx_prompt.py`, on the CPU (7-13 s for a 5-22 s clip). It uses two of SoulX's preprocessing models
through SoulX's own code in the clone, and nothing else:

| Path | What | Licence |
|---|---|---|
| `..\soulx-preprocess\rmvpe\rmvpe.pt` (181 MB) | RMVPE f0 extractor, writes the prompt's `f0` | Apache-2.0 (Dream-High/RMVPE; HF repo Apache-2.0) |
| `..\soulx-preprocess\rosvot\{rosvot,rwbd,rmvpe}\` (145 + 120 + 368 MB, with `config.yaml`) | ROSVOT note transcriber, its RWBD word-boundary model and its own RMVPE | MIT (RickyL-2000/ROSVOT; HF repo Apache-2.0) |

All from https://huggingface.co/Soul-AILab/SoulX-Singer-Preprocess (licence tag apache-2.0). Not downloaded,
on purpose: the vocal-separation/dereverb RoFormers (2.6 GB), NeMo Parakeet ASR (2.5 GB, needs
`nemo_toolkit`) and FunASR Paraformer (1 GB, Mandarin). The input must already be a dry a cappella voice;
the words come from `--lyric` (English, g2p_en), `--tokens` (phone-set tokens, e.g. per-syllable `en_`) or
`--vowel` (default `AA`), not from ASR.

```bash
mkdir -p ../soulx-preprocess && cd ../soulx-preprocess
for f in rmvpe/rmvpe.pt rosvot/rmvpe/model.pt rosvot/rosvot/config.yaml rosvot/rosvot/model.pt rosvot/rwbd/config.yaml rosvot/rwbd/model.pt; do
  mkdir -p $(dirname $f); curl -L -o $f https://huggingface.co/Soul-AILab/SoulX-Singer-Preprocess/resolve/main/$f; done
cd ../soulx-env
./venv/Scripts/python.exe -m pip install matplotlib g2p_en pyloudnorm pretty_midi pyworld   # pinned in requirements.lock.txt
./venv/Scripts/python.exe -c "import nltk; [nltk.download(p, download_dir='venv/nltk_data') for p in ('averaged_perceptron_tagger_eng', 'cmudict')]"
```

(matplotlib, pretty_midi and pyworld are only imported by SoulX's ROSVOT module; g2p_en is SoulX's English
g2p; pyloudnorm normalizes the prompt to -18 LUFS.) Use from the repo:

```bash
node scripts/trope-prompt.mjs --in clip.wav --name daniel --lyric "words actually sung"   # -> ..\prompts\daniel.{wav,json}
node scripts/trope-render.mjs --ref "I Samuel 20:18" --key D3 --prompt ../prompts/daniel.wav --prompt-meta ../prompts/daniel.json
```

Prompts live in `..\prompts\`. `vocalset-m6-dona.{wav,json}` is VocalSet singer m6 (baritone),
`FULL/male6/excerpts/straight/m6_dona_straight.wav`, from VocalSet (Wilkins, Seetharaman, Wahl, Pardo,
ISMIR 2018), https://zenodo.org/records/1203819, CC BY 4.0. Only that excerpt family was pulled from the
2.1 GB zip, by HTTP range requests, into `..\vocalset\`.

Known: SoulX feeds the prompt WAV from sample 0 and ignores the JSON's `time`, but the shipped
`example/audio/en_prompt.json` describes 5.22-10.28 s of the 10.8 s `en_prompt.mp3` (its f0 matches our RMVPE
track at that offset, 187/187 voiced frames within 0.5 st; at offset 0 only 7%). Every render made with the
default prompt so far conditioned on audio its metadata does not describe. Prompts made by this tool start at 0.

## Rebuild from scratch

```bash
cd C:/Users/dsbog/haftarah-audio/soulx-env
py -3.12 -m venv venv
./venv/Scripts/python.exe -m pip install --upgrade pip
./venv/Scripts/python.exe -m pip install torch==2.2.0+cu121 torchaudio==2.2.0+cu121 --index-url https://download.pytorch.org/whl/cu121
grep -v '^torch' requirements.lock.txt > rest.txt && ./venv/Scripts/python.exe -m pip install -r rest.txt && rm rest.txt
git init SoulX-Singer && cd SoulX-Singer
git remote add origin https://github.com/Soul-AILab/SoulX-Singer
git fetch --depth 1 origin 81aeb3ae772c70093c3de74dc23c92d983801ae4 && git checkout FETCH_HEAD
# checkpoint, only if ..\soulx\model.pt is gone (2.8 GB):
curl -L -o ../../soulx/model.pt https://huggingface.co/Soul-AILab/SoulX-Singer/resolve/main/model.pt
```

Check: `./venv/Scripts/python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"` prints
`2.2.0+cu121 True`.

## Use

From the repo:

```bash
node scripts/trope-render.mjs --ref "I Samuel 20:18-42"            # renders into ..\renders\i-samuel-20-18-42\
node scripts/trope-render.mjs --ref "I Samuel 20:18" --dry-run      # metadata JSON only, no Python
```

The script finds this folder via `HAFTARAH_SOULX_ENV` (default `C:\Users\dsbog\haftarah-audio\soulx-env`) and
the checkpoint via `HAFTARAH_SOULX_MODEL` (default `C:\Users\dsbog\haftarah-audio\soulx\model.pt`). It runs
`trope/soulx_runner.py` with this venv's Python: one model load, then SoulX's own `cli.inference.process()` per
verse (fp16, cuda, `control=score`, no auto_shift, pitch_shift 0).

The default prompt is SoulX's `example/audio/en_prompt.mp3`, a separated stem of a commercial pop recording:
internal tests only, never publish. Pass `--prompt <wav> --prompt-meta <json>` for a real voice (make them
with `scripts/trope-prompt.mjs`, above); the render checks the prompt JSON before loading the model.

Pitch check: `./venv/Scripts/python.exe tools/pitch_check.py ../renders/i-samuel-20-18-42 1 5 12 20 25`.

## Measured (GTX 1660 Ti, fp16)

Load 12.7 s; a 14 s verse renders in 87 s; peak 1.5 GB allocated / 2.8 GB reserved. Verses over 30 s of notes
are split by the emitter at phrase breaks into SoulX segments of the same metadata file (SoulX's own
preprocessor allows 60 s; 30 s keeps attention memory safe on 6 GB).


## Cloud rendering on Modal (optional; local stays the default)

`node scripts/trope-render.mjs ... --backend modal` renders on Modal GPUs instead of the 1660 Ti. Code:
`trope/modal_render.py` in the haftarah repo (it shares `trope/soulx_runner.py` with the local path). Full notes,
cost table and safety: `docs/superpowers/plans/2026-10-15-trope-cloud-render.md`.

One-time setup. Modal gets its own venv; do not `pip install modal` into `venv\` here, the pins above are tight.

```powershell
# 1. account: https://modal.com (Starter: $0 + compute, $30/month free credit); set a monthly spend limit
py -3.12 -m venv C:\Users\dsbog\haftarah-audio\modal-env
C:\Users\dsbog\haftarah-audio\modal-env\Scripts\python.exe -m pip install modal
C:\Users\dsbog\haftarah-audio\modal-env\Scripts\modal.exe token new          # opens a browser
# 2. optional, from the repo: pull the 2.8 GB checkpoint into the private Modal volume now (else the first render does it)
C:\Users\dsbog\haftarah-audio\modal-env\Scripts\modal.exe run trope\modal_render.py::download_weights
# 3. render
node scripts/trope-render.mjs --ref "I Samuel 20:18-42" --backend modal [--gpu L4] [--max-containers 10] [--per-call 3]
node scripts/trope-render.mjs --backend modal --refs-file refs.txt           # many readings, one fan-out
```

The image pins the same versions as this venv (torch 2.2.0+cu121, transformers 4.41.2, numpy 1.26.4, ...) and
SoulX-Singer commit 81aeb3ae. The checkpoint lives only in the Modal volume `soulx-singer-weights` in your
workspace (not in the image, not public); the prompt wav and metadata are sent per call and not stored; WAVs
download to `renders\`. The default prompt is read from `SoulX-Singer\example\audio` here, so keep this clone.

Estimated cost (modal.com/pricing read 2026-10-15; speedups over the 1660 Ti are assumptions, not
measurements): about $0.006 per 15 s verse on an L4, so about $0.18 per 30-verse haftarah and about $46 for
the ~7,700-verse cycle (6 h at 10 containers, about 1 h at 50). A10 about 10 percent more, A100 about 45
percent more but 2x faster. Render one haftarah first and replace these with `renderSeconds` from the manifest.
