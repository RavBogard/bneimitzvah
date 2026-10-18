# Scoped honoree links — checkpoint B, 2026-10-18

## Settled decisions (Daniel, binding)

The mission permits signed, expiring, revocable no-login honoree links as the sole guest surface. It does not permit a public student page, family form, recording library or general prayer-catalog proxy. Explicit family actions remain quiet: no automatic mail or invitations. Generated voices and student recordings remain outside this milestone. Root owns architecture and final integration; Sol implements; bearer access requires independent adversarial review.

This extends the [grounded family-honors design](2026-10-18-family-honors-design.md). The authenticated form is checkpoint A/C and can proceed independently. The following mechanisms are root's bounded implementation decisions, not additional statements attributed to Daniel.

## Scope and material boundary

One link serves one current, nonempty aliyah group and its exact start/end span. Multiple people in that group may share the link; the response contains none of their names. Project only student first name, ceremony date, own span, exact approved before/after Hebrew/English blessing blocks, required credits, material version and hard expiry. Omit transliteration, other readings/groups, identifiers, contacts, form/history, activity and audio. Bound the response to 96 KiB and material including credits to 64 KiB.

The preferred source is the already acquired legacy Beit Mitzvah artifact, source `edfef85e1e06737d5fea1c33970f23961f599fc5`, catalog identity `781faabb7b219f76d684841fc91c9f13aecabc38b5cf5c7302144f5f80f41126`. Exact morning units are `torah.blessing-before-the-torah-reading@bm-shacharit` and `torah.blessing-following-the-torah-reading@bm-shacharit`; Havdalah uses their explicit `@bm-maariv` counterparts. No inferred companions or silent translation substitution.

Existing private CRC permission does not by itself establish invited no-login extraction permission. The pinned feed supplies a general rights notice but no per-unit credit mapping. Guest activation requires the specific permission and applicable notices to be established and recorded. The hidden/not-primetime Shirei edition is not a fallback. Garbled Drive PDF extraction is not a rendering source. The Drive WAV and CRC Music metadata are candidates only; no audio mapping or guest permission is established.

## Credential and browser contract

Use canonical `hl1.k1.<16-byte random ID>.<32-byte random nonce>.<32-byte MAC>` with unpadded base64url components and a fixed maximum of 128 characters. Use a dedicated domain-separated signing purpose, exact deployment/origin and key ID; no readable student/tenant/expiry claims. Constant-time verification precedes database lookup. Persist only a purpose-separated hash of the complete token, opaque ID and immutable issue metadata. Never log or persist plaintext tokens. This is separate from session, invitation and delegated-practice credentials.

Hard expiry is the earlier of issue plus 90 times 24 hours and the start of the day seven calendar days after the ceremony in America/Chicago. The boundary is exclusive; refuse already-past expiry. Use authoritative time, never browser time. Date postponement cannot extend an existing credential. Explicit reissue creates a new credential and revokes the old one.

The guest landing is standalone static HTML with restrictive CSP, no Next hydration, third-party resources, analytics or cookies. Capture and remove the fragment immediately; reject queries. Keep the token in memory only and send it in a closed, bounded JSON POST body with omitted credentials, no redirects, no-store and no-referrer. Clear token/material and abort on concealment, departure, bfcache return or expiry. Use safe text/span rendering. No app-controlled token-bearing logs, traces, storage, HAR or cache. Do not claim control over every provider's telemetry or the ability to recall previously delivered text.

All invalid, revoked, expired or stale-scope credentials return the same private/no-store 404 envelope. No Set-Cookie, redirects, session creation or diagnostic detail. Recheck eligibility, expiry and cancellation after waits and before return.

## Durable invalidation and locking

Current-value hashes alone are insufficient. Maintain durable, monotonic student reading epochs and per-start group epochs. Changes away and back cannot revive a credential. Backfill existing students/current groups and cover new rows; keys/counters cannot be reset, deleted or decremented by runtime DML.

Date/slot/disable changes and relevant Torah assignment/verse/confirmation changes increment the reading epoch in the same transaction. A winning honors AFTER INSERT compares its actual predecessor's normalized aliyah objects, incrementing only added, removed or changed groups. Participant IDs, names, Hebrew components, relationships and order are meaningful. A losing CAS insert or rolled-back transaction must have no epoch effect. Unrelated ark or parental-blessing edits preserve unchanged groups.

Keep A's SHARE-lock/CAS behavior. Add a dedicated internal link-write intent that acquires the student UPDATE lock on first acquisition, with earlier identity/grant locks and guardian locks SHARE in the established order. Never upgrade a previously held student SHARE lock. Issue/revoke/reissue then inspect a committed head while excluding conflicting student changes.

Order locks as tenant, issuer user, authenticated session only for issuing operations, membership, exact role grant, student, actual guardian, confirmed Torah assignment, material lifecycle, reading epoch, group epoch, link. Sort multiple same-level targets. Guest validation may first discover immutable issuer/student IDs with an unlocked scoped lookup, then acquire authority locks in order and reread the credential and all bindings. A lookup itself grants no authority. Relevant mutations and lifecycle withdrawals must follow a compatible order.

Every read requires an enabled tenant/student, verified issuer, enabled membership, live original grant and actual guardian when issued as parent; it does not depend on the original login session remaining active. Current context/group readiness and captured epochs must agree. Terminal grant/guardian revocation, explicit link revocation and material withdrawal cannot be undone by re-enabling a row or changing content back. Existing membership suspension semantics remain a live denial, not a new login-session dependency.

## Mutations and material releases

Issue/revoke/reissue require real base guardian/admin authority, exact cookie-origin protection and no practice header. Issue requires the caller-reviewed honors version, context hash and start, then verifies known slot, canonical confirmed Torah, resolved cuts, no outstanding reading review, a saved form reviewed against that context, a nonempty exact group and an active explicit guest-material release. A matching hash alone is insufficient.

Use same-tenant attribution/composite foreign keys, FORCE RLS, immutable issue/binding fields, one-way revocation and compact payload-free audit events. Keep at most one non-revoked link per student/start; replacement is explicit and atomic. A global per-student mutation UUID/digest records original operation outcomes across actors. Receipts never remint credentials. Return the raw URL only for the original acknowledged operation; hash-only storage cannot recover a lost URL. Recovery requires explicit reissue and invalidates the previous link.

Guest-material approval is a separate owner-controlled immutable release identity with exact catalog/slot mapping, projection version and required notices. Runtime cannot approve rights. Withdrawal is terminal, including withdrawal of its source catalog. No production approval row is created while permission/notices are unresolved.

## Implementation and acceptance

B1 may implement pure token/expiry validation, additive schema/epochs/triggers, dedicated authenticated operations and guest-read composition against synthetic injected material. All actual operations must fail closed without an approved release. UI author C owns the private form; B does not edit its components or introduce guest/issue controls yet. Do not rewrite migration 0022 or earlier history. No production SQL, material acquisition, activation, audio, mail, new services or provider scopes.

Meaningful checks cover canonical tokens/domain/origin/hash/expiry/DST; strict request and response projections; cross-tenant/base-mode/issuer authority; original UUID recovery without remint; permanent change-away/back invalidation; unrelated-group preservation; losing CAS/abort/audit rollback; real physical PostgreSQL issue/read/revoke/reading/form/lifecycle races and runtime privileges. Re-run the accepted A CAS/receipt cases after trigger/access changes. Root coordinates any native window; no self-launched browser/capture/native lane. Independent bearer review and exact hosted CI precede release.

Production needs a separately reviewed source-pinned migration operator preserving existing schema, roles and data. The fixed 0021 operator is not reusable; its empty-table assumptions no longer establish current readiness. Never run generic migration or old wrappers against production as a shortcut.

## Open items that wait on Daniel

- The pending narrow invited-honoree permission answer and applicable notices for the exact legacy blessing extracts. This blocks real guest-material activation, not B1 synthetic infrastructure or the authenticated family form.
- Adult student honors self-edit remains under its earlier unanswered policy question and is denied meanwhile.
