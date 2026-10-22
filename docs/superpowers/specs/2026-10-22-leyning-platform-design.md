# CRC leyning platform: one place to lein, learn to lein, and study

2026-10-22. A product vision spec for Daniel's approval. This spec is a plan only: nothing in it is built yet, except where noted.

---

## Settled decisions (Daniel, binding)

These are Daniel's words from 2026-10-22, quoted verbatim.

1. **Scope.** "It will be the way that users can lein and learn to lein at CRC, nut just beit Mitzvah kids. It will also be my ideal way to lein, and to get ready for services every week."
2. **What "one place" holds.** "This includes the ease of opening one place and having the text, the translation, the main commentaries, the main midrashim and halachik implications, etc, as well as everything to get ready to lein and live translate and interpret, which is my way."
3. **Accounts.**
   - "Everyone can create an account and use it and customize readings they want to work on. I'll approve requests. But they can access the whole thing other than saveable customize readings."
   - So everything is open signed out, and an approved account adds only what is saved: your readings, and your own notes and practice.
4. **Not a bimah tool.** "Not for the bima." Everything here serves preparation during the week. Nothing is designed to be used on Shabbat or on the bimah.
5. **The commentary layout.**
   - **The Rashi request.** "Each verse should have the option of seeing Rashi, as an expandable option/default." Then: "The Rashi UI/us can't be obtrusive for most users using it to prep Torah reading."
   - **The layout chosen:** a study view plus a per-verse panel.
   - **Rashi:** English-led, with Hebrew one tap away.
   - **Linking:** a comment lights up the words it explains.
6. **Tikkun.** "There should also be a view with tikkun and regular in columns next to each other, and trope colors should be toggleable on both, always." This is being built now on `claude/tikkun-columns`.
7. **Source.** "Sefaria has Rashi and everything you need."
8. **The weekly page.** "The every week is good." The public weekly reading at `/read` is the base this grows from.
9. **Order.** "Write the full vision spec first." No new feature UI is built before this spec is approved.

**Standing rules that continue unchanged** (MISSION and CLAUDE.md):
- Show rather than hide.
- Human recordings come first.
- Generated chant stays behind G3.
- Never in the repo: licensed text, people data, recordings, model weights or credentials.
- Running costs stay under $10 a month unless Daniel decides otherwise.
- Pages stay noindex until Daniel says.
- Notifications stay off until Daniel says.
- People data stays private.
- Any licence question goes to Daniel.

---

## 1. The idea in one paragraph

Open one page and the week's Torah and haftarah are there, ready for two jobs.

- **Lein** is for getting it into your mouth. It gives you:
  - the pointed text and the tikkun, side by side;
  - trope colours;
  - human recordings with word highlighting;
  - speed control and looping;
  - drills.
- **Study** is for getting it into your head, so you can translate and interpret it aloud. It gives you:
  - the verse with its translation and Rashi;
  - the main commentaries;
  - the midrash on that verse;
  - where the verse lands in halakhah and Talmud;
  - your own translation and notes.

The same page serves a 12-year-old preparing their portion, an adult learning to lein for the first time, a regular leyner getting ready for Shabbat, and Daniel's own weekly preparation. Anyone can use all of it signed out. An approved account saves your readings and your work.

## 2. Who it is for

| Who | Arrives with | Needs most | Today |
|---|---|---|---|
| Beit Mitzvah student (child or adult) | An assigned portion, a tutor, a date | Lein: text, colours, audio, tikkun, practice marks. Study is secondary and must stay quiet | The workspace (built) |
| Adult learning to lein | Interest, maybe a first aliyah coming up | Trope taught from scratch with real recordings; a reading they choose; encouragement without childishness | Not served |
| Regular CRC leyner | This week's aliyah | Fast path to "my verses this week", the tikkun, audio and recall drills | `/read` covers part of it |
| Daniel (rabbi, leyner, translator) | Every week's Torah and haftarah | Everything in one place: text, translations, commentaries, midrash, halakhah, his own translation draft and notes, then leyning prep | `/read` plus Sefaria tabs |
| Tutors | Students | What they have today, plus Study for teaching | The workspace (built) |
| Anyone signed out | A link or curiosity | The whole reading and study experience; no saving | `/read` (built, noindex) |

## 3. Shape of the product

### 3.1 One reading surface, two lenses

Every reading uses one surface, with a two-way switch at the top of the passage: **Lein | Study**. The switch is remembered per person, and it never changes which verses are shown.

| | Lein (default) | Study |
|---|---|---|
| Purpose | Prepare to chant it | Understand it, translate it, interpret it |
| Hebrew | Continuous flowing passage, as today | Verse rows: each verse on its own, with room under it |
| Tools in the toolbar | Colours, English, Tikkun, Size, Hear | Colours, English, Size, Hear, plus **Works** (which commentaries appear inline) |
| Commentary | None in the passage. The selected verse's tools gain a closed "Rashi (n)" disclosure | Rashi inline under every verse, plus a "More on this verse" shelf |
| Tikkun | Menu: pointed text, side by side, or tikkun only (being built) | Off. Study is about meaning |
| Audio | Full player, word highlighting, loop, speed | Same player; Hear still works on every verse |

**Why two lenses and not one toggle.** The two jobs pull the layout in opposite directions.

- Chanting needs a continuous, uninterrupted block of Hebrew. The design system's own rule is that apparatus never sits inside the Hebrew line.
- Studying needs space under each verse.

A single "show Rashi" toggle forces one layout to do both jobs badly. Two named lenses make each layout right for its job, keep Lein exactly as students know it, and make Study discoverable without cluttering anyone's practice.

**Defaults:**
- Students and child practice open in Lein.
- Signed-out visitors open in Lein. The link `/read?lens=study` opens Study directly, for sharing.
- Daniel and other approved adults open in whatever they last used.

### 3.2 Study, in detail

Each verse row, from top to bottom:

1. **The verse.**
   - Hebrew with colours if they're on, the verse number, and Hear.
   - English (JPS) under it when English is on. In Study, English starts on.
2. **Rashi, inline.**
   - It is English-led. Each comment starts with Rashi's quoted words (the *dibbur hamatchil*) in bold Hebrew, then the English.
   - A quiet **Hebrew** control on each comment shows Rashi's own Hebrew in place.
   - Long comments show three lines and a **More** control.
   - Verses Rashi doesn't comment on show nothing. There is no "no comment" filler.
3. **Comment-to-word link** (the signature interaction).
   - Hovering over a comment, or focusing it, underlines the words in the verse that it quotes.
   - Tapping the bold quoted words scrolls to the verse and marks them briefly.
   - Matching compares letters only (vowels and trope stripped) against the verse's word sequence.
   - When there is no exact match, nothing is highlighted. Never guess.
   - Beyond the matched words, this adds no motion, colour or ornament.
4. **More on this verse.**
   - One closed row with counts by kind, for example: Commentary 6 · Midrash 3 · Halakhah 2 · Talmud 1 · Targum.
   - Opening it shows a shelf with one tab per kind. Each item shows the work's name, its author's dates and the first line.
   - Choosing an item opens the text in place, using the existing inline source reader (Hebrew and English, edition and licence credit, Close).
   - **Phone:** the shelf opens inline under the verse.
   - **Wide screens:** it opens as a side panel level with the verse, in the toolbar rail's column, so the text never shifts.
5. **Yours** (signed in, approved).
   - A closed row: **My translation** and **My notes** for this verse, and any comments you've starred.
   - It is visible only to you.

**Works control (toolbar, Study only).**
- A menu that chooses which commentaries appear inline. Rashi is on by default; others can be added inline (Ramban, Sforno and so on).
- The order is set by the congregation defaults that already exist in Settings (the "Rashi or Ramban on Genesis" preference), then by the person.
- At most three works appear inline. Everything else stays in the shelf.

**What "main" means (curation).**
- One verse has about 700 linked texts on Sefaria (Genesis 12:1 has 716). The shelf shows a curated list first and an **All related texts** link second.
- Proposed curated lists, to be confirmed by Daniel:
  - **Torah commentary:** Rashi, Ramban, Ibn Ezra, Rashbam, Sforno, Chizkuni, Or HaChaim, Kli Yakar, Shadal, Rav Hirsch.
  - **Haftarah commentary:** Rashi, Radak, Metzudat David, Malbim.
  - **Midrash:** Midrash Rabbah, Tanchuma, Mekhilta, Sifra, Sifrei, plus any verse-linked midrash Sefaria lists.
  - **Halakhah:** Mishneh Torah, Shulchan Aruch, Sefer HaChinukh (the mitzvah count per verse).
  - **Talmud:** passages that cite the verse.
  - **Targum:** Onkelos for the Torah, Yonatan for the Prophets. These are a direct aid to live translation.
- Every work goes through the licence policy in section 5 before it appears.

### 3.3 Lein, in detail (mostly built)

What exists today and stays:
- The continuous Hebrew passage.
- Colours.
- Words and verses that play from the text.
- The inline player with Repeat, Practice and Speed.
- Word tools.
- The up-close view.
- The trope chart.
- The practice sheet.
- Practice marks for students.

What is being added:
- **Tikkun menu** (in progress): pointed text, side by side, or tikkun only. Side by side works on every screen, and colours apply to both columns.
- **Rashi in the selected verse's tools:** a closed "Rashi (n)" disclosure beside Word tools and Sources, following whichever verse is selected. This keeps Lein quiet while Rashi stays one tap from any verse.
- **Recall drills** (a later release):
  - *Tikkun check* shows the tikkun only, lets you chant, then reveals the pointed verse.
  - *Hear it first* plays the verse, then hides the audio.

  Each drill is one control on the selected verse. There are no scores, streaks or badges.

### 3.4 Get ready to translate and interpret (Daniel's way)

These are preparation tools that live in Study.

- **Translations side by side.** JPS is the default. A **Compare** control adds any freely licensed translation Sefaria has for that verse, and Onkelos with its English.
- **My translation.** A per-verse draft in your own words. Students already have per-verse translation drafts in the workspace; this extends the idea to every approved account.
- **Translate drill.** Hide the English, read the Hebrew aloud in your own English, then reveal JPS and your draft. This rehearses exactly the skill Daniel uses when translating live.
- **Word tools** (built): meaning in this verse, dictionary senses, syllables and stress.

### 3.5 Learn to lein (new, for adults and students)

A short course from zero to leyning a verse, built on what exists:
- the trope chart;
- the phrase-family colours;
- word timings across about 7,000 PocketTorah verses.

1. **The families.** One lesson per trope family (Torah and haftarah melodies), in the chart's order. Each lesson plays the family's melody on real verses: the exact phrase, cut from the PocketTorah recording using its word timings. It shows the phrase coloured as on the reading page.
2. **In this week's reading.** Each family's lesson lists where it occurs in this Shabbat's Torah and haftarah, so learning and the week meet.
3. **Hear and name.** A drill: hear a phrase and choose its family. Nothing is scored, but signed-in learners see which families they've practised.
4. **Your first verse.** The course hands off to Lein on a reading you choose.

This uses only human recordings. Generated chant stays out of it until G3. The voice research in `docs/planning/2026-10-22-voice-research/COWORK-HANDOFF.md` decides whether generation ever adds value here.

### 3.6 Readings: any passage, any week

- **This week**, as today: `/read`, with previous and next weeks and a date picker.
- **Any reading.** Open by parashah, haftarah (including the special Shabbatot and festivals), holiday, or a custom range (book, chapter and verse, as the reading editor already offers). Public, at `/read?ref=…`.
- **Read at CRC** (optional, Daniel's choice): if CRC reads a selection rather than the whole parashah, the admin marks this week's verses and they're highlighted on the weekly page. See open item 6.
- **My readings** (approved accounts only). Save any reading with a name and an optional date: "My aliyah, Shabbat Noach", "Haftarah for Shavuot". Each one keeps its own practice marks, notes and translation draft. A saved reading also works offline in 1.5.

### 3.7 Accounts

**Anyone can request an account.**
- Sign in with Google (as today), or with the typed sign-in code planned for 1.5.
- Then fill in a one-screen request: name, and optionally "what would you like to work on?"

**Daniel approves.**
- Requests appear in an **Account requests** list in the admin workspace, with a count on the admin home.
- Email notification stays off until Daniel switches notifications on.
- Approve gives the new **Member** role in the CRC tenant. Decline sends nothing and removes the request.

**Members get the saved layer only:**
- My readings;
- My translation and My notes;
- starred comments;
- practice marks on their own readings;
- learn-to-lein progress.

Everything else is identical to signed out.

**Privacy.**
- A member's notes and drafts are visible only to that member.
- Members never see other people.
- Staff see that a member exists and the member's name. They don't see the member's notes (see open item 4).

**Children.** Members are adults. Students under 13 keep coming only through Beit Mitzvah enrolment, with parents, exactly as today. The request form asks the person to confirm they are 18 or older. (13+ is an alternative; see open item 5.)

**High-stakes work.** The Member role, approval and saved-data isolation are auth and tenant-isolation work. They get an adversarial review before release, as CLAUDE.md requires.

### 3.8 Where it lives

The product outgrows the name "CRC Beit Mitzvah". The home page should become a front door to three things:
- **This week**, with Lein and Study;
- **Learn to lein**;
- **Beit Mitzvah**, the student and family workspace that already exists, for enrolled families.

A new name and domain are open item 1.

---

## 4. Design rules for the new surfaces

These sit inside the locked "Song session" world (DESIGN.md). It is not a new visual direction.

- **Lein stays exactly as it is.** Study is new, so it has to earn its place without changing Lein.
- **The Hebrew is always the most important text.** Commentary sets smaller and quieter, in the existing muted and surface inks, set off by a hairline in the margin of the verse rather than a card around it. It is never louder than scripture.
- **One saturated field.** Lake blue stays the only shell colour. Commentary uses no new hue. The phrase-family colours appear only on scripture.
- **No modals.** The shelf opens in place (phone) or in the side panel (wide). The up-close dialog stays the only dialog.
- **One authored motion.** The ink pull stays the only one. The comment-to-word link is an underline that appears, not an animation. Reduced motion is respected everywhere.
- **Credit without clutter.** Each opened text carries its edition, licence and "via Sefaria" in small type at its foot, as the source reader does today. Learner surfaces show no technical status.
- **Phone first.**
  - Every Study row works at 360 px with no horizontal scroll.
  - Controls are 44 px minimum.
  - Study's toolbar fits one row on a phone (five items).
- **Copy.** Plain verbs, sentence case and adult-respectful, with no pep talk (Daniel's tone ruling). Names say what a thing does: "More on this verse", "My translation", "Hebrew", "Compare".

---

## 5. Texts, licences and sources

- **The source.** Sefaria, fetched live by the server and cached at the CDN. Nothing is stored in the repository.
- **The proposed licence policy** (Daniel to approve; open item 2):
  - **Shown automatically:**
    - Public Domain;
    - CC0;
    - CC-BY, credited by title, licence and "via Sefaria" with a link;
    - CC-BY-SA, credited and marked share-alike.
  - **Needs one ruling from Daniel: CC-BY-NC.** CRC's use is nonprofit and educational, so it plausibly qualifies. Affected works include:
    - Strickman's English Ibn Ezra;
    - the William Davidson (Steinsaltz) Talmud English;
    - the Jaffee Sifrei;
    - the Koren Mekhilta Hebrew.
  - **Never shown in place: unknown or copyrighted.** The item still appears in the shelf with its title and an **Open on Sefaria** link, so nothing is hidden. This covers:
    - JPS 1985 (beyond the current JPS arrangement);
    - Chavel's Ramban where Sefaria marks it "unknown";
    - Soncino;
    - the Women's Commentary;
    - Plaut;
    - others marked "unknown".
- **Edition choice.** Each curated work pins its preferred Hebrew and English editions, with fallbacks, in a registry. Checked on 2026-10-22:
  - **Rashi on Torah:** Rosenbaum–Silbermann, Hebrew and English, Public Domain.
  - **Rashi on Prophets:** Vocalized Edition Hebrew (CC0), and Judaica Press English (CC-BY), or Metsudah (CC-BY).
  - **Ramban:** Vocalized Edition Hebrew (CC0); English is Chavel (CC-BY on one version) or the Sefaria Community Translation (CC0).
  - **Sforno:** Hebrew CC0; English is Munk (CC-BY) or Metsudah (CC-BY).
  - **Midrash Rabbah:** Sefaria Midrash Rabbah 2022 English (CC-BY).
  - **Tanchuma:** Townsend or Berman (CC-BY).
  - **Mekhilta:** Silverstein English (CC-BY).
  - **Sifra:** Silverstein English (CC-BY).
- **The JPS translation** keeps its current arrangement, unchanged.
- **The registry and the Rashi data layer** are being built now on `claude/rashi`. That is server and data only, with no UI yet: the `/api/public/commentary` route, Rashi only, every other work refused.

---

## 6. Releases

Each release ships, deploys and is tagged. "Beta" starts at 1.5, as Daniel set.

| Release | What it adds | Depends on |
|---|---|---|
| **1.2: Lein and Study, first cut** | <ul><li>Tikkun menu with columns and colours on both.</li><li>The Lein / Study switch.</li><li>Study verse rows with Rashi inline, English-led.</li><li>The comment-to-word link.</li><li>Rashi in the selected verse's tools in Lein.</li></ul> | This spec approved |
| **1.3: The shelf** | <ul><li>"More on this verse" with curated commentary, midrash, halakhah, Talmud and Targum.</li><li>The Works control.</li><li>Compare translations.</li><li>"Any reading" by parashah, haftarah, holiday or range.</li></ul> | Licence policy (open item 2), curated lists (open item 3) |
| **1.4: Accounts for everyone** | <ul><li>Account requests and approval.</li><li>The Member role.</li><li>My readings, My translation, My notes, starred comments.</li><li>The translate drill.</li><li>The adversarial security review.</li></ul> | Open items 4 and 5 |
| **1.5: Beta** | <ul><li>Learn to lein (course, families in this week's reading, hear-and-name).</li><li>Recall drills.</li><li>The installable app with 14-day offline for saved readings.</li><li>The typed sign-in code.</li><li>The new name and front door.</li></ul> | Open items 1 and 7; the 1.5 research already written |
| **2.0** | Out of beta: indexing on if Daniel wants it, the notifications he chooses, and anything the beta teaches us | Daniel |

The generated chant voice is outside this list. It is decided by the Cowork research and the G3 gate.

---

## 7. What success looks like

- **Daniel.** He prepares a full week (Torah, haftarah, translation and interpretation) from this one place, without opening Sefaria in another tab.
- **A regular leyner.** They open their aliyah from "My readings", practise with the tikkun columns and recordings, and are ready.
- **An adult with no trope.** They finish the course and lein one verse of this week's reading.
- **A Beit Mitzvah student.** They see no change in Lein that slows them down, and they find Rashi when a tutor points to it.
- **Costs** stay under $10 a month. Every shown text is properly licensed and credited.

---

## Open items that wait on Daniel

1. **Name and address.**
   - The platform outgrows "CRC Beit Mitzvah". Possible names: "CRC Torah", "Leyn at CRC", or another name you prefer.
   - Possible addresses: torah.centralreform.org or leyn.centralreform.org. The current address would keep working.
2. **Licence policy.** Approve the policy in section 5, and rule once on CC-BY-NC texts for CRC's nonprofit educational use.
3. **Curated lists.** Confirm or edit the "main" commentaries, midrashim and halakhic sources in section 3.2, and whether any Reform voices should appear (for example, your own weekly notes or a CRC-written commentary). The Women's Commentary and Plaut can only be linked unless CCAR grants permission.
4. **Member privacy.** Should members' notes and drafts be private to them, even from you? The recommendation is yes.
5. **Age for accounts.** Should the request form require 18+ or 13+? The recommendation is 18+; under-18s come through Beit Mitzvah enrolment or a parent.
6. **"Read at CRC".** Does CRC read a selection each week that should be marked, and who sets it?
7. **Front door.** Should the home page become This week / Learn to lein / Beit Mitzvah?
8. **Defaults.** Should Study open with English on, and should Rashi be inline by default? The recommendation is yes to both.
