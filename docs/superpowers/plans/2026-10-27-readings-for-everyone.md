# Readings for everyone: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Builders read `docs/planning/AGENT-BRIEF.md` first; each prompt pastes in only its own tasks.

**Goal:** Every signed-in person has one shelf of readings (`/mine`), any reading is two taps away from anywhere, the reader has one calm header everywhere, and the whole site shares one bar.

**Architecture:** Next.js App Router pages over the existing portal services. Five areas, each one PR: (A) the shell, sign-in landing and `/mine` skeleton; (D) eligibility, the staff read path, claims and link requests (auth and data access, adversarial pass); (B) the calendar, Find a reading, `/readings` and the Change sheet; (C) the reader's title block, the Add sheet, the foot row and the dock; (E) the pinned reading, children's cards, Your students, the staff Manage sheet and the words. The saved layer stays keyed by membership and guarded by row-level policies; new policies add read-only paths for a linked tutor, an admin and the learner directory.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, CSS modules and the `src/components/ui` kit, Drizzle on Postgres with row-level policies, Better Auth, Vitest (app tests on PGlite), Playwright (`e2e/`), the http-browser suite, `node --test` structural guards.

**Spec:** `docs/superpowers/specs/2026-10-27-finding-and-keeping-readings-design.md` (decisions 1 to 25, both open items answered 2026-10-27: the week arrows retire; parents and tutors fold into My Readings). Evidence: `docs/planning/2026-10-27-readings-navigation/FINDINGS.md` (F1 to F25) and `MENU-MAP.md`.

## Global constraints

- Never in the repo: licensed text, student or family data, recordings, rendered audio, credentials. Fixtures are synthetic (`@example.test`). `tests/never-in-repo.test.mjs` stays green.
- Never print, log or return a token, cookie, connection string or full email address.
- Wording is the spec's, word for word. New strings in this plan are the lead's under decisions 13 and 24; a string with no precedent is a gap: ship the behaviour and list it.
- Tone: no emoji, exclamation points, streaks, scores or tallies. Straight apostrophes in code; curly in copy where the file already uses them. The child's name, never pronouns.
- "My Readings" with a capital R everywhere it names the shelf (decision 7). Sentence case otherwise.
- Tests assert roles, labels and test IDs, not layout; one deliberate wording test per screen. Builders search `tests/`, `e2e/` and `tests/http-browser/` for every name they change and update each match in the same commit.
- Local checks only: `npx tsc --noEmit --incremental false`, the changed test files (`npx vitest run <file>`), `node --test tests/never-in-repo.test.mjs tests/saved-structure.test.mjs`, and `npm run test:local-db -- <file>` for any changed `tests/postgres/` or `tests/http-browser/` file. CI runs the suites.
- Migrations: 0054 is reserved for area D (`0054_readings_for_everyone.sql`). No other area adds a migration. Production applies 0054 before PR D merges (check, apply, verify; ledger becomes 54).
- Performance gate (spec, Done means): CLS at most 0.07 and INP at most 80 ms at 4x CPU on `/`, `/read`, `/readings` and `/mine`; axe clean on all four. `e2e/public-reader-layout.spec.ts` holds the pattern.
- Area D is auth and data-access work: it is built by the strongest model and gets an adversarial pass (attacks listed in Task D9) before it is reported done. Nothing else in this plan changes who can see what.

## Review focus

Inputs the spec implies but no task's tests would otherwise exercise; each line's test is added to the owning task.

1. A tutor asks for a learner's shelf by a membership id in another tenant, or for one they never claimed: the server answers 404 and binds nothing (D4, D5).
2. A learner undoes a claim while the tutor has the learner's reading open: the tutor's next read is 404, the learner's own marks are untouched (D6).
3. A signed-in person with no membership yet reloads `/mine` before `POST /api/session/begin` has answered: the page shows the loading state, then the empty shelf, never "Role unavailable" (A4, D1).
4. The search field gets a date on a holiday Shabbat, a past date, or text that is both a parashah prefix and a book name ("Num"): one ordered result list, the first result the one Enter opens (B2).
5. A student opens `/read?saved=<id>` for a reading that belongs to someone else: the saved state is "missing", never another person's reading (D5, unchanged behaviour pinned by a test).

## Decisions this plan makes (lead, 2026-10-27; any can be overturned in a sentence)

1. **Membership at first sign-in, not a member row.** The saved layer is already keyed by `membership_id` (`bindOwner`). A fresh identity has no membership row until it accepts an invitation or is approved. The plan adds `POST /api/session/begin`, called by the entry once after a successful sign-in, which inserts the membership row when none (`obtainMembership` in `src/server/data/invitations.ts:96` already does this) and returns the session summary. Eligibility (`memberEligible`) becomes "a live, undisabled membership in this tenant". `tenant_member` keeps its schema and its meaning as the approver's record; it no longer gates the shelf or Learn progress sync. It still gates nothing else today (MCP connections and approving need role grants). Builder check answer 1's "approved column" is not needed.
2. **Claims are their own table.** `learner_claim` (tenant, learner membership, tutor grant, optional tutor link, created, revoked, revoked by: learner, tutor or admin). A claim on a person who has a student identity also writes the existing tutor link (`writeTutorAssignment`) and remembers its id, so every staff tool keeps working for linked students; a claim on anyone else is the claim row alone. "Not my tutor" revokes the claim and the tutor link it created. No student record is invented for a learner.
3. **Read-only policies, two settings.** Migration 0054 adds a `staff_read` SELECT policy on each saved table (`saved_reading`, `saved_verse_work`, `saved_verse_mark`, `starred_comment`) that matches `app.saved_viewer`, and a `directory_read` SELECT policy on `saved_reading` alone that matches `app.saved_directory = 'on'`. `src/server/saved/access.ts` stays the only file that sets any `app.saved_*` setting (the structural test grows to say so). The viewer path exposes only the service's read functions.
4. **Link requests reuse the request table.** `account_request` gains nullable `student_id` (a student the person named when asking, or the one the approver picks). Approving with a target writes the member row as today and links the identity with the invitation layer's write (`linkInvitedStudent` with a `student` role grant), audited as `identity.link` and `grant.issue`. Approving without a target is today's approval.
5. **One header now, one body later.** Decision 19's "one component" is delivered as one title block (`ReaderTitle`) and one pill grammar shared by the public reader, the saved reading and the workspace reading panel; the bodies (`PassageReading` for public and saved passages, `study/view.tsx` for assigned readings) stay until the store unification the spec defers.
6. **Addresses.** `/mine` (the shelf), `/mine/reading` (the signed-in student's pinned reading; replaces `/workspace/student?tab=reading`), `/mine/child/<studentId>` (a parent's view of a child; replaces the in-place card open), `/mine/learner/<membershipId>` (a tutor's or admin's view of a learner's shelf), `/readings` (the index), `/api/public/calendar`, `/api/session/begin`, `/api/learners`, `/api/learners/claim`, `/api/learners/unclaim`, `/api/mine/tutor`, `/api/mine/tutor/remove`, `/api/saved/learner/readings`, `/api/saved/learner/reading`, `/api/saved/learner/page`. `/workspace/tutor/<id>` and `/workspace/admin/students/<id>/reading` stay.
7. **The home never loses this Shabbat.** The signed-in door of decision 22 sits under the hero's buttons; the list of saved readings leaves the home (builder check 6).

## Order and PRs

| PR | Area | Branch | Depends on | Builder |
|---|---|---|---|---|
| 1 | A: shell, sign-in landing, `/mine` skeleton | `claude/shell-mine` | none | Sonnet |
| 2 | D: eligibility, staff read path, claims, link requests | `claude/shelf-for-everyone` | none (A for the UI rows; merge after A) | strongest model, adversarial pass |
| 3 | B: calendar, Find a reading, `/readings`, Change sheet | `claude/find-a-reading` | none | Sonnet |
| 4 | C: reader title, Add sheet, foot row, dock | same branch as B, after B's PR merges (shared hot files `view.tsx`, `read-header.tsx`) | B | Sonnet |
| 5 | E: pinned reading, children's cards, Your students, Manage sheet, words | `claude/one-reader` | A, D, C | Sonnet; the strongest model reviews only the `/mine/learner` and Manage access rows |

A and D start together with B. C follows B. E follows A, D and C. Two or three builders at once, never two open PRs on the same hot file.

---

## Area A: the shell, sign-in landing and `/mine` skeleton

### Task A1: only the admin has a tab bar, and only on admin pages

**Files:**
- Modify: `src/components/portal/shell/tabs.ts` (`tabsFor`, `shellRole`, `roleOfPath`)
- Modify: `src/components/portal/shell/tab-bar.tsx` (render nothing when `tabsFor` is empty)
- Modify: `src/components/portal/shell/role-home.ts` (`rolePaths`, `workspaceDestination`)
- Modify: `src/components/portal/shell/more.tsx` (tutor branch retires)
- Modify: `src/app/workspace/more/page.tsx`, `src/app/workspace/student/page.tsx`, `src/app/workspace/parent/page.tsx`, `src/app/workspace/tutor/page.tsx` (each becomes a redirect to `/mine`)
- Test: `tests/app/tab-bar.test.ts`, `tests/app/role-homes.test.ts`, `e2e/tab-bar.spec.ts`, `e2e/account-roles.spec.ts`, `e2e/workspace-shell.spec.ts`

**Interfaces:**
- Produces: `tabsFor(context): ShellTab[]` returns the four admin tabs only when `context.role === "admin"` and `adminArea(pathname)` is true; otherwise `[]`. `adminArea(pathname: string): boolean` is true for `/workspace/admin/*` except `/workspace/admin/students/<id>/reading`, for `/workspace/accounts`, `/workspace/more`, `/workspace/email` and `/workspace/claude` (the admin's More pages), and `/workspace/tutor/<id>` is never an admin area.
- Produces: `rolePaths = { student: "/mine", parent: "/mine", tutor: "/mine", admin: "/workspace/admin/students" }`; `workspaceDestination(roles, remembered)` returns `/workspace/admin/students` when roles include admin, else `/mine` (an account with no role also goes to `/mine`; `/account` is no longer a destination).
- Produces: `MINE_HREF = "/mine"` exported from `role-home.ts`.

- [ ] **Step 1: Rewrite the tab tests** in `tests/app/tab-bar.test.ts`: `labels("admin", "/workspace/admin/students")` equals `["This week", "Students", "People", "More"]`; `tabsFor({ role, pathname: "/mine", tab: null })` is `[]` for every role; `tabsFor({ role: "admin", pathname: "/workspace/admin/students/<uuid>/reading", tab: null })` is `[]` (decision 20); `tabsFor({ role: "admin", pathname: "/workspace/accounts", tab: null })` has People current. Remove the student, parent and tutor label assertions. In `tests/app/role-homes.test.ts` (or `tests/app/signed-in-shell.test.ts`, whichever holds `workspaceDestination`) assert the new destinations.
- [ ] **Step 2: Run** `npx vitest run tests/app/tab-bar.test.ts tests/app/role-homes.test.ts` → FAIL on the new assertions.
- [ ] **Step 3: Implement** `adminArea` and the new `tabsFor`, `rolePaths`, `workspaceDestination`; delete the student, parent and tutor branches and the `practiceStudentId` prop from `tabsFor` and `TabBar`; `TabBar` returns null when `tabsFor` is empty. `MoreWorkspace` keeps only the admin rows (a non-admin at `/workspace/more` is redirected by Step 5).
- [ ] **Step 4: Run** the two test files → PASS. `npx tsc --noEmit --incremental false` clean.
- [ ] **Step 5: Redirects.** Each of the four pages renders `<RedirectTo href="/mine" />` (a 6-line client component in `src/components/portal/shell/redirect-to.tsx` using `router.replace`), keeping its metadata title. `/workspace/page.tsx` keeps `WorkspaceHomeRedirect` with the new destination.
- [ ] **Step 6: Update the browser tests.** `e2e/tab-bar.spec.ts`: the per-role four-tab test runs for admin only; add "a student, a parent and a tutor have no tab bar on /mine, /read or /account" (`[data-shell-tabs]` count 0); keep the admin rail, skip-link and foot tests. `e2e/account-roles.spec.ts:43`: `/workspace` leads to `/mine` for a student and to This week for an admin. `e2e/workspace-shell.spec.ts:22` title walk: add `/mine`, drop the retired pages.
- [ ] **Step 7: Commit** `Retire the student, parent and tutor tab bars and send every non-admin role home to /mine, keeping the admin row only on admin pages`.

### Task A2: the site bar's third link is My Readings

**Files:**
- Modify: `src/components/site/site-bar.tsx`
- Modify: `src/app/globals.css` (or the file that styles `.site-bar-nav`; find it with `site-bar-account-text`)
- Test: `tests/app/site-bar.test.ts`, `e2e/public-reader-layout.spec.ts:195`, `e2e/front-door.spec.ts:112`

**Interfaces:**
- Produces: `SiteLink = "read" | "learn" | "mine"`; `currentSiteLink("/mine")` and `currentSiteLink("/mine/reading")` return `"mine"`; `/account` returns `null`. Signed in, the bar's end is a link to `/mine` with a bookmark icon (`BookmarkIcon()`, same stroke as `AccountIcon`) and the text "My Readings", text hidden under 480 px with `aria-label="My Readings"` kept; signed out, Sign in as today.

- [ ] **Step 1: Tests.** In `tests/app/site-bar.test.ts`: signed in, the nav's links are `Read`, `Learn`, `My Readings` with hrefs `/read`, `/learn`, `/mine`; no link named `Account`; `currentSiteLink` cases above.
- [ ] **Step 2: Run** `npx vitest run tests/app/site-bar.test.ts` → FAIL.
- [ ] **Step 3: Implement** the link, the icon and the CSS (`.site-bar-mine-text` hidden below 480 px with the same width-reserving rule the account control used).
- [ ] **Step 4: Run** → PASS. Update the two e2e tests that look for the bar's `Account` link to look for `My Readings`.
- [ ] **Step 5: Commit** `Make My Readings the site bar's third place, with a bookmark icon alone under 480 px`.

### Task A3: sign-in lands on My Readings unless a return address says otherwise

**Files:**
- Modify: `src/components/portal/entry.tsx` (`signedInDestination`, the heading and lead, the "Ask for an account" link, `auth-landing-continue` destination)
- Modify: `src/lib/site/return-address.ts` (`PAGES` gains `/mine` and `/readings`; `KEEPS_QUERY` gains `/readings`)
- Modify: `src/app/sign-in/page.tsx` (title "Sign in")
- Modify: the Google callback and email-code landing defaults: grep `signedInDestination`, `"/"` fallbacks in `src/server/http/auth.ts`, `fragment-landing.ts`, `sign-in-code-binding.ts` and the auth SDK state in `src/server/auth/`; every "no return address" landing becomes `/mine`
- Test: `tests/app/return-address.test.ts`, `tests/app/landing-account.test.ts`, `tests/app/signed-in-shell.test.ts`, `tests/app/sign-in-code.test.ts`, `e2e/sign-in-return.spec.ts`, `tests/http-browser/auth-navigation.ts`

**Interfaces:**
- Produces: `signedInDestination(doors: boolean, back: string | null): string | null` returns `null` on the front door, else `back ?? "/mine"`.
- Produces: `returnAddress("/mine")`, `returnAddress("/readings?add=1")` valid; `returnAddress("/mine?x=1")` null.
- Wording (decision 21): h1 "Sign in"; lead "Your readings, marks and notes stay with your account."; the email field's help "Use the address on your invitation." becomes "Use the address you sign in with."; "Ask for an account" links retire from the sign-in page and the door (decision 13; the shelf offers "Ask to be linked", Task D8).

- [ ] **Step 1: Tests.** `return-address.test.ts`: the three cases above. `landing-account.test.ts` / `signed-in-shell.test.ts`: `signedInDestination(false, null) === "/mine"`, `signedInDestination(true, null) === null`, `signedInDestination(false, "/read?date=2026-11-14") === "/read?date=2026-11-14"`; the sign-in page's one wording test asserts the h1 and lead. `sign-in-code.test.ts`: a code landing with no bound address goes to `/mine`.
- [ ] **Step 2: Run** the four files → FAIL.
- [ ] **Step 3: Implement.** Keep G16 (already signed in on `/sign-in` goes back, else `/mine`). An accepted invitation's Continue goes to `workspaceDestination` (A1).
- [ ] **Step 4: Run** → PASS. Update `e2e/sign-in-return.spec.ts:136` and `:167` ("default page" is `/mine`), `e2e/front-door.spec.ts:100` ("reaches Today in one tap" becomes "reaches My Readings in one tap").
- [ ] **Step 5: Commit** `Land a plain sign-in on My Readings and say so on the sign-in page, keeping the return address first`.

### Task A4: `/mine`, the shelf's skeleton

**Files:**
- Create: `src/app/mine/layout.tsx` (the `WorkspaceProvider`, as `src/app/workspace/layout.tsx`), `src/app/mine/page.tsx` (metadata title `signedInTitle("My Readings")`)
- Create: `src/components/portal/mine/shelf.tsx`, `src/components/portal/mine/shelf.module.css`, `src/components/portal/mine/model.ts`
- Move: `src/components/portal/saved/my-readings.tsx` → `src/components/portal/mine/own-readings.tsx` (the list becomes "Also working on"); its test `tests/app/saved-ui.test.ts` parts move to `tests/app/mine-ui.test.ts`
- Modify: `src/components/portal/workspace/provider.tsx:583-599` (the shell draws `SiteBar` on every page; `TabBar` per A1; the skip link reads "Skip to main content" on `/mine`)
- Modify: `src/components/portal/front-door/front-door.tsx` (remove `<MyReadings />` from the home; Task B4 adds the door)
- Test: `tests/app/mine-ui.test.ts` (new), `e2e/mine.spec.ts` (new), `e2e/saved.spec.ts:114` and `:140` (move to mine.spec)

**Interfaces:**
- Produces: `shelfModel(input: { summary: SessionSummary; own: OwnReadingsState; pinned: PinnedState | null; learn: LearnRowState }): ShelfView` in `model.ts`, pure: it orders sections (pinned, "Also working on", the Learn row, the Account link) and decides the empty state. `PinnedState` is filled by Task E1; until then `null`.
- Produces: `Shelf()` renders: `PageHeader title="My Readings"` with one action, an "Add" `ButtonLink` to `/readings?add=1`; the sections; the foot line "Your tutor and the rabbi can see the readings you keep." followed by the disclosure sentence of Task D8; the muted link row "Account · roles, email, sign out" to `/account` (test id `mine-account`).
- Empty state (decision 9): title "My Readings", line "You’re signed in. Nothing is saved yet.", heading "Add your first reading" with four chips (this Shabbat, the next two by name from the calendar of Task B1 once it exists; until then the chips are "This Shabbat" and "Find a reading" to `/read` and `/readings`), then the card "Preparing a Beit Mitzvah at CRC?" with "Ask to be linked" (`AccountRequest`, re-worded in D8).
- "Also working on": rows (name; date as `longDate` or "No date"; `Torah`/`Haftarah` and the range; the got-it count once E1 adds it), sorted by date ascending, undated last by last opened (`createdAt` desc until the API carries last-opened), test id `mine-own`. The one-line note under the list: "Open a reading to rename it, change its date or verses, or remove it."
- The Learn row: `ListRow title="Learn to lein" meta={next lesson or "Start the course"} href="/learn"`, reading `src/components/learn/progress-sync.ts`'s local progress the way `src/components/learn/home.tsx` does.

- [ ] **Step 1: Tests.** `tests/app/mine-ui.test.ts` (static render as `tests/app/role-homes.test.ts` does): the empty state shows the title, the line, the four chips' roles and the linking card; with two readings the list has two rows in date order with the undated one last; the page has exactly one h1 and a link named "Account". One wording test: the title, the empty line and the foot line.
- [ ] **Step 2: Run** `npx vitest run tests/app/mine-ui.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the model, the page, the shelf and the moved list. The shelf reads `fetchSavedReadings` as the old list did; `state: "hidden"` (not eligible, until D lands) renders the empty state's chips and card without the "Nothing is saved yet." line (the student's shelf then shows only the pinned card after E1).
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit --incremental false` clean.
- [ ] **Step 5: Browser test** `e2e/mine.spec.ts`: signed in as the e2e member fixture, `/mine` shows the h1 "My Readings", the bar's My Readings is `aria-current="page"`, no `[data-shell-tabs]`, five readings then all inline (moved from saved.spec:114); signed out `/mine` shows the sign-in form under the same bar (the provider's existing signed-out state).
- [ ] **Step 6: Commit** `Add /mine, the shelf of My Readings, with the empty first-sign-in state, and take the saved list off the home`.

### Task A5: Account's role rows and the front door's signed-in door

**Files:**
- Modify: `src/components/portal/account-page.tsx` (`roleTasks`, rows use `rolePaths`; `AccountRequest` only for an account with no role, re-worded in D8)
- Modify: `src/components/portal/front-door/front-door.tsx` (`signedInDoor`, `BeitMitzvahDoor`, the signed-out door)
- Test: `tests/app/front-door.test.ts`, `tests/app/landing-account.test.ts`, `e2e/front-door.spec.ts`

**Interfaces:**
- Produces (decision 12, 22): `signedInDoor(role, facts): SignedInDoor` returns for student, parent and tutor `{ title: "Your readings", line, action: "Open My Readings", href: "/mine" }` where `line` is `facts.pinned ? "{name} · Beit Mitzvah, {Sat, May 1, 2027} · {n} of {m} verses" : facts.count !== undefined ? "{count} saved" : null` (a tutor's facts name the student with the nearest ceremony, a parent's the child's: both come from the summary once E3 provides them; until then `null`); for admin `{ title: "This week", line: "Needs you, ceremonies and rehearsals.", action: "Open This week", href: "/workspace/admin/students" }`. The door's `data-door-role` stays.
- Signed out (decision 12): title "Your readings"; line "Save the readings you’re working on, mark verses, keep notes. Beit Mitzvah students and families find their assigned reading and tutor here too."; the Sign in pill; the muted link "How accounts work" to `/about#accounts` (About gains that anchor in D8). "Ask for an account" leaves the door.
- Signed in with a pinned or saved reading (decision 22): the door moves directly under the hero's buttons (before Find a reading, which B4 adds); otherwise it stays beside the Learn door. `FrontDoorAccount` of kind `account` gains `count: number | null` and `pinned: DoorFacts["pinned"]` (both null until E3).

- [ ] **Step 1: Tests.** `front-door.test.ts`: the signed-out door's title, line and two links; a student's door title "Your readings" and action "Open My Readings" to `/mine`; an admin's unchanged; with `count: 3` the door renders under the hero (`data-door-place="hero"`), with `count: 0` beside Learn (`data-door-place="doors"`). One wording test for the door.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5:** `e2e/front-door.spec.ts:37`, `:66`, `:112`: door names and the absent "Ask for an account" link. `account-roles.spec.ts:15`: choosing Student opens `/mine`.
- [ ] **Step 6: Commit** `Name the home's door Your readings for everyone, open it on My Readings, and move it under the hero once the person keeps a reading`.

### Task A6: words retired by area A

**Files:** `src/components/learn/first-verse.tsx:37`, `src/components/learn/home.tsx:102` ("Back to my reading" → "My Readings", href `/mine`); `src/components/site/site-footer.tsx` and `src/app/about/page.tsx:66` ("Your account and reading stay private." → "Your account stays private."); `src/components/portal/saved/yours.tsx` `YOURS_STRINGS.privacy` → "Your tutor and the rabbi can see what you keep here."; `src/components/portal/saved/save-reading.tsx` the saved line "Saved to My readings." links to `/mine` and reads "Saved to My Readings."; `STUDENT_LINE` and its "Open your reading" link retire in D2 (students become eligible).

- [ ] **Step 1:** grep the tests for each old string (`tests/app/saved-ui.test.ts`, `tests/app/about.test.ts`, `e2e/learn-own-reading.spec.ts`, `e2e/saved.spec.ts`) and update them to the new strings.
- [ ] **Step 2:** Make the changes; run the touched test files → PASS.
- [ ] **Step 3: Commit** `Retire the lines that promised only you can see your readings and point every Back to my reading at My Readings`.

### Task A7: open the PR

- [ ] Merge `origin/main` into the branch, run `npx tsc --noEmit --incremental false`, the changed test files and `node --test tests/never-in-repo.test.mjs`; push; open PR "Area A: one bar, My Readings as the home of every non-admin role, sign-in lands on the shelf"; stop.

---

## Area D: eligibility, the staff read path, claims and link requests (adversarial pass)

### Task D1: a membership at first sign-in, and eligibility for every membership

**Files:**
- Modify: `src/server/access/eligibility.ts` (`memberEligible`)
- Modify: `src/server/portal/service.ts` (`sessionSummary`: `saved: identity.membership !== null`; new `beginSession`)
- Modify: `src/server/http/portal.ts` (route `/api/session/begin`, `POST`, cookie mutation)
- Modify: `src/components/portal/entry.tsx` and `src/components/portal/workspace/provider.tsx` (after a 200 from `/api/session` with `membershipAvailable: false`, call `POST /api/session/begin` once and use its summary)
- Modify: `src/server/data/course-progress.ts:25`, `src/server/data/service-course-progress.ts:25` (unchanged call, new meaning: every membership syncs)
- Modify: `src/server/accounts/service.ts` (`requestState`'s `member` state is decided by `activeMember` as today; nothing else)
- Test: `tests/app/access.test.ts`, `tests/app/portal.test.ts`, `tests/app/saved.test.ts`, `tests/app/learn-progress-sync.test.ts`, `tests/postgres/saved-rls.integration.mjs`, `tests/app/portal-routes.test.ts`

**Interfaces:**
- Produces: `memberEligible(tx, tenantId, membershipId): Promise<boolean>` true when a `membership` row with that id exists in that tenant with `disabledAt` null (share-locked); `tenant_member` and role grants are no longer consulted. `SAVED_ELIGIBLE_ROLES` is deleted with its import in `eligibility.ts`.
- Produces: `beginSession(request): Promise<SessionSummary>` under `withVerifiedIdentity(request, { intent: "data-write", mutation: true })`: `obtainMembership` when `identity.membership` is null, then the same summary `sessionSummary` builds. Route `POST /api/session/begin` with `requireCookieMutation`.
- The session summary's `saved` is `identity.membership !== null`.

- [ ] **Step 1: Tests.** `saved.test.ts`: a student-only membership creates and lists a reading (today it is refused); a membership with no role and no `tenant_member` row does too; a disabled membership is 403. `portal.test.ts`: `POST /api/session/begin` for an identity with no membership returns `membershipAvailable: true, saved: true` and inserts exactly one membership row; a second call inserts none; a GET to it is 405. `learn-progress-sync.test.ts`: a membership with no role syncs. `saved-rls.integration.mjs`: the owner policy still refuses a row of another membership.
- [ ] **Step 2: Run** `npx vitest run tests/app/saved.test.ts tests/app/portal.test.ts tests/app/learn-progress-sync.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run test:local-db -- tests/postgres/saved-rls.integration.mjs` → PASS.
- [ ] **Step 5: Commit** `Give every signed-in person a membership on their first sign-in and open the saved layer and Learn sync to every live membership`.

### Task D2: students save readings; the student-only lines retire

**Files:** `src/components/portal/saved/save-reading.tsx` (`STUDENT_LINE`, the `student` branch and `not-eligible` step), `src/components/portal/saved/saved-reading.tsx` (`SavedReadingState` "not-eligible" branch), `src/components/portal/api.ts` (`parseSession` rule "a saved layer needs a membership" stays; the approver rule stays). Tests: `tests/app/saved-ui.test.ts`, `tests/app/saved-reading-ui.test.ts`, `e2e/saved.spec.ts:29` and `:140`, `tests/http-browser/saved-ui.test.ts`.

- [ ] **Step 1:** Update the tests: a signed-in student pressing Save gets the form; the `not-eligible` step is kept only for a disabled membership (server 403) and reads "Saving isn’t available for this account." (lead's wording, gap listed).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. `npm run test:local-db -- tests/http-browser/saved-ui.test.ts` → PASS.
- [ ] **Step 5: Commit** `Let students save readings like everyone else and retire the student-only Save lines`.

### Task D3: migration 0054

**Files:**
- Create: `src/server/db/migrations/0054_readings_for_everyone.sql` and its `meta/0054_snapshot.json` + journal entry (`npx drizzle-kit generate` after the schema change, then hand-edit the policies in; the journal test `tests/migration-journal.test.mjs` must pass)
- Modify: `src/server/db/accounts-schema.ts` (`accountRequest.studentId: uuid("student_id")` nullable, FK to `student` by tenant), `src/server/db/tenant-schema.ts` (new `learnerClaim` table; `audit_action_known` gains `'learner.claim','learner.unclaim'`)
- Test: `tests/app/schema.test.ts`, `tests/app/saved-migration.test.ts` pattern → new `tests/app/readings-for-everyone-migration.test.ts`, `tests/postgres/saved-rls.integration.mjs`, `tests/saved-structure.test.mjs`

**Interfaces (the SQL):**
- `learner_claim`: `id uuid pk default gen_random_uuid()`, `tenant_id text not null references tenant`, `learner_membership_id uuid not null`, `tutor_grant_id uuid not null`, `tutor_link_id uuid null`, `created_at timestamptz not null default now()`, `revoked_at timestamptz null`, `revoked_by text null check (revoked_by in ('learner','tutor','admin'))`, `revoked_by_membership_id uuid null`; FKs by `(tenant_id, …)` to `membership`, `role_grant` and `tutor_link` as the neighbouring tables do; `unique (tenant_id, id)`; partial unique index `learner_claim_active_key on (tenant_id, learner_membership_id) where revoked_at is null` (one tutor per learner by claim); check `(revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoked_by_membership_id is null)`; RLS as the tenant tables have it (`tenant_id = current_setting('app.tenant_id')`).
- Policies: `create policy staff_read on saved_reading for select to portal_runtime using (tenant_id = nullif(current_setting('app.tenant_id', true), '') and membership_id = nullif(current_setting('app.saved_viewer', true), '')::uuid);` and the same on `saved_verse_work`, `saved_verse_mark`, `starred_comment`; `create policy directory_read on saved_reading for select to portal_runtime using (tenant_id = nullif(current_setting('app.tenant_id', true), '') and current_setting('app.saved_directory', true) = 'on');`. The existing `owner_only` policies are untouched.
- `alter table account_request add column student_id uuid; alter table account_request add constraint account_request_student_fk foreign key (tenant_id, student_id) references student (tenant_id, id);`

- [ ] **Step 1: Tests.** The migration test (copy the shape of `tests/app/saved-migration.test.ts`): 0054 applies on PGlite after 0053; the new table, the column, the six policies and the two audit actions exist; `saved-rls.integration.mjs` gains: with `app.saved_viewer` set to the owner's membership and no `app.saved_owner`, a select on each saved table returns the owner's rows and an insert or update is refused; with `app.saved_directory = 'on'` a select on `saved_reading` returns rows of two owners and nothing from `saved_verse_mark`; with neither setting nothing is visible.
- [ ] **Step 2: Run** → FAIL. **Step 3: Write the migration.** **Step 4: Run** `npx vitest run tests/app/readings-for-everyone-migration.test.ts tests/app/schema.test.ts`, `npm run test:local-db -- tests/postgres/saved-rls.integration.mjs`, `node --test tests/migration-journal.test.mjs tests/saved-structure.test.mjs` → PASS (the structural test is extended in D4 to name the new settings).
- [ ] **Step 5: Commit** `Add migration 0054: learner claims, read-only staff and directory policies on the saved layer, and a link request's target student`.

### Task D4: the viewer and directory bindings

**Files:**
- Modify: `src/server/saved/access.ts` (`bindViewer`, `createSavedViewerAccess`, `withDirectory`)
- Modify: `src/server/data/saved.ts` (no change to queries; they filter on the owner they are given)
- Modify: `src/server/saved/service.ts` (`listReadingsOf`, `readingOf`, `pageOf`: the read functions parameterised by a `SavedScope`)
- Modify: `tests/saved-structure.test.mjs` (only `access.ts` and the 0036, 0041 and 0054 migrations name `app.saved_owner`, `app.saved_viewer`, `app.saved_directory`; each is set in exactly one statement)
- Test: `tests/app/saved-viewer.test.ts` (new), `tests/saved-structure.test.mjs`

**Interfaces:**
- Produces: `SavedScope = Readonly<{ tenantId: string; membershipId: string }>` (the person whose rows are read). `SavedOwner` extends it.
- Produces: `createSavedViewerAccess(input).withSavedViewer<T>(request, learnerMembershipId: string, action: (tx, scope: SavedScope, viewer: Viewer) => Promise<T>)`: under `withVerifiedIdentity(request, { intent: "read" })`, requires `identity.membership`; `canView(tx, tenantId, viewerMembershipId, learnerMembershipId): Promise<"admin" | "tutor" | null>` is true for a live admin grant, or a live tutor grant that has an unrevoked `learner_claim` on the learner, or an unrevoked `tutor_link` to a student whose `student_identity` grant belongs to the learner's membership; a null answer is `AccessDenied(404)`; then `set_config('app.saved_viewer', learnerMembershipId, true)`; `app.saved_owner` is never set on this path, so the owner policies' `WITH CHECK` can never pass.
- Produces: `withDirectory<T>(request, action: (tx, actor) => Promise<T>)`: a live admin or tutor grant, else 404; `set_config('app.saved_directory', 'on', true)`; the action may only call `directoryRows` (D5).

- [ ] **Step 1: Tests** (`saved-viewer.test.ts`, PGlite with the access fixture): an admin reads a member's readings and a page's marks and work; a tutor with a claim reads them; a tutor without one is 404; a tutor from another tenant is 404 (review focus 1); any write attempted inside the viewer action is refused by the database; the viewer action cannot read a third person's rows. Structural test updated.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/app/saved-viewer.test.ts` and `node --test tests/saved-structure.test.mjs` → PASS.
- [ ] **Step 5: Commit** `Add the read-only viewer and directory bindings to the saved layer, set in the one file that may name a saved setting`.

### Task D5: the learner directory, claims and the learner's own tutor

**Files:**
- Create: `src/server/learners/service.ts`, `src/server/learners/data.ts`, `src/server/http/learners.ts`
- Modify: `src/server/http/dispatch.ts` (register the routes), `src/server/runtime/*` (construct the service as the others are), `src/server/relationships/service.ts` (export `writeTutorAssignment`/`writeTutorRevocation` already public; add `revokeClaimLinks` hook on tutor-link revoke so an admin's revoke on the access page also revokes the claim that created the link)
- Modify: `src/server/http/saved.ts` (routes `/api/saved/learner/readings?learner=`, `/api/saved/learner/reading?learner=&id=`, `/api/saved/learner/page?learner=&id=&offset=` through `withSavedViewer`)
- Test: `tests/app/learners.test.ts` (new), `tests/app/relationships.test.ts`, `tests/app/portal-routes.test.ts`, `tests/app/http-boundaries.test.ts` (route tables)

**Interfaces:**
- `GET /api/learners?q=&after=` (tutor or admin): `{ learners: [{ membershipId, name, readings: number, nearest: { name, date } | null, tutor: { name, claimed: boolean, mine: boolean } | null, student: { id, firstName, lastName, ceremonyDate } | null }] }`, at most 50, name order; `q` is a case-insensitive prefix on the name; `name` is the account's name through `displayName(value, "Learner")`, never an email. Counts and the nearest dated reading come from `directoryRows(tx)` under `withDirectory`: one grouped query on `saved_reading` (`count(*)`, `min(reading_date) filter (where reading_date >= today)`).
- `POST /api/learners/claim { learner }` (tutor; an admin who is also a tutor claims with the tutor grant): inserts `learner_claim`; when the learner's membership has a live `student_identity`, also `writeTutorAssignment` and stores `tutor_link_id`; audit `learner.claim` with the claim id; 409 `{ code: "has-tutor" }` when an unrevoked claim or tutor link already names another tutor (the spec: one tutor at a time; the rabbi reassigns on the access page); idempotent for the same tutor.
- `POST /api/learners/unclaim { learner }` (the claiming tutor, or an admin): revokes the claim and its tutor link; audit `learner.unclaim`.
- `GET /api/mine/tutor` (anyone signed in): `{ tutor: { name, claimed: boolean } | null }` from the claim or, for a linked student, the tutor link. `POST /api/mine/tutor/remove` (the learner): revokes the claim (`revoked_by = 'learner'`) and the link it created; a rabbi's assignment is not a claim and is refused with 409.
- The three `/api/saved/learner/*` reads return the same bodies as `/api/saved/readings`, `/api/saved/reading` and the page read, read-only.

- [ ] **Step 1: Tests** (`learners.test.ts`): a tutor lists learners with counts and nearest dates and never sees an email; a student-only account cannot list (404); claiming a member with no student record creates a claim and no tutor link; claiming a linked student creates both and the student's inspect shows the tutor; a second tutor's claim is 409; unclaim by the learner revokes both and writes `learner.unclaim`; unclaim of a rabbi's assignment is 409; after unclaim the tutor's `/api/saved/learner/readings` is 404 and the learner's own list still works (review focus 2); an admin's tutor-link revoke on the access page revokes the claim that made it. `portal-routes.test.ts` and `http-boundaries.test.ts`: the new routes are registered with their methods.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Add the learner directory, tutor claims with their undo, and the read-only routes a tutor or the rabbi uses to see a learner's shelf`.

### Task D6: link requests

**Files:**
- Modify: `src/server/accounts/validation.ts` (`request` accepts optional `studentId`; `approve` accepts optional `studentId`), `src/server/accounts/service.ts` (`request` stores it; `requests` lists `student` name when set; `approve` links when a target is given: `linkInvitedStudent`-equivalent write `linkRequestedStudent(tx, actor, membershipId, studentId)` that inserts a `student` grant and the identity, audits `grant.issue` and `identity.link`; 409 `{ code: "identity-taken" }` when the student already has an identity), `src/server/accounts/data.ts` (`insertRequest` with student id; `listRequests` joins the student's name), `src/server/http/accounts.ts`
- Modify: `src/components/portal/account-request.tsx` (title "Ask to be linked"; lead "Preparing a Beit Mitzvah at CRC? Ask the rabbi to connect this account to your student record."; the name field stays; the purpose field becomes "Who you are (the student’s name and ceremony date, or whose parent you are)"; submit "Send request"; pending state "Your request is in" / "You’ll get one email when it’s been linked."; the `member` state retires)
- Modify: `src/components/portal/workspace/accounts/workspace.tsx` (heading "Link requests"; each row shows the requester's words and a student select from `/api/students` (admin) or the approver's own students; "Approve and link" with the chosen student, "Approve without linking", "Decline"; `APPROVER_HELP_LINE` kept, `APPROVER_PARENT_LINE` kept)
- Modify: the two account emails' wording in `src/server/mail/` where "approved" is said: "linked" when a target was given (grep `account-approved`)
- Test: `tests/app/accounts.test.ts`, `tests/app/accounts-ui.test.ts`, `tests/app/accounts-migration.test.ts`, `tests/app/pending-request.test.ts`, `tests/app/account-mail.test.ts`, `tests/http-browser/accounts-ui.test.ts`

- [ ] **Step 1: Tests.** A request with a student id is stored and listed with the student's name; approve with a target creates the member row, a student grant and the identity, and the session summary then lists `student`; approve with a target whose identity is taken is 409 and changes nothing; approve without a target is today's approval; a request made before 0054 (no student) still lists and approves. UI: the form's title and the approver's three buttons by role; one wording test for the request form.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run test:local-db -- tests/http-browser/accounts-ui.test.ts` → PASS.
- [ ] **Step 5: Commit** `Turn account requests into link requests: the person asks to be connected to a student record and the approver links the account when they approve`.

### Task D7: Your students and Find a learner on the shelf; Tutor: name on the learner's shelf

**Files:**
- Create: `src/components/portal/mine/your-students.tsx`, `src/components/portal/mine/find-a-learner.tsx`, `src/components/portal/mine/my-tutor.tsx`, `src/components/portal/mine/api.ts` (fetchers for `/api/learners*`, `/api/mine/tutor*`, `/api/saved/learner/*`)
- Create: `src/app/mine/learner/[membershipId]/page.tsx` and `src/components/portal/mine/learner-shelf.tsx` (a learner's shelf, read-only: the same "Also working on" list; each row opens `/read?saved=<id>&learner=<membershipId>`)
- Modify: `src/components/portal/saved/saved-reading.tsx` (a `learner` query opens the viewer read path: marks and the Yours row shown read-only; Edit, Change verses and the mark buttons absent; the title block's muted line adds "{name}’s reading")
- Modify: `src/components/portal/mine/shelf.tsx` (sections by role: tutor → Your students, Find a learner, then own readings; everyone → the "Tutor: {name}" line with "Not my tutor" when the tutor is a claim)
- Modify: `src/components/portal/public-reading/urls.ts` (`parseReadAddress` accepts `learner=<uuid>` with `saved=`)
- Test: `tests/app/mine-ui.test.ts`, `tests/app/public-reading-urls.test.ts`, `tests/app/saved-reading-ui.test.ts`, `e2e/mine.spec.ts`, `tests/http-browser/saved-ui.test.ts`

**Interfaces:**
- "Your students" (decision 17): `ListRow` per student from `workspaceApi.students("tutor")` plus the claimed learners from `/api/learners` with `tutor.mine`, nearest ceremony first (claimed learners without a ceremony after the dated ones, by name), each with the days to go (`ceremonyCountdown`), the latest lesson note's first line (`fetchLessons(…, { type: "latest" })` if the operation exists, else the first page's first entry), and "Open" to `/workspace/tutor/<studentId>` or `/mine/learner/<membershipId>`.
- "Find a learner": a search field (label "Find a learner", `type="search"`), rows `name · {n} readings · next {date or "no date"} · {Tutor: name | No tutor yet}`, button "Claim as my student" (disabled with the tutor's own name when `tutor.mine`), `role="status"` line after a claim: "{name} is now your student." Admin rows add "Remove claim" when `tutor.claimed`.
- The learner's line: "Tutor: {name}" with the link "Not my tutor" (claims only); after undo, "Your tutor was removed." (`role="status"`).

- [ ] **Step 1: Tests.** `mine-ui.test.ts`: a tutor's shelf renders Your students before Find a learner before own readings; a parent's or student's shelf has neither; the Tutor line and the undo link appear only for a claim; the learner shelf page has no Edit or mark controls (`saved-reading-ui.test.ts`). `public-reading-urls.test.ts`: `learner` parses with `saved` and is dropped without it.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Browser:** `e2e/mine.spec.ts`: the tutor fixture finds the member fixture by name, claims in one tap, opens the shelf, sees the readings; the member sees "Tutor: {name}" and "Not my tutor" works. (The e2e server's fixtures live in `e2e/server-setup.ts`'s built server; add a claim fixture there if the mocked session cannot carry one.)
- [ ] **Step 6: Commit** `Put Your students and Find a learner on a tutor's shelf, let a tutor claim a learner in one tap and open their shelf, and let the learner undo the claim`.

### Task D8: what the site says it records

**Files:** `src/app/about/page.tsx` (the N23 disclosure section gains the sentence "Readings you keep, with their marks and notes, can be seen by your tutor and the rabbi."; an `id="accounts"` anchor on the accounts section), `src/components/portal/account-page.tsx` (the same sentence under the N23 line), `src/components/portal/mine/shelf.tsx` (the foot line appends "{What the site records about you}" as a link to `/about#accounts` named "What the site records about you"), `src/components/portal/account-request.tsx` wording from D6. Tests: `tests/app/about.test.ts`, `tests/app/accounts-ui.test.ts`, `tests/app/mine-ui.test.ts`.

- [ ] **Step 1:** Tests for the sentence on About and Account and the link on the shelf. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Say on About, Account and the shelf that a tutor and the rabbi can see the readings a person keeps`.

### Task D9: adversarial pass and the PR

- [ ] **Step 1:** Merge `origin/main` (area A should have merged; resolve `shelf.tsx` if both touched it). Run `npx tsc --noEmit --incremental false`, every test file this area touched, `node --test tests/never-in-repo.test.mjs tests/saved-structure.test.mjs tests/migration-journal.test.mjs`, and `npm run test:local-db -- tests/postgres/saved-rls.integration.mjs tests/http-browser/saved-ui.test.ts tests/http-browser/accounts-ui.test.ts`.
- [ ] **Step 2:** Push; open PR "Area D: a shelf for every signed-in person, tutors find and claim learners, link requests"; stop.
- [ ] **Step 3 (lead):** dispatch the adversarial reviewer (strongest model, read-only) with the diff and these attacks: (1) a viewer binding that leaks `app.saved_owner` or sets `app.saved_viewer` outside `access.ts`; (2) a write through any `/api/saved/learner/*` route or inside `withSavedViewer`; (3) cross-tenant membership ids in `claim`, `unclaim`, `learner=` and `/api/mine/tutor/remove`; (4) a claim by a revoked or disabled tutor grant, or on a disabled membership, or racing two tutors (the partial unique index must hold); (5) the directory revealing emails, rows of other tenants, or marks and notes; (6) `POST /api/session/begin` creating memberships for an unverified user, for a refused (`forbidden`) account, or in a tenant the host does not resolve to; (7) link-request approval granting a role the approver cannot grant (a tutor-approver linking to a student not theirs; an identity already taken); (8) eligibility: a disabled membership, a revoked grant and an ended member all still refused where they must be, and a membership from another tenant never eligible; (9) the audit rows carry the actor's grant, never the learner's; (10) every new route is cookie-mutation checked and never cacheable.
- [ ] **Step 4 (lead):** one fix round, re-review only the security deltas, then `bash ~/.claude/scripts/merge-if-green.sh <pr> C:/Users/dsbog/bneimitzvah-study` after applying 0054 to production.

---

## Area B: the calendar, Find a reading, `/readings` and the Change sheet

### Task B1: `/api/public/calendar`, a year of Shabbatot

**Files:**
- Modify: `src/server/http/public-reading.ts` (route `"/api/public/calendar": { kind: "calendar", keysets: [[]] }`, response headers `cache-control: public, max-age=3600`, `vercel-cdn-cache-control: public, s-maxage=86400, stale-while-revalidate=86400`)
- Modify: `src/server/public-reading/service.ts` (`calendar(signal): Promise<CalendarRow[]>`)
- Create: `src/lib/readings/calendar.ts` (`CalendarRow`, `nextShabbatot(today, weeks)`, `parseCalendar(value): CalendarRow[]`)
- Create: `src/components/portal/public-reading/calendar-api.ts` (`fetchCalendar(signal): Promise<CalendarRow[]>`, memoised per page load)
- Test: `tests/app/public-reading-calendar.test.ts` (exists: extend), `tests/app/public-cache-headers.test.ts`, `tests/app/readings.test.ts`

**Interfaces:**
- `CalendarRow = Readonly<{ date: string; name: string | null; kind: "regular" | "holiday" | "other" }>`: `date` a Saturday, `name` the week resolver's `parashah` (null when the resolver has none), `kind` from the snapshot's `classification` (`regular` → regular, `holiday` → holiday, anything else → other).
- `calendar()` runs `week(date)` for each Saturday from `thisShabbat()` through 65 weeks ahead (fifteen months), in parallel batches of 8, and returns rows in date order; a week whose resolver fails is `{ date, name: null, kind: "other" }` so one bad week never fails the calendar. The body is `{ today: string, rows: CalendarRow[] }`.

- [ ] **Step 1: Tests.** The route answers with 66 rows in date order starting with this Shabbat, the headers above, and `rows[i].kind` matching a fixture snapshot's classification; a query string is refused (keyset `[]`); a failing week is `name: null`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Serve a public calendar of the next fifteen months of Shabbatot with each week's parashah or holiday, cached for a day`.

### Task B2: `findReadings`, one field with three kinds of answer

**Files:**
- Create: `src/lib/readings/find-reading.ts`
- Test: `tests/app/find-reading.test.ts` (new)

**Interfaces:**
- `FindResult = { kind: "named"; slug: string; name: string; group: NamedReadingGroup; next: string | null } | { kind: "date"; date: string; name: string | null } | { kind: "ref"; ref: string; readingKind: StudyKind }`.
- `findReadings(text: string, context: { calendar: readonly CalendarRow[]; today: string }): FindResult[]`, at most 8, pure, no I/O. Order: an exact name match first; then a date answer when the text parses as a date (`Nov 14`, `11/14`, `2026-11-14`, `November 14 2026`; a date with no year is the next occurrence on or after `today`); then named readings whose normalised name (lower case, apostrophes, hyphens and diacritics stripped) starts with the text, parashiyot first in Torah order, then holidays and special Shabbatot; then a verse reference when `canonicalReadingRef(text, "torah") ?? canonicalReadingRef(text, "haftarah")` answers. A named result's `next` is the first calendar row with that name on or after `today`. A date answer is the Shabbat on or after the date with the calendar row's name.
- `NO_MATCH_LINE = (text) => "No reading called {text}. Try a parashah, a holiday, a date like Nov 14, or verses like Genesis 25:19."`
- `addressOf(result: FindResult, options: { study?: boolean; add?: boolean }): string` maps to `readAddress` (`named` → `{ mode: "named", slug, passage: 1 }`, `date` → `{ mode: "week", date, kind: null }`, `ref` → `{ mode: "ref", ref, kind }`), adding `&save=1` when `add` (the existing Save return key, builder check 7).

- [ ] **Step 1: Tests.** "Tol" → Toldot first with its next date; "Chanukah" → the holiday; "Nov 14" with today 2026-10-27 → the 2026-11-14 Shabbat and its name; "11/14" the same; "2026-11-14" the same; "Genesis 25:19-26:5" → a ref result with the canonical ref; "Isaiah 54" → a haftarah ref; "Num" → Numbers-book parashiyot do not appear by book name, but any parashah starting "Num" would (review focus 4: the list is ordered as above and `results[0]` is what Enter opens); "zzz" → `[]`; a holiday date → the holiday row's name; never more than 8.
- [ ] **Step 2: Run** `npx vitest run tests/app/find-reading.test.ts` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Add findReadings: one text field that answers with a parashah or holiday, a Shabbat on or after a date, or a verse reference`.

### Task B3: the Find a reading component

**Files:**
- Create: `src/components/portal/find-reading/find-reading.tsx`, `find-reading.module.css`
- Test: `tests/app/find-reading-ui.test.ts` (new), `e2e/find-reading.spec.ts` (new)

**Interfaces:**
- `FindReading({ place, study, add, onOpen }: { place: "home" | "sheet" | "index"; study?: boolean; add?: boolean; onOpen?(address: string): void })`: a labelled search field ("Find a reading", placeholder "A parashah, a holiday, a date or verses"), a calendar button (`aria-label="Pick a date"`, opens a native `input type="date"`), a results listbox (`role="listbox"`, at most eight `role="option"`, arrow keys move, Enter opens the first or the highlighted one), the no-match line as `role="status"`; "Coming up": four chips (`place: "home"` and `"sheet"`) with the next four rows' names, each a link to the week's address (this Shabbat's chip says "This Shabbat"; on a Saturday the home's `next` rule applies); the link "Every parashah, holiday and passage" to `/readings` (not on `place: "index"`). Calendar loading: chips hold their height; failed: "Couldn’t load the calendar." with Try again, the field still answers names and refs.
- Opening: `onOpen(address)` when given (the sheet closes first), else `window.location.assign`.

- [ ] **Step 1: Tests.** Static render: the field's label, four chips with link roles, the index link; typing "Tol" lists Toldot as an option; Enter navigates to Toldot's address (mock `onOpen`); an unknown text shows the no-match line; `place: "index"` has no chips link. One wording test: the label, the placeholder, the link text.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Add the Find a reading field with its date picker, Coming up chips and the link to every reading`.

### Task B4: Find a reading on the home

**Files:** `src/components/portal/front-door/front-door.tsx` (after the hero and the signed-in door of A5: `<FindReading place="home" />`; the hero's Lein and Study buttons stay), `src/components/portal/front-door/front-door.module.css`. Tests: `tests/app/front-door.test.ts`, `e2e/front-door.spec.ts:37` (the home is a front door to This week, Find a reading, Your readings and Learn to lein), `e2e/public-reader-layout.spec.ts` CLS pattern applied to `/` (add a test: CLS at most 0.07 while the week and the calendar arrive).

- [ ] **Step 1:** Tests. **Step 2:** FAIL. **Step 3:** Implement (reserve the chips' row height while the calendar loads). **Step 4:** PASS.
- [ ] **Step 5: Commit** `Put Find a reading on the home under the hero, so any future parashah is one tap on a chip or two with the search`.

### Task B5: `/readings`, the index

**Files:**
- Create: `src/app/readings/page.tsx` (public; metadata title `pageTitle(productName, "Readings")`, `revalidate = 3600`, robots as `/read`), `src/components/portal/readings-index/index.tsx`, `index.module.css`
- Modify: `src/lib/site/sitemap.ts` (add `/readings`), `src/lib/site/return-address.ts` already from A3
- Modify: `src/components/portal/public-reading/reading-chooser.tsx` → delete; `src/components/portal/public-reading/view.tsx` (`useChooser` and the chooser's in-page render retire; an address that names nothing shows "Reading unavailable" with the link "Every parashah, holiday and passage" to `/readings`)
- Modify: `src/components/learn/passage-preparation.tsx` (the `details` chooser and "Choose another reading in Lein" become one link "Choose a reading" to `/readings?for=prepare`; the index, with `for=prepare`, opens rows at `/learn/prepare?kind=<kind>&ref=<canonical ref>` using `preparationTarget`'s query shape)
- Test: `tests/app/readings-index.test.ts` (new), `tests/app/learn-passage-preparation.test.ts`, `e2e/any-reading.spec.ts` (rewrite: the three choices come from `/readings`), `e2e/readings.spec.ts` (new), `tests/http-browser/public-reading-ui.test.ts`, `e2e/public-reader-layout.spec.ts:102`, `:167`

**Interfaces (decision 4):**
- Sections in order: `PageHeader title="Readings"`; `FindReading place="index"`; "Coming up" (six rows: `longDate`, name, a note "This Shabbat" on the first when it is this week's, "Holiday" when `kind === "holiday"`); "The Torah, in order" (five `details` groups from `parashotByBook()` moved into `src/lib/readings/named-readings.ts`, the current book open, each parashah a row with "next {short date}" from the calendar); "Holidays and special Shabbatot" (the `special`, `festival`, `fast` groups); "Any verses" (the existing `ReadingPassageSelect` pickers, Torah or Prophets, with the existing refusal lines). Every row is a link to `readAddress(...)`, with `?add=1` → `&save=1` carried, and with `for=prepare` → the prepare address.
- The Hebcal credit line moves here from the chooser.

- [ ] **Step 1: Tests.** Static render: the h1, the five book groups in Torah order with the current book open, 54 parashah links, the holiday groups, the credit; with `add=1` every link carries `save=1`; with `for=prepare` the first parashah link starts with `/learn/prepare?`. `learn-passage-preparation.test.ts`: the page has one link to `/readings?for=prepare` and no `details` chooser. One wording test for the section headings.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. Rewrite `e2e/any-reading.spec.ts:43` and `:121` to go through `/readings`; `e2e/readings.spec.ts`: axe clean and CLS at most 0.07 on `/readings` at 390 px.
- [ ] **Step 5: Commit** `Add /readings, the index of every parashah, holiday and passage with the Shabbat each is next read, and retire the three dropdowns`.

### Task B6: the Change sheet

**Files:**
- Modify: `src/components/portal/public-reading/read-header.tsx` (the button reads "Change" with a chevron; the sheet's title "Change reading"; contents in order: `<FindReading place="sheet" onOpen={…} />`, then a heading "In this reading" over the slot that holds the Portion row and Choose verses (unchanged from `view.tsx`'s portal) and a new "Go to verse" row)
- Modify: `src/components/portal/public-reading/view.tsx` (the More sheet's `top`/`rest`: Start reading, Print, Save, Find a date, This week, Choose a reading, Trope chart and the blessings leave the sheet; Print, Trope chart and the blessings move to `ReadingFoot` (Task C3); Save becomes the pill (Task C2); "Go to verse": the chapter select that today sits in the top (`PassageReading`'s section/chapter control) renders inside the sheet's slot as a labelled select "Go to verse" that closes the sheet and scrolls/focuses the verse)
- Test: `e2e/read-header.spec.ts` (`:29` the header is the title block with Change; `:53` keyboard walk of the sheet; `:83` Tab-stop budget recomputed: the dock in at most 12 presses; `:122` choosing a portion closes the sheet; add "a Coming up chip in Change opens that Shabbat"; delete `:137` the week arrows), `e2e/more-sheet.ts` and `tests/http-browser/more-sheet.ts` helpers (the button name "Change", the dialog name "Change reading"), `tests/http-browser/public-reading-ui.test.ts`

- [ ] **Step 1:** Update the helpers and tests to the new names and contents; add the chip test; delete the arrows test (the arrows themselves go in C1).
- [ ] **Step 2:** Run the app-level tests → FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm run test:local-db -- tests/http-browser/public-reading-ui.test.ts` → PASS.
- [ ] **Step 5: Commit** `Turn the reader's More sheet into Change reading: Find a reading first, then the portion, the verses and Go to verse, and nothing else`.

### Task B7: open the PR

- [ ] Merge `origin/main`, typecheck, the changed tests, never-in-repo; push; open PR "Area B: a public calendar, Find a reading on the home and in the reader, the Readings index"; stop. Area C continues on this branch after the merge.

---

## Area C: the reader's title block, the Add sheet, the foot row and the dock

### Task C1: `ReaderTitle`, the five groups, no arrows

**Files:**
- Create: `src/components/portal/public-reading/reader-title.tsx` (`ReaderTitle`)
- Modify: `src/components/portal/public-reading/read-header.tsx` (`ReadHeader` renders `ReaderTitle` and the sheet; `previous`/`next`/`eyebrow` props deleted), `view.tsx` (`WeekReading` and `ChosenReading` pass `name`, `line`, `pills`; the loading header), `public-reading.module.css`
- Modify: `src/components/portal/workspace/lens-switch.tsx` (the filled segmented switch with icons: a note for Lein, an open book for Study, drawn in the dock's stroke; `role="group"` and `aria-pressed` stay; class `reading-lens-switch`)
- Modify: `PassageReading`'s passage buttons (Torah | Haftarah) → `role="tablist"` underline tabs, the haftarah tab's label adding its reference in muted text; `SourcesButton` leaves the top row and joins the dock's Works sheet (if Sources and Works are two things the builder keeps both in the dock and says so)
- Modify: `src/components/portal/saved/saved-reading.tsx` (its own header replaced by `ReaderTitle` with pills "Change" and "Edit")
- Test: `tests/app/reader-title.test.ts` (new), `tests/app/saved-reading-ui.test.ts`, `e2e/read-header.spec.ts:12` (first Hebrew above y 320 stays), `e2e/public-reader-layout.spec.ts`, `e2e/study-lens.spec.ts`, `e2e/saved.spec.ts:179`

**Interfaces:**
- `ReaderTitle({ name, line, pills, loading }: { name: string; line: ReactNode; pills: readonly Pill[]; loading?: boolean })`; `Pill = { key: "change" | "save" | "edit" | "manage"; label: string; accessibleName?: string; icon: "chevron" | "bookmark" | "pencil" | "sliders"; onClick(): void; disabled?: boolean; haspopup?: "dialog" }`. The h1 keeps `id="public-reading-title"` and `tabIndex={-1}`.
- The muted line: a week's reading `"{long date} · Torah {ranges} · Haftarah {ranges}"`; a named reading its group word ("Parashah", "Festival", "Special Shabbat", "Fast day") and ranges; a custom ref "Any reading · {ranges}"; a saved reading `"{long date | "No date"} · {Torah|Haftarah} {ranges}"`.
- Phone order: site bar, title block, Torah | Haftarah tabs, Lein | Study switch, aliyah pills, text. Laptop: tabs and switch share one row (`@media (min-width: 1000px)`).

- [ ] **Step 1: Tests.** `reader-title.test.ts`: renders the h1, the line and the pills with their accessible names; no element named "Previous week" or "Next week" anywhere in a rendered `WeekReading` header; the switch has two `aria-pressed` buttons with an `svg` each; the passage tabs have `role="tab"`. `saved-reading-ui.test.ts`: the saved page's pills are "Change" and "Edit"; its eyebrow "MY READING" is gone.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. Update the e2e files; `e2e/read-header.spec.ts:83`'s budget becomes 12 (title, Change, Save, Torah, Haftarah, Lein, Study, first aliyah, … measure and pin the real number with the reason in a comment).
- [ ] **Step 5: Commit** `Give the reader one title block with Change and Save pills, underline passage tabs and a filled Lein | Study switch, and retire the eyebrow and the week arrows`.

### Task C2: Save is a sheet, "Add to My Readings"

**Files:**
- Modify: `src/components/portal/saved/save-reading.tsx` (`SaveReadingView` becomes a `Sheet` titled "Add to My Readings": Name (prefilled `suggestedName`), "Date you’re reading it (optional)" (prefilled with the Shabbat when the passage has one), "Verses" as three radio rows: the on-screen selection named with its range, "Whole portion", "Choose verses" (closes the sheet and starts the existing Choose verses flow with the Save offer kept); one button "Add"; the line "Marks, notes and your translation stay with this reading. Your tutor and the rabbi can see them."; signed out the pill reads "Sign in to save" and uses `ReturnSignInLink`; after a save the sheet closes and a `role="status"` line under the title reads "Saved to My Readings." with the link "Open" to the saved reading)
- Modify: `view.tsx` (the Save card below the reading retires; the pill's `onClick` opens the sheet; `saveReturn.offer` opens it on return)
- Test: `tests/app/saved-ui.test.ts`, `e2e/saved.spec.ts:29`, `:71`, `e2e/sign-in-return.spec.ts:97`, `:149`, `e2e/choose-verses.spec.ts`, `tests/http-browser/saved-ui.test.ts`

- [ ] **Step 1: Tests.** The sheet's title, three radios with the on-screen one checked, the Add button, the line; signed out the pill is a link to `/sign-in?return=…`; a save with "Whole portion" posts the whole range; one wording test for the sheet.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run test:local-db -- tests/http-browser/saved-ui.test.ts` → PASS.
- [ ] **Step 5: Commit** `Make Save a sheet, Add to My Readings, with the verses on screen, the whole portion or a chosen range`.

### Task C3: the foot row and the dock

**Files:**
- Create: `src/components/portal/public-reading/reading-foot.tsx` (`ReadingFoot({ print, tropeChart, blessings, more }: …)`: a quiet row after the last verse, `nav aria-label="After the reading"`, links "Print", "Trope chart", the siddur blessings links, and any `more` rows E2 adds)
- Modify: `view.tsx` (`PassageReading`'s `foot` renders `ReadingFoot`), `saved-reading.tsx` (the same foot), `src/components/portal/workspace/reading-toolbar.tsx` (the dock gains Sources inside Works when C1 moved it; otherwise unchanged)
- Test: `tests/app/reading-ui.test.ts` or `tests/app/public-pages.test.ts` (the foot's three links present after the text), `e2e/sheet-dock.spec.ts` (the dock is the only `position: fixed` element on `/read` at 390 px for a signed-in member), `tests/app/siddur-blessings.test.ts`

- [ ] **Step 1:** Tests. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Move Print, the trope chart and the blessings to a quiet row after the last verse, leaving the dock the only fixed element`.

### Task C4: the PR

- [ ] Merge `origin/main`, typecheck, changed tests, never-in-repo; `e2e/public-reader-layout.spec.ts` CLS and INP tests at 4x CPU on `/read` in Lein and Study stay at or under 0.07 and 80 ms (run locally once with `npx playwright test e2e/public-reader-layout.spec.ts` if the built server is available; else CI). Push; open PR "Area C: one reader title block, the Add to My Readings sheet, the foot row"; stop.

---

## Area E: the pinned reading, children's cards, Your students, the Manage sheet and the words

### Task E1: the pinned reading card on `/mine`

**Files:**
- Modify: `src/components/portal/workspace/today/today.tsx` (split: `useStudentToday(): TodaySlices` (the data loading) and `PinnedReadingCard({ slices })` (the view: a marigold `Chip` "Beit Mitzvah · {Sat, May 1, 2027}", the name, ranges and service, "Verses you’ve got" with the bar and "9 of 14", the tutor's name and the latest note (with Before next time), the seven day dots and the Practice calendar, buttons "Open" to `/mine/reading` and rows "Service parts" to `/mine/reading#service-parts` and "Lessons" to `/mine/reading#lessons`, "Honors form" where `HonorsEntry` shows today); `TodayView` retires with its route
- Modify: `src/components/portal/mine/shelf.tsx`, `model.ts` (`PinnedState` from `useStudentToday` for a session with the student role; the card is first)
- Modify: `src/components/portal/workspace/today/today.module.css`
- Test: `tests/app/student-today-model.test.ts` (keep the model tests), `tests/app/mine-ui.test.ts` (the pinned card renders first with the chip, the progress line and the Open link; a pinned reading without a note shows no note block; with no assigned verses yet the line "Your tutor or rabbi will add your verses here."), `e2e/student-today.spec.ts` (rewrite against `/mine`: keep the rehearsal, dots, note and calendar tests; drop the Today-route tests; the "Practice verses {range}" button is replaced by "Open" so F16's clipping cannot recur; add a 320 px test that no button text is clipped: `scrollWidth <= clientWidth` on every button)
- The tutor's name: `fetchLessons` entries carry the author; where the name is empty the card says "your tutor" (F24; `displayName` fallback in `src/server/data/student-work.ts:18` and `src/server/discussions/validation.ts:56` become "your tutor" for lesson notes; the accounts fallback "Portal member" in `src/server/accounts/validation.ts` is a staff-facing name and stays).

- [ ] **Step 1:** Tests. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Pin the Beit Mitzvah reading to the top of a student's shelf with the verses they have, the tutor's note and the practice days`.

### Task E2: `/mine/reading`, `/mine/child/<id>` and the workspace reading under `ReaderTitle`

**Files:**
- Create: `src/app/mine/reading/page.tsx` (title `signedInTitle("Your reading")`; renders `ReadingPanel mode="student"` for the session's own student id, resolved as `StudentWorkspace` does today), `src/app/mine/child/[studentId]/page.tsx` (title `signedInTitle("{child}’s reading")` set by `DocumentTitle`; `ReadingPanel mode="parent"` with the child's id; the Practice with {child} button stays; `/workspace/practice/<id>` unchanged)
- Modify: `src/components/portal/workspace/reading.tsx` (the `reading-hero` header becomes `ReaderTitle` with name `"{first} {last}"`, line `"Beit Mitzvah · {Sat, May 1, 2027} · Torah {ranges}"` (`AssignedReadingSummaries` stays for two readings), pills: a learner gets "Change" (Go to verse only), staff get "Change" and "Manage" (E3); the page tabs `Reading · Service parts · Lessons` retire: Service parts and Lessons render in sequence after the text with `id="service-parts"` and `id="lessons"` headings, and `ReadingFoot` carries "Service parts · Lessons · Trope chart · Print"; "Start reading" and "Refresh reading" leave the header (a quiet-refresh already exists; the explicit refresh moves into the Manage sheet for staff and goes for learners); the day circles and Practice calendar leave this page (E1 has them); the N3 sticky section chip row stays)
- Modify: `src/components/portal/workspace/students.tsx` (`StudentWorkspace mode="parent"` without a student id is no longer routed; a parent's card on `/mine` links to `/mine/child/<id>`; the tutor list page retires with A1's redirect; `StudentSelection` keeps the per-student routes only)
- Modify: `src/components/portal/shell/tabs.ts` (`parseReadingTab` and `readingTabs` retire with their uses)
- Test: `tests/app/reading-ui.test.ts`, `tests/app/parent-screens-n13.test.ts`, `tests/app/staff-screens-ui.test.ts`, `e2e/workspace-shell.spec.ts:38`, `tests/http-browser/reading-ui.test.ts`, `tests/http-browser/tutor-route-ui.test.ts`, `tests/http-browser/lessons-ui.test.ts`, `tests/http-browser/student-work-ui.test.ts`, `e2e/learn-own-reading.spec.ts` (its "Back to my reading" now `/mine`)

- [ ] **Step 1:** Tests: the student's reading page has the h1 with the student's name, the muted line with "Beit Mitzvah", one pill "Change", no `role="tablist"` named "Student page", the `#service-parts` and `#lessons` headings after the text, no button "Start reading" or "Refresh reading"; a parent's child page the same plus "Practice with {child}"; the tutor's page two pills "Change" and "Manage". One wording test for the line.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm run test:local-db -- tests/http-browser/reading-ui.test.ts tests/http-browser/tutor-route-ui.test.ts`.
- [ ] **Step 5: Commit** `Open a student's assigned reading at /mine/reading and a child's at /mine/child, under the same title block as every other reading, with Service parts and Lessons after the text`.

### Task E3: the staff Manage sheet, Your students' facts, the children's cards

**Files:**
- Create: `src/components/portal/workspace/staff/manage-sheet.tsx` (`ManageSheet({ mode, student, baseline, actions })`: a `Sheet` titled "Manage" with rows in order: "Confirm reading is still right" twice when two readings need review, each row labelled "Torah" or "Haftarah" (from `StaffStudentLines`), "Set divisions" (no full stop), "Change verses" (opens the existing editor), "Print practice sheet", "Print the whole reading", "Write a lesson note" (focuses the lesson log's composer after the text), "Refresh reading"; for an admin the links "People and access" to `/workspace/admin/students/<id>/access` and "All students" to `/workspace/admin/students`)
- Modify: `src/components/portal/workspace/reading.tsx` (the ten header buttons go: `practiceAction` ("Practice up close") stays as the one visible button under the title block for a learner and staff; everything else is in Manage), `src/components/portal/workspace/staff/student-lines.tsx:41` ("Set divisions." → "Set divisions")
- Modify: `src/components/portal/mine/shelf.tsx` and `your-students.tsx` (a parent's children's cards: "{first} {last} · Beit Mitzvah · {Sat, May 1, 2027} · {n} days", the reading's name and ranges, "Verses {first} has got" with the count (from the parent's progress read, `ParentStudySummary`'s store), the latest note's first line, buttons "Open" to `/mine/child/<id>` and "Practice with {first}" (the existing `selectChild`), links "Service parts" to `/mine/child/<id>#service-parts` and "Honors form" (`HonorsEntry`))
- Modify: `src/server/portal/service.ts` and `src/components/portal/api.ts` (`sessionSummary` gains `door: { pinned: { name, date, got, total } | null; child: { name, date } | null; nearest: { name, date } | null; count: number }` so A5's door can name the reading; computed from the student's confirmed reading and progress, the parent's first child by ceremony, the tutor's nearest student, and the saved count under the owner binding; `parseSession` accepts it)
- Modify: `src/components/portal/front-door/front-door.tsx` (`FrontDoorAccount` carries `door` from the summary into `signedInDoor`)
- Test: `tests/app/staff-screens-ui.test.ts` (the Manage sheet's rows by mode; the header has no `Set divisions.` and at most two pills and one button), `tests/app/parent-screens-n13.test.ts` (the children's cards), `tests/app/portal.test.ts` (`door` in the summary: a student with a pinned reading, a parent with two children, a member with three saved), `tests/app/front-door.test.ts` (the door names the pinned reading), `tests/http-browser/reading-assignment-review.test.ts`, `tests/http-browser/lessons-ui.test.ts`, `tests/http-browser/workspace-ui.test.ts`

- [ ] **Step 1:** Tests. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; local-db for the touched http-browser files.
- [ ] **Step 5: Commit** `Gather every staff action on a student's reading into one Manage sheet, give parents one card per child on their shelf, and let the home's door name the pinned reading`.

### Task E4: the admin's This week never shows three empty headings; the row hides on a reading

**Files:** `src/components/portal/workspace/staff/model.ts` (`NeedsYouCondition` gains `"link-request"`; `needsYouRows` takes the pending link-request count from `/api/accounts/summary`), `src/components/portal/workspace/staff/needs-you.tsx` (the empty line becomes "Nothing needs you this week: no readings to review, no link requests, no invitations waiting."; a `link-request` row reads "{n} link requests waiting" and opens `/workspace/accounts`), `src/components/portal/workspace/roster.tsx`. A1 already hides the admin row on `/workspace/admin/students/<id>/reading` and `/workspace/tutor/<id>`; `e2e/tab-bar.spec.ts` gains "an admin on a student's reading has the site bar, the breadcrumb and no tab bar". Tests: `tests/app/staff-screens.test.ts`, `tests/app/role-homes.test.ts`.

- [ ] **Step 1:** Tests. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Show link requests under Needs you and say what was checked when nothing needs the rabbi this week`.

### Task E5: the words table and the walk's small defects

**Files:** everywhere decision 24 names a retired word: `grep -rn` for each of `Open Today`, `Open This week`, `Your assigned reading`, `Your assigned students`, `Your children’s readings`, `Who are you teaching today?`, `Choose a child to see their reading.`, `Choose a child to practice`, `Back to my reading`, `Set divisions.`, `Portal member` (lesson-note and discussion fallbacks only), `Choose a reading` (the Learn link in `passage-preparation.tsx:44` becomes "Choose a reading" to `/readings`, kept), `Find a date`, `Ask for an account`, `Only you can see`; page titles: `/workspace/student` etc. are redirects; `/mine/reading` "Your reading"; `src/components/portal/workspace/provider.tsx:225`, `:242` ("Choose a child again" → "Open your child’s reading again" from `/mine`). Tests: the one wording test per screen touched; `tests/app/signed-in-shell.test.ts` title walk.

- [ ] **Step 1:** For each string, grep `src/`, `tests/`, `e2e/`; change the source and every test match in one commit.
- [ ] **Step 2:** Run the touched test files → PASS.
- [ ] **Step 3: Commit** `Use one name per place across the signed-in site and fix the clipped button, the full stop and the Portal member fallback the walk found`.

### Task E6: the performance and accessibility gate, then the PR

- [ ] **Step 1:** Add to `e2e/public-reader-layout.spec.ts` (or `e2e/mine.spec.ts`): CLS at most 0.07 and INP at most 80 ms at 4x CPU on `/mine` for the student fixture, and axe clean on `/`, `/read`, `/readings`, `/mine` (the repo's axe helper is the one `e2e/visual-system.spec.ts` uses).
- [ ] **Step 2:** Merge `origin/main`, typecheck, changed tests, never-in-repo, local-db for touched http-browser files; push; open PR "Area E: the pinned reading, children's cards, Your students, one Manage sheet, one name per place"; stop.
- [ ] **Step 3 (lead):** a scoped review by the strongest model of `/mine/learner`, `/mine/child` and the Manage sheet's access rows only (who can open which student's or learner's page), then merge-if-green.

---

## After the five PRs (lead)

- [ ] Update `docs/planning/2026-10-15-kickoff/STATE.md` with one GATE line per merged PR and the production migration ledger (54).
- [ ] Re-run the heuristic table in `FINDINGS.md` against the live site (navigation only) and record the score under the 22/40 line.
- [ ] Tag the release (lead's choice of number) and tell Daniel in under 15 lines: what shipped, what to try (sign in fresh, save a reading, find Toldot from the home, a tutor claims a learner), anything that needs him.

## Self-review (lead, 2026-10-27)

- **Spec coverage.** Decisions 1, 2, 6, 10, 11 → D1, D2, D7, E1; 3 → B1; 4, 13 → B5, A6, E5; 5 → C1; 6 (the sheet) → B6; 7 → C2; 8, 9 → A4, D8; 12, 22 → A5, E3; 14 → C1 (icons only); 15 → D5, D7; 16 → D8; 17 → A1, A4, D7, E3; 18 → A1, E4; 19 → C1, E2, E3 (one header now, one body later: recorded as plan decision 5); 20 → A1, C3, E4; 21 → A3; 23 → A1, A5; 24 → A6, E5; 25 → E1, E3, E4. Builder check answers 1 to 7 → plan decisions 1, 3, 4, 7 and B1, D4, D6, A4. "Done means" → B4 (one tap), C1 (five groups), D1 and A4 (a minute to a saved reading), E1 (pinned), D7 (claim and undo), A1 and A2 (one bar), E3 (Manage), D9 (adversarial), E6 (CLS, INP, axe).
- **Step scan.** Every task names its files, the signatures later tasks use and the tests that prove it; the bodies are left to the builder except the SQL of D3 and the search order of B2, which the tests do not determine.
- **Type consistency.** `SavedScope`/`SavedOwner` (D4) are what D5's routes and D7's fetchers use; `FindResult`/`addressOf` (B2) are what B3, B5 and B6 call; `ReaderTitle`'s `Pill` (C1) is what E2 and E3 pass; `tabsFor` (A1) is what E4's test pins; `door` (E3) is what A5's `signedInDoor` reads (A5 ships with `null` until E3).
- **Review focus.** Lines 1 to 5 are pinned in D4, D5, A4 and D1, B2 and D5.
- **Proportion.** The spec is 123 lines; this plan is longer because it carries five PRs and the tests for each, and holds no function bodies.
