# Trope engine: cloud rendering on Modal

Status: built, not yet run against a real account (Daniel has no Modal account yet). Ruling: render in the cloud on Modal (pay-per-second GPUs); the local GTX 1660 Ti stays the default and the fallback.

## What was built

| Piece | File | Role |
|---|---|---|
| Shared inference | `trope/soulx_runner.py` | `load(spec)` and `render_one(ctx, meta, wav)` are the whole inference path (score control, no auto_shift, pitch_shift 0, fp16). The local CLI (`main`) and Modal both call them; local behaviour and its `@@` event output are unchanged. |
| Modal app | `trope/modal_render.py` | App `haftarah-soulx`. Image: Debian slim, Python 3.12, torch 2.2.0 / torchaudio 2.2.0 from the cu121 index, the other packages pinned as in `soulx-env\requirements.lock.txt`, SoulX-Singer cloned at commit `81aeb3ae772c70093c3de74dc23c92d983801ae4` (verified with `rev-parse` during the build). Weights: `download_weights` pulls `model.pt` (2,818,092,278 bytes) from Hugging Face into the private Volume `soulx-singer-weights`; they are not in the image. `Renderer` class: one resident model per GPU container; `render(call)` takes a few verses (metadata JSON text, prompt wav bytes, prompt meta text) and returns WAV bytes. The `render` local entrypoint fans calls out with `.map()`. |
| CLI wiring | `scripts/trope-render.mjs`, `trope/render-cli.mjs`, `trope/wav.mjs` | `--backend modal` writes the same per-verse JSON and `jobs.json`, runs `modal run trope/modal_render.py::render --jobs jobs.json`, reads `@@ {json}` events in the local runner's format, writes `<NN>-<ref>.wav`, joins the full reading in Node (`wav.mjs`, no Python) and writes `manifest.json` (with a `modal` block in place of `model`/`env`). |
| Tests | `tests/trope-render-cli.test.mjs` | Argument handling, modal CLI discovery, invocation, WAV join. No network, no account. |

Knobs: `--gpu` (default `L4`; also `A10`, `L40S`, `A100-40GB`, `A100-80GB`, `T4`), `--max-containers` (default 10, the concurrency cap), `--per-call` (verses per GPU call, default 3), `--no-fp16` (the default is fp16, matching local). They reach the app as `SOULX_MODAL_GPU`, `SOULX_MODAL_CONCURRENCY` and `SOULX_MODAL_FP16`, because Modal reads GPU type and concurrency at decoration time. bf16 would also work on these GPUs but is not used, so cloud and local renders differ only by GPU numerics.

`--per-call` trades parallelism against model load: every container loads the 2.8 GB checkpoint (about 12 s locally; the first load in a container also reads the volume). 3 is a compromise; 1 maximizes parallelism for short jobs; 6 or more is cheaper for a whole cycle.

## Batch mode

Same command, more readings, one fan-out across all of them:

```bash
node scripts/trope-render.mjs --backend modal --refs "I Samuel 20:18-42;Isaiah 54:1-10"
node scripts/trope-render.mjs --backend modal --refs-file refs.txt        # one ref per line, # comments
node scripts/trope-render.mjs --backend modal --year 2027                 # every Shabbat/holiday haftarah Hebcal lists
```

Each reading goes to `<out>/<ref-slug>/` with its own `manifest.json` and `<slug>-full.wav`; `<out>/batch.json` summarizes. `--year` calls `readingFor({ date })` for each Saturday, collects `haftarah.refs` and dedupes. It covers haftarot only; Torah ranges can be added through `--refs-file`. `--year` needs Hebcal and was not run. Add `--dry-run` to see the plan and the exact `modal run` command with no GPU spend. The local backend also accepts batches (one Python process, so one model load, per reading).

## One-time setup for Daniel

1. Create an account at https://modal.com (Starter plan: $0 plus compute, $30 per month free credit). In workspace settings, set a monthly spend limit.
2. Install the CLI in its own venv, not in `soulx-env` (the SoulX pins are tight and Modal brings its own dependencies):

   ```powershell
   py -3.12 -m venv C:\Users\dsbog\haftarah-audio\modal-env
   C:\Users\dsbog\haftarah-audio\modal-env\Scripts\python.exe -m pip install modal
   C:\Users\dsbog\haftarah-audio\modal-env\Scripts\modal.exe token new
   ```

   `token new` opens a browser and stores the token in `~\.modal.toml`. `trope-render.mjs` finds `modal` via `--modal <exe>`, `HAFTARAH_MODAL`, `HAFTARAH_MODAL_ENV`, `C:\Users\dsbog\haftarah-audio\modal-env`, then PATH.
3. Optional pre-fetch of the weights (otherwise the first render does it: 2.8 GB, a few minutes, CPU-only pennies). Run from the repo:

   ```powershell
   C:\Users\dsbog\haftarah-audio\modal-env\Scripts\modal.exe run trope\modal_render.py::download_weights
   ```
4. Smoke test (one verse; the first run builds the image, which takes several minutes and is then cached):

   ```powershell
   node scripts/trope-render.mjs --ref "I Samuel 20:18" --backend modal --out C:\Users\dsbog\haftarah-audio\renders\modal-smoke
   ```

   Compare it with the local render of the same verse (`tools\pitch_check.py` in `soulx-env`). Then render a whole haftarah and read `renderSeconds` in the manifest and the `plan` and `remote_wall` lines in the log, and replace the estimates below with measurements.

The default prompt is SoulX's example clip, which lives in the local SoulX clone, so keep `soulx-env\SoulX-Singer` or pass `--prompt <wav> --prompt-meta <json>`. The default is internal-test-only, as before.

## Cost (estimates)

Prices from https://modal.com/pricing, read 2026-10-15, per second: T4 $0.000164, L4 $0.000222, A10 $0.000306, L40S $0.000542, A100 40 GB $0.000583, A100 80 GB $0.000694, H100 $0.001097; CPU $0.0000131 per core-second and memory $0.00000222 per GiB-second (about 1 percent extra on a GPU container). Check the page again before a big run.

Measured locally: GTX 1660 Ti, fp16, 86 to 104 s per 14 to 17 s verse (about 6x slower than real time). **The cloud speedups are not measured.** Assumptions: the 1660 Ti has no tensor cores, so an L4 (Ada, 24 GB) should be about 5x faster, an A10 (A10G, Ampere) about 6.5x, an A100 about 11x. Small-batch diffusion does not scale with peak TFLOPs, so these sit well below spec-sheet ratios. Per 15 s verse, including a share of model load and cold start (about 25 s per call, split over 3 verses on an L4):

| GPU | Render per 15 s verse | GPU-seconds per verse with overhead | $ per verse | One 30-verse haftarah | Full cycle, 7,700 verses | Wall time for the cycle at 10 / 50 containers |
|---|---|---|---|---|---|---|
| Local 1660 Ti | 95 s | 95 | 0 (electricity) | 48 min | about 203 h | not applicable |
| L4 | about 19 s | about 27 | $0.006 | $0.18 | about $46 | 6 h / 1.2 h |
| A10 | about 15 s | about 22 | $0.0067 | $0.20 | about $52 | 4.9 h / 1 h |
| A100 40 GB | about 8 s | about 15 | $0.0087 | $0.26 | about $67 | 3.3 h / 40 min |

Per-second billing makes the cheapest GPU per verse the one that is just fast enough, so **L4 is the default**; an A100 buys wall time, not savings. Expect a factor of 2 error either way, mostly from the speedup assumption and cold-start time. The $30 monthly free credit covers roughly 150 haftarot, or about two thirds of a cycle, on an L4. One haftarah costs about 20 cents, so the first step is to render one and replace these numbers. Failed verses and retries (`retries=1` per call) cost extra.

## Safety

- The checkpoint is downloaded from Hugging Face into a private Volume in Daniel's Modal workspace. It is not in the image, not in the repo and not served publicly. The app has no web endpoint; the only way to call it is `modal run` with his token.
- Metadata and the prompt wav go to the container as call arguments for the length of the call and are not written to the volume. Rendered WAVs return to the machine running the command and land in the local `renders` folder; nothing but the weights stays in Modal.
- Modal does see what is sent to it: the notes and phonemes, and the prompt voice sample. If the prompt is a real person's voice (the published prompt will be), that audio is processed on Modal's infrastructure under his account. Keep the commercial example prompt for tests only, as before.
- `~\.modal.toml` holds the token; it is not in the repo.

## Not verified without an account

Image build (pip resolution of the pins on Linux, the git checkout), the Hugging Face download, the volume mount, GPU class start-up, `.map()` behaviour and event output on a real run, the L4 and A10 speedups, and Windows console output from `modal run`. The app module imports and its decorators construct under modal 1.6.1, and `modal run trope/modal_render.py::render --help` lists `--jobs`, `--per-call` and `--no-fp16`.
