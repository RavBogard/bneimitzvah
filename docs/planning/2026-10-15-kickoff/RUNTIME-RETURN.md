# Runtime foundation return — 2026-10-15

Scope: private runtime/configuration, fixed-field logging, transactional mail transport and persistent nonpersonal reading cache. No routes, UI, browser harness, provider provisioning, live mail, Git operations or source-haftarah changes.

## Implementation

- `src/server/runtime/config.ts`: explicit environment/deployment/origin contract; canonical production origin only, explicit isolated preview/local scopes; separate runtime versus operator processes; missing/contradictory credentials fail with a fixed unavailable error. Google credentials optional as a complete pair. Restricted Neon URL only; actual roles/memberships checked on first scoped use.
- `src/server/runtime/composition.ts`: lazy request-scoped Neon interactive Pool/Drizzle, existing auth/access/invitations/students plus per-tab practice factory, validated Hebcal cache and trusted numeric catalog. Reuses existing `withTenantTransaction` role closure before exposing global SDK/cache access; configured mapping and incoming-request helper both use the existing exact resolver. Pools close in `finally`; connection/query/statement deadlines and safe error listener. No import-time connection or environment read.
- `src/server/runtime/errors.ts`, `src/server/logging/logger.ts`: fixed unavailable message; logger permits only fixed codes, allowed numeric status and generated request UUID, never arbitrary error/cause/header/body/mail/URL/SQL fields. Expected access denials keep their 401/403/404 and log that status, rather than an outage.
- `src/server/mail/transport.ts`: exact official Resend REST endpoint, bounded deadline, no redirects/ambient credentials, plain-text transactional messages, strict same-origin path/token/callback allowlists; discards provider bodies and returns no token or provider identifier. Domain-level open/click tracking still requires operator disablement.
- `src/server/data/reading-cache.ts`: existing global SQL table, bounded normalized metadata only; validates namespaces, envelopes, SQL request date/calendar, unknown properties and exact ranges using existing Hebcal reader/catalog on reads and writes. No person/tenant key, contacts, licensed text or assignment writes.
- `.env.example`: added names only `PORTAL_ENVIRONMENT`, `PORTAL_DEPLOYMENT`. Full process separation and setup contract in `src/server/runtime/README.md`.

Purpose-separated HMAC-SHA256 keys derive invitation throttling and student preparation/import signing from the private auth secret, bound to deployment/origin/environment. No additional secret variables or dependencies. Secret rotation invalidates outstanding bindings and changes throttling namespaces; deliberate operator rotation remains necessary.

## Evidence

Focused runtime/logging/mail suite: 10 tests across four files pass. It includes real pinned Better Auth magic-link generation to an injected synthetic transport, PGlite persistent-cache round trips/tamper denials, exact deployment mapping, optional provider configuration and unsafe-origin rejection, missing-config laziness, negative private-object/error leak assertions, explicit 5ms fetch deadline, and mocked driver failures/cleanup/role-check-before-use. Typecheck passes. Repository guard passes without changes/exemptions; synthetic connection URLs are assembled through URL setters, and synthetic keys/secrets are generated only at test runtime. Detailed logs remain ignored under `.local-logs/runtime-*`.

These component/lifecycle tests establish no live Neon WebSocket, Google OAuth, Resend delivery or provider-side tracking configuration. PGlite component SQL is not a PostgreSQL restricted-LOGIN proof; existing separate actual PostgreSQL gates retain that scope. Primary performs integration and independent security review before publication.

Independent-review fix: callbacks can mutate an `AccessDenied` object's diagnostics or status. Runtime now copies only an exact numeric 401/403/404 into a fresh denial; it never rethrows the original diagnostic object. Malformed statuses, including throwing accessors, become fresh fixed 503 errors and log `runtime.unavailable`/503. Known denials log `request.complete` with their actual status. The focused scope test covers malformed statuses and the separate reviewer regression covers private message/name/stack/cause/provider-response mutation.

After that fix, all 11 focused tests across five runtime/logging/mail/reviewer files pass, and typecheck passes. Reviewer-owned regression file was preserved.

## Source/API decisions and next gate

Pinned Neon 1.2.0 README documents built-in WebSocket after Node 21 and Pool lifetimes scoped to a request. Node 24 supports it without another dependency. [Official Neon driver docs](https://neon.com/docs/serverless/serverless-driver) confirm interactive transactions require Pool/Client WebSockets. Its pinned CONFIG documents secure WebSocket TLS and disabled nested PostgreSQL TLS defaults. Current [Neon CLI URLs](https://neon.com/docs/cli/connection-string) contain `channel_binding=require`; pinned implementation/types expose no channel-binding/SCRAM-PLUS support. Runtime deliberately rejects that unsupported libpq option rather than pretending to enforce it; README explicitly explains separate reviewed runtime URL setup and a stop for policy/driver review if binding is required.

[Resend send-email reference](https://resend.com/docs/api-reference/emails/send-email), [maintained Resend sending guide](https://github.com/resend/resend-skills/blob/main/skills/resend/references/sending/overview.md) and [Hebcal developer APIs](https://www.hebcal.com/home/developer-apis) were checked. Pinned Better Auth magic-link source supplied exact token/path/query assumptions. No real person data was sent to a provider.

Next: independent review, then bounded request handlers that validate the actual incoming host before invoking auth, plus synthetic browser/test-process transport integration. Canonical DNS/provider configuration and real transport checks remain separate operator gates. No public latest-token endpoint or environment sign-in bypass was added.
