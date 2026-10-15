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

## Torah: `calibration-torah.json`

The Torah calibration corpus (`docs/superpowers/research/2026-10-15-trope-engine/torah-grammar.md` §5.3, §4, §3.1):
83 single verses of the MAM text, raw Sefaria v3 HTML, fetched 2026-10-15. `set`: `core` 31 (the report's core
list), `full` 43 (the rest of the report's 54-verse list; that list is "the core set's first five plus" 49 refs,
6 of which repeat core verses, so core + full = 74, not 54), `rare` 6 (the shalshelet and mercha kefula verses
not already in; all 4 shalshelet, 5 mercha kefula and Num 35:5 karnei farah / yerach ben yomo are present),
`extra` 3 (Deut 34:12, the fifth book end; Ex 14:4, the other etnachta-silluq aliyah end; Gen 1:5, a Creation-day
refrain). The refs and flags are in `calibration-torah.refs`.

Each verse has the haftarah fields plus `endOfAliyah`, `endOfBook` (booleans) and `special` (`"creation"` or null).
`endOfAliyah` is true for the 19 verses that end an aliyah in the report's hebcal list (`fullkriyah` `e` verses of
`aliyot.json` and `holiday-readings.json`, 457 in all); `endOfBook` for the five book ends (also aliyah ends).
`trope-fetch.mjs` does not write these fields, so they ride in the `.refs` notes as tags (`[endOfAliyah]`,
`[endOfBook]`, `[special:creation]`) and a post-processing step turns the tags into fields (idempotent; the tags
stay in `note`):

    node scripts/trope-fetch.mjs --refs tests/fixtures/trope/calibration-torah.refs --out tests/fixtures/trope/calibration-torah.json
    node -e 'const f="tests/fixtures/trope/calibration-torah.json",fs=require("fs"),j=JSON.parse(fs.readFileSync(f,"utf8"));for(const v of j.verses){const n=v.note||"",s=/\[special:([\w-]+)\]/.exec(n);v.endOfAliyah=/\[endOfAliyah\]/.test(n);v.endOfBook=/\[endOfBook\]/.test(n);v.special=s?s[1]:null}fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'

Not included: the 27 dual-cantillation Decalogue verses (§3.2), which need their own table.

## Hebcal: `hebcal/*.json`

Raw Hebcal leyning responses (`https://www.hebcal.com/leyning?cfg=json&start=D&end=D`, Diaspora, full kriyah),
fetched 2026-10-15, for `tests/trope-hebcal.test.mjs`: `bereshit` (2026-10-10, Machar Chodesh haftarah),
`shemot` (2027-01-02, two-range haftarah Isaiah 27:6-28:13, 29:22-23), `simchat-torah` (2026-10-04, V'Zot
HaBerachah + Genesis 1:1-2:3 + Numbers maftir), `beshalach` (2027-01-23, the Song of the Sea), `vayakhel-shekalim`
(2027-03-06, a special maftir as a second range). Regenerate with the same URL and date.
