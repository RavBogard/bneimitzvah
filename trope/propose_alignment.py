r"""Machine-proposed phone boundaries for one spoken take (chant-human-alignment/v1, reviewState "proposed").

  <soulx-env>\venv\Scripts\python trope/propose_alignment.py --identity <pack>/<P>/identity-map.json
      --manifest <pack>/manifest.json --audio <take.wav> --start 56.6 --end 64.5 --out <proposal.json>
      [--revision 2c733782da5604684829819a5eb744c193fe9398]

CTC forced alignment of the target's exact phone sequence (the identity map's bPhones, in Phonikud IPA) with
facebook/wav2vec2-xlsr-53-espeak-cv-ft (Apache-2.0; multilingual IPA phone recognizer), pinned by revision,
via torchaudio.functional.forced_align. CTC emits peaky spans (one or a few 20 ms frames per phone); the
boundary between two phones is placed at the midpoint between one span's end and the next span's start, so
the proposal covers the take contiguously. A gap of at least --pause seconds at a word boundary becomes a
proposed pause. Every boundary is a proposal: reviewed stays null, so trope/human-retime.mjs refuses the record
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
    edges = [spans[0].start * frame_s]
    events = []
    for i in range(1, len(spans)):
        prev_end, nxt = spans[i - 1].end * frame_s, spans[i].start * frame_s
        word_boundary = tokens[i]["word"] != tokens[i - 1]["word"]
        if word_boundary and nxt - prev_end >= a.pause:
            events.append((prev_end + 0.04, nxt - 0.04))
            edges.append(("pause", prev_end + 0.04, nxt - 0.04))
        else:
            edges.append((prev_end + nxt) / 2)
    end_s = min(spans[-1].end * frame_s + 0.06, clip16.shape[1] / 16000)
    to_sample = lambda t: s0 + int(round(t * rate))
    bounds = []   # (start, end) per token
    cursor = edges[0]
    for i in range(len(tokens)):
        nxt = edges[i + 1] if i + 1 < len(edges) else end_s
        if isinstance(nxt, tuple):
            bounds.append((cursor, nxt[1])); cursor = nxt[2]
        else:
            bounds.append((cursor, nxt)); cursor = nxt
    syllables = [{"syllableId": s["id"], "onset": [], "vowel": None, "coda": []} for s in identity["syllables"]]
    detail = []
    for t, (b0, b1), sp in zip(tokens, bounds, spans):
        interval = {"start": to_sample(b0), "end": to_sample(b1)}
        row = {"phone": t["phone"], "proposed": interval, "reviewed": None}
        if t["role"] == "vowel":
            syllables[t["syllable"]]["vowel"] = row
        else:
            syllables[t["syllable"]][t["role"]].append(row)
        frames = logp[sp.start:sp.end + 1, t["id"]]
        detail.append({"syllable": t["syllable"], "role": t["role"], "phone": t["phone"], "word": t["word"],
                       "spanSeconds": [round(a.start + sp.start * frame_s, 3), round(a.start + (sp.end + 1) * frame_s, 3)],
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
        "annotation": {"units": "samples", "method": "proposed-then-reviewed", "proposalSource": "wav2vec2-espeak-2c73378",
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
    json.dump({"model": MODEL, "revision": a.revision, "clip": [a.start, a.end], "frameSeconds": frame_s, "phones": detail, "words": words,
               "meaning": "CTC confidence diagnostics for review; not an alignment-accuracy measure"},
              open(a.out + ".scores.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for w in words:
        print(f"{w['start']:7.3f}-{w['end']:7.3f}  min logp {w['lowestPhoneLogProb']:7.3f}")
    print(f"proposed {len(tokens)} phones, {len(events)} pauses")


if __name__ == "__main__":
    main()
