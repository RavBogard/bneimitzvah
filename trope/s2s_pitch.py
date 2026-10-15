r"""Pitch check of a sung render against its speech-to-singing plan (trope/speech2sing.mjs): pyin over each note,
median voiced f0 in MIDI vs the score note, skipping the first 40 ms and last 20 ms of the note.

  <tts-env>\venv\Scripts\python trope/s2s_pitch.py <plan.json> <render.wav> [--offset 0] [--json out.json]

Prints notes within +/-0.5 semitone of the score, median and max |error|, and the voiced share per note; also a
smoothness proxy: the share of 20 ms frames under -45 dBFS inside phrases (gaps the ear hears as chopping).
"""
import argparse, json, sys

import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan"); ap.add_argument("wav")
    ap.add_argument("--offset", type=float, default=0.0, help="seconds to add to the plan's times")
    ap.add_argument("--json")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    import librosa, soundfile as sf
    plan = json.load(open(a.plan, encoding="utf-8"))
    y, sr = sf.read(a.wav, dtype="float32")
    if y.ndim > 1:
        y = y.mean(1)
    hop = 256
    f0, vflag, _ = librosa.pyin(y, fmin=70, fmax=600, sr=sr, frame_length=2048, hop_length=hop)
    times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop)
    rows = []
    for n in plan["notes"]:
        if n["rest"]:
            continue
        a0, a1 = n["t"] + a.offset + 0.04, n["t"] + a.offset + n["dur"] - 0.02
        m = (times >= a0) & (times < a1)
        v = m & vflag & np.isfinite(f0)
        rows.append({"t": n["t"], "midi": n["midi"], "voiced": round(float(v.sum() / max(1, m.sum())), 2),
                     "sung": round(float(np.median(librosa.hz_to_midi(f0[v]))), 2) if v.sum() else None})
    errs = [abs(r["sung"] - r["midi"]) for r in rows if r["sung"] is not None]
    within = sum(e <= 0.5 for e in errs)
    # gaps inside phrases
    fr = int(0.02 * sr)
    gaps = tot = 0
    for p in plan["phrases"]:
        s0, s1 = int((p["start"] + a.offset) * sr), int((p["end"] + a.offset) * sr)
        seg = y[s0:s1]
        for k in range(0, len(seg) - fr, fr):
            rms = np.sqrt(np.mean(seg[k:k + fr] ** 2)) + 1e-9
            tot += 1
            gaps += 20 * np.log10(rms) < -45
    out = {"wav": a.wav, "notes": len(rows), "pitched": len(errs), "within_half_semitone": within,
           "median_abs_st": round(float(np.median(errs)), 3) if errs else None, "max_abs_st": round(float(max(errs)), 3) if errs else None,
           "gap_share_in_phrases": round(gaps / max(1, tot), 3), "rows": rows}
    print(f"{a.wav}: {within}/{len(rows)} notes within 0.5 st (pitched {len(errs)}), median |err| {out['median_abs_st']} st, "
          f"max {out['max_abs_st']} st; frames under -45 dBFS inside phrases {out['gap_share_in_phrases']:.1%}")
    if a.json:
        json.dump(out, open(a.json, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
