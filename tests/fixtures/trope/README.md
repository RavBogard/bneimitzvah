# Trope calibration fixtures

Text and data attribution, license links and modification notices are in
[`NOTICE.md`](NOTICE.md). MAM Hebrew and adaptations remain CC BY-SA 4.0;
Hebcal data remain CC BY 4.0. These licenses are separate from MIT code and
the Binder/Avery table permission.

## Local migration additions

`week-min-hebrew.json` and `week-notes-hebrew.json` preserve the 3 and 25 Hebrew
fixture verses needed by the original engine text tests. Only `ref`, `he` and
`break` were copied from the source research commit `380b1b2`; each file records
its exact source path and commit. English translations and editorial metadata
were excluded. MAM attribution and CC BY-SA 4.0 terms are retained in `NOTICE.md`;
see also `trope/PROVENANCE.md`.

`lib-trope-golden.json` records the original `template/lib.js` outputs at source
main `5b2530f` for all 182 verses in the two calibration corpora, edge cases and
the two Hebrew-only sheet fixtures. Every verse has final/non-final cases; edge
cases also cover raw and cleaned HTML (400 cases). It stores phrase families,
HTML SHA-256 hashes, corpus family sets and the source constants, without Hebrew
or English verse payloads. `tests/trope-lib.test.mjs` compares the standalone
helper to those original-source results.

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

## SoulX phone set: `soulx-phone-set.json`

The subset of SoulX-Singer's `soulxsinger/utils/phoneme/phone_set.json` (commit
`81aeb3ae772c70093c3de74dc23c92d983801ae4`, 2,820 tokens) that `trope/soulx.mjs` can emit: the 10 special tokens,
all 70 `en_` CMU ARPAbet tokens and the `zh_` pinyin syllables with initial h or z (the `chet: "zh"` variant).
`tests/trope-soulx.test.mjs` checks every emitted token against it, so the test needs no Python. Regenerate from
the clone in `C:\Users\dsbog\haftarah-audio\soulx-env\SoulX-Singer` if the emitter starts using other tokens.

The subset is a modification of the upstream phone-set data, retaining 244 of
2,820 tokens at that exact commit. All subset tokens were verified against the
pinned source during migration. The upstream Apache-2.0 license is retained as
`SoulX-Singer.LICENSE`; no NOTICE file exists in that commit's recursive tree.
See `trope/PROVENANCE.md` for the pinned source URL and SHA-256 hashes.

## Moroccan: `idelsohn-272-joshua-1-14.json`

Idelsohn, *Thesaurus* vol. 5 (1928/29, public domain), no. 272: Joshua 1:14 chanted in the Moroccan (Fez)
Prophets mode, transcribed word by word from the archive.org scan (book p. 103), with the MAM text of the verse.
Each word: Idelsohn's syllables, the ta'am, the printed pitches per syllable (C4 = middle C), and whether the
Moroccan table (`trope/cells/haftarah-moroccan.json`) reproduces it `exact`ly, by `contour`, or is `divergent`
(the table follows no. 271 there; `variants` names the cell variant that sings 272's reading). Used by
`tests/trope-moroccan.test.mjs`; the transcription and choices are in
`docs/superpowers/research/2026-10-15-trope-engine/moroccan-table.md`.
