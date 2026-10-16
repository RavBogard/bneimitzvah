---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/sign-in/page.tsx","src/app/invitations/accept/page.tsx","src/components/portal/entry.tsx"]
---

# Portal entry and invitation acceptance

Mode: Operate. Targets: /, /sign-in, /invitations/accept. Audience: students, parents, tutors and CRC admins using a phone, tablet or laptop, sometimes during Zoom lessons. Task: authenticate or explicitly review and accept an invitation, with clear identity/access state. No provider bypass, illustrative student account, licensed text or unimplemented tool affordance.

## Direction contract

THESIS: Annotated score makes the task and its exact current state easy to locate; this entry slice prepares the reading-first workspace without manufacturing a dashboard or passage.

OWN-WORLD: White working field, ink #222c35, restrained burgundy #8a0a14 actions and teal #0b6a62 confirmed state, quiet rules, deliberate system UI typography and generous spacing. Ordinary labeled controls stay familiar.

STORY: The visitor signs in with Google or an email link. An authenticated recipient reviews intended access and a named target before one explicit acceptance. A signed-in person sees only server-authorized roles; unavailable workspaces have no fabricated destination.

FIRST VIEWPORT: A compact CRC masthead sits over a two-column entry: a short task heading/reading-first explanation left, the actual state or form right with one fine rule. At phone widths the form follows the heading in one column, every action remains touch-sized, and no horizontal scrolling is needed. Loading/unavailable/anonymous/authenticated/invitation states use this same stable composition.

FORM: Annotated score, grounded candidate 1 and Impeccable's pick, selected by Daniel in structured chat after the local chooser was inaccessible on his phone. Existing direction seed: 75c22686. Code-first; no comp approval round or additional questionnaire. Signature interaction: the neighboring action area updates in place with a focused, announced result; no private state enters a URL or persistent browser storage.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Scope and states

Actual cookie-based HTTP only: session summary, Google/magic-link sign-in, sign-out, invitation preview and reviewed acceptance. No raw invitation token is read by client code. Bindings remain in component memory and are submitted only in the required acceptance POST. HTTP errors use fixed actionable messages; no provider response, token, mailbox or session is logged. Unknown availability fails closed. A signed-in view provides role labels and honest next-stage availability rather than links to unimplemented pages.

Implementation font constraint (Astra): system UI stack for this auth slice; no external font request or binary exception. Hebrew typography, mark rendering and passage/tool composition are a later bounded task using actual licensed-source content. No shipping raster in this slice. Independent review and documentation are supplied by the primary; implementation worker does not recursively delegate.

## Account destination — 2026-10-16

The explicit /account route reuses PortalEntry with automatic student entry disabled. The home route still opens a single-role student's reading directly. Workspace Account and sign out passes through the existing departure guard to this stable signed-in account surface; Sign out and role links retain the existing layout and authority flow. Root and independent review inspected actual SDK desktop (1440x1000) and phone (390x844) captures. The two affected SDK/PostgreSQL suites passed 12/12, with production build and focused checks passing. See ACCOUNT-FINISH-REVIEW.md and BROWSER-LEAVE-REPAIR.md in docs/planning/2026-10-15-kickoff. Hosted checks remain a separate integration gate.

