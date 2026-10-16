"""Per-note pitch check of a trope-render output folder (the experiment's f0_check.py, extended to
multi-segment verses and many verses).

  venv\\Scripts\\python tools\\pitch_check.py <render_dir> [verse numbers, e.g. 1 4 12 20 25] [--detail]

For each verse: librosa.pyin (fmin 80, fmax 900, frame 2048, hop 256) on the WAV; per planned note window
(segment start + note offset, skipping the first 40 ms and last 20 ms) the median voiced f0 as MIDI,
compared with note_pitch. Reports notes within +/-0.5 semitone, median and max |error|.
"""
import json, os, sys
import numpy as np, librosa, soundfile as sf

def check(wav, meta_json, detail=False):
    y, sr = sf.read(wav)
    if y.ndim > 1:
        y = y.mean(1)
    f0, _, _ = librosa.pyin(y.astype(np.float32), fmin=80, fmax=900, sr=sr, frame_length=2048, hop_length=256)
    t = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=256)
    segs = json.load(open(meta_json, encoding="utf-8"))
    n = ok = unvoiced = 0
    errs = []
    for seg in segs:
        start = seg["time"][0] / 1000
        for d, p, ph in zip(map(float, seg["duration"].split()), map(int, seg["note_pitch"].split()), seg["phoneme"].split()):
            t0, t1 = start, start + d
            start = t1
            if p == 0:
                continue
            sel = (t >= t0 + 0.04) & (t < t1 - 0.02)
            v = f0[sel]
            v = v[~np.isnan(v)]
            n += 1
            if len(v) < 2:
                unvoiced += 1
                if detail:
                    print(f"  {t0:6.2f} {ph:<16} {p:3d} unvoiced")
                continue
            m = float(np.median(librosa.hz_to_midi(v)))
            errs.append(abs(m - p))
            ok += abs(m - p) <= 0.5
            if detail:
                print(f"  {t0:6.2f} {ph:<16} {p:3d} {m:6.2f} {m - p:+.2f}")
    return {"notes": n, "within": ok, "unvoiced": unvoiced,
            "median": float(np.median(errs)) if errs else None, "max": float(np.max(errs)) if errs else None,
            "seconds": len(y) / sr, "peak_dbfs": float(20 * np.log10(np.max(np.abs(y)) + 1e-9))}

if __name__ == "__main__":
    root = sys.argv[1]
    detail = "--detail" in sys.argv
    pick = {int(x) for x in sys.argv[2:] if x.isdigit()}
    man = json.load(open(os.path.join(root, "manifest.json"), encoding="utf-8"))
    tot_n = tot_ok = 0
    for i, v in enumerate(man["verses"], 1):
        if (pick and i not in pick) or not v.get("wav"):
            continue
        r = check(v["wav"], v["json"], detail)
        tot_n += r["notes"]; tot_ok += r["within"]
        print(f"{i:2d} {v['ref']:<16} {r['within']:3d}/{r['notes']:3d} within 0.5 st  median {r['median']:.2f}  max {r['max']:.2f}  "
              f"unvoiced {r['unvoiced']}  {r['seconds']:.2f}s  peak {r['peak_dbfs']:.1f} dBFS  segments {v['segments']}")
    print(f"total {tot_ok}/{tot_n} ({100 * tot_ok / max(1, tot_n):.1f}%) pitched notes within +/-0.5 semitone")
