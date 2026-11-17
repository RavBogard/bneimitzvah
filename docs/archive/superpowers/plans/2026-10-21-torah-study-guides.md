# Torah Study Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every student's Torah and haftarah reading carries a labelled, Claude-drafted, rabbi-reviewable study guide (overview, themes, verse notes with Sefaria sources) that the rabbi writes and reviews from Cowork through the portal MCP, that parents read along with, and that students tick off theme by theme.

**Architecture:** Three new append-only tables plus one tick table follow the `verse_source_assignment` versioned-set/receipt pattern; a pure `readingKey` slug ties a base guide to a parashah. The portal MCP (designed, held) gains a `portal:study` scope and eight tools; the server never calls a model. The reading page gains an overview card, under-verse notes, a Study walk, side-by-side English on wide screens and a meaning-first word sheet.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle on Neon/PGlite, Better Auth 1.7.10 + MCP plugin composition (per the read-foundation design), Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-torah-study-guides-design.md` (S1–S24 are its settled decisions). Handoff and coordination: `docs/planning/2026-10-21-torah-study/HANDOFF.md`.

## Global Constraints

- Baseline is `origin/main` (`16bfb4d` or later), not the stale local checkout; work on branch `claude/study-guides` in a fresh worktree (HANDOFF §2).
- Never in the repo: JPS or licensed text, student data, credentials. `npm run check:repo` stays green. Fixture guides use invented Hebrew-free prose and real Sefaria refs only.
- Guide bodies never contain English verse text; the app renders JPS at runtime. Hebrew quotations are fine.
- No visible transliteration anywhere (ruling 38). No student writing surface (S3, S12). Parents write nothing (S18). Only `admin` writes guides or the voice (S21).
- The continuous reader stays primary; the Study walk is optional (S11; reconciliation 2026-10-20).
- Labels, exact copy: `Written by Claude for CRC · not yet reviewed by {rabbi}` / `Reviewed by {rabbi}` where `{rabbi}` is the tenant's rabbi display name, fallback `the rabbi`.
- Limits: voice ≤ 32 KiB; overview ≤ 8 KiB; theme intro ≤ 4 KiB; note body ≤ 4096 B; ≤ 3 sources per note; ≤ 12 notes per theme; ≤ 8 themes; whole guide body ≤ 131072 B.
- Every staff write: `mutationId` uuid + `expectedVersion` + receipt + `auditEvent` in one transaction; new audit actions need the `audit_action_known` migration.
- MCP results: JSON only, ≤ the foundation's size cap, no token/e-mail/credential; `assertNoSecrets`-style guard on every result. No MCP endpoint is enabled until the read-foundation gates pass adversarial review (Task 9).
- Commit identity `RavBogard <RavBogard@users.noreply.github.com>`; long descriptive single-sentence subjects; never force-push.

## Review Focus

1. A student whose reading revision was bumped (date change → `needsReview`) must still see the base guide (keyed by `readingKey`, not revision) but **not** stale per-student additions — Task 4 test `student guide drops additions after revision bump`.
2. A custom reading with no Hebcal proposal (`readingKey` null) must render the page exactly as today — no card, no empty label — Task 10 test `no guide chrome when readingKey is null`.
3. A base guide note whose `verseRef` is outside this student's assigned verses must be hidden, and the theme must still appear in the overview if it has any visible note — Task 4 test `filters notes to assigned verses, keeps themes with remaining notes`.
4. A parent in `mode=parent` posting a theme tick must get 403 and the UI must never show the tick as a button — Task 6 and Task 10 tests.
5. A `save_guide` carrying a Sefaria `sources[].id` the server did not return for that verse must be refused as a whole (no partial save) — Task 8 test `refuses an invented citation`.
6. A ceremony on a special Shabbat (e.g. Shekalim with Pekudei) must get the guide for the haftarah actually read, never the parashah's regular haftarah — Task 2 test `haftarah on a special Shabbat keys by its passage`.
7. A reviewed guide must never be replaced by an unattended routine's draft, but a Cowork save with the rabbi present replaces it at once (S25) — Task 4 tests `draft after a reviewed version is held until published` and `reviewed save replaces a reviewed head immediately`; Task 8 test `routine consent cannot set reviewed:true`.

---

## Milestone A — data and reading key (Tasks 1–4)

### Task 1: Reading key slug

**Files:**
- Create: `src/lib/readings/reading-key.ts`
- Create: `src/lib/readings/reading-key.golden.json` (54 parashot + doubles + Hebcal holiday names → slug)
- Test: `tests/app/reading-key.test.ts`

**Interfaces:**
- Produces: `readingKeyFor(input: { kind: "torah"; parashah: string } | { kind: "haftarah"; haftarahRef: string }): string | null`. Torah: `parashah` is Hebcal's English name from `proposalSnapshot.reading.parashah` (`"Vayakhel-Pekudei"`, `"Shabbat Shuva"`) → lowercase ASCII slug, apostrophes dropped, spaces/hyphens → `-`. Haftarah: `haftarahRef` is the snapshot's bare haftarah ref (`"I Kings 8:1-21"`, `"Ezekiel 45:16-46:18"`) → `i-kings-8-1-8-21` (book slug, then start chapter-verse, end chapter-verse; a single-chapter range still spells both ends). Returns `null` for empty/unparseable input.
- Produces: `versesInside(assigned: string[], passage: { ranges: string[] }, kind): boolean` using `expandReadingRanges` (`src/lib/readings/ranges.ts:18`) — true when every assigned verseRef lies in the snapshot passage (full kriyah for Torah, the haftarah range for haftarah).

- [ ] Write `tests/app/reading-key.test.ts`: `maps every golden name to its slug` (iterate the golden), `haftarah keys by passage` (`{kind:"haftarah", haftarahRef:"Ezekiel 45:16-46:18"}` → `"ezekiel-45-16-46-18"`), `two parashot sharing a special haftarah share the key` (Shekalim on Pekudei and on Vayakhel-Pekudei → same slug), `returns null for empty name`, `versesInside is false when one verse is outside`.
- [ ] Run `npx vitest run tests/app/reading-key.test.ts` — FAIL (module missing).
- [ ] Implement `readingKeyFor`; build the golden from `src/lib/readings/leyning.mjs`'s parashah table (read it; do not hand-type 54 names).
- [ ] Run the test — PASS. Run `npm run check:repo` — PASS.
- [ ] Commit: `Add a pure reading-key slug so a study guide can be keyed to a parashah and rite without a new identity source`.

### Task 2: `assignment.readingKey` column, fill and backfill

**Files:**
- Modify: `src/server/db/tenant-schema.ts` (assignment table, ~183-199) — add `readingKey: text("reading_key")` nullable.
- Create: `src/server/db/migrations/0027_assignment_reading_key.sql` (column + index on `(tenant_id, kind, reading_key)` + backfill `UPDATE` from `proposal_snapshot->'reading'->>'parashah'` through a SQL copy of the slug rule *or* leave backfill to the script below — builder's call; the test pins the result, not the method).
- Modify: the confirm path that writes `assignment` from a proposal (find via `markReadingsForReview` in `src/server/data/roster.ts` and the confirm service in `src/server/students/`), to set `readingKey = readingKeyFor(...)`.
- Create: `scripts/backfill-reading-keys.mjs` (dry-run by default; prints counts, never rows).
- Test: `tests/app/assignment-reading-key.test.ts`; migration test mirroring `tests/app/source-assignments-migration.test.ts`.

**Interfaces:**
- Consumes: `readingKeyFor` (Task 1).
- Produces: `Reading` DTO (`src/components/portal/workspace/api.ts`) gains `readingKey: string | null`; the server reading projection includes it.

- [ ] Write tests: `confirming a Hebcal proposal stores readingKey` (confirm fixture reading for "Pekudei" → `reading_key = "pekudei"`), `custom range inside the week's kriyah stores the key` (basis custom, verses inside → key set), `custom range outside the week's kriyah stores null`, `reading without a snapshot stores null`, `haftarah on a special Shabbat keys by its passage`, `migration 0027 applies on PGlite and backfills a seeded snapshot row`.
- [ ] Run — FAIL.
- [ ] Implement column, migration, confirm-path fill, DTO field.
- [ ] Run tests + `npm run typecheck` — PASS.
- [ ] Commit: `Store a reading key on confirmed assignments and backfill existing proposals so guides can attach to a parashah`.

### Task 3: Guide, voice and tick schema + validation

**Files:**
- Create: `src/server/db/study-guides-schema.ts` — tables `studyVoice`, `studyGuide`, `studyGuideStudent`, `studyThemeRead` exactly as spec §1 (column names in snake_case; `previousVersion` self-FK; `mutationId` receipt unique `(tenantId, actorUserId, mutationId)` on the three append-only tables).
- Create: `src/server/db/migrations/0028_study_guides.sql` — tables, RLS policies and grants copied from `0021_verse_source_assignments.sql`, SQL function `portal_study_guide_body_valid(jsonb, boolean allow_overview)` enforcing the limits, CHECKs, and `ALTER` of `audit_action_known` adding `study-voice.set`, `study-guide.set`, `study-guide.publish`, `study-guide-student.set`, `study-theme.read`.
- Create: `src/server/study-guides/validation.ts` — the same limits in TypeScript.
- Modify: `src/server/db/tenant-schema.ts:225` audit CHECK list.
- Test: `tests/app/study-guides-validation.test.ts`, `tests/app/study-guides-migration.test.ts`.

**Interfaces:**
- Produces: types `GuideBody`, `GuideTheme`, `GuideNote`, `GuideSource` (= `RelatedSourceMetadata & { readable: boolean }`); `validateGuideBody(body: unknown, opts: { allowOverview: boolean }): { ok: true; value: GuideBody } | { ok: false; problems: string[] }`; `validateVoice(body: unknown): same shape with string value`.

- [ ] Write validation tests with the spec's exact limits: `accepts a body at every limit`, `rejects 9 themes`, `rejects a 4097-byte note`, `rejects 4 sources on a note`, `rejects raw HTML in a note` (`<b>`), `rejects a verseRef not matching /^[A-Za-z ]+ \d+:\d+$/`, `student body rejects an overview`.
- [ ] Write migration test: applies on PGlite; SQL function rejects the same 9-theme body; audit CHECK accepts `study-guide.set`.
- [ ] Run — FAIL.
- [ ] Implement schema, migration, validation.
- [ ] Run tests, `npm run typecheck`, `npm run test:postgres:sql` if a local cluster is available (document if not) — PASS.
- [ ] Commit: `Add study voice, parashah guide, per-student addition and theme-read tables with shared body limits and audit actions`.

### Task 4: Guide data + service (read model, writes, receipts)

**Files:**
- Create: `src/server/data/study-guides.ts` — `head`, `append`, `receipt`, `latest` for each table, modelled on `src/server/data/source-assignments.ts`.
- Create: `src/server/study-guides/service.ts`.
- Modify: `src/server/access/service.ts:13-22` — add `StudentCapability` `"guide-write"` (admin only, cookie or MCP evidence, intent `authority-write`) and `AdminCapability` `"manage-guides"`; a read of guides uses the existing `read` capability.
- Modify: `src/server/runtime/composition.ts` to wire the service.
- Test: `tests/app/study-guides-service.test.ts` (PGlite via `portalRoutesFixture`).

**Interfaces:**
- Produces:
  - `getVoice(tx, tenant): { version: number; body: string; template: boolean }`
  - `setVoice(request, { mode, expectedVersion, body, mutationId }): { outcome: "committed" | "conflict" | "no-change"; version }`
  - `getBaseGuide(tx, tenant, kind, readingKey, { includeHeld: boolean }): { visible: GuideVersion | null; held: GuideVersion | null }`
  - `setBaseGuide(request, { mode, kind, readingKey, expectedVersion, body, origin, reviewed, hold, mutationId })`
  - `publishBaseGuide(request, { mode, kind, readingKey, version, mutationId })`
  - `setStudentGuide(request, { mode, studentId, kind, assignmentId, assignmentRevision, expectedVersion, body, mutationId })`
  - `studentGuide(request, { mode, studentId, kind }): StudentGuideView` = `{ readingKey, label: { origin: "claude" | "rabbi"; reviewed: boolean; rabbiName: string }, overview, themes: [{ id, title, intro, notes: GuideNote[] (filtered to assigned verses), read: boolean }], additions: same shape, visibleVersion, additionsVersion } | null`
  - `setThemeRead(request, { mode, studentId, kind, readingKey, themeId, read: boolean, expectedVersion })`
  - `GuideVersion = { version, origin, reviewed, hold, body: GuideBody, createdAt }`

- [ ] Write service tests: `admin saves base guide, head advances, audit row written`, `tutor cannot save base guide (403)`, `conflict on stale expectedVersion`, `replay of same mutationId returns committed without a second row`, `held version invisible to student view, visible with includeHeld`, `draft after a reviewed version is held until published` (save with `reviewed:false` when head is reviewed → stored `hold:true` regardless of the argument; student view keeps the reviewed version; `publishBaseGuide` releases it), `reviewed save replaces a reviewed head immediately` (S25), `filters notes to assigned verses, keeps themes with remaining notes`, `student guide drops additions after revision bump`, `student guide is null when readingKey is null and no additions`, `theme tick: student writes, parent 403, tutor reads`.
- [ ] Run — FAIL.
- [ ] Implement data + service following the three-phase authorize/compare pattern of `source-assignments-service.ts:55-90`; rabbi name from `tenant.customs.credits.rabbiDisplayName` with fallback `"the rabbi"` (document the key in the migration comment).
- [ ] Run tests + typecheck — PASS.
- [ ] Commit: `Add the study-guide service with rabbi-only versioned writes, receipts, held versions and the student projection filtered to assigned verses`.

## Milestone B — HTTP and MCP (Tasks 5–9)

### Task 5: HTTP routes for the web

**Files:**
- Create: `src/server/http/study-guides.ts` — under `/api/students/{id}/study-guide` (GET, `?kind=`), `/study-guide/theme-read` (POST), `/api/admin/study-voice` (GET), `/api/admin/study-guides/{kind}/{readingKey}` (GET, includes held). No web POST for guide or voice bodies (S10: writes are MCP; web is status/preview).
- Modify: `src/server/http/portal.ts` dispatcher to mount them.
- Test: `tests/app/study-guides-http.test.ts`.

**Interfaces:**
- Consumes: service (Task 4).
- Produces: client DTOs `StudentGuideView`, `ThemeReadResult` exported from `src/components/portal/workspace/study/guide-api.ts`.

- [ ] Write HTTP tests: student GET 200 with the view; parent GET 200 identical; parent POST theme-read 403; tutor POST 403; student POST 200 then GET shows `read:true`; unknown student 404 generic; admin guide GET returns held.
- [ ] Run — FAIL. Implement. Run + typecheck — PASS.
- [ ] Commit: `Expose the student study guide and theme ticks over the portal HTTP dispatcher with parent read-only and staff status reads`.

### Task 6: Student web client store

**Files:**
- Create: `src/components/portal/workspace/study/guide-api.ts`, `guide-store.ts` (fetch, tick with optimistic version, conflict → refetch), mirroring `progress/store.ts`.
- Test: `tests/app/guide-store.test.ts` (unit, invented fetch).

- [ ] Tests: `loads view for kind`, `tick sends expectedVersion and applies result`, `conflict refetches`.
- [ ] Run — FAIL. Implement. PASS. Commit: `Add the study-guide client store with optimistic theme ticks and conflict refetch`.

### Task 7: MCP foundation activation (read scope)

This is the held slice of `docs/superpowers/specs/2026-10-18-portal-mcp-read-foundation-design.md`. Follow that design's five activation gates literally; this task only lists them as checkable steps and adds nothing new.

**Files:** per that design — provider composition, `/api/mcp` handler, delegation evidence table(s), consent page, `list_students`, `get_student`.
**Test:** actual-library synthetic OAuth/PKCE/consent/refresh/revocation tests; `tests/app/access-cookie-boundary.test.ts` stays green.

- [ ] Capture the exact installed plugin schema/APIs into a note under `docs/planning/2026-10-21-torah-study/MCP-CAPTURE.md` (no secrets).
- [ ] Implement Google-session provenance at session creation (fail closed for unmarked sessions).
- [ ] Implement server-owned delegation binding (client/resource/session/tenant/staff-grant) with the design's lock order; missing mapping denies.
- [ ] Prove refresh is bounded by the originating session or disable refresh for this proof.
- [ ] Resolve preregistered public-client discovery (`none` method) with a closed metadata projection; no dynamic registration.
- [ ] JSON-only responses; final authorization fence after awaited work; no SSE/batch leak.
- [ ] `list_students`, `get_student` exactly as the design's projections.
- [ ] Run the full matrix (admin/tutor/parent/student, foreign IDs, stale grants, revoked delegation, after-await expiry) — PASS; endpoint still **disabled by configuration**.
- [ ] Commit: `Implement the held portal MCP read foundation with Google-session provenance, bound delegation and JSON-only delivery, still disabled pending review`.

### Task 8: MCP study tools

**Files:**
- Create: `src/server/mcp/study-tools.ts` (the eight tools of spec §3), `src/server/mcp/instructions.ts` (the standing rules, spec §3 last paragraph).
- Modify: the MCP tool registry and scope table — add `portal:study`, grantable only when the consenting grant is `admin`.
- Create: `src/server/study-guides/citations.ts` — `resolveCitations(tx, reading, verseRef, ids[]): { ok: true; sources: GuideSource[] } | { ok: false; unknown: string[] }` using `createSefariaMetadataReader().related(verse)` and `content-extents` for `readable`.
- Test: `tests/app/mcp-study-tools.test.ts` (invented Sefaria fetch; real service on PGlite).

**Interfaces:**
- Consumes: service (Task 4), reading text reader `createSefariaStudyReader` (`src/server/study/sefaria.ts`), metadata reader.
- Produces: tool names and arguments exactly as spec §3.

- [ ] Tests: `get_study_voice returns template:true when empty`, `save_study_voice conflict on stale version`, `list_guide_work lists each (kind, readingKey) with student count and reviewed state`, `get_reading_for_guide returns Hebrew+English verses and readable flags`, `save_guide stores the declared origin and reviewed:false; omitted origin is refused`, `refuses an invented citation` (id not in related → whole save refused, no row), `refuses verseRef outside reading`, `publish_guide clears hold`, `save_student_guide binds assignment revision`, `tutor consent cannot obtain portal:study`, `routine consent cannot set reviewed:true` (a consent flagged `unattended` — the scheduled routine's client — is refused on `reviewed:true`), `no result contains an e-mail or token`.
- [ ] Run — FAIL. Implement. PASS. Typecheck PASS.
- [ ] Commit: `Add the portal MCP study scope and tools so the rabbi can draft, review, hold and publish parashah guides from Cowork without inventing citations`.

### Task 8b: Bridge operator script (spec §3a; before Task 7 if the MCP gates are slow)

**Files:**
- Create: `scripts/apply-study-guide.mjs` — `node scripts/apply-study-guide.mjs --kind torah --reading-key pekudei --file guide.json --admin-membership <id> [--apply]`; dry-run by default; uses `validateGuideBody`, `resolveCitations` (Task 8) and `setBaseGuide`'s data path with `origin:"claude", reviewed:false`; prints counts only. Spawned tests use `tests/helpers/isolatedEnv.mjs`.
- Test: `tests/apply-study-guide.test.mjs` (node, spawns with isolatedEnv against PGlite fixture): `dry run writes nothing`, `apply writes one version and one audit row`, `refuses invented citation`, `refuses when membership is not admin`.

- [ ] Implement with tests. Commit: `Add a dry-run-first operator script that applies a Claude-drafted guide file so a real guide can be verified before the MCP is live`.
- [ ] Add a removal note to HANDOFF §5: delete the script in the commit that enables the MCP endpoint.

### Task 9: Adversarial review and enablement gate (second agent)

- [ ] Dispatch a second agent (`dan-auditor`, or a fresh general subagent given the diff and not your conclusions) to review Tasks 7–8 adversarially (HANDOFF §5): auth, tenancy, delegation races, RLS, result projection. Codex no longer exists; this is the required second-agent pass from `CLAUDE.md`.
- [ ] Fix findings; rerun the matrix.
- [ ] Only after acceptance: enable the endpoint by configuration in a separate commit; Daniel connects Cowork (open item).

## Milestone C — the reading page (Tasks 10–13)

### Task 10: Overview card and under-verse notes

**Files:**
- Create: `src/components/portal/workspace/study/guide-card.tsx` (+ `guide.module.css`), `guide-verse-notes.tsx`, `guide-label.tsx`, `markdown-lite.tsx` (allowlist renderer: p, em, strong, ul/ol/li, Hebrew spans; refs like `Genesis 1:1` become in-app links when readable else `sefaria.org/{ref}` external).
- Modify: `src/components/portal/workspace/reading.tsx` (after hero, ~:280) — render `GuideCard` per reading when `view` is non-null; `study/view.tsx:214-221` — insert `GuideVerseNotes` between the apparatus and `renderWork`; move `VerseTools` under a `<details>` "More" (S15).
- Test: `tests/http-browser/study-guide-ui.test.ts` (mirror `source-assignments-ui.test.ts`), fixture guide in `tests/helpers/study-guide-fixture.ts`.

- [ ] Browser tests: `student sees overview card with label "Written by Claude for CRC · not yet reviewed by the rabbi"`, `reviewed guide shows "Reviewed by Rabbi Daniel" when customs name is set`, `note and its sources appear under the matching verse only`, `tick toggles and persists across reload`, `parent sees card and ticks but no tick button`, `no guide chrome when readingKey is null`, `Your translation & notes is inside More`.
- [ ] Run — FAIL. Implement. PASS. Manual Impeccable scan on phone + desktop captures (synthetic).
- [ ] Commit: `Show the labelled study guide overview, theme ticks and verse notes with sources inside the reading page and tuck translation drafts under More`.

### Task 11: Study walk

**Files:**
- Create: `src/components/portal/workspace/study/guide-walk.tsx` — sibling of `lift.tsx`: full-screen dialog, theme → verses (Hebrew, English, note, sources) → next; Back/Next; close returns focus to the verse last shown.
- Modify: `guide-card.tsx` — "Study the themes" button.
- Test: add to `study-guide-ui.test.ts`.

- [ ] Tests: `walk opens on first theme, Next advances through verses then themes, close returns to last verse`, `walk is absent when no themes`.
- [ ] Implement. PASS. Commit: `Add an optional Study walk through the guide's themes beside the continuous reader`.

### Task 12: English side by side on wide screens

**Files:**
- Modify: `src/app/globals.css` (`.reading-passage-layout` rules at `:561-564` breakpoint `min-width:1001px`), `study/view.tsx` `FlowingStudyText` to emit a per-verse English column node when wide; `reading-prefs.ts:17-18` default rule (my call in spec §5: off under 1001px, on at ≥1001px, remembered).
- Test: browser test at 390 and 1440 widths.

- [ ] Tests: `at 1440 English column aligns with its verse (same data-verse-ref row)`, `at 390 English interleaves under the verse`, `preference persists`.
- [ ] Implement. PASS. Commit: `Lay Hebrew and English side by side on wide screens and interleave them on phones`.

### Task 13: Word sheet order

**Files:**
- Modify: `src/components/portal/workspace/study/word-tools.tsx:41-42` — reorder sections: Meaning in this verse, Syllables and stress, Grammar, Dictionary senses. Same component serves the lift.
- Test: existing word-tools tests + one assertion on section order.

- [ ] Test `word sheet lists Meaning before Syllables`. Implement. PASS. Commit: `Lead the word sheet with meaning and keep pronunciation one row below`.

## Milestone D — staff views and haftarah link (Tasks 14–15)

### Task 14: Tutor theme marks and admin status line

**Files:**
- Modify: `progress/marks.tsx` — theme read/unread list on the staff student page; `reading.tsx` admin tab — status line "Study guide: {Claude draft | Reviewed} · N themes · updated {date} · edit in Cowork" + "Preview as student".
- Test: browser test `tutor sees theme read state`, `admin sees status line and preview`.

- [ ] Implement with tests. Commit: `Show tutors which themes a student has read and show the rabbi the guide's review status with a student preview`.

### Task 15: Haftarah study-sheet link

**Files:**
- Create: `src/server/study-guides/haftarah-sheets.ts` — reads the haftarah public library index (format from the haftarah repo, read-only; document the URL) at most once per 24h into `study_cache`, exposes `sheetUrl(readingKey, hebrewYear): string | null`.
- Modify: haftarah card in `reading.tsx` — "This week's haftarah study sheet ↗" when non-null.
- Test: `tests/app/haftarah-sheets.test.ts` (invented fetch: present → URL `https://haftarah.centralreform.org/5787/noach`; absent → null; fetch error → null and no throw).

- [ ] Implement with tests. Commit: `Link the matching public haftarah study sheet from the haftarah card when the library has one`.

## Milestone E — verification and release (Task 16)

### Task 16: Gates

- [ ] `npm test`, `npm run typecheck`, `npm run check:repo`, `npm run test:http:browser`, `npm run test:postgres` (local cluster, UTF-8 init per memory) — all PASS on Windows; CI all four jobs green on the branch.
- [ ] Second-agent adversarial review of Tasks 3–5 (RLS, capabilities) in addition to Task 9.
- [ ] You run the rollout yourself (HANDOFF §5): apply 0027 then 0028 against production with the existing `db:migrate` path (check-only first, read its receipt), then merge and deploy the app, verify the deployment READY on both aliases, and write the STATE.md entry. Log each step as a GATE line.
- [ ] Daniel: set `credits.rabbiDisplayName`, connect Cowork, write the study voice, draft one parashah (open items).

## Operator recipe (documentation only, HANDOFF §6)

A Cowork or Claude Code session connected to the MCP: `list_guide_work` → for each missing base: `get_study_voice`, `get_reading_for_guide`, draft 3–5 themes with ≤ 3 sources per note from the returned candidates only, `save_guide` with `reviewed:false`. Daniel reviews by reading it as the student (web preview) or in chat, edits, saves with `reviewed:true`.
