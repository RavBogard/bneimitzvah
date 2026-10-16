# Independent recording foundation review — 2026-10-16

**Accept this bounded pure-policy foundation. No blocking finding remains in the reviewed frozen files.** This is not acceptance of recording access, uploads, playable media, storage destruction, a scheduler or a student-visible feature; none exists in this slice.

The reviewer did not author or modify `src/server/recordings/{policy,types}.ts`, the author's tests, spec or return. Root identified the original tenant UUID incompatibility; the author repaired it before this independent run. This review owns only this report, `tests/app/recording-policy-adversarial.test.ts` and ignored local review evidence. No staging, commit, database, provider, UI or real media operation occurred.

## Reviewed contract and findings

- **Closed boundaries:** capture accepts only media declaration, byte length and duration. The separate operation schema accepts only operation, recording ID and expected revision. Tenant/student/actor/context/storage/consent/release fields reject at these boundaries. Internal metadata is explicitly not a client payload schema or authorization proof. Unknown kinds/states, prayer/generated audio, extra fields, symbols, hidden properties, custom prototypes and accessors fail closed. Nested media/verse/configuration inspection also avoids ordinary input property reads and getters; throwing structural proxy traps yield frozen generic errors without diagnostics.
- **Compatibility:** exact `crc` and other bounded text tenant keys pass without case conversion or trimming. Recording/student/verse IDs remain canonical lowercase UUID-shaped strings. Existing schema evidence is `src/server/db/tenant-schema.ts`: tenant ID is text, student ID is UUID, and `assignmentVerse.id` at the `assignment_verse` definition is UUID. The future reference adapter must bind `verse.verseId` to that persisted **assignmentVerse** identity and independently verify tenant, reading classification, selected student and current assignment. Syntactic acceptance does not prove existence or grant access; no foreign-key persistence is implemented here.
- **Lifecycle:** explicit submit alone moves private student metadata to submitted. References cannot submit. Begin-delete and complete-delete are ordered; deleted/deleting states cannot submit or restore. Successful retries at the exact current revision are no-ops. Stale retries, mismatched IDs and revision-exhausted changes conflict. Record identity, tenant/student/verse and media survive every allowed proposal. Output trees are detached copies and deeply frozen, including no-op proposals. The code performs no write or notification, so future atomic compare-and-swap and durable notification deduplication remain necessary.
- **Retention:** the exact MISSION amendment is **students' submitted recordings, one year after their ceremony**. The core applies only to currently submitted student metadata; private, reference and deletion states receive no invented retention rule. Calendar-year anniversaries, inclusive deadline equality, February 29 clamping and Gregorian century rules match independent calculations. Legitimate rescheduling changes eligibility while submitted; it cannot revive tombstones. Invalid/noncanonical dates reject. The function never reads a clock or infers trust from its string parameters.
- **Authority and privacy:** the spec identifies existing `createPracticeService(...).withPracticeCapability` and `createAccessService(...).withStudentCapability` as future composition points without changing their accepted services. It explicitly excludes parent-dashboard recording rows/IDs/counts/timestamps, distinguishes exact linked-child context from tutor/admin access, and requires fresh authority after every external wait. The new modules export no access grant, endpoint, public URL, playback capability or generated-chant release path. The MIME allowlist remains a declaration boundary, not verified media.

The freshness requirement is an adapter contract, not enforcement by this pure function: a future deletion transaction must obtain fresh authoritative ceremony date **and student revision**, trusted current date and recording revision, then recheck them atomically before marking deleting. A reschedule during an external wait must invalidate the old decision. Once deleting, access stays denied and the deletion worker resumes independently of submitted-only retention eligibility. Complete-delete must be worker-only after confirmed physical destruction. The present code makes no claim to enforce these unimplemented operations.

## Executed independent checks

Isolated Windows Vitest run: **92 passed, zero failed, two files**: author's corrected **84** cases plus reviewer's **8** adversarial tests. Source hashes matched before and after the run. The subprocess received only `tests/helpers/isolatedEnv.mjs`'s environment. Local logs/driver/pins: `.local-logs/recording-review/{run.mjs,focused.log,results.json}`.

The added probes check:

1. CRC/text tenant compatibility through submit and both deletion transitions; no identity normalization; persisted verse UUID syntax and rejected verse references.
2. Internal metadata/authority-field smuggling across capture/operation boundaries and unsupported provenance kinds.
3. Getters at every metadata, media, verse, command and configuration property; none execute.
4. Throwing `getPrototypeOf`, `ownKeys` and descriptor traps at top-level/nested boundaries, sanitized generic errors, and a benign proxy whose ordinary `get` trap is never needed.
5. Null-prototype nested input, detached deep-frozen results, caller mutation and immutable no-op transition outputs.
6. All **21** valid-kind/state/operation combinations, exact-revision no-ops, stale requests, wrong recording IDs, identity preservation and revision exhaustion.
7. **2,922** actual ceremony dates in 1899/1900/1999/2000/2099/2100/2399/2400, each checked immediately before and at its anniversary using an independent native UTC-calendar calculation; **5,844** retention decisions.
8. Submitted-only eligibility, rescheduling, tombstone permanence, rejected boxed/structured dates and invisible/trailing characters.

Existing 84 cases additionally cover malformed media/numeric bounds, default/custom configuration, full state validation, malformed calendar dates, years 0001/9998/9999 and concurrency proposals. Root reports coordinated typecheck/build passed on the frozen foundation before these new reviewer tests; this reviewer did not rerun broad app/Node/build/CI or browser gates. Root should include the new test file in its final typecheck/integration gates.

## Frozen file pins

SHA-256 of worktree bytes; no source changed during review:

| File | SHA-256 |
| --- | --- |
| `src/server/recordings/policy.ts` | `0820d4a4c60943324da429c1c0adac4f386bff6b77e52675f2878d3114bcd9f2` |
| `src/server/recordings/types.ts` | `a6af5f665305df931e14353dc86ee3bc212d906599ef9b311e5fd77479584c17` |
| `tests/app/recording-policy.test.ts` | `3add3dac99b00aaaf578469612a3ca1c90a026f382582cbb44ddec9508b21d88` |
| `tests/app/recording-policy-adversarial.test.ts` | `67eadd6ac31c126162240d53aa8b68fe4602ae5a24bd141372a4edbc7766ec2c` |
| `docs/superpowers/specs/2026-10-16-recording-foundation-design.md` | `a9a6b4b26980de82d8f5c514afa9ca0dfbe65c554edf92d7309107190b832861` |

## Integration limits and next action

Root can integrate this foundation with the adversarial tests and run the exact final source's required gates. No further source repair is requested by this review. The submitted-only rule and text tenant compatibility must remain intact.

A later storage/HTTP milestone needs its own recording-access adversarial review with actual authority/session/context revocation and sibling switching, atomic revisions/ceremony rescheduling, private delivery, verified media, complete-delete proof, caches/versions/retries and deletion-job persistence. Scheduler timezone, private-draft/reference retention, storage cost and offline leases remain scoped future decisions. No production, release, spend, real-person testing or generated-chant approval is implied here.
