---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/sign-in/page.tsx","src/app/account/page.tsx","src/app/invitations/accept/page.tsx","src/app/invitations/open/route.ts","src/app/auth/email/route.ts","src/components/portal/entry.tsx","src/components/portal/google-sign-in.tsx","src/server/http/fragment-landing.ts"]
---

# Portal entry and invitation acceptance

Mode: Operate. Targets: /, /sign-in, /account, /invitations/accept, plus isolated /auth/email and /invitations/open confirmation landings. Audience: students, parents, tutors and CRC admins using a phone, tablet or laptop, sometimes during Zoom lessons. Task: authenticate or explicitly review and accept an invitation, with clear identity/access state. No provider bypass, illustrative student account, licensed text or unimplemented tool affordance.

## Direction contract

THESIS: Annotated score makes the task and its exact current state easy to locate; this entry slice prepares the reading-first workspace without manufacturing a dashboard or passage.

OWN-WORLD: White working field, ink #222c35, restrained burgundy #8a0a14 actions and teal #0b6a62 confirmed state, quiet rules, deliberate system UI typography and generous spacing. Ordinary labeled controls stay familiar.

STORY: The visitor signs in with Google or an email link. An authenticated recipient reviews intended access and a named target before one explicit acceptance. A signed-in person sees only server-authorized roles; unavailable workspaces have no fabricated destination.

FIRST VIEWPORT: A compact CRC masthead sits over a two-column entry: a short task heading/reading-first explanation left, the actual state or form right with one fine rule. At phone widths the form follows the heading in one column, every action remains touch-sized, and no horizontal scrolling is needed. Loading/unavailable/anonymous/authenticated/invitation states use this same stable composition.

FORM: Annotated score, grounded candidate 1 and Impeccable's pick, selected by Daniel in structured chat after the local chooser was inaccessible on his phone. Existing direction seed: 75c22686. Code-first; no comp approval round or additional questionnaire. Signature interaction: the neighboring action area updates in place with a focused, announced result. Session/practice authority never enters a URL or persistent browser storage. Emailed bearer links have the narrowly isolated fragment exception below; their tokens never enter request URLs or application-router state.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Scope and states

Actual cookie-based HTTP only: session summary, Google/magic-link sign-in, sign-out, invitation preview and reviewed acceptance. The React entry/workspace never receives a raw invitation token. Its review binding remains in component memory and is submitted only in the acceptance POST. HTTP errors use fixed actionable messages; application diagnostics exclude provider responses, tokens, mailboxes and sessions. Native hosting logs require their separate acceptance below. Unknown availability fails closed. A signed-in view provides role labels and honest next-stage availability rather than links to unimplemented pages.

The explicit exception is the dedicated raw-HTML confirmation landing: `/auth/email#token=…` for magic links and `/invitations/open#token=…` for invitations. Its first synchronous script captures the exact validated fragment into lexical memory, immediately clears it with `history.replaceState`, and enables “Continue signing in” or “Review invitation.” No GET redeems or stages a token. Only explicit activation sends a same-origin body POST to `/api/auth/email/confirm` or `/api/invitations/open`. Invitation staging still precedes separate identity verification, review and acceptance. Reload/expiry requires reopening the latest email. No token enters React hydration, Next routing, DOM attributes, history state, storage or telemetry. These landings load no Google script, third-party resource or reporting endpoint and use no-referrer/no-store plus a hashed CSP. Their restrained single-column layout reuses the selected palette, system typography and familiar touch-sized controls.

Google entry uses the official GIS popup button after a server nonce/CSRF challenge from `/api/auth/google/challenge`; its callback submits the credential in a body POST to `/api/auth/sign-in/social`. The Google library loads only on the clean sign-in view. Preparing, waiting, confirming, cancellation/expiry and unavailable states keep email fallback visible. Fixed local destinations replace the old query-code redirect flow. Acknowledged logout clears the browser-binding cookie and invalidates the current UI generation, including late callbacks; it does not promise cancellation of an already-in-flight POST. Public query verification/callback routes remain retired. Source and local synthetic checks do not establish real Google, email or native hosting-log acceptance.

Implementation font constraint (Astra): system UI stack for this auth slice; no external font request or binary exception. Hebrew typography, mark rendering and passage/tool composition are a later bounded task using actual licensed-source content. No shipping raster in this slice. Independent review and documentation are supplied by the primary; implementation worker does not recursively delegate.

## Account destination — 2026-10-16

The explicit /account route reuses PortalEntry with automatic student entry disabled. The home route still opens a single-role student's reading directly. Workspace Account and sign out passes through the existing departure guard to this stable signed-in account surface; Sign out and role links retain the existing layout and authority flow. Root and independent review inspected actual SDK desktop (1440x1000) and phone (390x844) captures. The two affected SDK/PostgreSQL suites passed 12/12, with production build and focused checks passing. See ACCOUNT-FINISH-REVIEW.md and BROWSER-LEAVE-REPAIR.md in docs/planning/2026-10-15-kickoff. Hosted checks remain a separate integration gate.


## Query-free entry finish — 2026-10-16

Independent source and desktop/mobile visual review accepted the confirmation surface. Root inspected the refreshed 1440x900 and 390x844 captures after the ready-state copy correction; Annotated score hierarchy, touch-sized action and recovery links remain clear. The affected real SDK/PostgreSQL browser suite passed 7/7 after disposable case-budget isolation, with all 41 browser cases covered across integration runs. No shipping raster is used. Real Google popup/mobile behavior, delivered email and matching-deployment native logs remain separate acceptance gates in QUERY-FREE-AUTH-REVIEW.md.
