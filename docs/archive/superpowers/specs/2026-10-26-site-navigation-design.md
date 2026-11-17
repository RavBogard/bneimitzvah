# Site navigation: one site bar, the landing page, Account and the role homes

Analysis and mockups: the "CRC Torah Navigation" artifact of 2026-10-26 (45 screenshots at 390 and 1280 px, findings F1–F14). Daniel approved the plan on 2026-10-26 ("Implement the plan").

## Settled decisions (Daniel, binding, 2026-10-26)

1. This week's reading and the Beit Mitzvah door carry equal weight.
2. A first-time visitor's one action is "Open this week's reading".
3. The landing page stays a doorway; what the site is goes on a separate About page.
4. Phone and laptop are designed together; every screen is checked at both widths.
5. One site menu everywhere: Read, Learn and Sign in in the header on every public page.
6. Signed-in people reach the public side from the header.
7. Switching roles happens on the Account page.
8. One sign-in page: the landing page has a Sign in button and /sign-in is the only form.
9. The name is CRC Torah everywhere.
10. No door for guests or honorees.
11. Avoid: looking like a synagogue website, looking like a kids' app, too many choices at once, hiding the reading. "I want people to immediately be able to jump in ... It should be a repo home for anyone wanting to lein or learn."
12. Scope: the landing page, the shell and the role homes, content included.
13. A signed-in student opening the site root sees the front door.
14. Beta stays in the header until the domain switch week ends (2026-10-26 ruling).

## The model

- **The site row** is the header, the same on every page signed in or out: CRC Torah and Beta on the left; Read, Learn, then Sign in or the account control on the right. The current link carries `aria-current="page"` and an underline.
- **The role row** is the tab bar (the left rail at 1000 px and wider). It exists only for a signed-in role and holds decision 1's four tabs, unchanged.
- A link may appear in both rows. The student's Learn tab stays.

## Decided here (lead, 2026-10-26, under Daniel's rulings)

1. Phone menu inline: no Menu button and no public tab bar. Three words fit; a public bar would overturn decision 1 and share the bottom edge with the reader's tool dock.
2. Students keep the Learn tab; the bar carries Learn for everyone.
3. Width rule: the account control is the icon alone under 480 px (accessible name "Account"); the Beta chip hides under 360 px.
4. Trope chart and About are not in the bar. The chart stays on Learn and in the reader's More sheet; About is in the footer.
5. `/workspace` sends a multi-role person to the role they last used, else the highest (admin, tutor, parent, student). Role memory stays in page memory only (`shell/role-memory.ts`: a signed-in screen writes nothing to the device), so after a reload it is the highest role. The chooser and the role pills retire.
6. /sign-in keeps "Open your reading" and loses its "Read this week's Torah and haftarah" button.
7. Minimal bar (brand and Beta only, no links) on print, the honoree's blessing link, connect, unsubscribe, invitation pages and the offline shelf.
8. The admin's first screen is titled "This week": Needs you, Ceremonies this week, Rehearsals this week. The roster alone is under Students.
9. Signed-in landing door: one heading, one line, one button per role.
10. No adversarial pass: nothing changes who can see what.
11. Milestones B (landing, sign-in, About) and C (Account and roles) are one PR, because both rewrite `entry.tsx` (the SOP's rule on milestones that share files).
12. The role-home wording is the lead's, logged below, under Daniel's ruling that wording following from his decisions is the lead's to make. It is not a popup round.
13. PR D runs beside PR A (no shared files); the B+C PR follows both.
14. /about ships linked from the footer, indexed and in the sitemap (Daniel, 2026-10-26: "You may deploy to main when finished"). Daniel reads it on the live site; any change is one edit.

## PR A: site bar and footer

- New `src/components/site/site-bar.tsx` with two modes. **site:** brand link to `/` ("CRC Torah"), `BetaMark`, then Read (`/read`), Learn (`/learn`) and either Sign in (`/sign-in` with the existing return-address convention the reader uses) or the account control (person icon plus "Account", linking `/account`). **minimal:** brand and Beta only.
- Current link: Read on `/read*`; Learn on `/learn*` and `/trope-chart`; Account on `/account`. Nothing is current elsewhere.
- Signed-in state on public pages comes from the mechanism the front door and reader use today (the signed-in hint and session check). The right side reserves its width so the swap from Sign in to the account control causes no layout shift.
- Width rule as in Decided 3. No wrapping at 320 px.
- Replace the eleven header variants: `front-door.tsx` (its Sign in now links to `/sign-in`), `entry.tsx`, `connect.tsx` (minimal), `unsubscribe.tsx` (minimal), `workspace/provider.tsx`, `public-reading/view.tsx` (the bar replaces only the brand row; the reader's own reading row and More sheet stay beneath it), `trope-chart/page.tsx`, `learn/home.tsx`, `learn/service/bits.tsx`, `print/sheet.tsx` (minimal, screen only), `offline/shelf.tsx` (minimal). Invitation pages use minimal. Remove the "Central Reform Congregation" second line on /sign-in and /account.
- Delete the student-only `.app-bar-learn` link in `provider.tsx` and its CSS. Do not remove the `workspace-role-nav` pills yet (PR B+C does).
- New `src/components/site/site-footer.tsx`, one `<footer>` landmark: line 1 "Central Reform Congregation · Your account and reading stay private."; line 2 "A project of Rabbi Daniel Bogard". Remove the second footer in `src/app/layout.tsx` and the per-page footers. Print and the honoree link keep their existing minimal footers.
- Laptop shell: the bar spans the full width and the left rail starts beneath it.
- Tests: unit tests for the modes, current link and the signed-in/out right side; extend `tests/app/beta-mark.test.ts`; update e2e header assertions that named the old variants. One wording test for the bar.

## PR D: role homes (beside A)

- **Admin** (`/workspace/admin/students`, `roster.tsx`): without `?tab=students` the screen is "This week": Needs you (as built in N14), then "Ceremonies this week" and "Rehearsals this week", each a short list of student name, date and service slot linking to the student's admin page; empty list reads "None this week." "This week" is the seven days from today in the congregation's time zone. With `?tab=students` the screen is "Students": Find a student, the count, Import and Add student, and the roster.
- **Parent** (`/workspace/parent`): with one child, the page is that child's summary directly, headed with the child's name (no pronouns). Check first whether this already happens. With several children, each card gains one status line under the date, reusing the honors status label the parent already sees.
- **Tutor** (`/workspace/tutor`, "Who are you teaching today?" stays the lead): each student card gains "Last lesson {Mon D}" when there is one, and the Needs work line in the exact words N15 already uses elsewhere, when there is one. If neither the data nor a precedent string is already on the client, add the field to the existing tutor-scoped response only (no new authority) and say so in the report.
- **Student Today** (`today/today.tsx`): the tutor's latest note moves above the sections list. Everything else keeps its order.
- Each first screen's `PageHeader` title matches its tab. Each screen keeps its tests and gains one wording test.

## PR B+C: landing, sign-in, About, Account and roles (after A and D)

- **Landing** (`front-door.tsx`): Lein is the only lake pill on the page; the Learn door's Start becomes a white pill. The Beit Mitzvah door signed out: heading, line, a white "Sign in" pill to `/sign-in`, and an "Ask for an account" link to the existing request flow. The form leaves the landing page. Header Sign in no longer scrolls.
- **Signed-in door** (replaces the Beit Mitzvah door), for the remembered role else the highest:
  - student: "Your reading"; the line is the parashah and date when the session already has them, else "Your parts and what's next."; button "Open Today".
  - parent: "Your family"; the children's first names; button "Open Today".
  - tutor: "Your students"; "Who are you teaching today?"; button "Open This week".
  - admin: "This week"; "Needs you, ceremonies and rehearsals."; button "Open This week".
- **Root:** `/` shows the front door to everyone. `entry.tsx` auto-enters only from an accepted invitation (X8) or a return address (G16).
- **/sign-in** is the only form: "Open your reading", its line, Continue with Google, the email link, Ask for an account. The reader button goes.
- **/about**: a reading page in site mode. Sections: what CRC Torah is (three sentences); who it is for, with the three doors as links; where the texts, translation note, reference recordings and fonts come from, each credited as the PROVENANCE files and existing credit lines record them; what the site records about you, in the N23 disclosure's words; installing it on a phone; the congregation's own site. Linked from the footer ("About" after "Central Reform Congregation" on line 1), indexed, and added to robots and the sitemap.
- **Account** (`/account`): a list page on `List`/`ListRow`, no longer the entry component. Order: "Signed in as {name}"; Roles (each role, the current one marked, tapping one remembers it and opens its home); then the rows that exist today (Email settings, Claude connections for staff, Account requests for approvers, install, the practice-visibility disclosure for students, Need help); Sign out. Existing strings word for word.
- **Roles:** `/workspace` redirects per Decided 5. Delete `RoleChoice` and the `workspace-role-nav` pills.
- Tests: unit test for the landing role rule and the root no longer redirecting; e2e for switching roles on Account, sign-in return and invitation Continue. One wording test for the landing doors. CLS and INP re-measured on `/`.

## Done means

- Every route renders one header and one footer landmark; axe clean on the swept routes.
- CLS at most 0.07 and INP at most 80 ms on `/` and `/read`.
- The bar at 320, 360, 390, 480, 1000 and 1280 px, signed in and out, light and dark.
- Sign-in returns to the page it left; an invitation's Continue lands on work; a student at `/` sees the front door and reaches Today in one tap.

## Open items that wait on Daniel

- Read /about on the live site and say what to change.
- Any "Decided here" line can be overturned in a sentence.
