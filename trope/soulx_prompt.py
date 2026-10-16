"""Turn an arbitrary sung WAV into a SoulX-Singer prompt: <name>.wav (24 kHz mono) + <name>.json metadata.

Driven by scripts/trope-prompt.mjs (or run directly with the soulx-env venv's Python):
  python soulx_prompt.py --in clip.wav --out-dir DIR --name NAME --repo <SoulX-Singer> --models <preprocess>
      [--lyric "row row row your boat"] [--tokens "en_L-AA1 en_L-AA1"] [--vowel AA] [--language English]
      [--start S] [--end S] [--max-seconds 30] [--lufs -18] [--no-trim] [--no-normalize]
      [--device cpu] [--compare ref.json]

What SoulX conditions on (soulxsinger/utils/data_processor.py): the prompt WAV from sample 0 (the JSON's
`time` field is ignored for prompts) and the FIRST segment of the JSON, with one entry per note in five
parallel strings (`duration` s, `phoneme`, `note_pitch` MIDI, `note_type` 1 rest / 2 word start / 3 slur)
plus `f0` at 50 frames/s. The model has no speaker embedding: timbre comes from the prompt mel, and the
notes/phonemes tell it what that mel is singing, so they should be right but need not be perfect.

How this differs from SoulX's own preprocess/pipeline.py, which needs ~6.5 GB of models and NeMo:
- no vocal separation / dereverb (the input is expected to be a dry a cappella clip);
- no ASR (NeMo Parakeet / FunASR Paraformer): word boundaries come from ROSVOT's own RWBD word-boundary
  model, and the words come from --lyric (English, g2p_en like SoulX), --tokens (any phone-set tokens,
  e.g. the trope emitter's Hebrew syllables), or --vowel (every word sung on one vowel, the default);
- the same RMVPE f0 extractor (rmvpe/rmvpe.pt) and ROSVOT note transcriber (rosvot/*) SoulX uses, called
  through SoulX's own code in the clone. SoulX's RWBD path in infer_sample() has a KeyError bug
  ('word_bd_pred' read from the wrong output dict), so word boundaries are predicted here and passed in as
  word durations, which is the path SoulX's pipeline itself takes.
CPU is fine: a 30 s clip takes well under a minute.
"""
import argparse
import json
import math
import os
import sys
import time

SR = 24000            # SoulX mel sample rate
HOP = 480             # SoulX mel hop: one f0 value per 20 ms
ROSVOT_MAX_S = 20.0   # ROSVOT max_frames 4000 at hop 128 / 24 kHz = 21.3 s; SoulX's VAD cuts at 20 s
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(m):
    m = int(round(m))
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- audio
def prepare_audio(args, np, librosa, pyln):
    """Load, mono-ize, cut, trim, cap length at a quiet point, loudness-normalize, resample to 24 kHz."""
    y, sr = librosa.load(args.inp, sr=None, mono=True)
    src = {"path": os.path.abspath(args.inp), "sr": sr, "seconds": round(len(y) / sr, 3)}
    if args.start or args.end:
        a = int((args.start or 0) * sr)
        b = int(args.end * sr) if args.end else len(y)
        y = y[a:b]
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    y = y.astype(np.float32)
    if not args.no_trim:
        _, (a, b) = librosa.effects.trim(y, top_db=args.trim_db, frame_length=1024, hop_length=240)
        pad = int(0.15 * SR)
        y = y[max(0, a - pad):min(len(y), b + pad)]
    if len(y) > args.max_seconds * SR:
        # Cut at the quietest 50 ms in the last 5 s before the cap, so the prompt ends between notes.
        lo, hi = int((args.max_seconds - 5) * SR), int(args.max_seconds * SR)
        rms = librosa.feature.rms(y=y[lo:hi], frame_length=1200, hop_length=240)[0]
        cut = lo + int(np.argmin(rms)) * 240 + 600
        y = y[:cut]
    # Whole 10 ms steps, so note durations written with two decimals add up to exactly the WAV length.
    y = y[: len(y) - len(y) % (SR // 100)]
    loud_in = float(pyln.Meter(SR).integrated_loudness(y)) if len(y) > SR // 2 else float("nan")
    if not args.no_normalize and math.isfinite(loud_in):
        y = pyln.normalize.loudness(y, loud_in, args.lufs)
        peak = float(np.max(np.abs(y)))
        ceiling = 10 ** (-1.0 / 20)  # -1 dBFS
        if peak > ceiling:
            y = y * (ceiling / peak)
    loud_out = float(pyln.Meter(SR).integrated_loudness(y)) if len(y) > SR // 2 else float("nan")
    return y.astype(np.float32), src, loud_in, loud_out


# ---------------------------------------------------------------- f0 / chunks
def split_points(f0, max_s):
    """Chunk boundaries (in f0 frames) for ROSVOT's 20 s limit, placed in the longest unvoiced run."""
    fps = SR / HOP
    n, cuts, start = len(f0), [], 0
    max_f = int(max_s * fps)
    while n - start > max_f:
        lo, hi = start + int(max_f * 0.5), start + max_f
        best, best_len, run = None, -1, 0
        for i in range(lo, hi):
            run = run + 1 if f0[i] <= 0 else 0
            if run > best_len:
                best_len, best = run, i - run // 2
        cut = best if best_len > 0 else hi
        cuts.append(cut)
        start = cut
    return [0] + cuts + [n]


def rwbd_word_durs(wav, nt, np, torch):
    """ROSVOT's RWBD word-boundary model on one chunk -> word durations in seconds (silences included)."""
    from preprocess.tools.note_transcription.utils.rosvot_utils import get_mel_len, bd_to_durs
    from preprocess.tools.note_transcription.utils.audio.pitch_utils import norm_interp_f0, denorm_f0, f0_to_coarse
    from preprocess.tools.note_transcription.utils.commons.dataset_utils import pad_or_cut_xd
    hp, m, dev = nt.hparams, nt.models, nt.device
    hop, sr = hp["hop_size"], hp["audio_sample_rate"]
    real_len = min(get_mel_len(len(wav), hop), hp["max_frames"])
    T = math.ceil(real_len / hp["frames_multiple"]) * hp["frames_multiple"]
    wav_t = torch.from_numpy(wav).float().to(dev).unsqueeze(0)
    if wav_t.shape[-1] < T * hop:
        wav_t = pad_or_cut_xd(wav_t, T * hop, 1)
    with torch.no_grad():
        f0s, _ = m["pe"].get_pitch_batch(wav_t, sample_rate=sr, hop_size=hop, lengths=[real_len],
                                         fmax=hp["f0_max"], fmin=hp["f0_min"])
        f0_1d, uv_1d = norm_interp_f0(f0s[0][:T])
        f0_t = pad_or_cut_xd(torch.FloatTensor(f0_1d).to(dev), T, 0).unsqueeze(0)
        uv_t = pad_or_cut_xd(torch.FloatTensor(uv_1d).to(dev), T, 0).long().unsqueeze(0)
        coarse = f0_to_coarse(denorm_f0(f0_t, uv_t)).to(dev)
        mel = pad_or_cut_xd(m["mel_net"](wav_t), T, 1)
        mask = torch.zeros(1, T, device=dev)
        mask[:, :real_len] = 1.0
        mel = (mel.transpose(1, 2) * mask.unsqueeze(1)).transpose(1, 2)
        nonpad = mel.abs().sum(-1) > 0
        out = m["wbd_predictor"](mel=mel[:, :, : hp.get("wbd_use_mel_bins", 80)], pitch=coarse, uv=uv_t,
                                 non_padding=nonpad, train=False)
    bd = out["word_bd_pred"][0].detach().cpu().numpy()[:real_len]
    durs = [d * hop / sr for d in bd_to_durs(bd)]
    # The last word ends at the chunk's real end (bd_to_durs counts frames, the WAV may end mid-frame).
    durs[-1] += len(wav) / sr - sum(durs)
    return [d for d in durs if d > 0]


def transcribe(y, f0, nt, np, torch):
    """Notes for the whole clip: [{start, dur, pitch, word, sung}] with a global word index."""
    from preprocess.tools.note_transcription.model import infer_sample
    fps = SR / HOP
    bounds = split_points(f0, ROSVOT_MAX_S)
    notes, word_base, chunks = [], 0, []
    for a, b in zip(bounds[:-1], bounds[1:]):
        wav = y[a * HOP: min(len(y), b * HOP)]
        if len(wav) < SR // 10:
            continue
        t0 = a / fps
        durs = rwbd_word_durs(wav, nt, np, torch)
        # A word segment that is mostly unvoiced (RMVPE) is a rest.
        labels, t = [], 0.0
        for d in durs:
            fa, fb = int(round((t0 + t) * fps)), int(round((t0 + t + d) * fps))
            seg = f0[fa:max(fa + 1, fb)]
            labels.append("w" if len(seg) and float(np.mean(seg > 0)) >= 0.5 else "<SP>")
            t += d
        # Merge neighbouring rests (ROSVOT regulates notes to word edges; two rests in a row mean nothing).
        mw, md = [], []
        for w, d in zip(labels, durs):
            if mw and w == "<SP>" and mw[-1] == "<SP>":
                md[-1] += d
            else:
                mw.append(w)
                md.append(d)
        out = infer_sample({"item_name": "chunk", "wav_fn": wav, "word_durs": md}, nt.hparams, nt.models,
                           nt.device, apply_rwbd=False)
        n2w = out.get("note2words") or []
        if not out["pitches"]:
            notes.append({"start": t0, "dur": len(wav) / SR, "pitch": 0, "word": word_base, "sung": False})
            word_base += 1
            continue
        if len(n2w) != len(out["pitches"]):
            raise RuntimeError("ROSVOT returned no note-to-word map; cannot group notes into words")
        # min_word_dur filtering inside infer_sample can shorten the word list; keep indices in range.
        t = t0
        for p, d, wi in zip(out["pitches"], out["note_durs"], n2w):
            lab = mw[min(max(wi, 1), len(mw)) - 1]
            notes.append({"start": t, "dur": d, "pitch": int(round(p)), "word": word_base + wi,
                          "sung": lab != "<SP>"})
            t += d
        word_base += len(mw) + 1
        chunks.append([round(t0, 2), round(b / fps, 2), len(out["pitches"])])
    return notes, chunks


# ---------------------------------------------------------------- notes -> rows
def to_rows(notes, total_s, f0, np):
    """Snap to a 10 ms clock, fold rests together, drop zero-length notes, type 2/3 by word."""
    fps = SR / HOP
    total_cs = int(round(total_s * 100))
    rows = []
    for n in notes:
        if not n["sung"] or n["pitch"] <= 0:
            kind = "rest"
        else:
            # A "sung" note that RMVPE hears as mostly unvoiced is a breath or consonant gap: a rest.
            fa, fb = int(round(n["start"] * fps)), int(round((n["start"] + n["dur"]) * fps))
            seg = f0[fa:max(fa + 1, fb)]
            kind = "note" if len(seg) and float(np.mean(seg > 0)) >= 0.25 else "rest"
        rows.append({"start": n["start"], "dur": n["dur"], "pitch": n["pitch"] if kind == "note" else 0,
                     "word": n["word"], "rest": kind == "rest"})
    rows = carve_silences(rows, f0, np)
    # Boundaries in centiseconds on one clock; the last note ends exactly at the end of the WAV.
    edges = [int(round(r["start"] * 100)) for r in rows] + [total_cs]
    edges = [min(max(e, 0), total_cs) for e in edges]
    for i in range(1, len(edges)):
        edges[i] = max(edges[i], edges[i - 1])
    snapped = []
    for r, a, b in zip(rows, edges[:-1], edges[1:]):
        if b <= a:
            continue
        r = dict(r, cs=b - a)
        if snapped and r["rest"] and snapped[-1]["rest"]:
            snapped[-1]["cs"] += r["cs"]
            continue
        snapped.append(r)
    if edges[-1] < total_cs or not snapped:
        snapped.append({"rest": True, "pitch": 0, "word": -1, "cs": total_cs - (edges[-1] if snapped else 0)})
    prev_word = None
    for r in snapped:
        r["type"] = 1 if r["rest"] else (3 if r["word"] == prev_word else 2)
        prev_word = None if r["rest"] else r["word"]
    return snapped


def carve_silences(rows, f0, np, edge_s=0.12, inner_s=0.25):
    """ROSVOT stretches notes over the silence around them (its word boundaries tile the whole clip).
    Unvoiced runs of at least edge_s at a note's start or end, or inner_s inside it, become rests."""
    fps = SR / HOP
    out = []
    for r in rows:
        if r["rest"]:
            out.append(r)
            continue
        fa, fb = int(round(r["start"] * fps)), int(round((r["start"] + r["dur"]) * fps))
        v = f0[fa:fb] > 0
        if not len(v) or not v.any():
            out.append(dict(r, rest=True, pitch=0))
            continue
        # Runs of equal voicing: [(voiced, first_frame, n_frames)].
        runs, i = [], 0
        while i < len(v):
            j = i
            while j < len(v) and v[j] == v[i]:
                j += 1
            runs.append((bool(v[i]), i, j - i))
            i = j
        parts = []
        for k, (voiced, a, n) in enumerate(runs):
            edge = k == 0 or k == len(runs) - 1
            silent = not voiced and n >= (edge_s if edge else inner_s) * fps
            if parts and parts[-1][0] == silent:
                parts[-1][2] += n
            else:
                parts.append([silent, a, n])
        for silent, a, n in parts:
            start, dur = r["start"] + a / fps, n / fps
            out.append(dict(r, start=start, dur=dur, rest=silent, pitch=0 if silent else r["pitch"]))
    return out


def place_words(rows, n_words):
    """Regroup sung notes into exactly n_words words: keep word starts after rests and ROSVOT's word
    starts first, then the biggest pitch leaps. Returns the row indices that start a word."""
    sung = [i for i, r in enumerate(rows) if not r["rest"]]
    if n_words > len(sung):
        raise SystemExit(f"the lyric has {n_words} words but only {len(sung)} sung notes were found; "
                         "shorten the lyric, pass --tokens, or use --vowel")
    scored = []
    for k, i in enumerate(sung[1:], 1):
        prev = sung[k - 1]
        after_rest = prev != i - 1
        score = (3 if after_rest else 0) + (2 if rows[i]["type"] == 2 else 0)
        score += min(abs(rows[i]["pitch"] - rows[prev]["pitch"]), 12) / 100
        scored.append((-score, k, i))
    scored.sort()
    starts = {sung[0]} | {i for _, _, i in scored[: n_words - 1]}
    return starts


def assign_tokens(rows, words, phoneset):
    """words: list of (text, token) for each sung word, in order; rows get text/phoneme/type."""
    starts = place_words(rows, len(words))
    w = -1
    for i, r in enumerate(rows):
        if r["rest"]:
            r["text"], r["phoneme"] = "<SP>", "<SP>"
            continue
        if i in starts:
            w += 1
            r["type"] = 2
        else:
            r["type"] = 3
        r["text"], r["phoneme"] = words[w]
    bad = sorted({p for r in rows for p in phones_of(r["phoneme"]) if p not in phoneset})
    if bad:
        raise SystemExit(f"tokens not in SoulX's phone set: {' '.join(bad)}")


def phones_of(token):
    if token == "<SP>":
        return []
    if token.startswith("en_"):
        return ["en_" + p for p in token[3:].split("-")]
    return [token]


def english_tokens(lyric):
    from g2p_en import G2p
    g2p = G2p()
    out = []
    for raw in lyric.split():
        w = "".join(ch for ch in raw if ch.isalpha() or ch == "'")
        if not w:
            continue
        phones = [p for p in g2p(w.lower()) if p.strip() and p not in {"'", ","}]
        if not phones:
            raise SystemExit(f"g2p_en produced nothing for {raw!r}")
        out.append((w, "en_" + "-".join(phones)))
    return out


# ---------------------------------------------------------------- comparison
def frame_pitch(meta, fps=100):
    """Per-10 ms note pitch track of a metadata segment (0 = rest)."""
    durs = [float(x) for x in meta["duration"].split()]
    pitches = [int(x) for x in meta["note_pitch"].split()]
    track = []
    for d, p in zip(durs, pitches):
        track += [p] * int(round(d * fps))
    return track


def compare(mine, ref, offset_s=0.0):
    """Note-count and frame-level pitch agreement of two prompt metadata segments."""
    a, b = frame_pitch(mine), frame_pitch(ref)
    shift = int(round(offset_s * 100))
    if shift > 0:
        a = a[shift:]
    n = min(len(a), len(b))
    both = [(x, y) for x, y in zip(a[:n], b[:n]) if x > 0 and y > 0]
    either = sum(1 for x, y in zip(a[:n], b[:n]) if x > 0 or y > 0)
    exact = sum(1 for x, y in both if x == y)
    octave = sum(1 for x, y in both if (x - y) % 12 == 0)
    count = lambda m: sum(1 for p in m["note_pitch"].split() if int(p) > 0)
    return {
        "notes_mine": count(mine), "notes_ref": count(ref),
        "frames_compared_s": round(n / 100, 2), "both_voiced_s": round(len(both) / 100, 2),
        "voicing_overlap": round(len(both) / either, 3) if either else 0.0,
        "pitch_exact": round(exact / len(both), 3) if both else 0.0,
        "pitch_within_octave_class": round(octave / len(both), 3) if both else 0.0,
        "pitch_within_1st": round(sum(1 for x, y in both if abs(x - y) <= 1) / len(both), 3) if both else 0.0,
    }


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--repo", required=True, help="the SoulX-Singer clone")
    ap.add_argument("--models", required=True, help="folder holding rmvpe/ and rosvot/ from SoulX-Singer-Preprocess")
    ap.add_argument("--lyric", help="English words actually sung, in order")
    ap.add_argument("--tokens", help="space-separated phone-set tokens, one per sung word (e.g. en_L-AA1 zh_ha1)")
    ap.add_argument("--vowel", default="AA", help="ARPAbet vowel for every word when no lyric/tokens (default AA)")
    ap.add_argument("--language", default="English")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=0.0)
    ap.add_argument("--max-seconds", type=float, default=30.0)
    ap.add_argument("--trim-db", type=float, default=40.0)
    ap.add_argument("--lufs", type=float, default=-18.0)
    ap.add_argument("--no-trim", action="store_true")
    ap.add_argument("--no-normalize", action="store_true")
    ap.add_argument("--word-threshold", type=float, default=0.5, help="RWBD word-boundary threshold (shipped 0.9)")
    ap.add_argument("--note-threshold", type=float, default=0.85, help="ROSVOT note-boundary threshold (SoulX 0.85)")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compare", help="reference prompt JSON to compare against (first segment)")
    ap.add_argument("--compare-offset", type=float, default=0.0,
                    help="seconds into our clip where the reference segment starts")
    args = ap.parse_args()
    if args.lyric and args.tokens:
        raise SystemExit("--lyric and --tokens are alternatives")

    sys.path.insert(0, args.repo)
    os.chdir(args.repo)
    import numpy as np
    import librosa
    import soundfile as sf
    import pyloudnorm as pyln
    import torch
    from preprocess.tools.f0_extraction import F0Extractor
    from preprocess.tools.note_transcription.model import NoteTranscriber

    t_start = time.time()
    os.makedirs(args.out_dir, exist_ok=True)
    wav_out = os.path.abspath(os.path.join(args.out_dir, args.name + ".wav"))
    json_out = os.path.abspath(os.path.join(args.out_dir, args.name + ".json"))

    y, src, loud_in, loud_out = prepare_audio(args, np, librosa, pyln)
    total_s = len(y) / SR
    if total_s < 3:
        raise SystemExit(f"only {total_s:.2f} s of audio after trimming; a prompt needs 5-30 s")
    sf.write(wav_out, y, SR, subtype="PCM_16")

    with open(os.path.join(args.repo, "soulxsinger", "utils", "phoneme", "phone_set.json"), encoding="utf-8") as f:
        phoneset = set(json.load(f))

    fe = F0Extractor(os.path.join(args.models, "rmvpe", "rmvpe.pt"), device=args.device, verbose=False,
                     max_duration=max(60.0, total_s + 1))
    f0 = fe.process(wav_out, verbose=False)
    nt = NoteTranscriber(os.path.join(args.models, "rosvot", "rosvot", "model.pt"),
                         os.path.join(args.models, "rosvot", "rwbd", "model.pt"), device=args.device, verbose=False)
    # RWBD ships with word_bd_threshold 0.9, which on sustained singing finds a third of the words; ROSVOT
    # then regulates its notes to those few words and merges real notes. SoulX's own pipeline never hits
    # this because ASR supplies the words.
    nt.models["wbd_predictor"].word_bd_threshold = args.word_threshold
    nt.models["model"].note_bd_threshold = args.note_threshold
    notes, chunks = transcribe(y, f0, nt, np, torch)
    rows = to_rows(notes, total_s, f0, np)

    n_detected_words = len({r["word"] for r in rows if not r["rest"]})
    if args.tokens:
        toks = args.tokens.split()
        words, mode = [(t, t) for t in toks], "tokens"
    elif args.lyric:
        words, mode = english_tokens(args.lyric), "lyric"
    else:
        v = args.vowel.upper().rstrip("012")
        words, mode = [(v.lower(), f"en_{v}1")] * n_detected_words, f"vowel {v}"
    assign_tokens(rows, words, phoneset)

    seg = {
        "index": args.name,
        "language": args.language,
        "time": [0, int(round(total_s * 1000))],
        "duration": " ".join(f"{r['cs'] / 100:.2f}" for r in rows),
        "text": " ".join(r["text"] for r in rows),
        "phoneme": " ".join(r["phoneme"] for r in rows),
        "note_pitch": " ".join(str(r["pitch"]) for r in rows),
        "note_type": " ".join(str(r["type"]) for r in rows),
        "f0": " ".join(f"{x:.1f}" for x in f0),
    }
    with open(json_out, "w", encoding="utf-8") as f:
        json.dump([seg], f, ensure_ascii=False, indent=2)

    sung = [r for r in rows if not r["rest"]]
    voiced = f0[f0 > 0]
    midi_f0 = 69 + 12 * np.log2(voiced / 440.0) if len(voiced) else np.array([0.0])
    pitches = [r["pitch"] for r in sung]
    report = {
        "wav": wav_out, "json": json_out, "source": src, "mode": mode,
        "seconds": round(total_s, 2), "notes": len(sung), "rests": len(rows) - len(sung),
        "words": len(words), "words_detected": n_detected_words,
        "pitch_range": [note_name(min(pitches)), note_name(max(pitches))] if pitches else None,
        "pitch_range_midi": [min(pitches), max(pitches)] if pitches else None,
        "median_note": note_name(float(np.median(pitches))) if pitches else None,
        "f0_median_hz": round(float(np.median(voiced)), 1) if len(voiced) else 0.0,
        "voiced_fraction": round(float(np.mean(f0 > 0)), 3),
        "loudness_lufs": [round(loud_in, 1), round(loud_out, 1)],
        "rosvot_chunks": chunks, "elapsed_s": round(time.time() - t_start, 1),
    }
    # Agreement between the notes and the f0 they were transcribed from (a self-consistency check).
    fps, t, dev = SR / HOP, 0, []
    for r in rows:
        a, b = int(round(t / 100 * fps)), int(round((t + r["cs"]) / 100 * fps))
        t += r["cs"]
        seg_f0 = f0[a:b]
        seg_f0 = seg_f0[seg_f0 > 0]
        if not r["rest"] and len(seg_f0):
            dev.append(abs(float(np.median(69 + 12 * np.log2(seg_f0 / 440.0))) - r["pitch"]))
    report["notes_within_half_semitone_of_f0"] = round(sum(d <= 0.5 for d in dev) / len(dev), 3) if dev else None
    warnings = []
    if total_s < 5:
        warnings.append("shorter than 5 s: SoulX prompts work best at 5-30 s")
    if report["voiced_fraction"] < 0.5:
        warnings.append("less than half the clip is voiced: trim silences or breaths")
    if len(sung) < 8:
        warnings.append("fewer than 8 notes: a longer, more varied phrase gives the model more to go on")
    if mode.startswith("lyric") or mode == "tokens":
        if len(words) != n_detected_words:
            warnings.append(f"{len(words)} words given, {n_detected_words} word groups detected: words were "
                            "regrouped; check the alignment in the JSON (or edit it in SoulX's MIDI editor)")
    report["warnings"] = warnings
    if args.compare:
        with open(args.compare, encoding="utf-8") as f:
            ref = json.load(f)[0]
        report["compare"] = compare(seg, ref, args.compare_offset)

    log(f"prompt wav : {wav_out}")
    log(f"prompt json: {json_out}")
    log(f"duration   : {report['seconds']} s (source {src['seconds']} s at {src['sr']} Hz)")
    log(f"notes      : {report['notes']} sung + {report['rests']} rests in {len(words)} words ({mode}; "
        f"{n_detected_words} word groups detected)")
    if pitches:
        log(f"pitch range: {report['pitch_range'][0]}-{report['pitch_range'][1]} (MIDI {min(pitches)}-{max(pitches)}), "
            f"median note {report['median_note']}, median f0 {report['f0_median_hz']} Hz")
    log(f"voiced     : {report['voiced_fraction'] * 100:.1f}% of frames; notes within 0.5 st of f0: "
        f"{report['notes_within_half_semitone_of_f0']}")
    log(f"loudness   : {report['loudness_lufs'][0]} -> {report['loudness_lufs'][1]} LUFS")
    if "compare" in report:
        log(f"compare    : {json.dumps(report['compare'])}")
    for w in warnings:
        log(f"WARNING    : {w}")
    log(f"done in {report['elapsed_s']} s")
    print("@@ " + json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
