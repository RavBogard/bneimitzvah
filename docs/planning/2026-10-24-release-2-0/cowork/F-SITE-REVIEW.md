# F. Walk-through of the live site, signed out

2026-10-24. Site: https://beitmitzvah.centralreform.org (Lech-Lecha week). Signed out throughout. Phone width 390x844 and desktop 1280x900, in the Claude browser pane, light and dark colour schemes. Nothing was submitted: the sign-in email field was left empty, no sign-in mail was requested, no account request was sent.

**Limits of this walk.**
- Audio was not heard. The pane plays nothing I can hear, so "Hear it" and Quick ten timing were judged from page state only.
- The pane's screenshots were sometimes unreliable (tiled or zoomed), so most layout checks were measured in the page (element sizes, positions, colours) rather than eyeballed.
- This is an emulated phone, not a real iPhone or Android. Safari autoplay and install behaviour still need the device check.
- My own scripted reads (probing a dozen routes, reading the page scripts once) added to the request count before the rate limit tripped (finding 1). The threshold is not established here; the logs show about 65 public API calls in roughly 12 minutes before the first refusal.

Severity: **blocks** (a newcomer cannot do the thing), **confuses** (they can, but are likely to go wrong or give up), **polish**.

---

## Findings, most severe first

### Blocks

**1. Ordinary browsing trips the rate limit, and the lesson then blames the recording**
- Page: /learn/intro-phrases (after /read, Study, Vayera, /print).
- What I did: read this week in Lein and Study, opened Vayera, opened /print, then opened the first Learn to lein lesson.
- What happened: five `/api/public/text` calls for the course verses came back 429, and `/api/public/view` too. The lesson showed "The recording did not load. Try again." Try again worked after about 40 seconds.
- Why it matters: Study alone requests the commentary per chapter per work (12 calls for Lech-Lecha with Rashi and the Women's Commentary), so a newcomer looking around for ten minutes is in the same range. A class on CRC's Wi-Fi, or a family on one home connection, shares one address and will hit it sooner. The message sends people to look for an audio problem that isn't there.
- Fix: (a) let the CDN cache the public text, commentary and word routes (they are the same for everyone; `Cache-Control: public, s-maxage`), so repeat reads never reach the limiter; (b) raise or key the public limit so a shared address is not one user; (c) on 429 say what happened, for example "Too many requests from this connection. Try again in a minute.", and keep the recording message for a real audio failure; (d) fetch Study commentary per reading, not per chapter and work.

**2. In dark mode the trope chart's signs are invisible**
- Page: /trope-chart, dark colour scheme (phone and desktop).
- What I did: switched the device to dark mode and opened the chart.
- What happened: each sample sign is drawn in near-white (#e9f0f8) on its pastel family swatch. Measured contrast 1.0 to 1.8:1 for all eleven families. The zakef sample on yellow is a blank yellow box.
- Why it matters: the chart exists to show the signs, and many phones (and most teenagers' phones) run in dark mode.
- Fix: keep the swatch text dark (#13202f, as the reading already does for highlighted words) in both schemes, or drop the swatch background in dark mode and colour a border instead.

### Confuses

**3. A newcomer without an invitation sees no way to ask for an account**
- Pages: /, /sign-in, /account.
- What I did: looked for "Ask for an account" signed out.
- What happened: none of the three pages offers it. All say "Use the address on your invitation." The site's code has the request form ("Ask for an account", name, "What would you like to work on?", "Send request"), but it loads from `/api/account/request` with a session, so it appears only after someone signs in. [Inferred from the page script; I did not sign in.]
- Why it matters: the copy tells an uninvited person they cannot sign in at all, so they never reach the request form.
- Fix: one line under the sign-in box, for example "No invitation? Sign in with Google or your email, then ask for an account." Or show the request card signed out with a note that it starts with sign-in.

**4. Dark mode: verse numbers on /read nearly disappear, and so does their focus ring**
- Page: /read, Lein, dark scheme.
- What happened: verse-number buttons are #154680 on #0b1626, 1.9:1. Their focus outline is the same colour, so a keyboard user cannot see where they are. Other controls in dark mode switch to a light outline correctly.
- Fix: give the verse numbers and their outline the dark-mode text and focus tokens.

**5. Choose verses builds the wrong range**
- Page: /read (Vayera), Study.
- What I did: pressed Choose verses, tapped 18:1, then 18:10, then "Select range", then 18:5.
- What happened: two taps chose two single verses ("2 verses: Genesis 18:1; 18:10"). "Select range" then said "Choose the last verse of the range" and built 18:5–10 from the last tap, giving "7 verses: Genesis 18:1; 18:5–10". The bar never says how to choose (tap the verse numbers). Signed out, "Save" is offered and only after pressing it does "Sign in to save readings" appear.
- Why it matters: most people choosing an aliyah mean "from this verse to that verse". A broken-up selection is easy to save or print without noticing.
- Fix: when one verse is chosen, the next tap on a later verse offers or makes the range; put "Tap verse numbers to choose them." in the bar's empty state; signed out, replace Save with "Sign in to save" from the start.

**6. Lein shows 100 verses at once, with Word tools at the very bottom**
- Page: /read, Lein, phone.
- What happened: "Verses 1–100 of 126" in one column about 20,000 px tall at 390 px. Each word is its own tab stop (about 1,400 before the page controls). Tapping a word selects it, but the Word tools panel that shows its meaning sits after the last verse; opening it scrolled me to y ≈ 22,000. "Previous text page" and "Next text page" are only at the bottom.
- Why it matters: on a phone the word you tapped and its card are a long scroll apart; keyboard users must tab through every word to reach anything after the text.
- Fix: open the same word card bottom sheet that Learn uses (it already works well); make the words one tab stop with arrow keys inside (roving tabindex); fewer verses per page on phones, or page controls at the top too.

**7. Screen readers never hear the Hebrew word**
- Page: /read, Lein and Study.
- What happened: each word's accessible name replaces the word: "Hear whole verse Genesis 12:1; select word 1 for tools" (Lein), "Open word 1 of Genesis 12:1" (Study).
- Fix: keep the word as the name (it already has `lang="he"` around it) and move the action into `aria-describedby`, for example "word 1 of 14, Genesis 12:1".

**8. Holiday readings are the traditional two-day diaspora list**
- Page: /read, Choose a reading, "Holidays and special Shabbatot".
- What happened: the list includes Rosh Hashana II, Sukkot II, Pesach VIII and Shavuot II (Hebcal's traditional diaspora schedule). CRC is a Reform congregation.
- Why it matters: a family choosing a holiday may get a reading CRC does not read.
- Fix: a question for Daniel, tied to H and ROADMAP Q13 (which High Holy Day and festival readings CRC uses). Until then, at least label the list as the traditional calendar.

**9. /print prints the whole parashah, Torah only**
- Page: /print?reading=vayera.
- What happened: Genesis 18:1–22:24 in full. The options are languages, vowels, text size, notes column, paper, orientation, verse numbers, stand-up spacing and commentary. I found no verse range and no haftarah choice on the page.
- Why it matters: a student who needs their 8 to 12 verses prints five chapters. (Signed in, Choose verses may cover this; signed out it does not.)
- Fix: carry the chosen verses into the print link, or add start and end verse to /print; add Torah / Haftarah.

**10. On the Learn to lein path only the next lesson is a link**
- Page: /learn, phone.
- What happened: every later lesson is plain text with an empty circle. Nothing says it is locked or why. Yet each lesson opens by URL (I opened /learn/torah-etnachta directly).
- Why it matters: a returning or older learner who already knows sof pasuk cannot skip ahead, and the list looks broken.
- Fix: either link every lesson (the prerequisites are advice, as "Best after The two endings." already is for Haftarah), or add a short line such as "Opens after Etnachta."

**11. The haftarah blessings link lands on Mi Shebeirach**
- Page: /read → "Haftarah blessings: siddur pages 23–24" → https://siddur.centralreform.org/?book=legacy-beit-mitzvah&p=23.
- What happened: page 23 opens at its first item, Mi Shebeirach. The Blessing Before the Haftarah Reading is further down the same page. The Torah blessings link (p. 22) opens correctly at "Blessing Before the Torah Reading", in about 5 seconds.
- Fix: deep-link to the prayer's anchor on the page, if the web siddur exposes one; otherwise name it in the label ("page 23, after Mi Shebeirach").

**12. The blessings links vanish for any other reading**
- Page: /read?reading=vayera.
- What happened: the siddur blessings links show for this week only. Choosing Vayera removes them, though the blessings are the same.
- Fix: show them for every Torah and haftarah reading (CRC only, as now).

**13. The reading starts below the fold, and "Start reading" only scrolls**
- Page: /read, phone and desktop.
- What happened: at 1280x900 the first verse begins at y = 826; on the phone after about a dozen controls. "Start reading" scrolls 600 px and leaves keyboard focus on the button.
- Fix: move focus to the reading when Start reading is pressed; consider folding Previous week / Next week / Find a date into Choose a reading on phones.

**14. Trope chart copy speaks to developers and to signed-in users**
- Page: /trope-chart.
- What happened: Unicode code points under every sign ("U+0594"); the poetic accents (ole, dehi, iluy, atnach hafukh) that never occur in a Torah or haftarah reading; the credit line "Phrase families and colors: haftarah / portal trope catalog"; the header link "Return to workspace" for a signed-out visitor; "Chart ready to print." as a standing status.
- Fix: drop the code points from the screen (keep them in print if wanted), move the poetic accents to a closed "Other signs" section, rename the header link "Back" or "This week's reading", drop the status line.

### Polish

**15. Word card details.** Glosses carry source formatting ("and/ he said", "in/ beginning", "first: beginning"). The credit ends "Normalized into selected-word facts." The "This word elsewhere" snippets drop the maqaf ("אֶל אַבְרָ֔ם"). Fix: clean the gloss separators, cut the last credit sentence, keep the maqaf.

**16. Rashi's English is the old Silbermann translation** ("GET THEE OUT (literally, go for thyself)") beside JPS 2023 gender-sensitive verse text. The voices clash. Fix: note the translation and its date in the credit, or prefer a modern Rashi English where Sefaria has one licensed.

**17. Stray separator.** The "·" between the two blessings links wraps onto its own line at both widths. Fix: drop the dot and stack the links, or keep them on one line.

**18. Identical control names.** Every verse has "More on this verse" and "Compare" with no verse in the name; the reading picker has three buttons called "Open". Fix: add the verse ("More on Genesis 12:1") and the picker section ("Open parashah") to the accessible name.

**19. Sign-in wording and chrome differ by page.** Home and /sign-in offer "Continue with Google" and "Continue with Google in this window" side by side; /account says "Continue to Google sign-in". /sign-in and /trope-chart drop the blue header and its Sign in link. Fix: one Google button label everywhere; explain the second only if it is needed ("Use this if the Google window doesn't open."); one header.

**20. /learn has no Sign in.** The header has none, and "Progress is saved on this device. Sign in to keep it." is plain text. Fix: make "Sign in" in that line a link.

**21. Spelling and naming drift.** "colour" in the first lesson, "Colors" in /read; "The Shema" in the lesson, "Sh'ma" in the siddur; "Lech-Lecha" (Hebcal) beside "Lech L'cha" (Women's Commentary); "sof pasuk" beside "silluq / sof pasuq" on the chart. Fix: pick one spelling per word and add it to the tone check.

**22. Drill feedback is visual only.** After a wrong answer only a check mark on the right answer appears; nothing is announced (no live region). Fix: announce "That one was different tune." or similar in a polite live region.

**23. Quick ten.** No position ("3 of 10") on screen. On a direct load the Hear it button looked faded and "playing" before any tap; check iPhone Safari, which blocks sound without a tap. The tab title is "Quick ten | Learn to lein" without "| CRC Torah".

**24. Small targets.** The Lein verse-number button is 16x36 px; the header "CRC Torah" link is 87x28. Words in the reading are 38 px tall, which is acceptable for inline text. Fix: pad the verse number to 44x44 without moving the text.

**25. Focus after navigation.** After choosing a reading, focus lands on the page body rather than the new heading. (The Study panel, the word card and Learn steps all handle focus well.)

**26. The Choose verses bar** is 134 px tall and sticky on a 844 px phone, about a sixth of the screen. Fix: one row (count and Save), with Clear and Cancel behind a menu.

**27. New-tab links.** The siddur links open a new tab with no cue. Fix: add "opens in a new tab" to the label, or open in the same tab.

---

## Accessibility checks

| Check | Result |
|---|---|
| Keyboard focus visible | Good in light mode: 3 px outline, 4 px offset, dark blue on light, yellow on the blue Learn header. Fails in dark mode on /read verse numbers (finding 4). |
| Labels on controls | Good on /print (every radio and checkbox labelled, 48 px rows), Learn icon buttons ("Hear Genesis 1:1"), word card Close. Problems: Hebrew words named by their action (7), repeated identical names (18). |
| Contrast | Light mode passes on /, /read, /learn, a lesson and /trope-chart (scripted check of every text node). Dark mode fails on the trope chart (2) and /read verse numbers (4). |
| 44 px targets | Nearly all buttons are 44–60 px tall. Exceptions: verse number 16x36, header home link 87x28 (24). |
| Reduced motion | A global `prefers-reduced-motion` rule turns off transitions and animations, plus component rules for tabs and Learn. Pass. |
| Hebrew rendering | Noto Serif Hebrew, 32 px in the reading, larger in lessons. Nikud and trope legible; right-to-left order correct, including the paseq in Deut. 6:4 and the syllable split in the word card (בְּ / רֵא / שִׁית). Phrase colouring matched the accents in every verse I checked (Gen. 1:1, 12:1–12, 18:1). |
| No horizontal scroll at 390 px | Pass on every page checked. |
| Escape and focus return | The word card closes on Escape and returns focus to the tapped word. Pass. |
| noindex | `noindex, nofollow` present. Pass. |

## House tone in visible copy

- Sentence case: yes, throughout.
- Exclamation points: none in interface copy. The only ones are inside JPS scripture ("Knead and make cakes!"), which is correct.
- Pep talk: none. Done screens state what you can now do ("You can hear the end of a verse coming and know the mark that ends it."). Good.
- Streaks, scores, badges: none shown. Closest is "Can hear: 3 of 10 Torah phrases · 0 of 11 haftarah phrases" on /learn. It reads as a count of lessons, not a score; leave it, but don't let a service course copy it as "prayers mastered". The page also says "About ten short phrases" beside "10" and "11"; harmless.
- "Beta": no beta label anywhere. Pass.
- Jargon that slipped through: "Normalized into selected-word facts", "portal trope catalog", "Return to workspace", code points (14, 15).

---

## A1 walk: /learn signed out at phone width (390x844)

This completes A1's pending item.

- **Home.** One "Next" card (pill, title, one-line summary, Start, "about 4 minutes"), then "Can hear: 0 of 10 Torah phrases · 0 of 11 haftarah phrases", Trope chart and About links, "Progress is saved on this device. Sign in to keep it.", then the path: Torah units ("How a verse is built", "The two endings", "Inside the verse", "The rarer phrases", "Your first verse") and Haftarah units ("Best after The two endings."). Each lesson row has a small melody-contour icon. Done rows read "done" to screen readers; only done lessons and the next one are links (finding 10). No Review link appeared on the first day.
- **A lesson** (/learn/intro-phrases, then Sof pasuk, Etnachta, Zakef). A blue header with Close ("Back to the path", 56 px) and the title, and a step rail ("Step 1 of 6", labelled for screen readers). Steps: Hear it (the verse in phrase colours, mark chips, Hear it button, the listen-for line, the body), In verses (three or four examples each with its own Hear button), then drills, then Done. One full-width Next button pinned to the bottom. Next is disabled in a drill until you answer. Drills seen: Same tune or different (two answer buttons, then both phrases revealed with their family and ref), Tap the word where the verse rests, Which half, Which phrase is this (family chips), Tap the phrase you heard, Which one is yetiv (look-alikes). A run of right answers skips the remaining drills (Sof pasuk ended after step 4 of 6). The Done screen says what you can now do, shows "In this week's reading" with three matching phrases from Lech-Lecha and "Find three more.", then "Next: Etnachta", "Start next lesson" and "Back to the path".
- **The word card.** Tapping a Hebrew word in a lesson opens a bottom sheet over the lesson: the word large, "Genesis 1:1 · Word 1 of 7", Meaning in this verse, Syllables and stress, Grammar, Dictionary senses, credit. It plays nothing. Close is 44 px; Escape closes it and returns focus.
- **Quick ten.** It appeared on the home page after three phrase lessons were done, as a row: "Quick ten: ten phrases, one after another, about 2 minutes". It plays a phrase on open, shows no text, and offers three family chips (full width, 60 px). A miss shows "That one is sof pasuk. Here is etnachta for comparison." with the verse and a "Whole verse" button, then moves on by itself. "Stop here" is offered during the run. The end screen: "Done. The ones you missed come back in review." and "Back to the path". No position count (finding 23).
- **Review** (/learn/review) opened by URL and ran the same hear-and-name drill.
- **Progress.** Kept in this browser: done lessons were ticked on return, and "Can hear" went to 3 of 10.
- **About** credits PocketTorah recordings, the Miqra according to the Masorah text and the Binder and Avery Standard Reform cantillation, and says "Your cantor's or tutor's version of a phrase wins over the recording's."
- **For a service course**: the lesson frame (header, step rail, one forward action, pinned Next), the bottom-sheet word card and the Done screen's "In this week's reading" pattern all carry over well. The path list needs a clearer locked state before it is reused (finding 10). The first lesson's failure message must distinguish a text failure from a recording failure (finding 1), since a service course will have text and no recordings.

---

## Top 5 for 2.0

1. Stop ordinary browsing from tripping the rate limit: CDN-cache the public text and commentary routes, and give a 429 its own honest message (1).
2. Fix dark mode: trope-chart signs and /read verse numbers and their focus ring (2, 4).
3. Show an uninvited newcomer how to ask for an account from the sign-in screen (3).
4. Make Choose verses build the range people mean, say how to choose, and carry the chosen verses into /print (5, 9).
5. Open the word card next to the word in Lein, as Learn does, and name each Hebrew word by the word for screen readers (6, 7).
