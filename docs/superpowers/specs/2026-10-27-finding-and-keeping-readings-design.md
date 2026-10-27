# Finding and keeping readings: the home, a Readings index, a calmer reader, and one shelf for everyone

Mockups: the "CRC Torah: finding and keeping readings" canvas of 2026-10-27 (nine screens at 390 and 1280 px) and its PNG renders outside the repo in `C:\Users\dsbog\bneimitzvah-review-output\2026-10-27-readings-navigation\mockups\` (review-only images stay out of Git). Live-site evidence that opened the work is in `docs/planning/2026-10-27-readings-navigation/FINDINGS.md`.

## Settled decisions (Daniel, binding, 2026-10-27)

1. Anyone who signs in gets their own shelf of readings: save, rename, re-date, change verses, mark verses, keep notes and a translation, remove. No approval step. Approval stays only for roles that touch other people's data (tutor, parent, admin) and for linking an account to a Beit Mitzvah student record.
2. One shelf for everyone. A Beit Mitzvah assignment is a pinned reading on that shelf with its date, its tutor and its service parts. A self-serve learner and a rabbi-assigned student are the same product.
3. "The whole UI/UX is super confusing." In his words: people who want to lein or learn a particular parashah in the future have no easy way to find it; selecting a parashah, the menu and button system, switching between lein and learn, and getting set up are nearly impossible; menus must be consistent and thought through.
4. Carried forward from the 2026-10-26 navigation rulings unless overturned below: one site bar on every page; one sign-in page; the name is CRC Torah; phone and laptop designed together; the landing stays a doorway; avoid looking like a synagogue website or a kids' app; too many choices at once and hiding the reading are failures.

## What is wrong today (verified on the live site, 2026-10-27)

- The home page offers no reading but this Shabbat. Choosing another is two taps and a scroll away: Read, More, past Portion, Choose verses, Print, Save and Find a date, to three dropdowns.
- The phone reader stacks nine control groups before the first Hebrew word: site bar, eyebrow, title with week arrows and More, Torah/Haftarah, Lein/Study, Sources, aliyah pills, chapter select, and the five-button dock.
- Nine verbs for three ideas: Read, Learn, Lein, Study, Start reading, Prepare a passage, Choose a reading, Choose verses, Find a date.
- My readings already exists (save, rename, re-date, change verses, Still working / Got it, notes, translation, remove) but only parents, tutors, admins and approved members may use it, students cannot, and the list shows only on the home page after sign-in. A new account is sent to an approval queue ("Ask for an account").
- Learn's Prepare a passage has a second chooser that does not know about the reader's.

## The model

Three places and one shelf. The bar names them in the same words on every page.

- **Read.** Any reading. The home leads with this Shabbat and Find a reading; `/readings` is the index of everything; `/read` is the reader.
- **Learn.** The trope course, unchanged.
- **My readings.** The shelf. Signed in, the bar's right side is a bookmark icon with "My readings" (icon alone under 480 px, accessible name "My readings"); signed out, it is Sign in.

Inside the reader, two views of the same verses: Lein (the continuous passage for chanting) and Study (verse rows with commentary). The words stay; the control becomes one filled segmented switch with icons, the most prominent control on the page after the title.

## Decided here (lead, 2026-10-27, under Daniel's rulings; any line can be overturned in a sentence)

1. **Find a reading is on the home page and in the reader.** On the home it follows the hero: one search field with a calendar button, "Coming up" with the next four Shabbatot as chips, and a link "Every parashah, holiday and passage" to `/readings`. In the reader it is the first thing in the Change sheet. It is never inside a More sheet again.
2. **One search field, three kinds of answer.** The field accepts a parashah or holiday name ("Toldot", "Chanukah"), a date in any ordinary form ("Nov 14", "11/14", "2026-11-14"), or a verse reference ("Genesis 25:19–26:5", "Isaiah 54"). Results list as the person types; Enter opens the first. A date answers with the Shabbat on or after it and its parashah. No match: "No reading called {text}. Try a parashah, a holiday, a date like Nov 14, or verses like Genesis 25:19." The index behind it is the existing named-readings catalog plus the calendar below; it runs in the browser so the field answers at once.
3. **A year of Shabbatot.** "Coming up" and the index's dates need, for each Shabbat in the next fifteen months, its parashah (or holiday) name. The leyning library already vendored under `src/lib/readings/` is the first place to look; if it cannot answer by date in the browser, the calendar is computed once a day on the server and served as one small public JSON the pages fetch, cached like `/api/public/reading`. A double parashah is one row under its combined name. A Shabbat whose reading is a holiday's shows the holiday. On a Saturday the home's "next" rule (1.9 N5) still applies.
4. **`/readings`, the index.** Title "Readings"; the search field; Coming up (six Shabbatot, each a row: date, name, a note such as "This Shabbat" or "Shabbat Chanukah"); "The Torah, in order" (the five books, the current book open, each parashah with the Shabbat it is next read); "Holidays and special Shabbatot" (the catalog's festival, special and fast groups); "Any verses" (the existing book-and-verses pickers, Torah or Prophets). Every row opens the reader at that reading. The three dropdowns in `reading-chooser.tsx` retire. Learn's Prepare a passage keeps its page; its chooser becomes a link to `/readings` that returns to Prepare with the chosen passage.
5. **The reader's top, five groups before the text.** (a) The site bar. (b) The title block: the reading's name, under it one muted line with the date and ranges, and on the right two pills, "Change" (chevron) and Save (bookmark, accessible name "Save to My readings"). The eyebrow and the week arrows retire; Coming up chips and the date picker in the Change sheet cover moving between weeks. (c) Torah | Haftarah as underline tabs, the haftarah tab carrying its reference in muted text. (d) Lein | Study as the filled segmented switch with icons. (e) The aliyah pills, kept as 1.9's aliyah paging. On a laptop (c) and (d) share one row. The chapter select leaves the top and becomes "Go to verse" in the Change sheet. The Sources button leaves the top row and joins the dock's Works sheet (if Sources and Works are two things, the builder keeps both in the dock and says so in the report). The dock itself is unchanged.
6. **The More sheet becomes the Change sheet.** Title "Change reading". In order: the search field with its calendar button; Coming up chips; the link to `/readings`; then "In this reading": Portion (the existing picker, as a row showing its value), Choose verses, Go to verse. Nothing else. Print, Trope chart and the siddur blessings move to a quiet row at the foot of the reading, after the last verse. Start reading stays where the reading begins; the sheet no longer carries it.
7. **Save is a sheet, "Add to My readings".** Name (prefilled with the reading's name), "Date you're reading it (optional)" (prefilled with the Shabbat when the reading is a week's), Verses as three radio rows: what is on screen (the current aliyah or the selection, named with its range), Whole portion, Choose verses. One button, "Add". The privacy line under it: "Marks, notes and your translation stay with this reading. Only you can see them." Signed out, the Save pill reads "Sign in to save" and uses the existing return flow (N20); the sheet opens with the offer on return. The existing Save card below the reading retires in favour of the pill.
8. **`/mine`, the shelf.** Title "My readings" with an "Add" pill that opens `/readings` carrying `?add=1`, so the reading it opens offers the Save sheet at once. Then, in order: the pinned Beit Mitzvah reading (a marigold tag "Beit Mitzvah · {date}", the name, ranges and service parts, "Verses you've got" with a bar and "9 of 14", the tutor's name and the latest lesson note, "Open" and "Service parts"); "Also working on", the person's own readings as rows (name, date or "No date", range, and the got-it count or "not started"), sorted by date ascending with undated readings last by last opened; one Learn to lein row with the next lesson and progress; a muted "Account · roles, email, sign out" link. Editing a reading (rename, re-date, change verses, remove) stays on the reading's own page, where it is today, and the shelf says so in one line.
9. **First sign-in lands on the empty shelf.** "My readings", "You're signed in. Nothing is saved yet.", "Add your first reading" with four chips (this Shabbat, the next two, and "Find a reading"), then a card "Preparing a Beit Mitzvah at CRC?" with "Ask to be linked". The existing account-request flow is repurposed as that linking request: the person is asking the rabbi to connect this account to a student record, not for permission to save. The approver's page and its wording change accordingly ("Link requests"; approving links the account to a student the approver picks). Daniel's approved approver help line is kept where it still fits.
10. **Eligibility.** `SAVED_ELIGIBLE_ROLES` and `memberEligible` change meaning: any signed-in identity in the tenant keeps a saved layer. The builder chooses between creating the tenant-member row on first sign-in and keying the saved layer by user id, and records the choice in the plan; either way the saved layer is per person, per tenant, and no other data access changes. This is auth and data-access work: it gets the adversarial pass before it is reported done.
11. **Student Today becomes the pinned reading.** From day one the shelf is one list: the assigned reading pinned (its verses rabbi-confirmed and not editable by the student; marks, notes and translation are the student's), own readings beneath. The student's Today tab opens `/mine`. Unifying the two stores (student readings and saved readings) is a later milestone and must not block this one; the UI is one list over two sources until then. Tutors see the assigned reading as they do today and none of the student's own readings.
12. **The landing doors.** The signed-out Beit Mitzvah door becomes "Your readings": "Save the readings you're working on, mark verses, keep notes. Beit Mitzvah students and families find their assigned reading and tutor here too.", a Sign in pill and a "How accounts work" link to About. Signed in, the door is the shelf's door: the pinned reading's name and date when there is one, else "Your readings · {n} saved", button "Open My readings". The parent, tutor and admin doors stay as the 2026-10-26 spec has them. This changes only the door's words from ruling 1 of that spec; its weight beside This week is unchanged.
13. **Words.** Kept: Read, Learn, Lein, Study, Start reading, Choose verses, Portion. Retired: Choose a reading, Find a date, the Prepare chooser's own labels, "Ask for an account", "Back to my reading" (becomes "My readings"). New: Find a reading, Coming up, Every parashah, holiday and passage, Change reading, Go to verse, Add to My readings, Add, My readings, Also working on, Ask to be linked. These follow from Daniel's rulings and are the lead's; they are not a popup round.
14. **Nothing visual reopens.** Colors, type, the pill and tab grammar, the dock and the Song session world stay. The segmented switch's icons are the only new drawing: a note for Lein, an open book for Study, drawn in the dock's stroke.

## Screens (the canvas, in order)

1. Home, phone: This Shabbat with Lein and Study; Find a reading; the Your readings and Learn to lein doors; the footer.
2. Readings, phone: the index as decided in 4.
3. Reader, phone, Lein: the five groups, one verse with phrase colors and English, the dock.
4. Change reading sheet over the reader.
5. Add to My readings sheet.
6. My readings, a linked student: the pinned card, Also working on, Learn to lein, Account.
7. My readings, first sign-in: empty state and the linking card.
8. Home, laptop: hero left, Find a reading right, the doors beneath.
9. Reader, laptop: tabs and the switch on one row; the tools as a column beside the first verse.

## States and ranges

- Search: empty, typing (results list under the field, at most eight), no match (the line in decision 2), a date that falls on a holiday (the holiday's reading), a reference the reader cannot open (the existing "These verses can't be opened together" lines).
- Calendar: loading (chips hold their height), failed ("Couldn't load the calendar." with Try again; the index still lists every parashah, without dates), a Saturday (next rule).
- Shelf: none, one, five, forty readings; a pinned reading without a tutor note; a pinned reading with no assigned verses yet ("Your tutor or rabbi will add your verses here", the existing line); a reading whose date has passed (unchanged, sorted after upcoming ones); an account that is signed in but whose session no longer keeps a saved layer (the existing signed-out and failed states).
- Reader: a named reading with several passages, a custom reference, a saved reading (its own header keeps Edit), the haftarah tab on a week with no haftarah (tab hidden), a reading with one aliyah (pills hidden, as today).
- Widths: 320, 360, 390, 480, 1000 and 1280 px, signed in and out, light and dark, as the navigation spec requires.

## Not in this work

The Learn course and its lessons; the admin, tutor and parent screens beyond the door lines; the dock's tools; print; recordings and voice; the data-model unification of student and saved readings (decision 11); a second congregation.

## Done means

- From the home, any future parashah opens in one tap on a chip or two with the search; from the reader, in two (Change, then a chip or a result).
- The phone reader shows five control groups before the text; the laptop reader four rows.
- A new Google or email sign-in reaches the empty shelf and has a reading saved, with a date, in under a minute, with no one approving.
- A linked student sees the assigned reading pinned with progress and the tutor's note, and own readings beneath; a tutor sees nothing of the student's own readings.
- The eligibility change passed its adversarial pass; tests follow the SOP (behaviour, roles and test IDs; one wording test per screen); CLS at most 0.07 and INP at most 80 ms on `/`, `/read`, `/readings` and `/mine`; axe clean on all four.

## Builder check answers (lead, 2026-10-27; a fresh reviewer read the design and asked seven questions)

1. **Membership and "approved".** The saved layer stays keyed by the tenant-member row (`bindOwner`, the `owner_only` policy). The member row is created at first sign-in for every identity, and "approved" becomes an explicit column on it rather than the row's existence. Before changing anything the builder lists every reader of the member row and sorts it: Learn to lein progress sync opens to everyone (it is the person's own data, like the shelf); the account-request queue, MCP connections and anything that grants authority over other people stay behind the approved column or a role grant. The plan records that list.
2. **The calendar.** `/api/public/reading?date=` already resolves a Shabbat to its reading on the server. The fifteen-month calendar is that resolver run over each Shabbat, served as one public JSON and cached like the week itself; nothing new is computed in the browser.
3. **Holiday labels.** The calendar carries whatever label the week resolver already returns for a special Shabbat or holiday; where it returns none, the row shows the parashah alone and no note. No new data source.
4. **Two stores, one page.** `/mine` makes two calls, the existing student-reading read and the existing saved list, and composes them. Once eligibility opens to every identity a student session passes the saved gate by the same rule as anyone else. A tutor is kept out of a student's own readings by the existing owner-only policy; the builder adds the test that proves it.
5. **Link requests.** The account-request table gains a nullable target student column (migration number reserved when the work starts). A request made before the change is shown to the approver as a link request without a target; approving it picks the student, or approves with no link for a staff account.
6. **Where My readings lives.** `/mine` replaces the home page's list; the home keeps only the shelf's door with the pinned reading or the count. `yours.tsx` and `my-readings.tsx` move under the `/mine` route with their tests.
7. **The return flow.** `saveReturnAddress` already adds `save=1` and `choose=` to the reading's own address, so `?add=1` and a selection travel the same way.

## Open items that wait on Daniel

1. The door title: "Your readings" (decision 12) or keep "Beit Mitzvah".
2. Children signing in on their own: with Google sign-in public, a child under 13 can create a shelf without a parent; it holds only what the child types (names, dates, marks, notes). Say if that needs a parent step.
3. The week arrows retiring from the reader's title row (decision 5).
4. The bar's word: "My readings" or the shorter "Mine".
5. Whether a tutor should ever see a linked student's own readings (decision 11 says no).
