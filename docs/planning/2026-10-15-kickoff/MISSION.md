# Beit Mitzvah Portal — mission brief

Filed 2026-10-15 from the kickoff interview in Cowork. This is the authority document for the project until a spec supersedes a section of it; a spec that changes a ruling here says so with a dated "Amended" note. Daniel's words are binding; everything else is Claude's read, approved by him in three rounds on 2026-10-15.

**Amended 2026-10-16:** Daniel's later rulings 27–59 in [PLAN-REVIEW.md](../2026-10-16-review/PLAN-REVIEW.md#1-rulings-from-this-session-daniel-binding-2026-10-16) are folded in below. Original numbering and dated decisions are retained; that review preserves the earlier wording and interview record. Its section 3 mechanisms remain proposals, subject to Astra's integration corrections and bounded design review. These requirements do not claim completed implementation.

## Amended 2026-10-23, Friday preparation direction (Daniel, approved)

Daniel approved the revised CRC Torah direction from an outside-consultant review: [PLAIN-LANGUAGE-PLAN.md](../2026-10-23-friday-preparation/PLAIN-LANGUAGE-PLAN.md), [CLAUDE-HANDOFF.md](../2026-10-23-friday-preparation/CLAUDE-HANDOFF.md) (scope and acceptance checks), [CONSULTANT-PLAN.md](../2026-10-23-friday-preparation/CONSULTANT-PLAN.md) (evidence). Daniel, verbatim: "The main clarification: custom READINGS are common; custom STUDY GUIDES are rare. Prioritize ordinary exploration and preparation entirely within the app, with Claude as another entrance into the same experience."

- Selecting, saving, revising and reopening readings is straightforward; whole-portion context stays reachable. Word taps open meaning in Study and hearing in Lein. Original English commentary is easy to explore without losing your place. Sefaria and the read-only haftarah repo are interaction inspiration only.
- Writing stays in Claude: My notes and My translation leave the normal personal reader; stored work is preserved within its author's authority. Print reuses the print-sheet work, with an optional commentary appendix after the reading. Occasional source-only curation goes through MCP and does not dominate the app.
- Owner-authorized Claude access to a person's own preparation is authorized as a design goal. It does not authorize staff access to anyone's private work; the access contract and its structural guards change together, with the standing adversarial review.
- Order (Claude's versioning): this follows the current commitments (1.5, 1.6 and the print sheet) as 1.7, possibly over several point releases. The web siddur integration moves from 1.7 to 1.8, still in 1.x. 2.0 and 2.5 are unchanged.
- Daniel asked for a critical read rather than blind acceptance (2026-10-23). Claude's critique and his answers, binding:
  - Notes and translation: "Cut as proposed" (Claude had recommended keeping them collapsed). My notes and My translation leave the reader; stored rows stay, reachable only to their owner. The Lein translate drill reveals JPS only.
  - MCP access to one's own saved readings: "Existing MCP users (Recommended)". The first release covers Daniel and tutors, each reaching only their own saved readings; staff never reach another person's work. It is an auth change and gets the adversarial pass.
  - Account request intro, Daniel: "All plus preferred commentaries, settings, etc". Claude's draft: "An account keeps your saved readings, your place in Learn to lein, your preferred commentaries and your settings. Everything else on {productName} is open without one." It ships only once each named thing really is kept by the account; any item that isn't comes out of the string.
  - Approval email body: "Save readings (Recommended)": "Your account request was approved. Sign in with this email address to save readings. {origin}/. If you did not ask for an account, you can ignore this email."
  - Claude's design calls (not Daniel's rulings): a Claude translation carries a fixed credit naming Claude as translator and the person who selected it. 1.7 ships in steps: word taps plus a source panel that keeps your place; choosing and revising a reading from the text plus the Claude link; the print appendix; MCP curation last. The consultant's "saving/recovery concern" is treated as unverified until reproduced.

## Amended 2026-10-23, roadmap (Daniel, verbatim)

"Second congregation moves to 2.5 also; web siddur integration into 1.x"

- The second congregation moves from after 1.5 to 2.5, alongside 2.5's generated chant per trope system. D11, D-a and D-b stand, but on the 2.5 timeline. Provisioning it is still Daniel's gate, after the two-tenant isolation suite and its adversarial pass.
- The web siddur integration (shirei-shabbat's web siddur, including its Beit Mitzvah volume) moves from 2.0 into 1.x. Claude's read: it is 1.7, after 1.6, and runs beside the print sheet and voice. The shirei-shabbat repos are read from, never written; their own CLAUDE.md rules win there. The service course with Daniel's teaching on each prayer (E2) stays in 2.0, since this ruling names only the integration.
- Daniel, verbatim, same day: "All the voice work happens in 2.5". The voice generator (VOICE-BUILD-PLAN M0 to M8, with PR #22) doesn't start after 1.6. It starts in 2.5, after 2.0. This replaces the earlier "voice starts after the 1.6 activities" ordering. The order is 1.5, then 1.6 and the print sheet, then 1.7 (web siddur integration), then 2.0 (service course), then 2.5 (all voice work, generated chant per trope system, the second congregation).

## Daniel's rulings, 2026-10-23 (via Cowork)

**Amended 2026-10-23.** Daniel answered Cowork's question batches A to F on 2026-10-23. His answers, verbatim and with the option labels he chose, are in [QUESTIONS.md](../2026-10-23-cowork-offload/QUESTIONS.md); the mapping to plan sections is in [HANDOFF-TO-CLAUDE-CODE.md](../2026-10-23-cowork-offload/HANDOFF-TO-CLAUDE-CODE.md). The bullets below record every ruling that changes this brief or a plan. They supersede any older MISSION text that says otherwise, and that older text is left as written. Rulings that only confirm plan text (A1, A2) or settle strings (A3, B4) live in QUESTIONS.md and in the two 1.5 plans' "Changes from Daniel's 2026-10-23 rulings" sections.

- **E1, name per congregation.** Daniel: "Their own name, set per congregation (Recommended)". `productName` is a per-congregation setting (for example "{Congregation} Torah"); CRC's value is "CRC Torah", and the CRC credit stays in the footer. Make it a setting now; every user-visible string uses `{productName}`. Ruling 25 and the 2026-10-22 name ruling (CRC Torah at torah.centralreform.org) now describe CRC's own value of the setting. Detail: QUESTIONS E1.
- **F1, who gets an account.** Daniel: "Anyone who asks in good faith (Recommended)". Accounts are open to anyone, member or not; approvers decline only spam or abuse. This makes the 2026-10-22 "I'll approve requests" ruling concrete: no membership check.
- **F2, search indexing.** Daniel: "Index public pages at the 1.5 beta tag (Recommended)". At the 1.5 beta tag (v1.5.0, see the popup rulings below), `/read`, `/learn` and `/trope-chart` become indexable; signed-in pages and workspaces stay noindex. This applies the 2026-10-22 "noindex until beta" line and replaces the roadmap draft's 2.0 date. Until the beta tag, every public page stays noindex. **[Superseded 2026-10-24: see "Amended 2026-10-24 (G0)" at the end of this file.]**
- **F3, Learn to lein offline.** Daniel: "Yes, in 1.5 (Recommended)". The installed app also keeps the Learn to lein course (lessons and their clips) offline, under the same 14-day rule as the other packs; course progress saved to an account syncs when the app is back online. This adds a pack to the 1.5 offline scope.
- **F4, the translate drill.** Daniel first picked "Lein and Study both (Recommended)", then changed it: "Translate drill just in lein". The drill lives in Lein's verse tools only; nothing is added to Study. While it is on, the English is hidden on every verse.
- **B5, app icon.** Daniel: "2 Yad". The icon is option 2, the yad (`icons/option-2-yad.svg`, geometry in `icons/ICON-OPTIONS.md`); strokes no thinner than drawn.
- **B6, parents offline.** Daniel: "No, not in 1.5 (Recommended)". No parent offline view of a child in 1.5.
- **D11 and D-a, the second congregation.** Daniel chose the recommended option: the second congregation's rabbi is first contact; day one is the public pages (Lein, Study, Learn to lein) plus accounts, with the Beit Mitzvah workspace later. On deployment shape, Daniel: "One deployment (Recommended)": one deployment serving several congregations, each by its own web address, once the two-tenant isolation suite passes. This refines ruling 21 and the "second congregation" open item. These answers fix the plan, not the go-ahead: actually provisioning a second tenant is still Daniel's explicit gate (repo CLAUDE.md "stop and ask"), and the two-tenant suite and its adversarial pass must be green first.
- **D-b, JPS 2023 for another congregation.** Daniel: "Yes, it's covered". Another congregation may show JPS 2023 under the existing arrangement; no JPS gate on a second tenant and no JPS note. Never-in-repo is unchanged.
- **D12 and E2, what 2.0 is for.** Daniel, verbatim: "We have the siddur available via shireishabbat repo/ web-siddur, already. Beit mitzvah siddur. Should have proper integration . Should have ways for students to learn the service". And: "A course, that also teaches about the prayers, using my understanding for each, pulled from shireishabbat and shirei tfilah repos". 2.0 builds no siddur: it integrates the existing web siddur (shirei-shabbat, including its Beit Mitzvah volume) into the portal and adds a service course in the Learn to lein pattern, with teaching about each prayer drawn from Daniel's own commentary in the shirei-shabbat and shirei-tfilah repos, not written fresh by Claude. This replaces the "Custom siddur inputs/packet export and supplement generation wait for v2.0" line under "Office". Out of beta, D'var Torah, notifications Daniel chooses and public-page indexing stand as drafted in `ROADMAP-2.md`. **[Amended 2026-10-24: teaching is now drafted for Daniel's approval; see "Amended 2026-10-24 (G0)" at the end of this file.]**
- **D-5, 2.5 audio.** Daniel: "Generated chant, with a fallback (Recommended)". Generated chant per trope system, each after its own blind review, with a recording by Daniel or a song leader as the fallback; blessings as text plus a CRC Music link. G1, G2 and G3 are unchanged.
- **E3, Sefaria courtesy note.** Daniel: "No". No note is sent (`SEFARIA-NOTE.md` stays an unused draft). Unchanged and still to do: an identifying User-Agent on every Sefaria request and the CC BY credit on More on this verse (`sefaria-upstream.md`).

- **Popup rulings, 2026-10-23 (answers as Daniel gave them as option labels; Cowork relayed them after the bullets above).**
  - **Learn to lein, next activities.** Look-alikes, which half and quick ten ship right after 1.5, as 1.6.
  - **Real-family pilot.** "I'll say when". There is no pilot until Daniel names the moment, and nothing goes to families before it: announcements wait for the pilot.
  - **Codex's PR #43.** "Review and close now". Daniel is handling it separately; this brief only records the ruling.
  - **Learn's tap exercises.** A tap answers while the question is open and gives no audio; once answered, any word opens its word card.
  - **v1.5.0 is the beta tag.** `/read`, `/learn` and `/trope-chart` become indexable at v1.5.0 (this fixes the date in the F2 bullet above); signed-in pages and workspaces stay noindex. **[Superseded 2026-10-24: see "Amended 2026-10-24 (G0)" at the end of this file.]**
  - **Install hint.** Shown once to anyone on a phone or tablet, signed in or not. Once dismissed it stays dismissed, and it is always available from the menu.
  - **Learn to lein before the listening round.** Lessons stay live before Daniel's listening round; his edit list is fixed as one batch afterward.
  - **Analytics.** Aggregate, cookieless page counts on public pages only: no per-person data, within the current Vercel plan, and nothing on signed-in pages. Any spend beyond the current plan still needs Daniel.
  - **Check-ins.** Daniel is interrupted only at release tags and true blockers (money, licences, wording with no precedent, security findings).
  - **Voice track (M0).** Starts after the 1.6 activities, not right after 1.5.
  - **Pace.** At most two builders at once, with Sonnet for routine work.

## Current 1.0 scope — Daniel, 2026-10-17
**Amended 2026-10-22, evening (Daniel, the leyning platform):** Daniel widened the product: "It will be the way that users can lein and learn to lein at CRC, nut just beit Mitzvah kids. It will also be my ideal way to lein, and to get ready for services every week. This includes the ease of opening one place and having the text, the translation, the main commentaries, the main midrashim and halachik implications, etc, as well as everything to get ready to lein and live translate and interpret, which is my way." The vision spec is `docs/superpowers/specs/2026-10-22-leyning-platform-design.md`; its settled decisions are binding. Rulings from the same evening:
- **Accounts:** "everyone can create an account and use it and customize readings they want to work on. I'll approve requests. But they can access the whole thing other than saveable customize readings." No age gate on requests ("no age"). A member's notes and drafts are private to that member, including from staff.
- **Not for the bimah:** everything serves weekday preparation.
- **Name and address:** CRC Torah at torah.centralreform.org; the existing addresses keep working. The home page becomes a front door to This week, Learn to lein and Beit Mitzvah.
- **Licences:** "use all, don't stress." Every text Sefaria serves may be displayed live with its edition, licence and Sefaria credit, including CC-BY-NC and unmarked editions. This settles the licence question for Sefaria texts shown live; it does not relax never-in-repo (no licensed text in the repository or fixtures) and does not cover texts from other sources.
- **First commentaries:** Rashi and The Torah: A Women's Commentary ("women's and Rashi to start").
- **CRC's weekly reading** is the standard Hebcal reading; no separate CRC selection.
- **Study defaults:** English on and Rashi inline when Study opens.

**Amended 2026-10-22, later (Daniel, Finkel recordings become voice material):** Daniel, verbatim: "let's cut the Finkel recordings and use only pocket Torah. Instead we will use Finkel as the basis for the future work of of the voice we are developing". The portal plays PocketTorah only; Cantor Finkel's recordings are not played to anyone in the portal. His licensed, unrestricted package is the source material for the generated-chant voice work (G3 still governs any generated chant). This supersedes the Finkel playback parts of the two 2026-10-22 amendments below.

**Amended 2026-10-22 (Daniel, show rather than hide; alpha and beta):** Daniel, verbatim: "It can all go live, even before my listen. The site is in alpha right now. 1.5 release will be beta. We will be in beta until 2.0. also, as a general rule, we should always fault on the side of showing rather than hiding. Eg, provide the trope and chanting, show the text to alogged out user, etc...." His answers to the follow-up questions, the same day, bind as follows: **[Amended 2026-10-24: "1.5 release will be beta" no longer holds; see the end of this file.]**
- **Human recordings go live now, before any listening review.** PocketTorah reference audio and Cantor Finkel's recordings play for students, families and staff without waiting for Daniel's listen. Finkel: the producer's chosen take only. No listening review is required for human recordings; bad cuts are fixed as they are found.
- **Generated chant keeps G3.** The trope engine's synthesized chant stays held until Daniel passes the listening review (ruling 17 and the G3 boundary are unchanged). Once it passes, it fills the verses that have no human recording; human recordings always come first.
- **Signed-out visitors see** the Hebrew text with trope, the JPS 2023 translation (Daniel: CRC's licence allows public display), the human reference recordings, and the study tools (trope explanations, word aids, the tikkun view, "this word elsewhere"). Public pages ask search engines not to index them until beta.
- **People stay private.** Show-rather-than-hide applies to texts, audio and tools. Anything about a student, family, tutor note, assignment or date stays visible only to that family and staff, as before.
- **Notifications stay off** until Daniel says to switch them on.
- **No alpha or beta label** on screen.
- **Spend:** Claude may approve new hosting cost while total portal spend stays under $10 a month, logging each item in STATE.md; anything that would push the total past $10 a month goes to Daniel.
- **The 18 special-Shabbat and festival haftarot with no recording** stay text-only for now (no upload feature, no new recordings requested).
- **Default for new questions:** when a choice is between showing and hiding a text, a recording or a tool, show it.

**Amended 2026-10-22 (Daniel, Cantor Finkel's recordings):** Daniel, verbatim: "Let's get it finished. I have Finkel license done... He's given us all recordings unrestricted." Cantor Josh Finkel's recording collection is licensed to the portal without restriction. This settles the open cantor-licence item (credit, honorarium and withdrawal terms are no longer blocking). Finish the Finkel integration: private storage, playback beside PocketTorah, and inclusion in Daniel's listening review. Unchanged: recordings never enter the public repository; student playback of any reference audio still follows Daniel's listening acceptance; G3 applies only to generated chant.

**Amended 2026-10-20 (Daniel, adult honors):** Adult Beit Mitzvah students may manage their own honors form and their honorees' private blessing links, with staff oversight, with the same capabilities a parent has for a child. This applies to their own student record; child students and delegated child-practice views gain no honors-management authority. Existing staff oversight and private-link safeguards remain. This resolves the earlier adult self-edit policy hold; reviewed implementation and release checks still precede availability.

**Amended2026-10-18 (Daniel approved verse-first playback):** Tapping a word in the main reading plays its whole verse, with word-by-word highlighting. Individual-word playback remains an explicit practice drill. Musical phrase playback follows a reviewed cantillation boundary policy; existing teaching/color groups are not certified musical phrase boundaries. Preserve flowing text, looping and pitch-preserving speed control; this interaction change does not waive latency, acoustic alignment or listening acceptance.

**Amended2026-10-18 (Daniel's listening feedback and unassigned study flow):** Live reference playback fails Daniel's acceptance across every passage tried: word tapping is slow, boundaries are inaccurate and the experience is not yet as smooth as TropeTrainer. Repair latency and acoustic boundaries before resuming new MCP composition; structural text/hash/count checks and synthetic browser tests are not listening acceptance. When a student has no assigned Torah aliyah, default to the full proposed parashah so they can study it while choosing their reading. The full proposal remains read-only exploration, not an automatic confirmed assignment. Existing confirmed selections take precedence; generally three aliyot of three verses each is guidance, not a fixed verse cap. Preserve date-plus-service-slot computation and unknown-slot handling.

**Amended 2026-10-18 (Daniel's explicit honoree material permission):** Invited CRC honorees' private, expiring links may display the before/after Torah blessings from CRC's existing Beit Mitzvah booklet, including its English translation, with the booklet's required credits. Show only the recipient's own aliyah. This does not permit publishing the booklet or sharing its audio. Exact source, required notices, scoped projection and reviewed bearer controls remain implementation requirements; the database migration must not activate material or issue links.

**Amended2026-10-17 (Daniel's live product feedback):** Reference playback must be directly available by clicking words/verses in the main reading, in the spirit of TropeTrainer. Consecutive verses should form a flowing reading block so students learn the passage in context; a separate lifted verse and manual Load step are not the primary listening flow. Tab return must not repeatedly replace an unchanged authorized reading with “Checking your access.” Quiet background revalidation retains reading/scroll; real denial, identity/scope changes and expiry still invalidate access, and server authorization remains unchanged. This supersedes the older compulsory close-up interaction and blanket visibility-based workspace erasure.

This revision supersedes older scope and ordering below. Generated trope voices are **outside 1.0**. Student recordings are **parked**: the internal prototype is not a usable finished feature. Preserve its checkpoints without finishing or activating upload, submission, retention workers or recording controls for this release. Continue storage work only when needed for reference playback.

The first priority is **existing human reference recordings playable by word and verse**, with synchronized Hebrew highlighting and selected-word/verse looping. Independent pitch adjustment is desirable only if speed and text alignment remain correct. Recover and reuse the PocketTorah reference index/contract already researched; do not restart source discovery or invent word timings. Reference recordings are a primary feature, not an interim generated-voice substitute. Generated-chant G1/G2/G3 gates remain binding on future generated assets; they do not gate authentic reference playback. Reference provenance, attribution, timing review and Daniel's listening acceptance still apply.

Next: (1) word/grammar tools, Hebrew syllables/stress, commentary and source assignments; (2) family honors and scoped honoree links; (3) MCP, read-only Maven and the owned roster Sheet; (4) final integration, deployment and Daniel's testing. Offline/PWA and notification extras follow 1.0. Essential sign-in and explicitly initiated invitation mail remain distinct; quiet imports still send nothing. No other human testing before the revised product is complete and Daniel approves it.

Existing privacy, authorization, repository protection, quiet-import, licensing and spending rules remain. Historical generated-voice/recording plans and retention decisions are preserved for future work, not current release requirements.

## What this is

A web-app portal for child and adult Beit Mitzvah students at Central Reform Congregation (CRC), St. Louis, built so other congregations can be added later. A student finds their Torah and haftarah readings, equally prominent, and the service parts they lead: Hebrew with vowels and cantillation, translations, trope and recording practice, chosen commentary and translation tools. Tutors and rabbis assign the material, leave notes and hear submitted recordings. The product scope is reading and service preparation; d'var Torah, mitzvah projects and general family logistics are outside 1.0.

It is the second product carved out of the haftarah repo (`RavBogard/haftarah`). The haftarah 2.0 spec (`docs/superpowers/specs/2026-10-15-web-2-0-design.md`, commit `5b2530f` of 2026-10-15) rules that "the study-sheet maker and viewer and the B'nei Mitzvah portal are two products": the trope engine, the audio store, the player, the drills, record-yourself and the cantor question all belong here, and nothing tenant- or user-specific ever enters the haftarah repo.

## Settled decisions (Daniel, binding, 2026-10-15; dated amendments below)

### Users and roles

1. Four roles per congregation: **student**, **parent**, **tutor** (their assigned students; can assign sources and leave notes), **rabbi/admin** (everyone in the congregation; sets defaults). A cantor is a tutor with a flag. **Amended 2026-10-16, rulings 32/48 and direct clarification:** the parent dashboard is read-only except the honors form; it hides the child's recordings. Recordings are available inside the explicitly selected linked-child practice view through parent sign-in. This delegated capability does not grant tutor/admin authority.
2. Google sign-in with a magic-link fallback; no passwords. **Amended 2026-10-16, ruling 32:** scoped signed, expiring honoree links to blessings/audio are the one no-login surface. They require their own reviewed bearer-access contract, fragment/body transport, revocation and strict field projection.
3. Under-13s exist. **Amended 2026-10-16, ruling 33:** the same portal serves adults. The rabbi sets `student_kind` (child/adult); a child requires parent email, while an adult's parent email is optional and the adult is their own contact.
4. Manual rabbi entry and CSV import remain. **Amended 2026-10-16, rulings 41–42:** add read-only Maven roster import; never write back to Salesforce. Daniel adds Morning/Afternoon to that external feed. Until supplied, imported slot is unknown and the rabbi sets it. Match stable source record ID within tenant/source namespace; name/date may suggest explicit reconciliation, never silently establish identity.

### The student's reading

5. A student record holds the date, service slot, parashah and exact assigned verses. **Amended 2026-10-16, rulings 34–35:** morning is 10:00; Havdalah/afternoon is 4:00 and uses the following Shabbat's parashah. Show the whole proposed parashah and default to tutor/rabbi custom selection; triennial/full-parashah are optional helpers. Unknown slot requires resolution rather than silently assuming morning. Typical short Torah/haftarah selections are guidance, not fixed verse caps. Verify holiday/afternoon cases against actual Hebcal data before implementing edge rules.
6. The portal fetches its own texts from Sefaria for the assigned verses. The haftarah Blob store is not the source of record (it holds only Daniel's weekly class selections, and JPS 2023 is CC BY-NC).
7. **Amended 2026-10-16, ruling 31:** Torah and haftarah are both in 1.0 and equal on the student page; the earlier Torah-first deferral is superseded. Service-part scope is recorded below.

### Commentary

8. All sources are theoretically available on any verse (Sefaria's related texts, the way "everything on this verse" works on the haftarah site), plus Claude-written summaries labelled as such, same rule as the sheet.
9. The rabbi sets the congregation's defaults: which sources show by default.
10. A tutor or rabbi can assign particular sources to a student so they show up when that student is studying. Commentary is keyed to the student's own verses, folded under the verse, never a wall.
11. Claude-written historical-critical summaries are generated through the portal's MCP and approved by the rabbi before a student sees them. No student-facing chatbot in 1.0.
    *Amended 2026-10-21 (Daniel, Torah study guides spec S13):* the Claude-written default guide is student-visible immediately, clearly labelled with its review state ("Written by Claude for CRC · not yet reviewed by {rabbi}"); rabbi review changes the label, it does not gate visibility. Approval is an MCP write by the rabbi from Cowork (S10). An unattended routine never replaces reviewed work (S25).

### Translation tools

12. The word panel (STEP grammar, BDB, "this word elsewhere"), the translation picker across editions, and a guided "build your own translation": the student writes a translation verse by verse, saves drafts, and the tutor sees them. JPS 2023 is the reference translation.
    **Amended 2026-10-21 (Daniel):** no translation picker in 1.0; the main text stays JPS 2023 only. Commentary editions remain available in the source reader.
13. **Amended 2026-10-16, ruling 38:** no visible transliteration. Tapping a word offers syllables and marked stress in Hebrew letters. Internal synthesis phonemes are unaffected.

Historical note: the earlier 2026-10-16 pause/reconsideration of the original Latin-letter toggle is closed by ruling 38; it is no longer an open choice.

### Trope and audio

**Confirmed 2026-10-16 (Daniel):** sung practice uses Adonai/Elohim, as in the ceremony, rather than Hashem. Visible transliteration is excluded by ruling 38.

14. Per-verse play, slow/loop, trope-family drills and printable trope chart retain the chant-integration contract: label "Claude-generated chant" and check with tutor/cantor; 64 kbps mono MP3; Standard Reform (Binder/Avery) default; speed 0.5–1.25. **Amended 2026-10-16, rulings 45/53/58:** student-scoped practice events support the student's quiet calendar/streak; others receive days-practiced only, with no cross-student reporting or leaderboards. Installable PWA/offline current audio and deferred recording upload are in scope. App-controlled caching is allowed; no file-export control is offered, without promising that playable audio cannot be saved. Generated chant offers bass/tenor/alto/soprano, chosen by student or tutor, with tutor-set default; reference recordings play as recorded. Four independent renders are a hypothesis to benchmark, not a settled mechanism. Range/renderer version belong in release identity, with G1/G2 per asset and G3 evidence across released ranges.

**Practice-history retention, confirmed 2026-10-16 (Daniel, direct chat):** keep detailed practice activity for 90 days, then retain only dates practiced until one year after the ceremony. This is a separate policy from submitted-recording retention. Other people's practice summaries remain days-only; the detail window does not grant parent-dashboard or tutor access to raw events.
15. Record-yourself, and the student *can* send a recording to their tutor. (Ruled out on the public haftarah site; here it is the point.)

**Amended 2026-10-16 (Daniel):** Retain students' submitted recordings for one year after their ceremony, then delete them. This is distinct from any separately consented adult voice-training or reference corpus.

**Amended 2026-10-17 (Daniel, direct clarification):** The same one-calendar-year-after-ceremony deletion deadline applies to **all student recordings**, including private recordings never submitted to a tutor. Students may delete earlier. Private/submitted state does not extend retention, and postponing a ceremony must not revive an already-overdue recording. Separately consented adult training/reference audio remains distinct. Future app-controlled offline copies must honor the same deadline through the reviewed offline-expiry contract; no instantaneous offline revocation is claimed.
**Clarified 2026-10-16, rulings 39/48–49:** the tutor supplies pronunciation/chant feedback; automated scoring is not a goal. Parent-dashboard notice explains storage, access and one-year deletion without becoming a consent gate. Dashboard recordings remain hidden; delegated linked-child practice access follows ruling 1.
16. Until the engine's listening gate G3 passes, the portal ships with the player built and the audio slot empty; a tutor or the rabbi can upload a recording per verse as the interim source.
17. G3 stays the gate before any student hears generated chant: Daniel passes at least 95% of the review verses on melody with zero "would teach wrong", after the automatic gates G1 (notes within ±50 cents) and G2 (technical checks).

### The engine move

**Amended 2026-10-15 (Daniel):** Permission for the Binder/Avery melody tables covers noncommercial use, and the tables are allowed in this public repository. This resolves the public-inclusion decision in engine open item 15. Preserve that restriction in the table notices, separately from the MIT license for code; this is not an unrestricted license grant for the tables. Printed-source accuracy checks and the G1/G2/G3 student-audio gates remain unchanged.

18. `trope/` moves from the haftarah branch `trope-engine-research` into this repo **with git history** (subtree), plus a copy of the trope functions from `template/lib.js` (`tropePhrases`, `TETRA` and what they need) until the haftarah Wave 6 engine package exists; then the portal switches to the package.
**Amended 2026-10-16, ruling 56:** consolidate token-level phrase-family logic into dependency-free `trope/lib-trope.cjs`; the app keeps a thin typed wrapper and colors. Preserve exact Hebrew, qere/ketiv and read-word indices reviewed at `ff1215a`, locked by existing app/chart tests and the 182-verse parity golden. The haftarah study-sheet package is not a trope-engine replacement.
19. Rendering stays an offline GPU job (Daniel's RTX 4070 laptop now; Modal or a rented GPU later, engine open item 2) that uploads MP3s and a manifest to a Blob store **the portal owns**. The `haftarah-audio` store is renamed or replaced.

**Reassessment authorized, 2026-10-16 (Daniel):** Research the best voice/rendering approach from first principles rather than treating the previous technical choices as optimal. Daniel or a willing cantor/tutor could supply recordings if justified. That possibility is not permission to upload another person's voice or spend money. Existing teaching-quality/listening gates remain in force while implementation and hosting recommendations are reconsidered.
20. The engine's tests must pass in the new repo before anything else is built on it. (Amended 2026-10-15 while planning: the interview said "314 tests"; 314 is the whole branch suite, of which 108 are the engine's and move; the other 206 test the haftarah sheet and stay. The gate is the 108 plus a parity golden against haftarah's `lib.js`.)

### Tenancy, hosting, repo

21. Multi-tenant from the schema up; CRC launches first, Daniel is sole platform owner, one Vercel deployment and Neon Postgres. **Amended 2026-10-16, ruling 52:** build congregation settings and minimal onboarding now in anticipation of a second congregation. Actual second-tenant provisioning remains Daniel's gate.
22. Hosting cap: under $25/month ideal, $50 acceptable (same as Overlays).
23. Public GitHub repo `RavBogard/bneimitzvah`, checked out at `C:\Users\dsbog\bneimitzvah`; same-team Vercel project. **Amended 2026-10-16, ruling 59:** target canonical host is `beitmitzvah.centralreform.org`; `barmitzvah.centralreform.org`, `batmitzvah.centralreform.org`, `bnaimitzvah.centralreform.org` and `bneimitzvah.centralreform.org` redirect there. Register all five with Vercel and CRC's host directory, without granting alias API/cookie trust. Daniel's CNAME work and project registration/TLS are verified; he reports the new canonical Google JavaScript origin added. Reviewed application mapping/redirect migration and deliberate canonical configuration cutover remain implementation/acceptance work. Preserve the working Vercel address until cutover; reject noncanonical mutations and never forward credential queries between hosts.
24. Public repo means: code, melody tables and tests are public. **Never in the repo:** JPS text or any licensed text, student data, recordings, credentials. A test enforces this, like the haftarah publish-whitelist test.
25. **Amended 2026-10-16, ruling 27:** product/CRC tenant display name is **"CRC Beit Mitzvah"**. Repository naming need not change.

### Claude's place in the product

26. An MCP server on the portal (the pattern of the haftarah Wave 6 plan) so Daniel and tutors can set up students, assign sources, and draft labelled summaries from Cowork. Sign-in through Google OAuth, restricted to the congregation's rabbi/admin and tutor accounts.

### Additional 1.0 scope — amended 2026-10-16

- **Service learning (28–30, 37, 51, 55):** Torah/haftarah blessings, Sh'ma/V'ahavta and an assigned menu of service parts; tikkun view and printable practice sheet. Import/cache stable unit IDs from shirei-tfilah's published `feed.json` and its dedicated Beit Mitzvah morning/Havdalah volume. Prayer audio links out to CRC Music; portal reference recordings remain Torah/haftarah verse recordings. D'var drafting/feedback follows 1.0; reserve an extension seam without prematurely creating unused tables.
- **Office (32, 43–44):** include aliyah cut points and parent-written honors form; honoree access follows ruling 2. Write one portal-owned Beit Mitzvah Roster Google Sheet with student/Hebrew name, date, slot, parashah, Torah/haftarah verses, tutor and rehearsal dates. Staff read that sheet; no staff role, lesson scheduling or pay/hour accounting. Custom siddur inputs/packet export and supplement generation wait for v2.0; collect none in 1.0.
- **Teaching and progress (36, 40, 45–48, 54):** recording-first and trope practice are both first class; clergy, staff, hired and volunteer tutors share the tutor role. Tutor verse statuses are not started/working/solid, alongside student self-checks and ruling 14's private practice history. Parents see reading/progress, ceremony/slot/logistics, tutor notes, lesson log and honors; their practice-activity summary is days-only; raw events remain student-scoped. Tutors write lesson summaries without hours. Existing Resend sends tutor recording/draft notifications, weekly parent digests and opt-in student reminders. No student assistant in 1.0.
- **Immediate order (57):** finish observed production query-free Google/magic-link sign-in first, verify existing Neon migrations/restricted role rather than redoing them, and establish Resend delivery. Daniel must be able to use his phone. Then canonical name/host, slot/adult/custom-first assignment behavior, equal Torah/haftarah and service/honors work. Provider presence or synthetic checks do not establish real delivery or sign-in.

## Outcome: what "done" means

**Clarified 2026-10-15 (Daniel):** Build the full product to feature completeness before testing with anyone other than Daniel. This includes the planned MCP and generated-chant capabilities, with Daniel's listening approval still required. Daniel is the only human product tester until the feature-complete gate; no early student, parent, or tutor pilot. Automated tests, browser checks and independent agent reviews continue during development. The real-student/tutor pilot remains Phase 7, after the preceding feature phases are complete and Daniel approves proceeding.

The 1.0 gate is a real CRC student and a real tutor using it for a real reading start to finish, with Daniel as rabbi, and nothing needed a workaround. Before that, each phase ends with the machine gates below green and a deploy that Daniel can click through.

## Boundaries

- The haftarah repo is not touched by this project except: (a) the subtree extraction of `trope/` reads its history; (b) the haftarah Wave 6 engine package, when it exists, becomes a dependency. The printed sheet's golden stays byte-identical; this project never needs it to change.
- Nothing licensed or personal in the public repo (ruling 24).
- Hosting cap (ruling 22). Money interrupts Daniel above the $10-a-month total (amended 2026-10-22).
- The G3 gate (ruling 17) is not negotiable; no student hears generated chant before it. It covers generated chant only; human recordings are released (amended 2026-10-22).
- Dependency rule: the engine folder (`trope/`) stays dependency-free Node + its vendored, licensed copies with `PROVENANCE.md`, as on the branch. The Next.js app may take pinned dependencies; it never imports from the engine's Python side.

## Authority: who decides what

**Amended2026-10-17 (Daniel, direct chat):** "You have permission to continue working until you finish the product. Deploy at will." Codex owns continued implementation, integration and deployment through feature completion with Sol6.1 workers and independent reviews. This supersedes the requirement for a separate Daniel approval before each student-visible release, including the current calendar candidate. Preserve the selected design direction and required automated/adversarial gates. New spending, unresolved licensing, actual second-tenant provisioning and generated-chant listening/release gates remain unchanged. Daniel remains the only human tester until feature completeness. Do not interpret release authority as permission to send family invitations or import the held real roster; those remain separate explicit administrative actions.

**Private media spending approved2026-10-17 (Daniel, direct structured reply):** Daniel chose private Vercel Blob after reviewing the [account-aware cost estimate](../../superpowers/research/2026-10-17-private-media-spend-notice.md). Create one dedicated private `beitmitzvah-private-media` store in `iad1`, connected only to Production, using OIDC and synthetic acceptance objects first. Ordinary incremental media planning target is $5–8/month, with review of a forecast above $10; this is usage billing, not a hard cap. Do not change shared CRC billing/CDN settings or use this approval to bypass access, byte verification, cleanup/environment acceptance or G3. A new provider/scope/spending change still requires Daniel; R2/S3 research is not approval to switch providers.

- **Amended working ownership, 2026-10-16:** Astra is primary project manager for product direction, architecture, ambiguity, delegation and final integration. Sol 6.1 agents implement bounded assignments with explicit ownership/checks and preserve concurrent edits. Earlier Opus/Fable/Sonnet assignments are superseded; independent adversarial review remains mandatory for high-stakes changes.
**Amended 2026-10-21 (Daniel, Google callback log exception):** Daniel's ruling, verbatim: "Accept, ship tonight". Google's one-time OAuth authorization code and `state` may appear in Vercel's native request logs for `GET /api/auth/callback/google` only, the redirect-mode Google sign-in added because the Google popup fails on phones (decided in [MCP-DECIDED.md](../2026-10-21-torah-study/MCP-DECIDED.md#connecting-from-a-phone-decided-here-2026-10-21)). This holds only while Daniel is the sole member of the Vercel team (one OWNER and no other members, checked 2026-10-21). If anyone else is ever added to the Vercel team, this exception must be revisited first. Every other query-token route stays forbidden, and the "no credential in any log" gate holds everywhere else.

- **Machine gates decide:** tests green (`npm test`, no network), the migrated engine tests plus parity golden (ruling 20 corrects the original 314 count), never-in-repo, a rendering golden, no credential in any log/tool result, and a deploy that serves the live site.
- **Daniel is interrupted for:** money (any new paid service, any upgrade, the Blob store spend notice), anything student-visible before it ships (he wants to see it), the cantor licence and any other licence question, a second tenant, and any ruling above that turns out to be wrong in practice. Everything else: decide, log, move on.

## Proof: done means verified, not written

- Every phase ends with the tests above green on Daniel's machine (Windows) and in CI (Linux).
- Student-visible pages get a browser check (Playwright, as the haftarah `web-check` does): the page loads with a fixture student, the trope colours and word panel open, the player bar renders with the audio slot empty.
- Anything high-stakes (auth/bearer access, tenancy isolation, repository protection, recording access and generated-chant release) gets an independent adversarial pass by a second agent before it is reported done.
- "Working on my laptop" is not done. A deploy Daniel can open is.

## Where it lands

- Repo: `RavBogard/bneimitzvah` (public), local checkout `C:\Users\dsbog\bneimitzvah`.
- This brief: `docs/planning/2026-10-15-kickoff/MISSION.md`. The plan for Code: `PLAN-CODE-2026-10-15.md` beside it. Phase status: `STATE.md` beside it (the haftarah house format: gates as "GATE: … — proceeded because …", blocks as "BLOCKED (Daniel): …", a tickable checklist, resume notes).
- Specs per phase go in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, plans in `docs/superpowers/plans/`, research in `docs/superpowers/research/`, as in the haftarah repo. Each spec opens with "Settled decisions (Daniel, binding)" and ends with "Open items that wait on Daniel".
- Deploy: Vercel; target canonical `beitmitzvah.centralreform.org` after ruling 23's reviewed cutover. The working Vercel origin remains until acceptance.

## Scale and surface

This is a campaign, not one session. Phases (shape, not schedule; the plan file has the detail):

0. Repo, brief, scaffolding, CI, the never-in-repo test.
1. Engine move with history and parity gates; consolidate shared trope logic without changing reviewed Hebrew behavior.
2. Production sign-in first; then canonical host/name, slot/adult/custom-first roster behavior, Maven/CSV import, roster Sheet, congregation settings and minimal onboarding.
3. Equal Torah/haftarah study, word/translation/commentary tools, Hebrew syllable/stress help, tikkun/print practice, assigned service parts, aliyah/honors/honoree access.
4. Player/recording/send/reference audio, verse progress/self-checks, private practice calendar, lesson log, notifications, recording retention/notice and scoped PWA/offline behavior.
5. The MCP server.
6. Generated chant in four human ranges behind G1/G2/G3; renderer/range/release identity, benchmarked voice approach and approved audio storage.
7. Real-student pilot.

**Amended 2026-10-16:** Astra directs and integrates; Sol 6.1 implements. Cowork review supplies recorded decisions/research, while detailed mechanisms require bounded architecture/security review. Use the existing plan and short STATE handoff; no parallel replacement plan. Annotated score remains the selected code-first interface direction.

## Open items that wait on Daniel

Open gates attach to their dependent milestone; they do not defer the production sign-in priority:

- Unresolved engine/voice/compute, Decalogue/special melodies, printed-table accuracy and source-permission questions remain scoped to their work. Public noncommercial melody-table inclusion was approved on 2026-10-15; four ranges and generated-chant-as-goal are settled, not open alternatives. Tutor/rabbi still set actual custom verses and aliyah cuts.
- The cantor's licence (Cantor Josh Finkel): which grants, credit and honorarium, withdrawal terms — only if path 3 (recordings) is pursued. Blocks nothing until then.
- A second congregation, when there is one.
- Before offline release, settle the permitted offline authorization/release lease interval. A disconnected device cannot discover withdrawal immediately; require scoped caches, expiry, reconnect revalidation/purge and account-switch/logout cleanup. Storage eviction and pending-upload loss need visible handling; do not cache private API responses generically.
- Confirm external Maven source IDs/slot feed and published shirei-tfilah dedicated-volume contract; verify CRC Music link capabilities, relevant text/font permissions and storage costs at their milestones. Bound practice-event retention/purpose before shipping it. Exact mechanisms in review section 3 remain proposals.
- Reconcile inherited customs flags at the implementation milestone without reopening settled custom-first selection, Binder/Avery default or Adonai/Elohim pronunciation.

## Source record

- Haftarah 2.0 spec, sections 2, 3.1, 3.3, 5.11, 10, 11.1 (what the portal is and what the haftarah repo must never hold).
- Chant integration plan D1–D13 and the engine's questions O1–O13 (superseded for the haftarah site, "the record for the portal, which inherits the engine").
- Trope engine design spec and trope audio web-integration spec, branch `trope-engine-research` at `380b1b2`; handoff `docs/superpowers/plans/2026-10-15-trope-handoff.md` (the work queue, now on the RTX 4070 laptop); `chant-audio.md` research (the cantor licence, section 5).
- Kickoff interview, Cowork, 2026-10-15: three rounds, every proposal approved as written except ruling 8–10, which Daniel restated ("rabbi sets defaults that are shown; all sources should be theoretically available; a tutor or a rabbi can assign particular ones to the student so they show up when the student is studying").
- [2026-10-16 plan review](../2026-10-16-review/PLAN-REVIEW.md): section 1 rulings 27–59, Astra integration corrections and Daniel's direct recording-surface clarification. These dated amendments supersede the specified kickoff provisions; section 3 is not blanket mechanism approval.

## Amended 2026-10-23, later (Daniel, alignment rulings)

Daniel answered the alignment questions on 2026-10-23, after the rulings above. All are binding. Where one conflicts with older text, it supersedes it and the older text stays as written.

**Wording, approved verbatim**

1. **Approver page help line:** "Anyone who asks in good faith can have an account, member or not. Decline only spam or abuse."
2. **CC BY change line**, shown beside "via Sefaria (CC BY)" on More on this verse: "Selected and ordered by {productName}".
3. **Android install fallback:** "In Chrome, open the menu and tap Install app or Add to Home screen."
4. **1.6 Learn to lein activity strings.** The strings drafted in `C:/Users/dsbog/cowork-offload/research/learn-next-activities.md` are approved as drafted: Same sign, different place; Which half of the verse; Quick ten. They may be edited after his listening round.

**Working rules**

5. **Shabbat and yom tov:** "Anything, anytime." Shabbat puts no limit on deploys, merges or tags.
6. **A deploy that breaks the live site during autonomous work:** roll back to the last good deploy at once, fix forward, and report it in the next release note.
7. **Release check-ins (v1.4.0, v1.5.0, 1.6):** a short note in the Claude Code terminal, under 15 lines: what shipped, what to try, anything that needs him.
8. **Real iPhone check of Learn to lein:** a tutor or family runs it later, at the pilot. An iPhone check sheet is modeled on `PHONE-CHECK.md` (`docs/planning/2026-10-23-cowork-offload/IPHONE-CHECK.md`).

**Public pages**

9. **Analytics, cookieless:** use Vercel Web Analytics only if it adds nothing to the bill on the current plan. Otherwise build our own page counter: path and day only, no third party. This applies the existing popup ruling (aggregate, public pages only, nothing on signed-in pages).
10. **Share cards at v1.5.0 indexing:** a plain generated card per page with the page title, `{productName}` and the yad icon. No photos.
11. **Google Search Console sitemap:** the CRC staff helper submits it at v1.5.0. The step is added to `FORWARD-MESSAGE.md`.

**Order and parking**

12. **Draft PR #22** (the admin page for the reference-audio listening review) stays parked. The voice work picks it up, renumbers its migration and finishes it.
13. **Daniel's listening round on the lessons** (`LISTENING-ROUND.md`) happens at the v1.5.0 check-in, not at v1.4.
14. **1.6 ships all three activities together in one release.**
15. **New feature: the reader's print sheet.** Queued after 1.4 and 1.5; no date. It runs in parallel with 1.6 or with voice, as the second builder. Daniel, verbatim: "I want selecting a reading to do for this next Shabbat to be super easy. Including selectable and creatable from the MCP. I'm thinking through a use case where I want a printed sheet for me to have up for the Torah reading. It's got Hebrew-- I don't need a tikkun view-- and the English translation next to each other in columns. It needs to be really well thought out as a usable document. But it needs to be able to have all sorts of different formats because different people might want different things printed." He asked that the build use the impeccable, ui-ux-pro-max and frontend-design skills. Spec stub: [2026-10-23-reader-print-sheet-design.md](../../superpowers/specs/2026-10-23-reader-print-sheet-design.md).
17. **The second builder, once 1.6 ships, takes the print sheet (15)** instead of the two-tenant groundwork.

**Licences**

16. **JPS 2023 in print.** Daniel: "JPS 2023 is fine in print." CRC's licence covers printed copies of JPS 2023, and each printed page carries the edition and its credit line. This supersedes the earlier reading that limited JPS 2023 to on-screen display. Never-in-repo is unchanged: no JPS text goes in the repo or in fixtures.

**Amended 2026-10-24 (G0, docs catch up with Daniel's 2.0 rulings; nothing earlier in this file is rewritten).** Sources: Cowork's 2.0 record, now at [cowork/QUESTIONS-2.0.md](../2026-10-24-release-2-0/cowork/QUESTIONS-2.0.md), and the Batch 4 popups answered to Claude Code the same day. The plan is [2026-10-24-release-2-0/PLAN.md](../2026-10-24-release-2-0/PLAN.md). Where these lines and an earlier line differ, these win.

- **Beta, indexing and v1.5.0.** Daniel, 2026-10-23 late, verbatim: "You may continue deploying and versioning at will. The beta label comes when I say so, and not until then." Restated 2026-10-24 (Batch 1 Q5): "beta when I say so". So **v1.5.0 is an ordinary version and not the beta tag**. This replaces "v1.5.0 is the beta tag" (the F2 bullet and the popup-rulings bullet above), item 10 (share cards "at v1.5.0 indexing"), item 11 (sitemap "at v1.5.0"), and the 2026-10-22 lines "1.5 release will be beta. We will be in beta until 2.0" and "out of beta" as a 2.0 goal. Indexing of `/read`, `/learn` and `/trope-chart`, the sitemap submission and any "beta" wording on screen all wait for Daniel's word. `PUBLIC_INDEXING` stays false and robots keeps disallowing. 2.0 is not tied to beta and nothing in 2.0 waits on it.
- **Teaching: Claude may draft it, Daniel approves each one.** Daniel, 2026-10-24, verbatim: "Except don't always quote it. I want you to get my understanding and then draft each one for my approval, developing an evolving algorithm that can predict my next teaching on a prayer in my voice, progressively. Make sense? Ask pop up qs about each prayer to develop this, is my thought? A lot of this should already be in shireishabbat repo though...so I'm hopeful you might just be able to do it." And: "Always a humanistic approach that leaves room for more theistic people to still resonate." This replaces "not written fresh by Claude" and "Claude does not write that teaching" (D12/E2 above, the 2.0 brief, ROADMAP-2). Nothing goes live unapproved. All 49 teachings are approved (38 Shabbat morning, 11 evening and Havdalah with edits to reused texts, "Approve all") and are in [cowork/A3-DRAFTS/](../2026-10-24-release-2-0/cowork/A3-DRAFTS/). Daniel approved them living in the public repo (Batch 3b Q17: "Yes, public is fine (Recommended)"); they are his own text, not licensed text. [cowork/A3-VOICE-MODEL.md](../2026-10-24-release-2-0/cowork/A3-VOICE-MODEL.md) is how later teachings are drafted; it is not runtime data.
- **Credit rule.** Daniel, 2026-10-24 (Batch 2 Q9): "Rabbi Daniel Bogard". Approved teachings carry his name alone. This overrides, for approved teachings only, this file's rule that generated text carries its label. Anything not yet approved still shows "Written by Claude for CRC · not yet reviewed by Rabbi Daniel Bogard".
- **Ruling 45 widened for the service course (and only for it).** Daniel, 2026-10-24 (Batch 3 Q12): "Per-part 'finished' mark". Ruling 45's "nothing finer than days-practiced is reported to anyone else" stands everywhere else. For the service course, tutors and rabbis (and admins) see, per assigned part, whether that student has finished the part's lesson. Parents do not: Batch 3b Q18, "No (Recommended)". It needs its own staff-readable, insert-only record (the course's own progress table stays owner-only) and gets an adversarial privacy review before merge (plan slice SC5).
- **Ruling 51 replaced for 2.0.** Ruling 51 ("prayer audio links out to CRC Music") does not apply in 2.0: Daniel, 2026-10-24 (Batch 2 Q6): "No link yet. You should give me a list of things to record", then "I'll handle the readings here as a part of two point one". **2.0 has no melody link and no prayer audio.** Daniel records the prayers and handles their hosting in 2.1 (list: cowork-offload `A5-RECORDING-LIST.md`). The 2.5 line "blessings as text plus a CRC Music link" (D-5) is unaffected until 2.5 is opened.
- **`dvar_torah_draft` is retired.** The reserved name in ruling 30 and 44 (and `docs/planning/2026-10-16-review/PLAN-REVIEW.md`) gave way to a different design: Daniel, 2026-10-24 (Batch 1 Q1): "it will be a shared Google doc." The student drafts in a Google Doc shared with the tutor and rabbi; the app tracks stages, dates and the link in `dvar_torah_progress` (plan slice DV1, migration number taken at merge). There is no drafting in the app or in Claude (students cannot hold Claude accounts; "Parents and students cannot consent"). Parents see stages and dates, never the link (Batch 3 Q14); the rabbi owns feedback and the final text, tutors may mark feedback given, and no free-text focus line is stored (Batch 3b Q19).
- **Prayer text for the course (Daniel, 2026-10-24, Batch 4).** The course's prayer text, morning and evening/Havdalah, comes from CRC's own texts in the shireishabbat and shirei-tfilah repos, **public lane only**. The licensed Beit Mitzvah build never enters the app or this repo; it is reached only by the siddur page link. The SC2 and SC7 builders confirm which evening and Havdalah texts exist in the public lane; any that exist only in a licensed lane come back to Daniel as a licence question. Daniel's words: "Shouldn't they be in shireishabbat shirei tfolah repo for the actual CRC texts the kids have in the beit Mitzvah siddur? That's what we want".
- **Copy.** Daniel, 2026-10-24, "Keep all" for the service course strings (252), the D'var Torah strings, and the five fix lines (the 429 message, the uninvited sign-in line, "Tap verse numbers to choose them.", "Sign in to save", "page 23, after Mi Shebeirach"). Only the pilot kit is still unapproved.
- **Order.** Daniel, 2026-10-24: "I don't care about order. Feel free to reorder however, and continue until they are all finished."
- **Learn-to-lein spec path.** The 2.0 brief's `docs/superpowers/specs/2026-10-22-learn-to-lein.md` does not exist. Use `docs/superpowers/plans/2026-10-22-learn-to-lein.md` and `docs/planning/2026-10-22-learn-to-lein/`.

## Amended 2026-10-25 (Daniel, the Beit Mitzvah siddur text in the evening course)

- **The CRC Beit Mitzvah siddur text may be shown in the course, CRC only.** Daniel, 2026-10-25, recorded in Cowork's `QUESTIONS-1.9.md`: "the CRC siddur can be used . It's fine. Siddur integration is only for CRC, and only CRC exists at this point. Let 2.5 deal with that."
  - The evening (Saturday night and Havdalah) lessons use the siddur's own text from the `legacy-beit-mitzvah` feed in ShireiShabbat. That is the same feed the app already serves for assigned parts.
  - They follow the book's order and page numbers (printed pages 33–63).
  - For the CRC tenant, this replaces the 2.0 rule that this text is "never shown, stored or cached". Every other congregation is left to 2.5.
- **Who sees it (Daniel, 2026-10-25, popup):** "Anyone on the CRC site". Signed-out visitors to the CRC site see the text too.
- **Offline (Daniel, 2026-10-25, popup):** "Yes, for signed-in CRC people". Signed-in CRC people may keep it on the device in the offline pack. Signed-out visitors may not.
- **Unchanged:**
  - The text never enters any repo, fixture or snapshot, and `tests/never-in-repo.test.mjs` stays green.
  - It is never served to any other tenant.
  - The haftarah, shirei-shabbat and shirei-tfilah repos are still only read from.

**Amended 2026-10-26 (Daniel, beta).** Daniel: "It's beta once all the 2.0 work is done and live".
- **When:** beta begins once v2.0.0 is tagged and its deploy is live.
- **What beta is:** the F2 meaning. Set `PUBLIC_INDEXING` (`src/lib/site/indexing.ts`) to true, so `/read`, `/learn` and `/trope-chart` become indexable and robots.txt names the sitemap for the canonical origin. Signed-in pages, workspaces, the API, lessons and review stay noindex.
- **What changes and what stays:**
  - A "Beta" label in the site header, for now (Daniel, 2026-10-26: "List beta in the header for now"). This replaces "No alpha or beta label on screen" above.
  - The real-family pilot is still "I'll say when": beta sends nothing to families.
- **Canonical origin:** the sitemap follows `BETTER_AUTH_URL`. It names beitmitzvah until the torah cutover (T7) and torah after it.
