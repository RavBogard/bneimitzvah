# Questions for Daniel, and his answers

Claude Code reads this first. Answers are recorded as Daniel chose them (multiple-choice picks are quoted as the option label he selected).

## Batch A: wording for slices being built now (answered 2026-10-23)

### A1. The two account emails (1.4 part 2; plan `docs/superpowers/plans/2026-10-22-accounts-1-4.md` §4)

- Asked: keep the proposed request and approval emails, or edit?
- Recommendation given: keep both; no requester name in the email, so no member data leaves the app.
- **Daniel, 2026-10-23:** "Keep both (Recommended)"
- **Resulting strings (unchanged from the plan):**
  - Request email subject: `An account request for {productName}`
  - Request email body: `Someone has asked for a {productName} account. Review account requests: {origin}/workspace/accounts. You receive this because you approve accounts for {name}.`
  - Approval email subject: `Your {productName} account is ready`
  - Approval email body: `Your account request was approved. Sign in with this email address to save readings and keep your own translation and notes. {origin}/. If you did not ask for an account, you can ignore this email.`

### A2. The request screen and the approver page (same plan, §5)

- Asked: keep, or edit?
- Recommendation given: keep all.
- **Daniel, 2026-10-23:** "Keep all (Recommended)"
- **Resulting strings (unchanged from the plan):**
  - Heading: `Ask for an account`
  - Intro: `An account keeps your own readings, translation and notes. Everything else on CRC Torah is open without one.`
  - Fields: `Your name`; `What would you like to work on? (optional)`
  - Pending: `Your request is in. You'll get one email when it's approved.`
  - Decline confirmation: `Decline removes this request and sends nothing.`

### A3. The sign-in email with a code (1.5; plan `docs/superpowers/plans/2026-10-22-installable-sign-in-code-cutover.md` §10, §2.2)

- Asked: the proposed lines and button, with a revised phishing line.
- Recommendation given: keep 6 digits and 5 minutes (6 digits is what iOS Mail/Safari and Gmail recognise and offer to fill or copy); keep the button as "Email me a sign-in link"; replace "Don't share the code with anyone." with a line that names the read-me-your-code trick.
- **Daniel, 2026-10-23:** "Use this version (Recommended)"
- **Resulting decision:** 6 digits, numeric, 5-minute expiry, as plan §2.2. Button label unchanged: `Email me a sign-in link`.
- **Resulting email lines, in order:**
  1. `Open this link to sign in: {link}`
  2. `Or enter this code in the CRC Torah app: {code}`
  3. `The link and the code work once, for 5 minutes.`
  4. `No one from CRC will ever ask you for this code. Don't read it to anyone or type it anywhere but CRC Torah.`
  5. `If you did not request this message, you can ignore it.`
- Change from the plan: line 3 drops "Don't share the code with anyone."; line 4 is new. The full sign-in-code research report (`research/sign-in-codes.md`) follows; if it finds anything that changes this, it will be raised as a new question, not applied silently.

## Batch B: the installable app (A1) (answered 2026-10-23)

### B4. Install and offline wording (plan `2026-10-22-installable-sign-in-code-cutover.md` §3.9)

- Asked: corrected strings, after research found iOS 26/27 moved Safari's Share button and iPhone and iPad differ (see `research/pwa-offline.md`).
- Recommendation given: use the corrected strings.
- **Daniel, 2026-10-23:** "Use these (Recommended)"
- **Resulting strings:**
  - Install hint: `Install CRC Torah on this device to keep this week's reading and recordings for use offline (up to about 40 MB).`
  - iPhone steps: `In Safari, tap Share, then scroll to Add to Home Screen. If you don't see Share, tap the menu button next to the address bar first. Keep Open as Web App on, then tap Add.`
  - iPad steps: `In Safari, tap Share, then View More, then Add to Home Screen. Keep Open as Web App on, then tap Add.`
  - Pill: `Offline · saved until {date}` (no final period)
  - Expiry: `Saved readings stay on this device for 14 days after you last opened CRC Torah online. Open it with a connection to renew them. If the device runs low on space, it may remove them sooner.`
- Meaning fixed by this: the 14 days run from the last successful online open of the app.

### B5. The app icon (options in `icons/ICON-OPTIONS.md`)

- Asked: pick one of four (trope contour, yad, scroll, open book).
- Recommendation given: option 1, trope contour.
- **Daniel, 2026-10-23:** "2 Yad"
- **Resulting decision:** option 2, the yad. Geometry in `icons/ICON-OPTIONS.md`; SVG at `icons/option-2-yad.svg`. Note from the render check: it is the thinnest of the four at 48 px, so keep its stroke widths as drawn or heavier, never thinner.

### B6. Parents' view of their child offline in 1.5

- Recommendation given: no; switching children would need a purge on every switch.
- **Daniel, 2026-10-23:** "No, not in 1.5 (Recommended)"
- **Resulting decision:** no parent offline view of a child in 1.5.

## Batch C: sessions and logistics (answered 2026-10-23)

- **C7. Listening round (about 10 minutes):** sheet ready in `LISTENING-ROUND.md`; session not yet run.
- **C8. Who does the DNS and Google steps:** **Daniel:** "A CRC staff helper". Message drafted in `FORWARD-MESSAGE.md` with a [helper's name] placeholder; Daniel sends it.
- **C9. Phone for the real-phone check:** **Daniel:** "Android". `PHONE-CHECK.md` runs the Android (Chrome) install path; the iOS steps stay in the app copy (B4) for other users.
- **C10. Who records the trope song:** **Daniel:** "I will". Sheet in `TROPE-SONG-SESSION.md`; files go to `C:/private/`, never a repo.
- **Extra (from the Learn to lein research). Geresh alone vs azla by ear:** recommendation given: no, reading only. **Daniel:** "No, reading only (Recommended)". **Resulting decision:** the azla/geresh look-alike pair is a reading-only item; no listening version.

## Batch D: after 1.5 (answered 2026-10-23, except D-5)

- **D11. The second congregation:** recommendation given: that congregation's rabbi as first contact; day one is the public pages plus accounts, with the Beit Mitzvah workspace later. **Daniel:** chose the recommended option (the option label named the congregation by its rabbi's first name; kept out of this file). **Resulting decision:** first contact is the second congregation's rabbi; day one = public pages + accounts; Beit Mitzvah workspace later.
- **D-a. Deployment shape:** **Daniel:** "One deployment (Recommended)". **Resulting decision:** one deployment serving several congregations, each by its own web address, once the two-tenant isolation suite passes.
- **D-b. JPS 2023 for another congregation:** recommendation given: ask JPS first. **Daniel:** "Yes, it's covered". **Resulting decision:** another congregation may show JPS 2023 under the existing arrangement; no JPS note needed.
- **D12. What 2.0 is for:** proposed: out of beta, D'var Torah, custom siddur and supplement, notifications Daniel chooses, indexing of public pages only. **Daniel, verbatim:** "We have the siddur available via shireishabbat repo/ web-siddur, already. Beit mitzvah siddur. Should have proper integration . Should have ways for students to learn the service". **Resulting decision:** 2.0 does not build a siddur. It integrates the existing web siddur (shirei-shabbat repo, including its Beit Mitzvah volume) properly into the portal, and adds ways for students to learn the service. The other items (out of beta, D'var Torah, chosen notifications, public-page indexing) were not objected to and stand as drafted.
- **D-5. 2.5 audio:** recommendation given: generated chant per trope system after its own blind review, with a recording by Daniel or a song leader as fallback; blessings as text plus a CRC Music link. **Daniel:** "Generated chant, with a fallback (Recommended)". **Resulting decision:** as recommended.

## Batch E: alignment questions raised by the research (answered 2026-10-23)

- **E1. Naming for other congregations** ("CRC Torah" is hard-coded in approved strings and emails). **Daniel:** "Their own name, set per congregation (Recommended)". **Resulting decision:** `productName` is a per-congregation setting (for example "{Congregation} Torah"); CRC credit stays in the footer. Make it a setting now; every approved string already uses `{productName}` or should.
- **E2. Learning the service in 2.0.** **Daniel, verbatim:** "A course, that also teaches about the prayers, using my understanding for each, pulled from shireishabbat and shirei tfilah repos". **Resulting decision:** a course in the Learn to lein pattern for the service. Each prayer also gets teaching about the prayer itself, drawn from Daniel's own commentary and framing in the shirei-shabbat and shirei-tfilah repos, not written fresh by Claude.
- **E3. Courtesy note to Sefaria.** Recommendation given: yes. **Daniel:** "No". **Resulting decision:** no note. `SEFARIA-NOTE.md` stays as an unused draft. Claude Code still adds an identifying User-Agent and the CC BY credit on More on this verse (see `research/sefaria-upstream.md`).

## Batch F: alignment before handing back to Claude Code (answered 2026-10-23)

- **F1. Who approvers say yes to.** **Daniel:** "Anyone who asks in good faith (Recommended)". **Resulting decision:** accounts are open to anyone, member or not; approvers decline only spam or abuse. The approver note in `ANNOUNCEMENTS.md` is corrected to match.
- **F2. Search indexing.** **Daniel:** "Index public pages at the 1.5 beta tag (Recommended)". **Resulting decision:** at the 1.5 beta tag, `/read`, `/learn` and `/trope-chart` become indexable; signed-in pages and workspaces stay noindex. This applies MISSION's "noindex until beta" and replaces the roadmap draft's 2.0.
- **F3. Learn to lein offline.** **Daniel:** "Yes, in 1.5 (Recommended)". **Resulting decision:** the installed app also keeps the Learn to lein course (lessons and their clips) offline, under the same 14-day rule as the other packs. Course progress saved to the account syncs when the app is back online.
- **F4. Where the translate drill lives.** **Daniel:** first picked "Lein and Study both (Recommended)", then changed it: "Translate drill just in lein". **Resulting decision:** the drill is in Lein's verse tools only, as the plan has it. Nothing is added to Study. While the drill is on in Lein, the English is hidden on every verse (`research/translate-drill.md`).
