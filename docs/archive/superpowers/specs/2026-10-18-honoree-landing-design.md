# Honoree landing and guest transport

## Settled decisions (Daniel, binding)

Continue the revised1.0 product with family honors and scoped honoree links. Preserve the chosen code-first Song session direction. No visible transliteration, generated voices, student-recording activation or new service spending. Real blessing permission and notices remain unresolved; no production material approval is inferred.

## Root architecture and ownership

Extend the existing [honoree contract](2026-10-18-honoree-links-design.md), with its strict own-aliyah projection, hash-only credentials, live authority, permanent invalidation and bounded hard expiry. This slice activates only the anonymous guest-read transport and standalone landing. Authenticated issue/reissue/revoke/receipt/status adapters and controls remain a separate assignment after the private-form integration. Keep real material projection absent and real approval rows empty.

Backend ownership: the honoree service's transport-return adapter, its HTTP module, the narrow dispatcher branch and focused tests. Frontend ownership: new `src/server/http/honoree-landing.ts`, `src/app/honoree/route.ts` and focused landing tests. Workers share the checkout and do not change one another's files. Root owns this spec and the surface brief.

## Authoritative remaining life

Keep the exact guest JSON DTO unchanged. A successful guest POST additionally carries `X-Honoree-Remaining-Ms`, a canonical positive decimal safe integer no greater than90 days in milliseconds. Compute its conservative floor from the same authoritative database/wall/monotonic clock and hard expiry at the service's final return barrier. Do not derive it from browser time, HTTP Date, a second independent read or unauthenticated caller input. Preserve the existing cancellation/expiry-after-COMMIT protections; do not add an unguarded async gap after a final return check. A transport-specific internal result may carry DTO and remaining life together without exposing internal clocks.

Runtime cleanup can await after the service barrier. Therefore the guest dispatcher performs one final synchronous fence after the runtime scope resolves: response-keyed private metadata supplies the absolute expiry, the server wall clock must remain before that expiry, and the whole scope's monotonic elapsed time is subtracted conservatively from remaining life. Missing metadata, cancellation, elapsed expiry or malformed lifetime denies uniformly. There is no second database read or await after this fence.

The browser records monotonic time immediately before fetch. After the bounded response is fully read and validated, subtract the full elapsed fetch time from the server's remaining life. Reject missing/invalid/nonpositive metadata; render only while that conservative monotonic deadline remains positive. Never use browser wall time to authorize or extend content. Schedule bounded timer chunks for long lifetimes and recheck before rendering. Server expiry remains authoritative; this client clearing is not a claim to recall previously delivered text.

## Transport and landing

Expose only exact `/api/honoree/read` through a dedicated uniform-denial boundary. Preserve closed methods/query/Origin/body/size checks and generic404 outcomes, with no-store/no-referrer protections. Do not activate prepared authenticated honoree endpoints as a side effect. Guest reads use the capability alone and do not read or set authentication cookies; the client sends `credentials:omit`, `redirect:error`, `cache:no-store`, `referrerPolicy:no-referrer`.

`/honoree` serves static HTML directly, without Next hydration, analytics or third-party resources. Its first script captures and removes the fragment immediately, rejects query-bearing or malformed links, and retains the token only in memory. Use hashed inline script/style CSP, restrictive resource/frame/base policies and no-store headers. Existing first-party font assets may be reused; no new assets or third-party fetches. Do not read/set cookies or persist credentials/material. Browser navigation may carry preexisting same-origin cookies; they confer no guest authority and are not used by this handler.

Render only the existing closed DTO: student first name/civil ceremony date, own verse span, approved before/after Hebrew and English blocks, credits and expiry. No participant names, IDs, other groups, contact data, transliteration or audio. Use safe text nodes and bidi-aware Hebrew; no HTML interpolation, material links or raw provider diagnostics. A generic unavailable state covers missing/invalid/revoked/expired/unreleased links. No OAuth or portal-session redirect.

Concealment, departure, persisted pageshow, timeout and expiry synchronously abort/invalidate and clear token/material. Late results cannot repopulate the document. Reopening the original invitation is the recovery path; no credential recovery storage. Civil-date formatting must not shift a calendar date through the browser's time zone.

## Acceptance and release

Backend checks cover strict dispatch/projection, unchanged authenticated-route exclusion, no cookie authority, uniform failures, exact lifetime metadata and return-boundary cancellation/expiry. Reuse and rerun the existing meaningful return-barrier tests when service code changes. Independent bearer review precedes release.

Frontend checks cover fragment removal without token-bearing logs/HAR/URLs, exact fetch options, bounded response96KiB, closed schema/clock validation, hostile text safety, conservative monotonic expiry, civil dates and every clearing/late-response path. Use synthetic material only. Root coordinates actual native/browser windows and the bounded desktop/phone light/dark capture batch; workers do not launch them. Finish review and documentation precede UI acceptance. Ordinary hosted gates and the separate0023 operator remain required; no production schema or material change is part of implementation.

## Open items that wait on Daniel

The existing invited-honoree blessing permission question and exact applicable notices remain pending. Audio permission/mapping is not included. Adult student self-edit remains denied. These hold actual content activation, not synthetic implementation and review.
