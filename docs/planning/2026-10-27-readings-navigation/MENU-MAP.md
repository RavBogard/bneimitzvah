# Menu map of CRC Torah as built (main at f9788f7, sandbox walk 2026-10-27)

Every bar, tab bar, sheet, menu and in-page control group on the site, as a tree, with the words on each item and who sees it. Recorded from the fake-data sandbox (`bneimitzvah-review-output/2026-10-27-readings-navigation/SANDBOX.md`) by a scripted Playwright walk of every route at 390 and 1280 px, signed out and as the five seeded accounts, plus a click pass on the role homes and the reader's sheets. The raw inventory (every visible link, button, select and tab per screen, in reading order) is `bneimitzvah-review-output/2026-10-27-readings-navigation/walk/summary.txt`; screenshots are beside it as `<role>-<route>-<width>.png`, with `-fold` for the first screen of a phone and `-dark` for the dark pass. The sandbox has no audio, so the dock's "Hear verse" button only appears on the staff reading editor; in production it is on every reader.

Legend: `*` marks the item drawn as current. "Role" means which signed-in roles see the thing; "all" means signed out too.

## 1. Chrome every page shares

- **Site bar** (all; `site-bar.tsx`): brand mark + "CRC Torah" → `/`; "Beta" mark; "Read" → `/read`; "Learn" → `/learn`; then "Sign in" → `/sign-in` or, signed in, a person icon labelled "Account" → `/account` (the word is hidden at phone width, only the icon shows). Underline marks Read on `/read*`, Learn on `/learn*` and `/trope-chart`, Account on `/account`. Nothing is current on the home or in the workspace.
  - Minimal mode (brand and Beta only, no links): `/offline`, `/connect`, `/unsubscribe`, `/invitations/accept`, `/print`, the email sign-in landing, a saved reading's page.
- **Footer** (all): "Central Reform Congregation · About · Your account and reading stay private." / "A project of Rabbi Daniel Bogard".
- **Skip link** (all): one per page, differently worded: "Skip to main content", "Skip to the reading", "Skip to the course", "Skip to the lesson", "Skip to chart", "Skip to passage preparation", "Skip to sign-in and access", "Skip to workspace" + "Skip to workspace tabs".
- **Tab bar** (signed-in roles only, and only on `/workspace/*` and `/account`; bottom bar on a phone, left rail from 1000 px; `shell/tabs.ts`). Four tabs per role, decided by the role, not the page:
  - student: Today `/workspace/student` · Reading `?tab=reading` · Learn `/learn` · Account `/account`
  - parent: Today `/workspace/parent` · Practice `?tab=reading` (or `/workspace/practice/<child>`) · Honors `?tab=honors` · Account `/account`
  - tutor: This week `/workspace/tutor` · Students `?tab=reading` · Lessons `?tab=lessons` · More `/workspace/more`
  - admin: This week `/workspace/admin/students` · Students `?tab=students` · People `/workspace/admin/invitations` · More `/workspace/more`
  - The bar is absent on `/`, `/read`, `/learn`, `/trope-chart`, `/about` even when signed in; the Learn tab leaves the bar behind.

## 2. Home `/`

- **Hero** (all): eyebrow "THIS SHABBAT"; parashah name; "Saturday, October 31, 2026 · Torah Genesis 18:1–22:24 · Haftarah II Kings 4:1–37"; buttons "Lein" (filled) → `/read`, "Study" → `/read?lens=study`. When the next Shabbat is not this one a third button "This Shabbat" appears.
- **My readings** card (signed-in parent, tutor, admin, approved member; not a child student): the saved list, each row "Name / date · reference" → the saved reading's page. Shown with no rows for accounts that have saved nothing.
- **Role door** (signed in; title and action change by role, shape does not):
  - student: "Your reading" / "Your parts and what's next." / **Open Today** → `/workspace/student`
  - parent: "Your family" / **Open Today** → `/workspace/parent`
  - tutor: "Your students" / **Open This week** → `/workspace/tutor`
  - admin: "This week" / **Open This week** → `/workspace/admin/students`
  - signed out: "Beit Mitzvah" / "For students, families and tutors preparing a Beit Mitzvah." / **Sign in** → `/sign-in`; "Ask for an account" → sign-in with `/account` as the return.
- **Learn to lein** door (all): "Hear the phrases, then lein a verse of this week's reading." / **Start** → `/learn`; "Trope chart" → `/trope-chart`.

## 3. Reader `/read` (all; `public-reading/view.tsx`, `read-header.tsx`)

Control groups in reading order on a phone (nine before the first Hebrew word in Lein, ten in Study):

1. Site bar (Read underlined).
2. Eyebrow "THIS SHABBAT · OCTOBER 31" (or the reading's date / name).
3. Title row: parashah name; **‹ Previous week**, **› Next week** (icon buttons); **More** (opens the sheet).
4. **Torah | Haftarah** (a filled pill pair, group "Reading text selection").
5. **Lein | Study** (an identical filled pill pair, group "Reading lens"; on a laptop it sits at the right of the same row).
6. **Aliyah 1 … Aliyah 7, Maftir** (a scrolling tablist "Reading sections"; absent for a haftarah or custom passage).
7. Study only: a **chapter select** ("Genesis 18 … Genesis 22").
8. The text. Lein: coloured phrases, verse numbers. Study: each verse is a row with phrase buttons "… (show in the verse)", **More**, **Hebrew**, commentary chips ("Rashi: 2 more", "Women's Commentary: 4 more"), **Compare**, **More on this verse**.
9. Below the text: **Next section**; the "preview" line of the next verse; **Word tools**; "Rare trope this week: shalshelet, 19:16"; "About this text" (details); **Trope chart** link.
10. **Save this reading** box: signed out "Sign in to keep this reading, your place and your preferred commentaries." + **Sign in**; signed in and eligible, the save form.
11. **Dock** (fixed at the bottom of the phone, a rail on the right of a laptop; nav "Reading tools"): Lein **Colors · English · Tikkun · Standard** (+ **Hear verse** where audio exists); Study **Colors · English · Works · Standard**. "Standard" is the text size.

- **More sheet** (title "More", close "×"): the date and reference line; "Rare trope this week"; **Start reading** (filled); **Portion** select ("Full calendar portion", "Triennial portion (year 2)", "Aliyah 1" … "Maftir"); **Choose verses**; **Print** → `/print`; **Sign in to save** / **Save this reading**; **Find a date** (a native date input); **Choose a reading** (expands in place: **Parashah** select by book, **Holidays** select, **Custom passage** book / chapter / verse selects); **Trope chart**; "Torah blessings: siddur page 22"; "Haftarah blessings: siddur page 23, after Mi Shebeirach".
- **Choose verses** (from More): the sheet closes, the verse numbers in the text become tap targets, and a strip "Tap verse numbers to choose them." with **Select range · Clear · Cancel** sits over the text until a range is chosen.
- **A saved reading** (`/read?saved=<id>`, owner only; `saved/saved-reading.tsx`): the full site bar; eyebrow "MY READING"; the name; "Saturday, May 1, 2027 · Haftarah Amos 9:7–15"; a row of buttons **This week · Choose a reading · Start reading · Trope chart · Print · Edit** (Edit opens name, date, Save changes / Cancel, Remove reading / Keep it); **Lein | Study**; **Change verses**; "Whole portion"; the text with the marks, notes and translation layer; the dock (**Colors · English · Standard**). No More sheet, no week arrows, no aliyah tabs, no tab bar: a fifth header style.

## 4. Print `/print` (all)

Its own header, a fourth navigation style: **Previous week**, **Next week**, **Print** (filled), **Choose a reading**, **Back to the reading**. Then the "Sheet" form: Reading (Torah | Haftarah), Portion select, Find a date, Languages (Hebrew and English | Hebrew | English), Hebrew (Vowels and trope | Vowels only | Letters only), Text size (Small … Huge), Aliyot (Marked | Each on a new page), Notes column (None | Lined | Blank), Paper (Letter | A4), Orientation, Verse numbers, Stand-up spacing, Commentary checkboxes (Rashi … Chizkuni). The sheet renders below.

## 5. Learn `/learn` and `/learn/service` (all)

- **Learn to lein** home: lead; "Next" card (lesson name, length, **Start**); "Start where you are" (**Prepare a passage** → `/learn/prepare`; details **Choose a starting point** with a select); nav "Course": **Trope chart · About**; "Progress is saved on this device. Sign in to keep it."; then the path: Torah (The two endings: Sof pasuk, Etnachta; **This week's first phrase ›**; Inside the verse: Zakef, Revia, Tevir; The rarer phrases …; Your first verse) and Haftarah (the same signs, **This week's first phrase ›**, The end of the haftarah, Your first haftarah verse). Each sign → `/learn/<lesson>`.
- **Lesson** `/learn/<lesson>`: header is one link, **Back to the path**; the lesson; nav "Lesson practice choices": **Try the sound · Examples**.
- **Prepare a passage** `/learn/prepare`: nav "Preparation reading": **This week's Torah* · This week's haftarah · Choose another reading in Lein** (→ `/read`); details **Open a different public passage** (a free-text reference such as "Genesis 12:1-3", a Torah/haftarah select, go); then the passage steps; **Read this passage in Lein**.
- `/learn/review`, `/learn/run-through`: **Back to the path** only.
- **Learn the service** `/learn/service`: lead; "Next" card (**Start**); "New to Hebrew letters? Start with Reading Hebrew."; nav "Course": **Learn to lein · About**; sections Reading Hebrew, The parts every student leads, Morning blessings, The Sh'ma and its blessings, The Amidah, The Torah service, Closing the service, Saturday evening, Havdalah, each a list of prayer lessons.
- `/learn/service/<lesson>`: **Back to the course**; **Next**. `/learn/service/review`, `/learn/service/practice/quick-ten`: **Back to the course**.
- **Trope chart** `/trope-chart` (all): **Print chart**; the sign names link to lessons; details "Other signs".

## 6. Signing in

- `/sign-in` (all): "Open your reading" / "Your assigned passage is the starting point. Sign in with the account on your invitation."; **Continue with Google**; email field; **Email me a sign-in link**; **Ask for an account**.
- Email landing (`/auth/email/...`, minimal bar): "Continue signing in" / **Continue signing in** (filled); **Check my access**; **Request a new sign-in link**.
- After Continue: the home `/`, with the role door ("Open Today" / "Open This week"), unless a return address was carried (the reader's Save, "Ask for an account"). The workspace is never the landing.
- `/account` (signed in): "You're signed in"; **Roles** list, one card per role ("Parent / your child's preparation and practice / Current ›" → the role home); **Email settings** → `/workspace/email`; **Claude connections** (tutor, admin) → `/workspace/claude`; **Account requests** (admin or an approver) → `/workspace/accounts`; "Need help?" (student); privacy paragraphs; **Sign out**. The tab bar shows here with Account (or More) current.
- `/invitations/accept`: **Check invitation again**, **Check my access**. `/connect`: Claude connector text. `/unsubscribe`: **Email settings**. `/offline`: "Saved on this device". `/design-system`: 404 in this build.

## 7. Student (child or adult) `/workspace/student`

- **Today** (tab Today): hero card (name, "Sat, May 1, 2027", "186 days to go", reference chips "Torah Leviticus 16:1–17", "Leviticus 16:18–24", "Haftarah Amos 9:7–15"); **Torah** card: **Practice verses** (→ `?tab=reading`), the week's seven day circles, "Days you practised · a day fills when you open your reading up close"; **Latest from <tutor>** note with "Before your next lesson" and **Lessons** link; **Torah … Not started ›**, **Haftarah … Not started ›** rows (→ `?tab=reading`); **Practice calendar** (details: Previous month, Next month). With no reading: "No reading has been assigned yet" and **Open the honors form**.
- **Reading** (tab Reading, `?tab=reading`; title "Your assigned reading"): page header (name · service; date and days; Torah / haftarah references and verse counts; **Refresh reading** icon; **Start reading** (filled), **Practice up close**; day circles; **Practice calendar**); page tablist "Student page": **Reading* · Service parts · Lessons**; "Listening isn't available yet…"; **Torah | Haftarah**; **Lein | Study**; the text; **Family honors** (**Open the honors form**); the **dock** fixed above the **tab bar** (two fixed bars, 132 px of an 844 px phone).
  - **Service parts**: details "Assigned service material"; "CRC digital siddur collection" link.
  - **Lessons**: "Lesson notes" list.
  - **Practice up close**: the tikkun / up-close view of the current verse.

## 8. Parent `/workspace/parent`

- **Today**: "Choose a child to see their reading." / "Your children's readings"; one card per child (**Maya Ravid / Sat, May 1, 2027 / 186 days to go**). Tapping a card opens the child in place (the address does not change): child chips **Maya Ravid* · Eli Ravid**; "Maya Ravid · Morning service"; date and days; references; **Start reading**, **Practice with Maya**; "This week" (ceremony line, practice summary); "Before next time" note; **Family honors** / **Open the honors form**; **Torah | Haftarah**; the text; the dock; the tab bar.
- **Practice** (`?tab=reading`) and **Honors** (`?tab=honors`): the same child list and the same child page; only the underlined tab changes.
- **Account**: as §6.

## 9. Tutor `/workspace/tutor`

- **This week**, **Students** (`?tab=reading`) and **Lessons** (`?tab=lessons`): the same screen, "Who are you teaching today?" over one card per student (**Maya Ravid / Sat, May 1, 2027 / 186 days to go**) → `/workspace/tutor/<student>`. Only the underline moves.
- **Student page** `/workspace/tutor/<student>` (title "Maya Ravid"): header buttons before the text: **Refresh reading**, **Set divisions.**, **Confirm reading is still right** (Torah), **Confirm reading is still right** (haftarah), **Start reading**, **Practice up close**, **Print practice sheet**, **Print the whole reading**, **Change verses**, **Trope chart**; the "Needs review with your tutor or rabbi · Revision 1" banner; details "Assigned verse references (24)"; page tablist **Reading* · Service parts · Lessons**; "Study guide: this reading has no calendar key…"; **Torah | Haftarah**; **Lein | Study**; the text; the dock; the tab bar.
- **More** `/workspace/more`: **Settings** (→ `/account`), **Email settings**, **Claude connections**, and **Account requests** for an approver.

## 10. Rabbi / admin `/workspace/admin/*`

- **This week** `/workspace/admin/students`: "Needs you" (empty: "Nothing needs you this week."), "Ceremonies this week", "Rehearsals this week".
- **Students** (`?tab=students`): header **Import** → `/workspace/admin/students/import`, **Add student**; search "Find a student"; "3 students · Show 1 disabled · Reload roster"; one card per student (name, status chips "Reading needs review" / "No tutor yet" / "No reading yet" / "No service date yet", date, days, Child/Adult, service) with row links **Honors · Edit · People**.
  - **Student reading editor** `/workspace/admin/students/<id>/reading`: breadcrumb **‹ All students · People and access**; the tutor's header plus **Print practice sheet**; **Hear verse** in the dock; the same page tabs, pills and text.
  - **People and access** `/workspace/admin/students/<id>/access`: Setup, Tutors (**Remove from Maya**, "Choose a tutor" select, **Assign**), Parents (**Invite a parent**, **Stop child practice**), Student sign-in (**Invite the student**); **Reload access**; details "Remove someone across the congregation".
  - **Import students**: steps "1 Add your list" (template download, file, paste), details "Advanced: other column layouts and limits", **Preview import**, **Reload roster for import**.
- **People** (tab): sub-nav "People" **Invitations* · Tutors · Members** (`shell/people-nav.tsx`).
  - **Invitations** `/workspace/admin/invitations`: "Invite someone" (parent | student | tutor radios, email, "Choose a student" select, **Review invitation**); "Sent invitations"; **Reload invitations**.
  - **Tutors** `/workspace/admin/tutors`: each tutor with **Mark as cantor**, **Remove as a tutor**; **Reload access**.
  - **Members** `/workspace/accounts`: "Requests", "Members" (**End membership**), "Approvers" (role select, **Add**).
- **More** `/workspace/more`: **Settings** → `/workspace/admin/settings` (Rabbi, Sources, Services, Links, Roster and families, Email; **Save settings**), **Email settings**, **Claude connections**, **Recording review** → `/workspace/admin/reference-review` (**Reload review**), **Update the staff roster Sheet**.
- `/workspace/accounts`, `/workspace/more`, `/workspace/claude` for a role that lacks them: a page titled for the destination whose heading is "Role unavailable" / **Choose a role** → `/workspace`.

## 11. Count of navigation kinds (question 1 of the plan)

Twenty distinct kinds of control group move a person around the site: (1) site bar, (2) footer, (3) home hero buttons, (4) home doors, (5) reader title-row arrows and More, (6) the More sheet, (7) the chooser inside the sheet, (8) Torah | Haftarah pill pair, (9) Lein | Study pill pair, (10) aliyah tablist, (11) the fixed dock, (12) in-text buttons (Next section, Word tools, Study verse chips), (13) the Study chapter select, (14) the print header and its form, (15) the Learn course nav and "Back to the path" headers, (16) the Prepare nav and its free-text chooser, (17) the role tab bar, (18) the student page tablist, (19) the People sub-nav and the admin breadcrumb, (20) the More page list and the Account roles list. Plus row-level links (Honors · Edit · People), child chips, and per-student header button rows.
