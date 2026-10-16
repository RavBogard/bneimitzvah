# UX analysis and redesign recommendation — CRC Beit Mitzvah portal

Filed 2026-10-16 by Claude Code (Fable 5.1) at Daniel's request: "the site is not fun to use, it is not beautiful, things are cumbersome and not intuitive... it feels more like airport software." Method: Impeccable `critique` with two isolated assessments (A: design review over 20 real captures and the UI source; B: mechanical detector, production-build browser evidence on the public routes, static checks), plus the frontend-design and ui-ux-pro-max skills for the recommendation. Nothing in the app was changed.

## Decided here (Daniel, 2026-10-16, structured answers)

- References: **Duolingo-style warmth** (encouraging, one clear next step, a little celebration) and **Apple-native calm** (big friendly type, soft grouped surfaces, obvious taps). Not Notion/Linear density, not Headspace illustration.
- Appetite: **full redesign allowed.** "Annotated score" may be replaced as the visual world. Product truth, MISSION rulings, security model and Hebrew typography are preserved.
- Priority users for this pass: **student on a phone, tutor during a Zoom lesson, rabbi/admin.** Parent dashboard is secondary.
- Pain is everywhere: sign-in/landing, reading/study page, reading editor/preview, admin roster/access.

After the critique (same day, structured answers):

- **Next step: run the direction roll now** for the student surface, rather than quick wins first or waiting for the service-learning slice.
- **Students see zero status and zero provenance on the page.** No review state, revision, edition or licence lines; one "About this text" sheet holds sources. This resolves open item 2 of section 12.
- **Phrase colors are on by default for child students and the choice is remembered per student**; "plain Torah" is the opt-out. Resolves open item 3.
- **Before G3, the student toolbar shows a disabled "Hear" with an honest label** ("Hear · coming soon") so the layout is final and the gap is named. Resolves open item 4. MISSION 16's empty-slot rule is unchanged: no audio plays.

Direction round (Impeccable concept-seed, key `8ac4194f`, scope direction, mode operate, 2026-10-16):

- The roll assigned candidate 3 of the grounded list in section 10.1: **NFTY / camp song-session visual culture**, presented as the direction "Song session". Six catalog challengers were dealt (timetable slide rack, boarding pass and gate board, airport yellow wayfinding, centre-rail reference setting, Emigre bitmap specimen, variable-font specimen); all six were declined on both axes and each donated one discipline as a named raise. Impeccable's pick (yad and scroll column) and the standing exit (category standard) were offered. **Daniel locked Song session.** The decision page was substituted by structured questions because localhost is unreachable from his phone under remote control; build path is code-led (recorded default, no image generation).
- Daniel added a pinned audience line: **"these are kids used to Google Classroom and TikTok and Instagram and Snapchat."** The student surface's density and gestures follow those screen traditions (one lifted verse per screen with vertical swipe, bottom tab bar, big filled buttons, "Tonight" framed like an assignment that is due). The world still lends only type, palette, density and the signature move; controls stay standard.
- The direction contract is recorded in `.impeccable/surfaces/src-app-workspace-page-tsx.md`. DESIGN.md is rewritten at finish by the documenter, from the built world, not before.

## 1. Verdict in one paragraph

The engineering is sound and the design system is the problem. Lighthouse accessibility is 100 on the public routes, contrast passes everywhere measured, touch targets are 44–48px, focus rings and live regions are real, and the Hebrew (locally pinned Noto Serif Hebrew at 2rem, line-height 2) renders cleanly on a 390px phone. But the visual world was authored for a sign-in page ("Annotated score": white field, 1px grey rules, one type size, no surfaces, no icons, no state color) and then stretched over a practice app, an editor and an admin console without ever gaining the vocabulary those need. On top of that, almost every sentence is written from the server's point of view ("acknowledged", "rechecks", "no automatic retry will occur", "is not implied"). The result reads as a records system. A twelve-year-old gets a document, not a session: no next step, no progress, no end moment, and red "Needs review … · Revision 1" at the top of her Torah.

Design health (Nielsen, whole app): **16/40 — Poor.** Technical audit: **13/20 — Acceptable.** The gap between those two numbers is the diagnosis.

## 2. Heuristic scores

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Status exists everywhere but as sentences ("Verses 1–3 of 3. The selected English edition is missing for some verses."), never as the student's own state (what's next, what's done). Admin acknowledgements read like audit logs. |
| 2 | Match system / real world | 1 | Student sees "Revision 1", "ketiv/qere", "setumah", "JPS2023", "Controlled workspace changes", "route change". Admin sees UUID "Role identifier". ISO dates everywhere. |
| 3 | User control and freedom | 2 | No undo; prevent-and-warn instead (three-way departure modal, "Reload catalog and discard draft"). Phrase colors reset per verse and per page. "Refresh" buttons are a user responsibility. |
| 4 | Consistency and standards | 2 | Internally consistent; against platform conventions weak: `<select>` to pick a child/student, "Previous text page / Next text page" on a phone, role nav styled as a breadcrumb but behaving as tabs. |
| 5 | Error prevention | 3 | Strong server-side and in review ceremonies, but the ceremony is applied uniformly to tiny acts (choosing a tutor → separate review screen with a UUID). |
| 6 | Recognition rather than recall | 1 | Every verse has identical collapsed "Reading aids" / "Translation & notes" rows; roster rows show no tutor, reading or invitation state; admin areas reachable only by inline text links. |
| 7 | Flexibility and efficiency | 1 | No per-student URL (tutor cannot paste into Zoom), no "where I left off", no sticky tools, 100-verse paging surfaced as UI. |
| 8 | Aesthetic and minimalist design | 1 | ~120 words of provenance/transaction copy per student screen; one type size; grey rules as the only structure; no surfaces, no icons (zero SVGs in `src/`), no state color. |
| 9 | Error recovery | 2 | Honest but written for an auditor: "Text access changed. No previous text is being shown. Confirmed references and the reading review form remain separate." |
| 10 | Help and documentation | 1 | Help is permanent and inline (45-word tab-loss warning, ketiv/qere explanation on every qere verse) instead of on demand; no first-run, no "how to practice". |
| **Total** | | **16/40** | **Poor** |

Student surfaces score lower than admin on 2, 6, 8, 10 because the same vocabulary is served unchanged to a child.

## 3. Technical audit (Assessment B)

| Dimension | Score | Finding |
|---|---|---|
| Accessibility | 3 | Lighthouse a11y 100 on `/` and `/sign-in`; 0 contrast failures across 134 measured text elements; `:focus-visible` 3px teal; skip links; `bdi`/`dir=auto`; `<dialog>` with focus restore. Gaps: 4 inline links under 44px (brand, "Return to workspace", licence links); inline `[closed paragraph]` and `[read / qere:]` switch `lang` mid-verse; no text-size control (a PRODUCT.md requirement). |
| Performance | 3 | No images, one 160ms transition, no animation, tiny pages. Not measured under load; paging exists for server convenience. |
| Responsive | 3 | No horizontal overflow at 390px; 48px controls; grids collapse at 640/900/1000px. But desktop idioms on phone (pagination buttons, `<select>` pickers) and pages up to 18,879px tall. |
| Theming | 2 | 12 tokens at `:root`, light only (`color-scheme: light`, no `prefers-color-scheme`). Shipped CSS uses 13 font sizes (13/14/15/16/18/24/30/32/36/40/48px, not a ratio scale) and 13 color literals against a DESIGN.md that documents 3 sizes and 8 colors. Burgundy is link, primary button, error and "needs review" at once; teal is focus, confirmed role, aliyah marker and notice. No success/progress/attention colors. |
| Implementation integrity | 2 | Detector: 27 advisory findings, 25 `design-system-font-size`, 2 `design-system-color`, no component-level findings. The code is coherent; it is coherent with an entry-page system that cannot express an app. Zero icons, zero shadows, two radius values (6px). |
| **Total** | **13/20** | **Acceptable** |

Browser evidence limits: signed-in surfaces could not be rendered (no providers locally); all workspace evidence is from the 20 synthetic captures in `.impeccable/review/` and source. Public captures and Lighthouse reports: `.local-logs/ux-analysis-captures/`. Detector JSON: `.local-logs/ux-analysis-detector.json`.

## 4. Design specificity verdict

**It could be any internal records tool.** Strip the Hebrew from the student page and what remains is a header link, a role link, an h1, an ISO date, a red status line, three outline buttons, grey rules between records, two Previous/Next buttons, a licensing toggle, a 45-word warning and a footer that says "Access is checked for each request." Nothing on any screen says a twelve-year-old is learning to chant Torah at a warm Reform congregation. The only object with personality is the Hebrew itself, and it shares its 2rem line with English bracket notes.

## 5. Cognitive load (8-item checklist: 6 failures, 2 partial — high)

- Single focus: fails on the student page (metadata, text, per-verse tools, paging, licensing, "Practice tools", "Service parts" on one scroll with equal weight) and on the admin reading page (text + editor + preview + aliyah fieldset + service editor on one 15k-pixel page).
- Chunking: 8 items in the student header cluster before the first verse; 7 sections on the student-access page.
- Hierarchy: the student's name (h2) is visually heavier than the reading reference; the 45-word warning is set like body copy.
- Decision points over 4 options: ten identified, including the admin reading form (9 controls), the student access page (11), the preview with selection (5 global + 3 per verse), and verse-tools recovery states (up to 5 buttons).
- Working memory: no scroll memory across text pages; 5-minute review expiry; "The new record may be on another page."
- Progressive disclosure is inverted: ketiv/qere notes, edition status, licensing and the warning are always visible; phrase colors (the useful thing) are off by default, two taps deep, per verse, forgotten on paging.

## 6. Emotional journey (student, first open to end)

1. "Checking your access" → "Your student information is hidden until access has been checked." (valley: the first in-app sentence is about hiding)
2. Lands on own name (good) → ISO date → red "Needs review with your tutor or rabbi · Revision 1" (valley: she thinks she did something wrong)
3. Torah / Haftarah / Service parts outline buttons with no answer to "what do I practice tonight" (flat)
4. The Hebrew (small peak: big, clean, hers) → "Written form (ketiv) is followed by the read alternative (qere); neither is silently substituted." (valley)
5. Reading aids → Color phrases → colors appear with "etnachta · Word 1" (peak: this is the Duolingo moment waiting to happen, hidden behind a per-verse checkbox)
6. Provenance block, licensing, "Other confirmed reading details" (valley)
7. "Practice tools": three sentences, "Audio practice is not available yet", the 45-word warning (deepest valley: the section named for her tells her what is missing)
8. Footer "Access is checked for each request." There is no end moment. Nothing records that she practiced. Celebration count: zero. Reassurance: two sentences in the whole product.

## 7. What is genuinely working (keep through any redesign)

1. **The Hebrew is right.** Pinned Noto Serif Hebrew, 2rem/2.0, mark features, clean cantillation at 390px. The reading leads and the student's name is first, per Daniel's ruling.
2. **Phrase coloring by closing trope family with a legend** (`study/annotations.tsx`) is pedagogically specific and non-color-dependent. It is the seed of the signature interaction.
3. **Accessibility plumbing**: targets, focus, live-region headings that receive focus, `bdi`, skip links, reduced motion, `<dialog>`. Sam gets a better deal than in most apps; the problems are language and density, not mechanics.
4. **The security model** (server-side review bindings, no tokens in URLs, fail-closed revalidation) is invisible to users and should stay invisible. The redesign changes what the user sees, not what the server checks.

## 8. Priority issues

**[P0] The student page has no next step and no end.** `reading.tsx`, `study/view.tsx`. The success criterion is a child practicing alone on a phone the night before a lesson; today she gets a document. Fix: one primary object at the top ("Tonight: verses 4–6" or "Start at verse 1"), a one-tap self-check per verse (not started / working / solid, per MISSION 36–47), a closing moment ("4 of 9 verses solid"), no paging.

**[P0] Provenance and transaction prose is served to the student verbatim.** `reading.tsx:18,20,97–100`, `study/view.tsx:76–78`, `annotations.tsx:37–38`, `provider.tsx` loading copy. ~120 words of audit copy per screen is the single biggest reason it feels like airport software. Fix: role-gate copy. Student mode shows zero provenance on the page; everything moves into one "About this text" sheet. Delete the departure warning paragraph (keep the guard). Hide revision numbers and "Needs review" from students.

**[P1] No visual system beyond rules and one type size.** `globals.css`. The current tokens cannot produce either Apple calm or Duolingo warmth. Fix: a new world (section 10), with surfaces, a real type scale, a display size for the reading reference, semantic state colors separate from the brand burgundy, filled primary buttons with verb labels, an icon set, and Masoretic markers moved out of the reading line.

**[P1] Tools are collapsed, per-verse, off by default and forgotten.** `annotations.tsx`, `verse-tools.tsx`. Fix: a persistent bottom toolbar on phones (Colors · Translate · Notes · Hear) that applies to the whole reading and remembers its state per student; colors on by default for students; translation as a tap-to-reveal line under the verse, not a form.

**[P1] Tutor/admin flows are single long pages with stacked prepare → review → confirm ceremonies.** `reading-editor.tsx`, `reading-preview.tsx`, `service-learning/editor.tsx`, `relationships/workspace.tsx`, `invitations/workspace.tsx`. Adjusting verses during a Zoom lesson is 7–8 steps and two scrolls of a 5–15k-pixel page with a 5-minute expiry; adding a student and inviting a parent is ~12 taps across two pages with the natural next step refused ("Creating or editing a record does not send an invitation"). Fix: split into tasks (Reading · Service parts · People per student), make the preview the picker (tap first verse, tap last verse, drag aliyah markers, Save), keep the server review binding but collapse the UI to one confirm per task, give each student a stable URL.

**[P2] No navigation model.** Students have only "Account and sign out"; admins reach six areas via inline text links and "Back to student roster". Fix: student = one screen with a bottom toolbar and a header that carries name and ceremony countdown; staff = persistent nav (Students · Invitations · Tutors · Settings) and a student page with tabs.

**[P2] Raw dates, identifiers and server vocabulary.** `2027-01-02`, `10/16/2026, 1:04:29 PM`, UUIDs, "acknowledged by the server". Fix: "Sat, Jan 2, 2027", relative time where it helps, never UUIDs, one rewrite rule (section 9).

**[P3] The preview/aliyah picker renders every verse with three text buttons.** Fix: range selection by tapping verse numbers; aliyah cuts as markers; a summary chip "Genesis 4:19–23 · 2 aliyot".

## 9. Copy audit and rewrite rule

Rule: subject is "you" or the person's name; active verb; one clause; no provenance; the student never reads the words review, revision, edition, route, tab, acknowledged, substituted.

| Now | Say instead |
|---|---|
| "Unsent work stays only in this tab. Controlled workspace changes ask you to review it. Your browser may warn before reload or close; Back, Forward, closing the browser or an unexpected route change can discard work. A warning and delivery cannot be guaranteed." | (delete; keep the guard) or "We save your translation when you tap away." |
| "Needs review with your tutor or rabbi · Revision 1" | (hidden from students) / staff: "Draft · not yet confirmed" |
| "Written form (ketiv) is followed by the read alternative (qere); neither is silently substituted." | In Reading aids only: "This word is written one way and read another. Chant the one in brackets." |
| "Verses 1–3 of 3. The selected English edition is missing for some verses." + "Hebrew: Miqra according to the Masorah. English reference: JPS2023. No alternate edition is substituted." | "3 verses" on the page; sources in the "About this text" sheet. |
| "Your student information is hidden until access has been checked." | "Opening your reading…" |
| "Choose an assigned part to read. Only the chosen part opens here." | "Tap a part to practice it." |
| "Text access changed. No previous text is being shown. Confirmed references and the reading review form remain separate." | "We couldn't load your verses. Tap to try again." |
| "Choose an assigned student to view their confirmed reading." | "Who are you teaching today?" + tappable student cards |
| "Invitation creation acknowledged by the server. The new record may be on another page." | "Invitation sent to m•••@example.test. Expires Friday 1:04 PM." + Resend |
| "Private congregation invitations. Lifecycle and mail outcome are separate: pending does not prove an invitation is currently redeemable…" | "Invite parents, students and tutors. Links expire after 72 hours." |
| "The confirmed assignment above stays in place until you review and explicitly confirm your changes." | "Changes take effect when you confirm them." |
| "Current identity and access state will be checked again before confirmation." under a UUID | "Dana Cohen will be able to see and teach Maya's reading." |

## 10. Redesign recommendation

### 10.1 Grounding (for the Impeccable direction round)

- Mechanism: a learner's own verses, chanted by phrase, with the trope family as the unit of mastery.
- Scene: a 12-year-old on an iPhone in bed the night before a lesson; a tutor on a laptop sharing a Zoom screen; the rabbi on a phone between meetings. The first scene forces **dark mode support** and a phone-first student surface; the second forces large, screen-shareable type and a stable per-student URL.
- Cultural home: Reform Jewish life at CRC: Mishkan T'filah, NFTY and camp song sessions, Shabbat and Havdalah ritual, the yad and the scroll, trope charts, family simcha stationery.
- The rut (kept out of the candidate list): the "annotated Torah page" (what exists) and its opposite, a Duolingo clone with owls and streaks.
- Seven grounded candidates spanning print, ritual object, youth culture, music education, craft and stationery:
  1. **The yad and the scroll column** (ritual object): the pointer as the signature interaction, following the phrase being practiced; text in a scroll column; progress is how far the yad has travelled.
  2. **Mishkan T'filah's page** (Reform graphic tradition): facing-page rhythm, Hebrew leading, English and commentary in quiet margins, poetic line breaks; the siddur the student already holds on Friday nights.
  3. **NFTY / camp song-session visual culture** (youth identity): screen-print color, hand-set type, song-sheet energy; the warmth Daniel asked for from the teens' own world rather than from a language app.
  4. **Havdalah twilight** (ritual scene): deep blue ground, candle gold and wine, the evening practice scene itself; a natural dark mode.
  5. **The cantor's trope teaching card / Binder notation** (music education): phrase families as colored musical shapes, the chart as the interface rather than a link.
  6. **Jewish papercut and mizrach** (decorative craft): cut-paper surfaces and silhouettes as the surface language; celebration moments as cut-paper reveals.
  7. **The simcha invitation and ceremony program** (family stationery): the date, the names, the honors, the order of the morning; the countdown as the emotional anchor of the home screen.

The direction round (`impeccable concept-seed --scope direction --mode operate`) rolls the assigned direction and deals challengers; the roll decides, not this document. If asked for a pick: candidate 1 (yad and scroll column) with candidate 3's color commitment as the donor, because it carries the mechanism literally and gives the student page one memorable object.

### 10.2 Color and type strategy (whatever world is rolled)

- Student surface: **Committed** color (one saturated warm field owns the header/next-step region; the reading sits on a calm surface beneath it). Staff surfaces: **Restrained** (tinted neutrals + one accent) with a real semantic set: progress, attention, success, destructive, distinct from brand.
- Light and dark both ship; dark is derived from the scene, not from category habit.
- One UI family at a 1.2 ratio scale with a true display size for the reading reference and the countdown; Hebrew stays Noto Serif Hebrew 2rem/2.0 (or larger with a user text-size control). Masoretic markers (setumah/petuchah, qere) become small out-of-line glyphs or marginal notes, never Latin brackets inside the 2rem RTL line.
- Surfaces: grouped cards with 14–16px radius and soft inset or hairline; tappable rows with chevrons; an icon set in one stroke weight; filled primary buttons with short verb labels.

### 10.3 Navigation and screen model

- **Student (one screen):** header = name + ceremony countdown ("Sat, Jan 2 · 78 days"); primary object = "Tonight" (next verses, one tap starts); body = the whole reading as tappable verse objects with colors on by default; bottom toolbar = Colors · Translate · Notes · Hear (Hear disabled until G3 with an honest label); per-verse self-check; closing moment. Everything else (sources, revision, service plan review) is staff-only. Service parts are a second tab or a section below, named by prayer.
- **Tutor:** "Who are you teaching today?" as cards (name, countdown, what changed since last lesson); student page with tabs Reading · Service parts · Notes; stable URL per student; editing in a sheet where the preview is the picker; one confirm per task; the review binding stays server-side.
- **Admin:** persistent nav Students · Invitations · Tutors · Settings; roster rows carry chips (tutor, parent invited, reading confirmed); student page offers "Invite parent" inline right after "Add student"; outcomes phrased as results ("Sent to…"), caveats in detail views.
- **Entry:** keep the hero idea ("Open your reading") and "No password needed"; never show a system sentence in the hero position; when Google is unavailable, demote it quietly under the email form.

### 10.4 What must not change

MISSION rulings (no transliteration, no leaderboards or comparisons, G3 before any student hears generated chant, Adonai/Elohim, Torah and haftarah equal), the server-side review/authorization model, the never-in-repo rule, the pinned Hebrew font and its licence, the accessibility floor already reached.

## 11. Phased plan and cost

| Phase | What | Daniel's time | Agent effort |
|---|---|---|---|
| 0. Direction round | Run the Impeccable direction roll for the student surface (Operate mode); Daniel locks one card on the decision page or by structured question. | 15–30 min | 1 session |
| 1. Student surface | Build the chosen world on the student reading screen: tokens, surfaces, toolbar, next step, self-check, end moment, role-gated copy, dark mode. Finish review + DESIGN.md rewrite by the shipped documenter. | review one deploy | 2–3 sessions |
| 2. Tutor surface | Student cards, per-student URL, tabs, sheet-based editing with preview-as-picker, service parts list, notes. | review one deploy | 2–3 sessions |
| 3. Admin surface | Persistent nav, roster chips, student page with inline invite, invitations and tutors in the new system, CSV import as a focused flow. | review one deploy | 2 sessions |
| 4. Entry + parent | Re-skin entry in the new world; parent dashboard inherits. | review one deploy | 1 session |

Interim quick wins that survive any world (can run now, in parallel with other workers, with no visual-world decision): the copy rewrites in section 9, role-gated provenance, phrase colors default-on and remembered, removal of student-facing paging, human dates. One session.

## 12. Open items that wait on Daniel

- Lock a direction from the roll (phase 0), or take the standing exit (the category standard played straight; then name two or three products it should sit beside).
- Confirm that students may see no "needs review" status at all (section 8, P0 #2) or choose a soft wording.
- Confirm that phrase colors may be on by default for child students (MISSION 14 keeps recording-first and trope practice equal; default-on colors do not change that).
- Whether the student bottom toolbar should show a disabled "Hear" before G3 passes, or hide audio entirely until release (MISSION 16 says the player ships with the slot empty).

## Evidence index

- Assessment A and B full returns: this session's transcript; counts reproduced above.
- Captures reviewed: `.impeccable/review/*.png` (20 files, synthetic data); public-route captures `.local-logs/ux-analysis-captures/`.
- Detector: `.local-logs/ux-analysis-detector.json` (27 advisory findings).
- Lighthouse: `.local-logs/ux-analysis-captures/lighthouse-home/`, `lighthouse-sign-in/`.
- Critique snapshot: `.impeccable/critique/` (target `src/app/workspace/page.tsx`).
