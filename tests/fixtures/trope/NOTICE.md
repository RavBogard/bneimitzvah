# Trope fixture attribution and licenses

## Miqra according to the Masorah — CC BY-SA 4.0

Hebrew text: *Miqra according to the Masorah* (MAM), by Dovi and the Hebrew
Wikisource contributors, provided through Sefaria. The
[MAM project](https://he.wikisource.org/wiki/מקרא_על_פי_המסורה) and the maintainer's
[Free Content License statement](https://en.wikisource.org/wiki/User:Dovi/Miqra_according_to_the_Masorah#1._Free_Content_License)
license the text and documentation under
[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
([legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en)).
Sefaria's [version metadata](https://www.sefaria.org/api/v3/texts/Genesis%201%3A1?version=hebrew%7CMiqra%20according%20to%20the%20Masorah&return_format=default)
identifies this edition, CC-BY-SA and the maintainer's Wikisource version source.
The versioned 4.0 license link comes from the maintainer's statement.

This attribution covers Hebrew in `calibration-haftarah.json`,
`calibration-torah.json`, `edge-cases.json`, `i-samuel-20-18.units.json`,
`idelsohn-272-joshua-1-14.json`, `week-min-hebrew.json`, `week-notes-hebrew.json`,
and `trope/env/ab/ref-text-i-samuel-20-18-42.json`. Sefaria text was fetched on
2026-10-15 as recorded in the original fixture documentation.

Changes from the source: selected verses were extracted; some fixtures preserve
raw API HTML while others remove markup, normalize Unicode, strip marks for ASR,
or add syllables, stress, phonemes and musical/test annotations. The two week
fixtures retain only `ref`, `he` and `break`, excluding translations and editorial
metadata. The source and modifications to the MAM text in these fixtures remain
available under CC BY-SA 4.0. Keep attribution, indicate further changes and
distribute adaptations under that same license. No endorsement is implied.

The root MIT code license and the separate Binder/Avery permission do not replace
these text terms or add restrictions to MAM. No English scripture is included.

## Hebcal leyning — CC BY 4.0

Reading/calendar data in `hebcal/*.json`: [Hebcal](https://www.hebcal.com),
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
([legal code](https://creativecommons.org/licenses/by/4.0/legalcode.en)).
Hebcal's [official API attribution guidance](https://www.hebcal.com/home/help/page/9)
identifies these terms. Files preserve the API responses selected for tests;
dates and request URLs are documented in `README.md`. Extracting these files from
the source repository did not change their response content. Test annotations
and selections are described in the fixture README. No endorsement is implied.

## Other fixture material

`soulx-phone-set.json`: modified subset of Soul-AILab's SoulX-Singer phone set;
Apache-2.0, retained in `SoulX-Singer.LICENSE`, exact source and changes in the
fixture README and `trope/PROVENANCE.md`.

Idelsohn notation in `idelsohn-272-joshua-1-14.json`: original 1928 edition,
nos. 271-272, with attribution and US public-domain basis in
`trope/cells/README.md`. Its MAM Hebrew retains the CC BY-SA 4.0 terms above.

`lib-trope-golden.json`: computed phrase families and hashes; it contains no
Hebrew or English verse payload. Source code provenance is recorded in the file.
