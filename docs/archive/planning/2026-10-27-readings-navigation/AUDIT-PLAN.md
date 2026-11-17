# Full UI/UX walk of CRC Torah: plan

Daniel, 2026-10-27: "the whole UI/UX is super confusing"; asked whether the whole menu structure had been reviewed (it had not: three public routes were walked); chose the sandbox over live tester accounts. This is the plan for the full walk. The sandbox recipe and accounts are in `C:\Users\dsbog\bneimitzvah-review-output\2026-10-27-readings-navigation\SANDBOX.md` (outside the repo).

## Method

- Every route below, at 390 and 1280 px, light mode, plus one dark-mode pass of the home, the reader and each role home, and one 320 px pass of every bar and tab bar.
- Signed out first, then signed in as student, parent, tutor and admin from the sandbox's seeded accounts. Each role starts at `/`, follows the door, and then opens every tab, sheet and More item it can reach.
- For every screen record: the route, the role, the width, the control groups in reading order (bars, tabs, pills, sheets, docks, buttons), the one thing a first-time visitor is meant to do, how many taps it takes to find a future parashah and to get back to the thing they came for, and the words used for each action.
- Score with the 2026-10-16 critique's heuristics (`docs/planning/2026-10-16-ux-analysis/UX-ANALYSIS.md`) so the numbers compare. Findings are numbered F10 onward (F1 to F9 are in `FINDINGS.md` here), each with the screen, the width, what a person sees, why it is confusing, and the proposed fix. Screenshots go outside the repo in `bneimitzvah-review-output/2026-10-27-readings-navigation/walk/` named `<role>-<route>-<width>.png`.
- The deliverable is two documents: `MENU-MAP.md` (every bar, tab bar, sheet and menu on the site, as a tree, with the words on each item and which roles see it) and `FINDINGS.md` extended, then a second section in the design spec covering the role homes and the tab bar so the whole site shares one menu grammar.

## Routes

Public: `/`, `/read` (week, a named reading, a custom ref, a saved reading, the More sheet, Choose verses, Lein and Study, Torah and haftarah, the dock's five sheets), `/readings` does not exist yet, `/learn`, `/learn/about`, `/learn/[lesson]` (two lessons), `/learn/practice/[id]`, `/learn/prepare`, `/learn/review`, `/learn/run-through`, `/learn/service`, `/learn/service/about`, `/learn/service/[lesson]`, `/learn/service/review`, `/learn/service/practice/quick-ten`, `/trope-chart`, `/print`, `/about`, `/sign-in`, `/offline`, `/connect`, `/unsubscribe`, `/invitations/accept`, `/design-system`.

Signed in: `/account`, `/workspace` (the redirect), `/workspace/student` (every tab), `/workspace/practice/[studentId]`, `/workspace/parent`, `/workspace/tutor`, `/workspace/tutor/[studentId]`, `/workspace/admin/students` (This week and Students), `/workspace/admin/students/[studentId]/reading`, `/workspace/admin/students/[studentId]/access`, `/workspace/admin/students/import`, `/workspace/admin/tutors`, `/workspace/admin/invitations`, `/workspace/admin/settings`, `/workspace/admin/reference-review`, `/workspace/accounts`, `/workspace/claude`, `/workspace/email`, `/workspace/more`.

The tab bar (`src/components/portal/shell/tabs.ts`) decides each role's tabs; the More tab (`shell/more.tsx`) its rows; the site bar (`src/components/site/site-bar.tsx`) the header.

## Questions the walk must answer

1. Is there one menu grammar, or several? Count the distinct kinds of navigation (site bar, role tab bar, More tab, More sheet, dock, in-page pills, hero buttons, footer links).
2. From any signed-in screen, how many taps to: this week's reading; a future parashah; the trope course; the person's own readings; sign out.
3. Which words name the same thing differently on different screens (Reading / Today / Your reading / My readings / Lein / Study / Learn / Practice / Prepare).
4. Where does a role land after sign-in, and does the landing match what the door promised.
5. What a parent, a tutor and an admin each see that they do not need on their first screen.

## After the walk

Extend `2026-10-27-finding-and-keeping-readings-design.md` with a "Role homes and the tab bar" section under Daniel's rulings, bring any new user-visible decisions to him in one round, then the implementation plan.
