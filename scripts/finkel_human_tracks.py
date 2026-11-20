"""Export the Finkel teaching recordings using private catalog and media inputs.

The upload plan must be written outside Git. Public output contains only canonical
references, public titles and media integrity metadata.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess

MODE = {
    "chant": "Chant",
    "spoken": "Spoken reading",
    "chant-drill": "Chant and repeat",
    "spoken-drill": "Speak and repeat",
}
SERVICE = {
    "ahavah-rabbah": "Ahavah Rabbah",
    "haftarah-blessing-after": "Blessings after the haftarah",
    "haftarah-blessing-before": "Blessing before the haftarah",
    "kiddush": "Kiddush",
    "kedusha": "Kedushah",
    "ldor-vador": "L'dor Vador",
    "sfatai": "Adonai S'fatai Tiftach",
    "torah-blessing-after": "Blessing after the Torah reading",
    "torah-blessing-before": "Blessing before the Torah reading",
    "trope-anthem": "Torah trope anthem",
}
KINDS = {
    "torah": "torah", "prophets": "haftarah", "megillah": "megillah",
    "service-part": "other", "trope-instruction": "other",
}
RANGE = re.compile(r"((?:I{1,2} )?[A-Za-z]+) (\d+):(\d+)(?:[\u2013-](?:(\d+):)?(\d+))?")


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def probe(path):
    info = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "json", str(path),
    ]))["format"]
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path),
        "-map", "0:a:0", "-f", "null", "-",
    ], check=True, capture_output=True)
    return info


def passage(reference):
    match = RANGE.fullmatch(reference)
    if not match:
        raise ValueError(f"Unexpected canonical range: {reference!r}")
    book, chapter, verse, end_chapter, end_verse = match.groups()
    return {
        "book": book, "startChapter": int(chapter), "startVerse": int(verse),
        "endChapter": int(end_chapter or chapter), "endVerse": int(end_verse or verse),
    }


def verify_original(job):
    path, sha = job
    if digest(path) != sha:
        raise ValueError(f"Original checksum mismatch: {path.name}")
    probe(path)


def export_asset(job):
    root, asset, source, permit_unindexed = job
    derived = asset["derivedFrom"]
    review = asset["review"]["machineVerification"]
    audio = asset["playback"]
    proof = load(root / review["record"])
    checks = proof["checks"]
    checksum = audio["sha256"]
    if (source["classification"]["medium"] != "audio"
            or asset["performer"]["name"] != "Cantor Josh Finkel"
            or proof["playbackSha256"] != checksum):
        raise ValueError("Inconsistent attribution or verification record")

    overlap = any(derived["start"] < marker["end"] - 0.12
                  and derived["end"] > marker["start"] + 0.12
                  for marker in source["personalContent"] if "start" in marker)
    if checks["englishSpeech"] or overlap:
        return "speech overlap"
    verified = review["status"] == "passed" and proof["machineVerified"]
    if not verified and not permit_unindexed:
        return "unverified repertoire"
    if not checks["decodes"]:
        return "decode hold"

    path = root / audio["path"]
    size = path.stat().st_size
    if size != audio["bytes"] or digest(path) != checksum:
        raise ValueError(f"Playback integrity mismatch: {path.parent.name}")
    info = probe(path)
    duration = round(float(info["duration"]), 3)

    references = asset["ranges"] if verified else []
    if references and checks.get("verifiedVerses") != asset["verses"]:
        raise ValueError("Listed verses differ from the verification record")
    passages = [passage(ref) for ref in references or []]
    title = ", ".join(references or [])
    if not title and verified:
        title = " / ".join(SERVICE[item] for item in asset["serviceParts"] or [])
    if not title:
        title = {"torah": "Torah practice", "prophets": "Haftarah practice",
                 "megillah": "Megillah practice"}.get(asset["kind"], "Service practice")
    mode = MODE[asset["mode"]]
    if asset["tempo"] in {"faster", "slower"}:
        mode += f", {asset['tempo']}"
    track_id = f"finkel-{checksum[:24]}"
    track = {
        "id": track_id, "voice": "josh-finkel", "title": f"{title} · {mode}",
        "kind": KINDS[asset["kind"]], "audioPath": f"/api/human-tracks/{track_id}",
        "bytes": size, "sha256": checksum, "durationSec": duration,
    }
    if passages:
        track["passages"] = passages
    upload = {
        "key": f"reference-review/finkel/v1/audio/{checksum}.mp3",
        "file": str(path.resolve()), "sha256": checksum, "bytes": size, "id": track_id,
    }
    return track, upload, (root / derived["path"], derived["sha256"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("upload_plan", type=Path)
    parser.add_argument("--include-unindexed", action="store_true")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    if args.upload_plan.resolve().is_relative_to(repo):
        parser.error("Write the upload plan outside the repository.")
    catalog = load(args.corpus / "prepared" / "catalog.json")
    sources = {source["catalogId"]: source for source in catalog["sources"]}
    jobs = [(args.corpus, asset, sources[asset["derivedFrom"]["catalogId"]],
             args.include_unindexed) for asset in catalog["assets"]]
    tracks, uploads, originals, holds = {}, {}, set(), collections.Counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
        for result in workers.map(export_asset, jobs):
            if isinstance(result, str):
                holds[result] += 1
                continue
            track, upload, original = result
            tracks[track["sha256"]] = track
            uploads[track["sha256"]] = upload
            originals.add(original)
        list(workers.map(verify_original, originals))
    dump(args.catalog, list(tracks.values()))
    dump(args.upload_plan, {"objects": list(uploads.values())})
    print(f"Verified {len(tracks)} tracks across {len(originals)} originals. Holds: {dict(holds)}.")


if __name__ == "__main__":
    main()
