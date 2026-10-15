"""Render many SoulX-Singer target metadata files with one model load (renderer ladder step 2).

Driven by scripts/trope-render.mjs, which writes the jobs file:
  python soulx_runner.py jobs.json
jobs.json = { repo, model, config, phoneset, prompt_wav, prompt_meta, device, fp16,
              jobs: [{ meta, wav }], concat: { out, gap } | null }

Loading the 2.8 GB checkpoint takes ~12 s and SoulX's own CLI loads it per call, so this keeps the model
resident and calls the CLI's own process() per verse: the inference path stays exactly the one the
feasibility run measured (score control, no auto_shift, pitch_shift 0). One line per verse goes to
stdout as "@@ {json}" for the Node side to build the manifest; a verse that fails is reported and skipped.
"""
import json
import os
import shutil
import sys
import tempfile
import time
import traceback


def emit(obj):
    print("@@ " + json.dumps(obj), flush=True)


class Ctx:
    """The loaded model plus the argument bag SoulX's process() reads; built once, reused per verse."""


def load(spec):
    """Load the checkpoint once. spec keys: repo, model, config, phoneset, prompt_wav, prompt_meta, device, fp16.
    Shared by the local CLI (main) and trope/modal_render.py, so both take the same inference path."""
    repo = spec["repo"]
    # SoulX's modules import as top-level packages (cli, soulxsinger) relative to the repo root.
    if repo not in sys.path:
        sys.path.insert(0, repo)
    os.chdir(repo)
    import torch
    from cli.inference import build_model
    from soulxsinger.utils.file_utils import load_config

    a = Ctx()
    a.device = spec.get("device", "cuda")
    a.model_path = spec["model"]
    a.config = spec["config"]
    a.phoneset_path = spec["phoneset"]
    a.prompt_wav_path = spec["prompt_wav"]
    a.prompt_metadata_path = spec["prompt_meta"]
    a.auto_shift = False
    a.pitch_shift = 0
    a.control = "score"
    a.use_fp16 = bool(spec.get("fp16", True))
    a.cfg = load_config(a.config)

    t0 = time.time()
    a.model = build_model(a.model_path, a.cfg, device=a.device, use_fp16=a.use_fp16)
    emit({"event": "loaded", "load_s": round(time.time() - t0, 1)})
    if a.device.startswith("cuda"):
        torch.cuda.reset_peak_memory_stats()
    return a


def render_one(a, meta_path, wav_path):
    """Render one target metadata file to wav_path; returns (seconds of audio, wall seconds). Raises on failure."""
    import soundfile as sf
    from cli.inference import process

    t1 = time.time()
    tmp = tempfile.mkdtemp(prefix="soulx_")
    try:
        a.target_metadata_path = meta_path
        a.save_dir = tmp
        process(a, a.cfg, a.model)
        d = os.path.dirname(wav_path)
        if d:
            os.makedirs(d, exist_ok=True)
        shutil.move(os.path.join(tmp, "generated.wav"), wav_path)
        return sf.info(wav_path).duration, time.time() - t1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(jobs_path):
    with open(jobs_path, encoding="utf-8") as f:
        spec = json.load(f)
    import soundfile as sf
    import numpy as np
    import torch

    a = load(spec)

    done = []
    for i, job in enumerate(spec["jobs"]):
        t1 = time.time()
        try:
            dur, wall = render_one(a, job["meta"], job["wav"])
            done.append(job["wav"])
            emit({"event": "verse", "i": i, "wav": job["wav"], "seconds": round(dur, 3),
                  "render_s": round(time.time() - t1, 1)})
        except Exception as e:  # keep going: one bad verse must not cost the other 24
            traceback.print_exc()
            emit({"event": "verse", "i": i, "wav": None, "error": f"{type(e).__name__}: {e}",
                  "render_s": round(time.time() - t1, 1)})

    if a.device.startswith("cuda"):
        emit({"event": "memory", "peak_allocated_mb": round(torch.cuda.max_memory_allocated() / 2**20),
              "peak_reserved_mb": round(torch.cuda.max_memory_reserved() / 2**20)})

    concat = spec.get("concat")
    if concat and done:
        # The whole reading as one file: verse WAVs in order with a short silence between them.
        parts, sr = [], None
        for w in done:
            y, r = sf.read(w, dtype="float32")
            if sr is None:
                sr = r
            if r != sr:
                raise ValueError(f"{w}: sample rate {r} != {sr}")
            parts.append(y if y.ndim == 1 else y.mean(axis=1))
            parts.append(np.zeros(int(sr * float(concat.get("gap", 0.6))), dtype=np.float32))
        full = np.concatenate(parts[:-1])
        sf.write(concat["out"], full, sr)
        emit({"event": "concat", "wav": concat["out"], "seconds": round(len(full) / sr, 3), "verses": len(done)})


if __name__ == "__main__":
    main(sys.argv[1])
