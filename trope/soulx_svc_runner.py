r"""SoulX-Singer-SVC over a list of jobs, one model load (stage (c) of voice-quality.md path 1).

  <soulx-env>\venv\Scripts\python trope/soulx_svc_runner.py <jobs.json>      (cwd and PYTHONPATH = the SoulX clone)

jobs.json (scripts/trope-speech2sing.mjs writes it):
  { "repo", "model": model-svc.pt, "prompt_wav", "device": "cuda"|"cpu", "fp16", "n_steps", "cfg",
    "jobs": [ { "wav": source speech (24 kHz), "f0": target f0 .npy (50 fps, 0 = unvoiced),
                "prompt_f0": prompt f0 .npy, "out": sung wav } ] }
No auto pitch shift: the target f0 is the score's, in the key asked for. The content encoder is Whisper-base
(downloaded by transformers on first use into the Hugging Face cache).
"""
import json, os, sys, time



def main():
    sys.stdout.reconfigure(encoding="utf-8")
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    if not spec.get("device", "cuda").startswith("cuda"):
        # SoulX's WhisperEncoder moves itself to CUDA when it can see a GPU, whatever device the model is on:
        # hide the GPU so a CPU render never takes GPU memory from another job.
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"   # not "": Windows drops an empty variable
    import numpy as np
    import soundfile as sf
    import torch
    sys.path.insert(0, spec["repo"])
    from soulxsinger.utils.file_utils import load_config
    from soulxsinger.utils.audio_utils import load_wav
    from cli.inference_svc import build_model
    config = load_config(os.path.join(spec["repo"], "soulxsinger", "config", "soulxsinger.yaml"))
    dev = spec.get("device", "cuda")
    fp16 = bool(spec.get("fp16")) and dev.startswith("cuda")
    t0 = time.time()
    model = build_model(spec["model"], config, device=dev, use_fp16=fp16)
    print(json.dumps({"event": "loaded", "seconds": round(time.time() - t0, 1)}), flush=True)
    sr = config.audio.sample_rate
    pt_wav = load_wav(spec["prompt_wav"], sr).to(dev)
    if dev.startswith("cuda"):
        torch.cuda.reset_peak_memory_stats()
    for job in spec["jobs"]:
        t1 = time.time()
        gt_wav = load_wav(job["wav"], sr).to(dev)
        pt_f0 = torch.from_numpy(np.load(job["prompt_f0"]).astype(np.float32)).unsqueeze(0).to(dev)
        gt_f0 = torch.from_numpy(np.load(job["f0"]).astype(np.float32)).unsqueeze(0).to(dev)
        with torch.no_grad():
            audio, _ = model.infer(pt_wav=pt_wav, gt_wav=gt_wav, pt_f0=pt_f0, gt_f0=gt_f0, auto_shift=False, pitch_shift=0,
                                   n_steps=int(spec.get("n_steps", 32)), cfg=float(spec.get("cfg", 3)), use_fp16=fp16)
        y = audio.squeeze().float().cpu().numpy()
        sf.write(job["out"], y, sr)
        ev = {"event": "done", "out": job["out"], "seconds": round(len(y) / sr, 2), "render_seconds": round(time.time() - t1, 1)}
        if dev.startswith("cuda"):
            ev["peak_allocated_mb"] = round(torch.cuda.max_memory_allocated() / 2**20)
        print(json.dumps(ev), flush=True)


if __name__ == "__main__":
    main()
