# Open questions, research and planning for CRC Torah (Cowork handoff)

2026-10-23. Claude Code wrote this for a Cowork thread.

## Daniel's request

Daniel, verbatim: "create a handoff for cowork which will ask me questions that are open, do research that is needed, etc... Do whatever planning makes sense etc... That we can offload."

**Your job.** Claude Code is building releases 1.4 and 1.5 right now. You take on the work around it:
1. Ask Daniel the open questions, in short batches. Record his answers in his words.
2. Do the research the next slices need.
3. Draft the planning and the copy that don't need the codebase.

Claude Code reads your folder and builds from it. You deliver decisions, research and finished text, not code.

**Where things are.** Every path is on Daniel's Windows machine.
- **Read, don't edit:** the repo at `C:/Users/dsbog/bneimitzvah-study/` (branch `main`).
- **Write only to** `C:/Users/dsbog/cowork-offload/`. Create it if it is missing. It is outside every Git repository; keep it that way.

**The site.** It is live at https://beitmitzvah.centralreform.org and moving to torah.centralreform.org.
- Readable signed out: `/read` (Lein and Study), `/learn`, and `/trope-chart`.
- The plans you'll cite are listed in §6.

---

## 1. Where the project stands (2026-10-23)

| Release | State |
|---|---|
| 1.0–1.1, the B'nei Mitzvah portal | Live |
| 1.2, Lein and Study with Rashi inline | Live, v1.2.0 |
| 1.3, any reading by name or ref, nine more Works, Compare translations, More on this verse | Live, v1.3.0 |
| 1.4, accounts | Part 1, saved readings, is live. Part 2 is being built: account requests, the Member role, approvers and two emails. Part 3, the Yours row, stars and the translate drill, is next. |
| 1.5 beta | Learn to lein is live at `/learn`. The rest is to come, in this order: course progress saved to the account (being built), the typed sign-in code (being built), the switch to torah.centralreform.org, the installable app with 14-day offline reading, and the beta tag. |
| The generated chant voice | Waits until 1.5 is done. Nothing generated reaches a student before Daniel's G3 blind review. |

---

## 2. Rulings you must work within (binding)

| Area | Ruling |
|---|---|
| Tone, for every learner-facing or member-facing string | Sentence case, plain verbs, adult-respectful; the same words serve a 12-year-old and a 60-year-old. No exclamation points, emoji, mascots, confetti, streaks, badges, scores, pep talk ("great job", "awesome", "you got this"), slang or youth-group voice. |
| Notifications | Off. The only emails are the two account emails (a request goes to the approvers, an approval goes to the new member) and the existing sign-in email. |
| Privacy | Members' saved readings, notes and translations are private even from staff and Daniel. Student and family data never leaves the app. Never put a real person's name, email or data in your files. |
| Licences | "Use all, don't stress": any text Sefaria serves may be shown live with its edition, licence and Sefaria credit. Nothing licensed goes into any repo. |
| Audio | Human PocketTorah recordings (CC BY-SA). No recording of learners of any kind. The trope-song activity waits for a recording by Daniel or a CRC song leader. |
| Money | No new paid service or spend without Daniel. Flag anything that would cost money; don't sign up for anything. |
| Outward actions | You send nothing to anyone. No email, post or form: you write drafts and Daniel sends them. |
| Daniel's time | Questions come in batches of at most five, each answerable in a line, each with your recommendation first. Listening or device sessions are 15 minutes at most. |

---

## 3. Questions to ask Daniel

Ask in this order. Batch A unblocks code being written today. Give your recommendation first in each, with a one-line why. Record each answer verbatim in `QUESTIONS.md`, with the date.

### Batch A: wording for slices being built now

1. **The two account emails** (1.4 part 2). Proposed, from `docs/superpowers/plans/2026-10-22-accounts-1-4.md` §4:
   - Request email:
     - Subject: "An account request for {productName}".
     - Body: "Someone has asked for a {productName} account. Review account requests: {origin}/workspace/accounts. You receive this because you approve accounts for {name}."
   - Approval email:
     - Subject: "Your {productName} account is ready".
     - Body: "Your account request was approved. Sign in with this email address to save readings and keep your own translation and notes. {origin}/. If you did not ask for an account, you can ignore this email."
   - Ask: keep them, or edit?
2. **The request screen and the approver page** (same plan, §5):
   - the heading "Ask for an account";
   - the line "An account keeps your own readings, translation and notes. Everything else on CRC Torah is open without one.";
   - the fields "Your name" and "What would you like to work on? (optional)";
   - the pending line "Your request is in. You'll get one email when it's approved.";
   - the decline confirmation "Decline removes this request and sends nothing."
   
   Ask: keep, or edit?
3. **The sign-in email with a code** (1.5). Proposed, from `docs/superpowers/plans/2026-10-22-installable-sign-in-code-cutover.md` §10:
   - "Open this link to sign in: {link}"
   - "Or enter this code in the CRC Torah app: {code}"
   - "The link and the code work once, for 5 minutes. Don't share the code with anyone."
   - "If you did not request this message, you can ignore it."
   - The button: "Email me a sign-in code", or keep "Email me a sign-in link".
   
   Bring your research from §4.2 to this question: the code format, autofill, and the phishing line.

### Batch B: the installable app (A1)

4. **Install and offline wording.** Proposed:
   - Install hint: "Install CRC Torah on this device. This week's reading and recordings stay available offline (about 25 MB)."
   - iOS: "In Safari, tap Share, then Add to Home Screen."
   - Pill: "Offline · saved until {date}."
   - Expiry: "Saved readings last 14 days without a connection. Connect to renew them."
   
   Check the iOS steps against your research in §4.1 first. Safari's menus change.
5. **The app icon.** Show Daniel three to five options from §5.1, as images or as precise descriptions, and ask him to pick one or redirect.
6. **Parents' view of their child offline in 1.5.** Recommended no: switching between children would need a purge on every switch.

### Batch C: sessions and logistics (offer a time; don't block on these)

7. **The Learn to lein listening round, about 10 minutes.** Run it with him as a guided session using §5.3. He taps Hear it in each of the 21 family lessons and answers two things: does the cut clip a word, and does the bold "listen for" line match what the reader sings? Turn his notes into edit instructions per lesson.
8. **The forwarded DNS and Google steps** (`docs/planning/2026-10-22-crc-torah-cutover/FORWARD-STEPS.md`).
   - Ask who will do them and roughly when.
   - Draft the forwardable message from §5.4. Daniel sends it.
9. **A real-phone check, 15 minutes, once the app installs on torah.** Use the script from §5.5. Ask which phone he'll use (iPhone and Safari version).
10. **The trope-song recording, later.** Ask whether Daniel or a CRC song leader will record it, and roughly when. Hand him the session sheet from §5.6.

### Batch D: after 1.5 (planning input; ask once §5.7 is drafted)

11. **The second congregation.** Which congregation and contact role first ("eg josh eventually for his congregation"), and what they need on day one.
12. **What 2.0 is for.** Confirm or reorder the roadmap draft from §5.7.

Do not ask about anything already ruled in §2, or in MISSION.md and STATE.md (`docs/planning/2026-10-15-kickoff/`). Read those first. If a question turns out to be already answered, record where, and skip it.

---

## 4. Research to do

Write each as a short report: findings first, then sources with dates. Flag anything that contradicts a plan, citing the plan's section. Prefer primary sources (WebKit, Chromium and MDN docs, standards, vendor docs) and say how recent each is.

### 4.1 Installed web apps on iOS and Android in late 2026 (feeds A1)
- **Storage and eviction:**
  - Storage quotas, and eviction for Home Screen web apps against Safari tabs.
  - Whether a Home Screen app's caches survive 14 days without use.
  - `navigator.storage.persist()` behaviour on each platform.
- **The service worker:** its lifetime, and whether audio cached by it plays offline. Cover Range requests for cached audio, and the Media Session API on the iOS lock screen.
- **Installing:** the current iOS steps for Add to Home Screen, Android's install prompt rules, and `beforeinstallprompt` support.
- **Icons:** the manifest icon rules, including the maskable safe zone and `apple-touch-icon` sizes.
- **Check against the plan:** read §3 and §6.4 of the installable plan, and list every assumption it makes that your findings contradict.

### 4.2 Sign-in codes in email (feeds the code slice)
- **Code format:** current practice on length, digits only or not, and expiry.
- **Autofill:**
  - `autocomplete="one-time-code"`;
  - the origin-bound code line for WebOTP and SMS (`@torah.centralreform.org #123456`), and whether email clients use anything similar;
  - how Apple Mail, Gmail and iOS offer codes from email.
- **Phishing:** current practice on the "read me your code" relay attack, and the email wording that best defends against it.
- **Recommendation:** make one concrete recommendation for Batch A question 3.

### 4.3 The translate drill (1.4 part 3)
- **The spec** (§3.6 of `docs/superpowers/specs/2026-10-22-leyning-platform-design.md`): "Hide the English, read the Hebrew aloud in your own English, then reveal JPS and your draft." It is open to everyone and saves nothing.
- **Research:** how Bnei Mitzvah and adult learners are taught to translate a Torah verse; what scaffolds help; how others handle a "reveal" without making it a test.
- **Deliver:** one screen design with its strings, and three to five small variations Claude Code could add later. Stay within the tone rules.

### 4.4 Sefaria as an upstream (courtesy and resilience)
- **The traffic:** the site now reads text, links, commentary, translations and any citation live from Sefaria's public API. It is cached at our CDN: commentary for 30 days, links for a week, and definite misses for an hour.
- **Research:**
  - Sefaria's current API terms, rate guidance and attribution expectations;
  - whether projects like this one usually let Sefaria know.
- **Deliver:** your findings, plus a short courtesy note Daniel could send if you recommend it. It's a draft only.

### 4.5 Learn to lein, the next activities
- **Where things stand:** the v1 course is live. Read `docs/planning/2026-10-22-learn-to-lein/` (COURSE.md, ACTIVITIES.md) and `src/lib/learn/lessons.json` in the repo.
- **Write the content** for the "later" activities that need no new data, following the item rules at the end of ACTIVITIES.md:
  - look-alikes (pashta and kadma, mahpach and yetiv, geresh and azla);
  - which half of the verse;
  - quick ten.
- **Schema additions:** propose them in `lessons.json`'s own style. Don't edit the repo file.
- **Your sources:** you can't run the engine, so mark every example as "proposed; Claude Code verifies against the engine". Use only verses already in lessons.json, or ones Claude Code can check.

---

## 5. Planning and drafts to write

### 5.1 App icon options
Three to five shapes-only designs on the site's palette.
- **Palette:** lake blue `#1E5AA8`-ish, white and marigold, as an accent fill only. Read DESIGN.md in the repo for the exact tokens.
- **Constraints:**
  - no letters or fonts, because the icon is drawn from shapes at build time;
  - legible at 48 px;
  - safe inside the maskable zone;
  - nothing that reads as a mascot.
- **For each option:** describe it precisely enough to draw (geometry, proportions, colours), and give one line on what it evokes. Examples to consider: a trope contour, a yad, a scroll edge, an open book.
- **Images:** if you can render images, include PNG previews in your folder. Don't commit anything.

### 5.2 Answers file for Claude Code
`QUESTIONS.md`: each question, Daniel's verbatim answer, the date, and the resulting string or decision. Claude Code reads this first.

### 5.3 The listening round sheet
- One row per family lesson, giving the lesson, its live link and the example reference.
- The list is in the PR #33 STATE entry, or can be built from `src/lib/learn/lessons.json` (each lesson's first example).
- Add a column for each of Daniel's two answers, and a short "say it like this" note on what counts as a clipped word.

### 5.4 Forwardable DNS and Google message
Rewrite `FORWARD-STEPS.md` as a plain message for a non-developer helper:
- what to change, and where;
- how to confirm it worked;
- "reply when done".

Daniel sends it.

### 5.5 Real-phone check script, 15 minutes
Write it from the installable plan's §6.4, and extend it to cover:
- Learn to lein: one lesson, review, and Your first verse with Open in Lein;
- `/read`, with Study, Compare and More on this verse;
- Save and My readings, if he's signed in;
- install, airplane mode, and the 14-day pill.

Each step is one line, with a pass/fail box and a place for a note.

### 5.6 Trope-song recording session sheet
- What to sing, in what order, for the Torah and the haftarah tunes, and the trope-name sequences ACTIVITIES.md §15 needs.
- Pace, take length, and how to name the files.
- Where the files go: `C:/private/`, never a repo.
- That the recordings stay private until Claude Code wires them in.

### 5.7 Roadmap draft: 2.0 and 2.5
Draw on everything already ruled (MISSION.md, STATE.md, the leyning platform spec's later sections, and the voice build plan):
- **The second congregation:** what must be configurable per congregation, what data the congregation supplies, and what Claude Code must check about tenant isolation.
- **Release 2.5:** megillot, High Holy Day trope and blessings.
- **The generated chant voice:** its milestones, from Experiment 1 to Daniel's G3 review. Plan the G3 blind review as a 15-minute form with its pass rule: at least 95% "fine" and zero "would teach wrong".
- **Questions:** list the open questions each release raises. Those feed Batch D.

### 5.8 CRC announcement drafts (drafts only)
- A short congregation-facing announcement of CRC Torah: Lein, Study, Learn to lein, and how to ask for an account.
- A one-paragraph note for tutors and approvers on approving accounts.
- Both within the tone rules. Daniel decides whether and when to send.

---

## 6. Files to read in the repo

| File | Why |
|---|---|
| `docs/planning/2026-10-15-kickoff/MISSION.md`, `STATE.md` | Binding rulings and current state |
| `docs/superpowers/specs/2026-10-22-leyning-platform-design.md` | The product spec for 1.2–1.5 |
| `docs/superpowers/plans/2026-10-22-accounts-1-4.md` | Accounts, the emails and the screens |
| `docs/superpowers/plans/2026-10-22-installable-sign-in-code-cutover.md` | The sign-in code, the switch and the installable app |
| `docs/planning/2026-10-22-crc-torah-cutover/FORWARD-STEPS.md` | The DNS and Google steps |
| `docs/planning/2026-10-22-learn-to-lein/` and `src/lib/learn/lessons.json` | The course |
| `docs/superpowers/research/2026-10-22-voice/VOICE-BUILD-PLAN.md` | The voice track |
| `DESIGN.md`, `PRODUCT.md` | The visual world and the product voice |

---

## 7. Deliverables (in `C:/Users/dsbog/cowork-offload/`)

- **`HANDOFF-TO-CLAUDE-CODE.md`.** What's done, Daniel's decisions in one table, and what each decision changes in which plan section, in the order Claude Code should act on them.
- **`QUESTIONS.md`.** Every question, and Daniel's answers verbatim.
- **Research reports:** `research/pwa-offline.md`, `research/sign-in-codes.md`, `research/translate-drill.md`, `research/sefaria-upstream.md` and `research/learn-next-activities.md`, plus `SOURCES.md`.
- **Drafts and sheets:**
  - `icons/` (options and any previews);
  - `LISTENING-ROUND.md`, plus the converted edit list;
  - `FORWARD-MESSAGE.md`;
  - `PHONE-CHECK.md`;
  - `TROPE-SONG-SESSION.md`;
  - `ROADMAP-2.md`;
  - `ANNOUNCEMENTS.md`;
  - `SEFARIA-NOTE.md`, if you recommend one.

**Deliver incrementally.** Write `QUESTIONS.md` and `HANDOFF-TO-CLAUDE-CODE.md` as soon as Batch A is answered, because Claude Code is waiting on those strings. Then add the rest as they're done.

**Before you finish:** grep every string you wrote for "!", emoji and the banned words in §2. Check that no file holds a real person's name or email other than Daniel's role.

---

## 8. Kickoff prompt (paste into Cowork)

> Read `C:/Users/dsbog/bneimitzvah-study/docs/planning/2026-10-23-cowork-offload/COWORK-HANDOFF.md` and do what it says. Start by reading MISSION.md and STATE.md, then ask me Batch A (three questions, your recommendation first in each). Write my answers to `C:/Users/dsbog/cowork-offload/QUESTIONS.md` and `HANDOFF-TO-CLAUDE-CODE.md` right away, then carry on with Batch B, the research and the drafts. Never edit the repo, send anything to anyone, or spend money.
