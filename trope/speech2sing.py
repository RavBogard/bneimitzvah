r"""Speech-to-singing, stages (a) and (b) of voice-quality.md path 1: Phonikud-TTS (Piper/VITS, ONNX, CPU) speaks
each phrase of a plan from trope/speech2sing.mjs, then speaks it again with the score's durations imposed inside
the model, and writes the f0 file SoulX-Singer-SVC re-sings it with.

  <tts-env>\Scripts\python trope/speech2sing.py <plan.json> <out_dir> --model michael.onnx --config model.config.json
      [--prompt-meta prompt.json] [--noise 0.333] [--noise-w 0.8] [--length 1] [--max-cons 0.6] [--stretch world|none]

Durations inside the TTS: a Piper ONNX graph computes w_ceil (frames per input id, 22050 Hz / hop 256 =
11.6 ms) in its /Ceil node. We derive two graphs from the voice once, next to it: *.dur.onnx (also outputs
w_ceil) and *.timed.onnx (takes w_ceil as an input instead). So vowels are generated long by the decoder
rather than stretched afterwards, and every syllable boundary is known to the frame: no forced aligner.

Timing rule (a singer's): the vowel starts on the note. Between two vowel onsets sit vowel k, its coda and the
next syllable's onset consonants; the consonants keep their spoken length (scaled down only if they would take
more than --max-cons of the span) and the vowel takes the rest. A phrase's first onset is spoken before its
first note, in the preceding rest.

Writes (sample rate 22050 for speech, 24000 for what SVC reads):
  01-raw-tts.wav          the phrases as Phonikud speaks them, 0.3 s apart (stage a)
  02-timed-speech.wav     the phrases re-spoken on the score's timeline (stage b), 22.05 kHz
  02-timed-speech-24k.wav the same at 24 kHz (SVC input)
  02-world-stretch.wav    with --stretch world: the raw speech time-warped to the same timeline by WORLD
                          (vowel frames stretched, consonants kept), the after-the-fact alternative
  target_f0.npy           50 frames/s, the score's f0 (trope/speech2sing.mjs scoreF0, in the plan as f0)
                          with the voiceless consonants zeroed, as SoulX-SVC reads it
  prompt_f0.npy           the prompt's f0 from its SoulX metadata (scripts/trope-prompt.mjs), with --prompt-meta
  align.json              per phrase and syllable: vowel onset/offset in s on the timeline, natural vs imposed frames
"""
import argparse, json, math, os, sys, time

import numpy as np
import soundfile as sf

SR = 22050
HOP = 256
FPS = SR / HOP
VOICELESS = set("ptkfsʃχhʔ")   # Phonikud characters (ts is t + s)


def derive_models(path):
    """Build <voice>.dur.onnx (extra output w_ceil) and <voice>.timed.onnx (w_ceil as an input) once."""
    import onnx
    base = os.path.splitext(path)[0]
    dur_p, timed_p = base + ".dur.onnx", base + ".timed.onnx"
    if os.path.exists(dur_p) and os.path.exists(timed_p):
        return dur_p, timed_p
    m = onnx.load(path)
    ceil = [n for n in m.graph.node if n.op_type == "Ceil"]
    if len(ceil) != 1:
        raise SystemExit(f"expected one Ceil node in {path}, found {len(ceil)}")
    w = ceil[0].output[0]
    d = onnx.load(path)
    d.graph.output.append(onnx.helper.make_tensor_value_info(w, onnx.TensorProto.FLOAT, ["batch", 1, "phonemes"]))
    onnx.save(d, dur_p)
    t = onnx.load(path)
    for n in t.graph.node:
        for i, x in enumerate(n.input):
            if x == w:
                n.input[i] = "w_ceil"
    t.graph.input.append(onnx.helper.make_tensor_value_info("w_ceil", onnx.TensorProto.FLOAT, ["batch", 1, "phonemes"]))
    t.graph.node.remove([n for n in t.graph.node if n.op_type == "Ceil"][0])
    onnx.save(t, timed_p)
    return dur_p, timed_p


def phrase_ids(phrase, id_map):
    """Piper input ids (^ _ p _ p _ ... $) and, per id, (syllable index, role, char). Roles: bos, eos, onset,
    vowel, coda, space; a pad takes its phoneme's role. The stress mark belongs to the vowel."""
    ids, own = [], []

    def add(ch, si, role):
        if ch not in id_map:
            raise SystemExit(f"Phonikud-TTS has no symbol {ch!r} (phrase {phrase['text']})")
        ids.extend(id_map[ch]); own.extend([(si, role, ch)] * len(id_map[ch]))
        ids.extend(id_map["_"]); own.append((si, role, ch))

    add("^", -1, "bos")
    for si, s in enumerate(phrase["syllables"]):
        if si and s["wordStart"]:
            add(" ", si - 1, "space")
        for c in "".join(s["onset"]):
            add(c, si, "onset")
        if s["stressed"]:
            add("ˈ", si, "vowel")
        for c in "".join(s["vowel"]):
            add(c, si, "vowel")
        for c in "".join(s["coda"]):
            add(c, si, "coda")
    ids.extend(id_map["$"]); own.append((len(phrase["syllables"]) - 1, "eos", "$"))
    return ids, own


def spread(total, weights):
    """Integer split of total proportional to weights (largest remainder); all-zero weights split evenly."""
    w = np.asarray(weights, dtype=float)
    if total <= 0 or len(w) == 0:
        return [0] * len(w)
    if w.sum() <= 0:
        w = np.ones_like(w)
    raw = w / w.sum() * total
    out = np.floor(raw).astype(int)
    for i in np.argsort(-(raw - out))[: total - out.sum()]:
        out[i] += 1
    return out.tolist()


def impose(phrase, own, nat, max_cons):
    """Natural frames per id -> imposed frames, and the frame where the phrase's first vowel starts."""
    syls = phrase["syllables"]
    n = len(syls)
    bound = [round(s["t"] * FPS) for s in syls] + [round((syls[-1]["t"] + syls[-1]["dur"]) * FPS)]
    out = [0] * len(own)
    idx = lambda si, roles: [i for i, (s, r, _) in enumerate(own) if s == si and r in roles]
    # the first syllable's onset keeps its spoken length, before the first note
    lead = idx(0, ("onset",))
    for i in lead:
        out[i] = int(nat[i])
    for k in range(n):
        span = bound[k + 1] - bound[k]
        vow = idx(k, ("vowel",))
        cons = idx(k, ("coda", "space")) + (idx(k + 1, ("onset",)) if k + 1 < n else idx(k, ("eos",)))
        c_nat = [int(nat[i]) for i in cons]
        cap = int(max_cons * span)
        c_new = c_nat if sum(c_nat) <= cap else spread(cap, c_nat)
        for i, f in zip(cons, c_new):
            out[i] = f
        v_tot = max(1, span - sum(c_new))
        for i, f in zip(vow, spread(v_tot, [nat[i] for i in vow])):
            out[i] = f
    return out, bound[0] - sum(out[i] for i in lead), bound


def run(sess, ids, scales, w_ceil=None):
    feed = {"input": np.array([ids], dtype=np.int64), "input_lengths": np.array([len(ids)], dtype=np.int64),
            "scales": np.array(scales, dtype=np.float32)}
    if w_ceil is not None:
        feed["w_ceil"] = np.array([[w_ceil]], dtype=np.float32)
    out = sess.run(None, feed)
    return [o.squeeze() for o in out]


def world_stretch(audio, own, nat, new, out_len):
    """The raw take, time-warped with WORLD so each id's natural frames span its imposed frames (consonants
    keep their length, so only vowels are stretched). Returns audio of out_len samples."""
    import pyworld as pw
    x = audio.astype(np.float64)
    period = HOP / SR * 1000
    f0, t = pw.harvest(x, SR, frame_period=period, f0_floor=60, f0_ceil=500)
    sp = pw.cheaptrick(x, f0, t, SR)
    ap = pw.d4c(x, f0, t, SR)
    src_edges = np.concatenate([[0], np.cumsum(nat)])
    dst_edges = np.concatenate([[0], np.cumsum(new)])
    T = int(dst_edges[-1])
    pos = np.interp(np.arange(T), dst_edges, src_edges)        # map each new frame to a source frame
    j = np.clip(np.round(pos).astype(int), 0, len(f0) - 1)
    y = pw.synthesize(np.ascontiguousarray(f0[j]), np.ascontiguousarray(sp[j]), np.ascontiguousarray(ap[j]), SR, frame_period=period)
    return y[:out_len].astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("out")
    ap.add_argument("--model", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--prompt-meta")
    ap.add_argument("--noise", type=float, default=0.333)   # 0.333 beat the voice default 0.667 on ASR (speech2sing-experiment.md)
    ap.add_argument("--noise-w", type=float, default=0.8)
    ap.add_argument("--length", type=float, default=1.0)
    ap.add_argument("--max-cons", type=float, default=0.6)
    ap.add_argument("--stretch", choices=["none", "world"], default="world")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    import onnxruntime as ort
    from scipy.signal import resample_poly

    plan = json.load(open(a.plan, encoding="utf-8"))
    cfg = json.load(open(a.config, encoding="utf-8"))
    id_map = cfg["phoneme_id_map"]
    dur_p, timed_p = derive_models(a.model)
    so = ort.SessionOptions(); so.log_severity_level = 3
    s_dur = ort.InferenceSession(dur_p, so, providers=["CPUExecutionProvider"])
    s_timed = ort.InferenceSession(timed_p, so, providers=["CPUExecutionProvider"])
    scales = [a.noise, a.length, a.noise_w]
    os.makedirs(a.out, exist_ok=True)

    total = int(math.ceil((plan["seconds"] + 0.5) * SR))
    timed = np.zeros(total, np.float32)
    warped = np.zeros(total, np.float32)
    voiceless = np.zeros(total, bool)
    covered = np.zeros(total, bool)
    raw_parts, report = [], []
    t0 = time.time()
    for pi, ph in enumerate(plan["phrases"]):
        ids, own = phrase_ids(ph, id_map)
        audio, w = run(s_dur, ids, scales)
        nat = np.asarray(w, dtype=float).reshape(-1)
        raw_parts += [audio.astype(np.float32), np.zeros(int(0.3 * SR), np.float32)]
        new, start_f, bound = impose(ph, own, nat, a.max_cons)
        y = run(s_timed, ids, scales, new)[0].astype(np.float32)
        s0 = start_f * HOP
        exp = sum(new) * HOP
        y = y[:exp]
        lo, hi = max(0, s0), min(total, s0 + len(y))
        timed[lo:hi] += y[lo - s0:hi - s0]
        if a.stretch == "world":
            yw = world_stretch(audio, own, nat, new, len(y))
            hi2 = min(total, s0 + len(yw))
            warped[lo:hi2] += yw[lo - s0:hi2 - s0]
        # voicing from the imposed frames: voiceless consonants (and their pads) are unvoiced
        f = start_f
        for (si, role, ch), n in zip(own, new):
            a0, a1 = max(0, f * HOP), min(total, (f + n) * HOP)
            if a1 > a0:
                covered[a0:a1] = role not in ("bos", "eos") or ch not in "^$"
                if ch in VOICELESS:
                    voiceless[a0:a1] = True
            f += n
        syl_rep = []
        for k, s in enumerate(ph["syllables"]):
            ii = [i for i, (si, r, _) in enumerate(own) if si == k and r == "vowel"]
            syl_rep.append({"he": s["he"], "t": s["t"], "dur": s["dur"], "vowel_frames_natural": int(sum(nat[i] for i in ii)),
                            "vowel_frames": int(sum(new[i] for i in ii))})
        report.append({"text": ph["text"], "start": ph["start"], "end": ph["end"], "audio_start": round(s0 / SR, 3),
                       "natural_s": round(float(nat.sum()) * HOP / SR, 3), "timed_s": round(sum(new) * HOP / SR, 3), "syllables": syl_rep})
        print(f"phrase {pi + 1}: {ph['text']}  natural {nat.sum() * HOP / SR:.2f}s -> timed {sum(new) * HOP / SR:.2f}s", flush=True)
    tts_s = time.time() - t0

    raw = np.concatenate(raw_parts)
    peak = max(1e-6, float(np.abs(timed).max()))
    g = 0.89 / peak   # about -1 dBFS
    sf.write(os.path.join(a.out, "01-raw-tts.wav"), raw * (0.89 / max(1e-6, float(np.abs(raw).max()))), SR)
    sf.write(os.path.join(a.out, "02-timed-speech.wav"), timed * g, SR)
    t24 = resample_poly(timed * g, 160, 147).astype(np.float32)
    sf.write(os.path.join(a.out, "02-timed-speech-24k.wav"), t24, 24000)
    if a.stretch == "world":
        sf.write(os.path.join(a.out, "02-world-stretch.wav"), warped * (0.89 / max(1e-6, float(np.abs(warped).max()))), SR)
        w24 = resample_poly(warped * (0.89 / max(1e-6, float(np.abs(warped).max()))), 160, 147).astype(np.float32)
        sf.write(os.path.join(a.out, "02-world-stretch-24k.wav"), w24, 24000)

    # f0 at 50 fps over the 24 kHz file: the score curve, 0 over voiceless consonants and silence
    n50 = int(math.ceil(len(t24) / 480))
    curve = np.zeros(n50, np.float32)
    src = np.asarray(plan["f0"], dtype=np.float32)
    curve[: min(n50, len(src))] = src[:n50]
    f0 = curve.copy()
    for k in range(n50):
        c = int((k + 0.5) / 50 * SR)
        if c >= total or voiceless[c] or not covered[c]:
            f0[k] = 0.0
    # a voiced frame inside the speech that the curve left at 0 (a long lead-in) takes the nearest pitch
    nz = np.flatnonzero(curve > 0)
    for k in range(n50):
        c = int((k + 0.5) / 50 * SR)
        if f0[k] == 0 and c < total and covered[c] and not voiceless[c] and len(nz):
            f0[k] = curve[nz[np.argmin(np.abs(nz - k))]]
    np.save(os.path.join(a.out, "target_f0.npy"), f0)
    if a.prompt_meta:
        meta = json.load(open(a.prompt_meta, encoding="utf-8"))
        segs = meta if isinstance(meta, list) else [meta]
        pf0 = np.array([float(x) for x in segs[0]["f0"].split()], dtype=np.float32)
        np.save(os.path.join(a.out, "prompt_f0.npy"), pf0)
    json.dump({"tts_seconds": round(tts_s, 2), "sample_rate": SR, "frames_per_second": FPS, "voiced_f0_frames": int((f0 > 0).sum()),
               "f0_frames": n50, "phrases": report}, open(os.path.join(a.out, "align.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"TTS {tts_s:.1f}s on CPU; wrote {a.out}")


if __name__ == "__main__":
    main()
