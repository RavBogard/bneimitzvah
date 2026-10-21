# Beit Mitzvah portal — plan review and amendments

Filed 2026-10-16 from a Cowork review session with Daniel. This document does three things: it records Daniel's rulings from the session (binding; each one amends MISSION.md and should be folded in with a dated "Amended" note), it reports what the research found about how CRC actually runs the program, and it turns both into a revised feature plan for the implementation team (Astra/Sol in Codex, or Claude Code).

Where this document and MISSION.md disagree, the rulings in section 1 win, because they are later, and each says which MISSION ruling it amends. Everything else in MISSION.md stands. An independent adversarial review of this document was run before filing; its findings are folded in. Rulings 58 and 59 arrived from Daniel during the session, after the review.

---

## 1. Rulings from this session (Daniel, binding, 2026-10-16)

Each line is a question Daniel was asked and the answer he gave. Numbering continues from MISSION's 26.

**Name and scope**

27. The product is called **"Beit Mitzvah"** for CRC (CRC's own documents use this gender-neutral form). `tenant.product_name` already exists; CRC's value becomes "CRC Beit Mitzvah". Amends ruling 25.
28. Scope is **the reading plus the service parts the student leads**, with the prayer texts pulled from the shirei-tfilah repo (Daniel's siddur project). The d'var Torah, mitzvah project and family logistics are not in 1.0.
29. The service parts CRC students lead: the Torah and haftarah blessings, Sh'ma/V'ahavta, and otherwise a per-student menu assigned by the rabbi or tutor. (Research: students lead everything from Barchu through the Torah service; two students on one day split it.)
30. **D'var Torah drafting and feedback: after 1.0.** Reserve room in the data model now; build it later.
31. **Haftarah is in 1.0**, equal to Torah on the student page. Amends ruling 7 (which put it second).
32. **Aliyah cut points and the honors form are in 1.0.** A parent fills the honors form in the portal — the one place a parent writes. Each honoree gets a no-login link (signed, expiring) with the blessings and audio. Amends ruling 1 (parent is otherwise read-only) and ruling 2 (honoree links are the one surface without Google or magic-link sign-in).
33. **Adults: the adult b'nei mitzvah cohort uses the same portal.** A student record carries `student_kind` (child | adult), set by the rabbi; a parent email is required for a child and optional for an adult, who is their own contact. Amends ruling 3.

**Reading and pedagogy**

34. **Service slot is part of the student record.** CRC runs a 10:00 morning service and a 4:00 "Havdalah" (afternoon) service. An afternoon student reads the **following Shabbat's parashah**. The portal proposes that parashah, shows the whole of it, and the tutor or rabbi marks the custom verses. Amends ruling 5 (date alone no longer determines the parashah).
35. CRC does not use the triennial. Students read a short custom section (typically 9–12 Torah verses over about three aliyot, and 5–6 haftarah verses) chosen by the tutor. The portal's proposal defaults to **custom**, with the whole parashah shown; triennial and full-parashah remain available as helpers. Amends ruling 5's "defaulting to the triennial or CRC's selection".
36. How students learn: by ear from a recording, chanting with trope, or as the tutor decides. Trope-family tools stay, but the recording-first path must be first class.
37. **Tikkun view and a printable practice sheet are in 1.0.**
38. **No visible transliteration.** Syllable help instead: tap a word to see its syllables with the stress marked, in Hebrew letters. Amends ruling 13 (the transliteration toggle is dropped) and closes the "under reconsideration" note. Internal phonemes for synthesis are unaffected.
39. **Pronunciation or chant feedback by the portal is not a goal.** The tutor is the feedback loop.

**People, roster, office**

40. Tutors are a mix: CRC clergy (including Rabbi Jim, emeritus), CRC staff and song leaders, independent tutors families hire, and parent volunteers. All get the same tutor role; nothing in the portal tracks pay.
41. **Roster: read-only import from Maven** (CRC's Salesforce layer). The portal never writes back to Salesforce. Amends ruling 4 ("no Maven/Salesforce integration in 1.0"). CSV import stays as the fallback.
42. Maven's `bnai_mitzvah` feed drops the Morning/Afternoon field that Salesforce holds. **Daniel will add it to the Maven feed** (his Maven project, not this repo); the portal import reads the slot from there. Until then, imported students land with slot "unknown" and the rabbi sets it.
43. **The portal writes one Google Sheet** it owns (a "Beit Mitzvah Roster": student, Hebrew name, date, slot, parashah, Torah verses, haftarah verses, tutor, rehearsal dates). Staff read it; the hand-typed trackers retire when staff trust it. No staff login role in 1.0.
44. **Siddur inputs (God paragraph, prayer readings, siddur packet export): v2.0.** The portal collects nothing for the custom siddur in 1.0; v2.0 adds siddur and/or supplement generation.

**Progress, lessons, parents, notifications**

45. Progress means three things: the tutor marks each verse (not started / working / solid), the student self-checks, and a practice log (plays, recordings, visits) shown to the student as a quiet calendar or streak and to the parent as days practiced. No leaderboards. Amends ruling 14's "plays counted in aggregate only": per-student practice events are kept for the student's own calendar; nothing finer than days-practiced is reported to anyone else, and nothing is reported across students.
46. Notifications, all through the existing Resend account: tutor inbox email when a student sends a recording or draft; a parent weekly digest; opt-in student practice reminders.
47. **Lesson log, without hours.** The tutor writes "what we did today" per lesson; parents see it. No scheduling in the portal and no accounting against the 20 included hours.
48. The parent view shows: the reading and progress; date, service slot and logistics; tutor notes and the lesson log; the honors form. Not the child's recordings.
49. **Consent: a notice only.** A line on the parent view saying what is stored, who hears it, and the one-year deletion. No gate.

**Audio, platform, tenants**

50. **Generated chant remains the goal** for Torah and haftarah audio; recordings are the interim. G3 is unchanged.
51. **Prayer audio links out to CRC Music** (centralreform.live), where CRC's actual melodies and charts live. The portal does not host prayer recordings; tutor and clergy reference recordings in the portal are for Torah and haftarah verses only.
52. **A second congregation is likely within a year.** Build the congregation-settings screen and a minimal onboarding path now. Amends ruling 21's "not building a second tenant's onboarding yet".
53. **PWA with offline audio.** Installable on phones; the student's current audio is available offline; recordings made offline upload later. Amends ruling 14's "no downloads" to the extent that a service-worker cache the app controls is not a download; the student still cannot save a file.
54. **No student-facing assistant in 1.0** (ruling 11 stands).
58. **The trope voice must be movable between normal human ranges — bass, tenor, alto, soprano.** A student (or their tutor for them) picks the range they can sing along with; the default is set per student by the tutor. This applies to generated chant; tutor reference recordings play as recorded. Extends ruling 14 (one voice per render becomes one voice in four ranges).

**Repo and engineering**

55. **shirei-tfilah contract:** that repo's CI publishes `feed.json` for its volumes, and gains a **Beit Mitzvah volume of its own with morning and Havdalah versions** (not a reuse of the Shabbat Morning and Friday-night volumes). The portal imports units by their stable IDs and caches them.
56. **The trope engine is the single source of trope logic.** The phrase-family logic now duplicated in TypeScript (`src/lib/hebrew/study-annotations.ts`, `src/lib/trope/chart-catalog.ts`) moves into `trope/lib-trope.cjs` as a token-level function (pure Node, no dependencies, as the engine rule requires); the app keeps only a thin typed wrapper plus its colors. The app's existing tests (`tests/app/study-annotations.test.ts`, `tests/trope-chart-catalog.test.mjs`) and the 182-verse parity golden stay as the lock. The exact-Hebrew, qere/ketiv and read-word-index behavior reviewed at `ff1215a` must not change.
57. **Unblock production sign-in first**, before more feature work: finish the approved query-free auth work (`2026-10-16-query-free-auth-design.md`, including the Google popup flow Sol is building), confirm the Neon migrations and restricted role on Production (STATE says they are applied; verify, don't redo), and confirm Resend delivery from the verified centralreform.live domain. Daniel wants to click through on his phone.
59. **Hostnames.** Daniel has set up CNAMEs to the same Vercel address for `beitmitzvah.centralreform.org`, `barmitzvah.`, `batmitzvah.`, `bnaimitzvah.` and `bneimitzvah.centralreform.org`. The canonical host for CRC is **beitmitzvah.centralreform.org** (ruling 27); the others redirect to it. All five go on the Vercel project and in the `tenant_host` allow-list as CRC. This clears STATE's "BLOCKED (Daniel): custom domain needs CNAME". Amends ruling 23's hostname.

---

## 2. What the research found

**The program as CRC runs it.** Families pick a date in 4th grade from a grid with two slots per Saturday (Morning, Havdalah 4 pm). Tutoring starts about nine months out: 20 hours, usually a weekly half hour, covering Torah, haftarah and the prayers. Six to eight rabbi meetings cover the service, the d'var Torah and the mitzvah project. The siddur coordinator (Marian Rosen) builds a custom siddur per student from the student's God paragraph, readings they write for up to ten prayers, the honors names, and the exact verses, which she requests from the tutor by email six weeks out. Two rehearsals, about three weeks and one week before. The afternoon service uses evening liturgy (Ma'ariv Aravim, Ahavat Olam, Hashkiveinu, Shalom Rav), then the Torah service, then Havdalah; the binder never mentions the afternoon option.

**Where the data lives.** The same facts are typed into six to eight places: the communications@ date-change tracker, Marian's siddur-timelines spreadsheet, Rabbi Randy's per-pair tracker docs, a rabbi meeting tracker ("not really used"), a May 2025 Salesforce export, and Salesforce itself. They already disagree on portions, times and spellings. Every afternoon student's parashah is corrected by hand because Salesforce fills in the date's own parashah. Exact verses live only with the tutor until six weeks out.

**Maven's feed.** 16 students from October 2026 to April 2028, with name, date (no time), one parent contact (name, email, phone), Hebrew name, portion, religious-school grade, fee-agreement status and last staff contact. No slot, no tutor, no verses, no second parent. Two students on Marian's sheet are missing from it (worth checking whether they withdrew).

**shirei-tfilah** (renamed from shirei-shabbat-siddur). Typst source with stable unit IDs (`torah.blessing-before-the-torah@shabbat-shacharit` and so on), a `feed.json` export per volume with Hebrew, transliteration and English per block, validated against a schema. Three volumes: Shirei Shabbat (Friday night), Shabbat Morning, Shirei Tshuvah. No Beit Mitzvah or mincha volume, no audio, and the feed is built in CI but not published anywhere reachable.

**The repo.** Auth, tenancy, roles, invitations, CSV roster, the Hebcal reading proposal and editor, per-verse translation drafts with version history, tutor notes, phrase colors and the printable trope chart are built and tested locally and in CI. Production sign-in waits on the query-free auth work. The data model has no service slot, requires a parent email, keeps one current assignment per kind per student (`assignment_current_kind_key`), lists `blessing-before`/`blessing-after` in the reading-kind enum without wiring them, and has no prayers, progress, recordings, lesson log or practice log. The "engine package" that now exists in the haftarah repo is the study-sheet engine (lib.js, render.js, sheet assets), not the trope engine; ruling 18's switch to a package waits until a trope-engine package exists, and `trope/lib-trope.cjs` remains the portal's copy until then.

**Comparable products.** None combines what this portal is. The new TropeTrainer (web, $130/year) has four playback modes, 0.25–2x speed, tikkun view and record-and-send. MitzvahManager ($48/student/year) has tutor rosters, per-verse assignments, milestone alerts and a parent view. PocketTorah is free with human recordings. The original TropeTrainer and World ORT's Navigating the Bible are dead.

**Technical facts to design around.** Hebcal's leyning API returns no Shabbat mincha reading; the afternoon parashah is the following Saturday's. Safari records MP4/AAC, not WebM. Home-screen web apps on iOS are exempt from Safari's seven-day storage purge; cached MP3s need range-request support in the service worker. `HTMLMediaElement.preservesPitch` is widely supported, so slow playback needs no extra library; moving a voice between ranges does.

---

## 3. Revised feature plan

### 3.1 Data model changes

These are the schema additions the rulings require. Names are suggestions; Astra decides the details and logs them. Extend existing tables where they exist (`tenant`, `tenant.customs`, `tenant_host`, `assignment_verse`, `audit_event`) rather than adding parallel ones.

- `student`: add `service_slot` (morning | havdalah | friday-evening | other | unknown), `student_kind` (child | adult), `hebrew_name`, `rehearsal_1`, `rehearsal_2` (optional dates), `voice_range` (bass | tenor | alto | soprano, nullable; tutor-set default). `parent_email` becomes nullable with a check constraint: required when `student_kind = child`.
- `assignment`: **keep** the one-current-per-kind unique key and the race tests that rely on it. A CRC student reads one contiguous custom section per kind, and two students who split a reading are two students with their own ranges. Remove the unused `blessing-before`/`blessing-after` enum values; blessings are service units (below). Add `aliyah_cuts` as ordered verse boundaries on the Torah assignment, revision-tied like the verses.
- `honors` (per student, filled by a guardian): names for ark opening, passing the Torah, undressing and dressing, ark closing; per aliyah: honoree English name, Hebrew name, relationship, and the parents' Hebrew names where the form asks. One row per student with revision; a signed `honoree_link` row per aliyah (token hash, expiry at ceremony date plus a week, revoked_at).
- `service_unit` (per tenant): the unit ID from the shirei-tfilah feed, display name, section, service version (morning | havdalah), who usually leads it (student | clergy | band), an optional CRC Music link, and the cached text blocks with the feed's git SHA.
- `student_service_part`: student × unit, whether the student leads it, a note.
- `verse_status`: keyed on `assignment_verse` (so it follows the assignment revision), status (not started | working | solid), set by (tutor or rabbi), history. When an assignment is revised, statuses for verses still in range carry forward; the rest are kept but hidden.
- `self_check`: the student's own mark per `assignment_verse`.
- `practice_event`: student, type (play | record | visit), verse or unit, duration, timestamp. Read only by the student's own calendar and by a nightly rollup to `practice_day` (student, date, minutes, counts), which is what parents and tutors see.
- `recording`: student, `assignment_verse` range or unit, blob URL, duration, created at, submitted to tutor at, reviewed at (by whom), deleted at. Retention is computed from the student's ceremony date at job time (ceremony plus one year), not stored, so a moved date moves the deletion. `reference_recording`: tutor or clergy recordings per `assignment_verse` (Torah and haftarah only, per ruling 51).
- `lesson_entry`: student, author (tutor or rabbi), date, text. Parent-visible.
- `notification_pref` (user × kind × on/off, plus reminder days) and `outbox` (recipient, kind, payload, send after, sent at, provider id, error).
- `dvar_torah_draft` and `siddur_input`: reserved, not built (rulings 30, 44). A reserved kind or an empty table is enough; no UI.
- `tenant` additions (or keys in `tenant.customs`): slot options and times, default nusach, siddur volume IDs, CRC Music base URL, roster sheet ID, sender address, consent notice text.
- `import_run`: source (maven | csv), when, counts, per-row outcome.
- `audit_event`: add the new actions (honors edit, honoree link issue/revoke, verse status, lesson entry, recording submit/review/delete, service part change, roster import, sheet export) to the `audit_action_known` check constraint.

### 3.2 Production sign-in (first)

Finish the approved query-free auth work (token out of the query string, Google popup flow). Verify on Production: the Neon migrations and restricted role (STATE records them as applied), Resend delivery from the verified centralreform.live domain, and that `/api/session` answers. Add the five hostnames from ruling 59 to the Vercel project and the `tenant_host` allow-list, with a redirect from the four aliases to `beitmitzvah.centralreform.org`, and confirm each resolves with a valid certificate. Then close the Phase 2 items STATE still shows open: the four role pages checked against the role matrix, the redacting logger ticked (it exists at `src/server/logging/logger.ts`), the adversarial pass on auth and tenant isolation, the two-tenant suite. Done means Daniel signs in on his phone at beitmitzvah.centralreform.org as owner and opens a fixture student's page.

### 3.3 The reading proposal, slot-aware

By slot: **morning** and **friday-evening** use that Shabbat's parashah, as today. **havdalah** uses the **following Saturday's regular parashah**: query Hebcal for the next Saturday; if that day carries a festival or special reading rather than a weekly parashah, walk forward to the next regular one. Do not use Hebcal's Monday/Thursday weekday entries (they hold only the first three verses). **other** and **unknown** get no proposal; the rabbi sets the parashah by hand and the page says why. Edge cases to test against real Hebcal data: a double portion the following week, Shabbat Chol HaMoed, a holiday Shabbat, the Simchat Torah boundary.

The proposal shows the whole parashah with Hebcal's aliyah boundaries as orientation. The default mode is **custom**: the tutor or rabbi marks the verse range, then marks the student's own aliyah cut points inside it. Triennial and full remain as helpers. Haftarah gets the same editor (the custom 5–6 verses). Confirmation and revision rules stay as built.

### 3.4 Study page

Keep the built page and the "Annotated score" direction. Add:

- **Haftarah as an equal**: the Torah/haftarah switch becomes two tabs with the same tools; the haftarah trope table is already in the engine.
- **Tikkun view**: a toggle that shows the Hebrew without vowels or trope in a Torah-script face. The font choice was a licence question for Daniel (candidates: the Culmus "Stam Ashkenaz CLM" / "Stam Sefarad CLM" faces, GPL with font exception). **Settled 2026-10-21:** Daniel chose Stam Ashkenaz CLM. Its licence text, source and provenance sit with the app's existing font licence texts (`public/fonts/`), not the engine's PROVENANCE. Side-by-side with the vowelled text on wide screens; a toggle on phones.
- **Printable practice sheet**: large print, verse per line, vowels and trope, optional tikkun column, aliyah markers, the student's name and date, "Beit Mitzvah" header. This is the "booklet of their portion" families get in 5th grade. Print CSS in 1.0; no server-side PDF renderer (a headless browser on Vercel is a cost and an approval).
- **Syllable help**: tap a word to see it broken into syllables with the stressed syllable marked, in Hebrew letters only, using the vendored havarotjs. Replaces transliteration everywhere for students. Remove the paused transliteration sources from the plan.
- **Reading aids** becomes a segmented control (Plain | Color phrases | Tikkun) rather than a fold-out checkbox.
- **Word panel**, **commentary** (defaults, assigned, all; approved summaries) and the **translation picker** as planned in Phase 3. The picker has one edition today; the registry needs the public-domain editions Sefaria offers before the picker is worth showing.
- **Aliyot drawn on the reading**: a marker and label at each cut point; the blessing units before and after appear at the boundaries (text from shirei-tfilah, audio per ruling 51), so the student practices the sequence as it will happen.

### 3.5 Service parts

- **shirei-tfilah side** (its own repo, its own work): a Beit Mitzvah volume with morning and Havdalah versions; publish `feed.json` per volume from CI to a stable URL (GitHub Pages or a release asset); keep unit IDs stable; version the feed with the git SHA it already records. Open item for Daniel: whether Marian's "Siddur for All" drafts are the source text.
- **Portal side**: an importer that fetches the feeds, upserts `service_unit` rows per tenant from the Beit Mitzvah volume, and caches block text (Hebrew and English; the feed's transliteration is stored but not shown to students). A **service plan** per student: the rabbi or tutor ticks which units the student leads from the volume's order; the student page gets a "Service" tab listing those units in service order with the text and a "Listen on CRC Music" link per unit. Two students sharing a day each see only their own parts.
- **CRC Music link**: a tenant-level mapping from unit ID to a centralreform.live chart or recording. Open item: confirm whether centralreform.live exposes audio per song or charts only. If charts only, prayer audio is absent in 1.0 (ruling 51 rules out hosting it here).

### 3.6 Honors and honorees

A guardian fills the honors form in the parent view (the one parent write path; new audit actions). The rabbi sees the completed form on the student's admin page and can print it (print CSS, same fields as the paper form). Each aliyah honoree gets a **no-login link** (signed, expiring a week after the ceremony, revocable) to a page with the Torah blessings before and after in Hebrew and English, the honoree's own aliyah marked, and audio only if the CRC Music mapping provides it. The page shows the student's first name and date, nothing else. Because this is an unauthenticated surface that reads tenant data, it gets the adversarial pass CLAUDE.md requires for auth and tenant isolation before it is reported done. Whether honoree pages (adults, often not Hebrew readers) may show transliteration is a question for Daniel (section 8).

### 3.7 Progress, lessons, parents

- Tutor verse marks on the tutor's view of the reading (three states, tap to cycle); student self-check as a smaller mark the student controls; both show as dots under each verse and as a summary bar.
- Practice calendar from `practice_day`; the student page shows a quiet calendar of practice days and a current/best streak with no negative messaging. Parents see the calendar (days), not counts or plays.
- Lesson log: a tutor writes an entry after a lesson; the parent view and the student page show the last few; the rabbi sees all.
- Parent view: an at-a-glance card (date, slot, parashah, tutor, rehearsal dates), the reading with progress dots, the tutor's per-verse notes, the lesson log, the honors form, the consent notice line.

### 3.8 Audio, voice range and recordings

As planned in Phase 4, with these specifics: the player is one sticky bar at the bottom of the phone screen (play, slow, loop, record), verse-scoped, with phrase-scoped loop when phrase colors are on; speed 0.5–1.25 with `preservesPitch`; no file downloads. Record-yourself with MediaRecorder, choosing the MIME type at runtime (MP4/AAC on Safari), stored in a portal-owned Blob store with the one-year deletion job. Tutor reference recordings per verse from a phone. Generated chant plugs into the same slot behind G3.

**Voice range (ruling 58).** The chant manifest carries, per verse, one render per range (bass, tenor, alto, soprano) from the same score, transposed to a comfortable key per range before rendering; the student's `voice_range` picks which file plays, and the range control sits on the player. Rendering per range is preferred over pitch-shifting at playback: the quality is better, the files are small (64 kbps mono), and offline caching stays simple. Each range is its own G3 review row only if the renderer's output differs materially between ranges; otherwise G3 passes the score and the automatic G1/G2 checks run per range. "A new voice applies to new renders only" (ruling 14) holds per range.

**Offline cache and G3.** The service worker caches only renders whose release state is "released" in the manifest; the manifest is re-fetched on every open and on assignment change, and any cached render no longer released is purged before play. A test proves an unreleased or withdrawn render cannot play from cache.

Money: the Blob store is a new spend; the spend notice goes to Daniel before it is created (MISSION authority rules).

### 3.9 PWA and offline

Web manifest, install hint on iOS (Share → Add to Home Screen), a service worker that precaches the app shell and the student's current released audio set in their range (Workbox CacheFirst with the range-requests plugin, `crossorigin="anonymous"` on audio), the reading text cached per assignment revision. Recordings made offline are queued in IndexedDB and uploaded on the next open (no background sync on iOS). Texts and audio refresh when the assignment revision or the manifest changes.

### 3.10 Notifications

`outbox` and `notification_pref` from 3.1; a sender through Resend from the tenant's sender address on the verified centralreform.live domain; three kinds (ruling 46). Student reminders default off and are set by the student or parent; the parent digest goes weekly; tutor inbox mail is immediate but batched within an hour. Every mail has a one-click stop.

### 3.11 Roster import and the office sheet

- **Maven import**, read-only: in Phase 5 the portal's MCP gives Daniel an `import_roster` tool he runs from Cowork with the Maven and portal connectors both attached (no new credentials). Rows match on name plus date; new children need the parent email from Maven's contact — a row without one is listed as "needs parent email" and not created until supplied; slot comes from the feed once Daniel's Maven change lands, otherwise "unknown"; changed dates or portions are shown as a diff for confirmation, never applied silently. A later direct Salesforce pull can replace the Cowork step.
- **Roster sheet**: a Google service account (same Google Cloud project as the OAuth client; no cost) with edit rights on one sheet CRC owns. The portal rewrites the sheet on any roster change and nightly: one row per student with the fields in ruling 43. The sheet is never read back.

### 3.12 Tenancy

A congregation-settings page for the rabbi/admin (the fields in 3.1's `tenant` additions), and an owner-only "add congregation" flow: name, hostname (a `tenant_host` row), first admin invitation. No billing, no self-service.

### 3.13 Engine

Per ruling 56: move the token-level phrase-family logic into `trope/lib-trope.cjs` (pure Node), have the app's TypeScript call it through a thin typed wrapper, keep colors in the app keyed by family id (`TROPE_FAMILIES` carries id and label only), and keep every existing test green. The engine stays dependency-free.

### 3.14 MCP (Phase 5)

Tools, beyond those planned: `import_roster` (above), `set_service_slot`, `assign_service_parts`, `set_aliyot`, `export_roster_sheet`, `list_recordings_for_review`, `write_lesson_entry`, `set_voice_range`. Reads for every role's view so Daniel can check a student from Cowork.

---

## 4. Connectors and integrations

| Connector | Direction | Purpose | Status |
|---|---|---|---|
| Sefaria | read | texts, related texts, editions | built (chapter cache) |
| Hebcal | read | parashah by date, aliyot; afternoon = next Saturday | built; needs slot logic |
| shirei-tfilah feed | read | prayer units for the service plan | not built; feed not yet published |
| CRC Music (centralreform.live) | link-out | prayer audio and charts | not built; audio availability unconfirmed |
| Maven / Salesforce | read-only via Cowork | roster import | not built; Daniel to add slot to the feed |
| Google Sheets | write | roster mirror for staff | not built; needs a service account |
| Resend | send | notifications, magic links | account exists; domain centralreform.live verified; delivery unverified |
| Vercel Blob | store | recordings, later chant renders | not created; spend notice first |
| Portal MCP | both | Daniel and tutors from Cowork | not built (Phase 5) |
| Google Calendar | — | rehearsal dates | not planned; dates are typed on the student record |

---

## 5. UI and UX guidance

- The student's first screen stays the reading. On phones, the passage is one verse per card with swipe between verses and a sticky practice bar at the bottom; on wide screens the whole passage with the tools beside it. The verse the student practiced last is where they land.
- A **Zoom share mode**: one verse, large, no chrome, arrow keys to move, so a tutor can share the screen and both see the same thing. One button from the tutor's view.
- Font size control that persists per device. Non-color identifiers for trope families (the chart's names) stay available next to colors.
- Progress is shown quietly: dots under verses, a calendar of practice days, a current and best streak. No red, no "you missed", no comparisons between students.
- The tutor's student list sorts by ceremony date with the nearest first and a small status per student (verses solid / total, last lesson entry, unreviewed recordings from `recording.reviewed_at`).
- The parent view opens on the at-a-glance card; everything else is below it.
- The voice-range control is on the player, four plain labels, remembered per student.
- Every page that shows generated text (summaries, later chant) carries the label MISSION requires; every page with a licensed edition carries its credit.
- The consent notice is one sentence with a "what we store" link, not a modal.

---

## 6. Phase shape after this review

Shape, not schedule. Sizes are relative effort for the implementation team.

- **Phase 2 close (M):** production sign-in per 3.2 and the open Phase 2 gates; service slot, student kind and the schema additions in 3.1; congregation settings; the engine move in 3.13.
- **Phase 3 study (L):** haftarah equal; slot-aware proposal and custom-first editor; aliyot and honors; tikkun and printable sheet; syllable help; word panel; commentary; translation picker.
- **Phase 3b service parts (M, plus the shirei-tfilah volume in its own repo):** feed importer, service plan, CRC Music links, honoree pages with their adversarial pass.
- **Phase 4 audio and progress (L):** player with range control, recordings, reference recordings, verse marks, self-check, practice log, lesson log, notifications, PWA and offline with the release-state cache rule.
- **Phase 5 MCP (M):** the planned tools plus roster import and the sheet mirror.
- **Phase 6 chant behind G3 (L):** as planned, now rendering four ranges per verse.
- **Phase 7 pilot (unchanged).**
- **v2.0:** d'var Torah drafting and feedback; siddur inputs and siddur/supplement generation; anything from the binder's family logistics.

---

## 7. Flags (honest, for Daniel)

1. The ruling that no one but Daniel tests before the full product is complete means the first real student feedback waits on Phase 6, the riskiest phase. Daniel using the production site as a student himself, as soon as sign-in works, is the nearest substitute and is already allowed.
2. The afternoon-parashah rule has edge cases (double portions, holiday Shabbatot, the Simchat Torah boundary). They need tests against real Hebcal data, not assumptions.
3. Prayer audio and honoree blessing audio depend on what centralreform.live actually exposes. If it is charts only, there is no prayer audio in 1.0.
4. Four ranges per verse multiplies render time and storage by four; at 64 kbps mono that is still small per student, but the offline GPU job's queue gets four times longer.
5. The Blob store and the Google service account are new pieces; Blob is a spend (notice required), the service account is not.
6. The Maven feed change is in Daniel's Maven project, not this repo. Until it lands, every imported student needs a slot set by hand.
7. The process overhead in the repo (about fifty planning and return documents in two days) is high relative to shipped features. Not a ruling; worth watching.

---

## 8. Open items that wait on Daniel

- Does centralreform.live expose audio per song, or charts only? (Decides the prayer-audio and honoree-audio path.)
- ~~The tikkun font licence~~ Settled 2026-10-21: Daniel chose Culmus Stam Ashkenaz CLM (GPL v2 with font exception).
- May honoree pages show transliteration, given ruling 38 applies to students?
- The Beit Mitzvah siddur volume in shirei-tfilah: is Marian's "Siddur for All" (morning and afternoon drafts, June–July 2026) the source text for it?
- The Blob store spend notice, when Phase 4 starts.
- The two students on Marian's sheet missing from Maven (withdrawn, or a Salesforce gap).
- Carried from MISSION: engine open items, the cantor licence if recordings are pursued, CRC customs `toConfirm`.

## Astra integration review — 2026-10-16

Read during the production sign-in checkpoint. Carry section 1's recorded Daniel decisions forward as the updated product scope; section 3 remains an implementation proposal, not a blanket approval of its mechanisms. Preserve the Annotated score direction and full-feature-before-other-human-testing sequence. Fold the amendments into MISSION/PRODUCT and the existing plan at the next milestone boundary rather than creating parallel plans. Production sign-in remains first: auth commit 0bf3450 has passed local integration and deployed, with hosted CI and provider enablement still in progress at this note.

Implementation corrections and decisions:

- Offline release/revocation needs an explicit contract. A disconnected device cannot discover a new withdrawal. Use assignment/user/tenant-scoped cache entries, an expiring offline authorization/release lease, revalidation and purge on reconnection, and account-switch/logout cleanup. The exact permitted offline interval is a product decision before this feature ships; do not claim instantaneous offline revocation or cache private API responses generically. Browser-controlled storage is not permanent: home-screen apps are exempt from ITP's seven-day cap, but quota/storage-pressure eviction remains possible. Handle pending-recording loss risk and visible upload state. See [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) and [tracking prevention](https://webkit.org/tracking-prevention/). Workbox's [media recipe](https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video) requires full precaching and range handling; playback alone does not fill a complete offline file.
- Practice privacy: ruling 45 wins over section 3.1's proposed minutes/counts in parent/tutor rollups. Other people get days-practiced only; raw events remain student-scoped. Bound event retention and purpose. No comparisons across students.
- Maven matching must use a stable source record ID plus tenant/source namespace. Name/date can propose a match for explicit reconciliation, never silently determine identity. Date changes must not create duplicate children or merge different children. Retain CSV fallback.
- Four voice ranges are required; four independently rendered assets are a hypothesis to test, not an already proven quality winner. Benchmark source/renderer/transposition choices on the same reviewed score. Release identity includes range and renderer/version. A correct score does not prove a render's pronunciation/timbre/melody; retain G1/G2 for every asset and G3 listening evidence across the released ranges. Do not silently weaken the existing listening gate.
- The new canonical hostname needs a separate reviewed migration/configuration change: register and verify DNS/TLS, add the new Google JavaScript origin, and switch the one canonical auth origin deliberately. Alias navigation redirects do not grant API/cookie trust to every alias; reject noncanonical mutations. Preserve the working Vercel address until cutover acceptance, and never forward credential queries between hosts.
- Honoree links should reuse fragment/body transport, short-lived scoped access and explicit revocation. Their bearer access needs a separate adversarial review and strict field projection; family data must not enter URLs, logs or public caches. No file-export button is achievable; absolute prevention of saving playable/cached audio is not a security promise.

Sequence after sign-in: canonical host/name, slot/adult schema and custom-first assignment behavior, then equal Torah/haftarah study and service/honors features. Verify afternoon/holiday rules against actual Hebcal data before coding assumptions. External feed, music capability, font-license and storage-cost questions stay attached to their dependent milestone; they do not block sign-in. Avoid prematurely creating unused d'var/siddur tables or adding all future schema in one migration.

The process-overhead criticism is fair. Keep one short STATE return note and this linked review; prefer bounded deliverable milestones over more overlapping planning documents. No new feature implementation or external provider mutation was performed as part of this plan review.
Read-only hostname check during this review: all five supplied CNAMEs resolve to the expected Vercel target. The exact project lists the four spelling aliases as verified, with no redirect yet. The new canonical beitmitzvah.centralreform.org is not yet in that project domain list and HTTPS did not complete in this probe. Thus Daniel's DNS work is confirmed; project-domain registration/TLS and canonical app configuration remain our work, not another request to redo his CNAMEs.

Daniel clarification, 2026-10-16 (direct chat): recordings are hidden from the parent dashboard but available inside the linked child's practice view opened through parent sign-in. This resolves ruling 48's interaction with the already approved delegated child-practice workflow; it is a surface/capability distinction, not a claim that the parent cannot operate that child view.

Hostname follow-through, 2026-10-16: registered beitmitzvah.centralreform.org on the existing, exact Vercel project; Vercel reports it verified and an HTTPS HEAD returns200. The earlier read-only finding above is now resolved at the domain/TLS layer. Daniel directly confirmed adding the canonical Google JavaScript origin while keeping the current one. The configured app/auth origin remains bneimitzvah.vercel.app; canonical app mapping, alias redirects and reviewed cutover are still outstanding.
