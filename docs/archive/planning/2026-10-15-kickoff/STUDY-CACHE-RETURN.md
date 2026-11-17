# Public normalized chapter cache — 2026-10-16

Published checkpoint: `67e7175`, all four hosted jobs green in run `38889034114`; matching Vercel deployment `7116979547` succeeded. This publishes persistence only, with no authorized text endpoint yet.

Bounded implementation for Astra's approved study adapter. No endpoint, UI,
authority composition, provider request, licensed passage fixture, commit or push.
Other workers' files and `STATE.md` were preserved.

Files: `src/server/study/cache.ts`, `src/server/data/study-cache.ts`,
`src/server/db/study-cache-schema.ts`, additive migration
`0009_sefaria_text_cache.sql` with generated journal/snapshot, one schema export,
`tests/app/study-cache.test.ts` and
`tests/postgres/study-cache.integration.ts`.

The global `sefaria_text_cache` stores complete normalized chapter verses and
reviewed provenance, SHA256, fetch/expiry times and a closed composite identity:
Sefaria/v3, parse5 8.0.1, normalization policy v1, trusted canonical book/chapter,
closed MAM Hebrew and JPS 2023 English edition keys/languages. Their exact reviewed
titles and licenses are verified against provenance under the policy namespace.
No assignment, tenant,
contact, session, user or raw provider fields. Canonical chapter limits and the
current namespace are database constraints, so arbitrary cache keys cannot grow
the table. The finite current namespace contains at most 929 canonical chapters.

Read and write validation rejects unknown envelope/nested properties, malformed
or nonnormalized strings, oversized content, edition/provenance changes, missing
or reordered canonical verses, mismatched hashes and invalid/future timestamps.
Hebrew written/read text and paragraph markers are recomputed from typed segments.
English text requires the exact reviewed English edition; explicit null segments
and missing English edition remain representable. Hashing uses the canonical
`{ verses, editions }` projection, preserving the adapter's hash semantics despite
PostgreSQL jsonb key ordering. `createStudyCacheEntry` accepts a complete adapter
chapter result; selected page subsets cannot pass the chapter count check.
The app's compact JSON size limit and PostgreSQL's spaced `jsonb::text` size
limit are both 512 KiB; PostgreSQL may reject content slightly below the app limit
near that boundary. This is an explicit fail-closed availability bound.

Initial generation exposed the reviewed JPS title in JSON snapshot CHECK SQL,
which the repository data guard correctly rejected as a publisher marker. Astra
selected closed edition keys (`mam`, `jps2023`) for the persisted identity instead;
full titles stay in exactly validated provenance. The migration/snapshot were
regenerated before publication. No repository guard was changed or bypassed.

Lifetime is exactly 24 hours. Expired valid rows are misses, expired corrupt rows
deny, and no stale fallback exists. Reads sample time after the database query.
Runtime has SELECT/INSERT and UPDATE on the four content/time columns only;
changing identity columns, DELETE and TRUNCATE are denied. No tenant grants,
privileged function or cleanup powers were added. The existing reader is not
yet wired to this cache; request coalescing and bounded fetch composition remain
with the subsequent adapter/authority integration.

Approved cleanup decision: refresh overwrites the same finite canonical key.
An operator with migration-owner authority can delete expired rows in bounded
batches using the expiry index, for example:

```sql
WITH expired AS (
  SELECT ctid FROM sefaria_text_cache
  WHERE expires_at <= CURRENT_TIMESTAMP
  ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
)
DELETE FROM sefaria_text_cache WHERE ctid IN (SELECT ctid FROM expired);
```

Parser/policy changes require a reviewed schema migration and operator cleanup
of obsolete namespaces. Existing conventions use additive migrations, not an
application down-migrator. The disposable PostgreSQL test demonstrates dropping
and reapplying only this reconstructible public cache table from its exact SQL,
leaving tenant tables/history alone. A permanent deployed removal should use a
compensating migration; do not rewrite applied migration history.

Verification: focused cache synthetic **47/47**; final combined existing adapter,
cache and schema checks **109/109**; typecheck passed. Real PostgreSQL **16.15,
4/4** passed via the root's private loopback port 55439 configuration, using a
fresh unique database and restricted synthetic login that the fixture removes.
It verifies actual grants/denials, meaningful namespace/chapter/payload/size/hash/
TTL constraints, corruption rejection, expiry, operator cleanup and table-only
rollback/reapplication. Evidence: ignored
`.local-logs/study-cache-postgres-final.log` records the final edition-key and
read-clock schema/code gate. Synthetic checks include time advancement across
the read and invalid clocks on misses/writes. Repository guard **1/1** passed
without changes. No live provider content was fetched.

Root's independent persistence review found no blocker at this bounded scope;
the final closed edition-key representation was selected by Astra. Root retains
full integration/CI and release ownership.
Next: compose cache/fetch outside authority transactions, then implement and
adversarially review the approved two-stage endpoint with real revocation races.
