# Product review of CRC Torah v1.8.0: report

2026-10-24. Product: v1.8.0 (7c13cac) at beitmitzvah.centralreform.org; code read at origin/main 0bfed42. Written for Daniel. Brief: `docs/planning/2026-10-24-product-review/BRIEF.md`. Every high-impact finding below was re-checked by a second agent (the verifier), and its corrections are applied here. Names in examples (Noa, Leah, Tamar and so on) are made-up sandbox people.

---

## 1. Verdict

CRC Torah is honest, well built at the base and better than any single benchmark at the things it chose to do: coloured trope phrasing, tikkun, word cards, print, commentary beyond Rashi and a learning path ordered the way the research says. Light-mode contrast, sign-in, reflow at 320 px, reduced motion and the house tone all pass. There is no security finding. Its main problem is length and structure on a phone, not looks. A student's page is a 22,000 px scroll, and what a 12-year-old needs (today's task, the word she just tapped, her tutor's note, her service parts) sits thousands of pixels from where she is. The reader has no aliyot, which is the one thing that keeps Daniel on Chabad for reading. The course teaches listening well but never asks a student to chant on their own, and it never uses the student's own verses. A short list of Hebrew and accessibility defects (the qere pushed off screen, maqaf phrases split across lines, invisible trope samples in dark mode, page jumps on load) is cheap to fix and ships as 1.8.2 or in the 2.0 fixes lane. The redesign the evidence supports keeps the "Song session" look and changes the structure: one section of the reading at a time, a "Today" screen and a bottom tab bar. That needs Daniel's word (section 3).

### Headlines by audience

**Daniel's Shabbat prep: can this replace Chabad and Sefaria?** For reading, nearly; for teaching, not yet.
- **Already better than Chabad:** trope colours, tikkun, verse and word audio for Torah and haftarah, the word card, print (aliyah picker, notes column, stand-up spacing) and commentators beyond Rashi (Ramban, Ibn Ezra, Sforno, Rashbam, Or HaChaim and more). The haftarah with Rashi and Radak is one tap away.
- **What still sends you to Chabad:** no aliyot in the reader. Only print has them (G1). Add aliyot and the 1.8.1 word-card fix, and you can drop Chabad's Torah reading and haftarah pages. You would still go to Chabad for the aliyah-by-aliyah summary (G9, decision 4) and for a modern Rashi English (decision 9).
- **What still sends you to Sefaria:** a portion summary and a curated set of notable sources (G9), search, and the Writings. Building your own source sheet is not this app's job (your 2026-10-24 ruling). The app's answer is a rabbi-curated insights column beside the text, growing from the 1.8 curated discussions.
- **Claude (MCP):** sound and licence-safe. It needs to be able to name an aliyah, so that "set up my Shabbat" works in one sentence (DP-14, in G1).

**Students (12–13, phone).**
- The best screen in the app is Practice up close. Sign-in by code is also excellent.
- Everything else is buried:
  - a 22,000 px page with no tabs (G2);
  - a word tap that seems to do nothing (fixing in 1.8.1);
  - no "today" answer (G3);
  - no link to Learn to lein (fixing in 1.8.1);
  - Learn never uses the student's own verses (G4).
- In dark mode, which many teenagers use, the trope chart's sample signs vanish (2.0 F2).

**Tutors and parents.**
- Privacy holds: every cross-student probe was refused.
- A tutor can't see where a student is stuck without scrolling past every verse (G7).
- A parent can't tell whether their child is on track (G8). Lesson notes are at the bottom of a 77-verse page.
- New parents are stranded after accepting an invitation (fixing in 1.8.1).
- The invitation link expires in 72 hours, and the email doesn't say so (G13).

**Admins and staff.**
- Approving an account request is quick and clear, and the review sheets are excellent.
- Nothing tells you what needs attention this week (G10).
- A newly added student can't get a reading until a service slot is set. The message blames "your rabbi" and offers no link (G10).
- If a tutor leaves, there is no hand-over (G11).
- The roster is in random order (fixing in 1.8.1).
- On a phone, three of the seven admin tabs are hidden (1.8.2).

**Hebrew text.**
- The font, the mark stacking, the sizes and the line height are sound.
- **Defects:**
  - maqaf phrases break across lines on screen and on paper (D2);
  - the qere is pushed off the left edge in Lein (D1);
  - verse numbers are stranded at line ends (D7);
  - copied Hebrew pastes hidden English (D8).
- **Improvements:**
  - the phrase colours are not colour-blind safe (G18);
  - the qamats qatan can't be told apart from a qamats (decision 10).

**Accessibility and performance.**
- **Pass:** WCAG 2.2 AA in light mode, sign-in (3.3.8), reflow at 320 px and reduced motion.
- **Fail:**
  - dark mode: the trope chart and the verse numbers (2.0 F2);
  - screen readers hear "Select word 3 of Genesis 18:1 for tools" instead of the Hebrew word (2.0 F5);
  - forced colours, 200% text, the faint focus ring, and Learn pages with no heading (1.8.2).
- **Performance:** the server is fast (about 30 ms), but:
  - pages jump after they appear (layout shift 0.48–0.58, where 0.25 or more counts as poor);
  - Lein/Study takes 0.7–1.6 s to switch on a mid-range phone;
  - the fonts ship as 363 KB TTF files;
  - Google's sign-in script (about 216 KB, including a tracking beacon) loads for every signed-out visitor to a children's site (decision 8).

**Learning design against the three goals.**
- **G1, chants the portion alone:** strong on listen-and-imitate. But no step ever asks the student to chant without the recording, and "You can lein this verse." appears after chant-along only. No drill goes from mark to sound (G5).
- **G2, understands it for a d'var:** good reference material, but read-and-tick, with no portion overview (G9).
- **G3, prepares a new reading years later:** the order, interleaving and spacing are right. Everything practised is recognition, though, not production (G5, G6).
- **Keep:** endings first; one family per lesson; block, then interleave the families students confuse; answer before reveal; Leitner review capped at the ceremony date; no scores.

### The twelve that matter most (all audiences, by impact)

| # | Problem | Entry | Status |
|---|---|---|---|
| 1 | Phone: tapping a word shows nothing (Lein) or opens its card off-screen (Study) | X1 | fixing in 1.8.1 (PR #71); full bottom sheet in 2.0 F5 |
| 2 | No aliyot in the reader; 100-verse pages cut mid-chapter | G1 | 1.9 (decision 2) |
| 3 | Student and parent pages are one 22,000 px scroll | G2 | 1.9 (decision 1) |
| 4 | Qere pushed off screen; maqaf phrases split across lines | D1, D2 | 1.8.2 |
| 5 | Dark mode: trope samples invisible, verse numbers 1.9:1 | VA-06, VA-07 | 2.0 F2 |
| 6 | Learn is cut off from the student's own reading | X6, G4 | 1.8.1 (link) + 1.9 |
| 7 | The student is never asked to chant on their own; review never covers their own verses | G5, G6 | 1.9 |
| 8 | "What do I do today?" has no answer above the fold | G3 | 1.9 (decision 11 wording) |
| 9 | Tutors can't see where a student is stuck; parents can't see if a child is on track | G7, G8 | 1.9 (decision 7) |
| 10 | No portion overview for teaching or a d'var | G9 | 1.9 (decisions 4, 5) |
| 11 | Pages jump on load; Lein/Study is slow | D3, G14 | 1.8.2 / 1.9 |
| 12 | Admin: nothing says what needs attention | G10 | 1.9 |

---

## 2. Findings

Each entry gives: who it hurts · impact (H/M/L) · effort (S/M/L) · type · evidence · recommendation · status. IDs from all the lenses are merged into one entry. The full map is in the appendix.

### 2.1 Fixing now in 1.8.1 (PR #71) and PR #72

| Entry | Problem | IDs | Note |
|---|---|---|---|
| X1 | Word tap on a phone: no card in Lein; card off-screen in Study | ST-02, DP-02, F-SITE 6 (part) | 1.8.1 is the minimal fix. Learn's bottom-sheet card in Lein is 2.0 F5 |
| X2 | Practice up close cuts long verses with no cue (31 of 46 verses on an iPhone SE) | ST-04 | |
| X3 | Trope chart: "Return to workspace" for guests, U+ code points, two spellings of sof pasuk | DP-08, LD-17 (part), F-SITE 14 (part), F-SITE 21 (part) | Linking chart families to lessons is **not** in 1.8.1 (D23) |
| X4 | Stray "·" on its own line between the siddur links | DP-07, F-SITE 17 | |
| X5 | Word card gloss "and/ he saw" | DP-18, F-SITE 15 (part) | The credit sentence and the dropped maqaf in snippets remain (2.0 F6) |
| X6 | Student page never links to Learn to lein | LD-04 | |
| X7 | /workspace is blank for single-role parents, tutors and admins | TP-07, AD-16 | |
| X8 | "Continue" after accepting an invitation lands on the public home | TP-08 | |
| X9 | Roster and child lists in random (UUID) order | TP-11, AD-06 | Builder: confirm the admin roster (`server/data/roster.ts:11`) is covered as well as `server/data/students.ts:24` |
| X10 | Accounts intro breaks "CRC Torah" onto its own line | TP-17, AD-15 | |
| X11 | Too-long lesson note shows two errors | TP-18 | |
| X12 | Phone chip strip doesn't scroll to the chosen student | TP-19 | |
| X13 | Refresh loop on a new student's page | AD-01 | **PR #72.** Verifier: reproduces only with the sandbox's mismatched secret; production unaffected. Downgraded to low/latent. PR #72 bounds the unbounded re-check in `provider.tsx` `serviceRead` |

### 2.2 Clear defects for 1.8.2 (build without asking)

These are defect-now findings not already in 1.8.1. None needs new wording or a ruling. Code paths are under `src/` in the repo. Ranked by impact.

**D1. The qere is pushed off the left edge in Lein** (HB-02)
- **Who:** students and adults reading a verse with ketiv/qere. **Impact** H · **Effort** S · **Type** layout break (WCAG 1.4.10, 1.4.12).
- **Evidence:** Gen 24:33 at Huge on a Pixel 7: the box starts at x=−88. At 320 px Standard: x=−5. At 320 px Huge only "d / qere:]" shows. Confirmed.
- **Fix:** `app/globals.css:589` `.study-alternative{white-space:nowrap}` makes the whole "(ketiv) [read / qere: …]" one box. Keep nowrap only inside the bracketed qere.
- **Test:** at Pixel 7 Huge, iPhone SE Huge and 320 px Large, no glyph of Gen 24:33 starts left of x=0.

**D2. Maqaf phrases break across lines** (HB-01)
- **Who:** everyone reading Hebrew; a maqaf group is one chanted unit. **Impact** H · **Effort** S · **Type** layout break.
- **Evidence:** line-end breaks after a maqaf: Gen 18:1–14 has 1 on a Pixel 7; Gen 24:30–36 has 2 on a Pixel 7 and 4 at 320 px. They also appear in side-by-side tikkun and in print (24:30). Confirmed.
- **Fix:** wrap each maqaf chain in a nowrap span:
  - `parts()` in `components/portal/workspace/study/annotations.tsx`;
  - the Hebrew cell in `components/portal/print/document.tsx`;
  - `components/learn/bits.tsx`.

  Alternatively, insert U+2060 after the maqaf and strip it on copy.
- **Test:** at 320 px Huge, no rendered line ends in U+05BE (Gen 24:30–36; Gen 18:1–14 side by side).

**D3. Pages jump after they appear** (VA-01)
- **Who:** every signed-out visitor, Daniel included. Content moves under a thumb about to tap. **Impact** H · **Effort** M · **Type** defect (Core Web Vitals).
- **Evidence:** in production with 4× CPU, CLS is 0.581 on /read and 0.482 on /. The sources are the signed-out "Save this reading" aside, the week nav, the hero meta and the front-door block. Confirmed.
- **Fix:**
  - The aside in `components/portal/public-reading/view.tsx:100` paints before the reading mounts above it. Move it after the reading, or give it a fixed-height slot. Reserve the reading block's height.
  - On /, render the signed-in/out branch on the server, or give the door block a stable min-height.
- **Test:** `S/visual/cls.cjs` reads below 0.1 on /, /read and Study.

**D4. At 200% text or wider text spacing, reading pages scroll sideways** (VA-10)
- **Who:** low-vision users and older adults. **Impact** M · **Effort** S · **Type** a11y (1.4.4, 1.4.10, 1.4.12).
- **Evidence:** with the root font at 200% on a Pixel 7, pages widen to 546 px (/read, the "Find a date" row), 491 px (student page, "View … up close" `.button-text`) and 512 px (parent child cards). Confirmed.
- **Fix:**
  - `flex-wrap: wrap` on the date row and the verse-tool action rows;
  - `white-space: normal; min-width: 0` on `.button-text` and the student-card date;
  - stack the "Find a date" label above its field below about 360 px.

**D5. The keyboard focus ring on words and verse numbers is nearly invisible** (VA-05)
- **Who:** keyboard users (tutors on laptops) and switch users. **Impact** M · **Effort** S · **Type** a11y (1.4.11).
- **Evidence:** marigold #f7b500 measures 1.82:1 on white and about 1.4:1 on the zakef yellow. Confirmed.
- **Fix:** `components/portal/workspace/study/annotations.module.css:16`. Use the global ring on light surfaces (3px `--lake-deep` plus a 2px white halo), and keep marigold inside lake fields only. The dark-mode ring is handled in 2.0 F2; coordinate with it.

**D6. High-contrast (forced colours) mode hides which tab, lens and tool is on** (VA-08)
- **Who:** Windows contrast-theme users, including many school laptops. **Impact** M · **Effort** S · **Type** a11y.
- **Evidence:** there are no `forced-colors` rules in `src`. Pressed Torah/Haftarah, Lein/Study and Colors look the same as their neighbours, and "Start reading" loses its button edge. Confirmed in code.
- **Fix:** add `@media (forced-colors: active)` rules in `app/globals.css`:
  - pressed, current and selected states → `Highlight`/`HighlightText` with `forced-color-adjust:none`;
  - buttons get a `1px solid ButtonText` border.

**D7. Verse numbers stranded at line ends** (HB-04)
- **Who:** readers of the flowing Lein text. **Impact** M · **Effort** S · **Type** layout.
- **Evidence:** 7 stranded numbers in Gen 18 on a Pixel 7 at Standard; 10 on an iPhone SE at Large. Confirmed.
- **Fix:** `FlowVerse` in `annotations.tsx` (~line 197) puts a plain `{" "}` after the number. Use a no-break space, or a nowrap span holding the number and the first word.

**D8. Hidden English sits inside Hebrew: wrong language for screen readers, and polluted copy** (HB-05 language part, HB-06)
- **Who:** screen-reader users; anyone copying Hebrew for a sheet or a message. **Impact** M · **Effort** S · **Type** a11y (3.1.2) and defect.
- **Evidence:** the sr-only verse headings and the phrase legends ("zakef, Words 1–3") sit inside `<p lang="he">` with no `lang="en"`. Copying Gen 18:1 pastes "Genesis 18:11 וַיֵּרָ֤א … zakef, Words 1–3…". Confirmed.
- **Fix:**
  - add `lang="en" dir="ltr"` to the sr-only headings, the legends and the verse-number button's label (`annotations.tsx:195, 201`);
  - add a copy handler that writes the verse number, then the Hebrew, with a newline per verse.

  The word buttons' accessible names are a separate fix in 2.0 F5.

**D9. Practice up close dims the rest of the verse below readable contrast** (HB-10)
- **Who:** students in Practice up close. **Impact** M · **Effort** S · **Type** a11y contrast.
- **Evidence:** `app/globals.css:536` sets `.lift-phrasing [data-word-index]{opacity:0.32}`, which gives 1.9–2.5:1. Spot-check confirmed.
- **Fix:** raise the opacity to at least 0.6, or dim only the fill and keep the letters at full ink.

**D10. Focus is left behind after in-page jumps** (F-SITE 13, focus part; ST-13)
- **Who:** keyboard and screen-reader users. **Impact** M · **Effort** S · **Type** a11y.
- **Evidence:**
  - "Start reading" scrolls but leaves focus on the button (F-SITE 13).
  - The "Service parts" segment is an `<a href="#…">` among `aria-pressed` toggles. It jumps about 20,000 px and leaves focus on the body. The verifier confirmed the markup; the focus part was not re-tested.
- **Fix:**
  - Start reading (`public-reading/view.tsx`, `workspace/reading.tsx`): move focus to the first verse or the reading heading;
  - Service parts: focus its heading (`tabindex=-1`).

  The structural fix is G2.

**D11. The student hero breaks references and dates across lines** (ST-11)
- **Who:** students on 375–412 px phones. **Impact** L · **Effort** S · **Type** layout.
- **Evidence:** "Genesis 23:1–⏎24:26", "Oct 31,⏎2026", "Current⏎reading". Confirmed.
- **Fix:** in `components/portal/workspace/reading.tsx`, `AssignedReadingSummaries` and `RehearsalDates` (lines 48–53), add `white-space:nowrap` on the range `<bdi>`, on each `<time>` and on "Current reading". Drop the year from rehearsal dates that fall in the ceremony's year.

**D12. Learn lessons, Quick ten and Review have no page heading; heading levels skip** (VA-11)
- **Who:** screen-reader users. **Impact** L–M · **Effort** S · **Type** a11y.
- **Evidence:** the bar title is a `<p>` at `components/learn/lesson.tsx:56`, `quick-ten.tsx:37` and `review.tsx:44`. Confirmed.
- **Fix:**
  - make `barTitle` an `<h1>`, keeping its style;
  - wrap the "Back to the path" footer in `<nav>` or put it inside `main`;
  - fix the skipped levels: Study's `<h5>` Rashi after an h3, /read's sr-only headings at `aria-level=4` under an h2, and the Tutors list's h3 straight under the h1.

**D13. Every signed-in page has the same tab title; student pages' h1 doesn't name the student** (VA-12)
- **Who:** screen-reader users; tutors with several tabs open. **Impact** L · **Effort** S · **Type** a11y (2.4.2, 2.4.6).
- **Evidence:** `app/layout.tsx:6` sets the title to "CRC Torah". The tutor student page's h1 is "Your assigned students"; the admin student page's is "Student". Confirmed.
- **Fix:**
  - titles become "{existing h1} | CRC Torah", or "{student name} | CRC Torah" on student pages;
  - the student's name becomes the h1 on the tutor and admin student pages.

  The Quick ten title is handled in 2.0 F6.

**D14. Two footer landmarks on most pages** (VA-13)
- **Impact** L · **Effort** S · **Type** a11y.
- **Evidence:** `app/layout.tsx:10` adds `<footer class="site-credit">`, and pages add their own `portal-footer` (`front-door.tsx:92`, `entry.tsx:214`, `connect.tsx:133`). Confirmed.
- **Fix:** one `<footer>` per page, with the credit inside it, or make the inner footer a `<div>`.

**D15. Study's credit links and dibbur buttons are below minimum target size** (VA-14, Study part)
- **Who:** students and Daniel on phones. **Impact** L · **Effort** S · **Type** a11y (2.5.8).
- **Evidence:** axe finds 8 `target-size` failures in Study. "Rashi on Genesis 18 on Sefaria" links are 20 px tall, with neighbours closer than 24 px; the "(show in the verse)" buttons are 22 px tall.
- **Fix:** in `study/commentary.module.css`, set `min-height:24px` (44 px preferred) with 8 px spacing. The verse-number buttons (16×36) are handled in 2.0 F5.

**D16. Roster buttons on the per-student access page don't start with their visible words** (VA-09, roster part)
- **Impact** L · **Effort** S · **Type** a11y (2.5.3).
- **Evidence:** visible "Remove from Noa"; label "Remove Tamar Levin from Noa".
- **Fix:** the label starts with the visible words: "Remove from Noa: Tamar Levin" (relationships/access workspace).

**D17. On touch screens, a hover underline sticks after a tap and cuts through the vowels** (HB-11)
- **Impact** L · **Effort** S · **Type** defect.
- **Evidence:** `.playable [data-word-index]:hover` in `annotations.module.css:24` is not inside `@media (hover:hover)`. Confirmed.
- **Fix:** move the rule inside `@media (hover:hover)` and set the offset to at least 0.5em, matching `.linked`.

**D18. Hebrew inside Rashi's English renders in the UI face and the wrong language** (HB-15, language and face part)
- **Impact** L · **Effort** S · **Type** a11y. **Verify first:** the verifier confirmed the size part, not this part.
- **Evidence:** at Gen 18:1, a Hebrew word inside the English renders at 14 px in the UI face inside `lang="en"`.
- **Fix:** wrap Hebrew runs in `<span lang="he" dir="rtl">` with the app's Hebrew face (the `guide.module.css .he` pattern). Scaling commentary Hebrew with the size control is G17.

**D19. The print appendix drops a Rashi lemma** (DP-17)
- **Impact** L · **Effort** S · **Type** defect. **Verify first:** not re-tested.
- **Evidence:** in print, the third Rashi on Gen 18:1 loses its leading word; the screen shows it.
- **Fix:** align the print commentary cleaner with the screen's.

**D20. /offline is an empty page on the live domain** (ST-16, defect part)
- **Who:** anyone who reaches /offline. **Impact** M · **Effort** S · **Type** defect.
- **Evidence:** production /offline renders no h1 and an empty `main`, because the offline features are tied to `TORAH_ORIGIN` (`lib/offline/policy.ts:10`). Confirmed. The claim that the assigned reading is never packed offline is unverified; it belongs to decision 14.
- **Fix:** off-origin, show the page's existing heading and the already-approved line "Nothing is saved on this device yet.", or redirect home.

**D21. The phone admin nav hides three of its seven areas with no cue** (AD-08)
- **Who:** Daniel and staff on a phone. **Impact** M · **Effort** S · **Type** layout.
- **Evidence:** on a Pixel 7, `.admin-nav` has scrollWidth 706 against clientWidth 380. Recording review, Settings and Claude sit off-screen, and the scrollbar is hidden. Confirmed.
- **Fix:** in `admin-nav.tsx`, add an edge fade or a clipped-tab cue, and scroll the current tab into view. The structural fix is the redesign's "More" tab.

**D22. CSV import refuses a blank service slot, though the page says other columns can stay empty** (AD-10, first point)
- **Who:** office staff importing families. **Impact** M · **Effort** S · **Type** defect.
- **Evidence:** a blank `service_slot` is trimmed to "", and `serviceSlot("")` throws (`server/students/validation.ts:42, 93`). Only the literal word "unknown" passes. Confirmed.
- **Fix:** treat a blank as `unknown`. The rest of AD-10 is in G21.

**D23. Trope chart families don't link to their lessons** (LD-17, the remainder after 1.8.1)
- **Who:** students and Daniel using the chart as a refresher. **Impact** M · **Effort** S · **Type** missing link, no new wording.
- **Fix:** link each family on `/trope-chart` to its Learn lesson, using the existing lesson titles. Sound on the chart is the 2.5 list (L3).

**D24. Fonts ship as full TTF files (363 KB) and hold up the first paint** (VA-03)
- **Who:** everyone; worst on cellular. **Impact** M · **Effort** S · **Type** performance, no wording.
- **Evidence:** Bricolage TTF (250 KB on the wire, every axis) at `app/globals.css:5–12`; Noto Serif Hebrew TTF (113 KB) at `hebrew-font.module.css:3`. LCP is 3.5–6.0 s against TTFB about 30 ms.
- **Fix:**
  - WOFF2 subsets: Latin for Bricolage at the weights in use (500–800, width 100); Hebrew letters, points and accents for Noto, keeping the `mark`/`mkmk` tables;
  - add `size-adjust` fallbacks;
  - update the font provenance notes.

  The OFL permits subsetting. The Hebrew subset needs a check against every mark before it ships.

**Owned by the 2.0 fixes lane, so don't build twice:**
- VA-06 and VA-07: dark-mode trope samples and verse numbers (F2).
- VA-09 and HB-05: word names (F5).
- VA-14: verse-number targets (F5).
- VA-15: tab stops (F5).
- ST-08: drill live region (F6).
- DP-09: later lessons as links (F6).
- ST-07: the "Sign in" link (F6).
- F-SITE 11, 12, 15 (rest), 19, 21, 23, 25 and 27 (F6).

If F2 hasn't started when 1.8.2 is cut, take it into 1.8.2. It is S, it has a ready exit test, and it fixes the worst dark-mode failure for students practising at night.

### 2.3 Improvements and gaps for 1.9

Ranked by impact on students and Daniel's prep, then by effort. "Wording" means new copy that Daniel approves (decision 11).

**G1. Aliyot and triennial in the reader; page by aliyah; Claude can name an aliyah** (DP-01, DP-16, DP-14, VA-02 structural part, VA-15 part)
- **Who:** Daniel, tutors, students, adults. **Impact** H · **Effort** M · **Type** gap.
- **Evidence:**
  - `PassageReading` passes no `sections` to `StudyRows`/`FlowingStudyText` (`public-reading/view.tsx` ~441–444), while the workspace does. The data exists at `/api/public/aliyot` and in the print picker. Confirmed.
  - Pages hold 100 verses and page 1 ends at 21:11, mid-chapter.
  - Study is about 69,600 px and 7,800 DOM nodes.
- **Recommendation:**
  - aliyah labels in both lenses;
  - the print picker in the reader (Full, Triennial year N, Aliyah 1–7, Maftir), addressable as `&pick=aliyah-4` and carried to Print, Save and Choose verses;
  - page by aliyah, which cuts the DOM and the tab stops by about 7;
  - add `portion` to the MCP `study_link` and the saved-reading tools, plus a read-only `get_reading`.

  Labels reuse print's wording. **Status:** 1.9; paging needs decision 2.

**G2. One student page, not a 22,000 px scroll** (ST-01 = TP-04; ST-05, ST-13, TP-13, ST-14, ST-15 = TP-13 part = AD-18 part)
- **Who:** students, parents, tutors. **Impact** H · **Effort** M · **Type** redesign, using an existing pattern.
- **Evidence:**
  - Noa's page is 22,470 px. 46 "Verse tools" cards fill 10,500 px.
  - Lein/Study sits at y≈20,700 on a phone.
  - `tabbed = staff` (`reading.tsx:243`), so learners and parents get no tabs. The guest /read page puts its tools at the top, which is better than the student's own page.
  - The tutor's current tab isn't in the URL.
  - Every verse offers "Sources", even when there are none.
  - Two "Print" links sit side by side with no stated difference.
- **Recommendation:**
  - give learners and parents the staff tabs (Reading · Service parts · Lessons);
  - move Lein/Study, Print and the trope chart to the top;
  - show verse tools for the selected verse only, in a bottom sheet;
  - put `?tab=` in the URL;
  - show "Sources (n)" only when there are sources;
  - label the print links (wording).

  **Status:** 1.9 (decision 1 for the full redesign; the tabs alone need no ruling).

**G3. "What do I do today?"** (ST-03 = TP-22 = TP-03 date part; ST-12; LD-11; DP-19)
- **Who:** students, parents. **Impact** H · **Effort** S–M · **Type** improvement, wording.
- **Evidence:**
  - On the day of Noa's first rehearsal, the hero lists "Rehearsals: Sat, Oct 24, 2026 and Sat, Oct 31, 2026" with no "today" (`reading.tsx:48–53`). Confirmed.
  - The newest tutor note is at about 21,400 px.
  - The practice calendar can't look ahead to the ceremony and has no caption.
  - There is no "before next time" field.
- **Recommendation:**
  - relative wording: "Rehearsal today" or "Next rehearsal: Sat, Oct 31";
  - pin the latest tutor note under the hero;
  - mark the rehearsals and the ceremony on the calendar, and allow forward months;
  - a caption for practice days;
  - an optional lesson-note field that prompts an if-then plan ("When ___, I will ___"). The verifier corrected the evidence here: the d≈.65 effect holds only for if-then plans.

  **Status:** 1.9 (decision 11).

**G4. Learn wired to the student's own reading** (LD-05, LD-16, ST-07 back-link part, DP-09)
- **Who:** students, adults. **Impact** H · **Effort** M · **Type** gap.
- **Evidence:**
  - `week-data.ts:25` always starts from `thisShabbat()`, and the first-verse lesson uses this week's verse, not the student's. Confirmed.
  - The path reaches chanting only after 11 lessons, Torah first.
  - Learn has no way back to the student's reading.
- **Recommendation:**
  - signed-in students see "In your reading" items from their assigned ranges;
  - the first verse comes from their own reading;
  - a "first phrase of your verse" step after unit 2;
  - a student assigned a haftarah sees the haftarah path first;
  - a "Back to my reading" link.

  The 1.8.1 link (X6) and 2.0 F6 (lesson links, the "Sign in" link) cover the rest. **Status:** 1.9.

**G5. Practise producing the chant, not only recognising it** (LD-03, LD-02, LD-01, LD-18, LD-19, LD-20)
- **Who:** students, adults. **Impact** H · **Effort** M · **Type** improvement and gap.
- **Evidence:**
  - The first-verse steps end at "Chant along", then "You can lein this verse." (`first-verse.tsx:13, 85`). Confirmed.
  - All seven drill types start from sound; none goes from mark to sound. Confirmed.
  - Three drill types can be answered by following the words. The verifier calls this a design choice, not a defect.
  - Review difficulty never rises.
- **Recommendation:**
  - a "Your turn" step (chant without the recording, then hear the reader), with the celebration moved after it;
  - a "Read it, then pick the tune" drill from zakef on;
  - from zakef on, where-does-it-end plays no audio until the answer;
  - box 3+ review cards get the harder items;
  - correct-answer feedback underlines the closing mark;
  - Hear it plays once on open.

  The evidence is retrieval practice (Roediger & Karpicke 2006). The generation effect (Slamecka & Graf 1978) applies only by analogy. **Status:** 1.9 (decision 11 wording).

**G6. Review and readiness for the student's own verses** (LD-07, LD-12, LD-09, LD-13)
- **Who:** students; tutors through the marks. **Impact** H · **Effort** M · **Type** gap.
- **Evidence:**
  - Review cards are family × tune × skill only. A verse marked "Got it" never comes back. Confirmed.
  - There is no run-through against the date.
  - "Got it" has no criterion.
  - Colours, vowels and tikkun are toggles, not a fading sequence.
- **Recommendation:**
  - Got it and Solid verses become review cards with the same boxes and the ceremony-date cap;
  - a "Run-through" (no audio, colours off, Clean / Stumbled per verse) whose stumbles feed review;
  - criteria on Got it and Solid (wording);
  - a suggested fade from colours to marks only to tikkun, never a lock.

  Citation fixes: cite Kornell & Bjork 2008 in *Memory* 16(2), on dropping flashcards, not the *Psych Sci* paper. 4C/ID supports run-throughs **plus** drill, not instead of drill. **Status:** 1.9.

**G7. Tutors see where the student is stuck** (TP-01, TP-23, TP-24, TP-11 signals, TP-12, TP-20)
- **Who:** tutors (Tuesday Zoom lesson). **Impact** H · **Effort** M · **Type** gap.
- **Evidence:**
  - A "Still working" mark appears only as a chip in that verse's tools row, after the whole passage (`study/view.tsx:296–311`). Nothing summarises the marks. Confirmed.
  - A parent's marks look like the student's.
  - In Practice up close, the dots aren't a verse picker, so reaching 23:10 takes about 40 taps.
  - The tutor can't see whether the family has joined.
  - Tutors get no digest email.
- **Recommendation:**
  - a "Needs work" block at the top of Lessons, plus one line on the roster card;
  - record and show whether a mark was made with a parent;
  - a verse picker and "Add note for this verse" in Practice up close;
  - a "Family: invitation sent / joined" line;
  - a Settings link in the tutor workspace.

  The digest and the per-day practice detail wait on decision 7. **Status:** 1.9.

**G8. Parents: is my child on track, and how do I help?** (TP-03, TP-14, TP-15, TP-16)
- **Who:** parents. **Impact** H · **Effort** M · **Type** gap, wording.
- **Evidence:**
  - The parent summary has no mark counts and no "this week" (`parent-summary.tsx`). Confirmed.
  - The wording is system language ("Read-only overview…", "Saved version 1", "This tab only…").
  - After choosing a child, the page still says "Choose a child".
  - Child practice opens on "Practice with another child".
- **Recommendation:**
  - a "This week" card: next date in relative words, the latest note open by default, and mark counts (which need decision 7);
  - a one-line coaching helper inside parent practice;
  - TP-14's wording table (decision 11);
  - the child's name as the heading;
  - one compact practice bar.

  **Status:** 1.9.

**G9. Portion overview and a curated insights column** (DP-03, LD-14, LD-15, LD-21 reframed, DP-04 folded in)
- **Who:** Daniel teaching; students writing a d'var (goal G2). **Impact** H · **Effort** M–L · **Type** gap.
- **Evidence:** there is no summary or outline component in `public-reading/` or `study/` (confirmed), and no curated discussions yet for Vayera. Chabad leads with a Nutshell and an Aliyah Summary; Sefaria with a summary and Notable Sources.
- **Recommendation:**
  - a "This portion" block atop Study: a short summary and a one-line outline per aliyah that jumps to it (decision 4 on who drafts it);
  - a right-hand insights column of rabbi-curated sources and "Think about it" questions beside the text, built on 1.8 M6 curated discussions and authored through MCP (decision 5);
  - "Show the halves" splits the English at the etnachta.

  Out of scope as filed: DP-04 (members collecting sources) and LD-21 (a d'var path built on member-starred commentary). Both are reframed here as rabbi-authored prompts. **Status:** 1.9.

**G10. Admin: "Needs you" and a finished setup path** (AD-03, AD-02, AD-05, AD-12; earlier R-08, R-09, R-21)
- **Who:** Daniel as admin; office staff. **Impact** H · **Effort** M · **Type** gap.
- **Evidence:**
  - Roster rows show name, date, days, kind and service only. Setup state exists only on People (confirmed).
  - "Your rabbi needs to choose a service time…" is shown to admins too, with no link (`exploration-api.ts:16`; confirmed).
  - After a date change, the save message does name the student (verifier correction), but no mark stays on the row.
  - Nothing flags a ceremony entered on a Sunday.
- **Recommendation:**
  - a "Needs you" strip for ceremonies within 8 weeks (no tutor, family not joined, invitation expired, no reading, reading needs review, service not set, honors not started);
  - status chips on each row;
  - an admin version of the slot message with an "Edit details" button;
  - three next-step links after "Add student";
  - a "Reading needs review" chip that can be cleared;
  - a "This is a Sunday. Is that right?" hint.

  **Status:** 1.9 (decision 11 wording).

**G11. When a tutor leaves, hand their students over** (AD-04)
- **Who:** admin. **Impact** H when it happens · **Effort** M · **Type** gap.
- **Evidence:** the removal consequence is generic, with no list of students and no reassign action; it takes about 8 actions per student. Confirmed.
- **Recommendation:**
  - "Teaches 3 students: …" under each tutor;
  - the removal review lists the students and offers "Move these students to: [tutor]".

**G12. Families waiting on aliyah divisions; the tutor is never told** (TP-05)
- **Who:** parents, tutors. **Impact** M–H · **Effort** M · **Type** gap.
- **Evidence:** the honors form shows "Waiting for the reading", and the tutor gets 403 on honors (correct by privacy), so no one tells the tutor. Confirmed.
- **Recommendation:** a status line on the tutor page, "Noa's family is waiting for aliyah divisions… Set divisions", with no honoree names. This passes the privacy check because it carries status only.

**G13. Invitations: expiry, email content, fallback and parent-intent requests** (TP-09 = AD-09, TP-06)
- **Who:** parents, office. **Impact** M · **Effort** M · **Type** improvement, wording.
- **Evidence:**
  - Links last 72 hours (`server/invitations/tokens.ts:5`), and the email never says so.
  - The email doesn't say who sent it or what it is for.
  - The office has no copy-link option.
  - A request like "follow my daughter's preparation" can only be approved as a plain member.
- **Recommendation:** decision 12, plus "Copy link", an "Expires tomorrow" flag and a "Needs a parent invitation" action.

**G14. Lein/Study speed until paging lands** (VA-02)
- **Who:** Daniel, students. **Impact** H · **Effort** M · **Type** performance.
- **Evidence:** longest click event in production at 4× CPU: Study 1,632 ms on the first switch and 736 ms after; Lein 696 ms. Confirmed. A response above 500 ms counts as poor.
- **Recommendation:**
  - `content-visibility:auto` with `contain-intrinsic-size` on off-screen verse groups;
  - `startTransition` on the lens and colour switches;
  - don't re-mount the passage on a lens change.

  The structural fix is G1's paging.

**G15. The /read hero and the Choose verses bar take the first screen** (DP-06 = F-SITE 13, F-SITE 26)
- **Who:** everyone on /read. **Impact** M · **Effort** M · **Type** redesign.
- **Evidence:** there are 10 controls before the Hebrew; the first verse starts below the fold even at 1280×900; the Choose verses bar is 134 px and sticky.
- **Recommendation:** REDESIGN mock 3:
  - a 2-line header, then Torah|Haftarah and Lein|Study, then aliyah chips;
  - everything else in a ⋯ sheet;
  - a one-row Choose verses bar.

**G16. Sign-in keeps your place** (DP-12, DP-13)
- **Who:** Daniel, adults, members. **Impact** M · **Effort** M · **Type** improvement; auth-adjacent, so it needs the adversarial pass.
- **Evidence:** the sign-in link from Save is a plain /sign-in (`saved/save-reading.tsx:33`). An admin lands on the roster, and the selection is lost. The /read sign-in card speaks only to students.
- **Recommendation:**
  - a validated, same-origin relative return address carried through sign-in, offering to save on return;
  - card wording (decision 11).

  The signed-out "Sign in to save" label is in 2.0 F4.

**G17. Study reference polish** (DP-05, HB-15 size part, DP-11, DP-19, DP-10 note)
- **Who:** Daniel. **Impact** M/L · **Effort** S · **Type** improvement.
- **Recommendation:**
  - an "English" tag on the "More on this verse" shelf, English-first order;
  - commentary Hebrew scales with the size control (now fixed at 1.1875rem, line-height 1);
  - a "Back to the reading" link on /print (2.0 F4 carries the selection);
  - Saturday's home leads with next Shabbat;
  - a reader note for a rare trope this week (for example shalshelet at 19:16). Its sound is L3.

**G18. Hebrew display improvements** (HB-03, HB-07 = VA-17, HB-09, HB-12, HB-13, HB-14, HB-16)
- **Who:** students, adults, Daniel. **Impact** M · **Effort** S–M · **Type** improvement.
- **Recommendation:**
  - **Ketiv and qere:** show the qere at full size and the ketiv small, with a "read" chip.
  - **Phrase colours:**
    - fix the colour pairs too close to tell apart (protan etnachta/pazer ΔE 0.8);
    - add a non-colour phrase-end cue;
    - add night phrase inks for dark mode.

    This connects to Godfroid et al. 2017: pitch contours beat colour. Keep the contour marks.
  - **Trope samples:** show the sign on a bare carrier at 56–64 px, so the sign isn't hidden under a qamats.
  - **Side-by-side tikkun:** stack it at Large and Huge on phones.
  - **Paragraph breaks:** show small ס/פ markers on screen.
  - **Language sides:** Hebrew on the right on screen as on paper.
  - **"Letters only" print:** use the already-approved Stam Ashkenaz face and drop the qere apparatus.

**G19. Drill feedback for a wrong answer** (ST-08, the rest after F6)
- **Who:** students. **Impact** M · **Effort** S · **Type** improvement, wording.
- **Evidence:** the wrongly chosen button gets the heavier outline, so it looks selected. The progress bar doesn't move while an item repeats.
- **Recommendation:** mark a wrong choice with ✕ and a muted fill; show "one more try" progress. The status line itself is F6.

**G20. Learner wording and small gaps** (ST-06, ST-09 learner line, ST-10, ST-17)
- **Impact** M/L · **Effort** S · **Type** wording.
- **Recommendation:**
  - hide "Ask for an account" from a signed-in student;
  - give the student a plain service-parts line (the panel itself is 2.0, see N1);
  - an adult version of the honors form ("Blessing from family", or "Not part of my service"), placed after the reading;
  - "Send a new code" after 60 s.

**G21. Admin polish** (AD-10 rest, AD-11, AD-13, AD-14, AD-17, AD-19)
- **Impact** M/L · **Effort** S–M.
- **Recommendation:**
  - **CSV import (AD-10):** an example row in the template; warn on the same name and date; import the ready rows; show bad rows as a table.
  - **Sheet update (AD-11):** a 20 s timeout and a clearer label.
  - **Settings (AD-13):** focus the first invalid field; hide "Roster sheet ID" for CRC; show whether email is on.
  - **Recording review (AD-14):** separate the empty state from the error state; move it under Settings.
  - **Labels (AD-17):** consider "Members" for Accounts.
  - **Danger styling (AD-19):** make it consistent.

**G22. Tutor polish** (TP-21)
- The Claude connections empty state should say how to connect. **Impact** L · **Effort** S · wording.

**G23. Wider word targets** (ST-18)
- 137 of 636 word targets are 26–43 px wide. They pass AA (24 px) but fall short of 44 px.
- Widen the hit area with padding or a pseudo-element, without moving the text. Do it with G2's sheet. **Impact** L · **Effort** S.

**G24. MCP for members** (DP-20)
- Open the link tools and owner-only saved tools to any member with saved readings, after a scope review. **Impact** L · **Effort** M · later. The reviewer tagged it 2.0, but it is not service-course work.

### 2.4 Redesign direction (summary of `S/visual/REDESIGN.md`)

**Diagnosis.** The problem is length, not looks:
- the student page is 22,470 px, /read 21,420 px and Study 69,571 px;
- the "Song session" world (lake, marigold, Bricolage, the lake toolbar) is liked but only half applied: 5 h1 sizes, 25 button looks and 3 header types (VA-16);
- phones hide what doesn't fit instead of rearranging it.

The basics (contrast, reflow, auth, skip links, live regions, reduced motion) are strong. So the redesign keeps the look locked on 2026-10-16 (seed 8ac4194f) and changes the structure.

**Proposals:**
1. **Bottom tab bar for signed-in roles**, four tabs at most:
   - Student: Today · Reading · Learn · Account;
   - Parent: Today · Practice · Honors · Account;
   - Tutor: This week · Students · Lessons · More;
   - Rabbi/admin: This week · Students · People · More.

   Public /read, /learn, /trope-chart and /print have no tab bar. On a laptop, a left rail.
2. **Student Today** fits in about 1.5 screens:
   - a lake field with the parashah and the countdown;
   - one Next card with one button ("Practice verses 3–5");
   - practice days as quiet dots (no streak);
   - reading sections with their state, shown as a dot plus a word;
   - the last lesson note.
3. **Reading, one section at a time.** Paged by aliyah or by the tutor's sections, with continuous flow inside each section. A sticky compact bar holds the reference, Torah|Haftarah and the section chips (Service parts is the last chip). A tool dock (Colors · English · Size · Hear) sits in the thumb zone. One bottom sheet serves every detail. The lifted line stays as it is.
4. **Public /read:** a 2-line header, the aliyah chips and a ⋯ sheet. The Hebrew starts at y≈300 px.
5. **Tutor and rabbi This week:** a "Needs you" list of one-verb tasks; students sorted by date; three remembered views per student; the student's name as h1.
6. **System:**
   - six type steps (body 17 px) and three weights (400/600/750);
   - one Button with three variants;
   - grouped list rows for staff;
   - one Sheet, one header and one empty-state pattern;
   - one focus ring;
   - night phrase inks and forced-colours rules;
   - no shadows, gradients, mascots or confetti. The one celebration stays the ink pull.

**Sequencing:** the defects in 1.8.2 (section 2.2); the structure in 1.9 (paged Reading, Today, tab bar); the token pass across staff screens; then measure again (CLS below 0.1, INP below 200 ms, axe clean).

**Decisions it needs:** the tab bar (decision 1); paging, which amends the Passage First Rule (decision 2); the tool dock at the bottom and the type scale (decision 3); its draft wording (decision 11).

### 2.5 Rulings the review argues to change (evidence as corrected by the verifier)

**RC1. "No recording of the learner" (1.5 ruling 3): argued to soften (LD-06)**
- **Evidence:**
  - Hewitt 2001 (*JRME* 49(4)) found **no effect of self-listening alone**. Gains came from hearing a model, and from a model plus self-evaluation.
  - The "d=0.99" for feedback (Wisniewski et al. 2020) applies only to high-information feedback. The overall effect is 0.48. The research REPORT misstates this too.
  - The benchmarks show recording is the standard leyning-app loop (Tikun Korim, Virtual Tikkun).
- **Corrected case:** "record, then hear the reader and yourself, and rate it yourself". Done on the device, nothing saved or sent, no score.
- **It depends on a reference recording**, which students don't have until 2.5 and the G3 gate. Decision 6. It needs an adversarial privacy pass because of microphone capture.

**RC2. Tutors see Learn progress (LD-10)**
- Today, progress is visible to the student only.
- **Proposal:** the assigned tutor sees the existing "Can hear: 6 of 10 Torah phrases" line plus the most-confused pair. The student is told.
- **Evidence:** formative assessment in principle (Black & Wiliam 1998). Don't quote effect sizes. Decision 7.

**RC3. "Nothing finer than days practised" (ruling 45) for tutors and parents (TP-02, TP-03 counts, TP-23)**
- "Dates only" is deliberate (`practice-calendar/api.ts:5`).
- **Proposal:**
  - tutors see per day which reading or part was opened and which marks changed (no durations, no scores);
  - parents see mark counts;
  - marks record whether they were made with a parent.
- **Precedent:** the 2.0 Batch 3 Q12 ruling widened ruling 45 for the per-part finished mark. Decision 7.

**RC4. Wording, not reversal: claims that match what the student did (LD-03, LD-09)**
- The celebration comes only after an unaided attempt.
- Got it and Solid get criteria.
- Decision 11.

**RC5. Disabling a student is permanent and the only way to clear the list (AD-07)**
- This works against goal 3 (prepare a new reading years later).
- **Proposal:** a "Ceremony done" state. Decision 13.

**RC6. Design-rule amendments from the redesign**
- The Passage First Rule: flow within a section, not the whole assignment.
- DESIGN.md's phone toolbar position.
- Body size from 16 to 17 px.
- Decisions 2 and 3.

**RC7. Upheld: no streaks, no daily goal, no score, the tone rules (LD-23)**
- Breaking a streak lowers engagement (Silverman & Barasch 2023).
- Gamification's non-cognitive effects are unstable (Sailer & Homner 2020).
- Expected tangible rewards undermine motivation (Deci, Koestner & Ryan 1999).
- G3's if-then plan and the "Review: n phrases" line give the benefit of a goal without a streak. **No change recommended.**

**Not argued (out of scope by your 2026-10-24 ruling):** DP-04 (members collecting sources) and LD-21 as written. Both are reframed as rabbi-curated material in G9.

### 2.6 The 2.5 listening list (where audio is missing or belongs; no quality judgments)

| Entry | Where sound is missing | IDs |
|---|---|---|
| L1 | **The student's own reading:** phrase playback with Repeat and Speed; a Hear phrase/verse button in Practice up close's thumb row; "Hear this word" in the word card; follow-along after Start reading. **Parent child practice:** per-phrase "Hear it" so a parent who doesn't chant can check. **Tutor:** "play for student" on Zoom. Optional "Try first" holds the audio back. | LD-08, ST-L1, TP-25 |
| L2 | **Learn can't start without its recordings.** The lessons, review and Quick ten stop at "The recording did not load". Let lessons open text-first and disable only the hearing drills. The wrong-message part (a text or 429 error shown as an audio error) is in 2.0 F1. | ST-L2, F-SITE 1 (part) |
| L3 | **The trope chart and rare trope are silent.** Add a play tile per family on the chart (the trope song lives there once recorded). This week's rare trope (shalshelet, 19:16) has no sound. | DP-10, LD-17 (2.5 part) |
| L4 | **"Hear yourself" needs a reference to compare against** (RC1). | LD-06 |
| L5 | **The Recording review tab** is a primary admin tab for a review staff can't use yet. Separate its empty state from its error state; move it under Settings. | AD-14 |
| L6 | **Expected by users:** a choice of melody tradition and voice (Benchmarks #19), and Quick ten's autoplay on iPhone Safari (F-SITE 23, check). | Benchmarks, F-SITE 23 |

### 2.7 2.0 notes (for Cowork's lane)

**Which review findings each F-milestone absorbs:**

| 2.0 milestone | F-SITE | Our findings it closes | Note |
|---|---|---|---|
| F1 rate limit | 1 | ST-L2 (message part) | Verifier: no app-level limiter on `/api/public/*`, so the 429 likely comes from the platform firewall. Check it. |
| F2 dark mode | 2, 4 | VA-06, VA-07 (+ the dark focus ring of VA-05) | Coordinate with D5 (light-mode ring). Take into 1.8.2 if F2 hasn't started. |
| F3 account request | 3 | mirror of ST-06 | G20 handles the opposite case (signed-in student shown the form). |
| F4 Choose verses and print | 5, 9 | DP-11 (carry selection), DP-12 (signed-out Save) | New: the range logic. |
| F5 word card and screen readers | 6, 7, 18, 24 | ST-02/DP-02 (full sheet beyond 1.8.1), VA-09, HB-05 (word label), VA-14 (verse numbers), VA-15, DP-16 (tab stops) | Rebase on 1.8.1 (X1). |
| F6 polish | 10, 11, 12, 14, 15, 17, 19, 20, 21, 22, 23, 25, 27 | DP-09, ST-07 (sign-in link), ST-08 (live region), VA-12 (Quick ten title), VA-16 (sign-in label drift) | Drop what 1.8.1 already does: F-SITE 17 (X4), most of 14 (X3), the gloss in 15 (X5). |
| not in F1–F6 | 8, 13, 16, 26 | F-SITE 13 focus → D10; 13 and 26 layout → G15; 16 → decision 9; 8 → decision 15 | |

**Notes:**
- **N1.** The Service parts panel speaks in system language to students, parents and tutors ("queued… daily fallback… roster", an overlay-operator note), and folds the assigned parts under "Additional practice" (ST-09, TP-10, TP-14 part, ST-N1). The service course should own a phone-first parts view with the same today/next framing as G3. Show the assigned parts first. The operator note is for admins only.
- **N2.** Honors and service parts both depend on the service slot, which is easy to leave unset (AD-02, G10). The course should say where its settings and per-student progress appear for admins.
- **N3.** Blessings and aliyah choreography belong in the service course. Learn's end-of-aliyah sentence links there once it exists (LD-22).
- **N4.** Before the service course reuses Learn's frame:
  - fix the path's locked state (F6);
  - make text failures distinct from recording failures (F1);
  - give it a text-first path (L2), since the course has text and no recordings.
- **N5.** Don't let the course copy "Can hear: n of 10" as "prayers mastered" (F-SITE tone note).
- **N6.** D'var: the 2.0 DV milestones track stages in the shared Google Doc. Rabbi-authored d'var prompts belong in curated discussions (G9), not in the Doc (LD-21 reframed).

---

## 3. Decisions for Daniel

Recommendation first. Each one is a popup.

**1. Restructure signed-in screens around a bottom tab bar and a "Today" screen?**
- **(a) Yes (recommended):** student Today · Reading · Learn · Account, and the other roles as in §2.4. It fixes the hidden admin tabs, the scrolled-away toolbar, the 20,000 px jump links and the tab that is forgotten on reload, all at once.
- (b) Keep the single scroll, and give learners and parents the staff tabs plus a sticky sub-bar.
- (c) Not now.

**2. Page the reading by aliyah (or by the tutor's sections), with flow inside each section?**
- **(a) Yes (recommended):** aliyot in both lenses and an aliyah picker in the reader. It amends the Passage First Rule. It is the change that replaces Chabad's selector, cuts the DOM and the tab stops by about 7, and fixes the slow lens switch.
- (b) Aliyah labels and picker only, keeping the 100-verse pages.
- (c) Page by chapter.

**3. Adopt the visual system: tool dock at the bottom thumb zone, six type steps with 17 px body, one Button?**
- **(a) Yes (recommended):** it keeps the Song session look. It amends DESIGN.md's phone toolbar rule.
- (b) The type and button pass only; keep the toolbar above the passage.
- (c) No.

**4. A portion summary and an aliyah-by-aliyah outline atop Study: who writes it?**
- **(a) Claude drafts each week through MCP, and you approve before anything shows (recommended).** Credit follows your 2.0 precedent (Batch 2 Q9): "Rabbi Daniel Bogard" once approved. Nothing unapproved is shown.
- (b) The same, with a credit line naming both: "Summary drafted by Claude, reviewed by Rabbi Daniel Bogard".
- (c) You write them.
- (d) No summary; link out to Chabad or Sefaria.

**5. A curated insights column beside the text, modelled on Chabad's Torah in depth right-hand column?**
- **(a) Yes (recommended):** rabbi-curated sources plus one "Think about it" question per theme for students, built on the 1.8 M6 curated discussions and authored through MCP. It is the companion's answer to "gather sources for a d'var". Members still collect nothing.
- (b) Questions only, no sources column.
- (c) No.

**6. "Hear yourself": reverse the no-recording ruling?**
- **(a) Not now; revisit with 2.5 listening (recommended).** The corrected evidence supports only "hear the reader, then yourself, then rate it yourself", and students have no released reference recording until the G3 gate. Designed then: on the device only, at most 10 s, nothing saved or sent, no score.
- (b) Yes, design it now and ship it with 2.5.
- (c) Keep the ban.

**7. What may tutors and parents see of a student's practice?**
- **(a) Recommended:**
  - the assigned tutor sees a per-day line (what was opened, which marks changed);
  - the tutor sees the Learn "Can hear" line and the most-confused pair;
  - parents see mark counts;
  - marks show whether they were made with a parent;
  - the student is told what the tutor sees.

  No durations or scores. Adversarial privacy review before release.
- (b) The tutor sees the Learn summary only; dates stay dates-only.
- (c) No change (ruling 45 stands).

**8. Google sign-in script on the front door: it loads for every signed-out visitor, about 216 KB including a tracking beacon, on a site children use.**
- **(a) Load Google's script only when someone opens sign-in, using our own "Continue with Google" button on the existing redirect path (recommended).** It removes third-party code and the beacon from the front door, speeds the slowest page and cuts 3 unstyled tab stops.
- (b) Move Google sign-in to /sign-in only.
- (c) Keep it as is.

**9. Rashi's English (licence question): the 1929 translation sits beside JPS 2023.**
- **(a) Keep it, and state the translation and its date in the credit (recommended for now).** No new licence.
- (b) Ask about a modern Rashi English that can be licensed. This may cost money; stop-and-ask.
- (c) Hebrew Rashi only.

**10. The qamats qatan can't be seen (font licence question).**
- **(a) Add a word-card note ("This vowel says o (qamats katan).") now, and evaluate Taamey Frank CLM (Culmus, GPL with font exception, the same family as the approved Stam Ashkenaz CLM) as a licence decision (recommended).**
- (b) Note only.
- (c) Adopt the font now.

**11. Approve the new wording drafts as a batch?** This is copy with no precedent:
- "Rehearsal today" / "Next rehearsal: …";
- the "Your turn" step and the moved celebration;
- Got it / Solid criteria;
- the "Before next time" field;
- the parent wording table (TP-14);
- the learner service-parts line;
- the adult honors label;
- the admin service-slot line and "Next: choose a tutor, invite a parent, assign the reading";
- the /read sign-in card;
- "Start where you left off" and "Need help?" (redesign);
- the print link labels.

Options:
- **(a) Keep all, as Cowork's F lines were (recommended).**
- (b) Review them one by one.
- (c) Decline them.

**12. Family invitations: lifetime and email content.**
- **(a) Recommended:**
  - 7 days for parent invitations;
  - the email names the congregation, the role and the expiry;
  - no child's name in the email;
  - add "Copy link" for the office.
- (b) The same, with the child's first name in the email.
- (c) Keep 72 hours and the current email.

**13. A "Ceremony done" state instead of permanent disabling?**
- **(a) Yes (recommended):** it keeps Learn/Study sign-in for goal 3 and hides the student from the active roster. Disable stays for mistakes, now saying "This can't be undone here".
- (b) Add only "Turn access back on".
- (c) Only the warning.

**14. Install and offline point to torah.centralreform.org, which doesn't resolve.**
- **(a) Move install and offline to the live beitmitzvah domain, and pack the learner's assigned reading (recommended).**
- (b) Set up the torah domain. Check for a new service or cost first.
- (c) Drop install for now. 1.8.2 makes /offline say something either way (D20).

**15. Holiday readings use the traditional two-day diaspora list (F-SITE 8).**
- **(a) Label the list "traditional calendar" now, and decide CRC's festival readings with ROADMAP Q13 in 2.5 (recommended).**
- (b) Hide second-day readings now.
- (c) Leave it.

---

## 4. Status of the 2026-10-20 external review (R-01…R-22), from code at origin/main

| ID | Finding | Status | Evidence now |
|---|---|---|---|
| R-01 | Google sign-in origin error | **Fixed in code** (9b04629, auth review) | This review saw no origin error. Real Google-account phone acceptance is still open. The script's privacy and performance cost is new (decision 8). |
| R-02 | Audio promised but not released | **Fixed** | "Listening isn't available yet."; Start reading only scrolls. The missing sound is now L1. |
| R-03 | Practice up close hidden | **Fixed** | It is a hero action. Its clipping on small phones is X2 (1.8.1). |
| R-04 | English detached from the Hebrew | **Fixed** | Optional English under each verse (`annotations.tsx:138, 204`). |
| R-05 | Haftarah demoted | **Fixed** | The hero shows Torah and Haftarah equally (line breaks: D11). |
| R-06 | Endless scroll, no summary | **Open (partly fixed)** | A parent summary was added; the 22,000 px page remains (G2, G8). |
| R-07 | Signed-in landing demotes the task | **Partly fixed** | Students auto-continue; X7 and X8 (1.8.1) close the rest. |
| R-08 | Admin can't see what's left | **Partly fixed** | Student invitations now refuse a parent's address. Order: X9 (1.8.1). Status: G10. |
| R-09 | Service-slot message to the wrong person | **Open** | G10 (AD-02, confirmed). |
| R-10 | Progress recorded, never summarised | **Partly fixed** | Parents see lessons and days; marks still aren't summarised (G7, G8). |
| R-11 | Honors review and blessing-link steps mislead | **Mostly fixed** | The review now lists the groups whose spans changed (`honors/sheet.tsx`). The was/now line still prints when the values are equal, and "Create blessing link" still waits on "Check link" with no hint (`honoree-controls.tsx:15–16`). Not re-walked. |
| R-12 | Two product names | **Fixed** | One name, "CRC Torah". No "B'nei Mitzvah" or "CRC Beit Mitzvah" left in `src`. |
| R-13 | Slow first load of a portion | **Partly fixed** | Public text is CDN-cached (`public-reading.ts` s-maxage). First-load speed was not re-measured. New: 429s while browsing (F1). |
| R-14 | Desktop wastes the screen | **Partly fixed** | From 1001 px, Study has a side column and the word card sits beside the text. A laptop rail is in the redesign. |
| R-15 | Adult on a special-reading date hits a dead end | **Open** | Still "Your rabbi will help choose the verses." with no contact (`exploration-api.ts:20`). The adult honors text still says "send the names to the congregation office" with no address. Not re-walked. |
| R-16 | No links to CRC's own resources | **Partly fixed** | CRC preparation guide (`reading.tsx:363`), siddur page and blessings links. CRC Music is not linked for students (deferred). Blessings-link issues are in F6. |
| R-17 | Copy defects | **Partly fixed** | The verse-count separator is fixed. Code points: X3 (1.8.1). "Portal member" remains as the fallback for nameless accounts (`lesson-log.ts:19`); the sandbox showed real tutor names. |
| R-18 | Review below the fold, no focus move | **Fixed** (reading editor, invitations) | Focus moves to the review heading (`reading-editor.tsx:98`, `invitations/workspace.tsx:104`). Service parts not checked. |
| R-19 | Print is a raw browser print | **Superseded** | /print and the practice sheet are preview pages. Only the admin "Print saved version N" for honors still prints directly (low). |
| R-20 | Sources are Sefaria's raw catalogue | **Superseded** | The companion ruling and the 1.8 curated discussions. Empty per-verse Sources remain (G2). |
| R-21 | No attention cues for tutors or admins | **Open** | G10, G11, G7. |
| R-22 | Every server failure becomes a generic 503 | **Open, by design** | `server/http/dispatch.ts:106`. Low; not revisited. |

Totals: 7 fixed or superseded (R-02, R-03, R-04, R-05, R-12, R-19, R-20), 1 fixed in code awaiting real-device acceptance (R-01), 1 fixed in the paths checked (R-18), 9 partly fixed, 4 open.

---

## 5. Appendix

### 5.1 Finding index (every ID → merged entry)

Status shorthand: **1.8.1** = PR #71; **#72** = AD-01 PR; **F1–F6** = 2.0 plan fixes lane; **D** = 1.8.2; **G** = 1.9; **L** = 2.5 list; **N** = 2.0 note; **Dec** = decision; **RC** = ruling challenge.

- **Daniel's prep (DP):**
  - DP-01 G1 · DP-02 X1 · DP-03 G9, Dec 4 · DP-04 G9 (out of scope as filed) · DP-05 G17
  - DP-06 G15 · DP-07 X4 · DP-08 X3 · DP-09 F6, G4 · DP-10 L3, G17
  - DP-11 G17, F4 · DP-12 G16, F4 · DP-13 G16, Dec 11 · DP-14 G1 · DP-15 Dec 9
  - DP-16 G1 · DP-17 D19 · DP-18 X5 · DP-19 G17 · DP-20 G24
- **Learning design (LD):**
  - LD-01 G5 (verifier: improvement, not a defect) · LD-02 G5 · LD-03 G5, RC4 · LD-04 X6 · LD-05 G4
  - LD-06 RC1, L4, Dec 6 · LD-07 G6 · LD-08 L1 · LD-09 G6, RC4 · LD-10 RC2, Dec 7
  - LD-11 G3 · LD-12 G6 · LD-13 G6 · LD-14 G9 · LD-15 G9
  - LD-16 G4 · LD-17 X3, D23, L3 · LD-18 G5 · LD-19 G5 · LD-20 G5
  - LD-21 G9 (reframed; out of scope as written) · LD-22 N3 · LD-23 RC7
- **Student (ST):**
  - ST-01 G2 · ST-02 X1 · ST-03 G3 · ST-04 X2 · ST-05 G2
  - ST-06 G20, F3 (mirror) · ST-07 G4, F6 · ST-08 G19, F6 · ST-09 N1, G20 · ST-10 G20
  - ST-11 D11 · ST-12 G3 · ST-13 D10, G2 · ST-14 G2 · ST-15 G2
  - ST-16 D20, Dec 14 · ST-17 G20 · ST-18 G23 · ST-L1 L1 · ST-L2 L2, F1 · ST-N1 N1
- **Tutors and parents (TP):**
  - TP-01 G7 · TP-02 RC3, Dec 7 · TP-03 G8, G3, Dec 7 · TP-04 G2 · TP-05 G12
  - TP-06 G13 · TP-07 X7 · TP-08 X8 · TP-09 G13, Dec 12 · TP-10 N1
  - TP-11 X9, G7 · TP-12 G7 · TP-13 G2 · TP-14 G8, Dec 11 · TP-15 G8
  - TP-16 G8 · TP-17 X10 · TP-18 X11 · TP-19 X12 · TP-20 G7
  - TP-21 G22 · TP-22 G3 · TP-23 G7, RC3 · TP-24 G7 · TP-25 L1
- **Admin (AD):**
  - AD-01 X13 (#72; downgraded to latent) · AD-02 G10 · AD-03 G10 · AD-04 G11 · AD-05 G10 (reworded)
  - AD-06 X9 · AD-07 RC5, Dec 13 · AD-08 D21 · AD-09 G13 · AD-10 D22, G21
  - AD-11 G21 · AD-12 G10 · AD-13 G21 · AD-14 L5, G21 · AD-15 X10
  - AD-16 X7 · AD-17 G21 · AD-18 G2 · AD-19 G21
- **Hebrew (HB):**
  - HB-01 D2 · HB-02 D1 · HB-03 G18 · HB-04 D7 · HB-05 D8 (language), F5 (word label)
  - HB-06 D8 · HB-07 G18 · HB-08 Dec 10 · HB-09 G18 · HB-10 D9
  - HB-11 D17 · HB-12 G18 · HB-13 G18 · HB-14 G18 · HB-15 D18 (language and face), G17 (size)
  - HB-16 G18
- **Visual and accessibility (VA):**
  - VA-01 D3 · VA-02 G14, G1 · VA-03 D24 · VA-04 Dec 8 · VA-05 D5 (+F2 dark ring)
  - VA-06 F2 · VA-07 F2 · VA-08 D6 · VA-09 F5, D16 · VA-10 D4
  - VA-11 D12 · VA-12 D13, F6 · VA-13 D14 · VA-14 F5, D15 · VA-15 F5, G1
  - VA-16 §2.4 redesign, Dec 3 · VA-17 G18
- **Cowork's F-SITE review:**
  - 1 F1, L2 · 2 F2 · 3 F3 · 4 F2 · 5 F4 · 6 F5, X1 · 7 F5
  - 8 Dec 15 · 9 F4 · 10 F6 · 11 F6 · 12 F6 · 13 D10, G15 · 14 X3, F6
  - 15 X5, F6 · 16 Dec 9 · 17 X4 · 18 F5 · 19 F6 · 20 F6 · 21 F6, X3
  - 22 F6 · 23 F6 · 24 F5 · 25 F6 · 26 G15 · 27 F6

### 5.2 Method

- **Lenses.** Seven lenses with their own agents:
  - benchmarks;
  - Daniel's Shabbat prep;
  - learning design;
  - student on a phone;
  - tutors and parents;
  - admins and staff;
  - Hebrew text;

  plus visual and accessibility, run as a third wave.
- **Where the screens came from.** Signed-in screens came from a local sandbox with made-up example.test data. Production was checked signed out only. Phones were emulated: a Pixel 7 at 412 px, an iPhone SE at 375 px and 320 px reflow; laptops at 1366–1440 px.
- **Tools.**
  - axe-core and Lighthouse were installed into the scratchpad only.
  - Layout shift and responsiveness were measured in production with 4× CPU throttling.
  - Hebrew was checked by measuring per-character line boxes, with a colour-blindness simulation (CIEDE2000), and in print via page PDFs.
- **The verifier** re-checked every critical or high finding, every defect-now finding and 6 random medium findings against the code at 0bfed42, the sandbox and production:
  - 61 confirmed;
  - 6 partly confirmed (LD-01, LD-06, ST-16, AD-01, AD-05, HB-15);
  - 0 not reproduced;
  - 5 out of scope (DP-04, LD-08, LD-21, ST-L1, TP-25: the last three moved to the 2.5 list);
  - 1 not re-tested (DP-17).

  Every citation tagged [K] was checked. Hewitt 2001 and Wisniewski 2020 were misread or overstated, and are corrected above. Cowork's F-SITE review was mapped: 10 new, 6 partly new and 11 duplicates.
- **The earlier review.** R-01…R-22 statuses come from grepping origin/main (af7c773, which equals 0bfed42 plus docs) and from the product reconciliation note of 2026-10-20.

### 5.3 Limits

- No real screen-reader run (NVDA or VoiceOver). VA-09 should be verified by ear.
- No iOS Safari rendering. Install and autoplay behaviour need a real device.
- No audio was heard. Learn lessons were walked in production because the sandbox has no reference recordings. Nothing here judges audio quality.
- Lighthouse and layout-shift figures are for signed-out production pages only. Signed-in performance is unmeasured.
- The sandbox was shared between reviewers, so some data on screen came from other reviewers (noted in their files).
- Benchmarks come from public page fetches. Chabad on a phone, Sefaria's reader UI and current TropeTrainer features are unverified.
- ST-13's focus part, HB-15's language and face part, DP-17, ST-16's offline-pack claim and R-11 and R-15 were not re-walked.
- Effort sizes are relative estimates, not schedules.

---

## 6. Daniel's decisions (2026-10-24 popups, binding)

1. **Tab bar and Today:** "Yes, tab bar + Today". Bottom tab bar for signed-in roles; student Today · Reading · Learn · Account; a Today screen with one next step.
2. **Aliyot:** "Page by aliyah". Aliyah 1–7, Maftir and triennial in Lein and Study with a picker; one aliyah per page. Amends the Passage First Rule.
3. **Visual system:** "Yes, full system". Six type steps, 17 px body, one Button, the reading tools docked at the bottom. Keeps the Song session colours and fonts. Amends DESIGN.md's phone toolbar rule.
4. **Portion summary:** "Claude drafts, you approve". Claude drafts through MCP; nothing shows until Daniel approves; credit "Rabbi Daniel Bogard" once approved.
5. **Curated insights column:** "Sources only". Rabbi-curated sources beside the verses (Chabad Torah in depth right-hand column), built on the 1.8 curated discussions. No "Think about it" questions. Members collect nothing.
6. **Hear yourself:** "Revisit with 2.5". The no-recording ruling stands until the 2.5 listening work.
7. **Practice visibility:** "Wider view". The assigned tutor sees which verses were practised each day and which marks changed, plus Learn's "Can hear" line and the most-confused pair; parents see counts only; the student is told what the tutor sees; no durations or scores. Adversarial privacy review before release. Widens ruling 45.
8. **Google sign-in script:** "Load only on sign-in". Our own "Continue with Google" button; Google's code loads only when chosen.
9. **Rashi English:** Daniel verbatim: "Keep the current one, but let's see if there is a modern one that is available with a license that works for us". Keep the 1929 translation, named with its date in the credit; research a modern Rashi English with a workable licence and bring it back as a licence question.
10. **Qamats qatan:** "Note now + adopt font". Word-card note "This vowel says o (qamats katan)." and switch the reading text to Taamey Frank CLM (Culmus, GPL with font exception).
11. **New wording batch (section 3, item 11):** "Keep all".
12. **Invitations:** "7 days, clearer email". Parent invitations last 7 days; the email names the congregation, the role and the expiry, never the child; staff get "Copy link".
13. **After the ceremony:** "'Ceremony done' state". The student keeps Learn and Study sign-in and leaves the active roster; Disable stays for mistakes and warns "This can't be undone here".
14. **Install and offline:** "Work on both". torah.centralreform.org stays the intended main address; install and offline also work on beitmitzvah.centralreform.org now; the student's assigned reading is saved for offline.
15. **Holiday readings:** Daniel verbatim: "We observe 2 days". The two-day list is correct for CRC; F-SITE-REVIEW finding 8 is closed with no change.
