# B'nei Mitzvah Portal — mission brief

Filed 2026-10-15 from the kickoff interview in Cowork. This is the authority document for the project until a spec supersedes a section of it; a spec that changes a ruling here says so with a dated "Amended" note. Daniel's words are binding; everything else is Claude's read, approved by him in three rounds on 2026-10-15.

## What this is

A web-app portal for b'nei mitzvah students at Central Reform Congregation (CRC), St. Louis, built so other congregations can be added later. A student signs in and finds their own Torah reading: the Hebrew with vowels and cantillation, a translation, the trope colored by family with audio to learn from, commentary chosen for them by their rabbi and tutor, and tools to work out their own translation word by word. Tutors and rabbis see their students, assign sources, leave notes, and hear what the student records.

It is the second product carved out of the haftarah repo (`RavBogard/haftarah`). The haftarah 2.0 spec (`docs/superpowers/specs/2026-10-15-web-2-0-design.md`, commit `5b2530f` of 2026-10-15) rules that "the study-sheet maker and viewer and the B'nei Mitzvah portal are two products": the trope engine, the audio store, the player, the drills, record-yourself and the cantor question all belong here, and nothing tenant- or user-specific ever enters the haftarah repo.

## Settled decisions (Daniel, binding, 2026-10-15)

### Users and roles

1. Four roles per congregation: **student**, **parent** (read-only view of the student's page and progress), **tutor** (their assigned students; can assign sources and leave notes), **rabbi/admin** (everyone in the congregation; sets the congregation's defaults). A cantor is a tutor with a flag.
2. Sign-in with Google for everyone, with a magic-link email fallback for kids without a Google account. No passwords.
3. Under-13s exist. Every student record carries a parent email.
4. The rabbi creates a student by typing name, date and parent email; the portal computes the parashah from the date and proposes the verses. CSV import is enough at first. No Maven/Salesforce integration in 1.0.

### The student's reading

5. A student record holds the date, the parashah (from Hebcal), and the exact verses assigned: a custom range set by the rabbi or tutor, defaulting to the triennial or CRC's selection. Optionally the haftarah and the blessings before and after.
6. The portal fetches its own texts from Sefaria for the assigned verses. The haftarah Blob store is not the source of record (it holds only Daniel's weekly class selections, and JPS 2023 is CC BY-NC).
7. Torah first. Haftarah and blessings are in the data model from day one and second in build order.

### Commentary

8. All sources are theoretically available on any verse (Sefaria's related texts, the way "everything on this verse" works on the haftarah site), plus Claude-written summaries labelled as such, same rule as the sheet.
9. The rabbi sets the congregation's defaults: which sources show by default.
10. A tutor or rabbi can assign particular sources to a student so they show up when that student is studying. Commentary is keyed to the student's own verses, folded under the verse, never a wall.
11. Claude-written historical-critical summaries are generated through the portal's MCP and approved by the rabbi before a student sees them. No student-facing chatbot in 1.0.

### Translation tools

12. The word panel (STEP grammar, BDB, "this word elsewhere"), the translation picker across editions, and a guided "build your own translation": the student writes a translation verse by verse, saves drafts, and the tutor sees them. JPS 2023 is the reference translation.
13. Transliteration is offered as a toggle for students (the haftarah site ruled it out; students are a different audience).

### Trope and audio

14. Per-verse play, slow and loop, trope colours with family drills, the printable trope chart — as ruled in D1–D13 of the haftarah chant-integration plan (`docs/superpowers/plans/2026-10-15-web-2-0-chant-integration.md`), which carries over whole: label "Claude-generated chant" with a line to check with your tutor or cantor; 64 kbps mono MP3; Standard Reform (Binder/Avery) default nusach; speed 0.5–1.25 with loop; no downloads; plays counted in aggregate only; a new voice applies to new renders only.
15. Record-yourself, and the student *can* send a recording to their tutor. (Ruled out on the public haftarah site; here it is the point.)
16. Until the engine's listening gate G3 passes, the portal ships with the player built and the audio slot empty; a tutor or the rabbi can upload a recording per verse as the interim source.
17. G3 stays the gate before any student hears generated chant: Daniel passes at least 95% of the review verses on melody with zero "would teach wrong", after the automatic gates G1 (notes within ±50 cents) and G2 (technical checks).

### The engine move

18. `trope/` moves from the haftarah branch `trope-engine-research` into this repo **with git history** (subtree), plus a copy of the trope functions from `template/lib.js` (`tropePhrases`, `TETRA` and what they need) until the haftarah Wave 6 engine package exists; then the portal switches to the package.
19. Rendering stays an offline GPU job (Daniel's RTX 4070 laptop now; Modal or a rented GPU later, engine open item 2) that uploads MP3s and a manifest to a Blob store **the portal owns**. The `haftarah-audio` store is renamed or replaced.
20. The engine's tests must pass in the new repo before anything else is built on it. (Amended 2026-10-15 while planning: the interview said "314 tests"; 314 is the whole branch suite, of which 108 are the engine's and move; the other 206 test the haftarah sheet and stay. The gate is the 108 plus a parity golden against haftarah's `lib.js`.)

### Tenancy, hosting, repo

21. Multi-tenant from the schema up (same move ruled for centralreform.live on 2026-10-12). CRC is the only tenant at launch; Daniel is sole platform owner; one Vercel deployment; Postgres on Neon, pay-per-use. Not building a second tenant's onboarding yet, just not painting it in.
22. Hosting cap: under $25/month ideal, $50 acceptable (same as Overlays).
23. Public GitHub repo `RavBogard/bneimitzvah`, checked out at `C:\Users\dsbog\bneimitzvah`. Vercel project on the same team. Domain `bneimitzvah.centralreform.org` for CRC; later tenants get their own hostname on the one deployment.
24. Public repo means: code, melody tables and tests are public. **Never in the repo:** JPS text or any licensed text, student data, recordings, credentials. A test enforces this, like the haftarah publish-whitelist test.
25. Product name on the page: "CRC B'nei Mitzvah" for now.

### Claude's place in the product

26. An MCP server on the portal (the pattern of the haftarah Wave 6 plan) so Daniel and tutors can set up students, assign sources, and draft labelled summaries from Cowork. Sign-in through Google OAuth, restricted to the congregation's rabbi/admin and tutor accounts.

## Outcome: what "done" means

The 1.0 gate is a real CRC student and a real tutor using it for a real reading start to finish, with Daniel as rabbi, and nothing needed a workaround. Before that, each phase ends with the machine gates below green and a deploy that Daniel can click through.

## Boundaries

- The haftarah repo is not touched by this project except: (a) the subtree extraction of `trope/` reads its history; (b) the haftarah Wave 6 engine package, when it exists, becomes a dependency. The printed sheet's golden stays byte-identical; this project never needs it to change.
- Nothing licensed or personal in the public repo (ruling 24).
- Hosting cap (ruling 22). Money interrupts Daniel.
- The G3 gate (ruling 17) is not negotiable; no student hears generated chant before it.
- Dependency rule: the engine folder (`trope/`) stays dependency-free Node + its vendored, licensed copies with `PROVENANCE.md`, as on the branch. The Next.js app may take pinned dependencies; it never imports from the engine's Python side.

## Authority: who decides what

- **Claude decides and logs:** framework and library choices inside the stated stack, schema details, component structure, test design, copy on internal pages, the order of work inside a phase, which Opus/Sonnet agents do what.
- **Machine gates decide:** tests green (`npm test`, no network), the engine's 314 tests, the never-in-repo test, a rendering golden on the student text view, no credential in any log or tool result, a deploy that serves the live site.
- **Daniel is interrupted for:** money (any new paid service, any upgrade, the Blob store spend notice), anything student-visible before it ships (he wants to see it), the cantor licence and any other licence question, a second tenant, and any ruling above that turns out to be wrong in practice. Everything else: decide, log, move on.

## Proof: done means verified, not written

- Every phase ends with the tests above green on Daniel's machine (Windows) and in CI (Linux).
- Student-visible pages get a browser check (Playwright, as the haftarah `web-check` does): the page loads with a fixture student, the trope colours and word panel open, the player bar renders with the audio slot empty.
- Anything high-stakes (auth, tenancy isolation, the never-in-repo rule) gets an independent adversarial pass by a second agent before it is reported done.
- "Working on my laptop" is not done. A deploy Daniel can open is.

## Where it lands

- Repo: `RavBogard/bneimitzvah` (public), local checkout `C:\Users\dsbog\bneimitzvah`.
- This brief: `docs/planning/2026-10-15-kickoff/MISSION.md`. The plan for Code: `PLAN-CODE-2026-10-15.md` beside it. Phase status: `STATE.md` beside it (the haftarah house format: gates as "GATE: … — proceeded because …", blocks as "BLOCKED (Daniel): …", a tickable checklist, resume notes).
- Specs per phase go in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, plans in `docs/superpowers/plans/`, research in `docs/superpowers/research/`, as in the haftarah repo. Each spec opens with "Settled decisions (Daniel, binding)" and ends with "Open items that wait on Daniel".
- Deploy: Vercel, `bneimitzvah.centralreform.org`.

## Scale and surface

This is a campaign, not one session. Phases (shape, not schedule; the plan file has the detail):

0. Repo, brief, scaffolding, CI, the never-in-repo test.
1. Engine move: `trope/` subtree with history, lib.js trope functions, 314 tests green here.
2. Data model, tenancy, auth, the four roles; student/tutor/rabbi admin pages.
3. The student's study page: text, trope colours, word panel, translation picker, commentary (defaults + assigned), own-translation drafts, transliteration toggle.
4. Audio: player, record-yourself, send to tutor, tutor uploads per verse.
5. The MCP server.
6. Generated chant behind the G3 gate: render pipeline, portal-owned Blob store, chant manifest keyed by verse, nusach row.
7. Real-student pilot.

All build work is **Claude Code's lane**, on Opus by default, Fable for the hardest judgment (auth and tenancy design, the engine extraction, anything touching the G3 gate). Cowork sessions do review, research and planning only. Unattended-run rule: a seat that dies on Fable reruns on Opus, substitution noted in STATE.md.

## Open items that wait on Daniel

Carried from the engine spec and not ruled in this interview; none blocks phases 0–5:

- Engine open items 1–17 in `2026-10-15-trope-engine-design.md` on the `trope-engine-research` branch, above all: which voice prompt to publish (1); where to render (2); CRC's actual aliyah cut points (3); the Decalogue (4) and special melodies (5); checking the Binder/Avery tables against a printed source (11); the licence for publishing the melody tables (15); whether a cantor's recording replaces or sits beside generated audio (17).
- The cantor's licence (Cantor Josh Finkel): which grants, credit and honorarium, withdrawal terms — only if path 3 (recordings) is pursued. Blocks nothing until then.
- A second congregation, when there is one.
- `customs/crc.json` in the haftarah repo still lists `toConfirm: ["torah","entryCap","nusach"]`; the portal's CRC customs record inherits those as unconfirmed.

## Source record

- Haftarah 2.0 spec, sections 2, 3.1, 3.3, 5.11, 10, 11.1 (what the portal is and what the haftarah repo must never hold).
- Chant integration plan D1–D13 and the engine's questions O1–O13 (superseded for the haftarah site, "the record for the portal, which inherits the engine").
- Trope engine design spec and trope audio web-integration spec, branch `trope-engine-research` at `380b1b2`; handoff `docs/superpowers/plans/2026-10-15-trope-handoff.md` (the work queue, now on the RTX 4070 laptop); `chant-audio.md` research (the cantor licence, section 5).
- Kickoff interview, Cowork, 2026-10-15: three rounds, every proposal approved as written except ruling 8–10, which Daniel restated ("rabbi sets defaults that are shown; all sources should be theoretically available; a tutor or a rabbi can assign particular ones to the student so they show up when the student is studying").
