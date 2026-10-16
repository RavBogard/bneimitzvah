# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated within the existing Cowork plan: Next.js App Router, TypeScript, CSS modules, npm, Postgres on Neon with Drizzle, Better Auth, and Playwright. Exact supported versions are implementation decisions. Hosting remains Vercel within the mission's budget and approval rules.

## Users

CRC b'nei mitzvah students, including children under 13, practice their assigned reading. Tutors teach their assigned students. The rabbi/admin sets assignments and congregation defaults. Parents follow their linked children's work through a read-only parent view.

Daniel confirmed on 2026-10-15 that all three settings matter: independent practice on a phone, independent practice on a laptop or tablet, and tutor-led lessons. Much tutoring happens on Zoom.

## Product Purpose

Put a student's own reading, text tools, chosen commentary, translation drafts, and practice recordings in one place. The 1.0 success criterion remains a real CRC student and tutor completing a real reading with Daniel as rabbi without a workaround.

## Operating Context

- A rabbi creates a student, supplies a ceremony date and parent contact, reviews the proposed reading, and assigns the exact verses. Tutors can adjust readings and assign sources within their permitted student relationships.
- Practice happens independently and during Zoom lessons. Layout and verse identification must support both small screens and shared discussion of the same passage. Video conferencing itself is outside the planned product.
- Daniel confirmed parent sign-in with an explicit switch into linked child practice views, including sibling selection. The ordinary parent view remains read-only. The exact authorization/session mechanism is an open architecture decision; the interface must make the active child and role clear.
- Google sign-in and email magic links remain the planned entry methods; passwords are out of scope.

## Capabilities and Constraints

- Hebrew includes vowels and cantillation, verse-aligned translations, trope family colors, optional transliteration, word analysis, and verse-based translation drafts.
- Commentary is available broadly, with congregation defaults and tutor/rabbi assignments surfaced first. Generated summaries require rabbi approval and clear attribution. No student chatbot in 1.0.
- Tutor recordings provide an interim learning source. Generated chant stays unavailable to students until the prescribed automatic checks and Daniel's listening review pass.
- One congregation launches first; tenant isolation belongs in the schema and access layer from the beginning. Second-tenant onboarding is deferred.
- Public source control must contain no student/family records, recordings, credentials, licensed translation payloads, rendered audio, or model weights. Approved redistributable engine fixtures need their own provenance; an already-public source is not evidence of permission.
- Cost, publication, licensing, and student-release gates in MISSION.md continue to apply. Recording retention is unresolved.

## Brand Commitments

The displayed name is "CRC B'nei Mitzvah". The plan calls for continuity with the haftarah project's color tokens and Hebrew font support. That project's adult printed-sheet layout is reference material, not a settled layout for this student portal. JPS 2023 remains the reference translation; source credits and generated-content labels remain visible.

## Evidence on Hand

- Authority: `docs/planning/2026-10-15-kickoff/MISSION.md` and the dated amendments recorded in the project-manager review.
- Implementation proposal: `docs/planning/2026-10-15-kickoff/PLAN-CODE-2026-10-15.md`.
- At review start there was no application, runnable interface, or student usability evidence in this project.
- The haftarah source commits cited in the plan resolve locally: main reference `5b2530f72c544a9dab028d73076d47744b8252dc`, engine reference `380b1b20095285db373478db1057db2c6bd04b60`. The current remote tip must still be checked before extraction.

## Product Principles

- Make the assigned reading and next useful practice action easy to find.
- Support understanding and practice together, with detailed tools available without overwhelming the reading.
- Keep child identity, parent access, and tutor responsibility explicit.
- Preserve textual and musical provenance; readiness is demonstrated before student release.

## Accessibility & Inclusion

Mixed Hebrew/English directionality, full cantillation mark rendering, and text enlargement are essential to the content. Plan keyboard-accessible controls and non-color identifiers for trope families. Phone, tablet, laptop, and Zoom teaching scenarios are confirmed requirements. Additional individual accommodation needs have not yet been established.
