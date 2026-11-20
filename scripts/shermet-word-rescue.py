"""Additive word-boundary rescue. Never changes the original CTC worker or its rows.

Constant recording DC is removed for acoustic measurement and the independent
silence-prefix inference. Decisions compare real word boundaries, not mobile
internal phone positions. All output and cached ASR remain outside Git.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import re
from pathlib import Path
import statistics
import subprocess
import sys
import time

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("shermet_ctc", Path(__file__).with_name("shermet-align.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
VERSION = "shermet-word-consensus-dc-v1"
RESCUE_CODE = "word-consensus-dc-v1-feature-and-unit-binding"


def frame_energy(samples, width=160):
    """RMS about each frame's measured mean: a constant DC cannot look voiced."""
    if hasattr(samples, "reshape"):
        import numpy as np
        count = len(samples) // width
        frames = samples[:count * width].reshape(count, width)
        result = np.std(frames, axis=1).astype(float).tolist()
        if count * width < len(samples):
            result.extend(frame_energy(samples[count * width:].tolist(), width))
        return result
    result = []
    for begin in range(0, len(samples), width):
        frame = samples[begin:begin + width]
        mean = math.fsum(frame) / len(frame)
        result.append(math.sqrt(math.fsum((value - mean) ** 2 for value in frame) / len(frame)))
    return result


def runs(flags):
    result, first = [], None
    for i, active in enumerate([*flags, False]):
        if active and first is None:
            first = i
        elif not active and first is not None:
            result.append((first, i)); first = None
    return result


def words_from_phones(phones, count):
    words = []
    for i in range(count):
        selected = [p for p in phones if p["word"] == i]
        if not selected:
            raise ValueError("Missing independently aligned word")
        words.append({"start": selected[0]["start"], "end": selected[-1]["end"]})
    return words


def extend_measured_ends(words, activity, duration):
    result, evidence = [], []
    for i, word in enumerate(words):
        limit = words[i + 1]["start"] if i + 1 < len(words) else duration
        quiet, end = 0, word["end"]
        for frame in range(max(0, int(end / .01)), min(len(activity), int(limit / .01))):
            if activity[frame]:
                end = min(limit, (frame + 1) * .01); quiet = 0
            else:
                quiet += 1
                if quiet >= 8:
                    break
        result.append({"start": word["start"], "end": min(duration, max(word["end"], end))})
        evidence.append({"ctcEnd": word["end"], "measuredEnd": result[-1]["end"], "voicedExtension": max(0, result[-1]["end"] - word["end"])})
    return result, evidence


def boundary_agreement(first, second):
    starts = [abs(a["start"] - b["start"]) for a, b in zip(first, second)]
    ends = [abs(a["end"] - b["end"]) for a, b in zip(first, second)]
    return {"medianStart": statistics.median(starts), "maxStart": max(starts), "maxEnd": max(ends)}


def overlap(first, second):
    return max(0, min(first["end"], second["end"]) - max(first["start"], second["start"])) / max(.001, min(first["end"] - first["start"], second["end"] - second["start"]))


def lexical_word(value):
    return re.sub("[^א-ת]", "", value).replace("יהוה", "אדני").replace("אדוני", "אדני")


def apply_independent_audit(result, audit, evidence_sha):
    timing = result.get("timing", {})
    if not audit or audit.get("ref") != timing.get("ref") or audit.get("audioSha256") != timing.get("audioSha256"):
        return result
    result.setdefault("quality", {})["independentAsrAudit"] = {**audit, "evidenceSha256": evidence_sha}
    reason = "Independent Hebrew ASR did not corroborate the rescued timing"
    result["reasons"] = [value for value in result["reasons"] if value not in (reason, "Independent Hebrew ASR contradicts the rescued source or word intervals")]
    if audit.get("lexical", 0) < .6 or audit.get("medianOverlap", 0) < .35 or audit.get("zeroOverlapFraction", 1) > .34:
        result["reasons"].append(reason)
    result["status"] = "hold" if result["reasons"] else "candidate"
    return result


def rescue(candidate, pcm, shifted, portal, forced=None, lexical=None):
    import numpy as np
    timing = candidate["timing"]
    primary = words_from_phones(candidate["phones"], timing["wordCount"])
    independent = words_from_phones(shifted, timing["wordCount"])
    energy = np.asarray(frame_energy(pcm))
    db = 20 * np.log10(energy + 1e-9)
    threshold = max(-55, min(float(np.percentile(db, 10)) + 10, float(np.percentile(db, 90)) - 14))
    activity = (db > threshold).tolist()
    stable_runs = [(a, b) for a, b in runs(activity) if b - a >= 3]
    words, endpoints = extend_measured_ends(primary, activity, timing["duration"])
    comparison_words, _ = extend_measured_ends(independent, activity, timing["duration"])
    agreement = boundary_agreement(words, comparison_words)
    holds = []
    if agreement["medianStart"] > .03 or agreement["maxStart"] > .12 or agreement["maxEnd"] > .16:
        holds.append("Independent word-boundary agreement failed")
    if not stable_runs or words[0]["start"] > stable_runs[0][0] * .01 + .5 or words[-1]["end"] < stable_runs[-1][1] * .01 - .25:
        holds.append("DC-neutral acoustic onset or tail is not covered")
    gaps = []
    for a, b in zip(words, words[1:]):
        loud = activity[max(0, int(a["end"] / .01)):max(0, int(b["start"] / .01))]
        longest = max((end - start for start, end in runs(loud)), default=0) * .01
        gaps.append(longest)
    if any(gap > .12 for gap in gaps):
        holds.append("Sustained acoustic voice is unassigned between words")
    whisper = None
    if forced and forced.get("sha256") == timing["audioSha256"]:
        other = forced["whisper"]
        if len(other) != len(words):
            holds.append("Independent Whisper word count differs")
        elif any(lexical_word(a["word"]) != lexical_word(b) for a, b in zip(other, portal["words"])):
            holds.append("Independent Whisper word units differ from the projection")
        else:
            scores = [overlap(a, b) for a, b in zip(words, other)]
            whisper = {"audioSha256": forced["sha256"], "wordUnitsExact": True, "minimumOverlap": min(scores), "medianOverlap": statistics.median(scores), "zeroOverlapWords": sum(score == 0 for score in scores), "lexical": lexical}
            if min(scores) < .25 or statistics.median(scores) < .6:
                holds.append("Independent Whisper contradicts a word interval")
    quality = candidate["quality"]
    low_ctc = quality["meanPhoneScore"] < .25 or quality["minimumWordScore"] < .08
    corroborated_low = whisper and lexical is not None and lexical >= .8 and whisper["minimumOverlap"] >= .45 and whisper["medianOverlap"] >= .75 and quality["meanPhoneScore"] >= .3 and quality["minimumWordScore"] >= .03
    if low_ctc and not corroborated_low:
        holds.append("Low CTC confidence lacks strong independent word corroboration")
    end = 0
    for word in words:
        if word["start"] < end or word["end"] <= word["start"] or word["end"] > timing["duration"]:
            holds.append("Word interval invariant failed")
        end = word["end"]
    if hashlib.sha256(portal["readingText"].encode()).hexdigest() != timing["readingTextSha256"] or len(portal["words"]) != len(words):
        holds.append("Current source projection binding differs")
    output = {**timing, "words": [{"start": round(w["start"], 4), "end": min(timing["duration"], round(w["end"], 4))} for w in words]}
    return {"pipelineVersion": VERSION, "status": "hold" if holds else "candidate", "reasons": holds,
            "timing": output, "basePipelineVersion": candidate["pipelineVersion"], "baseHoldReasons": candidate["reasons"],
            "quality": {"wordComparison": agreement, "dcOffset": float(np.median(pcm)), "centeredEnergyThresholdDb": threshold,
                        "firstStableAcoustic": stable_runs[0][0] * .01 if stable_runs else None,
                        "lastStableAcoustic": stable_runs[-1][1] * .01 if stable_runs else None,
                        "longestUnassignedVoicedGap": max(gaps, default=0), "endpoints": endpoints, "independentWhisper": whisper,
                        "meanPhoneScore": quality["meanPhoneScore"], "minimumWordScore": quality["minimumWordScore"]}}


def main():
    parser = argparse.ArgumentParser()
    for option in ("model", "candidates", "projection", "media", "output"):
        parser.add_argument("--" + option, required=True)
    parser.add_argument("--priority-refs")
    parser.add_argument("--forced-words")
    parser.add_argument("--lexical-audit")
    parser.add_argument("--independent-audit")
    parser.add_argument("--manifest")
    parser.add_argument("--maximum", type=int, default=30)
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args()
    output = base.private_output(args.output)
    projection = base.read(args.projection)["verses"]
    priorities = set(base.read(args.priority_refs)["refs"]) if args.priority_refs else set()
    forced = base.read(args.forced_words) if args.forced_words else {}
    lexical = {row["ref"]: row.get("characterMatch", row.get("lexical")) for row in base.read(args.lexical_audit)} if args.lexical_audit else {}
    model, feature, vocab = base.load_model(args.model)
    import numpy as np
    while True:
        audit_bytes = Path(args.independent_audit).read_bytes() if args.independent_audit else None
        audits = {(a["ref"], a["audioSha256"]): a for a in json.loads(audit_bytes)} if audit_bytes else {}
        audit_sha = base.sha(audit_bytes) if audit_bytes else None
        active = {row["ref"]: row["sha256"] for row in base.read(args.manifest)["recordings"]} if args.manifest else None
        available = []
        for file in Path(args.candidates).glob("*.json"):
            if len(file.stem) != 64:
                continue
            row = base.read(file)
            if row.get("pipelineVersion") != "shermet-ctc-native-grid-energy-v3" or row.get("status") != "hold" or not row.get("phones"):
                continue
            if active is not None and active.get(row["timing"]["ref"]) != row["timing"]["audioSha256"]:
                continue
            if "Word interval invariant failed" in row.get("reasons", []):
                continue
            key = base.sha((VERSION + file.stem).encode())
            prior = base.read(output / (key + ".json")) if (output / (key + ".json")).exists() else None
            audit = audits.get((row["timing"]["ref"], row["timing"]["audioSha256"]))
            if prior and prior.get("rescueCodeVersion") == RESCUE_CODE and audit and prior.get("quality", {}).get("independentAsrAudit", {}).get("evidenceSha256") != audit_sha:
                base.save(output / (key + ".json"), apply_independent_audit(prior, audit, audit_sha))
            if not prior or prior.get("rescueCodeVersion") != RESCUE_CODE:
                available.append((row["timing"]["ref"] not in priorities, row, key))
        available.sort(key=lambda value: value[0])
        for _, row, key in available[:args.maximum]:
            timing = row["timing"]; begin = time.monotonic()
            path = Path(args.media) / (timing["audioSha256"] + ".mp3")
            if not path.exists() or base.sha(path.read_bytes()) != timing["audioSha256"] or timing["ref"] not in projection:
                continue
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
            pcm = np.frombuffer(raw, np.float32).copy()
            centered = pcm - np.median(pcm)
            tokens = [(p["word"], p["phone"]) for p in row["phones"]]
            try:
                segment = pcm[:30 * 16000]
                normalized = feature(segment, sampling_rate=16000, return_tensors="pt").input_values
                dc_normalized = feature(segment - np.median(pcm), sampling_rate=16000, return_tensors="pt").input_values
                feature_difference = float((normalized - dc_normalized).abs().max())
                if feature_difference > .0001:
                    raise ValueError("Removing DC changed normalized primary model features")
                shifted = base.align_audio(model, feature, vocab, centered, tokens, prefix=.137)
                result = rescue(row, pcm, shifted, projection[timing["ref"]], forced.get(timing["ref"]), lexical.get(timing["ref"]))
                result["quality"]["primaryFeatureMaxDifference"] = feature_difference
                result = apply_independent_audit(result, audits.get((timing["ref"], timing["audioSha256"])), audit_sha)
            except Exception as error:
                result = {"pipelineVersion": VERSION, "status": "hold", "reasons": [str(error)[:200]], "ref": timing["ref"]}
            result["elapsedSeconds"] = round(time.monotonic() - begin, 3)
            result["rescueCodeVersion"] = RESCUE_CODE
            base.save(output / (key + ".json"), result)
            print(json.dumps({"ref": timing["ref"], "status": result["status"], "reasons": result["reasons"], "seconds": result["elapsedSeconds"]}), flush=True)
        if not args.watch:
            break
        time.sleep(5)


if __name__ == "__main__":
    main()
