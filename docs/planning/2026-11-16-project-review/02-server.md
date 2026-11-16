# 02 — Server review: `src/server` (excluding `mcp`, schema, migrations) and `src/app/api`

Scope read: 316 `.ts` files, about 25,100 lines excluding `mcp` (2,543) and migrations. Read-only; nothing in the repo was changed. Main at `582aa56`.

How to read the numbers: lines here are long. The average line is 62 to 95 bytes per directory and 615 lines exceed 200 characters, so 25k lines is about 2.0 MB of source, closer to 45-50k lines at normal formatting. "Lines saved" below are in the repo's own dense lines; multiply by about two for a feel of real size. Test savings are not counted except where stated (tests are 217k lines across 731 files; several findings below remove thousands of test lines too).

What I did not verify: which environment flags are set in production (`PORTAL_RECORDINGS_ENABLED`, `PORTAL_NOTIFICATIONS_ENABLED`, `PORTAL_MUSIC_DETAILS_ENABLED`, the roster Sheet and reference-review settings). Where a verdict depends on a flag I say so.

## The shape in one paragraph

`src/app/api/[...path]/route.ts` (11 lines) forwards every method to one hand-written dispatcher (`http/dispatch.ts`). The dispatcher opens a new Neon pool per request, builds all ~60 services (`runtime/composition.ts`), then walks 30 handler modules in a `??` chain until one answers. Each feature is five to seven files: `http/<x>.ts`, `<x>/service.ts`, `<x>/validation.ts`, sometimes `<x>/access.ts`, `data/<x>.ts`, `db/<x>-schema.ts`. There is no router, no schema validation library and no shared CRUD helper, so each feature re-implements the same route table, 405 answer, body parser, primitive validators, optimistic-version check and error class. The duplication is mostly not in business logic; it is in this scaffolding, and in a defensive style (frozen objects, descriptor-level object checks, `throw 0`, expiry re-checks after every await) applied uniformly whether the route is sign-in or "which lessons has this child finished".

## Per-directory verdicts

Lines are `.ts` lines in that directory.

| Directory | Lines | What it is for | Verdict |
|---|---|---|---|
| `access/` | 260 | Session to actor to capability; the one gate every service calls | Keep. Simplify the capability switch (finding 9) |
| `accounts/` | 529 | Account requests, approvers, members, People with access, make/remove tutor | Keep; merge `people/` into it |
| `auth/` | 141 | better-auth factory, sign-in code cap | Keep |
| `booklet/` | 91 | Per-student printed study booklet read | Keep; own `access.ts` (58) duplicates the student read gate, fold into `access` |
| `connections/` | 70 | List and end Claude (MCP) connections | Keep; belongs beside `mcp/` |
| `course-progress/` | 165 | Learn to lein progress document | Merge with `verse-review` and `service-course/progress-*` (finding 2) |
| `data/` | 2,329 | Query helpers, one file per feature | Keep, but pick one home: 8 features keep their own `data.ts` instead (finding 12) |
| `db/` | 1,774 | Schema (other reviewer) plus `runtime.ts` | `runtime.ts`: simplify (finding 4) |
| `discussions/` | 598 | Curated "talk it over" discussions, MCP-authored, public read | Keep. Note the 2026-10-28 ruling dropped talk-it-over questions from the booklet; confirm still shown |
| `guide-share/` | 354 | Export/import of reviewed guides between congregations | Keep (new, 2026-11-01) |
| `honoree/` | 357 | Guest links for people with an honor (token, booklet material) | Simplify heavily (finding 7) |
| `honors/` | 180 | Family honors form | Keep; drop receipt replay (finding 5) |
| `http/` | 3,618 | Dispatcher, body/query/response helpers, 30 route modules | Simplify (findings 1, 8) |
| `invitations/` | 391 | Issue, reissue, revoke, accept invitations; throttle | Keep (auth). `service.ts` 367 lines is one closure; split by role only if touched |
| `learners/` | 369 | Learner directory, tutor claims, link requests, "my tutor" | Keep; overlaps `relationships` and `staff` (finding 10) |
| `lesson-log/` | 141 | Tutor lesson notes per student | Keep |
| `logging/` | 72 | Fixed-event logger that refuses any detail | Simplify (finding 3) |
| `mail/` | 257 | Resend transport for 3 kinds of mail | Keep; link/allow-list checks on its own outgoing URLs can go (about 80 lines) |
| `mcp/` | 2,543 | Not in scope | — |
| `notifications/` | 496 | Tutor draft notices, parent digest, reminders, unsubscribe, cron | Keep only if it is going to be turned on; MISSION says "notifications stay off" (finding 11) |
| `offline/` | 85 | Lists what the installed app should pack | Keep |
| `people/` | 68 | `makeTutor` / `removeTutor` transactions, one caller (`accounts/service.ts`) | Merge into `accounts/` |
| `portal/` | 134 | Session summary, home "door", assigned reading | Keep |
| `portion-summary/` | 268 | Approved portion summaries, public read | Keep |
| `practice/` | 143 | "Child practice" context: a parent's per-tab handle to act as their child | Simplify (finding 6) |
| `practice-calendar/` | 216 | Practice-day events and calendar | Keep; delete `maintenance.ts` (36 lines, no caller outside tests) |
| `practice-visibility/` | 106 | What a tutor/parent sees of practice | Merge with `progress/` and `practice-calendar/` reads (finding 10) |
| `progress/` | 110 | Per-verse marks (Got it / Still working), tutor assessment | Keep |
| `public-reading/` | 261 | Signed-out reading service | Keep |
| `public-site/` | 97 | Names and share card | Keep |
| `recordings/` | 548 | Student recordings: parked, no client | Candidate to delete (finding 5a) |
| `reference-audio/` | 1,061 | PocketTorah clips: catalog, manifest, private-Blob loader, MP3 inspector | Simplify heavily (finding 4b) |
| `reference-review/` | 428 | Cantor Finkel listening-review batches | Candidate to delete (finding 5b) |
| `relationships/` | 330 | Admin: assign/revoke tutors, guardians, identities, cantor flag | Keep; overlaps `staff`, `learners`, `accounts` (finding 10) |
| `roster-sheet/` | 168 | Nightly one-way write of the roster to a Google Sheet | Keep if staff actually read the Sheet; ask Daniel. It is small and self-contained |
| `runtime/` | 549 | Config loader, per-request composition, public composition | Simplify (finding 1) |
| `saved/` | 623 | A member's own shelf: saved readings, marks, stars, notes, preferences | Keep; `saved/access.ts` (141) is the original of the owner-only pattern copied three times (finding 2) |
| `service-course/` | 736 | "Learn the service" course: text, evening text, path, pin, progress, finished marks | Keep; progress trio merges (finding 2) |
| `service-ecosystem/` | 606 | Link to CRC Music setlists: broker, scheduler, cron drain | Simplify or park (finding 7b) |
| `service-learning/` | 599 | Tutor's service plan (parts a student leads) and its feed | Keep; three "service-*" directories should be one (finding 10) |
| `settings/` | 207 | Congregation settings | Keep; `validation.ts` 117 lines for a handful of fields |
| `staff/` | 291 | Needs-you status, hand-over, family line, reconfirm reading | Keep; merge with `relationships` |
| `student-work/` | 196 | Student translation/notes drafts and tutor notes per verse, with recovery | Simplify: MISSION moved "My notes / My translation" out of the reader; check what still writes here (finding 5c) |
| `students/` | 1,326 | Roster CRUD, CSV import, Maven intake, reading prepare/confirm, ceremony done | Keep; simplify prepare/confirm (finding 6b) |
| `study/` | 2,896 | Sefaria text, commentary, translations, sources, word tools, caches | Keep. Best-proportioned large area; many `*-service.ts` files of 34 to 43 lines only forward to a reader behind the same access call |
| `study-guides/` | 733 | Guides: read, status, MCP writes, citations check | Keep; `service.ts` 424 lines is the largest service |
| `tenancy/` | 60 | Host to tenant lookup | Keep; called three times per request (finding 4) |
| `verse-review/` | 129 | Verse review cards document | Merge (finding 2) |
| `src/app/api` | 11 | Catch-all forwarding to the dispatcher | Replace with real route files or keep and add a route table (finding 1) |

## Findings, ranked by payoff

### 1. One dispatcher, sixty services per request, thirty hand-rolled route modules

- Where: `src/app/api/[...path]/route.ts`; `src/server/http/dispatch.ts:84` (one 1,400-character line chaining 30 `xRouteMethods(path) ?? …`) and `:111` (the same 30 again as `await handleX(request, runtime) ?? …`); `src/server/runtime/composition.ts:164-280` (one function that constructs every service and returns a 58-key object); the 30 `http/*.ts` modules.
- What: Next's file router is bypassed. Every request (a) is matched twice against all 30 modules, (b) opens a new `Pool`, (c) constructs every service including five separate `createSefariaMetadataReader({ fetch })` instances (`composition.ts:209, 211, 224, 226, 237`), the music broker, the roster-sheet client and the MCP endpoint, then (d) tries handlers in order until one returns non-null. Each handler re-parses the URL and repeats the same preamble. Verified by grep: 30 `export function …RouteMethods`, 36 copies of `new HttpBoundaryError(405)` plus `allow` header, `uniqueQuery(request.url, [])` and `requireCookieMutation` in nearly every module.
- Why over-built: the indirection exists so that an unowned path is refused "with no provider configuration or connection" and so one place can apply cookie and URL checks. A table does both.
- Instead: one route table `{ pattern, methods, handler(runtime, request, params) }` used by a 30-line dispatcher; method/405, query check, origin check and JSON body reading done once in the dispatcher from fields on the route entry; services constructed lazily (a getter per service) so a request builds only what it uses. The honoree and reference-review special branches (`dispatch.ts:66-82, 97-105, 119`) become ordinary entries once finding 7 is done.
- Saved: about 500 lines in `http/` (preambles, per-module route helpers), 60 in `dispatch.ts`, and `composition.ts` becomes a list. Bigger gain: adding a feature stops meaning edits in five places.
- Risk: medium (every route moves; the http-browser and e2e suites cover it). Confidence: high.

`http/portal.ts` deserves its own line: 563 lines, of which `handlePortalRequest` is one function from line 172 to 563 (about 390 lines, 57 KB file) covering session, practice context, students, reading prepare/confirm, exploration, preview, reference audio, study text, word aids, sources, admin students, relationships, tutors and invitations. It is the oldest module and the only one that never got split. Under a route table it dissolves into its services' own entries.

### 2. The same "owner-only versioned document" built three times (and its pattern a fourth)

- Where: `course-progress/{access,service,validation}.ts` (165), `verse-review/{access,service,validation}.ts` (129), `service-course/progress-{access,service,validation}.ts` (184), `data/{course-progress,verse-review,service-course-progress}.ts` (181), `http/{course-progress,verse-review,service-course-progress}.ts` (127), three schema files (70). 856 lines.
- What: verified by diff. `course-progress/access.ts` and `service-course/progress-access.ts` differ in 62 diff lines of 55, almost all renames (`CourseOwner` to `ServiceCourseOwner`, `app.course_owner` to `app.service_course_owner`). The services share `stored()`, `view()`, `write()`, `get/put/merge` word for word, including the comments. The data files differ by table name. Each has its own `…Refused` error class and its own "403 names its own owner" branch in the handler. `saved/access.ts` (141) is the model they were copied from, and `booklet/access.ts` (58) is another copy of the gate.
- Instead: one `ownerDocument({ table, ownerSetting, eligibility, parse, merge?, afterWrite? })` factory and one handler; the three features become three 15-line configurations. The one real difference (service-course stamps finished parts after a write, `progress-service.ts:57, 75`) is the `afterWrite` hook.
- Saved: about 550 lines, plus three near-identical test families. Risk: low (pure refactor behind identical routes). Confidence: high.

### 3. Errors and logs that say nothing, by design

- Where: `logging/logger.ts` (72): the logger accepts only a fixed event name and a status from an allow-list; "It never accepts metadata objects or serializes errors, causes, headers, bodies, URLs, SQL". `runtime/composition.ts:301-312`: every exception from any handler is replaced with `new RuntimeUnavailable()` and one log line `runtime.unavailable 503`. `http/responses.ts:14-23`: anything that is not `AccessDenied` or `HttpBoundaryError` becomes `{"error":"unavailable"}`. `access/identity.ts:40-43`: any non-denial becomes `AccessUnavailable`.
- Counted: 178 `throw 0` in 23 files (a thrown number, caught two lines later and rethrown as a fixed class); 34 error classes, most of them `XUnavailable` with no fields; about 100 `new Error("<Feature> unavailable")`; 76 bare `catch {` blocks in 39 files.
- Effect: when production returns 503, the log line carries a request id and nothing else: not the route, not the error class, not the stack. The codebase guards against a hypothetical "hostile accessor on an error object" (`responses.ts:20`, `body.ts:44`, `composition.ts:306`: `try { if (error instanceof AccessDenied) … } catch { /* Untrusted diagnostic accessor */ }`) for errors it threw itself.
- Why over-built: the worry is leaking a name or email into logs. Vercel function logs are private to the project owner. The rule "never log a token, cookie, connection string or full email" (CLAUDE.md) is met by not logging request bodies and headers; it does not require discarding the route and stack.
- Instead: log `{ requestId, method, pathname pattern, status, error.name, error.stack }` for 5xx; give thrown errors real messages (`throw new Error("progress row version mismatch after lock")`); replace `throw 0` with early `throw new HttpBoundaryError()` (same behaviour, one line shorter, greppable). Keep the response body generic.
- Saved: about 150 lines; the real payoff is debuggability. Risk: low. Confidence: high.

### 4. Per-request infrastructure checks that belong at deploy time

a. Database role audit on every transaction. `db/runtime.ts:23-45`: every `withTenantTransaction` first runs a `pg_roles` / `pg_class` / `pg_namespace` / `pg_database` catalog query to prove the connection is not an owner, superuser or member of anything elevated. `runtime/composition.ts:297` opens a transaction with a hard-coded `tenantId: "crc"` solely to run that check, then `access/identity.ts:28` runs it again inside the request's real transaction, and services that open more transactions run it again. `tenancy/resolve.ts` is called three times per signed-in request: `composition.ts:299` (configured origin), `dispatch.ts:108` (incoming), `access/identity.ts:18` (again, inside the service). So a typical read costs two catalog audits and three `tenant_host` lookups before its first real query, on a per-request WebSocket pool.
- Instead: check the role once per cold start (module-level promise), resolve the host once per request and pass the result down. RLS and the restricted role stay exactly as they are. Saved: about 40 lines and 4 round trips per request. Risk: low to medium (the tenant-isolation tests assert the check exists; they would assert it at startup). Confidence: high on the redundancy; I did not measure latency.

b. Reference audio: private-media machinery for openly licensed clips. `reference-audio/` is 13 files, 1,061 lines, plus `composition.ts:112-144`. PocketTorah clips are CC BY-SA 3.0 and STATE (2026-11-01) records that the catalog and all 7,028 clips are published openly as a GitHub Release. The runtime nevertheless loads the catalog from a private Blob store with an OIDC token read from request context and re-read three times to detect it changing mid-call (`composition.ts:119-127`), verifies SHA-256 pins on catalog and manifest, walks arrays by property descriptor (`catalog.ts`), inspects MP3 frame headers, Xing/LAME tags and CRCs before serving a body (`short-source-gapless.ts`, 145 lines; `short-source-body.ts`), requires seven environment facts to agree before the public route answers (`runtime-short.ts:8-11`) and has an 11-stage boolean-only diagnostic reporter (`short-diagnostic.ts`) because the real reason for a refusal is never logged. `short-source-build.ts` (80) is imported only by build scripts and tests, not by the app.
- Instead: publish the clips and a JSON catalog as public static assets (public Blob or the Release), import the catalog as a pinned JSON module at build time, and let the browser fetch clips directly. The chant gate is about generated audio and human recordings need no review (CLAUDE.md), so nothing here is gated. Keep `studentRelease` as one boolean if Daniel still wants it. Saved: about 800 lines here, the prebuild OIDC probes (other reviewer's area) and about 2,700 test lines (`reference-short*`). Risk: medium (touches a working player; needs one careful PR). Confidence: medium-high.

### 5. Built, then parked or superseded, still in the tree

a. Student recordings. `recordings/` (8 files, 548), `data/recordings.ts` (52), `http/recordings.ts` (39), `db/recording-schema.ts`, `lib/recordings/types.ts` (138), wired at `composition.ts:219` as `null` unless `PORTAL_RECORDINGS_ENABLED=true`. No client calls `/api/students/<id>/recordings` (grep of `src/app`, `src/components`, `src/lib`). `recordings/media-wav.ts` (96) and `recordings/registration.ts` (98) have no importer in `src` or `scripts` at all, only tests. Daniel, 2026-10-22: "I don't think this is really a useful thing for us." Tests named `recording*`: 16 files, about 7,100 lines. Delete: about 780 source lines plus the tests. Risk: low (tables can stay). Confidence: high.

b. Finkel listening review. `reference-review/` (6 files, 428), `data/reference-review.ts` (42), `http/reference-review.ts` (53), the admin page `workspace/admin/reference-review`, and two special cases in the dispatcher (`dispatch.ts:109-110, 119`). The page credits "Teaching collection shared by Cantor Josh Finkel". Finkel playback was cut on 2026-10-22 and STATE says its routes "are inert and get removed in a cleanup PR"; `finkel-import.ts` (107) has no importer outside tests. If Daniel's PocketTorah listening review does not use this screen (I could not tell from the code; a batch must be assigned through `REFERENCE_REVIEW_*` config), delete all of it: about 520 lines plus the UI. Risk: low. Confidence: medium; one question for Daniel.

c. Student work recovery. `student-work/service.ts` (159) computes an HMAC "authority binding" over 16 actor fields (`service.ts:26-31`) so that an unsent draft can be "recovered" after a reading changes, with history, receipt and recovery routes. MISSION (line 12) moved My notes and My translation out of the normal reader ("Writing stays in Claude"). Callers remain (`workspace/work/api.ts`, `staff/lift-note.tsx`), so not dead, but the receipt/recovery half serves a flow that was removed from the student's main path. Check which of the five sub-routes (`history|receipt|recovery|draft|note`) the UI still calls and drop the rest. Possible saving about 100 lines plus `data/student-work.ts`. Confidence: medium (not traced route by route).

d. `practice-calendar/maintenance.ts` (36): its own comment says "no HTTP cleanup route or scheduler"; grep finds no caller outside three test files. Delete. Risk: none.

e. Mutation ids and receipts. `mutationId` appears 208 times in 36 server files (28 outside `mcp/` and `db/`), with nine `*_receipt_key` unique indexes and `/receipt` replay routes for honors, honoree links, student work and settings. This is exactly-once delivery for forms that also carry `expectedVersion` (232 occurrences in 57 files). For the MCP it has a reason (an agent may retry a tool call). For a browser form on a site with a few dozen students, the version check alone already turns a double submit into a harmless 409. Keep ids on MCP writes; remove the browser-side receipt routes and replay paths. Saved: about 300 lines server, more in clients. Risk: medium (touches many writes; do it feature by feature when each is next edited). Confidence: medium.

### 6. Child-practice context and signed "preparations": heavy answers to small questions

a. `practice/` (143) plus `data/practice.ts` (39) plus the `X-Practice-Context` header. When a parent taps "Practice with your child", the server mints a random per-tab handle, stores its hash in a table with the session, grant, guardian link and authority revision, writes `context.enter` / `context.exit` audit rows, and every later request must present the handle. Thirteen services therefore have two authorization paths (`access.withStudentCapability` or `practice.withPracticeCapability`: 18 call sites; `child-practice` appears 80 times in 38 files), base services refuse any request that carries the header (`access/service.ts:58`), and expiry produces the "practice expired" notice STATE mentions. The question it answers is "may this parent mark practice for this child", which the guardian link with `practiceEnabled` already answers on each request.
- Instead: a `parent` actor with a `practice-write` capability checked against the live guardian link, no handle, no table, no header. Saved: about 250 lines across services, one table, one client state machine. Risk: medium (cross-family isolation is one of the CLAUDE.md four, so this needs the adversarial pass; the replacement check is simpler to review than the current one). Confidence: medium-high.

b. `students/bindings.ts` (50), `students/preparation.ts` (45), and the prepare/confirm halves of `students/service.ts`, `service-learning/service.ts`, `study/exploration.ts`, `students/preview.ts`, `reference-audio/short-exploration-service.ts`. Setting a reading is two requests: "prepare" returns an AES-256-GCM-encrypted, five-minute token holding the whole proposal and the actor's identity; "confirm" must return it. Five purposes, six derived secrets in `composition.ts` (`purposeSecret` is called 15 times for 13 purposes). The Hebcal response is re-validated field by field before being sealed (`preparation.ts`), although the same module fetched it. A plain confirm that re-sends the chosen ranges with `expectedRevision`, validated on arrival, does the same job; the admin is the only caller.
- Saved: about 250 lines. Risk: medium. Confidence: medium.

### 7. Capability links and integrations built to a threat model the site does not have

a. Honoree guest links: `honoree/` (357), `http/honoree.ts` (70), `http/honoree-landing.ts` (159), `http/fragment-landing.ts` (68), `data/honoree.ts` (58), three branches in the dispatcher. The link lets a relative see their aliyah blessing page. It has its own signed token format (`hl1.k1.<id>.<secret>.<mac>`, `tokens.ts`), a Chicago-midnight expiry solver, a `WeakMap<Response, …>` "fence" that re-checks expiry after the runtime has closed (`http/honoree.ts:8-33`), a remaining-milliseconds header adjusted for elapsed time, refusal of any request that carries a cookie, and a 40,652-line reference fixture in tests. The protected content is the Torah blessings and which aliyah someone has.
- Instead: a random 128-bit id stored hashed with an expiry date, one GET page. Saved: about 450 lines and the special dispatcher paths. Risk: low to medium (existing links must keep working or be reissued). Confidence: medium-high. Also ask whether families use it at all.

b. `service-ecosystem/` (606) plus `http/service-ecosystem.ts` (54) plus a daily cron (`vercel.json`): a broker to CRC Music with a scheduler, retry state machine, schedule revisions, "ambiguous/review_required/linked" states, nine sub-routes and a hand-written 80-line response validator (`broker.ts`). It hard-codes `tenantId !== "crc"` (`service.ts:35, 39`). The 2.0 plan (line 182) says "the Music list in 0025 is not used" for the service path, and ruling 51 moved prayer audio links to 2.1. The client still renders it (`service-learning/my-service.tsx`). If the setlist link is not something students or tutors look at today, park it behind its flag and stop the cron; if it is, collapse to "fetch projection on demand, cache one row". Saving 300 to 600 lines. Confidence: low-medium; needs Daniel's answer on whether it is used.

### 8. Hand-rolled validation and JSON hardening

- Where: 1,099 lines in `*validation*.ts` files; 57 local definitions of `text / string / integer / uuid / identifier / revision / bounded / boolean / object` across 42 files; the UUID regex written out 37 times in 11+ files (`access/service.ts:13`, `practice/service.ts:14`, `http/honoree.ts:22`, …); `studentView` defined three times.
- `http/query.ts` `closedObject` checks prototype, own symbols and property descriptors of a value that came from `JSON.parse`. `http/responses.ts:25-50` `privateJson` deep-copies every response by descriptor, rejecting getters, cycles and non-plain prototypes, on objects the server built itself. `Object.freeze` appears 833 times in 157 files. `Reflect.*` / `getOwnPropertyDescriptor` / `getPrototypeOf` 130 times in 33 files. `http/body.ts` hand-streams the body with a 5-second race (95 lines for two readers that share everything but the content type); Vercel already caps body size and duration.
- These defend against prototype tricks and hostile getters that cannot arise from `JSON.parse` output or from the server's own frozen literals.
- Instead: one `validate.ts` with the eight primitives (or add zod; the project already depends on better-auth, which bundles it); `closedObject` reduced to a key allow-list; `privateJson` reduced to `JSON.stringify` plus headers; stop freezing return values.
- Saved: about 600 lines. Risk: low (behaviour for valid input is identical). Confidence: high.

### 9. Expiry re-checks and lock choreography everywhere

- Counted: 126 `assertLive / assertReturnLive / assertSessionLive / fresh()` calls in 17 files; 108 `lockX(` calls in 31 files; 82 `.for("update"|"share")` in 36 files; 120 `signal.aborted` checks in 43 files; 11 distinct `set_config('app.…')` RLS settings.
- Pattern: authorize, lock, act, then check the session did not expire while waiting for the lock and roll back if it did (`course-progress/access.ts:47-51`, `student-work/service.ts:35-48`, `practice-calendar/maintenance.ts` calls `fresh()` five times in one loop). `access/service.ts:73-104` re-validates its own string-literal capability argument against a list at run time. Row-level share locks are taken on reads so a revocation "disappears instead of surviving from an earlier candidate query" (`access/service.ts:137-146`, a per-student loop of lock queries to list students).
- Proportion: a session that expires 40 ms into a write, or a tutor revoked in the same second as a read, is not a harm worth this much code on this site. One check at the start of the request is the norm.
- Instead: keep locks on writes that change authority (grants, relationships, invitations). Drop read locks, post-action expiry checks and abort-signal polling elsewhere. Saved: about 300 lines and fewer lock waits. Risk: medium, because the adversarial reviews wrote tests for many of these races; removing them means deleting those tests deliberately. Confidence: medium. This one is a policy choice for Daniel more than a refactor.

### 10. Feature directories that are one feature

- People: `relationships/` (assign/revoke tutor, guardian, identity, cantor), `staff/` (hand-over, tutor's students, family line), `accounts/` (requests, approvers, members, make/remove tutor), `people/` (the make/remove tutor transactions), `learners/` (directory, claims, link requests, my tutor). 1,587 lines, five places that end a tutor's link (`relationships.revokeTutor`, `staff.handOver`, `people.removeTutor`, `learners.unclaim/removeMyTutor`, `students/ceremony-done`). Each re-implements "revoke link, bump revision, write audit". One `people/` module with one `endTutorLink(tx, …)` helper would remove about 200 lines and the risk STATE already hit twice (stale claims after a revoke: A1, #137 re-review Medium).
- Practice: `progress/`, `practice-calendar/`, `practice-visibility/`, `lesson-log/`, `service-course/finished.ts` each have their own `authorized()` wrapper choosing between the access and practice gates (identical shape in `progress/service.ts`, `practice-calendar/service.ts`, `lesson-log/service.ts`). One shared `withStudentOrChild(request, selection, capability, action)` removes three copies (about 60 lines) and is where finding 6a lands.
- Service: `service-learning/` (the tutor's plan), `service-course/` (the lessons), `service-ecosystem/` (the Music link), 1,941 lines, three names for "the service part of the ceremony". `service-course/path.ts` reads `service-learning`; `service-ecosystem` imports `verifyCeremonyMaterialMapping` from `service-learning`. Make it one `service/` directory with `plan`, `course`, `music` files.
- Roster intake: three ways in. Manual create; CSV import (`students/external-roster.ts`, `students/service.ts` `previewImport/confirmImport`, with its own signed preview token); Maven through the MCP (`maven-intake.ts`, `maven-roster.ts`, `maven-links.ts`). `external-roster.ts` is now imported only by `maven-intake.ts`, yet the CSV screens and routes (`/api/admin/students/import/{preview,confirm}`) remain. If Maven is the intake, remove the CSV path (about 150 server lines plus `components/portal/workspace/csv-import`). Ask Daniel which he uses.
- Risk: low for the merges (moves and one helper). Confidence: high on the overlap, medium on the CSV removal.

### 11. Notifications: complete, scheduled, off

`notifications/` (496), `data/notifications.ts` (152), `http/notifications.ts` (55), an unsubscribe token scheme (`tokens.ts`), delivery ledger with "Delivery receipt unavailable" states, a daily cron (`vercel.json`, 14:05 UTC) and a second ad hoc Neon pool opened in `after()` (`composition.ts:156-163`). MISSION 2026-10-22: "notifications stay off". The cron runs every day and, with the flag off, does nothing. Either turn it on (it is the feature most likely to matter to tutors and parents; see the gap analysis) or stop the cron and leave the code. No lines saved either way; listed because it is 700 lines of finished work delivering nothing. Confidence: medium (flag state not verified).

### 12. Smaller items

- Two homes for queries: `src/server/data/*.ts` (35 files) and feature-local `data.ts` in `accounts`, `staff`, `learners`, `relationships`, `discussions`, `portion-summary`, `service-learning`; 33 files outside `data/` and `db/` import `drizzle-orm` directly (`service-ecosystem/service.ts` writes SQL inline). Pick feature-local.
- `runtime/README.md` documents the configuration contract in 1,500 words of prohibitions; `config.ts` (99 lines) rejects a `DATABASE_URL` whose host is not `*.neon.tech` or that carries any query option but `sslmode=require`, and refuses to start if operator variables are present. A fork (Rabbi Kipnes) will meet these as an unexplained 503 because of finding 3.
- Hard-coded `"crc"`: `composition.ts:297`, `service-ecosystem/service.ts:35, 39`, `broker.ts` (`"x-org-id":"crc"`). The tenancy layer is general; these are not.
- `study/*-service.ts` (`word-aids-service` 34, `word-details-service` 36, `source-discovery-service` 43): each wraps one reader in the same access call. Could be one `studyRead(kind)`.
- `mail/transport.ts` (257) validates the shape of links the server itself just built (path, token length, allow-listed query keys) before sending.
- `http/pending-invitations.ts` (105), `google-challenge.ts` (101), `sign-in-code-binding.ts` (76), `auth/sign-in-code-cap.ts` (60): auth, deliberate, left alone. They are four separate sealed-cookie/HMAC schemes; one helper would serve all four if this area is ever reopened.
- Style: about a third of files are written without spaces (`students/service.ts`, `service-ecosystem/*`, `students/preparation.ts`: `const binding=bindings.sign({purpose:"student-reading",actor:baseline.actor,…`), with 400-character lines. Running a formatter is free and makes diffs reviewable.

## If only five things were done

1. Delete what is parked: student recordings, the Finkel review surface (after one question to Daniel), `practice-calendar/maintenance.ts`, and the unimported `media-wav`, `registration`, `finkel-import`. About 1,400 source lines and 8,000 test lines, low risk, one PR.
2. Make failures diagnosable: log route, error name and stack on 5xx; replace `throw 0` and the `XUnavailable` classes with messages. Low risk, pays back on the first production incident and before a second congregation runs a copy.
3. Replace the dispatcher chain with a route table and lazy services, and split `http/portal.ts`. Removes about 600 lines of preamble and the "edit five files to add a route" cost.
4. Collapse the three owner-document modules into one factory, and the people/practice/service directory clusters into three modules with shared `endTutorLink` and `withStudentOrChild` helpers. About 800 lines, low risk.
5. Serve PocketTorah audio as public static files with a build-time catalog, and move the database role audit and host lookup to once per cold start / once per request. About 850 lines, the prebuild probes, and several round trips per request.

Held for Daniel's call rather than recommended outright: removing the child-practice handle (6a), the prepare/confirm tokens (6b), browser-side mutation receipts (5e), honoree link simplification (7a) and the read-lock/expiry re-checks (9). Each is a large saving, and each sits next to one of the four areas CLAUDE.md marks as deliberate, so they need his yes and an adversarial pass.

Questions for Daniel that change verdicts: Does anyone read the staff roster Sheet? Is CSV import still used now that Maven intake exists? Do families use honoree links? Do students or tutors look at the CRC Music setlist panel? Is the reference-review page part of his PocketTorah listening review? Are notifications going to be turned on?
