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
import tempfile

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


def ffmpeg(*arguments):
    try:
        return subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-xerror", *arguments],
            check=True, capture_output=True,
        ).stdout
    except subprocess.CalledProcessError:
        raise ValueError("Audio processing failed") from None


def packet_and_pcm_hashes(original, derivative):
    # Independently compare the encoded packet payloads and the audible, gapless-decoded samples.
    outputs = []
    for index, codec in ((0, "copy"), (1, "copy"), (0, "pcm_s32le"), (1, "pcm_s32le")):
        outputs.extend(["-map", f"{index}:a:0", "-c:a", codec,
                        "-f", "streamhash", "-hash", "sha256", "-"])
    evidence = ffmpeg("-i", str(original), "-i", str(derivative), *outputs)
    hashes = re.findall(rb"(?m)^0,a,SHA256=([a-f0-9]{64})\r?$", evidence)
    if len(hashes) != 4 or hashes[0] != hashes[1] or hashes[2] != hashes[3]:
        raise ValueError("A full-length derivative changed encoded packets or decoded samples")
    return hashes[0].decode("ascii"), hashes[2].decode("ascii")


def private_audio_derivative(path, output):
    with tempfile.TemporaryDirectory(dir=output) as temporary:
        candidate = Path(temporary) / "audio.mp3"
        ffmpeg("-i", str(path), "-map", "0:a:0", "-map_metadata", "-1",
               "-map_chapters", "-1", "-c:a", "copy", "-id3v2_version", "0",
               "-write_id3v1", "0", str(candidate))
        try:
            info = json.loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-show_entries",
                "stream=codec_name,codec_type:stream_tags:format=duration:format_tags:chapter",
                "-of", "json", str(candidate),
            ], stderr=subprocess.PIPE))
        except subprocess.CalledProcessError:
            raise ValueError("Audio verification failed") from None
        if (info.get("streams") != [{"codec_name": "mp3", "codec_type": "audio"}]
                or info.get("chapters") or info["format"].get("tags")):
            raise ValueError("Derivative contains stream data other than clean MP3 audio")
        with candidate.open("rb") as media:
            header = media.read(2)
            media.seek(-128, 2)
            id3v1 = media.read(3)
            media.seek(-32, 2)
            ape = media.read(8)
        if (len(header) != 2 or header[0] != 0xff or header[1] & 0xe0 != 0xe0
                or id3v1 == b"TAG" or ape == b"APETAGEX"):
            raise ValueError("Derivative is not a tag-free MP3")
        packet_sha, pcm_sha = packet_and_pcm_hashes(path, candidate)
        checksum = digest(candidate)
        target = output / f"{checksum}.mp3"
        size = candidate.stat().st_size
        # The staging area is private and the filename is the content digest.
        candidate.replace(target)
    return target, checksum, size, round(float(info["format"]["duration"]), 3), packet_sha, pcm_sha


def protected_overlap(derived, source):
    return any(derived["start"] < marker["end"] and derived["end"] > marker["start"]
               for marker in source["personalContent"] if "start" in marker)


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
        raise ValueError("Original checksum mismatch")


def export_asset(job):
    root, asset, source, permit_unindexed, output = job
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

    if checks["englishSpeech"] or protected_overlap(derived, source):
        return "speech overlap"
    verified = review["status"] == "passed" and proof["machineVerified"]
    if not verified and not permit_unindexed:
        return "unverified repertoire"
    if not checks["decodes"]:
        return "decode hold"

    path = root / audio["path"]
    size = path.stat().st_size
    if size != audio["bytes"] or digest(path) != checksum:
        raise ValueError("Prepared playback integrity mismatch")
    clean, checksum, size, duration, packet_sha, pcm_sha = private_audio_derivative(path, output)

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
        "file": str(clean.resolve()), "sha256": checksum, "bytes": size, "id": track_id,
        "packetSha256": packet_sha, "pcmSha256": pcm_sha,
    }
    return track, upload, (root / derived["path"], derived["sha256"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("upload_plan", type=Path)
    parser.add_argument("--include-unindexed", action="store_true")
    parser.add_argument("--media-directory", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    if any(path.resolve().is_relative_to(repo) for path in (args.upload_plan, args.media_directory)):
        parser.error("Write the upload plan and clean media outside the repository.")
    output = args.media_directory.resolve()
    output.mkdir(parents=True, exist_ok=True)
    catalog = load(args.corpus / "prepared" / "catalog.json")
    sources = {source["catalogId"]: source for source in catalog["sources"]}
    jobs = [(args.corpus, asset, sources[asset["derivedFrom"]["catalogId"]],
             args.include_unindexed, output) for asset in catalog["assets"]]
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
