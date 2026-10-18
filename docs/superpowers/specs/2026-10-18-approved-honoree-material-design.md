# Approved booklet text for scoped honoree links

## Settled decisions (Daniel, binding)

On 2026-10-18 Daniel approved the before/after Torah blessings from CRC's existing Beit Mitzvah booklet, including its English translation and required credits, for invited CRC honorees' private, expiring own-aliyah links. This grants no public booklet or audio sharing. No visible transliteration, automatic invitations, mail or real roster import. Existing bearer, tenant, revocation, expiry and repository protections remain binding.

## Root implementation decision

Implement a closed server-side projection and same-transaction catalog loader. Keep the existing guest DTO/page and management UI. This work does not activate material, issue links or apply migrations. Use a separate worktree from the frozen database-release source, initially based on4d808c320affbc0e3cbfc8f11042cf6c7edfcb89.

The approved source is the existing parsed legacy-beit-mitzvah feed: feed SHA2568ea640e392a88dd4fee2825004b2db3c5d228025cf3685325dc709f7936c8266, provenance SHA256f046833c25cda7c153a6131d05425a388528ed60797b0fd84463adf5625f8978, catalog identity781faabb7b219f76d684841fc91c9f13aecabc38b5cf5c7302144f5f80f41126. Use existing parseServiceFeed against the stored immutable row and trusted pins; no artifact downloader, alternate corpus, runtime source configuration, raw block passthrough or global material cache.

Project only the exact unitPair(slot) before/after IDs. Require the selected units' observed closed shape: stanza Hebrew strings followed by plain English strings; no unsupported notes, rubrics, rich spans, render segments or nonempty captions. Accumulate each contiguous Hebrew run until its following English block, preserving each source string and joining Hebrew lines with newline separators. Consume every block exactly once; reject orphan English, trailing Hebrew, missing/duplicate units, wrong family, malformed Unicode or unsupported fields. For this exact source the before runs are[1,1,5] and after[5,2] in both slots. Never zip the seven Hebrew blocks against the fewer English blocks or rewrite divine names/Unicode/wording.

Return only the existing GuestMaterial fields. Use material version crc-booklet-torah-blessings-v1. Credits are the nonempty source license.attribution followed by source license.spdx, verbatim in that deterministic order. Existing material bounds, projection digest, version, slot IDs and ordered-credit equality remain authoritative. No transliteration, bare variants, page pointers, companion units, other-family information or audio enters the result. Real source text and notices stay outside Git, fixtures, logs and screenshots.

Extend the internal projectMaterial callback by retaining release as its first argument and adding the already-held AccessTransaction and live check. Both issue/read projection calls pass that same transaction and preserve all existing checks before/after awaits and final response fences. Load the exact release tenant/catalog row through the existing service-learning data accessor within that transaction, after the existing lifecycle-before-release lock order. Check row tenant/id/identity, exact approved feed/provenance pins and parsed identity. Call live after the read and after parsing. No new pool, independent authorization snapshot, cookie/request input, provider fetch or transaction is introduced. Runtime composition wires this narrow loader; absent/withdrawn/unapproved material still fails closed.

## Bounded implementation and verification

One Sol worker owns new honoree booklet-projector/material-loader modules, the two narrow service callback call sites and runtime composition wiring, plus new synthetic projector/loader tests. Preserve other modules and all schema/operator/reference files. Do not recursively delegate. Focused tests must prove lossless multiline grouping, exact IDs/source/credits/version, rejection of unsupported or incomplete content, no field leakage, same transaction/live-check ordering and wrong tenant/catalog/pins denial. Existing synthetic service callbacks remain compatible. No client/UI redesign is authorized by this slice.

Existing private bytes are in the primary checkout's ignored .local-logs/service-feed-check directory. A separately scoped private compatibility check may read them and report only hashes/counts/digests/booleans, never text or notices. Do not copy those bodies into this worktree. Mocked/synthetic checks cannot establish actual source compatibility. Independent authorization/tenancy review and final integration gates precede deployment. Owner-only material activation requires its own reviewed contract after the schema and projector are accepted; runtime INSERT privileges must remain absent.

## Open items that wait on Daniel

Sharing the separate blessing recording is not covered by this text permission. Adult self-edit policy remains unresolved and denied. Neither grants this implementation permission to activate audio, material releases or guest links.
