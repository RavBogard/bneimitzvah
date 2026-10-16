# Portal design preparation

Status: **Annotated score confirmed by Daniel in structured chat** after his phone could not reach the localhost chooser. This selection is binding; no further direction questionnaire is needed. Product truth is in root PRODUCT.md. Workflow remains code-first. Daniel confirmed direct entry into the assigned reading, with practice tools beside it; no overview-first landing screen.

## Shared brief

A learner practices their own assigned passage with tools and tutor-selected material attached to the same verse. The same references must remain easy to locate during Zoom tutoring. Phones, tablets and laptops all matter. The initial operational surfaces are sign-in, staff roster/student setup, and the parent/student role shells; the study and audio surfaces follow the phase plan.

Keep the CRC identity, existing trope-family meanings, full Hebrew mark support and familiar web controls. No invented progress scores, streaks, generated audio availability or populated personal accounts. Avoid both the generic dashboard of statistic cards and an imitation parchment/manuscript. The reading remains readable without optional panels.

## Grounded directions before selection

Ordered for the Impeccable concept pass:

1. **Annotated score:** readable verse rows and phrase-aware focus; type and spacing borrow notation's precision, without staff lines or musical-instrument controls. Familiarity is its risk.
2. **CRC mural geometry:** congregation-specific color relationships and crisp grouping, with verse selection as the signature gesture; avoid decorative geometry in the reading.
3. **Bilingual exhibition labels:** carefully aligned original text, translation and compact attribution; tools reveal context beside the selected verse.
4. **Community wayfinding:** strong current-location labels and clear role/child identity, with consistent reference markers across reading and tools.
5. **Library reference system:** crisp reference hierarchy and a stable reading/work area, supported by a compact source/tool panel. Selecting a reference highlights the same verse across panels. Risk: excessive density could make a learner's page feel like staff administration.
6. **Shared study ritual:** generous reading space with optional tools nearby; one selected passage remains the common focus for learner and tutor. No physical table decoration.
7. **Service sequence:** clear passage order and stable section markers, with a selected verse carried across read/practice/notes states. Sequence is navigation, not an invented completion score.

Impeccable direction seed `75c22686`, Operate mode, assigned candidate 5. Candidate 1 is the single alternate preferred by the design lead. A user choice overrides the assignment. Operate mode limits a visual world's contribution to type, palette, density and one signature interaction; navigation and controls remain conventional web UI.

## Catalog comparison to complete before presenting directions

- Variable-font specimen: potentially competitive for text enlargement and mark inspection; judge it as the ordinary product shell with immediate typography adjustment, not a font playground. Inspect its reference images if presenting it.
- Dense Japanese web: decline for this learner surface because tiny text and many boxed modules impair Hebrew/Zoom reading. Retain disciplined compact spacing for staff tables, without tiny type.
- Transit wayfinding: potentially competitive for consistent trope-family markers across passage and tools. Keep standard navigation and the established trope meanings; do not invent routes, transfers or practice scores. Inspect its reference images if presenting it.
- Vertical media feed: decline; full-viewport snapping and unlabeled action rails obstruct passage context and tutor reference. Retain a clearly visible active passage and comfortably reachable labeled controls.
- Botanical folio: decline; neither growth imagery nor botanical state labels describe this task. Retain stable text scale and position when switching context panels.
- Airline wallet: decline; ticket/coupon framing does not help Torah practice. Retain clear distinction between proposed and confirmed staff changes and an explicit cancellation state.

The typography and transit reference boards were inspected in the browser. The decision page presented the assigned reference direction, annotated-score pick, competitive alternates, declined directions with retained disciplines and a conventional option. Daniel subsequently selected **Annotated score** through structured chat because his phone could not reach that local page. Existing direction seed `75c22686` remains the provenance; this explicit selection supersedes its assigned candidate. Transient payload `.local-logs/design-direction.json` is reference material, not an outstanding approval.

## Confirmed direction and first implementation boundary

White working field, clear Hebrew reading with vowels/cantillation, restrained burgundy/teal, generous verse spacing, precise references and tools attached to the selected verse. Reading remains primary; on phones tools must be reachable without crowding the passage. Preserve established trope meanings, plain web controls, explicit role/child identity and visible attribution. No parchment, invented progress, fake student data, fabricated audio or dashboard-first diversion.

The first authorized UI slice is functional auth and invitation acceptance at `/`, `/sign-in` and `/invitations/accept`. It uses actual session/HTTP results, honest unavailable states and explicit role labels. There is no clickable destination for a workspace that does not exist. Hebrew text and tool controls wait for the actual licensed-source pipeline; their absence is not papered over with sample passages. Astra approved a deliberate system UI stack for this initial surface, with no build-time font download or binary asset exception. The surface contract is `.impeccable/surfaces/src-app-page-tsx.md`; fresh independent review and post-build DESIGN.md/sidecar extraction remain required before publication.

## Initial entry surface: author checkpoint

Implemented files: `src/app/page.tsx`, `src/app/layout.tsx`, new `src/app/globals.css`, `/sign-in/page.tsx`, `/invitations/accept/page.tsx`, and `src/components/portal/{entry.tsx,api.ts}`. Focused client-contract tests: `tests/app/portal-ui.test.ts`. No auth/server/runtime/dependency or provider change in this slice; other workers' host changes are separate.

Actual relative cookie-auth HTTP drives loading, unavailable/retry, Google and email-link sign-in, minimal authenticated-role/empty-access views, sign-out, invitation review, explicit acceptance and uncertain/changed-review recovery. All requests use no-store, same-origin credentials, no-referrer and bounded size/time; response diagnostics are discarded. Invite tokens never enter client code, URL construction, logs or browser storage. Acceptance sends only the transient review binding and uses a synchronous submission gate plus disabled controls. An interrupted acceptance never silently retries or claims a confirmed outcome. Existing exact authentication-error flag produces a fixed notice; arbitrary query values are not forwarded. Headings announce state changes, action results receive focus, and returning to email entry focuses its heading. Mixed-direction target names use `bdi`.

Author evidence: **26/26** focused client/auth-HTTP/portal-route tests passed (7+9+10), final typecheck passed, production build passed, and the single Impeccable detector run returned `[]`. Tests use transport-only client stubs for parser/fetch boundaries, separately from existing real-SDK restricted-database HTTP suites. Actual local production UI received503 from its session API and correctly showed the unavailable state; desktop1440, phone390 and phone200% text checks passed without horizontal overflow and with a touch-sized retry action. One bounded spacing fix was made after the first capture; the second capture confirms it. No additional author polish loop.

Fresh finish-review packet: required captures `.impeccable/review/desktop.png`, `mobile.png`, `mobile-zoom.png` (all opened and visually checked); contract `.impeccable/surfaces/src-app-page-tsx.md`; selected score card in transient `.local-logs/design-direction.json`; detector `.local-logs/portal-ui-detect.json`; build/test/typecheck/capture logs `.local-logs/portal-ui-*.log`. Code-first has no approved comp or generated decision raster; no raster ships with this UI. Captures prove the real unavailable state only. Actual authenticated form/invitation browser interaction checks are an independent private-harness gate, not claimed by these screenshots. Launch after a production build with `npm run start -- --hostname 127.0.0.1 --port 3027`; temporary author server is stopped after capture. The final accessibility-only live-heading attribute does not change the captured appearance.

Next action: primary's fresh finish/adversarial review and actual SDK/browser acceptance, then documenter extracts token-bearing DESIGN.md and `.impeccable/design.json` from the reviewed implementation. The primary handles the exact sidecar guard allowance. This checkpoint does not declare the full portal, Hebrew typography or phase complete, and no human tester beyond Daniel was involved.

## Initial entry surface: documentation result

After the fresh finish review's `ship` disposition, the implemented entry palette, type, spacing, shape, layout, controls, and states were recorded in root `DESIGN.md` and `.impeccable/design.json` (schema version 2). This is a scan of `src/app/globals.css` and the actual portal entry component, checked against the reviewed desktop, phone, and enlarged-text captures; it describes only `/`, `/sign-in`, and `/invitations/accept`. The deliberate system UI stack applies to this entry slice. Hebrew reading typography, actual passage/tool composition, and any licensed content remain unimplemented and are not canonized by the documentation. The sidecar carries component snippets, motion, breakpoints, and tonal display metadata; the frontmatter owns normative tokens. No shipping raster was added.
