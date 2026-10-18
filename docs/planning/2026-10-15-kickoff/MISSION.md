# Beit Mitzvah Portal — mission brief

Filed 2026-10-15 from the kickoff interview in Cowork. This is the authority document for the project until a spec supersedes a section of it; a spec that changes a ruling here says so with a dated "Amended" note. Daniel's words are binding; everything else is Claude's read, approved by him in three rounds on 2026-10-15.

**Amended 2026-10-16:** Daniel's later rulings 27–59 in [PLAN-REVIEW.md](../2026-10-16-review/PLAN-REVIEW.md#1-rulings-from-this-session-daniel-binding-2026-10-16) are folded in below. Original numbering and dated decisions are retained; that review preserves the earlier wording and interview record. Its section 3 mechanisms remain proposals, subject to Astra's integration corrections and bounded design review. These requirements do not claim completed implementation.

## Current 1.0 scope — Daniel, 2026-10-17

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

### Translation tools

12. The word panel (STEP grammar, BDB, "this word elsewhere"), the translation picker across editions, and a guided "build your own translation": the student writes a translation verse by verse, saves drafts, and the tutor sees them. JPS 2023 is the reference translation.
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
- Hosting cap (ruling 22). Money interrupts Daniel.
- The G3 gate (ruling 17) is not negotiable; no student hears generated chant before it.
- Dependency rule: the engine folder (`trope/`) stays dependency-free Node + its vendored, licensed copies with `PROVENANCE.md`, as on the branch. The Next.js app may take pinned dependencies; it never imports from the engine's Python side.

## Authority: who decides what

**Amended2026-10-17 (Daniel, direct chat):** "You have permission to continue working until you finish the product. Deploy at will." Codex owns continued implementation, integration and deployment through feature completion with Sol6.1 workers and independent reviews. This supersedes the requirement for a separate Daniel approval before each student-visible release, including the current calendar candidate. Preserve the selected design direction and required automated/adversarial gates. New spending, unresolved licensing, actual second-tenant provisioning and generated-chant listening/release gates remain unchanged. Daniel remains the only human tester until feature completeness. Do not interpret release authority as permission to send family invitations or import the held real roster; those remain separate explicit administrative actions.

**Private media spending approved2026-10-17 (Daniel, direct structured reply):** Daniel chose private Vercel Blob after reviewing the [account-aware cost estimate](../../superpowers/research/2026-10-17-private-media-spend-notice.md). Create one dedicated private `beitmitzvah-private-media` store in `iad1`, connected only to Production, using OIDC and synthetic acceptance objects first. Ordinary incremental media planning target is $5–8/month, with review of a forecast above $10; this is usage billing, not a hard cap. Do not change shared CRC billing/CDN settings or use this approval to bypass access, byte verification, cleanup/environment acceptance or G3. A new provider/scope/spending change still requires Daniel; R2/S3 research is not approval to switch providers.

- **Amended working ownership, 2026-10-16:** Astra is primary project manager for product direction, architecture, ambiguity, delegation and final integration. Sol 6.1 agents implement bounded assignments with explicit ownership/checks and preserve concurrent edits. Earlier Opus/Fable/Sonnet assignments are superseded; independent adversarial review remains mandatory for high-stakes changes.
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
