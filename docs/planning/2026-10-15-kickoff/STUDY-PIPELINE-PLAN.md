# Assigned-reading text pipeline — proposed Phase 3 slice

Research only, 2026-10-15. Astra retains architecture and acceptance ownership.
No application changes, passage requests, licensed payloads, provider setup or
source-repository writes were made. Only public version metadata was requested.

**2026-10-16 adapter amendment:** Astra accepted the bounded page, transport and
two-stage authority architecture below. Only the four study adapter modules,
pinned parse5 dependency and synthetic tests have now been implemented; see
`STUDY-ADAPTER-RETURN.md`. Later authorized in-memory probes established the
tested MAM structures and v3 chapter contract without storing passage data.
The initial research-only statements above describe the earlier research pass.
No route, authority composition, cache or student-visible text exists yet.

## Confirmed starting point

MISSION rulings 5–7 and 12 require portal-owned Sefaria fetching, Torah first,
marked Hebrew and JPS 2023 as reference translation. Existing assignments hold
ordered canonical verse rows, a confirmed status and revision. `portal/service.ts`
re-expands ranges against the trusted catalog and checks exact row equality;
`data/portal.ts` locks assignment rows before loading verses. The current GET
`/api/students/:id/reading` returns metadata only. Preserve that fast contract.
`hebcal_cache` and `data/reading-cache.ts` validate calendar metadata; neither is
a text store. Blessing kinds exist, but `expandReadingRanges` explicitly requires
a separate liturgical definition. This slice must not invent blessing references.

Read-only source inspection: haftarah observed HEAD
`d6e2e2ee4cd0d17a727c78af3f041ebfc0a2edcf`, targeted `scripts/fetch.mjs`
(`fetchPassage`, `flattenVerses`, cleanup), `scripts/translations.mjs`,
`site/app/sefaria.js` and version names in `customs/crc.json`. Useful precedents
are exact edition selection and chapter/verse alignment. Do not copy the source
fetcher unchanged: it lacks streamed limits/deadlines, joins English by array
position and returns provider HTML. Its regex cleanup is not an HTML security
boundary. Existing `trope/text.mjs` documents MAM reading-form semantics but is
also not a browser sanitizer or the source of full reading content.

## Proposed ownership and interfaces

| Bounded owner | Proposed files and responsibility |
| --- | --- |
| Text adapter worker | `src/server/study/{versions,sefaria,normalize,types}.ts`: closed edition registry, bounded provider client, canonical validation, structured plaintext projection; synthetic offline tests |
| Persistence worker, sequential schema ownership | New text-cache schema/data adapter and additive migration: constraints, restricted runtime grants, cache validation; real PostgreSQL check |
| Authority/HTTP worker | `study/service.ts`, portal HTTP literal route/runtime composition: two-stage authorization, immutable snapshot comparison, fixed response projection; independent adversarial review |
| Frontend worker after DTO approval | Existing study/workspace components only: escaped Hebrew/English text, credits, loading/partial/retry/stale states, late-response discard |

Proposed separate GET `/api/students/:id/study-text`: closed, unique query fields
`mode`, `kind`, `assignmentId`, `assignmentRevision`, `translation`, `offset`.
IDs/revision come from the authorized metadata DTO; no client reference, URL,
edition title or arbitrary language is accepted. Initially translation key is
`jps2023`; later picker entries require individually reviewed registry entries.
Each independently authorized page contains at most 100 assigned verses and
eight source chapters, in canonical assignment order. Offset is a bounded
integer into that server-owned list, never an authority token; return the next
offset and exact assignment identity/revision. Page limits are proposed operating
bounds, not upstream API limits. Keep practice handles in the existing header.

## Delivery sequence and revocation boundary

1. Resolve the exact configured host before any provider work. Under existing
   `withStudentCapability(read)` or `withPracticeCapability(read)`, capture the
   live actor/session/membership/grant/relationship identities, authority revision,
   child-context identity where applicable, student revision, and confirmed
   assignment ID/revision/ordered refs. Apply existing literal mode rules, with
   no role union. Check the requested assignment/page against that snapshot.
2. End the authority transaction. Only then read the public text cache or fetch
   public references derived from the snapshot. No upstream request carries a
   student, tenant, session, contact, practice handle or incoming request headers.
3. Build a complete validated page in memory. Re-enter the same live capability,
   re-read/lock assignment and verses, and compare the complete captured binding,
   including context/student revisions. Revocation, logout, context exit/switch,
   reassignment or changed confirmation must discard the page. Authority denial
   keeps existing fixed statuses; assignment/snapshot drift returns fixed409.
4. Project only the page and provenance after this final check, with existing
   private/no-store/no-referrer headers. Final SHARE locks serialize against
   revocation; no provider call holds them. This linearizes authorization at the
   final read, not a promise to erase content already delivered or in flight.
   Clients discard late responses for a different child/context/revision and
   clear text on logout; no localStorage, service-worker or public CDN text cache.

## Provider and content boundary

Build only HTTPS `www.sefaria.org:443/api/v3/texts/{canonical chapter}` URLs.
Use chapter sections, not arbitrary multi-chapter range flattening; join selected
verses by validated book/chapter/verse keys. Fetch at most two chapters concurrently,
with an overall eight-second page deadline, per-request five-second deadline,
512 KiB streamed decoded body cap per chapter and 2 MiB aggregate cap. Bound both
declared and actual bytes, validate UTF-8/JSON/content type, cancel readers and
abort outstanding work on failure/disconnect. Use no automatic retry initially,
`redirect:error`, `credentials:omit`, `cache:no-store`, and only an explicit
Accept header. Never follow metadata links or relay provider bodies/errors.

The [official v3 contract](https://developers.sefaria.org/reference/get-v3-texts)
supports exact `language|versionTitle` selection, repeated version parameters,
missing-version warnings, and `fill_in_missing_segments=0`. Request MAM and the
selected translation explicitly; never use `primary`, `translation`, `all`, or
fill from another edition. Validate book/ref/section/depth, exact edition and
language, warnings, chapter array shape and trusted numeric verse counts before
mapping. Reject missing, extra, empty or wrong-type Hebrew segments; no
truncation, cross-language zip or silent version substitution. Chapter arrays
provide positions, not independent per-verse IDs: the provider's documented
order is trusted after structural validation, not proved from the words.

Prefer default-format source plus a non-executing HTML parser, never direct DOM
rendering. Extract known MAM paragraph markers and qere/ketiv into explicit
metadata before reducing to plaintext; remove note bodies/markers, map known
line/space entities, reject unsupported semantic structures. Preserve vowels,
accents, meteg, maqaf, paseq, sof pasuq and meaningful combining characters.
Use NFC canonical Unicode normalization, never NFKC or mark stripping; reject
malformed Unicode and unexpected control/bidi-override characters without
discarding meaningful Hebrew combining characters.
Represent written/read alternatives separately; do not silently collapse the
display into the chant reading form. Render React text nodes with `lang=he`
and RTL styling. Keep translation notes out of the first DTO rather than merging
them into words. Parser/dependency choice remains Astra's bounded implementation
decision; current regex helpers must not become the sanitizer by assertion.

`return_format=text_only` is documented, but this metadata-only investigation
does not establish its preservation of MAM qere/ketiv/paragraph semantics.
Neither that format nor live response shapes were passage-tested here. Before
text delivery, verify those cases in a private runtime contract probe and
synthetic parser tests; retain no fetched passages in Git or review output.

## Runtime cache, provenance and failure states

Add a separate global `sefaria_text_cache`: provider/API/parser/policy version,
canonical chapter, exact edition/language, normalized segments, safe provenance,
content hash, fetched/expiry timestamps, unique composite key and bounded checks.
No student/tenant/assignment/contact fields or raw provider JSON. The cache is
global because its source content is public, not because access to assignments
is public. Restricted runtime receives only necessary SELECT/INSERT/UPDATE;
no owner role, tenant-table privilege expansion or public cache endpoint.
Validate envelopes, timestamps, exact keys, provenance and canonical segments on
both read and write. Start with 24-hour TTL, no silent expired fallback, bounded
request coalescing and expiry cleanup; use a parser/policy version change to
invalidate older entries. Runtime PostgreSQL only, outside Git/build artifacts.

Every delivered edition includes title, creator/publisher credit, Sefaria and
edition/source links, exact license URL, normalization/change notice, fetch time
and hash. Links come from the reviewed registry, not executable provider HTML.
On 2026-10-15 the public
[Genesis versions metadata](https://www.sefaria.org/api/texts/versions/Genesis)
confirmed exact MAM and JPS titles with CC-BY-SA and CC-BY-NC respectively.
[MAM's maintainer](https://en.wikisource.org/wiki/User:Dovi/Miqra_according_to_the_Masorah#1._Free_Content_License)
links CC BY-SA 4.0; credit Dovi/Hebrew Wikisource contributors, retain share-alike
and modification notices for affected text. The
[JPS publisher](https://jps.org/books/the-jps-tanakh-gender-sensitive-edition/)
explicitly identifies RJPS content as CC BY-NC 4.0. Preserve noncommercial terms;
neither edition becomes MIT code. Existing mission already chooses JPS 2023;
these confirmed licenses do not create a new permission request. Validate each
requested book's returned edition/license metadata: Genesis metadata alone does
not prove whole-catalog coverage. Sefaria's
[copyright guidance](https://developers.sefaria.org/docs/usage-of-our-name-and-logo)
requires version-specific reuse checks; missing/unknown licenses are unavailable,
not an inferred permission. Other picker editions remain outside this slice.

No confirmed assignment: existing honest empty state. Hebrew unavailable or
invalid/cache failure: fixed503 with retry, no invented text. A validated Hebrew
page may return an explicit translation-unavailable state when only the selected
English edition is absent; never replace it. `needsReview` remains visible and
never triggers an automatic reassignment. Logs contain fixed category/status
only, no response content, identities, raw URLs, contact or provider diagnostics.

## Acceptance and remaining decisions

Offline synthetic tests: Unicode/mark preservation, MAM semantic structures,
hostile HTML/entities, exact canonical mapping, malformed/oversized/slow/redirect
responses, missing or mixed editions/licenses, poisoned cache, every mode and
cross-tenant denial, and a controllable fetch barrier proving final revalidation.
Real PostgreSQL races must cover reassignment and authority/context revocation
between preflight and delivery; existing practice/write races do not prove this
new read path. Browser checks then cover credits, RTL, keyboard/responsive text,
partial/retry states, and child switching with stale responses. Repository guard
must still reject licensed text fixtures. No audio/player release is implied.

No new material licensing blocker was found for the mission-selected editions.
Actual implementation gates remain: approve this DTO/page/cache proposal; choose
the parser and explicit written/read representation; privately establish v3 MAM
semantic coverage and each supported book's exact editions; implement and obtain
independent auth/tenancy review. Blessings, commentary, word data, other editions
and generated chant retain their separate definitions/gates. Full product before
any student/tutor pilot remains binding; this proposal is not release approval.
