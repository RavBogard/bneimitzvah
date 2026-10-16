# Engine migration return — 2026-10-15

## Publication follow-up — 2026-10-15

Daniel expressly confirmed both noncommercial permission for the Binder/Avery
tables and their inclusion in this public repository. `trope/cells/README.md`
records that permission separately from MIT code, without unrestricted
commercial or sublicensing claims. MAM's maintainer links CC BY-SA 4.0;
Sefaria's API identifies that edition and version source. Fixture attribution,
change/share-alike notices and Hebcal CC BY 4.0 credits are retained in
`tests/fixtures/trope/NOTICE.md`, including the offline ASR reference. Idelsohn's
original volume V title page confirms the 1928 edition; its US publication-term
basis and source are recorded. SoulX and havarotjs licenses remain intact.

The following local-preparation record describes the prior checkpoint. Its
publication-permission blockers are resolved by the explicit permission and
primary-source attribution above. Normal publication and hosted checks follow;
the primary collaborator records their final IDs/results in STATE.md. This
authorizes no student release or practice pilot: Daniel requires the full
feature-complete product before testing with anyone other than him.

## Local preparation checkpoint

Local integration is complete; no engine commit has been pushed. Source research
tip: `380b1b20095285db373478db1057db2c6bd04b60`; source main helper:
`5b2530f72c544a9dab028d73076d47744b8252dc`. Source checkout and refs remain
unchanged. Extraction kept the plan's exact paths and 25 historical commits;
author/committer identities and dates were compared against every retained
commit-map entry. Merge commit: `afd56ae`. Standalone/parity commit: `ee77d23`.
`git log --follow trope/melody.mjs` reaches the initial melody implementation.

Changes: standalone `trope/lib-trope.cjs`, dependency rewrites, platform-specific
Modal joins/PATH delimiters, original-source parity for 182 fixture verses and
400 variants, and engine provenance. A stale-plan dependency on two sheet fixtures
was resolved by extracting only Hebrew `ref`/`he`/`break` fields (3 and 25 verses),
with exact source provenance. Original English/editorial payloads are excluded.
No root package, test helper or guard was changed by the engine worker.

Verification: engine tests pass **109/109** on Windows Node 24.11.1 and Ubuntu WSL
Node 24.14.0: 108 original tests plus one exhaustive parity test. Final Windows
`npm test` passes **119 Node tests and 1 Vitest/PGlite test**, with zero failures.
The foundation owner corrected a guard false positive on Python decorator
`@spaces.GPU` with a regression (`b02eb1e`). CI for the local engine commits has
not run; published foundation `452c1c5` has passing Windows/Linux/browser CI and
a Ready/HTTP-200 placeholder deployment. No GPU job, audio rendering or upload ran.

History audit: 130 unique retained text blobs; no binary/audio/model/key files,
credential-pattern matches, student/family payloads or English scripture payloads
found. Historical contact and authorship are preserved. Marker scans do not
establish publication rights. `trope/PROVENANCE.md` inventories publication gates:
Binder/Avery table rights and printed-source verification; exact MAM license/
attribution/share-alike handling and Daniel's fixture decision; Hebcal attribution.
Pinned SoulX subset license was checked, copied and its 244 tokens verified; its
source tree contains no NOTICE. Existing havarotjs MIT license remains intact.

Preparation and audit evidence remain outside both repositories at
`C:\Users\dsbog\AppData\Local\Temp\bneimitzvah-engine-20261015\` (filtered
checkout, commit map, audit JSON, original helper, Windows/Linux test logs).
Next: review this local result, resolve the publication decisions, then publish
only with the applicable authorization. The primary collaborator owns STATE.md.
