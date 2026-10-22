# DiffSinger recipe: Hebrew chant on an 8 GB Windows laptop

2026-10-22. Written for the Claude Code agent that runs `VOICE-BUILD-PLAN.md` (M0, M1 and M3) and `EXPERIMENT-1.md`. It is a how-to, not a decision document: where it disagrees with the plan, section 0 says so and the plan's owner decides.

**How this was checked.** Facts marked plainly were read from source code or docs at the cited commit or page (section 9). The DiffSinger facts come from the `v2.5.1` tag (commit `323a5693245b827caba0ab1a7371fe5ca885b061`, 2026-01-08), cloned and read. Anything marked **(unverified)** comes from memory, a community post, or inference, and must be confirmed by a smoke test before it is relied on.

**Terms used once and then assumed.**
- *Acoustic model*: takes phones, phone durations and a pitch curve (f0), and outputs a mel spectrogram. This is all Experiment 1 needs.
- *Variance model*: predicts durations and pitch from notes. It is the later, optional stage (Stage 1b and M3).
- *Vocoder*: turns a mel spectrogram plus f0 into audio.
- *Binarize*: DiffSinger's preprocessing step, which turns WAVs and labels into training files.
- *Frame*: one mel frame, 512 samples at 44.1 kHz, which is 11.61 ms.
- *Segment*: one training clip, 5 to 15 s long.

---

## 0. Where this disagrees with the plan

1. **Python version.** The plan allows Python 3.11 or 3.12; **use 3.11 only.** DiffSinger v2.5.1 pins `pyworld==0.3.4` and `onnxsim~=0.4.36`, and PyPI has Windows wheels for both only up to cp311. On 3.12, `pip install -r requirements.txt` has to compile them from source.
2. **One environment cannot both train and export at v2.5.1.** The v2.5.1 `GettingStarted.md` says exporting to ONNX "requires PyTorch 1.13" in a separate environment, and `scripts/export.py` refuses any other version. torch 1.13.1 has Windows wheels for cp37 to cp310 only. That means a second environment: Python 3.10 with CPU torch 1.13.1. The pin was lifted on `main` in PR #305 (2026-06-21), but no release carries that change yet.
3. **The cu126 build means torch 2.6 or later.** The PyTorch cu126 index starts at 2.6.0, where `torch.load` defaults to `weights_only=True`. DiffSinger v2.5.1 calls `torch.load` without that argument, and it pins `lightning~=2.3.0`. Whether checkpoint resume and inference work under torch 2.6 or later is **(unverified)**. The step-0 smoke test must resume a checkpoint and run `infer.py` before anything else.
4. **MFA version.** The plan says "latest MFA 3.x". MakeDiffSinger's forced-alignment pipeline is written and pinned for **MFA 2.0.6 on Python 3.8**. MFA 3.x (`mfa train`) is fine for training a Hebrew model from scratch. That MakeDiffSinger's TextGrid scripts read MFA 3 output unchanged is **(unverified)**. Either way, MFA needs its own conda environment.
5. **Checkpoints at 25k, 50k and 100k do not happen by default.** DiffSinger saves only at validation time (every `val_check_interval` steps), keeps the last 5, and makes checkpoints permanent only from `permanent_ckpt_start` (template value 120,000). See step 3.4 for settings that keep 25k, 50k, 75k and 100k.
6. **Two fixes made after v2.5.1 should be applied to the pinned snapshot.** Both cherry-pick cleanly onto v2.5.1 (tested):
   - `920ba91`: RMVPE and VR padding. A maintainer reports an RMVPE bug that wrongly marks voiced frames as unvoiced (issue #284). RMVPE is also the G1 gate tool, so this matters twice.
   - `8a07f76` (PR #313): padding mel batches with silence instead of maximum loudness.

   Record both in the manifest as "v2.5.1 + 2 patches".
7. **No official standalone ONNX renderer exists.** A maintainer says ONNX models are for editors such as OpenUtau and that there is no public standalone inference tool (issue #258, 2025-05-19). Render with `scripts/infer.py` (PyTorch) for Experiment 1. For M5, write the small onnxruntime script in step 3.8.
8. **Vocoder licence.** Fine-tuning the community pc-nsf-hifigan creates a derivative of CC BY-NC-SA weights. A maintainer says the licence constrains "redistribution and modification (e.g. finetuning) of the model weights" (issue #336, 2026-10-04). So only training from scratch (M3) gives a release vocoder free of those terms. The community vocoder was trained on about 93 hours of data (release notes). A from-scratch vocoder on a few hours of chant may sound worse **(unverified)**. Plan a listening check.
9. **DiffSinger's working folders are relative to the current directory.** Checkpoints go to `checkpoints/<exp>`, relative to wherever you run the command, and the configs' `base_config` paths are too. Run DiffSinger from a snapshot **outside every Git tree** (for example `C:/private/voice-pilot/DiffSinger`), not from `voice/` inside the bneimitzvah repo. Otherwise weights land in the working tree. The repo keeps only the pinned commit, the two patch files, and config templates with placeholder paths.
10. **No primary source gives VRAM numbers.** The 12,000 to 16,000 `max_batch_frames` in the plan is a reasonable starting point, but it is **(unverified)**. Measure it as Experiment 1 step 0 says.

---

## 1. Environments (Windows 11, RTX 4070 Laptop 8 GB)

There are three environments. Keep them in separate folders under `C:/private/voice-pilot/env/`.

| Environment | Python | Torch | Used for |
|---|---|---|---|
| `ds-train` | 3.11 | 2.x + cu126 (pick the version, then freeze it) | binarize, train, PyTorch inference, RMVPE checks |
| `ds-export` | 3.10 | 1.13.1 CPU | `scripts/export.py` only |
| `mfa` (conda) | 3.11 or 3.12, conda-forge | none | Montreal Forced Aligner |

SingingVocoders (M3) can share `ds-train` once `torchaudio` is added (its code imports torchaudio, and the repo ships no requirements file).

### 1.1 Get the code at pinned versions

```powershell
cd C:/private/voice-pilot
git clone https://github.com/openvpi/DiffSinger.git
cd DiffSinger
git checkout -b crc-v2.5.1 v2.5.1      # 323a5693245b827caba0ab1a7371fe5ca885b061
git cherry-pick 920ba91 8a07f76         # RMVPE/VR padding; mel padding (PR #313)
git rev-parse HEAD                      # record in env/manifest.json
cd ..
git clone https://github.com/openvpi/MakeDiffSinger.git       # pin: record HEAD (was 1edcd66, 2026-03-11)
git clone https://github.com/openvpi/SingingVocoders.git      # pin: record HEAD (was 4d0889c, 2026-03-08)
```

Licences: DiffSinger is Apache-2.0, MakeDiffSinger BSD-3, SingingVocoders MIT. Read each LICENSE file and record it, as the experiment requires.

### 1.2 Training environment with uv

**Install PyTorch first, then the requirements.** Installing in the other order broke an environment in issue #273, and the maintainer's fix was this order.

```powershell
cd C:/private/voice-pilot/DiffSinger
uv venv C:/private/voice-pilot/env/ds-train --python 3.11
C:/private/voice-pilot/env/ds-train/Scripts/activate
uv pip install torch==<chosen>+cu126 torchaudio==<matching> --index-url https://download.pytorch.org/whl/cu126
uv pip install -r requirements.txt
python -c "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

- For a locked `uv.lock` project, declare the index the way uv's PyTorch guide shows. Add a `[[tool.uv.index]]` with `name = "pytorch-cu126"`, `url = "https://download.pytorch.org/whl/cu126"` and `explicit = true`. Then route `torch` and `torchaudio` to it under `[tool.uv.sources]` with `marker = "sys_platform == 'win32'"`.
- cu126 Windows wheels exist for torch 2.6.0, 2.7.0, 2.7.1, 2.8.0, 2.9.0 and 2.9.1, each for cp311 (checked on the PyTorch index, 2026-10-22).
- Pick the oldest that works, because of the `lightning~=2.3.0` pin **(unverified)**. Then freeze it.
- v2.5.1's requirements pin `numpy<2`, `librosa<0.10`, `lightning~=2.3.0`, `onnx~=1.16.0`, `onnxsim~=0.4.36`, `praat-parselmouth==0.4.3` and `pyworld==0.3.4`.
- **If loading a checkpoint fails with an unpickling or `weights_only` error under torch 2.6 or later**, set the environment variable `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` for that process **(unverified flag name; check the torch release notes for the chosen version)**. Alternatively, patch the 7 `torch.load(` calls in v2.5.1 to pass `weights_only=False`. These are trusted local files.

### 1.3 Export environment

```powershell
uv venv C:/private/voice-pilot/env/ds-export --python 3.10
C:/private/voice-pilot/env/ds-export/Scripts/activate
uv pip install torch==1.13.1 torchvision==0.14.1 torchaudio==0.13.1   # CPU is enough, per GettingStarted
uv pip install -r requirements-onnx.txt                                 # pins lightning~=2.1.0, onnx~=1.16.0
```

### 1.4 Assets DiffSinger expects (all under `DiffSinger/checkpoints/`)

| Asset | Source | Put at | Config key |
|---|---|---|---|
| RMVPE pitch model | github.com/yxlllc/RMVPE/releases, tag `230917` | `checkpoints/rmvpe/model.pt` | `pe: rmvpe`, `pe_ckpt` |
| Vocoder (pilot only, CC BY-NC-SA 4.0) | github.com/openvpi/vocoders/releases, tag `pc-nsf-hifigan-44.1k-hop512-128bin-2025.02` | `checkpoints/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt` (with its `config.json`) | `vocoder: NsfHifiGAN`, `vocoder_ckpt` |
| VR harmonic-noise separator (only if voicing, breathiness or tension is used) | github.com/yxlllc/vocal-remover/releases, tag `hnsep_240512` | `checkpoints/vr/model.pt` | `hnsep: vr`, `hnsep_ckpt` |

- The release pages did not list asset file names, so the zip names are **(unverified)**. Unzip, confirm that `model.pt` or `model.ckpt` is present, and record the SHA-256.
- Neither the RMVPE nor the VR release page states a licence. Record "no licence stated" in the manifest.
- **Pitfall.** The acoustic binarizer builds a `DecomposedWaveform` for every clip. With `hnsep: vr`, it loads the VR checkpoint even when no variance embedding is enabled. For Experiment 1, either download VR or set `hnsep: world`.

### 1.5 Windows-specific rules

- **Use one GPU, no DDP.** `pl_trainer_devices: 'auto'` with one GPU runs without NCCL. If any DDP error appears, set `pl_trainer_strategy: {name: ddp, process_group_backend: gloo}`. NCCL is missing on Windows (issue #260).
- **DataLoader workers.** Windows always spawns worker processes. Issue #260 hit `Couldn't open shared file mapping ... error code 1455`, which means the Windows page file is too small. Start with `ds_workers: 2`. If error 1455 appears, enlarge the page file or drop to `ds_workers: 0` **(unverified best value)**.
- **Binarizer workers.** Keep `binarization_args.num_workers: 0` (the template default). With workers, every process loads RMVPE onto the GPU separately. On Windows, `utils/multiprocess_utils.py` also uses the default process start method.
- **Paths.** Use forward slashes in YAML. Keep data paths absolute. Always run commands from the DiffSinger root, because `base_config: configs/acoustic.yaml` and `checkpoints/` are resolved against the current directory.
- **No symlinks are needed.** Nothing in v2.5.1 creates symlinks. Do not junction `checkpoints/` into a Git tree.
- **Quote YAML language keys.** Issue #291: the bare key `no` was parsed as a boolean. `he` is safe, but quote it anyway: `'he'`.

---

## 2. Data format DiffSinger expects (acoustic model)

### 2.1 Folder layout (one folder per speaker)

```
C:/private/voice-pilot/data/pockettorah/raw/
  wavs/<name>.wav            # mono; WAV preferred, FLAC accepted since v2.5.1
  transcriptions.csv         # UTF-8, header: name,ph_seq,ph_dur
C:/private/voice-pilot/data/finkel/raw/   (Stage 2; same layout)
```

- The binarizer resamples to `audio_sample_rate: 44100` with `librosa.load`, so other input rates work. For the PocketTorah MP3 sources, decode to 44.1 kHz WAV once and do not add bandwidth extension (Experiment 1, step 4.2).
- **Segment length: 5 to 15 s.** That is MakeDiffSinger's guidance, and the plan's.

### 2.2 `transcriptions.csv`

```
name,ph_seq,ph_dur
gen001_03,SP b e r e sh i t SP,0.31 0.06 0.42 ...
```

- `name` is the WAV file name without its extension.
- `ph_seq` is phones separated by spaces.
- `ph_dur` is each phone's duration in seconds, separated by spaces.
- The binarizer asserts that `ph_seq` and `ph_dur` have the same length and that no duration is negative.
- **Pitfall.** If the sum of `ph_dur` does not match the audio length, nothing fails. `get_mel2ph_torch` silently pads the last phone or truncates. Check yourself that the sum equals the WAV duration within one frame (11.6 ms).
- A phone shorter than about half a frame can round to 0 frames. The plan's 15 ms floor avoids this.

### 2.3 Special tokens

- `SP` means silence and `AP` means a breath. Both are reserved global phones that are always in the phone set. They are never written in the dictionary or with a language prefix.
- Any other non-phone tag (`EP`, `GS` and so on) must be declared in `extra_phonemes`.
- Maintainer advice from issue #284: do not invent "trash" phones for sounds you do not like, because that causes unpredictable behaviour. Label silence as `SP`. Padding clips with a little silence labelled `SP` helps the model learn silence. MakeDiffSinger's `build_dataset.py` adds 0.1 to 0.5 s of random silence at either end, each with probability 0.5.

### 2.4 Declaring a new language and its phone set (v2.5.x)

- Single language: one entry under `dictionaries`, `num_lang: 1`, `use_lang_id: false`.
- The CSV then uses short phone names with no `he/` prefix.
- Only with two or more dictionaries are phones prefixed (`he/a`) and `merged_phoneme_groups` and `use_lang_id` become meaningful.
- The v2.5.1 release fixed multi-dictionary language IDs, which were all 0 before. That does not matter for a Hebrew-only model.

```yaml
dictionaries:
  'he': C:/private/voice-pilot/dict/hebrew-israeli-v2.txt
extra_phonemes: []
merged_phoneme_groups: []
num_lang: 1
use_lang_id: false
```

**Dictionary file rules** (from `utils/phoneme_utils.py`):
- Each line is `<syllable><TAB><phone> <phone> ...`, with **exactly one tab** per line.
- No blank lines and no comments. Each line is unpacked as `_, phones = line.strip().split('\t')`, so a blank line crashes it.
- Phones may not contain `/`. Avoid `-` and `+` (editor slur tags) and `@ # & | < >`. Prefer ASCII. Never name a phone `SP` or `AP`.
- **The phone set is the union of the phones in the dictionary.** The acoustic model never uses the syllable column; it reads phones straight from `ph_seq`. So generate the dictionary from the engine's syllable inventory (needed later for the variance model and OpenUtau), or simply one line per phone (`a<TAB>a`).
- **Coverage is enforced.** `check_coverage()` raises `BinarizationError: The following phonemes are not covered in transcriptions` if any dictionary phone never appears in the data. It writes the counts to `binary/phoneme_distribution.jpg` and prints them.
- MakeDiffSinger recommends at least 20 occurrences per phone, which matches the plan.
- Build the dictionary from the phones actually present, and list any short ones, as M2's exit test requires.

### 2.5 Long sung vowels (melisma)

- In the acoustic dataset, a melisma is **one vowel phone with one long duration**. The melody lives only in f0, which the binarizer extracts from the audio.
- DiffSinger's own samples do this. `samples/01_逍遥仙.ds` holds a 1.988 s vowel, and its note list marks the extra notes with `note_slur 1`. That note list is only used by the variance model.
- This matches Experiment 1 step 3.3.3. Do not split a melisma into repeated vowel phones.

### 2.6 Two speakers (Stage 2 / M3)

```yaml
datasets:
  - raw_data_dir: C:/private/voice-pilot/data/pockettorah/raw
    speaker: pockettorah
    spk_id: 0
    language: 'he'
    test_prefixes: [<6-10 training-reading clip names>]
  - raw_data_dir: C:/private/voice-pilot/data/finkel/raw
    speaker: finkel
    spk_id: 1
    language: 'he'
    test_prefixes: [<6-10 clip names>]
use_spk_id: true
num_spk: 2
```

- `test_prefixes` is the validation set. The binarizer asserts it is non-empty.
- Validation clips are excluded from training, but they are binarized.
- **Never** put the frozen held-out readings here. They must not be binarized at all, per the experiment's rule.
- For Experiment 1 (one speaker), use the first block only, with `use_spk_id: false` and `num_spk: 1`.

---

## 3. Steps

### 3.1 Write the config

Copy `configs/templates/config_acoustic.yaml` to `C:/private/voice-pilot/configs/acoustic-e1.yaml`. Keep `base_config: [configs/acoustic.yaml]`, which is resolved from the DiffSinger root. Set or keep the following.

```yaml
base_config:
  - configs/acoustic.yaml
# data (section 2)
dictionaries: {'he': C:/private/voice-pilot/dict/hebrew-israeli-v2.txt}
datasets: [ ...section 2.6, first block... ]
binary_data_dir: C:/private/voice-pilot/data/e1/binary
binarization_args: {num_workers: 0, shuffle: true}

# features
audio_sample_rate: 44100      # these 6 must match the vocoder; they are the acoustic.yaml defaults
hop_size: 512
win_size: 2048
fft_size: 2048
audio_num_mel_bins: 128
fmin: 40
fmax: 16000
pe: rmvpe
pe_ckpt: checkpoints/rmvpe/model.pt
f0_min: 65                    # base.yaml default; lower it if a reader goes below C2 (65.4 Hz)
f0_max: 1100
hnsep: world                  # or vr + download (section 1.4)
vocoder: NsfHifiGAN
vocoder_ckpt: checkpoints/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt   # the template points at 2024.02: change it

# speakers / language
use_spk_id: false
num_spk: 1
use_lang_id: false
num_lang: 1

# variance embeddings: all off for Experiment 1 (they have no default at render time)
use_energy_embed: false
use_breathiness_embed: false
use_voicing_embed: false
use_tension_embed: false

# augmentation = the plan's "default augmentation" (template values)
use_key_shift_embed: true     # required by random_pitch_shifting
use_speed_embed: true         # required by random_time_stretching
augmentation_args:
  random_pitch_shifting:  {enabled: true,  range: [-5., 5.], scale: 0.75}
  fixed_pitch_shifting:   {enabled: false, targets: [-5., 5.], scale: 0.5}
  random_time_stretching: {enabled: true,  range: [0.5, 2.], scale: 0.75}

# model (template defaults; v2.5.1 = reflow + LynxNet + shallow diffusion)
diffusion_type: reflow
use_shallow_diffusion: true
T_start: 0.4
T_start_infer: 0.4
K_step: 300
K_step_infer: 300
backbone_type: lynxnet
backbone_args: {num_channels: 1024, num_layers: 6, kernel_size: 31, dropout_rate: 0.0, strong_cond: true}

# 8 GB starting point (section 3.3)
pl_trainer_precision: '16-mixed'
max_batch_frames: 14000
max_batch_size: 12
accumulate_grad_batches: 3
ds_workers: 2
dataloader_prefetch_factor: 2

# schedule and checkpoints (section 3.4)
max_updates: 100000
val_check_interval: 2500
num_ckpt_keep: 5
permanent_ckpt_start: 25000
permanent_ckpt_interval: 25000
num_valid_plots: 6
val_with_vocoder: true
```

Notes:
- The base `configs/acoustic.yaml` has every augmentation **off**. They are on here only because the template turns them on, so keep these keys.
- Pitch-shift augmentation adds a `gender` input, and time-stretch adds a `velocity` input. At render time they default to 0 and to "default velocity", so nothing extra needs to be supplied.
- Template defaults that are not chant-specific: `optimizer_args.lr: 0.0006`; StepLR with `step_size: 10000` and `gamma: 0.75`; `max_updates: 160000`.

### 3.2 Binarize

```powershell
cd C:/private/voice-pilot/DiffSinger
C:/private/voice-pilot/env/ds-train/Scripts/activate
python scripts/binarize.py --config C:/private/voice-pilot/configs/acoustic-e1.yaml
```

Check the printout:
- `spk_map` and `lang_map`;
- the phone distribution, which must not error;
- train and valid durations before and after augmentation (with scale 0.75 on both augmentations, roughly 2.5×).

Clips whose f0 is entirely unvoiced are skipped, with the message `Skipped '...': empty gt f0`. Count them.

### 3.3 Fit it into 8 GB (Experiment 1, step 0)

Profile on a 30-minute subset, with a separate `binary_data_dir` and `exp_name`. Delete the checkpoint afterwards. Escalate in this order and stop at the first setting that runs 500 steps without running out of memory:

1. `max_batch_frames` 16000, then 12000, then 8000, raising `accumulate_grad_batches` (3, then 4, then 6) to keep the effective batch near the template's 50,000 frames **(unverified that quality tracks effective frames)**.
   - `val_check_interval` is counted in optimizer updates (the trainer multiplies it by `accumulate_grad_batches`), so the 25k/50k/100k marks stay right.
   - The longest segment must fit: 15 s is 1,292 frames, and a 0.5× time-stretch doubles that to 2,584. Every setting above clears this.
2. Keep `pl_trainer_precision: '16-mixed'`. The default and the docs say mixed precision saves memory. `bf16-mixed` is also allowed on Ada GPUs, but compare quality before switching.
3. `val_with_vocoder: false` during profiling only. It runs the vocoder on GPU at validation, which could spike memory **(unverified size)**.
4. Train the two decoders separately (BestPractices, "Train auxiliary decoder and diffusion decoder separately"):
   - **Stage A:** `shallow_diffusion_args: {train_aux_decoder: false, train_diffusion: true, val_gt_start: true}`. Train to `max_updates`.
   - **Stage B:** `shallow_diffusion_args: {train_aux_decoder: true, train_diffusion: false}`, `lambda_aux_mel_loss: 1.0`, `freezing_enabled: true`, `frozen_params: [model.fs2]`.
   - Reset the learning-rate schedule by renaming the last checkpoint to `model_ckpt_steps_0.ckpt` and deleting the others. Raise `max_updates`.
   - Stage B "normally does not need many steps". Verify with inference afterwards.
5. Smaller backbone: `backbone_args.num_channels: 512` **(unverified quality cost; a last resort before cloud)**.
6. Then cloud, under the $25 cap (the plan's rule).

Record peak VRAM with `nvidia-smi --query-gpu=memory.used --format=csv -l 5` or `torch.cuda.max_memory_allocated()`.

### 3.4 Train

```powershell
python scripts/train.py --config C:/private/voice-pilot/configs/acoustic-e1.yaml --exp_name e1_pt_acoustic --reset
tensorboard --logdir checkpoints/
```

- Checkpoints land in `checkpoints/e1_pt_acoustic/` as `model_ckpt_steps_<N>.ckpt`, with a copy of the config.
- Run the same command again to resume. It "resumes automatically from the latest checkpoint".
- **Config pitfall.** Without `--reset`, the saved `checkpoints/<exp>/config.yaml` **overrides your edited YAML** (`utils/hparams.py`). After any config change, such as decoder stage B, add `--reset`. That rewrites the saved config but still resumes from the latest checkpoint.
- Single keys can be overridden with `--hparams "key=value,key2=value2"`.
- **Steps.** The template uses 160,000 updates; the plan stops at 100,000 or 36 h. With the step-3.1 settings, checkpoints at 25k, 50k, 75k and 100k become permanent. They are saved only on a validation step, and 25,000 is a multiple of `val_check_interval: 2500`.
- Watch the validation mel plots and audio in TensorBoard (`val_with_vocoder`).

### 3.5 Choose and evaluate checkpoints

The agent-only check from Experiment 1, step 6: render the O condition (the real reader's durations and f0) for the 12 test verses with each permanent checkpoint, then run G1 and the sound check, and keep the best. `--ckpt <steps>` selects one.

```powershell
python scripts/infer.py acoustic C:/private/voice-pilot/render/<verse>.ds --exp e1_pt_acoustic --ckpt 100000 --out C:/private/voice-pilot/render/out --title <verse>
```

Other options: `--spk` (speaker name or mix, for example `finkel` or `finkel:0.8|pockettorah:0.2` **(unverified mix syntax)**), `--key` (semitones), `--gender` (−1 to 1, formants), `--depth` (shallow-diffusion depth), `--steps` (sampling steps), `--seed`, and `--mel` to save the mel instead of audio.

### 3.6 The `.ds` file: rendering with our own phones, durations and f0

A `.ds` file is JSON: a list of segments. The acoustic renderer (`inference/ds_acoustic.py`) reads these fields:

| Field | Required | Meaning |
|---|---|---|
| `ph_seq` | yes | phones separated by spaces (short names, single language) |
| `ph_dur` | yes | seconds, separated by spaces |
| `f0_seq` | yes | Hz, separated by spaces, one value per `f0_timestep` |
| `f0_timestep` | yes | seconds between f0 values; any value works, since it is resampled to frames (for example 0.005, or 512/44100) |
| `offset` | no (default 0) | the segment's start time in the output file; segments are concatenated with silence |
| `spk_mix` | multi-speaker | normally set with `--spk` |
| `gender`, `gender_timestep` | no | a static number or a curve, −1 to 1 (default 0) |
| `velocity`, `velocity_timestep` | no | the speed curve (default: neutral) |
| `lang` | no | language for this segment (single language: omit) |

```json
[{"offset": 0.0,
  "ph_seq": "SP b e r e sh i t SP",
  "ph_dur": "0.150 0.060 0.420 0.080 0.300 0.090 0.900 0.070 0.300",
  "f0_seq": "146.8 146.8 146.9 ...",
  "f0_timestep": "0.005"}]
```

- **f0 must be continuous.** The binarizer trains on f0 extracted with `interp_uv=True`, which interpolates pitch through unvoiced frames and rests. So the engine's S-condition curve must also carry a pitch value through consonants and `SP`: hold or interpolate between neighbouring notes, and never use 0 Hz.
- The f0 values count must be about `sum(ph_dur) / f0_timestep`. A few frames of difference are re-aligned automatically (maintainer, issue #243).
- Durations become frames exactly as in `ds_acoustic.py`: `acc = round(cumsum(ph_dur)/timestep + 0.5)`, then the frame durations are `diff(acc)`.
- `.ds` files are private (labels). Write them only under `C:/private/`. M0's repo policy already refuses them.

### 3.7 Export to ONNX (in `ds-export`)

```powershell
cd C:/private/voice-pilot/DiffSinger
C:/private/voice-pilot/env/ds-export/Scripts/activate
python scripts/export.py acoustic --exp e1_pt_acoustic --ckpt 100000 --out C:/private/voice-pilot/onnx/e1
#   multi-speaker (M3): add --export_spk pockettorah --export_spk finkel   (or --freeze_spk finkel)
#   optional: --freeze_gender 0 --freeze_velocity   (removes those two inputs)
python scripts/export.py nsf-hifigan --config <acoustic config with the vocoder's mel settings> --ckpt <vocoder model.ckpt> --out C:/private/voice-pilot/onnx/vocoder
```

**What the acoustic export produces:**
- `<exp>.onnx`;
- `<exp>.phonemes.json` (phone to token ID);
- `<exp>.languages.json`;
- a `<exp>.<spk>.emb` file per exported speaker (raw float32, length `hidden_size`, 256 by default);
- `dsconfig.yaml`. Its `vocoder` field defaults to `pc_nsf_hifigan_44.1k_hop512_128bin_2025.02`, and the exporter prints "**PLEASE EDIT BEFORE USE**". Set it to our vocoder for M3.

**What the vocoder export produces:** an ONNX with inputs `mel` and `f0`, output `waveform`, and a `vocoder.yaml` recording `pitch_controllable`.

### 3.8 Rendering from ONNX (no official tool; about 60 lines of onnxruntime)

Input names are taken from `deployment/exporters/acoustic_exporter.py`:

| Input | Shape and type | Notes |
|---|---|---|
| `tokens` | `[1, N]` int64 | from `phonemes.json` |
| `durations` | `[1, N]` int64 | **frames**, computed as in section 3.6 |
| `f0` | `[1, T]` float32 | Hz, one per frame, T = sum of durations |
| `gender` | `[1, T]` | only if not frozen; zeros |
| `velocity` | `[1, T]` | only if not frozen; ones **(unverified neutral value; check `ds_acoustic.py`)** |
| `spk_embed` | `[1, T, hidden_size]` float32 | only when multi-speaker and not frozen; tile the `.emb` vector over T |
| `languages` | `[1, N]` | only with `use_lang_id`; not ours |
| `depth` | scalar | shallow-diffusion depth; use `max_depth` from dsconfig (1 − T_start = 0.6) |
| `steps` | scalar | sampling steps, for example 20 |

The output is `mel`, shaped `[1, T, 128]`. Feed it with the same `f0` to the vocoder, which outputs `waveform` at 44.1 kHz.

The scalar dtypes of `depth` and `steps` are **(unverified)**. Print `sess.get_inputs()` and match them. Validate the ONNX path against `infer.py` on 3 verses (same seed, mel difference small) before using it for M5.

---

## 4. Vocoder

### 4.1 Pilot: the community pc-nsf-hifigan

- Release `pc-nsf-hifigan-44.1k-hop512-128bin-2025.02`.
- Specs: 44.1 kHz, hop 512, window 2048, 128 mel bins, 40 to 16,000 Hz.
- Pitch shift of ±12 semitones; usual output range E2 to D#7.
- Licence CC BY-NC-SA 4.0. Private research use only, as Q4 allows.
- DiffSinger's mel settings in section 3.1 already match.

### 4.2 Our own vocoder (M3), using SingingVocoders (MIT)

**Data.**
- Use Finkel's lossless chant plus PocketTorah, at 44.1 kHz.
- Preprocessing scans every `.wav` and `.flac` in `data_input_path`, including subfolders.
- It extracts f0 with **parselmouth or harvest only**; there is no RMVPE here.

**From-scratch config.**
- Base it on `configs/base_hifi.yaml`, which inherits `base.yaml`.
- Turn on the pitch-controllable recipe as `ft_hifigan.yaml` does: `pc_aug: true`, `pc_aug_rate: 0.4`, `pc_aug_key: 12`, `model_args.mini_nsf: true`, `noise_sigma: 0.0`.
- Keep `finetune_enabled: false`.
- Keep `pl_trainer_precision: '32-true'`. The README says twice not to use bf16, because of audio-quality problems.
- The mel settings in `base_hifi.yaml` already equal DiffSinger's.

**8 GB settings.**
- The README gives 24 GB: `crop_mel_frames 48`, `batch_size 10`; and 16 GB: `crop_mel_frames 32`, `batch_size 10`, `pc_aug_rate 0.4`.
- For 8 GB, start at `crop_mel_frames: 32` and `batch_size: 4`, with `accumulate_grad_batches: 2` **(unverified)**, and profile as in section 3.3.

```powershell
cd C:/private/voice-pilot/SingingVocoders
uv pip install torchaudio==<matching torch>          # into ds-train
python process.py --config C:/private/voice-pilot/configs/voc.yaml --num_cpu 4 --strx 1
python train.py --config C:/private/voice-pilot/configs/voc.yaml --exp_name crc_pcnsf --work_dir C:/private/voice-pilot/voc
python export_ckpt.py --ckpt_path <...>/model_ckpt_steps_<N>.ckpt --save_path C:/private/voice-pilot/voc/export/model.ckpt
```

- The export writes `model.ckpt` (`{'generator': ...}`) and a `config.json` beside it, which is what DiffSinger's `vocoder_ckpt` loader expects.
- DiffSinger's loader supports `mini_nsf` and `noise_sigma`.
- Convert to ONNX with DiffSinger's `export.py nsf-hifigan` (section 3.7).

**Steps.**
- **The step counter shows twice the real steps** for GAN training (README).
- `base_hifi.yaml` stops at `max_updates: 100000`, which is about 50k real steps.
- The community model was trained on about 93 h. How many steps a from-scratch model on a few hours needs is **(unverified)**. Judge it by listening, with G2 and the M4 review.

### 4.3 Fine-tuning option (pilot only, never in a release)

- Use `configs/ft_hifigan.yaml` with `finetune_ckpt_path` pointing at the 2025.02 `.ckpt`.
- Learning rates are 1e-5; "about 2000 steps (shown as 4000)" is enough for a small dataset. Freezing the MPD discriminator may help.
- The result stays CC BY-NC-SA (issue #336), so it is a quick quality ceiling for comparison, not a release path.

---

## 5. Alignment for a new language

### 5.1 MFA trained from scratch on our corpus

MakeDiffSinger's `acoustic_forced_alignment` pipeline assumes a *pretrained* MFA model (Mandarin only) and MFA 2.0.6. For Hebrew we train one with `mfa train`. The MFA docs (3.x) give:

```
mfa train [OPTIONS] CORPUS_DIRECTORY DICTIONARY_PATH OUTPUT_MODEL_PATH
```

The useful options:
- `--output_directory`: where the alignments are written;
- `--single_speaker`: per-utterance splits, no speaker adaptation (right for PocketTorah's one reader);
- `-j/--num_jobs`, `--use_mp`;
- `--clean`, which is on by default;
- `--output_format long_textgrid`, the default;
- `--phone_groups_path`: a YAML grouping related phones;
- `-c/--config_path`: a training-config YAML.

```powershell
conda create -n mfa -c conda-forge montreal-forced-aligner --yes   # record the exact version
conda activate mfa
mfa train C:/private/voice-pilot/mfa/corpus C:/private/voice-pilot/mfa/he_words.dict C:/private/voice-pilot/mfa/he_pt.zip --output_directory C:/private/voice-pilot/mfa/tg --single_speaker --clean -j 8
```

**Corpus.**
- Put a 16 kHz, 16-bit PCM WAV and a `.lab` transcript with the same name side by side. MakeDiffSinger's `reformat_wavs.py` makes these, because "MFA fails on some platforms if the WAVs are not in 16kHz 16bit PCM".
- Use ASCII word IDs in the `.lab` (for example the engine's romanized syllable or word keys), not Hebrew script. That avoids MFA's text normalisation and tokenisation **(unverified for Hebrew script specifically)**.

**Dictionary.**
- One line per word: the word, a tab, then the phones separated by spaces.
- Generate it from the engine (the `israeli-v2` profile), the same source as DiffSinger's dictionary.

**Long sung vowels.**
- MFA 3 phone models allow up to 5 states with early exit, giving a 10 ms minimum phone.
- There is no stated maximum duration, so a 3 s vowel is representable.
- MFA's features and models are built for speech. Melismatic vowels with large pitch movement are a known risk **(unverified for chant)**. Two mitigations:
  - Experiment 1 step 3.3 already constrains each word to its CTC span and drops low-likelihood segments.
  - One vowel phone per melisma means MFA never has to find note boundaries inside a vowel.

**From TextGrid to CSV.**
- MakeDiffSinger's `enhance_tg.py` (detect AP, add SP) and `build_dataset.py` (writes `name,ph_seq,ph_dur`, reads tier index 1 = phones, inserts random silence) work on 2-tier TextGrids.
- That they work unchanged on MFA 3 output is **(unverified)**. Spot-check 5 files, or write a 30-line converter.
- Run `build_dataset.py --skip_silence_insertion` if the CTC-constrained cuts already include `SP`.

### 5.2 HubertFA (trainable alternative; Apache-2.0; wolfgitpr/HubertFA, HEAD `b3f0869`, 2026-03-19)

- **What it is.** A singing-oriented aligner, based on SOFA and FoxBreatheLabeler, with two models:
  - NLL, which finds non-lexical sounds such as breaths;
  - FA, which does the forced alignment.
- **Environment.** Its own conda environment, Python 3.10, torch "lower than 2.9". It also needs `transformers~=4.45.0` and a HuBERT encoder; the default config uses `chinese-hubert-base` in `dependencies/` (encoder licence **(unverified)**).
- **What it needs to train.**
  - Already labelled data in DiffSinger CSV form (`name,ph_seq,ph_dur` plus `wavs/`).
  - A dictionary for the new language. Its configs ship zh, ja, en and yue; add `he` under `dictionaries`.
  - An evaluation set from an unseen speaker with accurate labels.
- **Commands:** `python binarize.py -c configs/<x>.yaml --model fa`, then `python train.py -c configs/<x>.yaml --model fa`. Its config defaults to `precision: bf16-mixed`.
- **Fit for us.** It cannot start from nothing. Use it as a second pass: train FA on the MFA-labelled PocketTorah set, then re-align (and later Finkel) and compare boundary error on a small hand-checked set. Optional, and only if MFA's melisma boundaries prove poor.

---

## 6. Variance model (later: Stage 1b and M3)

**What it predicts.** Durations (`predict_dur`) and pitch (`predict_pitch`) from notes. BestPractices recommends:
1. train the duration predictor together with a variance predictor, then discard the variance part;
2. train pitch separately.

**Extra CSV columns** (`preprocessing/variance_binarizer.py`):

| Column | Needed for | Rule |
|---|---|---|
| `ph_num` | duration | number of phones in each DiffSinger "word". Asserted: `sum(ph_num) == len(ph_seq)` |
| `note_seq` | pitch | note names (`C4`, `D#3`, …) or `rest`. At least one non-rest per clip |
| `note_dur` | pitch | seconds, same length as `note_seq`, no negatives |
| `note_glide` | optional (`use_glide_embed`) | `none`, `up` or `down` per note |

**Word division is vowel-first.**
- Each DiffSinger "word" starts at a vowel, `AP` or `SP`, and carries the next syllable's onset consonants at its end. MakeDiffSinger's example is `AP | sh ir | zh e` → `ph_num 2 2 1`.
- Hebrew is polysyllabic, so MakeDiffSinger says to do this manually. For us, the engine's syllables define it exactly: one group per sung syllable, re-cut at the vowel.

**Slurs and melisma.**
- At v2.5.1 the CSV has **no** `note_slur` column; the binarizer never reads it.
- A melisma is a word whose time span holds several notes; the notes' durations divide the word.
- In `.ds` files for variance *inference*, `note_slur` (0/1 per note, 1 = continues the previous syllable) **is required**. `ds_variance.py` uses it to compute word durations.
- `infer.py variance <ds> --exp <var> --predict pitch` overwrites `f0_seq` only if the model has a pitch predictor (issue #243).

**Tools.**
- MakeDiffSinger `variance-temp-solution` has `estimate_midi.py`, `convert_ds.py csv2ds/ds2csv`, SOME (an automatic MIDI extractor) and SlurCutter (manual).
- For us the trope score already gives `note_seq` and slurs. Only the note timing needs fitting to the audio.
- Use the **same pitch extractor and model** for labelling and training (the README says so).

---

## 7. Top pitfalls (GitHub issues 2025–2026, plus code-level traps)

1. **Exporting needs torch 1.13 at v2.5.1.** It needs a separate Python 3.10 environment; the pin was removed only on `main` (PR #305, 2026-06-21). https://github.com/openvpi/DiffSinger/pull/305
2. **Install order breaks the environment.** Install torch before `requirements*.txt` (issue #273, 2025-11). https://github.com/openvpi/DiffSinger/issues/273
3. **Windows multiprocessing and NCCL failures.**
   - "Distributed package doesn't have NCCL built in": use one GPU, or gloo for DDP.
   - "Couldn't open shared file mapping … 1455": the page file is too small; lower `ds_workers`.
   - Child process exit 3221225477.

   The maintainer's advice was to move to Linux. Issue #260, 2025-06. https://github.com/openvpi/DiffSinger/issues/260
4. **RMVPE wrongly marking voiced frames unvoiced, and labelling errors that leak voicing across speakers.**
   - Cherry-pick `920ba91`.
   - Avoid voicing and energy embeddings at first.
   - Never use "trash" phones.
   - The maintainer's `check-uv-voicing` branch scans a dataset for voiced audio under unvoiced phones.

   Issue #284, 2025-12 to 2026-01. https://github.com/openvpi/DiffSinger/issues/284
5. **No official ONNX inference script.** Write your own, or use `infer.py` (issues #258 and #257, 2025-05; still open 2026-07). https://github.com/openvpi/DiffSinger/issues/258
6. **Vocoder licence.** Fine-tuning the community vocoder is still CC BY-NC-SA (issue #336, 2026-09 to 10). https://github.com/openvpi/DiffSinger/issues/336
7. **YAML language codes.** `no` was parsed as a boolean (issue #291, 2026-01). Quote `'he'`. https://github.com/openvpi/DiffSinger/issues/291
8. **Out-of-range pitch collapses the timbre.** The acoustic model degrades above the range it was trained on. pc-nsf-hifigan can shift ±12 semitones only if the acoustic model gets an in-range f0 (issue #319, 2026-08). Keep render keys within the reader's sung range, and use `--key` or the browser shift for the rest. https://github.com/openvpi/DiffSinger/issues/319
9. **`--predict pitch` silently does nothing** without a pitch predictor (issue #243, 2025-04). https://github.com/openvpi/DiffSinger/issues/243
10. **Training "hangs" at the sanity check.** Usually environment or permission problems. `nccl_p2p: false` is the first thing to try (issue #226, 2025-01). https://github.com/openvpi/DiffSinger/issues/226

**Code-level traps (read in v2.5.1 source, not from issues).**
- An edited config is ignored on resume unless you pass `--reset`.
- A dictionary phone missing from the data aborts the binarizer.
- `hnsep: vr` loads the VR checkpoint even when unused.
- A `ph_dur` sum that disagrees with the audio length is silently padded or truncated.
- f0 at render time must be interpolated, with no zeros.
- Permanent checkpoints only fall on validation steps.
- Mel padding uses full loudness before PR #313.

---

## 8. Order of work for the agent

1. Clone and patch (section 1.1). Build the three environments (sections 1.2, 1.3 and 5.1). Download the assets and record their hashes (section 1.4).
2. **Smoke test, before Experiment 1 step 0:** binarize 20 clips, train 300 steps, kill the run, resume it, run `infer.py acoustic` on one `.ds`, export in `ds-export`, and render the same `.ds` through onnxruntime. This catches section 0, items 2 and 3, early.
3. Experiment 1 steps 2, 1 and 3: alignment (section 5.1), the CSV (section 2), and the dictionary with its coverage table.
4. Step 0 profiling (section 3.3), then train (section 3.4), choose a checkpoint (section 3.5) and render (section 3.6).
5. Later: Stage 1b variance (section 6), M3 two speakers (section 2.6), the own vocoder (section 4.2), and ONNX (sections 3.7 and 3.8).

---

## 9. Sources (all read 2026-10-22)

- openvpi/DiffSinger, tag v2.5.1 (commit 323a569, 2026-01-08): `README.md`, `docs/GettingStarted.md`, `docs/BestPractices.md`, `docs/ConfigurationSchemas.md`, `configs/base.yaml`, `configs/acoustic.yaml`, `configs/templates/config_acoustic.yaml`, `configs/templates/config_variance.yaml`, `requirements.txt`, `requirements-onnx.txt`, `preprocessing/*.py`, `basics/base_binarizer.py`, `basics/base_task.py`, `utils/phoneme_utils.py`, `utils/hparams.py`, `utils/binarizer_utils.py`, `utils/training_utils.py`, `utils/decomposed_waveform.py`, `inference/ds_acoustic.py`, `inference/ds_variance.py`, `scripts/infer.py`, `scripts/export.py`, `deployment/exporters/*.py`, `samples/*.ds`. https://github.com/openvpi/DiffSinger/tree/v2.5.1
- DiffSinger release notes v2.5.1: https://github.com/openvpi/DiffSinger/releases/tag/v2.5.1
- DiffSinger `main` (HEAD 76b75de, 2026-10-16): commits 920ba91 (2026-01-12), 8a07f76 / PR #313 (2026-08-04), 2a8a013 / PR #305 (2026-06-21), and the `GettingStarted.md` diff (Python ≥ 3.10, torch ≥ 2.4 on main). https://github.com/openvpi/DiffSinger
- DiffSinger issues #336, #319, #291, #284, #273, #260, #258, #257, #243, #226 and #211: https://github.com/openvpi/DiffSinger/issues
- openvpi/MakeDiffSinger (HEAD 1edcd66, 2026-03-11): `acoustic_forced_alignment/README.md`, `build_dataset.py`, `enhance_tg.py`, `requirements.txt`; `variance-temp-solution/README.md`. https://github.com/openvpi/MakeDiffSinger
- openvpi/SingingVocoders (HEAD 4d0889c, 2026-03-08): `README.md`, `README_en.md`, `configs/base.yaml`, `configs/base_hifi.yaml`, `configs/ft_hifigan.yaml`, `export_ckpt.py`, `utils/wav2F0.py`. https://github.com/openvpi/SingingVocoders
- openvpi/vocoders releases (pc-nsf-hifigan 2025.02 specs and licence): https://github.com/openvpi/vocoders/releases
- RMVPE checkpoint release 230917: https://github.com/yxlllc/RMVPE/releases. VR hnsep_240512: https://github.com/yxlllc/vocal-remover/releases
- Montreal Forced Aligner 3.x docs, "Train a new acoustic model" (usage and options) and the v3.4.0 workflow page: https://montreal-forced-aligner.readthedocs.io/en/stable/user_guide/workflows/train_acoustic_model.html
- wolfgitpr/HubertFA README and configs (HEAD b3f0869, 2026-03-19): https://github.com/wolfgitpr/HubertFA
- uv PyTorch integration guide: https://docs.astral.sh/uv/guides/integration/pytorch/
- PyPI wheel lists for torch 1.13.1, pyworld 0.3.4, onnxsim 0.4.36, onnx 1.16.2, praat-parselmouth 0.4.3, lightning 2.3.x: https://pypi.org/. PyTorch cu126 wheel index: https://download.pytorch.org/whl/cu126/torch/
- OpenUtau wiki, "Singer Settings and Requirements". It does not document the DiffSinger voicebank layout, so nothing here depends on OpenUtau: https://github.com/openutau/OpenUtau/wiki/Singer-Settings-and-Requirements
