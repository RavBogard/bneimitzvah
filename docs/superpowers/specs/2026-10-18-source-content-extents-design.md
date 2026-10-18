# Read bounded commentary extents without guessing positions

## Settled decisions (Daniel, binding)

Existing reference playback, verse study tools and assigned commentary belong in revised1.0. No visible transliteration. Generated voices and student recordings remain parked. Sources stay inside the reading, with explicit assignments and quiet unchanged tab return. The repository never contains real source bodies, licensed text, student data or credentials. User authorization to finish and deploy does not bypass rights, authority or independent review.

This extends the [explicit source backend](2026-10-18-selected-source-content-design.md) and [inline reader](2026-10-18-inline-source-reading-design.md). It does not change their scalar contract, write/receipt protocol, licensing scope or lifecycle.

## Accepted architectural boundary

Root accepts both a simple bottom-level parent and a same-parent final-coordinate range as one bounded extension, following separate author feasibility and independent design reviews. Source references still come exclusively from the original resolved assigned citation or full related catalog. No caller-supplied child override, URL, default child, flattening, per-segment request, schema migration or cache.

Upstream code is design evidence, not proof of deployed response fields. The [official V3 contract](https://developers.sefaria.org/reference/get-v3-texts) allows bottom sections and segments but broader refs can resolve lower. Exact returned reference and node/address facts must therefore prove the requested extent. The [upstream adapter](https://github.com/Sefaria/Sefaria-Project/blob/master/sefaria/model/text_request_adapter.py), [text model](https://github.com/Sefaria/Sefaria-Project/blob/master/sefaria/model/text.py) and [schema offsets](https://github.com/Sefaria/Sefaria-Project/blob/master/sefaria/model/schema.py) inform the conservative mapping below. Missing proof holds the source; coverage is not a reason to weaken it.

### Address and positional proof

- Full stored index-title prefix; canonical positive ASCII decimal coordinates, no aliases/coercion, each at most2147483647. New depthD is2..4. Require exact original returned ref/index title, `isComplex=false`, D exact Integer address types, nonspanning with absent/empty spanning refs, descriptor-validated dense canonical STRING start/end vectors, and a present OWN plain empty `index_offsets_by_depth` object. Missing, malformed or nonempty offset evidence holds the new profile. Scalar v1 stays separate.
- A parent has exactlyD-1 coordinates, equal start/end and no range. Accept a dense flat string array of lengthN from0 through64. Slot i maps to leaf i+1 only under the complete proof above. N describes the observed selected-edition extent; it is not the canonical/all-edition segment count, nor proof of tail absence. Never fabricate rows beyond N. Zero rows is an explicit empty observation with null bounds, not missing leaf1.
- A range has exactlyD coordinates with canonical short final suffix a-b, a<b, identical preceding coordinates, exact start/end and count b-a+1 at most64. Require exactly that many flat string positions, including empty strings. A short/long/empty array holds the entire range; no padding, filtering or partial success. Full-endpoint aliases, cross-parent/reverse/equal ranges remain held.
- Only the literal empty string represents a returned missing-text position. Preserve its full derived ref and missing status. Reject sparse/accessor/nested arrays, nulls, invalid plain text and nonempty whitespace-only strings. Preserve ordinary Unicode, NFD and whitespace in actual text. An all-missing extent is an honest ready observation for the selected edition, not absent-edition proof or permission to fetch a fallback.

### Closed projection and existing service guarantees

Keep scalar v1 unchanged. Add a closed `study-source-segments/v1` discriminated projection with original source reference, parent/range kind, exact parent and requested bounds where applicable, observed parent bounds (null/null when empty), ordered full-ref text/missing rows, and existing exact edition/provenance. Client independently checks exact keys, limits, bounds, unique contiguous refs and aggregate bytes. Capture, deep-copy and freeze descriptor-validated facts before async use and escaped serialization.

Require the same exactly-one eligible actual Hebrew/English title match, legacy-language orientation, mother language, rights and inert provenance equality, selected returned version, empty warning/missing-version evidence and absent/empty merged-source evidence. Public Domain/CC0 only; unknown or broader rights remain held. Text aggregate across all rows is at most64KiB UTF8; the complete escaped envelope is at most128KiB; transport at most2MiB. Overflow holds the whole result before rendering/serialization.

One body GET only. Preserve the public20-second phase,10-second GET including headers/body,5-second idle body limit, and browser45-second whole action/30-second endpoint/original12-second probes. Parsing and output checks remain inside absolute phase deadlines. The public abort signal must not replace final-authority cancellation. Every empty/error/rights/timeout/malformed result still stages through the existing fresh original-session/grant/student/context/reading checks; assigned head must match and related catalog must be freshly resolved. Denial or changed binding wins. No SQL transaction spans provider work.

### Reader extension

Use the existing reader, explicit edition actions, contextual headings and inherited world. Render up to64 ordered plain-text rows with exact leaf-reference labels and clear missing-text observations; no arbitrary links, concatenated bodies or guessed paragraph/comment semantics. An empty ready observation has clear copy and no automatic retry/fallback. Reading remains independent of staff checkboxes and uncertain save intents. Quiet same-owner tab return performs no source GET and retains the observed snapshot/scroll; known head/catalog changes and real authority changes still clear it. No new screen, navigation, modal, type system, ornamental treatment or global token changes.

## Acceptance and release gates

1. Author implements the narrow parser/projection/service/client/reader extension with invented offline fixtures only. Required regressions cover valid parents/ranges, zero/all-missing observations, malformed/absent/nonzero offsets, wrong node/depth/addresses, leading-zero/Unicode/unsafe coordinates, sparse/accessor/nested input, exact empty positions, absent tails/count mismatches, text/output caps, exact edition rights/provenance and synchronous deadlines.
2. Independent review adds adversarial cases and verifies final-denial/changed-head precedence, original source binding, scalar compatibility and unchanged source-write/receipt behavior. Targeted real HTTP/browser evidence checks both new extent modes, empty states, no reading mutations, retained drafts and quiet return. Reuse unchanged evidence where valid.
3. Any UI delta gets the bounded applicable Impeccable review and incumbent inventory update, without rerunning context or reopening the existing visual world. Preserve first failures and evidence limitations.
4. No content/metadata API calls are authorized by this spec alone. After an independently accepted exact offline freeze, root may separately authorize one fixed runtime shape/fingerprint check. Persist only closed structural facts/counts/digests, never response text. If deployed offset proof is absent, retain the hold and report the limit; no retry/profile relaxation by the author.
5. Final repository/isolation checks, exact Windows/Linux/PostgreSQL/browser CI and normal exact-commit deployment remain required. No SQL, production import, mail, invitation, new service spend or student-reference release is part of this slice.

## Remaining coverage

Complex/named/virtual nodes, nonempty offsets, nested or multilevel parents, cross-parent ranges, extents above64 and broader rights remain unsupported. This is bounded commentary coverage, not full Sefaria support or a1.0 completion claim.

## Open items that wait on Daniel

None for the bounded implementation. Actual-source reference listening/phone acceptance remains separately pending. Any later request to expand rights or reinterpret a binding ruling returns to Daniel; missing provider shape proof is an implementation hold, not a question for him to guess.
