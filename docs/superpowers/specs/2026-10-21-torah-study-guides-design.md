# Torah study guides — design

Filed 2026-10-21 from Daniel's structured interview (24 answers) in Claude Code, grounded in `origin/main` at `16bfb4d`. This is the understanding layer of the portal: what a student, a parent and the rabbi do with the *meaning* of the assigned reading. Chant, pronunciation and reference audio keep their own tracks and are untouched here except where the two layers meet on screen.

Companion documents: the plan `docs/superpowers/plans/2026-10-21-torah-study-guides.md` and the handoff `docs/planning/2026-10-21-torah-study/HANDOFF.md`.

## Settled decisions (Daniel, binding, 2026-10-21)

Numbered so the plan and later specs can cite them as S1…S24.

**Scope and audience**

- S1. This work is the **understanding layer**: English, word meaning, commentary and sources, the rabbi's framing, "what is this portion about". Reading-prep tools (syllables, stress, grammar, tikkun) are not reworked.
- S2. Optimize for three moments, in this order: a student alone on a phone; a parent and child at home; the rabbi curating ahead of time. Tutor-on-Zoom is served by the wide-screen layout but is not the design target.
- S3. **D'var Torah stays in 2.0** ("when this becomes a full beit mitzvah portal for everything"). No reflection prompts, no drafting space, no free-text study writing for students in this work.
- S4. Output of this session: design, plan and handoff written for a **fresh Opus session** that implements after coordinating with Codex.

**What the student sees under a verse**

- S5. Before anyone assigns anything, a verse shows **a Claude-written summary first, then sources**.
- S6. The curation model: **the rabbi works with Claude in Cowork to choose themes to explore; Claude assembles a custom study experience of the parashah with the relevant commentaries attached.** There is no hand-written reusable rabbi note library; the guide *is* the library.
- S7. Claude-written summaries (MISSION ruling 11) are in this plan, behind rabbi review.
- S8. Granularity: notes are **verse-anchored**, plus one **parashah-level overview slot** at the top of the reading.
- S9. Unit: a **per-parashah base guide** (shared by every student on that parashah, reusable year to year) **plus per-student additions**.
- S10. Review happens **in Cowork via MCP**. **Amends PLAN-CODE note 7** ("summaries are approved only in the web UI, never through MCP"): approval is an MCP write by the rabbi; the web admin shows status and a preview.
- S11. Shape: **both** — an overview card and under-verse annotations inside the existing Read page, **and** an optional "Study" walk that strings the themes together. The continuous reader stays primary (reconciliation 2026-10-20: no mandatory modal, no new student home).
- S12. Student interaction: **read, plus an "I read this" tick per theme** that the tutor can see. No writing surface.
- S13. **The auto-generated default is student-visible, clearly labelled**, before the rabbi has customized or reviewed it. **Amends MISSION ruling 11** ("approved by the rabbi before a student sees them"): the label carries the review state; nothing is hidden waiting for review.
- S14. The generation voice comes from a **congregation study-voice document** written once by the rabbi with Claude (lens, tone for 12-year-olds and adults together, preferred voices and sources, things to avoid). Editable, versioned.
- S15. "Build your own translation" is **de-emphasized for 1.0**: kept, moved behind a secondary disclosure.
- S16. English placement: **side by side on wide screens, interleaved under each verse on phones.**

**Parents, adults, haftarah**

- S17. Parents see **the same study guide, read-along**, exactly as the child sees it.
- S18. Parents **write nothing** in the study space (ruling 1 stands).
- S19. Adults get the **same guide**; the voice document makes every guide adult-respectful and child-readable at once.
- S20. **Haftarah is equal**: it gets its own guide, and the student's haftarah card links the matching week's public "Torah from Scratch" study sheet when one exists.

**Authority, order, ownership**

- S21. **Rabbi only, everywhere.** Only the rabbi/admin role edits the base guide, the per-student additions and the study voice. Tutors read. (Per-student additions exist, S9, but only the rabbi makes them.)
- S22. First slice to ship: **the generation path end to end** — study voice → MCP drafts a parashah base → labelled student display — using the existing under-verse sources area for display.
- S23. Word tap: **meaning first, pronunciation one tap away.**
- S25 (added after the builder check). **An unattended routine never replaces the rabbi's reviewed work; a Cowork session in which the rabbi is working with Claude does.** Mechanism: a save made with `reviewed:true` (the rabbi is present and has read it) goes live at once; a save with `reviewed:false` goes live only if no reviewed version exists — otherwise it is held and staff see "newer draft waiting" until `publish_guide`. The scheduled routine's own MCP consent can never set `reviewed:true`.
- S24. **Opus-Claude owns the whole study slice end to end** (schema, MCP tools, HTTP, UI) on one branch; Codex is informed first, keeps everything else, does the adversarial review and the merge/deploy. *Superseded the same afternoon:* Codex ran out of usage and Daniel handed the whole product to the Opus session, which now also owns review dispatch, merge and deploy (HANDOFF §4–§5).

Standing rules that still bind: never-in-repo (no JPS or licensed text, no student data); the MISSION authority amendment of 2026-10-17 (deploy at will; required tests and adversarial review for auth/tenancy; new spend, licence, second tenant and G3 still interrupt Daniel); no visible transliteration (ruling 38); no student chatbot; practice-history retention rules.

## Intent and the why

Today a student's verse carries a raw list of Sefaria "related sources" and a per-student notes stream a tutor types by hand. Nobody has time to curate that for every student, so most students see nothing or everything. Daniel's picture is different: he sits with Claude, says "for Pekudei I want them to see the cloud filling the Mishkan, the idea of a finished work, and how a community builds something together", and Claude writes a short guide — an overview, three themes, a note on each verse that matters, one to three sources per note — in CRC's voice. That guide appears for every student on Pekudei, labelled as Claude-written and not yet reviewed, until Daniel edits it in the same conversation and marks it reviewed. A parent reading along at the kitchen table sees the same thing. Next year it is already there.

The point is leverage for one rabbi, honesty about what is machine-written, and a reading page that explains itself to a twelve-year-old alone on a phone.

## Goals, non-goals, anti-goals

**Goals**
- A student on their reading sees, without any staff action, a labelled overview and verse notes with attached sources.
- The rabbi can draft, revise, review and extend a guide entirely from Cowork.
- Parents read the identical guide; tutors see which themes a student has read.
- Haftarah and Torah are equal.

**Non-goals (this work)**
- D'var Torah drafting, reflection boxes, parent messages to tutors (2.0).
- Tutor editing of guides; a web editor for guides (web shows status/preview only).
- Server-side LLM calls, an Anthropic API key, any new spend (see open items).
- Changing the practice loop, reference audio, trope tools, recordings.
- A generic congregation-resources table (yesterday's G19) — only the one haftarah-sheet link is in scope here.

**Anti-goals (would make it a failure even if it works)**
- A student cannot tell what is Claude's, what is the rabbi's, what is Rashi's.
- Guide bodies contain JPS verse text or any licensed body in the repo or in a public URL.
- A tutor or parent can change what a student sees.
- The reading page becomes a wall; Hebrew is no longer first.
- Transliteration, mascots, pep-talk copy, "streaks".

## Constraints

- **Stack**: Next.js App Router, Drizzle on Neon, Better Auth 1.7.10 with the MCP plugin composition selected in `docs/superpowers/specs/2026-10-18-portal-mcp-read-foundation-design.md`; Vitest on PGlite; Playwright. No new dependencies beyond what that MCP design already selected.
- **MCP foundation is designed but held**: tools `list_students`/`get_student`, scope `portal:read`, activation gated on the auth contracts in that design (Google-session provenance, delegation binding, refresh bounds, public-client metadata, JSON-only delivery). This work adds a write scope and depends on those gates being met. See "Dependencies".
- **No parashah key exists** in the schema. The only parashah facts are Hebcal's English name in `proposalSnapshot.reading.parashah` and `parshaNum` in the cached payload. A key must be introduced.
- **Sources are snapshots** of Sefaria `RelatedSourceMetadata` `{id, ref, indexTitle, category, labels}`; "readable in app" is decided by `sources/content-extents.ts` (narrow numeric extents, PD/CC0 editions). Anything else is link-only.
- **Writes follow the house pattern**: `mutationId` + `expectedVersion` + receipt + `auditEvent` in one transaction; `audit_action_known` is a closed CHECK list and needs a migration per new action.
- **Access**: "rabbi" is the `admin` role. There is no per-student admin-only capability today; one must be added. Parent mode is `read` only.
- **Sizes**: note bodies ≤ 4096 bytes like `tutorNote`; a guide ≤ 128 KiB like a source set.
- **Licensing**: Hebrew (MAM, CC BY-SA) and source refs are fine to quote by ref; JPS 2023 (CC BY-NC) is rendered by the app at runtime and must not be copied into guide bodies. Claude-written text is labelled.

## The design

### 1. Data

New tables, tenant-scoped, RLS like their neighbours.

**`study_voice`** — append-only versions. `(tenantId, version, body text ≤ 32 KiB markdown, authorUserId, createdAt, previousVersion)`. Head = max version. Seeded empty; the MCP `get_study_voice` returns a starter template when none exists (text lives in code, not in the DB).

**`study_guide`** — the per-parashah base, append-only versions.
- Key: `(tenantId, kind ∈ {torah, haftarah}, readingKey, version)`.
- `readingKey`: a slug derived server-side from the Hebcal proposal snapshot. **Torah:** the parashah slug (`pekudei`, `vayakhel-pekudei` for a doubled week, the holiday slug for a special reading). **Haftarah: the passage itself, not the parashah** — a normalized slug of the proposed haftarah ref range (`i-kings-8-1-8-21`), because on Shekalim, Zachor, Parah, HaChodesh, Rosh Chodesh, Machar Chodesh, Shuvah, Chanukah and HaGadol Hebcal returns a different haftarah than the parashah's, and the snapshot keeps only the bare ref. The passage recurs year to year, so the base guide is still reusable; the rite is implied by the passage, so no rite suffix. Derivation is a pure function in `src/lib/readings/` with a golden over the 54 parashot, doubles, holidays and every haftarah ref Hebcal emits for the tenant's rite; it is the only place the slug is made.
- **When a reading gets a key** (builder check, settled here): whenever the confirmed assignment's snapshot has a calendar reading *and every assigned verse falls inside that reading's full kriyah / haftarah range* — which is CRC's normal case, a hand-picked range (`basis: custom`) on an ordinary Shabbat. A reading with no snapshot, or whose verses fall outside the week's passage (a student reading a different portion), gets `null`: no base guide, no card, nothing said.
- `origin ∈ {claude, rabbi}` for the version's author; `reviewed boolean`; `hold boolean` (a held version is staff-visible only; the latest non-held version is what students see); `authorUserId`, `createdAt`, `previousVersion`, `mutationId` receipt.
- `body jsonb`, validated by a SQL function like `portal_source_citations_valid`:
  ```
  { overview: markdown ≤ 8 KiB,
    themes: [ { id: slug, title ≤ 120, intro: markdown ≤ 4 KiB,
                notes: [ { verseRef: "Book C:V", body: markdown ≤ 4096 B,
                           sources: [RelatedSourceMetadata + {readable: bool}] ≤ 3 } ] ≤ 12 } ] ≤ 8 }
  ```
  Markdown subset: paragraphs, emphasis, lists, Hebrew text. No raw HTML, no links except Sefaria refs rendered by the app. Whole body ≤ 128 KiB.

**`study_guide_student`** — per-student additions, same body shape (themes/notes only, no overview), keyed `(tenantId, studentId, assignmentId, assignmentRevision, kind, version)`. Rabbi-only. Inert when the assignment revision bumps, exactly like `verse_source_assignment`.

**`study_theme_read`** — the tick. Mutable head like `verse_self_check`: `(tenantId, studentId, kind, readingKey, themeId, readAt, version)`. Student or child-practice writes it; tutor, parent and admin read it.

New audit actions: `study-voice.set`, `study-guide.set`, `study-guide.publish`, `study-guide-student.set`, `study-theme.read`.

### 2. Reading key on the assignment

`assignment` gains a nullable `readingKey` column, filled by the same pure function when a reading is confirmed from a Hebcal proposal, and backfilled once by a reviewed migration script for existing rows that have a snapshot. A custom reading with no proposal keeps `readingKey` null and gets no base guide (only per-student additions); the UI says nothing in that case. The student's guide view is: base guide for `(kind, readingKey)` filtered to the student's assigned `verseRef`s, plus the student's additions, plus the overview.

### 3. MCP: scope and tools

Extends the read foundation with scope **`portal:study`**, grantable only to `admin` grants (tutor consent cannot obtain it). Tools, all JSON-only, each under the foundation's size and deadline rules, no token or e-mail in any result:

| Tool | Scope | Does |
| --- | --- | --- |
| `get_study_voice` | read | Head version + body (or the starter template, flagged `template:true`). |
| `save_study_voice` | study | `{expectedVersion, body, mutationId}` → new version. |
| `list_guide_work` | read | For every current student with a confirmed reading: `kind`, `readingKey`, student count, whether a base exists, its `reviewed` state, which students have additions. The "what needs a guide" list. |
| `get_reading_for_guide` | read | `{kind, readingKey}` or `{studentId, kind}` → the verses (Hebrew MAM + JPS English for drafting, exactly as the study page fetches them), the Hebcal aliyah boundaries, and per verse the related-citation candidates with `readable`. Same bounds as the study reader (100 verses, 8 chapters). |
| `get_guide` | read | `{kind, readingKey}` → head (and held) versions. |
| `save_guide` | study | `{kind, readingKey, expectedVersion, body, origin, reviewed, hold, mutationId}` → new version. `origin ∈ {claude, rabbi}` is declared by the caller because both arrive through the rabbi's delegation; the instructions require `claude` for any text Claude wrote, and the student label keys off `reviewed`, not `origin`. Refuses: a `sources[].id` that is not a Sefaria link id the server can resolve for that `verseRef` (never invent a citation); a `verseRef` outside the reading; any body over limits; raw HTML; a Latin-letter transliteration of a Hebrew word (heuristic: the voice says no transliteration; the server rejects obvious `[a-z]+'[a-z]` Hebrew-shaped tokens only in Hebrew-quoting contexts — builder's call how strict). |
| `publish_guide` | study | Clears `hold` on a version. |
| `get_student_guide` | read | Base-filtered-to-student + additions + ticks, as the student sees it. |
| `save_student_guide` | study | Per-student additions with the same validation, bound to `assignmentId`+`assignmentRevision`. |

Instructions string (the server's standing rules, in the haftarah server's style): never invent a citation — every source is a Sefaria link the server returned for that verse; label nothing as the rabbi's that Claude wrote; write for a twelve-year-old and an adult in the same sentence; quote Hebrew freely, never paste English verse text; no transliteration; historical-critical lens as the voice document says; every write takes `expectedVersion` from the last read.

### 3a. Bridge write path before the MCP is live (my call; Daniel may veto)

The MCP foundation does not exist yet on `origin/main` and its five activation gates are the hardest part of this work. So that a real guide can be verified in production before Cowork is connected, one operator script — `scripts/apply-study-guide.mjs`, run the way migrations are run by the integration owner, never from the browser — may insert a base-guide version from a JSON file produced by a Claude session. It uses the same validation and citation resolution as `save_guide`, writes `origin: claude, reviewed: false`, attributes the audit row to the designated admin membership named on its command line, and prints counts only. It is removed once the MCP is accepted. There is no web editor and no student-facing effect beyond the guide itself. The `study_guide` receipt column therefore stores `actorUserId` from the membership, not from a session.

### 4. Generation (no server LLM)

The server never calls a model. Drafting happens in a Claude session connected to the MCP: Daniel in Cowork ("draft Pekudei around these three themes"), or a scheduled Claude Code routine that runs `list_guide_work` and drafts any missing base with the study voice, saving with `reviewed:false`. The routine is an operator recipe documented in the handoff, not application code. If Daniel later wants drafts without a Claude session, a server-side Anthropic call is new spend and a new decision (open item).

### 5. Student surface

Inside the existing reading page; nothing new above the hero.

- **Overview card** under the hero, per reading (Torah and haftarah each): title "About this portion", the overview, then the theme list; each theme row has its intro's first line and an "I read this" tick (student/child-practice only; parents see it read-only). Label line at the bottom: *Written by Claude for CRC · not yet reviewed by Rabbi Daniel* or *Reviewed by Rabbi Daniel*. The rabbi's display name comes from a tenant setting; fallback "the rabbi".
- **Under each verse that has a note**: the note body, then its sources as rows (readable → "Read" opens the existing content reader; not readable → "On Sefaria ↗"). Then the existing Sources disclosure (assigned, related) below it, unchanged. Verses without a note show only the existing disclosure.
- **"Study" walk** (optional, from the overview card: "Study the themes"): a full-screen sequence theme → its verses in order (Hebrew, English, note, sources) → next theme; Back/Next; closing returns to the verse last shown. It is the lifted-line modal's sibling, not a replacement for Read.
- **English** (S16): at `min-width: 1001px` the reading becomes two columns — Hebrew left, the matching English right, aligned per verse; under that width English interleaves under each verse. Default: *my call* — off on phones (Hebrew-first, as the reconciled "continuous Hebrew default"), on in the wide layout; remembered in the existing prefs store.
- **Word tap** (S23): the word sheet's first row is "Meaning in this verse", then "Syllables and stress", then grammar/dictionary. Same sheet in the practice lift — one order everywhere.
- **Translation drafts** (S15): "Your translation & notes" moves under a "More" disclosure at the bottom of the verse card.

### 6. Parent, tutor, admin surfaces

- **Parent** (`mode=parent` and child-practice): identical guide; ticks read-only in parent mode, writable in child-practice.
- **Tutor**: identical guide; on the student page's progress marks, each theme shows read/unread beside the verse marks. No editing.
- **Admin web**: on the student's Reading tab, a small status line — "Study guide: Claude draft, not reviewed · 3 themes · updated Oct 21" with "Preview as student" (the same view) and a note that editing happens in Cowork. No web editor.

### 7. Haftarah sheet link (S20)

On the haftarah card: "This week's haftarah study sheet ↗" when the public haftarah library has a sheet for the student's ceremony Shabbat, matched by civil date in the site's published index (its pages are `https://haftarah.centralreform.org/{hebrewYear}/{slug}`). Existence comes from the haftarah site's published index, fetched server-side at most daily and cached; never fetched at render; on fetch failure the link is simply absent. No arbitrary URLs.

### 8. What a verse shows, in order (final)

1. Hebrew (phrase colours, aliyah markers, apparatus) — unchanged.
2. English (interleaved or side column).
3. Verse mark · "View up close" — unchanged.
4. Guide note(s) for this verse with their sources, labelled by origin.
5. Sources disclosure (assigned, related) — unchanged.
6. More: Your translation & notes.

## Dependencies and sequencing

1. **MCP activation gates** in the read-foundation design were owned by the integration stream. Under S24 the Opus session takes them on for this slice, with a second agent's adversarial review before any endpoint is enabled (amended 2026-10-21 afternoon: Codex is out of usage; the Opus session owns the whole product and dispatches its own reviewer, see HANDOFF §5). If a gate cannot be met with the installed libraries, the slice stops at "schema + HTTP + display with fixture guides" and reports the gap; it does not weaken auth.
2. Schema and audit migrations are applied migration-before-app by the Opus session, as every migration has been.
3. The haftarah public index format must be read from the haftarah repo (read-only).

## What's left to the builder

- Exact slug function and the doubled-parashah/holiday table; the backfill script.
- Markdown subset renderer (reuse whatever renders notes today if any; else a small allowlist renderer).
- The transliteration heuristic's strictness.
- Two-column CSS at 1001px, reusing the existing `.reading-passage-layout` breakpoint; the Study walk's component (sibling of `study/lift.tsx`).
- Whether `study_theme_read` keys on `readingKey` or `guideId` (readingKey is suggested so ticks survive guide versions).
- Starter study-voice template text (adult-respectful, Reform, historical-critical; Daniel edits it in Cowork).
- Test matrix per layer, mirroring `tests/app/source-assignments*.test.ts`, `tests/postgres/source-assignments.integration.ts`, `tests/http-browser/source-assignments-ui.test.ts`.

## Open items that wait on Daniel

- **Server-side generation** would need an Anthropic API key (new spend). Not in this plan; say the word and it becomes a milestone.
- **Rabbi display name** for the label: confirm "Rabbi Daniel" (or "Rabbi Bogard") — a tenant setting, set once.
- **Cowork connection**: the MCP's first real connection and consent is Daniel's action when the reviewed endpoint and instructions are ready (as the read-foundation design says).
- **Study-voice document**: Daniel writes it with Claude in the first Cowork session; the starter template is a placeholder, not his voice.
