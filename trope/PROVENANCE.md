# Engine migration provenance

Local migration source: `RavBogard/haftarah` research branch at
`380b1b20095285db373478db1057db2c6bd04b60` (2026-10-15). The source checkout was
read only. A separate clone was filtered with git-filter-repo, retaining 25 commits
and their author/committer identities and dates. The selected paths are `trope/`,
`scripts/trope-*.mjs`, `tests/trope-*.test.mjs`, `tests/fixtures/trope/`, the two
2026-10-15 engine/audio specs, the 2026-10-15 trope plans, and the engine research
directory. Other sheet/app code and original sheet fixtures were excluded.

`lib-trope.cjs` is copied from `template/lib.js` on source main at
`5b2530f72c544a9dab028d73076d47744b8252dc`, lines 9-11 and 478-570. It includes
the exact TETRA expression, phrase-family constants, tokenizer, phrase grouping,
HTML wrapper and family collector, with no other runtime dependencies. The golden
fixture was produced by executing that original source file, not the extracted
copy: 182 fixture verses, 400 raw/cleaned and final/non-final variants, phrase
families and HTML hashes. It stores no verse text or English translations.

## Third-party material and unresolved publication decisions

- `vendor/havarotjs/`: version 0.25.5, MIT; original license and integrity details
  remain in its `LICENSE` and `PROVENANCE.md`. No installation is needed.
- `cells/haftarah.json` and `cells/torah.json`: Binder/Avery teaching-source
  transcriptions with variants, cited in the source research. Their public
  publication license and comparison with a printed source remain unresolved
  engine open items 15 and 11. Code licensing does not settle those questions.
- `cells/haftarah-moroccan.json` and the Idelsohn fixture cite *Thesaurus*, volume
  5, nos. 271-272 (1928/29), described as public domain in the source research.
- Calibration, edge, unit and reference-text fixtures contain MAM Hebrew via
  Sefaria. Sefaria's official [sources and licenses](https://lite.sefaria.org/sources-and-licenses)
  identifies MAM as CC-BY-SA without a version on that page. Hebcal's official
  [API guidance](https://www.hebcal.com/home/help/page/9) identifies CC BY 4.0
  and attribution requirements for its leyning data. The exact MAM version,
  notices and publication conditions still require confirmation before publishing.
- `week-min-hebrew.json` and `week-notes-hebrew.json` copy only `ref`, `he` and
  `break` from the source branch's corresponding `tests/fixtures/*/sheet.json`
  files. Their source metadata identifies MAM. The original files contain English
  and editorial metadata and were deliberately not imported. Their Hebrew retains
  the same unresolved MAM publication decision as the other fixtures.
- `soulx-phone-set.json` is a subset of SoulX-Singer's phone set at
  `81aeb3ae772c70093c3de74dc23c92d983801ae4`, path recorded in the fixture README.
  All 244 retained tokens were compared against the pinned source's 2,820 tokens.
  The pinned upstream [LICENSE](https://github.com/Soul-AILab/SoulX-Singer/blob/81aeb3ae772c70093c3de74dc23c92d983801ae4/LICENSE)
  is Apache-2.0 and is retained as `tests/fixtures/trope/SoulX-Singer.LICENSE`
  (SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`).
  Its recursive source tree contains no NOTICE file. The subset modification is
  explicitly described in the fixture's `about` field and README. The upstream
  phone-set SHA-256 is `1f28c4fdf8e9b68af42ef706b92b7fa86eb857555610ba271d84148776d5c3b8`.
- Imported plans are historical evidence. They include an old source-repo push
  workflow and contact identity, and do not authorize pushes, GPU/cloud jobs,
  model downloads, paid services, voice cloning or any student-facing release.
  Historical author metadata and the historical contact address are preserved.

The retained history was inspected as 130 unique text blobs: no audio, recordings,
weights, binary blobs, key files, credential-pattern matches, student/family data
or English scripture payloads were found. The five JSON `name.en` fields are
Hebcal reading titles. The historical contact identity is not student/family data.
Marker scans and provenance inspection do not establish publication rights.
This migration is local preparation; these unresolved decisions gate publication.

The root code license does not override any third-party terms. No generated chant
is released by this migration; the G1/G2/G3 gates continue to apply.
