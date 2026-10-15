# Trope calibration fixtures

`calibration-haftarah.json` holds the calibration corpus of the trope engine research
(`docs/superpowers/research/2026-10-15-trope-engine/trope-grammar.md`, section 4.4): 53 single verses of the
"Miqra according to the Masorah" Hebrew text, as Sefaria's v3 API returns them (raw HTML, uncleaned).
Fetched: 2026-10-15.

Each verse: `ref`, `book`, `chapter`, `verse`, `he` (verbatim), `set` (`core` 20, `full` 29 more, `rare` 4),
`final` (true when the verse ends a haftarah, per the report: Jeremiah 9:23, Jeremiah 46:28), `note`.
Zechariah 3:2 is in the core set. Note the report's text says the full set is 39 verses but lists 49 (20 + 29).

Regenerate (network needed):

    node scripts/trope-fetch.mjs --corpus --out tests/fixtures/trope/calibration-haftarah.json

Other refs: `node scripts/trope-fetch.mjs --out f.json "I Samuel 20:18" ...` or `--refs file`
(one ref per line, optional `ref|set|final|note`).
