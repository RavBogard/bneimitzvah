r"""Legato proxy for a trope-render folder: silent gaps inside phrases.

  <soulx-env>\venv\Scripts\python trope/gap_check.py <render_dir> [--detail]

Per verse WAV: 10 ms frames, RMS in dB relative to the verse's 95th-percentile frame; a frame under
-35 dB is silent. A run of silent frames of 50 ms or more between the first and last sounding frame is a
gap. A gap that overlaps a planned rest of 150 ms or more in the verse's metadata (a phrase-break breath,
the rest after sof pasuk) is a phrase break; any other gap is inside a phrase: a word gap, a stop closure
the model held too long, or a dropout. Legato chant should have about none.
Also reports peak dBFS and the share of frames inside phrases (outside planned rests) that sound.
"""
import json, os, sys
import numpy as np, soundfile as sf

FRAME = 0.010
SILENT_DB = -35.0
MIN_GAP = 0.050
PHRASE_REST = 0.150


def planned_rests(meta_json):
    out = []
    for seg in json.load(open(meta_json, encoding="utf-8")):
        t = seg["time"][0] / 1000
        for d, ph in zip(map(float, seg["duration"].split()), seg["phoneme"].split()):
            if ph == "<SP>" and d >= PHRASE_REST:
                out.append((t, t + d))
            t += d
    return out


def check(wav, meta_json, detail=False):
    y, sr = sf.read(wav)
    if y.ndim > 1:
        y = y.mean(1)
    hop = int(sr * FRAME)
    n = len(y) // hop
    rms = np.sqrt(np.mean(y[:n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    db -= np.percentile(db, 95)
    loud = db >= SILENT_DB
    idx = np.flatnonzero(loud)
    rests = planned_rests(meta_json)
    inside, breaks = [], []
    if len(idx):
        first, last = idx[0], idx[-1]
        k = first
        while k <= last:
            if not loud[k]:
                j = k
                while j <= last and not loud[j]:
                    j += 1
                a, b = k * FRAME, j * FRAME
                if b - a >= MIN_GAP:
                    (breaks if any(a < rb and b > ra for ra, rb in rests) else inside).append((round(a, 2), round(b - a, 3)))
                k = j
            else:
                k += 1
    t = np.arange(n) * FRAME
    in_phrase = np.ones(n, bool)
    for ra, rb in rests:
        in_phrase &= ~((t >= ra) & (t < rb))
    if len(idx):
        in_phrase &= (np.arange(n) >= idx[0]) & (np.arange(n) <= idx[-1])
    if detail:
        for a, d in inside:
            print(f"    gap at {a:6.2f}s  {d * 1000:4.0f} ms")
    return {"inside": len(inside), "inside_s": round(sum(d for _, d in inside), 3), "breaks": len(breaks),
            "sounding": float(loud[in_phrase].mean()) if in_phrase.any() else None,
            "peak_dbfs": float(20 * np.log10(np.max(np.abs(y)) + 1e-9)), "seconds": len(y) / sr}


if __name__ == "__main__":
    root = sys.argv[1]
    detail = "--detail" in sys.argv
    man = json.load(open(os.path.join(root, "manifest.json"), encoding="utf-8"))
    tot = {"inside": 0, "inside_s": 0.0, "breaks": 0}
    for i, v in enumerate(man["verses"], 1):
        if not v.get("wav"):
            continue
        r = check(v["wav"], v["json"], detail)
        for k in tot:
            tot[k] += r[k]
        print(f"{i:2d} {v['ref']:<16} gaps inside phrases {r['inside']:3d} ({r['inside_s']:.2f}s)  phrase breaks {r['breaks']:2d}  "
              f"sounding {100 * r['sounding']:.1f}%  peak {r['peak_dbfs']:.1f} dBFS  {r['seconds']:.2f}s")
    print(f"total gaps inside phrases {tot['inside']} ({tot['inside_s']:.2f}s), phrase breaks {tot['breaks']}")
