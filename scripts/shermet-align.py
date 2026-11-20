"""Align Shermet's actual audio to untimed phone targets; all artifacts stay outside Git.

No PocketTorah timing/label file is read. Its preexisting engine packs supply only
words and bPhones. A separate current portal readingText/word projection binds output.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import unicodedata

PIPELINE_VERSION = "shermet-ctc-native-grid-v2"


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(ref):
    return re.sub(r"^([12]) (Samuel|Kings) ", lambda m: ("II" if m[1] == "2" else "I") + " " + m[2] + " ", ref)


def letters(text):
    return "".join(c for c in unicodedata.normalize("NFC", text) if "\u05d0" <= c <= "\u05ea")


def private_output(directory):
    path = Path(directory).resolve()
    for ancestor in (path, *path.parents):
        if (ancestor / ".git").exists():
            raise ValueError("Alignment artifacts must remain outside Git")
    path.mkdir(parents=True, exist_ok=True)
    return path


def target_index(packs):
    result = {}
    for manifest in sorted(Path(packs).glob("*/manifest.json")):
        value = read(manifest)
        for passage in value.get("passages", []):
            result.setdefault(canonical(passage["ref"]), (manifest.parent / passage["directory"] / "identity-map.json", value))
    return result


def load_model(directory):
    import torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2FeatureExtractor
    # The official checkpoint uses weight_norm's historical keys. New torch
    # parametrizations renamed those two tensors; never accept random replacements.
    state = torch.load(str(Path(directory) / "pytorch_model.bin"), map_location="cpu")
    state = {key.replace("pos_conv_embed.conv.weight_g", "pos_conv_embed.conv.parametrizations.weight.original0")
             .replace("pos_conv_embed.conv.weight_v", "pos_conv_embed.conv.parametrizations.weight.original1"): value for key, value in state.items()}
    model, info = Wav2Vec2ForCTC.from_pretrained(directory, state_dict=state, local_files_only=True, output_loading_info=True)
    if info["missing_keys"] or info["unexpected_keys"] or info.get("mismatched_keys"):
        raise ValueError("Checkpoint load is not exact: " + str(info))
    if not torch.cuda.is_available():
        raise ValueError("CUDA is required for this explicitly GPU pipeline")
    return model.eval().to("cuda"), Wav2Vec2FeatureExtractor.from_pretrained(directory, local_files_only=True), read(Path(directory) / "vocab.json")


def emission_plan(samples, window=30 * 16000, hop=28 * 16000, stride=320, receptive=400):
    """Native model frame grid: overlapping windows contribute each frame once."""
    result = []
    offset = (receptive - 1) / 2
    for begin in range(0, samples, hop):
        length = min(window, samples - begin)
        frames = max(0, (length - receptive) // stride + 1)
        if not frames:
            break
        first = 0 if begin == 0 else 16000 // stride
        final = begin + length >= samples
        end = frames if final else min(frames, int((29 * 16000 - offset + stride - 1) // stride))
        result.append((begin, length, first, end))
        if final:
            break
    expected = max(0, (samples - receptive) // stride + 1)
    if sum(end - first for _, _, first, end in result) != expected:
        raise ValueError("Stitched emission count differs from the model's native frame clock")
    return result


def align_audio(model, feature, vocab, pcm, tokens, prefix=0):
    import torch
    import torchaudio
    import numpy as np
    if prefix:
        pcm = np.concatenate([np.zeros(round(prefix * 16000), np.float32), pcm])
    emissions = []
    with torch.inference_mode():
        for begin, length, first, end in emission_plan(len(pcm)):
            segment = pcm[begin:begin + length]
            emitted = torch.log_softmax(model(feature(segment, sampling_rate=16000, return_tensors="pt").input_values.to("cuda")).logits, -1)[0].cpu()
            if emitted.shape[0] != (length - 400) // 320 + 1:
                raise ValueError("Pinned model does not match the validated native frame grid")
            emissions.append(emitted[first:end])
    emission = torch.cat(emissions)[None]
    seconds, offset = 320 / 16000, 399 / 2 / 16000
    targets = torch.tensor([[vocab[token[1]] for token in tokens]], dtype=torch.int32)
    aligned, scores = torchaudio.functional.forced_align(emission, targets, blank=vocab["<pad>"])
    spans = torchaudio.functional.merge_tokens(aligned[0], scores[0].exp())
    if len(spans) != len(tokens):
        raise ValueError("Phone/token alignment cardinality mismatch")
    return [{"word": token[0], "phone": token[1], "start": float(span.start) * seconds + offset - prefix,
             "end": float(span.end) * seconds + offset - prefix, "score": float(span.score)} for token, span in zip(tokens, spans)]


def align_entry(entry, audio_directory, indexed, projected, model, feature, vocab, verify):
    import numpy as np
    ref = canonical(entry["ref"])
    path = Path(entry.get("audioDirectory", audio_directory)) / (entry.get("file") or entry["sha256"] + ".mp3")
    audio_sha = entry.get("sha256", path.stem)
    if sha(path.read_bytes()) != audio_sha:
        raise ValueError("Audio hash mismatch")
    if ref not in indexed or ref not in projected:
        raise ValueError("Missing untimed phone target or portal word projection")
    identity_path, manifest = indexed[ref]
    identity_bytes = identity_path.read_bytes()
    artifact = manifest.get("artifacts", {}).get(f"{identity_path.parent.name}/identity-map.json")
    if artifact and sha(identity_bytes) != artifact["sha256"]:
        raise ValueError("Untimed identity-map hash mismatch")
    identity, portal = json.loads(identity_bytes), projected[ref]
    if portal.get("status") != "ready" or not portal.get("readingText"):
        raise ValueError("Portal projection is not ready")
    target_words = identity["words"]
    if len(target_words) != len(portal["words"]) or any(letters(w["he"]) != letters(p) for w, p in zip(target_words, portal["words"])):
        raise ValueError("Phone target words disagree with portal projection (qere/maqaf/word count)")
    word_ids = {word["id"]: i for i, word in enumerate(target_words)}
    tokens = []
    for syllable in identity["syllables"]:
        for role in ("onset", "vowel", "coda"):
            phones = syllable["bPhones"][role]
            if role == "vowel" and "".join(phones) in vocab:
                phones = ["".join(phones)]
            for phone in phones:
                phone = {"g": "ɡ"}.get(phone, phone)
                if phone not in vocab:
                    raise ValueError("Phone absent from pinned vocabulary")
                tokens.append((word_ids[syllable["wordId"]], phone))
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    pcm = np.frombuffer(raw, np.float32).copy()
    duration = len(pcm) / 16000
    phones = align_audio(model, feature, vocab, pcm, tokens)
    words, word_scores = [], []
    for index in range(len(target_words)):
        selected = [p for p in phones if p["word"] == index]
        if not selected:
            raise ValueError("A projected word has no aligned phones")
        words.append({"start": round(selected[0]["start"], 4), "end": round(selected[-1]["end"], 4)})
        word_scores.append(float(np.mean([p["score"] for p in selected])))
    holds = []
    last_end = 0
    for word in words:
        if word["start"] < last_end or word["end"] <= word["start"] or word["end"] > duration:
            holds.append("Word interval invariant failed")
        last_end = word["end"]
    # Independent inference grid: an added 240 ms silence prefix must not move
    # the inferred boundaries after that known offset is removed.
    comparison = None
    if verify:
        shifted = align_audio(model, feature, vocab, pcm, tokens, prefix=0.24)
        differences = [abs(a["start"] - b["start"]) for a, b in zip(phones, shifted)]
        comparison = {"medianPhoneStartDifference": float(np.median(differences)), "p95PhoneStartDifference": float(np.percentile(differences, 95)), "maxPhoneStartDifference": max(differences)}
        if comparison["p95PhoneStartDifference"] > 0.12 or comparison["maxPhoneStartDifference"] > 0.3:
            holds.append("Independent inference-grid stability failed")
    mean_score, minimum_word_score = float(np.mean([p["score"] for p in phones])), min(word_scores)
    if mean_score < 0.25 or minimum_word_score < 0.08:
        holds.append("CTC confidence below conservative publication threshold")
    frame = 160
    rms = np.array([float(np.sqrt(np.mean(pcm[i:i + frame] ** 2))) for i in range(0, len(pcm), frame)])
    db = 20 * np.log10(rms + 1e-9)
    # Trimmed verse recordings may contain almost no noise-only frames. Cap the
    # threshold relative to voiced energy so a high noise percentile cannot
    # accidentally put the threshold above every sample in a real performance.
    threshold = max(-55, min(float(np.percentile(db, 10)) + 10, float(np.percentile(db, 90)) - 14))
    active = np.where(db > threshold)[0]
    acoustic = {"thresholdDb": threshold, "firstActive": float(active[0] * .01) if len(active) else None, "lastActive": float((active[-1] + 1) * .01) if len(active) else None}
    if not len(active) or words[0]["start"] > acoustic["firstActive"] + 0.6 or words[-1]["end"] < acoustic["lastActive"] - 0.6:
        holds.append("Aligned phones omit substantial acoustic start or tail")
    timing = {"version": 1, "kind": entry["kind"], "ref": ref, "audioSha256": audio_sha,
              "readingTextSha256": sha(unicodedata.normalize("NFC", portal["readingText"]).encode("utf-8")),
              "wordCount": len(words), "duration": duration, "words": words, "status": "ready"}
    return {"status": "hold" if holds else "candidate", "reasons": holds, "timing": timing,
            "quality": {"meanPhoneScore": mean_score, "minimumWordScore": minimum_word_score, "wordScores": word_scores, "independentComparison": comparison, "acoustic": acoustic},
            "phoneTargetSha256": sha(identity_bytes), "phones": phones,
            "publication": "Candidate requires independent quality review; no automatic release"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--packs", required=True)
    parser.add_argument("--extra-packs", action="append", default=[])
    parser.add_argument("--portal-words", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--audio-directory", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--maximum", type=int, default=20)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--retry-holds", action="store_true")
    args = parser.parse_args()
    output = private_output(args.output)
    index = target_index(args.packs)
    for extra in args.extra_packs:
        index.update(target_index(extra))
    projection = read(args.portal_words)["verses"]
    projection = {canonical(ref): value for ref, value in projection.items()}
    catalog = read(args.catalog)["recordings"]
    model, feature, vocab = load_model(args.model)
    attempted = 0
    for entry in catalog:
        key = sha((PIPELINE_VERSION + ":" + entry["kind"] + ":" + entry["ref"] + ":" + entry.get("sha256", entry.get("file", "").removesuffix(".mp3"))).encode())
        destination = output / (key + ".json")
        if destination.exists() and not (args.retry_holds and read(destination).get("status") == "hold") or attempted >= args.maximum:
            continue
        attempted += 1
        begin = time.monotonic()
        try:
            result = align_entry(entry, args.audio_directory, index, projection, model, feature, vocab, args.verify)
        except Exception as error:
            result = {"status": "hold", "reasons": [str(error)[:300]], "ref": entry["ref"]}
        result["elapsedSeconds"] = round(time.monotonic() - begin, 3)
        result["pipelineVersion"] = PIPELINE_VERSION
        save(destination, result)
        print(json.dumps({"ref": entry["ref"], "status": result["status"], "reasons": result["reasons"], "seconds": result["elapsedSeconds"]}), flush=True)


if __name__ == "__main__":
    main()
