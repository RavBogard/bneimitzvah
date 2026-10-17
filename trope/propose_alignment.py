r"""Machine-proposed phone boundaries for one spoken take (chant-human-alignment/v1, reviewState "proposed").

  <soulx-env>\venv\Scripts\python trope/propose_alignment.py --identity <pack>/<P>/identity-map.json
      --manifest <pack>/manifest.json --audio <take.wav> --start 56.6 --end 64.5 --out <proposal.json>
      [--revision 2c733782da5604684829819a5eb744c193fe9398]

CTC forced alignment of the target's exact phone sequence (the identity map's bPhones, in Phonikud IPA) with
facebook/wav2vec2-xlsr-53-espeak-cv-ft (Apache-2.0; multilingual IPA phone recognizer), pinned by revision,
via torchaudio.functional.forced_align. CTC emits peaky spans (one or a few 20 ms frames per phone) near a
sound's start. With --boundary onset (default) the boundary between two phones is the next span's start plus
--onset-offset; the older midpoint rule put boundaries audibly too early (Daniel's 2026-10-16 listening:
word endings clipped, the next word starting with the previous word's sound, worst at doubled consonants and
vowel-initial words). A gap of at least --pause seconds at a word boundary becomes a proposed pause, whose
edges, like the verse's first and last edges, follow the loudness (--edge-db above the clip's noise floor;
the first edge looks back at most --lead-back seconds). The proposal covers the take contiguously. Every boundary is a proposal: reviewed stays null, so trope/human-retime.mjs refuses the record
until a person reviews it. Nothing here claims alignment accuracy.

Writes the record and, beside it, <out>.scores.json: per phone the CTC span and mean log-probability, and per
word its proposed interval and lowest phone score, for the listening review.
"""
import argparse, hashlib, json, os, sys

import numpy as np
import soundfile as sf

MODEL = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"
FIX = {"g": "ɡ"}   # Phonikud writes ascii g; the espeak vocabulary uses U+0261


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--identity", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--revision", default="2c733782da5604684829819a5eb744c193fe9398")
    ap.add_argument("--pause", type=float, default=0.25)
    ap.add_argument("--boundary", choices=["onset", "midpoint"], default="onset")
    # By ear (Daniel, 2026-10-16): the midpoint was too early and onset + 15 ms a touch too late.
    ap.add_argument("--onset-offset", type=float, default=-0.02)
    ap.add_argument("--edge-db", type=float, default=12.0)
    ap.add_argument("--murmur-db", type=float, default=7.0, help="0 turns off the voiced-closure boundary rule")
    ap.add_argument("--lead-back", type=float, default=0.25)
    ap.add_argument("--meta", required=True, help="JSON with alignmentId, sampleId, speakerId, takeNumber, consentRecordId, consentScope, targetReviewRecordId")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    import torch, torchaudio
    from transformers import Wav2Vec2ForCTC, Wav2Vec2FeatureExtractor
    from huggingface_hub import hf_hub_download

    identity_bytes = open(a.identity, "rb").read()
    identity = json.loads(identity_bytes)
    manifest = json.load(open(a.manifest, encoding="utf-8"))
    passage = next(p for p in manifest["passages"] if p["id"] == identity["passageId"])
    plan_path = os.path.join(os.path.dirname(a.identity), "b-speech-plan.json")
    meta = json.load(open(a.meta, encoding="utf-8"))

    info = sf.info(a.audio)
    encoding = {"PCM_16": "pcm16", "PCM_24": "pcm24", "PCM_32": "pcm32", "FLOAT": "float32"}[info.subtype]
    x, rate = sf.read(a.audio, dtype="float64", always_2d=True)
    x = x[:, 0] if x.shape[1] == 1 else x.mean(axis=1)
    s0, s1 = int(round(a.start * rate)), int(round(a.end * rate))
    clip = torch.from_numpy(x[s0:s1]).float().unsqueeze(0)
    clip16 = torchaudio.functional.resample(clip, rate, 16000)

    vocab = json.load(open(hf_hub_download(MODEL, "vocab.json", revision=a.revision), encoding="utf-8"))
    fe = Wav2Vec2FeatureExtractor.from_pretrained(MODEL, revision=a.revision)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL, revision=a.revision).eval()
    inputs = fe(clip16.squeeze(0).numpy(), sampling_rate=16000, return_tensors="pt")
    with torch.inference_mode():
        emission = torch.log_softmax(model(inputs.input_values).logits, dim=-1)
    frame_s = clip16.shape[1] / 16000 / emission.shape[1]

    # The target's exact phone sequence, syllable by syllable.
    tokens = []
    for si, s in enumerate(identity["syllables"]):
        for role in ("onset", "vowel", "coda"):
            phones = s["bPhones"][role] if role != "vowel" else ["".join(s["bPhones"]["vowel"])]
            for pi, ph in enumerate(phones):
                sym = FIX.get(ph, ph)
                if sym not in vocab:
                    raise SystemExit(f"aligner vocabulary lacks phone {ph!r}")
                tokens.append({"syllable": si, "role": role, "position": pi, "phone": ph, "id": vocab[sym], "word": s["wordId"]})
    targets = torch.tensor([[t["id"] for t in tokens]], dtype=torch.int32)
    aligned, scores = torchaudio.functional.forced_align(emission, targets, blank=vocab["<pad>"])
    spans = torchaudio.functional.merge_tokens(aligned[0], scores[0].exp())
    if len(spans) != len(tokens):
        raise SystemExit("forced alignment did not yield one span per phone")
    logp = emission[0]

    # Contiguous proposal in seconds within the clip, then original sample indices.
    # Loudness in 10 ms frames over the clip, against the clip's own noise floor (10th percentile).
    seg = x[s0:s1]
    hop = int(0.01 * rate)
    db = np.array([20 * np.log10(np.sqrt(np.mean(seg[i:i + hop] ** 2)) + 1e-9) for i in range(0, len(seg) - hop, hop)])
    floor = float(np.percentile(db, 10))
    loud = lambda t: db[min(len(db) - 1, max(0, int(t / 0.01)))] > floor + a.edge_db
    def fade_out(t, limit):   # forward from t while still sounding, never past limit
        while t + 0.01 < limit and loud(t):
            t += 0.01
        return min(t, limit)
    def fade_in(t, limit):    # backward from t while still sounding, never before limit
        while t - 0.01 > limit and loud(t - 0.01):
            t -= 0.01
        return max(t, limit)
    clip_s = clip16.shape[1] / 16000
    # Log-mel frames (10 ms hop) for vowel-to-vowel joins: the join is where the timbre changes most.
    mel = torchaudio.transforms.MelSpectrogram(16000, n_fft=400, hop_length=160, n_mels=40)(clip16).clamp_min(1e-10).log()[0].T.numpy()
    mel = mel - mel.mean(axis=1, keepdims=True)
    flux = np.r_[0, np.linalg.norm(np.diff(mel, axis=0), axis=1)]
    flux = np.convolve(flux, np.ones(3) / 3, mode="same")
    def vowel_join(t0, t1):
        f0, f1 = int(t0 / 0.01) + 1, min(len(flux), max(int(t0 / 0.01) + 2, int(t1 / 0.01)))
        if f1 <= f0:
            return None
        return (f0 + int(np.argmax(flux[f0:f1]))) * 0.01
    edges = [fade_in(spans[0].start * frame_s, max(0.0, spans[0].start * frame_s - a.lead_back))]
    events = []
    for i in range(1, len(spans)):
        prev_end, nxt = spans[i - 1].end * frame_s, spans[i].start * frame_s
        word_boundary = tokens[i]["word"] != tokens[i - 1]["word"]
        if word_boundary and nxt - prev_end >= a.pause:
            # A pause: the last sound runs until its loudness fades; the next starts where it rises.
            p0 = fade_out(prev_end, nxt - 0.05)
            p1 = fade_in(nxt, p0 + 0.02)
            if p1 - p0 >= 0.05:
                events.append((p0, p1)); edges.append(("pause", p0, p1)); continue
        # Between sounds: CTC spans mark a sound's start, so the boundary sits at the next span's start
        # (plus a small offset), not halfway between spans, which put boundaries too early by ear.
        if a.boundary == "onset" and word_boundary and tokens[i]["role"] == "vowel" and tokens[i - 1]["role"] == "vowel":
            # Vowel meets vowel across words (…χa | u…): no consonant edge for CTC to mark, and one fixed
            # offset was heard both too early and too late there. Cut at the largest change in the
            # spectrum between the two vowels' spans.
            # The window opens 30 ms after the first vowel's span, past that vowel's own onset transition.
            # The cut must leave the second vowel at least 15 ms before the following boundary.
            onset_rule = max(prev_end, nxt + a.onset_offset)
            nxt_floor = max(spans[i].end * frame_s, spans[i + 1].start * frame_s + a.onset_offset) if i + 1 < len(spans) else spans[i].end * frame_s
            lo, hi = spans[i - 1].end * frame_s + 0.03, min(spans[i].end * frame_s + 0.02, nxt_floor - 0.015)
            cut = vowel_join(lo, hi) if hi - lo >= 0.03 else None
            edges.append(cut if cut is not None and cut < nxt_floor - 0.015 else onset_rule)
            continue
        edges.append(max(prev_end, nxt + a.onset_offset) if a.boundary == "onset" else (prev_end + nxt) / 2)
    end_s = max(fade_out(spans[-1].end * frame_s, clip_s - 0.01), spans[-1].end * frame_s)
    # Every phone must keep a positive span: boundaries strictly increase, or the proposal is refused.
    flat = [edges[0]] + [e if not isinstance(e, tuple) else e[1] for e in edges[1:]] + [end_s]
    if any(b - a < 0.005 for a, b in zip(flat, flat[1:])):
        raise SystemExit("proposed boundaries do not strictly increase; refusing this proposal")
    to_sample = lambda t: s0 + int(round(t * rate))
    bounds = []   # (start, end) per token
    cursor = edges[0]
    for i in range(len(tokens)):
        nxt = edges[i + 1] if i + 1 < len(edges) else end_s
        if isinstance(nxt, tuple):
            bounds.append((cursor, nxt[1])); cursor = nxt[2]
        else:
            bounds.append((cursor, nxt)); cursor = nxt
    # Voiced closure: before b, d, g, m or n the lips or tongue often close while the voice keeps going,
    # a quiet low hum that CTC counts as the end of the vowel. Stretched, it is heard as an extra m or n
    # (Daniel, 2026-10-16: "elohechaM", "anochiN"). Where the vowel's end is that hum (at least 7 dB
    # below the vowel's own level, with low-band energy dominating), the boundary moves back to it,
    # by at most 120 ms (the largest move heard in Daniel's take was 81 ms).
    murmur_moves = []
    def band_ratio(t):
        i = int(t * rate)
        frame = seg[i:i + hop]
        if len(frame) < hop:
            return 0.0, -120.0
        spec = np.abs(np.fft.rfft(frame * np.hanning(len(frame)), 2048)); f = np.fft.rfftfreq(2048, 1 / rate)
        level = 20 * np.log10(np.sqrt(np.mean(frame ** 2)) + 1e-9)
        return float(spec[(f > 80) & (f < 400)].sum() / (spec[(f > 400) & (f < 2500)].sum() + 1e-9)), level
    for i in range(len(tokens) - 1):
        if a.murmur_db <= 0 or tokens[i]["role"] != "vowel" or tokens[i + 1]["phone"] not in ("b", "d", "g", "m", "n") or bounds[i][1] != bounds[i + 1][0]:
            continue
        v0, v1 = bounds[i]
        times = [v0 + k * 0.01 for k in range(int((v1 - v0) / 0.01))]
        if len(times) < 8:
            continue
        stats = [band_ratio(t) for t in times]
        head = sorted(level for _, level in stats[: max(3, int(len(stats) * 0.6))])
        median = head[len(head) // 2]
        raw = [ratio > 0.6 and level < median - a.murmur_db for ratio, level in stats]
        # A single frame that misses the test inside a run of hum does not end the run.
        hum = [raw[k] or (0 < k < len(raw) - 1 and raw[k - 1] and raw[k + 1]) for k in range(len(raw))]
        cut = len(hum)
        while cut > 0 and hum[cut - 1]:
            cut -= 1
        new = times[cut] if cut < len(times) else v1
        new = max(new, v1 - 0.12)
        if v1 - new >= 0.02 and new - v0 >= 0.04:
            bounds[i] = (v0, new); bounds[i + 1] = (new, bounds[i + 1][1])
            murmur_moves.append({"token": i, "vowel": tokens[i]["phone"], "phone": tokens[i + 1]["phone"], "word": tokens[i]["word"],
                                 "nextWord": tokens[i + 1]["word"], "clipSeconds": round(new, 3), "movedMs": round((v1 - new) * 1000)})
    if any(b1 - b0 < 0.005 for b0, b1 in bounds):
        raise SystemExit("a phone span fell under 5 ms after the voiced-closure pass; refusing this proposal")
    syllables = [{"syllableId": s["id"], "onset": [], "vowel": None, "coda": []} for s in identity["syllables"]]
    detail = []
    for t, (b0, b1), sp in zip(tokens, bounds, spans):
        interval = {"start": to_sample(b0), "end": to_sample(b1)}
        row = {"phone": t["phone"], "proposed": interval, "reviewed": None}
        if t["role"] == "vowel":
            syllables[t["syllable"]]["vowel"] = row
        else:
            syllables[t["syllable"]][t["role"]].append(row)
        frames = logp[sp.start:max(sp.start + 1, sp.end), t["id"]]
        detail.append({"syllable": t["syllable"], "role": t["role"], "phone": t["phone"], "word": t["word"],
                       "spanSeconds": [round(a.start + sp.start * frame_s, 3), round(a.start + sp.end * frame_s, 3)],
                       "meanLogProb": round(float(frames.mean()), 3)})
    record = {
        "schema": "chant-human-alignment/v1", "alignmentId": meta["alignmentId"],
        "target": {"benchmarkId": manifest["benchmarkId"], "manifestSha256": sha256(a.manifest), "passageId": identity["passageId"],
                   "targetHash": identity["targetHash"], "identityMapSha256": hashlib.sha256(identity_bytes).hexdigest(),
                   "speechPlanSha256": sha256(plan_path), "targetReviewRecordId": meta["targetReviewRecordId"]},
        "recording": {"sampleId": meta["sampleId"], "role": "spoken", "speakerId": meta["speakerId"], "takeNumber": meta["takeNumber"],
                      "audioSha256": sha256(a.audio), "encoding": encoding, "sampleRate": rate, "channels": info.channels,
                      "frames": info.frames, "downmix": "none" if info.channels == 1 else "average",
                      "consentRecordId": meta["consentRecordId"], "consentScope": meta["consentScope"]},
        "annotation": {"units": "samples", "method": "proposed-then-reviewed", "proposalSource": f"w2v-{a.revision[:7]}-{a.boundary}-r4",
                       "reviewState": "proposed", "reviewRecordId": None},
        "syllables": syllables,
        "events": [{"kind": "pause", "proposed": {"start": to_sample(e0), "end": to_sample(e1)}, "reviewed": None} for e0, e1 in events],
    }
    words = []
    for w in identity["words"]:
        rows = [d for d in detail if d["word"] == w["id"]]
        ids = [i for i, t in enumerate(tokens) if t["word"] == w["id"]]
        words.append({"wordId": w["id"], "he": w["he"], "start": round(a.start + bounds[ids[0]][0], 3), "end": round(a.start + bounds[ids[-1]][1], 3),
                      "lowestPhoneLogProb": min(r["meanLogProb"] for r in rows)})
    json.dump(record, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump({"model": MODEL, "revision": a.revision, "clip": [a.start, a.end], "boundaryRule": a.boundary, "onsetOffset": a.onset_offset, "edgeDb": a.edge_db, "murmurDb": a.murmur_db, "murmurMoves": murmur_moves, "frameSeconds": frame_s, "phones": detail, "words": words,
               "meaning": "CTC confidence diagnostics for review; not an alignment-accuracy measure"},
              open(a.out + ".scores.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for w in words:
        print(f"{w['start']:7.3f}-{w['end']:7.3f}  min logp {w['lowestPhoneLogProb']:7.3f}")
    print(f"proposed {len(tokens)} phones, {len(events)} pauses")


if __name__ == "__main__":
    main()
