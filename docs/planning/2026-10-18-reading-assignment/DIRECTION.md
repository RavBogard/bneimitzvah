# Reading assignment simplification — 2026-10-18

Daniel reports that assigning Torah is awkward and confusing: too many forms, unclear actions, hidden date suggestions, and no easy reading dropdowns. This bounded milestone improves the existing staff assignment editor; it does not reopen the study visual direction or broaden access.

## Decided here

- Start from the student's saved ceremony date. When the editor opens, request the existing read-only calendar proposal automatically and show its authoritative service slot, reading date, portion and available choices. No fabricated defaults for missing slots, holidays or unavailable calendars.
- Keep custom selection primary. Offer accessible book, starting chapter/verse and ending chapter/verse controls, plus one native dropdown for the date's available calendar readings. No automatic assignment or replacement on opening or choosing a suggestion.
- Initialize from the confirmed assignment when available. Preserve multiple ranges, recorded/unrecorded aliyah boundaries and the existing cut-only provenance path. Detailed reference entry, boundaries and Hebrew preview remain available through progressive disclosure.
- Use one clear review action followed by explicit confirmation. Retain signed server review, expiry, conflict and uncertain-write recovery. Old responses must not overwrite a new draft or appear for another student/session.
- Preserve the current fonts, colors, Hebrew behavior, desktop/phone layout conventions and protected dialog lifecycle. No schema, provider, source-license or server authorization changes are planned.

## Ownership and acceptance

Sol implements editor/helpers and updates affected existing tests. A separate Sol reviews lifecycle and preservation behavior and owns independent browser checks. Root owns direction, final integration, publication and the short state update. Work occurs in the isolated `reading-assignment-flow` checkout; other ongoing honors/integration work is preserved.

Accept when date suggestions appear without preliminary form submission, ordinary ranges can be selected without typing reference syntax, advanced controls no longer dominate, and no assignment changes before final confirmation. Verify current/multiple-range preservation, missing-calendar recovery, stale-response fencing, conflict handling and privacy. Run focused local tests/types, actual browser integration and one batched desktop/mobile visual inspection, with at most one visual correction round; retain required full CI/build/repository checks for the exact release.
