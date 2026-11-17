# Finding and keeping readings: what the live site shows, 2026-10-27

Checked on beitmitzvah.centralreform.org at 390 and 1280 px, signed out, in a fresh browser. Daniel's brief: people who want to lein or learn a particular parashah in the future cannot find it; the menu and button system, the lein/learn switch and getting set up are nearly impossible; signed-in people should be able to keep their own readings without anyone's help; the whole UI is confusing.

## Findings

- **F1. The home offers only this Shabbat.** The hero is Vayera with Lein and Study. Nothing on the page says another reading can be opened. The two doors are Beit Mitzvah (Sign in, Ask for an account) and Learn to lein.
- **F2. Choosing a reading is two taps and a scroll deep.** Read, then More, then below Start reading, Portion, Choose verses, Print, Sign in to save and Find a date comes "Choose a reading", which opens three dropdowns (Parashah by book, Holidays, Custom passage).
- **F3. The phone reader has nine control groups before the first Hebrew word.** Site bar; eyebrow "This Shabbat · October 31"; title with two week arrows and More; Torah | Haftarah; Lein | Study; Sources; aliyah pills (scrolling); "Genesis 18:1" with a Chapter select; then the text, with a five-button dock (Colors, English, Works, Standard, Hear verse) fixed at the bottom.
- **F4. Nine verbs for three ideas.** Read, Learn, Lein, Study, Start reading, Prepare a passage, Choose a reading, Choose verses, Find a date. The ideas: open a reading; chant it or understand it; the trope course.
- **F5. My readings exists and is nearly unreachable.** `src/components/portal/saved/` has save, rename, re-date, change verses, Still working / Got it marks, notes, translation and remove. `src/server/saved/eligibility.ts` limits it to parents, tutors, admins and approved tenant members; students are excluded. The list (`my-readings.tsx`) is rendered only on the home page for an eligible signed-in account, and on the print sheet.
- **F6. A new account is sent to an approval queue.** Every path for a signed-in person without a role ends at "Ask for an account" (`account-request.tsx`), which an approver must answer before anything can be saved.
- **F7. Learn has its own chooser.** `/learn/prepare` picks a passage with its own controls and links back to the reader "in Lein" by name; the reader does not know about it.
- **F8. Lein | Study is the second of two identical-looking toggles.** Torah | Haftarah and Lein | Study are drawn the same way, side by side, so what-you-read and how-you-read look like one choice. Daniel's "lein and learn" is this switch plus the Read | Learn split in the bar.
- **F9. The reader opened in Study for a fresh browser** in one of two visits (the address became `/read?lens=study`). Worth a check against the lens-memory rule in `study-lens.ts`, which says a fresh browser opens Lein.

## What the proposal does about each

F1, F2 → Find a reading on the home and in the reader's Change sheet; a Readings index page. F3 → five groups before the text. F4 → the words table in the design. F5, F6 → a shelf for anyone who signs in; approval only for linking to a student record. F7 → one chooser, the index. F8 → tabs for what, a filled switch for how. F9 → a builder check.

Design: `docs/superpowers/specs/2026-10-27-finding-and-keeping-readings-design.md`.


# The full walk, 2026-10-27 (sandbox, every route, every role)

Method and routes: `AUDIT-PLAN.md`. The map of every bar, tab, sheet and menu: `MENU-MAP.md`. Evidence: `bneimitzvah-review-output/2026-10-27-readings-navigation/walk/` (screenshots named `<role>-<route>-<width>.png`, `summary.txt` with every control per screen, `log-*.txt`). Roles walked: signed out; Maya (child student, reading assigned, tutor, one lesson note); Dana (adult member with two saved readings); Rachel (parent of Maya and Eli); the tutor; the admin. 390 and 1280 px throughout, dark mode on the home, the reader and each role home, 320 px on every bar.

## Findings F10 to F25

- **F10. Signing in lands on the home, not on the work.** Every role's email link ends on `/` ("Vayera · Lein · Study" first), with the role's door below the fold on a phone: "Your reading / Open Today", "Your family / Open Today", "Your students / Open This week", "This week / Open This week". The sign-in page promised "Open your reading"; the reading is two more taps away (`entry.tsx` sends a plain sign-in to the front door unless a return address was carried).
- **F11. The tab bar and the site bar never meet.** The role tab bar exists only under `/workspace` and on `/account`. On `/`, `/read`, `/learn`, `/trope-chart` and `/about` a signed-in person has no way back to their work except Account → the role card, or brand → home → door. The student's Learn tab leaves the bar behind; once in Learn there is no tab to come back. Two navigation systems, each absent where the other is present.
- **F12. Three tabs, one screen.** Tutor: This week, Students and Lessons all open "Who are you teaching today?" with the same card; only the underline moves. Parent: Today, Practice and Honors all open "Choose a child to see their reading." with the same two cards, and tapping a card opens the child in place without changing the address, so Practice and Honors are the same page again. (The code says so: "Until N11 (Today) and N14 (This week) build their own screens, each of those tabs opens the role's current home.") A first-time tutor taps three tabs and learns nothing from any of them.
- **F13. Two fixed bars at the foot of a student's reading.** On `/workspace/student?tab=reading` at 390 px the dock (Colors · English · Tikkun · Standard, 68 px) sits on top of the tab bar (Today · Reading · Learn · Account, 64 px): 132 px of an 844 px phone, with the first Hebrew word at 660 px. The same stack appears on a parent's child page and the tutor's student page.
- **F14. Five control layers before a student's text.** Site bar; page header (name · service, date, days, references, Refresh reading, Start reading, Practice up close, day circles, Practice calendar); page tabs Reading · Service parts · Lessons; Torah | Haftarah; Lein | Study; then the text. "Start reading" on a page that is the reading only scrolls to it.
- **F15. Ten header buttons on the tutor's and the rabbi's student page.** Refresh reading, Set divisions., Confirm reading is still right (Torah), Confirm reading is still right (haftarah), Start reading, Practice up close, Print practice sheet, Print the whole reading, Change verses, Trope chart, then a red "Needs review … Revision 1" banner, then "Assigned verse references (24)". Two identical "Confirm" buttons are told apart only by a small chip above each. "Set divisions." carries a full stop.
- **F16. A clipped button on the student's Today.** The "Practice verses" button (`student-workspace-student-390.png`) shows "ractice erses" with the reference overflowing: the label is cut off at 390 px.
- **F17. Three choosers, three vocabularies.** The reader's More sheet (Portion select, Find a date, Choose a reading with Parashah / Holidays / Custom passage selects); the print page (Previous week, Next week, Choose a reading, Find a date, Portion, all drawn differently); Learn's Prepare (This week's Torah, This week's haftarah, Choose another reading in Lein, and "Open a different public passage" with a typed reference such as "Genesis 12:1-3"). Finding a future parashah signed out: Read → More → scroll → Choose a reading → Parashah select → the name: five taps and a scroll. From a student's Today: Read (site bar) and the same five; back is brand → home → Open Today (three more).
- **F18. The same place has five names.** The role home is "Today" (student and parent tab), "This week" (tutor and admin tab), "Open Today" / "Open This week" (home door), "Your reading" / "Your family" / "Your students" (door titles), "Your assigned reading" / "Your assigned students" (page titles) and "Who are you teaching today?" / "Choose a child to see their reading." (visible headings). The student page is "Reading" to a student, "Practice" to a parent and "Students" to a tutor. The fourth tab is "Account" for students and parents but "More" for staff, and tutor More's first row, "Settings", goes to Account.
- **F19. "More" means three things.** The reader's More sheet (choose, print, save), the tab bar's More (settings and connections), and the Study row's "More" and "More on this verse".
- **F20. Nine verbs for opening the same text (F4 grew).** Read, Lein, Study, Start reading, Open Today, Practice verses, Practice up close, Practice with Maya, Prepare a passage, plus "Open the honors form" and "Open This week" in the same button style.
- **F21. The home leads with this Shabbat for everyone.** A student 186 days from her ceremony, a tutor and the rabbi all see "THIS SHABBAT · Vayera · Lein · Study" first; their own work is the second or third card. Dana's two saved readings come before her (empty) "Your reading" door, so the adult member sees "No reading has been assigned yet" when she opens Today.
- **F22. Dead-end pages for the wrong role.** `/workspace/more` and `/workspace/claude` for a student or parent, `/workspace/accounts` for a tutor who is not an approver: a browser title for the destination ("Claude connections") over a heading "Role unavailable" and a link "Choose a role" that leads back to the only role. Nothing links there for those roles, so it is a low-risk inconsistency, but the student's Account tab is drawn current on them.
- **F23. The print page is a fourth header.** Its own week arrows, Print, Choose a reading and Back to the reading, in an order and a style no other page uses, over a long options form (languages, Hebrew, text size, aliyot, notes column, paper, orientation, verse numbers, spacing, commentaries).
- **F24. The lesson note names the tutor "Portal member".** The student's Today card reads "Latest from Portal member · Oct 27". In the sandbox the tutor account has no display name; the fallback word is what a real student would see for any tutor without a name. Check the production fallback.
- **F25. A saved reading is a fifth reader.** Dana's "Dana haftarah" opens with its own header: eyebrow MY READING, then a button row This week · Choose a reading · Start reading · Trope chart · Print · Edit, then Lein | Study, then Change verses and "Whole portion", then the dock. None of the public reader's groups (week arrows, More, Torah | Haftarah, aliyah tabs) and none of its words for the same acts (More → Edit, Choose verses → Change verses). Once in a scripted run the address `/read?saved=<id>` was rewritten to `/read?lens=study` and this week's Vayera opened instead; two fresh-session repeats, with and without the Study lens remembered, opened the saved reading correctly, so this goes to the builder check, not the findings.

What held up: the dark pass (home, reader, role homes) and the 320 px pass (site bar, tab bar, reader groups) showed no overflow, no horizontal scroll and no illegible text; the aliyah tablist scrolls as intended. The tab bar's current state and the site bar's underline are correct on every page walked. Per-student addresses exist for tutors and admins (F7 of the 2026-10-16 analysis is fixed) but not for parents.

## The plan's five questions

1. **One grammar or several?** Twenty kinds of navigation control (counted in `MENU-MAP.md` §11). Three families do the same job: the site bar (public: Read, Learn, Account), the tab bar (role areas), and in-page systems (the reader's More sheet and pill pairs, the student page's tabs, the admin sub-nav). The families do not share words, placement or current-state styling.
2. **Taps from a signed-in screen.** This week's reading: 1 (site bar Read) from anywhere. A future parashah: 5 and a scroll (F17). The trope course: 1 (Learn), 2 for a tutor or admin. The person's own readings: Dana from the reader is 2 (brand, then the list on the home); a student's own reading from the reader is 3 (brand, home, Open Today) or 2 via Account. Sign out: 2 (Account, Sign out at the foot).
3. **Same thing, different names:** F18, F19, F20.
4. **Where a role lands:** the home, for all (F10). The door's promise ("Open your reading") is kept only after two more taps.
5. **What a role sees first that it does not need:** parent, tutor and admin see this Shabbat's reading with Lein and Study before their own door; the admin's "This week" is three empty headings ("Nothing needs you this week", "None this week", "None this week") with no action; the tutor's first screen asks "Who are you teaching today?" over a list of one; the student's reading page shows the dock before she has chosen Lein or Study.

## Heuristic score, navigation only (the 2026-10-16 scale, 1 to 4 each)

| # | Heuristic | 10-16 | Now | Why |
|---|---|---|---|---|
| 1 | Visibility of status | 2 | 3 | Current tab and bar link are always marked; days-to-go and "Not started" on Today. |
| 2 | Match with the world | 1 | 2 | Plain words now, but five names for one place (F18). |
| 3 | Control and freedom | 2 | 2 | No way back from the public pages to the work (F11); sheets inside sheets. |
| 4 | Consistency | 2 | 1 | Twenty control kinds, three choosers, four headers (F17, F23). |
| 5 | Error prevention | 3 | 3 | Unchanged. |
| 6 | Recognition over recall | 1 | 2 | Doors and cards name the next step; tabs that open the same screen teach nothing (F12). |
| 7 | Flexibility | 1 | 2 | Per-student addresses for staff; none for parents; future readings still five taps. |
| 8 | Minimalism | 1 | 2 | Surfaces, icons and state exist; five layers and two fixed bars over a student's text (F13, F14, F15). |
| 9 | Recovery | 2 | 3 | Role-unavailable and unavailable-text states are honest. |
| 10 | Help | 1 | 2 | Doors explain themselves; nothing explains Lein versus Study or the dock. |
| | **Total** | **16** | **22 / 40** | Better than October 16, still below the "intuitive" bar. |

## What the design does about F10 to F25

F10, F11 → one site bar on every page with My Readings as the third link, and sign-in returning to where the person was, else to My Readings (design spec, "Role homes and the tab bar"). F12, F18 → each role gets one home with real sections instead of three tabs to one list; one name per place (words table). F13, F14, F15 → the reader is one component with one header everywhere (five groups), the dock is the only fixed element and the tab bar hides while a reading is open; staff actions move into a "Manage" sheet. F16 → a builder fix. F17, F23 → one Find a reading everywhere; print options become a sheet on the reader. F19, F20 → the words table. F21 → signed-in home leads with the person's pinned reading. F22 → the tab bar never offers a destination the role lacks. F24 → the fallback name becomes "your tutor". F25 → a saved reading opens in the one reader with its name as the title and Edit in the Change sheet.
