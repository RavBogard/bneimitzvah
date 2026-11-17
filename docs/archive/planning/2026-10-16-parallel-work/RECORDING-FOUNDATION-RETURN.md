# Recording foundation return — 2026-10-16

Status: implementation and focused tests ready for root integration and independent adversarial review. This is pure internal policy, **not an authenticated recording service, storage endpoint or release**. No staging/commit/deployment/provider operation performed.

## Decisions and files

- `src/server/recordings/types.ts`: immutable internal student/reference metadata, media declarations, operation/result/retention types. Generated chant has no recording kind; reference verse scope is Torah/haftarah only.
- `src/server/recordings/policy.ts`: closed data-property validation; configurable engineering bounds; generic errors; explicit revision-checked submit/deletion proposals; strict ISO-date calendar-anniversary retention of submitted student records. No standalone permission matrix or grant helper.
- `tests/app/recording-policy.test.ts`: 84 synthetic focused tests. No real media, student/family data, credentials or network fixtures.
- `docs/superpowers/specs/2026-10-16-recording-foundation-design.md`: binding decisions, backend contracts, concrete access/practice reuse points, dashboard privacy projection and fresh authority/revision checks required after external waits.

Capture metadata accepts only supported MIME/codec declaration, byte count and duration; it rejects client ownership/locator/filename/role additions. Internal record metadata is explicitly not a client schema or authorization proof. Defaults (32 MiB, 10 minutes, max revision 2,147,483,647) are engineering limits, not product rulings.

Retention takes a strict validated current date from a future trusted clock, avoiding an implicit local/UTC scheduler. It compares date-only anniversaries inclusively, clamps Feb 29 to Feb 28 and uses Gregorian century rules. A fresh authoritative ceremony date/revision must be checked before future persistence; deleting/deleted records never revive after rescheduling. Private/reference retention is deliberately not invented.

## Verification

Focused Vitest was launched using `tests/helpers/isolatedEnv.mjs` and `spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/app/recording-policy.test.ts"], { env: isolation.env, ... })`, then cleaned up. Initial result: 68 passed. After the root architecture correction below: **84 passed / 0 failed**, one file, exit 0 (2026-10-16 18:33:43 local tool output; 205 ms reported suite duration).

Root architecture correction: tenant primary keys are text (`crc`/`other`), so the initial tenant UUID assumption was incompatible with the existing schema. The corrected validator preserves exact 1–64-character ASCII alphanumeric/underscore/hyphen keys beginning with a letter/digit, with no case conversion or trimming. Compatibility and invalid-key regressions cover both student/reference metadata and lifecycle results. Recording/student/verse UUID bounds remain; the spec requires future verse adapters to bind the existing persisted reading-verse UUID. No database change was made.

Coverage includes malformed/unknown/symbol/accessor/prototype inputs, throwing proxies, nested output immutability, media/size/duration/revision bounds, generated/prayer rejection, explicit submit/idempotent retries, stale concurrent revision conflict, deletion permanence, exact deadline equality, calendar year versus 365 days, leap 1900/2000/2100, malformed current dates, bounded year endpoints and rescheduling.

Root was notified before final checks; shared typecheck/build generation is left to root to avoid parallel build artifacts. No full app/Node/CI/browser suite or deployed behavior is claimed here. A targeted optional path lookup found no reading files at guessed paths; no policy conclusion relies on it, and no database adapter/schema integration is claimed.

Frozen source SHA-256 at this return:

| File | SHA-256 |
| --- | --- |
| src/server/recordings/types.ts | A6AF5F665305DF931E14353DC86EE3BC212D906599EF9B311E5FD77479584C17 |
| src/server/recordings/policy.ts | 0820D4A4C60943324DA429C1C0ADAC4F386BFF6B77E52675F2878D3114BCD9F2 |
| tests/app/recording-policy.test.ts | 3ADD3DAC99B00AAAF578469612A3CA1C90A026F382582CBB44DDEC9508B21D88 |
| docs/superpowers/specs/2026-10-16-recording-foundation-design.md | A9A6B4B26980DE82D8F5C514AFA9CA0DFBE65C554EDF92D7309107190B832861 |

## Next action and remaining gates

Root architecture/final integration review and an independent adversarial recording-access review are required. Then root runs coordinated typecheck and integration checks on the final source. Review should confirm that the metadata validator cannot be mistaken for authorization, that future adapters bind fresh tenant/student/context/ceremony revisions, and that MIME declarations are not mistaken for verified media.

Any next persistence/storage/HTTP milestone must separately design deletion jobs/tombstones, current assignment validation, atomic compare-and-swap, actual media inspection, private playback and post-wait revocation checks. The existing parent dashboard never gains recording data; linked-child practice must bind exactly the selected live context. Private cloud fees, offline lease behavior and CRC scheduler timezone remain future gates. No new consent gate, release approval or production permission is inferred.
