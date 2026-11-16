# 03 — UI code review: redundancy and over-complication

Scope: `src/components` (314 files), `src/app` pages and layouts (not `src/app/api`), `src/lib` (122 files), `src/styles`, `src/app/globals.css`, plus `src/offline` and `src/proxy.ts` where they touch the UI. Read-only review at commit `582aa56`. Not a bug review.

How to read the sizes: this code is written in very long lines (commonly 130 to 400 characters, up to 1,160), so line counts understate it by a factor of three to five. I give sizes in KB. As a rule of thumb, 1 KB here is about 12 lines of conventionally formatted code.

## 1. Verdict

The UI does a small number of things (show a reading, play clips, mark verses, keep notes, run two courses, a handful of admin lists) with machinery sized for a bank. Four patterns account for most of the excess:

1. The browser treats its own server as hostile and its own tab as a security boundary. About 470 KB of client code (a fifth of all component code) is hand-written response validators, "owners", "bridges" and "coordinators", and the workspace provider re-checks the session before and after almost every read.
2. The same job is built several times: five local-to-account sync engines, three readers, three print outputs, two courses forked from each other, two styling systems, about a dozen dialog implementations.
3. Finished or parked designs are still in the tree and still tested: the whole-recording audio player, student recordings capture, role tabs for non-admins.
4. The service course (about 330 KB of UI and data) is live at `/learn/service` but no page links to it.

None of the four deliberate guards (auth, tenant and family isolation, never-in-repo, the chant gate) lives in this layer. They are enforced on the server. Everything below can be simplified without touching them, and I say so where a finding sits near one.

## 2. Size map

| Area | Files | Size | Note |
|---|---|---|---|
| `src/components` TS/TSX | 276 | 2,301 KB | of which `portal/workspace` 1,545 KB, `learn` 367 KB |
| `src/components` CSS modules | 38 | 190 KB | |
| `src/app/globals.css` | 1 | 123 KB | 1,053 rules, 434 global classes |
| `src/lib` TS | 119 | 641 KB | plus 227 KB of course JSON |
| `src/app` pages, layouts, landings | 76 | 60 KB | every page is a thin shell around one client component |

Largest directories:

| Size | Files | Directory |
|---|---|---|
| 589 KB | 77 | `components/portal/workspace/study` |
| 367 KB | 41 | `components/learn` (107 KB of it `learn/service`) |
| 237 KB | 20 | `lib/learn` (115 KB is `lessons.json`) |
| 223 KB | 12 | `lib/service-course` (117 KB is JSON) |
| 135 KB | 27 | `lib/readings` |
| 128 KB | 17 | `components/portal/public-reading` |
| 95 KB | 10 | `components/portal/workspace/honors` |
| 87 KB | 9 | `components/portal/workspace/study/sources` |
| 80 KB | 8 | `components/portal/print` |
| 75 KB | 7 | `components/portal/workspace/service-learning` |
| 74 KB | 6 | `components/portal/saved` |
| 68 KB | 10 | `lib/offline` |
| 62 KB | 5 | `components/portal/workspace/work` |

Largest source files (code only):

| Size | File | What it is |
|---|---|---|
| 123 KB | `app/globals.css` | global styles |
| 68 KB | `components/portal/public-reading/view.tsx` | public reader; 28 `useState`, 31 `useRef`, 28 effects |
| 58 KB | `components/portal/workspace/reading.tsx` | assigned-reading page; `ReadingPanel` is one 360-line function, lines up to 1,108 chars |
| 54 KB | `components/portal/workspace/provider.tsx` | the workspace provider; one 520-line function |
| 42 KB | `components/portal/workspace/study/view.tsx` | assigned reader; `AssignedStudyText` takes about 35 props |
| 36 KB | `lib/learn/course.ts` | Learn to lein course model |
| 35 KB | `lib/service-course/course.ts` | service course model |
| 34 KB | `components/portal/workspace/roster.tsx` | admin This week and Students |
| 33 KB | `components/portal/workspace/study/annotations.tsx` | Hebrew word renderer |
| 32 KB | `components/portal/workspace/work/coordinator.ts` | save engine for a student's verse translation and note |
| 31 KB | `components/portal/print/sheet.tsx` | `/print` |
| 29 KB | `lib/offline/packer.ts` | offline pack builder |
| 29 KB | `components/portal/workspace/lessons/panel.tsx` | lesson log |
| 29 KB | `components/learn/learn.module.css` | |
| 28 KB | `components/portal/saved/saved-reading.tsx` | saved reading page |
| 26 KB | `components/portal/workspace/reading-editor.tsx` | staff reading editor |
| 25 KB | `components/learn/drills.tsx` | |
| 25 KB | `components/portal/workspace/relationships/workspace.tsx` | Tutors and per-student access |
| 25 KB | `components/learn/service/progress-sync.ts` | fork of Learn's progress sync |
| 25 KB | `components/portal/workspace/honors/sheet.tsx` | honors form |
| 24 KB | `components/portal/entry.tsx` | sign-in and invitation entry |
| 23 KB | `components/portal/workspace/accounts/workspace.tsx` | People |
| 23 KB | `lib/reference-audio/playback.ts` | whole-recording player (dead at runtime, see F3) |
| 22 KB | `components/portal/workspace/study/sources/content-api.ts` | |
| 21 KB | `components/portal/workspace/service-learning/api.ts` | |
| 21 KB | `components/portal/workspace/api.ts` | |
| 20 KB | `components/portal/workspace/study/short-main-playback.ts` | clip player for the reader |

The complete 60-file list by bytes is reproducible with `find src/components src/app src/lib -type f -not -path 'src/app/api/*' | xargs wc -c | sort -rn | head -60`. There is no formatter or linter in `package.json`; the long lines are hand-kept.

## 3. Findings, ranked by payoff

### F1. The workspace provider re-proves the session around every read, in the browser

- Where: `src/components/portal/workspace/provider.tsx` (54 KB), with `practice.ts`, `quiet-refresh.ts`, `reload-barrier.ts`, `departure-guards.ts`, and the "owner" and "bridge" files it feeds: `study/short-reference-owner.ts`, `study/short-reference-bridge.ts`, `study/short-exploration-owner.ts`, `study/exploration-owner.ts`, `study/sources/content-owner.ts`, `study/sources/content-budget.ts`.
- What it does:
  - On every route change it hides the whole signed-in page ("Checking your access"), fetches `/api/session`, and re-runs every registered loader before showing anything (`provider.tsx:138-193`, `:220`).
  - `serviceRead` (`:415-430`) wraps most reads in session check, action, session check. `readVerified` (`:290-295`) does the same. So one piece of data costs three requests, and a student's reading page (reading, study text, marks, guide, service parts, lessons, practice calendar, word aids) makes roughly two extra `/api/session` calls per fetch.
  - The source clients (`:503-576`) add a "probe" before and after each call, with time budgets (12 s, 30 s, 12 s).
  - It tracks seven staleness counters for each request: `sequence`, `routeRevision`, `quietRevision`, `epoch`, `practice.generation`, `binding`, `checkingRef`. Liveness is decided by comparing `JSON.stringify` snapshots of them (`:298`, `:451-455`, `:474-478`).
  - A denial rate limiter (`DENIAL_REFRESH_LIMIT`, `:99`, `:196-204`), a "quiet refresh" on focus, pageshow and visibility (`:206-219`, `:297-330`), a reload barrier that loops up to eight passes, and departure guards.
  - The context value has 38 members (`:615`). Five read functions (`readStudy`, `readWork`, `readProgress`, `readGuide`, `read`) are the same 12 lines with one call changed (`:270-391`).
- Why it is over-built: the server already refuses anything the session may not see. The client checks add no protection (a browser cannot authorise itself); they exist to clear a stale view a few hundred milliseconds sooner when a role changes mid-session, which for a few dozen families is a once-a-year event. The cost is real: slower pages, a flash of "Checking your access" on every navigation, and a provider nobody can change safely. In the area: `generation` appears 345 times, `concealed` 119, `PortalRequestError(409)` 80, `child-practice` 95 times in 28 files.
- Instead: fetch the session once per page load; let any 401 or 403 from any call send the page to one "sign in again" or "access changed" state; delete the before-and-after probes, the counters, quiet refresh, the reload barrier and the denial limiter. Keep an `AbortController` per view and a single `key` on the subtree to reset it when the session or the selected child changes. Collapse the five copied read wrappers into one.
- Rough saving: 35 to 40 KB of the provider, 25 KB of owners and bridges, and a share of every `*-api.ts` that carries `selection` and context checks. Call it 90 to 120 KB (1,100 to 1,400 conventional lines) plus two thirds of the session requests.
- Risk: medium. Parent "practice with my child" mode (a timed server context with a handle) threads through all of it; simplify that path last, or ask whether a parent can simply open the child's reading as a parent (a product question for the gap analysis). Tests in `tests/app` and `tests/http-browser` pin much of this behaviour and would need pruning with it.
- Confidence: high on the redundancy; medium on the exact saving.

### F2. 470 KB of hand-written client validators for the site's own API

- Where: 53 files matching `*api*.ts`, `*owner.ts`, `*bridge*.ts`, `*coordinator*.ts` under `src/components` total 471 KB. Largest: `work/coordinator.ts` 32 KB, `study/sources/content-api.ts` 22 KB, `service-learning/api.ts` 21 KB, `workspace/api.ts` 20 KB, `study/sources/api.ts` 18 KB, `saved/api.ts` 17 KB, `relationships/api.ts` 15 KB, `work/api.ts` 14 KB, `public-reading/api.ts` 13 KB, `honors/api.ts` 13 KB.
- What it does: each file re-implements `fetch` with its own timeout, a streaming reader with a byte cap (22 files have their own `getReader()` loop), then validates the JSON by exact key set, prototype and property descriptors, and freezes it. Example: `study/short-reference-api.ts:27-39` checks `Object.getPrototypeOf(row.references) !== Array.prototype`, `Reflect.ownKeys`, `getOwnPropertyDescriptors` and a 1 MB re-serialised size on a list of clip references from its own server. There are 802 uses of `getOwnPropertyDescriptors`, `getPrototypeOf`, `Reflect.ownKeys`, `Object.freeze` or `structuredClone` in components and lib. Helper names are redefined per file: `bad` in 33 files, `object` in 21, `record` in 6, `integer` in 8, `count` in 8.
- Why it is over-built: JSON parsed from a same-origin response cannot have odd prototypes or accessors; the checks defend against nothing. Any exact-key validator also turns every additive server change into a client outage (the code answers "503 unavailable" on an unknown key).
- Instead: one `requestJson(path, init)` helper (timeout, `credentials`, status to error) and TypeScript types imported from the server with `import type`. The repo already does this in one place: `workspace/service-learning/ecosystem-api.ts:8` types the response as `Awaited<ReturnType<...["view"]>>` with a two-line shape check. Where a real invariant matters (for example "the verse refs returned match the refs asked for"), keep that one line.
- Rough saving: 250 to 300 KB (3,000 to 3,600 conventional lines) and the matching parser tests.
- Risk: low to medium; mechanical, file by file. No security effect: the server is the authority (the files' own comments say so: "No browser value is a server authorization proof").
- Confidence: high.

### F3. A superseded audio stack is still built and tested

- Where and evidence:
  - `src/lib/reference-audio/playback.ts` (23 KB): downloads a whole archive.org recording, SHA-256 verifies it, and seeks by timeline. Its only runtime callers are `study/main-playback.ts` (`createReadingPlayback`) and `study/reference-player.tsx`. Neither is mounted: the import graph shows `reference-player.tsx` imported by no source file (tests only), and every other import of `main-playback.ts` and `playback.ts` is `import type`. The reader uses `study/short-main-playback.ts` (PocketTorah clips) via `reading-player.tsx:7`.
  - `study/reference-api.ts` (7 KB) and `provider.tsx:440-445` `readReference`: no caller anywhere in `src` (grep for `readReference` finds only the provider).
  - `src/components/portal/workspace/recordings/capture.ts` (12 KB): student recording capture; imported by tests only. Recordings are parked (`src/server/runtime/config.ts:19`).
  - Tests kept alive by these: `tests/app/reference-playback.test.ts`, `tests/app/reference-api.test.ts` (30 KB together), and the capture tests.
- Instead: move the three shared types into `short-main-playback.ts` (or a small `types.ts`), delete `playback.ts`, the runtime half of `main-playback.ts`, `reference-player.tsx` and its CSS use, `reference-api.ts`, `readReference`, and `recordings/capture.ts` (it is in git history when recordings resume). The server routes behind them are for the server reviewer.
- Rough saving: about 55 KB of source and 30 KB or more of tests.
- Risk: low. Check `lib/reference-audio/timeline.ts` and `source.ts` afterwards; `referenceSeekSeconds` is already unused.
- Confidence: high (verified by import graph and grep).

### F4. Five separate browser-to-account sync engines

- Where:
  - `components/learn/progress-sync.ts` (16 KB): Learn to lein Leitner progress.
  - `components/learn/service/progress-sync.ts` (25 KB): its header says "forked from Learn to lein's progress-sync.ts ... What follows is Learn's rule set, unchanged". 653 of its 1,053 distinct tokens are shared with the original.
  - `components/learn/verse-review-sync.ts` (8 KB): a student's own verse cards.
  - `components/portal/workspace/account-preferences.ts` (17 KB) with `lib/account-preferences/document.ts` (6 KB): syncs text size, colours, translation on or off, tikkun view and chosen commentaries.
  - `components/portal/workspace/work/coordinator.ts` (32 KB) with `work/api.ts` (14 KB): a student's translation and note per verse, with mutation ids, receipts, "recovery", "revision recovery" and history.
  - Smaller relatives: `saved/api.ts` (17 KB; `saveSavedWork`, `conflictWork` and `savedText` are exported and unused outside tests), `honors/owner.ts` and `honors/honoree-owner.ts` (19 KB).
- What they share: optimistic version, merge on conflict, shared-device and account-switch handling, Web Locks, cross-tab markers, cleared-on-sign-out rules. Each has a 20 to 40 line comment restating the rules.
- Why it is over-built: the hard cases are "two tabs", "another child signs in on the same browser mid-write" and "the response was lost". For a preference like text size, last write wins is correct. For Leitner boxes, "take the higher box" on the server is the whole merge. For a 12-year-old's verse note, save on blur with a "Saved" or "Couldn't save, try again" line is enough.
- Instead: one small `syncedDocument({ key, load, save, merge })` used by both courses and verse review (they already share the document shape); preferences become a plain debounced PUT with no conflict handling; the work coordinator becomes save-on-blur with a version and one retry.
- Rough saving: 60 to 80 KB.
- Risk: medium for the work coordinator (it protects against losing a student's typing; keep the "unsaved changes" departure prompt). Low for the rest.
- Confidence: high that these are parallel implementations; medium on the saving.

### F5. Three readers that orchestrate the same parts

- Where:
  - Assigned reading: `workspace/reading.tsx` (58 KB) plus `workspace/study/view.tsx` (42 KB).
  - Public, named, by-reference and saved readings: `public-reading/view.tsx` (68 KB), wrapped by `saved/saved-reading.tsx` (28 KB).
  - A proposed (not yet confirmed) reading: `study/exploration-view.tsx` with `exploration-api.ts`, `exploration-owner.ts`, `short-exploration-api.ts`, `short-exploration-owner.ts` (43 KB), mounted at `reading.tsx:477` as `ProposedTorahText`.
- What overlaps: `view.tsx` (study) and `public-reading/view.tsx` import the same 20 or so pieces (`FlowingStudyText`, `ReadingPlayer`, `WordTools`, `LiftedLine`, `LensSwitch`, `StudyRows`, `VerseRashi`, `ReadingPlace`, `SectionTabs`, `NextSection`, reading prefs, study lens, verse panel) and each re-implements paging by aliyah, go-to-verse, the play dock, word-tap handling and focus moves. `displayRange` is defined in 9 files and `longDate` in 11.
- Why it matters: every reader change is made two or three times (STATE records this: "#161 Study v6 regression fix ... the reader's place reset to verse 1"). `AssignedStudyText` has about 35 props, 10 of them render callbacks or imperative handles (`liftHandle`, `practiceHandle`, `textStartHandle`, `verseLookupHandle`, `renderMark`, `renderWork`, `renderGuide`, `renderIntro`, `renderLiftControls`, `renderActiveWork`), because the page above it owns state the reader needs.
- Instead: one `Reader` component that takes a source ("these verses, from this fetcher") and optional slots (marks, notes, guide). The assigned, saved, public and proposed cases become four small data adapters. The proposed-reading case in particular should be "the public reader on that reference with a banner", not a third stack.
- Rough saving: 80 to 110 KB over time; the exploration stack (43 KB) can go first and alone.
- Risk: medium to high for the full merge (this is the product's main screen and it is covered by three device projects in CI). Low for retiring the exploration stack in favour of the public reader.
- Confidence: high on the duplication; the merge is a design job, not a mechanical one.

### F6. The service course ships but nothing links to it

- Where: routes `/learn/service`, `/learn/service/[lesson]`, `/learn/service/about`, `/learn/service/review`, `/learn/service/practice/quick-ten`; `components/learn/service/` (107 KB, 12 files); `lib/service-course/` (223 KB, 117 KB of it JSON).
- Evidence: the only inbound link from outside the course's own pages is `components/portal/offline/shelf.tsx:30`. `app/learn/service/page.tsx` says so itself: "Not in the site navigation or the front door yet (the release step links it once the prayer text lands)". The About page hides a paragraph that is known to be untrue for the evening lessons "until Daniel approves new wording" (`app/learn/service/about/page.tsx`).
- Why it matters: it is a second course forked from the first: `service/progress-sync.ts` (F4), `service/lesson.tsx` against `learn/lesson.tsx`, `service/practice.tsx` against `learn/quick-ten.tsx` and `learn/review.tsx`, `service/home.tsx` against `learn/home.tsx`, `lib/service-course/progress.ts` against `lib/learn/progress.ts`, `lib/service-course/course.ts` against `lib/learn/course.ts`. `LearnAppBar` and `ServiceAppBar` are both one-line wrappers of `SiteBar`.
- Instead: decide. Either link it (one line on `/learn` and the student's Service parts section) or take the routes out of the build until it is ready. If it stays, give the two courses one frame: one progress document shape, one sync, one lesson shell, one review screen, with the course passed in as data.
- Rough saving: 40 to 60 KB if unified; 330 KB out of the shipped app if parked.
- Risk: low to link; low to park (routes are static); medium to unify.
- Confidence: high (verified by grep for every form of the path).

### F7. Two styling systems and a half-adopted component kit

- Where: `app/globals.css` (123 KB; 1,053 rules; 434 global classes; 56 media queries; 39 `:has()` selectors; 15 KB of comments) alongside 38 CSS modules (190 KB) and `components/ui` (button, chip, sheet, list row, page header, segmented, section tabs).
- Evidence of half-adoption:
  - Global `button-primary`, `button-secondary`, `button-text` class strings appear 314 times; the `<Button>` component 20 times. `globals.css` has 83 rules that mention buttons; `ui.module.css` has its own.
  - `ui/sheet.tsx` calls itself "The one bottom sheet" and is used 10 times. There are 12 raw `<dialog>` elements and 16 files with their own `showModal`, portal or popover handling (`reading-toolbar.tsx` alone has six), plus `study/lift.tsx`, `honors/sheet.tsx`, `study/practice-sheet.tsx`, `staff/manage-sheet.tsx`, two `departure-review.tsx` files and `learn/word-card.tsx`.
  - The comment at the top of the token block says "src/components/ui adopts these, pages adopt them later".
  - 92 selectors are declared more than once in `globals.css` (`.portal-shell` and `.reading-toolbar` four times each; `.study-verses`, `.reading-hero`, `.site-bar-nav` three times), which is the "fighting itself" pattern: a later block patches an earlier one.
- Dead CSS is small: 34 of 434 global classes have no use in any source file (`roster-table`, `roster-scroll`, `access-section`, `access-assign`, `csv-check`, `hero-name`, `hero-days`, `practice-coach`, `reading-sources-dock`, `toolbar-soon`, `invitation-form-fields`, `study-verses-with-work` and others), and 16 of 950 module classes (9 in `learn.module.css`: `sheetStage`, `sheetLine`, `sheetRef`, `sheetActions`, `sheetStep`, `sheetPrimary`, `sheetHidden`, `stepItem`, `bars`). Checked by word-boundary search over all of `src`; classes built by string concatenation could be false positives.
- Instead: finish the move. Keep tokens, resets, fonts and the site bar in `globals.css` (about 15 KB) and move each feature's block (`reading-*` 180 selectors, `roster-*` 105, `study-*` 97, `lesson-*` 87, `practice-*` 78, `invitation-*` 68, `lift-*` 68) into the module beside its component. Make every modal a `Sheet` (or a second `Dialog` primitive for centred confirmations) and delete the per-file focus and Escape handling.
- Rough saving: the CSS mostly moves rather than shrinks (perhaps 15 to 20 KB removed with the duplicates and dead classes); the dialog consolidation removes 15 to 25 KB of TSX.
- Risk: low per feature, but CI's three device projects will catch visual shifts; do it one feature at a time.
- Confidence: high.

### F8. Role navigation left over from the tab-bar design

- Where: `components/portal/shell/tabs.ts`, `role-home.ts`, `role-memory.ts`, `tab-bar.tsx`, `more.tsx`; `provider.tsx:635` `RequireRole`; routes `/workspace`, `/workspace/student`, `/workspace/parent`, `/workspace/tutor`.
- Evidence:
  - `tabs.ts:15-27` still resolves a "shell role" for student, parent and tutor paths, although `tabsFor` returns tabs for the admin only (`:55`), and `/workspace/student` and `/workspace/parent` are redirects.
  - `role-home.ts:21`: `workspaceDestination(roles, _remembered)` ignores its second argument.
  - `rolePaths` maps three of four roles to `/mine`, so `homeRole` and `rememberedRole` now only choose a door title on `/` and `/account`.
  - `RequireRole` tells a person "Choose one of your available roles" with a link to `/workspace`, which only redirects.
  - `more.tsx:22` computes a shell role to decide what `summary.roles.includes("admin")` already says.
  - `tab-bar.tsx:23-36` has an on-screen-keyboard detector (visual viewport and focus events) to hide a bar that only the admin sees.
- Instead: `isAdmin = roles.includes("admin")`; tabs shown when admin and on an admin path; delete `shellRole`, `roleOfPath`, `role-memory.ts`, `homeRole`; turn the four redirect pages into `redirects()` entries in `next.config.ts`; reword `RequireRole`.
- Rough saving: 8 to 10 KB and four route files. Small, but it removes a concept ("which role am I in") that no longer exists in the product.
- Risk: low. Confidence: high.

### F9. Overlapping admin and account pages

- "Remove as a tutor" on Tutors (`relationships/workspace.tsx`) and "Remove tutor" on People (`accounts/workspace.tsx`, added in #167) do the same thing in two places; "Make tutor" is on People while assigning a tutor to a student is on the per-student access page.
- People is split over three pages with a sub-nav (`shell/people-nav.tsx`: Invitations, Tutors, People), plus a per-student "People and access" page (`/workspace/admin/students/[id]/access`) that mounts the same `AdminAccessWorkspace` as Tutors.
- More (`/workspace/more`) and Account (`/account`) both list Email settings, Claude connections and Congregation settings (`shell/more.tsx:15-17`, `account-page.tsx:37-39`).
- Instead: one People page (people with access, with tutor and approver as properties of a row, invitations as a filter of the same list); settings links in one place.
- Saving: 20 to 30 KB and two routes. Risk: low to medium (admin-only). Confidence: medium; this is as much a UX call as a code one, so it belongs with the gap analysis.

### F10. Three print outputs for one reading

- `study/practice-sheet.tsx` (11 KB plus 6 KB CSS): an in-page print dialog, Hebrew only, with optional tikkun column.
- `/print` (`print/sheet.tsx` 31 KB, `print/document.tsx` 12 KB, `lib/print/*` 39 KB): the reader's print sheet with English and commentary.
- `/print/booklet/[studentId]` (`print/booklet.tsx` 20 KB): the per-student study booklet.
- A student's reading page offers the first two side by side (`reading.tsx:376-380`, `:483`), and the booklet from the shelf.
- Instead: make "Hebrew only, with tikkun column" a format option of `/print` (`lib/print/sheet-format.ts` already models formats) and delete `practice-sheet.tsx`.
- Saving: about 17 KB. Risk: low. Confidence: medium (I did not compare the printed output).

### F11. Offline and install machinery

- Where: `lib/offline/` (68 KB: `packer.ts` 29 KB, `policy.ts` 16 KB, `pack-index.ts` 9 KB), `components/portal/offline/` (20 KB), `src/offline/service-worker.js` (11 KB), `/sw.js`, `/offline`, a tombstone worker, a build-time policy injected into the worker, two hard-coded origins.
- Why it is heavy: it is a custom pack format with an index, purge rules for sign-out and account switch, origin allow-lists and a rollback flag (`PORTAL_OFFLINE_ENABLED`). A fork has no offline mode at all (STATE: "offline origins stay CRC-only").
- I did not find it dead: it is mounted in the root layout (`app/layout.tsx`) and linked from About. Whether anyone uses it is a product question; page-view data (the MCP `get_page_views` tool) for `/offline` would answer it.
- Instead, if kept: cache the app shell and the public reading routes with a plain cache-first worker (about 60 lines) and drop the pack index and packer. If not kept: serve the tombstone for a release, then delete all of it.
- Saving: 60 to 100 KB. Risk: medium (installed phones). Confidence: medium.

### F12. Smaller items

- Unused exports (no reference outside their own file; "tests" means tests still import them): `learn/course-data.ts findVerse`; `invitations/api.ts invitationFingerprint`; `settings/links.ts useCongregationLinks`; `staff/practice.tsx ParentCountLine`; `study/commentary-view.tsx VerseCommentary`; `today/model.ts stateWord`, `readingRows`, `rowState` (tests); `study/verse-panel.tsx DiscussionList`, `VerseActions` (tests); `study/discussions.tsx DiscussionsProvider` (tests); `study/portion-summary.tsx StudySummary` (tests); `study/reading-place-model.ts pageOffsetFor`, `topVisible` (tests); `lib/learn/verse-review.ts JOIN_OFFER_ENABLED = false` and `joinWith` (a switched-off feature); `lib/print/portions.ts portionAvailable`; `lib/reference-audio/timeline.ts referenceSeekSeconds`; `lib/reference-audio/short-source-tags.ts shortSourceFFmpegMetadataArgs`. Found by a script; each should be re-checked before deletion. A further 574 exports are used only inside their own file and need no `export`.
- Share-card files: `opengraph-image.tsx` and `twitter-image.tsx` are byte-identical pairs in `app/read`, `app/learn`, `app/learn/[lesson]`, `app/trope-chart` (8 files). Next accepts `export { default, alt, size, contentType } from "./opengraph-image"` for the twitter one.
- Three identical `PublicLayout` files (`app/read/layout.tsx`, `app/learn/layout.tsx`, `app/trope-chart/layout.tsx`) exist only to mount `PageViewBeacon`; a `(public)` route group would hold one.
- Every page repeats a five-line metadata block (`pageTitle`, `readPublicProductName`, `publicMetadataBase`, `NOINDEX_META`); one `publicMetadata(title, { index })` helper would replace about 20 copies.
- `lib/siddur/link.ts` imports a constant from `src/server/settings/validation` (lib depending on server); `lib/service-learning/types.ts` imports server types. Harmless, but the "lib is client-safe" boundary is not real.
- Internal links: 187 plain `<a href>` against 43 `<Link>` or `WorkspaceLink`. Plain anchors cause full page loads, and each full load of a signed-in page re-runs the access check in F1. Using `Link` for in-app navigation would make the site feel faster at no cost.
- Low-level browser handling in components: 161 `new AbortController`, 63 `setTimeout`, 75 `.focus()` calls, 53 `tabIndex`, 88 pageshow, pagehide or visibility handlers. Most of it falls away with F1, F2 and F7.
- `practice-visibility/release.ts`: a dated gate (`PRACTICE_VISIBILITY_FROM = "2026-10-27"`) that has been open for three weeks; the gate, its date parser and `tests/app/practice-visibility-gate.test.ts` can be removed.
- `app/design-system` (a test-only gallery behind `CRC_COMPONENT_PAGE=1`) is fine to keep; it is the one place the `ui` kit is exercised.

## 4. Route inventory

Every user-reachable route under `src/app` except `/api`. "Linked from" was checked by searching all of `src` for each path in quoted, template and built forms.

Roles: SO = signed out, St = student, Pa = parent, Tu = tutor, Ad = admin. "Any" = all five. "Signed in" = any account.

### Public and entry

| Route | Who | Purpose | Linked from | Notes |
|---|---|---|---|---|
| `/` | Any | Front door: this week, find a reading, Your readings door, Learn door | Brand link in the site bar | Mounts `PortalEntry` with `frontDoor` |
| `/sign-in` | SO | Sign-in form (email code, Google) | Site bar, front door, workspace "Sign in to continue" | Same `PortalEntry` as `/` and `/invitations/accept` |
| `/account` | Any | Signed in: roles, email, Claude, settings links, install. Signed out: the sign-in form | Site bar person button, shelf | Overlaps `/sign-in` when signed out and `/workspace/more` for admins (F9) |
| `/invitations/open` | SO (email link) | Landing that moves the token into the fragment | Invitation emails | Route handler, server-rendered |
| `/invitations/accept` | SO or signed in | Review and accept an invitation | `/invitations/open`, server redirects | |
| `/auth/email` | SO (email link) | Email sign-in link landing | Sign-in emails | Route handler |
| `/unsubscribe` | Any (email link) | Turn off portal emails by token in the fragment | Notification emails | |
| `/connect` | Signed in staff | OAuth consent page for connecting Claude | Server redirects only | Reached from Claude, not from a page |
| `/honoree` | Anyone with the link | An honoree's own view of their honor and blessing | Link copied from the honors sheet | Route handler |
| `/about` | Any | What the site is, sources, what it records | Footer, front door, shelf | |
| `/offline` | Any | "Saved on this device" shelf | Service worker only | No page links to it; by design |
| `/sw.js` | Browser | Service worker or tombstone | Offline runtime | |
| `/reference-audio/short-v1/[file]` | Any | Serves PocketTorah clip files | Players | Route handler |
| `/design-system` | Nobody in production | Component gallery for browser tests | Nothing | 404 unless `CRC_COMPONENT_PAGE=1` |
| `/robots.txt`, `/sitemap.xml`, `/.well-known/oauth-*` | Crawlers, Claude | Discovery | n/a | |

### Reading

| Route | Who | Purpose | Linked from | Notes |
|---|---|---|---|---|
| `/read` | Any | This week's reading; also `?reading=<slug>`, `?ref=`, `?date=`, `?lens=study`, `?saved=<id>` (owner), `?saved=<id>&learner=<membershipId>` (tutor or admin) | Site bar "Read", front door, shelf, find-a-reading | One route, five modes. The saved modes are a signed-in page living on a public route |
| `/readings` | Any | Index of every parashah, holiday and passage; `?add=1`, `?for=prepare` | Reader, shelf, find-a-reading, Learn prepare | Overlaps the "Find a reading" sheet inside `/read` and on `/` |
| `/print` | Any | Reader's print sheet for a passage | Reader foot, assigned reading (built by `lib/print/print-address.ts`) | Overlaps the in-page practice sheet and the booklet (F10) |
| `/print/booklet/[studentId]` | St, Pa, Tu, Ad for that student | Per-student study booklet | Shelf, child card, Manage sheet, roster | |
| `/trope-chart` | Any | Chart of trope families with clips | Learn home, reader foot, front door | Counted under "Learn" in the site bar |

### Learn

| Route | Who | Purpose | Linked from | Notes |
|---|---|---|---|---|
| `/learn` | Any | Learn to lein course home | Site bar "Learn", front door | |
| `/learn/[lesson]` | Any | One lesson | Course home, drills, lesson end | Static per lesson |
| `/learn/practice/[id]` | Any | Quick-ten practice run | Course home | |
| `/learn/review` | Any | Review due cards | Course home, student reading page | |
| `/learn/prepare` | Any | Prepare a passage step by step (`?ref=&kind=`) | Course home, learning start, readings index | |
| `/learn/run-through` | St (page is public; content is the student's own) | Chant own reading with no audio, mark Clean or Stumbled | Course home, only when the viewer is a student | |
| `/learn/about` | Any | Sources and credits for the course | Course home | One of three About pages (`/about`, `/learn/about`, `/learn/service/about`) |
| `/learn/service` | Any | Service course home | Offline shelf only | Unlinked (F6) |
| `/learn/service/[lesson]` | Any | Service course lesson | Service course pages only | Unlinked from outside |
| `/learn/service/review` | Any | Service course review | Service home only | Unlinked from outside |
| `/learn/service/practice/quick-ten` | Any | Service course quick ten | Service home only | Unlinked from outside |
| `/learn/service/about` | Any | Service course About | Service home only | Hides one paragraph pending wording |

### Signed-in: My Readings

| Route | Who | Purpose | Linked from | Notes |
|---|---|---|---|---|
| `/mine` | Signed in | The shelf: pinned reading, saved readings, children's cards, Your students, find a learner | Site bar "My Readings", sign-in landing | An admin arriving from outside is sent on to This week (`provider.tsx:597-602`) |
| `/mine/reading` | St | The student's assigned reading (Lein and Study lenses, marks, service parts, lessons) | Shelf pinned card | |
| `/mine/child/[studentId]` | Pa | A parent's view of one child's week and reading | Shelf child card | |
| `/mine/learner/[membershipId]` | Tu, Ad | A learner's shelf as their tutor or the rabbi sees it | Find a learner | |
| `/workspace/practice/[studentId]` | Pa | "Practice with your child" sitting (timed context) | Child card and child page (via `selectChild`) | The reason for the fifth `child-practice` mode |
| `/workspace/tutor/[studentId]` | Tu | A tutor's view of one student | Your students | |

### Signed-in: admin

| Route | Who | Purpose | Linked from | Notes |
|---|---|---|---|---|
| `/workspace/admin/students` | Ad | This week; `?tab=students` is the roster | Tab bar | Two pages on one route |
| `/workspace/admin/students/[id]/reading` | Ad | The admin's view of one student's reading, with Manage | Roster, This week | |
| `/workspace/admin/students/[id]/access` | Ad | Tutors, parents and sign-in for one student | Roster, Manage sheet, CSV import | Same component as Tutors |
| `/workspace/admin/students/import` | Ad | CSV import | Roster | |
| `/workspace/admin/invitations` | Ad | Sent invitations; the People tab's landing | Tab bar "People", roster | |
| `/workspace/admin/tutors` | Ad | Tutors list, mark cantor, remove, hand over | People sub-nav only | Overlaps People (F9) |
| `/workspace/accounts` | Ad, and tutors who are approvers | People with access, link requests, approvers, Make and Remove tutor | People sub-nav, Account, shelf line, This week | |
| `/workspace/more` | Ad (others redirected to `/mine`) | List of links: Settings, Email, Claude, Share guides, Recording review | Tab bar "More" | A page that is only a menu |
| `/workspace/admin/settings` | Ad | Congregation settings | More, Account | |
| `/workspace/admin/guide-sharing` | Ad | Export and import study guides | More | |
| `/workspace/admin/reference-review` | Ad | Recording review | More | |
| `/workspace/email` | Signed in | Which portal emails the person gets | More, Account, unsubscribe page | |
| `/workspace/claude` | Ad, Tu | Claude connections | More, Account | |

### Redirect-only routes

| Route | Goes to | Linked from |
|---|---|---|
| `/workspace` | Admin: `/workspace/admin/students`; everyone else: `/mine` (client-side) | `RequireRole` "Choose a role" link and two "Role unavailable" states |
| `/workspace/student` | `/mine`, or `/mine/reading` with `?tab=` | Nothing in the app (old saved links) |
| `/workspace/parent` | `/mine` | Nothing in the app |
| `/workspace/tutor` | `/mine` | Nothing in the app |

### Flags for other reviewers

- Unlinked: the five `/learn/service*` routes; `/offline` (by design); `/connect` (by design); `/design-system` (test only); the three `/workspace/{student,parent,tutor}` redirects.
- Overlapping: `/sign-in`, `/` and `/account` all render the sign-in entry; `/workspace/more` and `/account`; Tutors, People and per-student access; `/readings` and the Find a reading sheet; `/print`, the in-page practice sheet and `/print/booklet`; `/about`, `/learn/about`, `/learn/service/about`.
- Odd placement: a member's saved reading and a tutor's view of a learner's saved reading live on the public `/read` route by query string, while the assigned reading lives at `/mine/reading`. Three signed-in "one student" pages exist per role (`/mine/child/x`, `/workspace/tutor/x`, `/workspace/admin/students/x/reading`), all mounting `ReadingPanel` with a different `mode`.
- The signed-in area is split between `/mine/*` and `/workspace/*` for historical reasons (one provider wraps both).

## 5. If only five things were done

1. Remove the client-side session re-proving (F1). Fetch the session once per page, treat any 401 or 403 as "sign in again", and delete the probes, counters, quiet refresh and reload barrier. Biggest gain in speed and in how safely the main screens can be changed.
2. Replace the 53 hand-written API validators with one fetch helper and server-derived types (F2), following `ecosystem-api.ts`. About 250 to 300 KB gone with no behaviour change a user could see.
3. Delete the dead audio and recording code and its tests (F3), and decide the service course's fate: link it or park it (F6). Both are quick and low risk.
4. One sync helper for both courses, verse cards and preferences; simplify the verse-note save (F4).
5. Finish the component kit: every dialog a `Sheet`, every button a `Button`, feature CSS out of `globals.css` (F7); and retire the role-tab leftovers and redirect pages while there (F8).

The reader merge (F5) is the largest structural win after these, but it is a design project and should follow them, starting with replacing the proposed-reading stack by the public reader.

## 6. What I did not verify

- I did not build the app or measure bundle sizes or request counts in a browser; the request multiplication in F1 is read from the code.
- F9, F10 and F11 rest on reading labels and imports, not on using the pages.
- The unused-export and unused-CSS lists come from scripts with word-boundary matching; names built at run time would be missed. Spot checks on the items named in F3 were done by grep.
- I read `provider.tsx` in full and the heads and outlines of the other large files; I did not read every file in `study/`, `honors/` or `sources/`.
- Server routes behind the dead client code (F3) and the server half of the child-practice context (F1) are outside this area.
- Many tests assert on source text or on the exact behaviours listed above (for example `tests/saved-structure.test.mjs`, `tests/app/reference-playback.test.ts`); simplifying the code means deleting tests with it, which the tests reviewer should size.

Working files (import graph, export and CSS scans): `(session scratchpad)/ui-work/`.
