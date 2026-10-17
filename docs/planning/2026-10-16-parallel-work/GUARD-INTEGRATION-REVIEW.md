# Guard integration review — 2026-10-16

**Decision: the minimal voice/font union is compatible on the frozen bytes below; preserve both changes. A separately reproducible escaped-JSON privacy gap remains and should receive a bounded repair before claiming comprehensive private-schema protection.** No union was applied to a live branch. Only this report and ignored synthetic review files were authored.

## Scope and evidence boundary

Read the root working agreement, MISSION/STATE, project-manager amendments, COORDINATION and voice `HUMAN-ALIGNMENT-RETURN.md`. Root and UI base are `25accb72158b64c76b08c0d0989ad4c6a0b22c72`; voice checkpoint is `24778d30953ab73ed1e623ab3030b018b09d67e4`. UI policy/assets were an uncommitted snapshot, not a finished design checkpoint. Its later commit requires a hash comparison or rerun. Source hashes were rechecked after the probes.

This review reuses voice's accepted two-pass alignment/retiming review and does not reassess DSP, pronunciation, models, release or design. No active app/voice/UI source, Git index or branch was changed. No network, provider, download, model, real recording or private text was used. Existing permitted font bytes were copied for byte-integrity tests; all added payloads were synthetic.

Review driver and complete results are local and ignored: `.local-logs/parallel-guard-review/run-review.mjs`, `results.json`, `regression.tap`, `escaped-schema-repro.txt`, `union-repo-policy.mjs`. Final isolated overlay: `C:/Users/dsbog/AppData/Local/Temp/parallel-guard-overlay-1PgRzB`. Subprocesses use the existing `tests/helpers/isolatedEnv.mjs`; every synthetic Git mutation is confined to disposable OS-temp repositories. The first driver attempts exposed line-ending and synthetic-index-cleanup setup issues; both were corrected before the final zero-failure run.

## Exact overlap and recommended union

`scripts/repo-policy.mjs` is the only overlapping changed file. The changes affect different functions:

- Voice adds `PRIVATE_BENCHMARK_SCHEMA` beside the credential/license constants and adds `if (data && PRIVATE_BENCHMARK_SCHEMA.test(text)) problems.push("private chant-benchmark record");` to `entryProblems`. Carry both additions and the new test in `tests/repo-policy.test.mjs`.
- UI replaces only `missingFontPair`: iterate distinct `FONT_ASSETS` families, select that family's members, and require all members if any is present. Preserve independent candidate/index sets and checks. Do not retain the old single-global-pair loop after installing multiple families.
- Carry UI's `scripts/font-assets.mjs`, `.gitattributes`, `public/fonts/PROVENANCE.md`, expanded `tests/font-assets-policy.test.mjs`, and exact Bricolage font/notice pair together. The registry keeps the original Hebrew pins and adds `family` metadata plus the Bricolage pins; exact paths, sizes and SHA-256 remain mandatory. No directory or extension allowance is needed.
- Preserve voice's new `scripts/private-paths.mjs` and the import plus additional lexical/resolved `insideGitWorkingTree` conditions in `privateBenchmarkDestination` in `scripts/trope-benchmark-pack.mjs`. These have no UI conflict. Do not overwrite this script with UI's older baseline.

The exact minimal policy union, synthesized from frozen voice policy plus UI's `missingFontPair` body, is in the ignored `union-repo-policy.mjs`. Its SHA-256 with LF source newlines is `f8a8c6afb6267a41b68ecb003dca15c2c56eee7578d03d9c6aa484a11807f5b8`. This is a compatibility candidate, not a repair for the inherited gap below.

`inspectFontBytes` continues normal content checking for every notice, including an exactly pinned notice. A font alone bypasses ordinary UTF-8 content scanning only after its exact immutable byte pin matches. Counterfeit/modified font bytes always reject; other font paths always reject. No new font allowance can make private JSON in `trope/`, fixture directories, font directories or either exact `OFL.txt` path pass the literal-schema guard.

## Verification

Final Windows/Node run: **26/26 existing focused tests pass; 10/10 independent probe groups pass; zero failures.** The focused suites were voice `repo-policy.test.mjs`, existing `repo-policy-review.test.mjs`, and UI `font-assets-policy.test.mjs`, run against the combined policy in OS temp.

- 360 direct assertions: nine private schema families, all six reviewed data extensions, engine/portal/trope fixture paths, both font directories, both exact notices and config allow-lists. Ordinary source schema declarations remain accepted.
- 56 schema-bearing data/notice paths reject as untracked candidates, in the index after safe replacements, and as index-only files after deletion. Two schema-bearing same-size counterfeit fonts reject in all three states. Both official unchanged pairs and per-family notice requirements pass the existing tests, including `core.autocrlf=true` round trips.
- Ignored synthetic data remains local; force staging still rejects after a safe candidate replacement. The existing attachment-tab, credential sanitation, renamed font, symlink/ancestor and independent staged/candidate checks remain green.
- Actual voice `privateBenchmarkDestination` rejects output under all three active worktrees, synthetic `.git` directory and `.git` file roots, a junction into a Git root and a lexical Git root that resolves outward through a junction: seven path cases. Seven invalid/existing/missing/broken-parent inputs reject. A fresh destination under a private non-Git parent passes. These probes made no private output and wrote nothing to active worktrees.

No full app suite, actual-repository scan, hosted CI or deployment was run by this bounded review. Integration must run the exact final tree's required gates. This review does not independently re-prove all filesystem races, platform aliases, hard-link behavior or operating-system I/O failures; prior accepted voice review remains the evidence for those cases.

## Finding: admitted JSON can escape the schema regex

**Medium, inherited from voice's new heuristic; not caused by font allowances.** This valid synthetic JSON has a private schema after JSON decoding, but `entryProblems` and the full combined repository inspector return no finding when it sits in `trope/escaped-schema.json` or `tests/fixtures/trope/escaped-schema.json`:

```json
{"sch\u0065ma":"chant-human-alignment/v1"}
```

`JSON.parse(payload).schema` is `chant-human-alignment/v1`. The inspector accepts both untracked candidates and index blobs hidden by safe worktree replacements. The exact payload/probe is preserved in ignored review evidence. Escaping characters in the schema value likewise falls outside the literal regex's intended matching semantics; the direct key-escape reproduction is the executed integration case.

Recommended separate bounded repair: preserve existing regex/content checks, and additionally decode valid JSON data records before comparing their string schema values with the private schema family matcher. Cover JSON and line-delimited JSON, valid escapes in key and value, and explicitly define nested record handling. Keep legitimate JavaScript declarations and synthetic test-source strings permitted; do not broadly reject source-code substrings. Preserve ordinary malformed-data handling and candidate/index independence. Add regression cases at the two admitted paths and both exact font-notice paths, then obtain independent review of the repair before declaring this gap resolved.

Two other inherited limits remain explicit: unmarked per-passage target files are admitted inside engine/fixture allow-lists (already disclosed by voice), and a raw JSON object renamed with a source extension is outside the current `DATA` check. Pure-JSON parsing independent of extension could address the latter without treating arbitrary source text as a record, but that is a separately bounded policy choice. Neither is a reason to remove the tested union protections.

## Safe integration sequence

1. Wait for UI's frozen checkpoint/return and compare the source/asset hashes below; preserve all active edits until then. Voice is already frozen at the checkpoint above.
2. Integrate voice's accepted work into an integration branch while preserving root's backend work. Then carry UI's frozen work, resolving `repo-policy.mjs` by the explicit union above. Registry, notices, attributes and tests move together. Do not resolve by taking either whole policy file.
3. Address the concrete escaped-JSON finding with a small separately reviewed policy change; carry its regression tests. This report accepts union compatibility, not a broader claim that every representation of a private record is rejected.
4. Run policy/font/private-destination checks and the actual repository guard on both candidate and indexed content. Then run the required broader integration checks/CI on the exact combined commit. Verify byte pins after checkout. No generated-chant, provider, student-visible or deployment permission follows from these local checks.

## File pins (SHA-256 of actual worktree bytes)

Full copied-input list is in ignored `results.json`; CRLF worktree source hashes differ from normalized Git/LF blobs. Critical policy and path pins:

| Source | File | SHA-256 |
| --- | --- | --- |
| Root | `scripts/repo-policy.mjs` | `1d448a94b1f24846c687503db2a46efeeeb14a1ac381927f2da82b96deebd716` |
| Voice | `scripts/repo-policy.mjs` | `1e0ae066dba82c4e1b8944e9ca8faff64c2654288d9bf1dc72bb093226240f3b` |
| Voice | `tests/repo-policy.test.mjs` | `f3630c428a01c2e0af5c01f1288e95d3992a087f837a8c4115da26b2c08bbc19` |
| Voice | `scripts/private-paths.mjs` | `49b9063936051a12e0ea9cbf8be585fc6e62f984effe8bc17e223f6fd387ead8` |
| Voice | `scripts/trope-benchmark-pack.mjs` | `6b1ec4d5e0345479c870b15d88113ba5a6dd81f9630a930007ea2d6eadce1bdd` |
| UI | `scripts/repo-policy.mjs` | `4d5141af49bbfc7f7363b7b6dd5ab7c3b65ba9333b0346017721d4d1f619ba0a` |
| UI | `scripts/font-assets.mjs` | `aef5426d8f47fb99443df335030ff30de6478f05f1b5141484009b386b793e42` |
| UI | `tests/font-assets-policy.test.mjs` | `3104320c1bfc496ed72e24382244406c350db49cbe9ce10c2eaec5b41b9de217` |
| UI | `.gitattributes` | `90cc9867ed6620e79f544fcece1308729a9d3694b69f0c5ac02cfe35c28ff19e` |
| UI | `public/fonts/PROVENANCE.md` | `3739c90b574966961826f29f236ff29aa5eb64004aabe703f34afddbc103705c` |
| UI | `public/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf` | `93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165` |
| UI | `public/fonts/noto-serif-hebrew/OFL.txt` | `9b9fe028b5ba74d231659a1bbaf0ed09b11e759d1ca6a070999e16d151616b47` |
| UI | `public/fonts/bricolage-grotesque/BricolageGrotesque.ttf` | `413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682` |
| UI | `public/fonts/bricolage-grotesque/OFL.txt` | `4b5a7d8f37f5602621c8a8d7358a6a2e71317e6c231c661e15aef0275d3e07ba` |

**Next action:** root coordinator can reuse this union/evidence and assign the bounded escaped-JSON repair after freezing the integration inputs. This reviewer has finished its assignment and has no queued source changes.

## Follow-up: bounded repair independently accepted

The later [private benchmark guard review](PRIVATE-BENCHMARK-GUARD-REVIEW.md) accepts the decoded-JSON/JSONL repair, including common leading-BOM framing, on separately frozen hashes. Root focused tests pass 42/42 and a fresh synthetic overlay combining the repaired guard with this saved two-family font snapshot passes 44/44. This resolves the concrete escaped-schema finding above within the documented record/encoding contract. The original union hashes/probes in this report remain historical evidence; no live UI/voice integration or broad guard resource-bound claim follows from that acceptance.
