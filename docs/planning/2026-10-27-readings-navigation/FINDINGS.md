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
