"""Build the public human-recording catalog from verified, off-Git media inventories."""
import argparse
import html
import json
from pathlib import Path
import re
from urllib.parse import quote, unquote, urljoin

from finkel_human_tracks import dump, load, passage

PUBLISHER = "https://karaites.org/torah-audio/"
NAMES = {
    "hayyei sara": "chayei-sara", "toledot": "toldot", "vayetze": "vayetzei",
    "mikketz": "miketz", "vaychi": "vayechi", "shemini": "shmini",
    "achare mot": "achrei-mot", "naso": "nasso", "behaalotecha": "behaalotcha",
    "shelach lecha": "shlach", "hukat": "chukat", "ekev": "eikev",
    "shofetim": "shoftim", "ki tetze": "ki-teitzei", "vayelech": "vayeilech", "vezot haberacha": "vezot-haberakhah",
}
BOOKS = {"Ex.": "Exodus", "1 Kings": "I Kings", "2 Kings": "II Kings",
         "Ovadiah": "Obadiah", "Malachai": "Malachi"}
# The audio index has conflicting and incomplete range labels. These Torah references
# appear in the publisher's contextual commentaries at /shemini/ and /emor/.
EDITED = {
    ("shmini", "torah"): "Leviticus 9:1-11:47",
    ("emor", "torah"): "Leviticus 21:1-24:23",
    ("reeh", "torah"): "Deuteronomy 11:26-16:17",
}
# Mismatching publisher editions or a numerically valid but disputed endpoint.
# Keep the recording under its named portion until its spoken boundaries are established.
UNINDEXED = {
    ("vayera", "haftarah"), ("vaera", "haftarah"), ("ki-tisa", "torah"),
    ("haazinu", "torah"),
}
TAG = re.compile(r"<(?P<tag>p|h2)\b[^>]*>(?P<text>.*?)</(?P=tag)>|<audio\b[^>]+src=\"(?P<src>[^\"]+)\"", re.S)
HEADING = re.compile(r"^(Parashat|Prashat|Haftarat) (.+?)\s*(?:\(|:)\s*(.+)$")
VERSES = re.compile(r"(\d+):(\d+)(?:\s*[-\u2013]\s*(?:(\d+):)?(\d+))?")


def parse_passages(reference):
    first_verse = VERSES.search(reference)
    if not first_verse:
        raise ValueError(f"Missing verse reference: {reference!r}")
    raw_book = reference[:first_verse.start()].strip(" :")
    book = BOOKS.get(raw_book, raw_book)
    ranges = reference[first_verse.start():].split(",")
    result = []
    for value in ranges:
        match = VERSES.match(value.strip())
        if not match:
            raise ValueError(f"Malformed passage: {reference!r}")
        endpoints = re.sub(r"\s+", "", match.group(0))
        result.append(passage(f"{book} {endpoints}"))
    return result


def slug_for(label):
    clean = label.lower().replace("’", "").replace("'", "").strip()
    return NAMES.get(clean, clean.replace(" ", "-"))


def karaite_tracks(repo, page, verification):
    named = (repo / "src/lib/readings/named-readings.ts").read_text(encoding="utf-8")
    titles = dict(re.findall(r'\br\("([^"]+)", "([^"]+)"', named))
    rows = []
    seen = set()
    pending = []
    previous = None
    for match in TAG.finditer(page):
        path, markup = match.group("src", "text")
        if path is None:
            heading = HEADING.fullmatch(" ".join(html.unescape(re.sub(r"<[^>]+>", "", markup)).split()))
            if heading:
                style, label, reference = heading.groups()
                kind = "haftarah" if style == "Haftarat" else "torah"
                pending.append((slug_for(label), kind, reference))
            continue
        media = quote(unquote(urljoin(PUBLISHER, html.unescape(path))), safe=":/?&=%")
        if not media.startswith("https://karaites.org/uploads/") or not media.endswith(".mp3"):
            raise ValueError(f"Unexpected media path: {media}")
        if pending:
            slug, kind, reference = pending.pop(0)
            track_id = f"karaite-{slug}-{kind}"
            title = titles[slug] + (" Torah reading" if kind == "torah" else " haftarah")
            if (slug, kind) == ("yitro", "torah"):
                # The public caption and file name disagree on the cantillation setting.
                reference = "Exodus 18:1-20:23"
            if (slug, kind) == ("vaetchanan", "torah"):
                title += " (lower ta’amim)"
            reference = EDITED.get((slug, kind), reference)
            passages = [] if (slug, kind) in UNINDEXED else parse_passages(reference)
        else:
            if previous not in {"yitro", "vaetchanan"} or "upper_teamim" not in media:
                raise ValueError(f"Unmatched media: {media}")
            slug, kind = previous, "torah"
            track_id = f"karaite-{slug}-decalogue"
            title = f"{titles[slug]} Ten Commandments (upper ta’amim)"
            passages = [passage("Exodus 20:2-14" if slug == "yitro" else "Deuteronomy 5:6-18")]
        previous = slug
        data = verification[len(rows)]
        if data["slot"] != len(rows) + 1 or data["url"] != media or "error" in data:
            raise ValueError(f"Missing verified media data for {media}")
        if data["sha256"] in seen:
            raise ValueError(f"Duplicate publisher media for {media}")
        seen.add(data["sha256"])
        track = {"id": track_id, "voice": "rotem-cohen", "title": title, "kind": kind,
                 "sourceUrl": PUBLISHER, "streamUrl": media, "portions": [slug],
                 **{key: data[key] for key in ("bytes", "sha256", "durationSec")}}
        if passages:
            track["passages"] = passages
        rows.append(track)
    if pending or len(rows) != 110 or len(verification) != len(rows):
        raise ValueError("Incomplete publisher index")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("karaite_html", type=Path)
    parser.add_argument("karaite_verification", type=Path)
    parser.add_argument("finkel_public_catalog", type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    karaite = karaite_tracks(repo, args.karaite_html.read_text(encoding="utf-8"),
                             load(args.karaite_verification))
    finkel = load(args.finkel_public_catalog)
    dump(repo / "src/lib/reference-audio/human-tracks.json", karaite + finkel)


if __name__ == "__main__":
    main()



