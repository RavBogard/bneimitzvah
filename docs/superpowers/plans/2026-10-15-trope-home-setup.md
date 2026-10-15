# Trope engine: setting up a second machine (the RTX 4070 laptop)

The repo holds the code. Everything heavy lives outside it, in `%USERPROFILE%\haftarah-audio\` (override
with the `HAFTARAH_AUDIO` environment variable): the Python venv, the SoulX-Singer clone, the 2.8 GB
checkpoint, the prompt-prep models, voice prompts and renders. None of it goes in git. This page rebuilds
it from scratch. The full reference, as it stands on the first machine, is
[`trope/env/soulx-env-README.md`](../../../trope/env/soulx-env-README.md) (paths there say
`C:\Users\dsbog`; read them as `%USERPROFILE%`). Pinned packages: [`trope/env/requirements.lock.txt`](../../../trope/env/requirements.lock.txt).

## 0. Prerequisites

- Git, Node 18+ (nothing to `npm install`), Python **3.12** (`py -3.12 --version`). Not 3.13/3.14: torch 2.2 has no wheels.
- NVIDIA driver recent enough for CUDA 12.1 (`nvidia-smi`). The 4070 (Ada) does fp16 and bf16; keep the fp16 default.
- About 8 GB free disk.

## 1. Code

```bash
git clone https://github.com/RavBogard/haftarah && cd haftarah
git checkout trope-engine-research && npm test
```

## 2. Render environment (Git Bash, from the repo)

```bash
A="$USERPROFILE/haftarah-audio"; mkdir -p "$A/soulx" "$A/soulx-env" "$A/prompts" "$A/renders"
cd "$A/soulx-env"
py -3.12 -m venv venv
./venv/Scripts/python.exe -m pip install --upgrade pip
./venv/Scripts/python.exe -m pip install torch==2.2.0+cu121 torchaudio==2.2.0+cu121 --index-url https://download.pytorch.org/whl/cu121
grep -v -E '^(torch|torchaudio)==' "$OLDPWD/trope/env/requirements.lock.txt" > rest.txt && ./venv/Scripts/python.exe -m pip install -r rest.txt && rm rest.txt
./venv/Scripts/python.exe -c "import nltk; [nltk.download(p, download_dir='venv/nltk_data') for p in ('averaged_perceptron_tagger_eng', 'cmudict')]"
git init SoulX-Singer && cd SoulX-Singer && git remote add origin https://github.com/Soul-AILab/SoulX-Singer
git fetch --depth 1 origin 81aeb3ae772c70093c3de74dc23c92d983801ae4 && git checkout FETCH_HEAD && cd ..
mkdir -p tools && cp "$OLDPWD/trope/env/pitch_check.py" tools/   # (if $OLDPWD drifted, copy from the repo by hand)
curl -L -o ../soulx/model.pt https://huggingface.co/Soul-AILab/SoulX-Singer/resolve/main/model.pt     # 2.8 GB
./venv/Scripts/python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"      # 2.2.0+cu121 True
```

Prompt-prep models (only needed to make new voice prompts, about 815 MB):

```bash
mkdir -p "$A/soulx-preprocess" && cd "$A/soulx-preprocess"
for f in rmvpe/rmvpe.pt rosvot/rmvpe/model.pt rosvot/rosvot/config.yaml rosvot/rosvot/model.pt rosvot/rwbd/config.yaml rosvot/rwbd/model.pt; do
  mkdir -p $(dirname $f); curl -L -o $f https://huggingface.co/Soul-AILab/SoulX-Singer-Preprocess/resolve/main/$f; done
```

## 3. Voice prompts

The current best prompt is `vocalset-m6-dona.{wav,json}` (about 1 MB; VocalSet singer m6, CC BY 4.0, credit
line in the env README). Copy `haftarah-audio\prompts\` over from the first machine (a USB stick or a
private Drive folder; not git, not the public Blob store), or rebuild it: download VocalSet
(https://zenodo.org/records/1203819), take `FULL/male6/excerpts/straight/m6_dona_straight.wav`, and run
`node scripts/trope-prompt.mjs --in <that wav> --name vocalset-m6-dona --tokens "<per-syllable en_ tokens>"`
(the tokens used are in the prompt JSON's `phoneme` field on the first machine).

## 4. Smoke test

```bash
node scripts/trope-render.mjs --ref "I Samuel 20:18" --key D3 \
  --prompt "$USERPROFILE/haftarah-audio/prompts/vocalset-m6-dona.wav" --prompt-meta "$USERPROFILE/haftarah-audio/prompts/vocalset-m6-dona.json"
"$USERPROFILE/haftarah-audio/soulx-env/venv/Scripts/python.exe" "$USERPROFILE/haftarah-audio/soulx-env/tools/pitch_check.py" "$USERPROFILE/haftarah-audio/renders/i-samuel-20-18"
```

On the 1660 Ti a verse takes about 6x its length; expect the 4070 to be several times faster (unmeasured).
With 8 GB+ of VRAM the 30 s segment cap in `trope/soulx.mjs` (`MAX_SEGMENT_SECONDS`) could be raised.
Cloud alternative: [`2026-10-15-trope-cloud-render.md`](2026-10-15-trope-cloud-render.md) (Modal).
