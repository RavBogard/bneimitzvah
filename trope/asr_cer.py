r"""Intelligibility proxy for a trope-render folder: transcribe each verse WAV with Whisper (faster-whisper,
CPU, language "he") and score it against the verse's unpointed Masoretic text.

  <asr-env>\Scripts\python trope/asr_cer.py <render_dir> <ref-text.json> [--model NAME] [--json out.json]

ref-text.json maps "Book c:v" -> unpointed Hebrew (letters and spaces). Runs in its own venv
(C:\Users\dsbog\haftarah-audio\asr-env: faster-whisper), never the SoulX venv, whose pins are tight.

Scores, per verse and pooled over the folder (edit distance / reference length):
- cer: letters, spaces removed, final forms folded (ך->כ ...);
- skel: the same with ו and י removed from both sides, because modern Hebrew ASR writes plene spelling
  (חודש for MAM's חדש, מאוד for מאד), which says nothing about how clearly the voice sang;
- wer: words, final forms folded.
The divine name is read as Adonai, so יהוה in the reference becomes אדני (skeleton: אדנ) before scoring.
A model that has never heard sung Hebrew through an English phone set scores high CERs in absolute terms;
the number is for comparing renders of the same verses, not for judging one alone.
"""
import json, os, re, sys, time

FINALS = str.maketrans("ךםןףץ", "כמנפצ")


def norm(s):
    s = re.sub(r"[\u0591-\u05C7]", "", s)
    s = s.replace("יהוה", "אדני")
    s = re.sub(r"[^\u05D0-\u05EA ]", " ", s)
    return re.sub(r"\s+", " ", s).strip().translate(FINALS)


def edits(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def scores(ref, hyp):
    r, h = norm(ref), norm(hyp)
    rc, hc = r.replace(" ", ""), h.replace(" ", "")
    rs, hs = re.sub("[וי]", "", rc), re.sub("[וי]", "", hc)
    return {"cer_e": edits(rc, hc), "cer_n": len(rc), "skel_e": edits(rs, hs), "skel_n": len(rs),
            "wer_e": edits(r.split(), h.split()), "wer_n": len(r.split())}


def load16k(path):
    """Mono float32 at 16 kHz, read with soundfile (faster-whisper's own PyAV decoder is skipped)."""
    import numpy as np, soundfile as sf
    from math import gcd
    from scipy.signal import resample_poly
    y, sr = sf.read(path, dtype="float32")
    if y.ndim > 1:
        y = y.mean(1)
    g = gcd(sr, 16000)
    return resample_poly(y, 16000 // g, sr // g).astype(np.float32)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    model_name = "ivrit-ai/whisper-large-v3-turbo-ct2"
    out_json = None
    if "--model" in args:
        i = args.index("--model"); model_name = args[i + 1]; del args[i:i + 2]
    if "--json" in args:
        i = args.index("--json"); out_json = args[i + 1]; del args[i:i + 2]
    root, ref_path = args[0], args[1]
    refs = json.load(open(ref_path, encoding="utf-8"))
    man = json.load(open(os.path.join(root, "manifest.json"), encoding="utf-8"))
    from faster_whisper import WhisperModel
    t0 = time.time()
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    load_s = time.time() - t0
    tot = {"cer_e": 0, "cer_n": 0, "skel_e": 0, "skel_n": 0, "wer_e": 0, "wer_n": 0}
    rows = []
    for v in man["verses"]:
        if not v.get("wav") or v["ref"] not in refs:
            continue
        t1 = time.time()
        segs, _ = model.transcribe(load16k(v["wav"]), language="he", beam_size=5, temperature=0.0,
                                   condition_on_previous_text=False, vad_filter=False)
        hyp = " ".join(s.text for s in segs).strip()
        sc = scores(refs[v["ref"]], hyp)
        for k in tot:
            tot[k] += sc[k]
        row = {"ref": v["ref"], "hyp": hyp, "cer": sc["cer_e"] / sc["cer_n"], "skel": sc["skel_e"] / sc["skel_n"],
               "wer": sc["wer_e"] / sc["wer_n"], "asr_s": round(time.time() - t1, 1)}
        rows.append(row)
        print(f"{v['ref']:<16} cer {row['cer']:.3f}  skel {row['skel']:.3f}  wer {row['wer']:.3f}  | {hyp}", flush=True)
    pooled = {"cer": tot["cer_e"] / max(1, tot["cer_n"]), "skel": tot["skel_e"] / max(1, tot["skel_n"]),
              "wer": tot["wer_e"] / max(1, tot["wer_n"])}
    print(f"pooled  cer {pooled['cer']:.3f}  skel {pooled['skel']:.3f}  wer {pooled['wer']:.3f}  "
          f"({len(rows)} verses, model {model_name}, load {load_s:.0f}s)")
    if out_json:
        json.dump({"model": model_name, "pooled": pooled, "verses": rows}, open(out_json, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
