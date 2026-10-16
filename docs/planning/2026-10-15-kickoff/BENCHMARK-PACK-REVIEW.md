# Offline benchmark target-pack review — 2026-10-16

Independent adversarial review of the frozen new `trope/benchmark-pack.mjs`,
`scripts/trope-benchmark-pack.mjs`, `tests/trope-benchmark-pack.test.mjs` and the
benchmark plan's delivery section. **Accepted for private offline target
preparation; no blocking source finding.** This review does not approve a target,
voice, renderer, recording use, generated audio or student delivery. G1/G2/G3 and
the independent generated-chant release review remain required.

## Reviewed boundaries

- Explicit passage flags are mandatory and retained; array position never supplies
  finality. Torah/haftarah table mismatches, invalid book/aliyah combinations,
  unavailable special melodies and fallback cells reject the pack
  (`trope/benchmark-pack.mjs:37`, `:166`).
- A and B derive from one score and the same emitted segments. The identity map
  checks MIDI, order, slurs, syllable attachment, rests and integer millisecond
  timing across splits; maqaf words keep separate coordinate IDs. Raw score beats
  remain distinct from executed timing (`trope/benchmark-pack.mjs:92`). B's spoken
  stress heuristic is recorded separately. No identical F0 claim is made.
- Input, profile, table, actual code bytes and artifact hashes bind provenance.
  Record identifiers are assertions requiring external review; statuses remain
  `private-unreleased` and `pending` (`trope/benchmark-pack.mjs:185`). Pure-API
  assets are trusted; the CLI supplies its fixed local source/dependency set.
- The CLI checks the exact raw input checksum, uses bounded reads, validates the
  whole pack before creation, rejects lexical and resolved repository destinations
  and existing destinations, and writes exclusive files with the manifest last
  (`scripts/trope-benchmark-pack.mjs:17`, `:31`, `:54`, `:78`, `:95`, `:119`).
  Failure messages omit underlying diagnostics, private payloads and paths.
- No existing engine contract or source was changed by this slice. Its execution
  path prepares JSON only: no network request, renderer, Python, GPU, model load,
  audio output or application delivery path.

## Independent execution

After root confirmed source freeze:

- `node --test tests/trope-benchmark-pack.test.mjs`: **7/7 passed**, no skips.
  This includes permitted long/melismatic fixtures and split boundaries.
- **43 additional reviewer checks passed** in an in-memory Node script: malformed
  tempo/key/flag types and missing flags; both v1/v2 emitted clocks and maqaf IDs;
  altered segment boundaries, syllable durations, tokens and slurs; provenance and
  code changes invalidating target hashes; lexical and junction-aliased repository
  destinations; nonexistent parents; an allowed external junction; existing
  dangling links; and a forged released manifest refused before creation.
- All reviewer-created output stayed in a checked temporary directory outside the
  checkout and was removed. No private text, recording or target was fetched or
  retained. No repository guard or broad integration suite was run by this
  reviewer; root owns those checks.

Reviewed source SHA-256 values:

| File | SHA-256 |
|---|---|
| `trope/benchmark-pack.mjs` | `bf876b3d5c495f9a8695f3ffb72955979694eb2894ae390702a65e6977b543f5` |
| `scripts/trope-benchmark-pack.mjs` | `f57fb70f42497070ff0d2f741a30cd28f42138366abb8c870282e48c32afa033` |
| `tests/trope-benchmark-pack.test.mjs` | `32bf2458c87ed9ce1a329739becacfd6ca7887b558e7ef357bae872a9bd390ba` |

## Documentation correction

The delivery section initially said that the CLI prints the manifest hash; its
success output contains only a generic status sentence. Root corrected the prose
to describe the hash returned separately by the builder/writer. This documentation
finding is resolved; no source changed after the reviewed freeze.

The pack is a pending target proposal. Human target/pronunciation review,
human-source alignment and retiming, B F0/voicing preparation, rendering,
blinding/listening records and release evidence remain subsequent work.
