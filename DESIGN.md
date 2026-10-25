---
name: CRC B'nei Mitzvah
description: A song session for a student's own verses; flat screen-print inks and direct listening in the reading.
colors:
  lake: "#1d5ba6"
  lake-deep: "#154680"
  lake-tint: "#dbe8f6"
  marigold: "#f7b500"
  forest: "#1e6b47"
  surface: "#ffffff"
  canvas: "#ebf2fa"
  ink: "#13202f"
  muted: "#4b5a6b"
  rule: "#d2dfee"
  control-rule: "#8da3bb"
  hover: "#e3edf8"
  danger: "#b42318"
  night-lake: "#10335e"
  night-canvas: "#0b1626"
  night-surface: "#13233a"
  night-ink: "#e9f0f8"
  night-muted: "#a8b8ca"
  night-action: "#8dbbf5"
  night-action-fill: "#2f6cbd"
  night-forest: "#7fd1a8"
  night-rule: "#24384f"
typography:
  display:
    fontFamily: "Bricolage Grotesque, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(2.5rem, 7.5vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Bricolage Grotesque, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "3rem"
    fontWeight: 750
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Bricolage Grotesque, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Bricolage Grotesque, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Bricolage Grotesque, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  hebrew:
    fontFamily: "CRC Noto Serif Hebrew, Noto Serif Hebrew, Times New Roman, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 2
    letterSpacing: "normal"
    fontFeature: "\"mark\", \"mkmk\""
  hebrew-lifted:
    fontFamily: "CRC Noto Serif Hebrew, Noto Serif Hebrew, Times New Roman, serif"
    fontSize: "3.2rem"
    fontWeight: 400
    lineHeight: 1.9
    fontFeature: "\"mark\", \"mkmk\""
rounded:
  control: "12px"
  object: "16px"
  dock: "22px"
  pill: "999px"
spacing:
  unit: "0.5rem"
  xs: "0.25rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-start:
    backgroundColor: "{colors.lake}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 2.25rem"
    height: "56px"
  button-start-hover:
    backgroundColor: "{colors.lake-deep}"
    textColor: "{colors.surface}"
  button-primary:
    backgroundColor: "{colors.lake}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0.6875rem 1.125rem"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.lake-deep}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.6875rem 1.125rem"
    height: "48px"
  button-hero-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
    height: "48px"
  segmented-selected:
    backgroundColor: "{colors.lake}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.6875rem 0.875rem"
    height: "48px"
  app-bar:
    backgroundColor: "{colors.lake}"
    textColor: "{colors.surface}"
    height: "60px"
  verse-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.object}"
    padding: "0.875rem 1.25rem 1rem"
  verse-number:
    backgroundColor: "{colors.lake-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "1.875rem"
  countdown-chip:
    backgroundColor: "{colors.marigold}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.625rem"
  aliyah-marker:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.forest}"
    rounded: "{rounded.pill}"
    padding: "0 0.75rem"
    height: "32px"
  reading-toolbar:
    backgroundColor: "{colors.lake}"
    textColor: "{colors.surface}"
    rounded: "{rounded.dock}"
    padding: "0.375rem"
  toolbar-item-pressed:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.lake-deep}"
    rounded: "{rounded.object}"
    height: "56px"
  lift-sheet:
    backgroundColor: "{colors.lake}"
    textColor: "{colors.surface}"
  lift-step-next:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.lake-deep}"
    rounded: "{rounded.pill}"
    height: "56px"
---

# Design System: CRC B'nei Mitzvah

## Overview

**Creative North Star: "Song session"**

Locked by Daniel on 2026-10-16 (direction seed 8ac4194f; contract in `.impeccable/surfaces/src-app-workspace-page-tsx.md`), replacing the earlier "Annotated score" world. A student's own verses are a song session, not a record: the camp and NFTY song-session sheet, printed in flat screen-print inks. Lake blue owns the shell, the reading sits on a lake-tinted canvas, marigold marks time and change, forest marks what is settled. Dark mode is the same inks on night-lake navy, not an inverted theme.

The energy comes from committed color and a characterful humanist grotesque at poster scale. Daniel's 2026-10-17 interaction amendment makes the continuous main Hebrew passage the primary practice surface: select a canonical word or the small verse-number button to listen in place. One inline player provides synchronized highlighting, Repeat, Practice and Speed. The lifted line remains an explicitly opened secondary close-up with its existing ink pull; listening requires neither that dialog nor a manual Load action. Daniel's tone ruling, "It can't be cheesy or cringe," continues to constrain the visual and copy language.

**Scope of what is built.** The student, child-practice and parent reading surfaces are fully in this world (app bar, reading hero, segmented kind control, continuous Hebrew, inline player, toolbar and optional lifted line). Staff (tutor and admin) and entry surfaces inherit the tokens, font, radii and lake action color only; their compositions still use the older ruled-section layouts, and their redesign is a later phase. The Working / Got it self-check, the per-verse position rail on the reading page and the "ink pull on Got it" celebration are not built: there is no progress backend. The ink pull currently runs when the lifted line advances to a phrase.

**Key Characteristics:**
- Flat inks on a tinted canvas; depth comes from color fields and hairlines, never from elevation.
- One accent field (lake blue) for the shell, the primary action and the lifted sheet.
- Marigold only as a fill behind dark type or as a focus ring and position mark; never as text.
- Consecutive Hebrew verses flow together; canonical words and small verse-number buttons initiate inline listening.
- Hebrew is set in Noto Serif Hebrew with four named size steps driven by one toolbar control.
- Masoretic apparatus sits under the Hebrew line in small muted text, never inside it.
- One authored motion (the ink pull); reduced motion snaps.

## Colors

Screen-print inks: one saturated blue that owns the frame, one warm yellow for time and change, one green for settled, and cool tinted neutrals.

### Primary
- **Lake Blue** (`lake`): the app bar, the reading toolbar, the selected segment, the Start button and every primary button, the lifted-line sheet, links and the caret. The hover and pressed state is **Deep Lake** (`lake-deep`), which is also the text color on white pressed toolbar items and the lift's Next button.
- **Lake Tint** (`lake-tint`): verse-number discs, the selected text-size row, the pressed secondary button.

### Secondary
- **Marigold** (`marigold`): the ceremony countdown chip, text selection, the current segment of the lift's verse rail, and the focus ring on lake-blue surfaces (and everywhere in dark mode). Always a fill or a ring; any text on it is Ink.

### Tertiary
- **Forest** (`forest`): settled state. Today that is the aliyah-start marker (forest text on white with a forest hairline) and the role list on entry. In code the variable is still `--color-teal`, a legacy name.

### Neutral
- **White Surface** (`surface`): verse cards, the segmented control track, open translation panels, secondary buttons, the toolbar's pressed item.
- **Lake Canvas** (`canvas`): the page; it also rings the floating toolbar so it reads as separate from the verses beneath it.
- **Ink** (`ink`): text, and the text on marigold and on phrase-color blocks.
- **Muted Ink** (`muted`): dates, verse references, meta lines, apparatus notes, field help.
- **Hairline** (`rule`): the 1px inset outline on every card, track and pill.
- **Control Rule** (`control-rule`): the visible outline on inputs and secondary buttons, where a hairline would be too faint.
- **Hover Wash** (`hover`): hover fill on secondary and icon buttons.
- **Danger** (`danger`): request errors only.

### Dark mode
Same roles on night-lake navy: `night-canvas` page, `night-surface` cards, `night-ink` and `night-muted` text, `night-rule` hairlines, `night-action` for links and text actions, `night-action-fill` behind white text on buttons, `night-forest` for settled. The app bar, toolbar and lifted sheet use `night-lake`; marigold becomes the focus ring everywhere.

### Phrase family colors
The lifted line and the verse cards print trope phrases with the pastel family colors already defined by the trope chart catalog (`src/lib/trope/chart-catalog`), always with Ink text and a 0.18em corner. They are content data shared with the chart, not shell colors, and are always paired with a named legend chip and word range so color never carries meaning alone.

### Named Rules
**The Marigold Is Never Text Rule.** Marigold appears as a fill behind Ink type, a ring, or a rail mark. It is never a text or icon color.

**The One Field Rule.** Lake blue is the only saturated field in the shell. If a new surface needs emphasis, it gets lake or a white object on canvas, not a new hue.

## Typography

**Display and UI Font:** Bricolage Grotesque 1.001, self-hosted variable (optical size 12–96, weight 200–800, width 75–100) with `font-optical-sizing: auto`, falling back to system-ui
**Scripture Font:** CRC Noto Serif Hebrew (Noto Serif Hebrew 2.004, self-hosted), then Noto Serif Hebrew, Times New Roman, serif

**Character:** A characterful humanist grotesque with ink-trap personality at large sizes and plain legibility at small ones, against a classical Hebrew serif. The English is loud only where it is a heading; the Hebrew is always the most important text on the page. Provenance and licenses for both fonts are in `public/fonts/PROVENANCE.md`.

### Hierarchy
- **Display** (800, clamp 2.5rem–4.25rem, line height 1, -0.035em): the reading reference in the hero ("Genesis 1:1–3"), the single next decision. On phones it runs clamp(2.5rem, 12vw, 3.25rem); the empty-state headline uses clamp(1.75rem, 6vw, 2.5rem).
- **Headline** (750, 3rem, 1.08): entry-page h1 (2.5rem at 900px, 2.25rem at 640px). Workspace h1 is 2.25rem, 1.875rem on phones.
- **Title** (700, 1.5rem, 1.25): section h2s such as Service parts.
- **Body** (400, 1rem, 1.55, max 65ch): running text; English translation sits at 1.7 line height, max 62ch.
- **Label** (600, 0.9375rem): verse references, translation and notes pills, segmented items. Supporting steps: 1.0625rem 700 for the student name; 0.875rem for meta, chips and apparatus; 0.8125rem 600 for toolbar labels.
- **Hebrew** (400, 2rem, line height 2; continuous passage 2.15, `mark` and `mkmk` features, no synthesis): every verse. Four named steps, no slider: Small 1.625rem, Standard 2rem, Large 2.5rem, Huge 3.125rem, set on the reading section through one `--hebrew-size` property.
- **Hebrew, lifted** (400, 1.6 times the chosen step, line height 1.9, max 22ch, centered): the lifted line; 3.2rem at Standard.

### Named Rules
**The Named Steps Rule.** Hebrew size is one of four named steps chosen from the toolbar and remembered per student; nothing else resizes scripture.

**The Hebrew Stays Whole Rule.** Qere labels, paragraph signs and notes are set in the UI face at small size and sit beside or under the Hebrew line; no apparatus text is styled as scripture.

### Amendment, 2026-10-24 (Daniel, review decision 3, "Yes, full system"): the type scale, 17px body and the shared components

Where this section differs from the Hierarchy above, this section rules; pages move to it milestone by milestone (1.9 N10 onward), so older sizes above still describe screens not yet moved. The tokens are in `src/app/globals.css`, the components in `src/components/ui`, and `/design-system` (a 404 outside the browser tests) shows them all.

- **Six type steps, in Bricolage:** display 40px (the reading hero's one next decision), title 26px (the one page h1, `PageHeader`), heading 19px (section and sheet titles), **body 17px** (running text, buttons, list titles), callout 15px (meta lines, segment labels, field help) and caption 13px (chips, footers). The body is 17px on every page now; headings set in rem or clamp do not move with it. Hebrew keeps its four named steps and is not on this scale.
- **Three weights:** 400, 600, 750. No other weight is written in new styles.
- **A radius per object:** control 12px (buttons, fields), object 16px (list groups, empty states, verse cards), sheet and dock 22px (the sheet on its top corners only), pill (chips, segmented control, Start).
- **Four staff tones, never colour alone:** `attention` (marigold fill behind ink, so still never text), `done` (forest), `info` (lake), `danger` (red text, or a red fill with white type for a destructive button). A tone always appears with a word: `Chip` only takes a string.
- **One focus ring:** the global `:focus-visible` rule, 3px solid at a 4px offset, deep lake in light and marigold in dark. Components never draw another.
- **One Button, three variants:** primary, secondary, quiet, each at least 44px tall. A destructive button takes the danger tone and opens a confirm Sheet; only the sheet's confirm action runs, and the safe choice has focus.
- **One Sheet:** a native modal dialog that rises from the bottom edge at every width (full width on a phone, at most 40rem on a laptop), traps focus with Tab wrapping both ways, returns focus to where it came from (or to an element its owner names), closes on Esc, a tap outside, the close button or a swipe down, and ignores all of those while its action is running. Its rise is a functional transition rather than a second authored motion, and it snaps under reduced motion. This does not yet move the reading tools to a bottom dock; that amendment to the phone toolbar rule comes with N4.
- **Also shared:** `ListRow` (grouped rows, 56px, one target across the row), `PageHeader`, `EmptyState` (words and one action, nothing drawn), `Segmented` (a radio group), `Chip`.

## Layout

A single reading column on a tinted canvas inside a 78rem shell (4rem side padding, 2rem at 900px, 1rem at 640px). The learner shell retains its app bar, reading hero and segmented kind control. The main passage is continuous RTL Hebrew, followed by one inline player and optional per-verse tools. English, apparatus, work and explicit View up close actions live in those secondary tools rather than breaking every Hebrew verse into a card. About this text, the trope chart and service parts retain their existing places.

Phones (390 reference): the Start button spans the full width. The full-width four-item toolbar occupies normal document flow above the Hebrew with a 1rem following margin; it never covers the passage. The page retains 4rem bottom padding. Practice and Speed share a two-column row in the inline player, with each label above its select.

Desktop (above 1000px): the toolbar remains a sticky 6.5rem vertical rail beside the reading, 1.5rem from the top, with a 1.5rem column gap. The continuous passage has a 72rem maximum measure; its actual width follows the available reading column. The text-size menu centers in the viewport.

**The Passage First Rule.** Consecutive assigned verses stay in one Hebrew flow. Break at an actual open paragraph, chapter/book change, assignment discontinuity or recorded aliyah section; a closed paragraph adds an inline gap. Verse numbers identify playable verses without turning each into a separate card.

**The Calm Return Rule.** An unchanged reading and its scroll position remain mounted during quiet authority checks on tab return. Changed or failed authority still invalidates the retained view; playback requires a fresh explicit word, verse or Play action after suspension.

Spacing is a 0.5rem unit used in quarter, half and whole steps: 0.25rem inside tracks, 0.75rem in action rows, 1–1.5rem inside objects and between sections, 2rem before the main reading. Standard controls retain their established touch sizing; inline verse numbers remain small superscript buttons beside the Hebrew.

## Elevation & Depth

Flat. There are no drop shadows and no visible gradients anywhere. Depth is made three ways: a saturated field against the canvas (app bar, toolbar, lifted sheet), white objects on the tinted canvas, and hairlines. Hairlines are drawn as inset 1px box-shadows so they do not change layout, and the toolbar and its menu wear a 2px canvas-colored ring so they read as cut out of the page rather than lifted above it.

### Shadow Vocabulary
- **Hairline** (`box-shadow: inset 0 0 0 1px var(--color-rule)`): every card, segmented track, pill and open panel.
- **Hover outline** (`box-shadow: inset 0 0 0 2px var(--lake)`): retained verse-card objects under the pointer; the main passage uses word underlines instead.
- **Canvas cut** (`box-shadow: 0 0 0 2px var(--color-canvas)`): the toolbar and its menu.

### Named Rules
**The Print, Don't Float Rule.** box-shadow is used only as an inset hairline or a zero-blur ring. Nothing casts a shadow; nothing has blur.

## Shapes

Soft, generous corners that read as cut paper: 12px on controls, 16px on objects (verse cards, open panels, toolbar items), 22px on the toolbar dock (20px on its menu, 14px on menu rows), and full pills for every chip, segmented control, the Start button, hero secondary buttons, the role nav and the lift steps. Number discs are circles. Phrase-color blocks use a 0.18em corner and clone across line breaks. Only inline dividers inside a card (the apparatus) are dashed.

## Components

### Buttons
Thumb-sized, pill-shaped where they move the student forward, rounded rectangles where they submit forms.
- **Start:** lake fill, white 1.125rem 750 text, full pill, 56px tall, 9rem minimum; full width on phones. Hover deep lake; press scales to 0.97.
- **Primary (forms):** lake fill, white 600 text, 12px corner, 48px, 0.6875rem by 1.125rem padding. Hover and active deep lake.
- **Secondary:** white with a control-rule outline, ink text, 12px. Hover wash with an ink outline; active lake tint.
- **Hero secondary:** white pill with control-rule outline, 48px, 650 weight ("Enter child practice", "Return to parent view", "Service parts").
- **Icon buttons:** 44–48px transparent circles with 20–22px inline SVG strokes (2px, round caps); hover wash, or 14% white on lake surfaces.
- **Focus:** 3px solid outline offset 4px, deep lake in light mode; marigold on lake surfaces and throughout dark mode.

### Chips
- **Countdown chip:** marigold fill, Ink 650 0.875rem text, pill, beside the ceremony date.
- **Aliyah marker:** white pill with a forest hairline and forest 650 0.875rem text, 32px tall, above the verse where the aliyah starts.
- **Phrase legend chip:** white pill with hairline holding a family-color pill (Ink 600 text) and a muted word range.
- **Verse number:** lake-tint disc, 1.875rem, Ink 750 tabular figures.

### Segmented control
A white pill track with a hairline and 0.25rem padding; transparent 44px pill items; the selected item is a lake pill with white text. Used for Torah / Haftarah / Service parts and for the role nav.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** white surface on the lake canvas.
- **Shadow Strategy:** inset hairline only; see Elevation.
- **Internal Padding:** 0.875rem 1.25rem 1rem (1rem sides on phones).
- **Verse tools:** secondary sections follow the continuous passage and player, with canonical reference, optional English, apparatus, work and an explicit View up close action. The main Hebrew passage is not a stack of tappable cards.

### Inputs / Fields
- **Style:** white, control-rule 1px outline, 12px corner, 48px tall, lake caret; 600 labels above.
- **Focus:** the global 3px focus outline.
- **Disabled:** canvas fill; disabled buttons drop to 60% opacity.

### Navigation
- **App bar:** a full-bleed lake band 60px tall with the brand in white 750 and an Account pill on the right; night-lake in dark mode.
- **Role nav:** the segmented pill track; the current role is a lake pill.
- **Tab bar (1.9 N10, decision 1):** four labelled tabs per signed-in role on a phone, fixed at the foot of the screen: surface fill, a hairline above, a 24px icon over a 13px 600 label, every target at least 64px tall and 44px wide, the current tab in the action colour with a lake-tint pill behind its icon. It steps out of the way only while a text field has focus and the on-screen keyboard is open. From 1000px it is an 11rem left rail with the icon beside the label. The page keeps the bar's measured height clear at its foot (`--shell-bar-h`), so the bar never covers content, and the bar is hidden in print. Public /read, /learn, /trope-chart and /print have none. Student: Today, Reading, Learn, Account. Parent: Today, Practice, Honors, Account. Tutor: This week, Students, Lessons, More. Admin: This week, Students, People, More.
- **Footer:** centered muted 0.8125rem line, no rule.

### Reading toolbar
One toolbar drives every verse: Colors, English, text size, and Hear. Lake fill, 22px corner, four equal 56px items with an SVG icon over a 0.8125rem 600 label; a pressed toggle becomes a white tile with deep-lake text. The size item opens a white menu of four rows, each showing a Hebrew sample letter at that step. Start and toolbar Hear directly start main inline playback where available. Only the explicit View up close action opens the optional dialog. On phones the toolbar stays in flow above the passage; on desktop it is a sticky vertical rail. Preferences are remembered per student (colors on by default).

### Continuous reading and inline player (primary practice)
Canonical read words are keyboard-operable listening targets, including when phrase colors are off. Hover underlines a word; focus uses the existing marigold outline; playback highlights the active word in place. Small superscript verse-number buttons select a whole verse and carry its full reference in their accessible label. Written alternatives and non-word apparatus do not become extra read-word targets.

One ruled player follows the passage. Its top row pairs the selected reference/word with Play or Pause and Repeat. Beneath it, paired Practice and Speed fields keep their labels above their selects, including on phones. Practice chooses the selected verse or one canonical word; Speed offers 0.5×, 0.75×, 1× and 1.25× when supported. Selection loads and plays directly; unavailable recordings or held word timing produce explicit feedback rather than playing a broader selection. Repeat retains that word or verse; playback never chooses the next verse automatically. Attribution remains in a disclosure. Player actions and selects use 44px minimum controls, existing lake/white fills, control corners and focus vocabulary.

### The lifted line (signature)
An optional full-screen modal dialog, opened only through the explicit View up close action, on a lake sheet (night-lake in dark mode). Top bar: close, "Verse n of N · phrase p of P", phrase-color toggle. Under it a rail of 4px segments: past segments 75% white, the current one marigold, the rest 28% white. The verse is centered at 1.6 times the chosen Hebrew step; while phrasing, words outside the current phrase recede to 32% opacity and the current phrase's color block wipes in word by word (`ink-pull`, 560ms on `cubic-bezier(0.16, 1, 0.3, 1)`, 70ms stagger). Translation, apparatus and the phrase legend sit below. Bottom: a translucent Back pill and a white Next phrase / Next verse pill, both 56px. Vertical swipe and arrow keys step; a long verse scrolls before it steps; reduced motion removes all animation.

## Do's and Don'ts

### Do:
- **Do** keep lake blue as the one saturated field: app bar, toolbar, selected segment, Start, the lifted sheet.
- **Do** put Ink type on marigold and on phrase colors, and pair every phrase color with a named legend chip.
- **Do** draw edges with inset 1px hairlines and separate floating elements with a 2px canvas ring.
- **Do** size Hebrew only through the four named steps (1.625, 2, 2.5, 3.125rem) and keep ordinary verse line height 2 and continuous-passage line height 2.15.
- **Do** keep apparatus (qere notes, paragraph signs, aliyah markers, sources) outside the Hebrew line, in small muted UI type.
- **Do** honor reduced motion: the ink pull and smooth scrolls snap.
- **Do** keep standard controls at 44px or more, 56px for the main forward action; use small inline verse-number buttons in the continuous passage.

### Don't:
- **Don't** use marigold as text or icon color.
- **Don't** add drop shadows, blur or visible gradients; the world is flat print.
- **Don't** add mascots, confetti, streak flames, badges, emoji, exclamation points, pep-talk copy or sound effects (Daniel's pinned tone ruling).
- **Don't** show status, revision, edition or provenance on learner reading surfaces; sources live in "About this text."
- **Don't** add a second authored motion; the ink pull is the only one.
- **Don't** introduce a free text-size slider or resize scripture any other way.
- **Don't** require a close-up dialog or manual Load action for main-text reference listening, or overlay the passage with the phone toolbar.
