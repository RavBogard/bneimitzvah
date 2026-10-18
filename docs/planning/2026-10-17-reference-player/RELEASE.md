# Reference player release

Main checkpoint `9d190d2181d61854c1a22aadf303eec16812efbf` is deployed at https://beitmitzvah.centralreform.org. Production deployment `dpl_HyuUqFBYqrMGAmmQp2Ae9KWBXEn9` is READY, with exact source, project, team, Production target and canonical alias independently verified. All four [hosted checks](https://github.com/RavBogard/bneimitzvah/actions/runs/39080744764) passed at this SHA. Anonymous session/reference requests return401 with private/no-store; the public entry returns200.

The release adds verified PocketTorah playback within assigned readings, canonical word highlighting/selection, word and verse repeat, and native pitch-preserving speed adjustment. Independent pitch shifting remains deferred. The source catalog retains timing holds and ambiguous-reference selection requirements. Administrator playback is enabled; student release remains false pending Daniel's source listening acceptance.

The private catalog was published exactly once. A separate reviewed native GET-only build verified its SHA256, removed the build payload before Next compilation, and scanned all linked output successfully (868 files /88,866,959 bytes). That bootstrap deployment is `dpl_7vqMwZNApAX4iyTGersSj1rnnmND`; protected attempts are immutable and must not be replayed. Earlier failed scans and the safe-file-identity regression remain documented in the private operational history. No raw catalog, indices, licensed corpus, audio or credentials entered Git or normal Git builds.

Production-only catalog SHA and student-release=false settings were saved and read back. The initial array-body CLI request failed without creating these entries; independent inspection found that CLI50.35 serializes plain objects but coerces arrays incorrectly. Corrected single-object creates succeeded. Existing private-store scope and permissions were unchanged.

Native browser evidence covers real source bytes/decode/play/seek/highlight/repeat for two representative recordings, and broader synthetic authority/lifecycle cases. It does not establish iOS hardware behavior, source listening acceptance, sample-accurate looping, or an authenticated production-function catalog read. Daniel's live administrator playback check remains pending.

Pure Hebrew syllable/stress and STEP grammar foundations are included but not yet wired to the interface. Generated voices are excluded from1.0; unfinished student recording work remains checkpointed outside this release. No production database migration, real roster import, invitation or email occurred.
