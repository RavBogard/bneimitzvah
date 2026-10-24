# B3. D'var Torah in a shared Google Doc: design

2026-10-24. State: designed; parents' view, focus line and feedback ownership all decided (Batch 3b, 2026-10-24). No code.

**Decided (Daniel, 2026-10-24, Batch 3 Q14): parents see stages and dates, never the doc link.** "Stages and dates (Recommended)."

**Decided (Daniel, 2026-10-24, Batch 3b Q19): "Rabbi owns feedback and final (Recommended)".** The rabbi owns `feedback` and `final`; tutors may mark feedback given; only a rabbi approves the final text. No free-text focus is stored: `marks` carries no `focusLine` and the rabbi's list shows no focus line.

**Decided.** Daniel, 2026-10-24: "it will be a shared Google doc." (QUESTIONS-2.0.md, Batch 1 Q1.) This is model (c) from B1. The student drafts the d'var Torah in a Google Doc the family shares with the tutor and rabbi. The app tracks only three things: the stages, their dates, and the doc's link. There is no drafting in the app or in Claude.

**Sources.** Code paths are in `C:/Users/dsbog/bneimitzvah-study/` (read only, worktree at `cfba020`). Rulings use the short keys from `notes/RULINGS-DIGEST.md`. Common practice is from `B2-PRACTICE.md`. CRC's own guide hasn't been seen, so every default below is a placeholder until it arrives. Anything marked **[Inferred]** is my own reading.

---

## 1. What the app does and does not do

| The app does | The app never does |
|---|---|
| Shows the student their stages, each with a due date counted back from the ceremony date | Holds, fetches, previews, caches or indexes any of the document's text, title or comments |
| Holds one link per student to a Google Doc, which it checks only by its shape | Calls any Google API, or checks the doc's sharing settings |
| Lets the student, tutor and rabbi mark stages done, and records who marked each one and when | Scores, ranks, counts words, or compares one student with another |
| Gives the rabbi one list of every student's next d'var stage | Sends any message by default (see §8) |
| Lets a congregation edit its stage list and default dates | Gives Claude any access to the link or the document (see §9) |

This keeps both rulings intact: "Writing stays in Claude" (MISSION L12), and "a child's writing … student and staff only" (R15 L140). The app stays out of the writing altogether.

## 2. Stages

### 2.1 The default list (placeholder until CRC's guide arrives)

Drawn from common practice (B2 §3–4). Offsets count back from `student.ceremony_date`, which is required (`src/server/db/tenant-schema.ts` L62).

| # | id (fixed) | Label | Owner (who normally marks it) | What marks it done | Default due |
|---|---|---|---|---|---|
| 1 | `focus` | Choose your focus | Student | The student (or tutor or rabbi) marks it done. No free text is stored (Batch 3b Q19) | 12 weeks before |
| 2 | `outline` | Outline | Student | Marked done | 10 weeks before |
| 3 | `first-draft` | First draft | Student | The student marks it "Ready for feedback" | 8 weeks before |
| 4 | `feedback` | Feedback on the draft | Rabbi (tutor allowed) | The reader marks "Feedback given" after commenting in the doc | 6 weeks before |
| 5 | `final` | Final text | Rabbi only | The rabbi marks "Approved" | 3 weeks before |
| 6 | `aloud` | Read it aloud | Tutor (rabbi allowed) | Marked after the student reads it aloud to them | The first rehearsal if one is set (`rehearsal_1`, tenant-schema.ts L64), otherwise 2 weeks before |

Adding the doc link is a precondition, not a stage. Until a link exists, stages 3–5 show "Add your document first". Stages 1–2 can be done on paper.

Why six stages and not eight: Daniel's test is "faster and better, not slower and more bureaucratic". "Revise" and "rabbi review" are folded into `feedback` and `final`. A congregation that wants more stages adds them (§2.2). [Inferred]

### 2.2 Editable per congregation

- A new optional key `dvarTorah` joins the closed congregation settings. The keys today are `SETTINGS_KEYS` (`src/server/settings/validation.ts` L12) and the type `CongregationSettings` (L20). The DB function `portal_tenant_settings_valid` mirrors these, and both must change together (validation.ts L5–6).
- Shape:

  ```
  dvarTorah?: { stages: Array<{ id; label; help?; owner: "student"|"tutor"|"rabbi"; due: { weeksBefore: number } | { rehearsal: 1|2, fallbackWeeksBefore: number } }> }
  ```

- Limits [Inferred]:
  - 2–10 stages;
  - `id` matches `^[a-z][a-z0-9-]{1,31}$`, unique;
  - `label` up to 60 characters and `help` up to 200, both via `settingsLine` (validation.ts);
  - `weeksBefore` 0–52;
  - `final` must exist and its owner must be `rabbi`.
- When the key is absent, the §2.1 list applies, following the settings rule that an absent field "takes the portal's current behaviour" (validation.ts L4).
- Editing happens on the existing admin Settings page (`src/app/workspace/admin/settings/page.tsx`). Only the admin grant can save it, and in this product the admin grant is the rabbi (`tenant-settings-schema.ts` L30–31 comment).
- **Ids are fixed; labels can change.** Renaming a stage keeps its history. Removing a stage from the list keeps any marks already made: the student's page shows them under "Earlier stages", and the rabbi's list leaves them out.
- A second congregation (2.5) brings its own list and needs nothing else. Nothing here is CRC-specific.

### 2.3 Who may mark what

| Actor (portal role / mode) | Their own stages | Others' stages | Undo | The link |
|---|---|---|---|---|
| Student (`student` mode, via `student_identity`) | Mark and unmark | No | Their own marks | Add, change, remove |
| Parent in child practice (`child-practice` mode, as the 1.0 `translation_draft` allowed; `student-work-schema.ts` L30) | Mark and unmark student-owned stages, on the child's behalf | No | Their own marks | Add, change, remove |
| Parent, ordinary parent view (`parent` mode) | Read only: stages and dates. They never see the link (decided 2026-10-24) | — | — | No (decided) |
| Tutor (assigned through `tutor_student`, tenant-schema.ts L122) | Mark any stage except `final` | Yes, on the student's behalf | Any mark except `final` | See and open; no edits [Inferred] |
| Rabbi (`admin`) | Mark any stage, and only the rabbi marks `final` | Yes | Any mark | See and open; may remove a link that doesn't work |

- Every mark records the role that made it. The student's page shows "Marked by your tutor" or "Marked by the rabbi", never a person's name. Staff pages show the first name, as lesson notes already do ("Lesson author", `parent-summary.tsx`).

## 3. The doc link

### 3.1 What is accepted

Only a Google Docs document address:

- **Accepted shapes:**
  - `https://docs.google.com/document/d/{id}` with an optional `/edit`, `/view` or `/preview`;
  - an optional `/u/{n}` segment before `/d/`;
  - any query or fragment, which is dropped.
- **The id** must match `^[A-Za-z0-9_-]{25,100}$`, the same range the app already allows for a Sheets id in `ROSTER_SHEET_ID` (validation.ts L28). [Inferred]
- **What is stored:** the id only. The app always rebuilds the link as `https://docs.google.com/document/d/{id}/edit`.
- **Refused, each with its own message (B3-STRINGS):**
  - Published-to-web links (`/document/d/e/…/pub`). A published doc is public to anyone, which goes against R15 L140.
  - Other Google files: Sheets, Slides, Forms and `drive.google.com/file/…`.
  - Any other host, `http:`, a link with user information or a port, and anything over 512 bytes (the settings URL limit, validation.ts L10).
- **No network check.** The server never requests the address. "Saved" means only that the shape is right. Whether the tutor and rabbi can open the doc is up to the family's sharing, and the help text says so.

### 3.2 Opening it

- Opens in a new tab with `target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"`, as the siddur and music links already do (`src/components/portal/workspace/reading.tsx` L376).
- No preview, unfurl, favicon or title fetch, and no iframe.

### 3.3 Privacy

- **The link counts as student data.** It is tenant-scoped and visible only to the roles in §2.3. Per MISSION L76, anything about a student "stays visible only to that family and staff".
- **It is never sent anywhere else:**
  - not in an email (§8);
  - not in an MCP result (§9);
  - not in logs (log the student id and the action only, as `notification_delivery` stores "No address or message text", `notification-schema.ts` L29);
  - not in the audit row (§4.3).
- **Who reads the document is decided in Google, not in the app.** The help text tells families to share by email with the tutor and the rabbi and not to use "Anyone with the link". The app cannot check this. **[Inferred] The risk:** a family that shares by link makes the doc readable to anyone who sees the address. The app shows that address only to the roles above.
- **Parents (decided 2026-10-24: stages and dates, never the link).**
  - B1 noted that "under (c) the family decides by sharing".
  - My recommendation: the parent view shows the stages and dates, which are logistics like the practice dates the parent view already shows (`parent-summary.tsx`). It doesn't show the link.
  - Reason: an adult student's or a teenager's doc is theirs to share, and a parent who has been given access already has the link in Google.
- **Adult students** (`student_kind = 'adult'`, tenant-schema.ts L60) work the same way. Their parent rows are usually empty.

## 4. Data model and migration

### 4.1 The rulings tension

- **"Reserve room":**
  - REVIEW L18: "Reserve room in the data model now; build it later";
  - REVIEW L101: "`dvar_torah_draft` … reserved, not built … A reserved kind or an empty table is enough".
- **"No premature tables":**
  - MISSION L181: "reserve an extension seam without prematurely creating unused tables";
  - REVIEW L261: "Avoid prematurely creating unused d'var/siddur tables".
- **Where things stand:** R15 L138 says the `dvar_torah_draft` kind "is reserved but not built". A filename search of `src/server/db/` found no table of that name. [Inferred: I could not search file contents, so a mention inside a file may exist.]
- **Recommendation:**
  - Build one small table in 2.0. It is not premature, because 2.0 uses it from day one.
  - Don't call it `dvar_torah_draft`: it holds no draft, and the name would invite someone to put text in it later.
  - Name it `dvar_torah_progress`, and mark the reserved `dvar_torah_draft` name retired in MISSION and REVIEW, citing Daniel's ruling of 2026-10-24.
  - Under model (c) the 4 KB limit question goes away (R15 L139, RM2 L165).

### 4.2 Table `dvar_torah_progress` (append-only, head = max version)

This follows `tenant_settings`: a versioned body with a stream key, a receipt key and a digest (`src/server/db/tenant-settings-schema.ts` L12–36). It also follows the actor columns of `translation_draft`/`tutor_note` (`student-work-schema.ts` L5–31).

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | text, not null, FK `tenant` | |
| `student_id` | uuid, not null | FK `(tenant_id, student_id)` → `student` |
| `version`, `base_version`, `previous_version` | int | `version = base_version + 1`, as in tenant_settings L27 |
| `doc_id` | text, null | Google doc id only; check `^[A-Za-z0-9_-]{25,100}$` |
| `marks` | jsonb, not null | `{ [stageId]: { on: "YYYY-MM-DD", byRole: "student"\|"parent"\|"tutor"\|"admin", byMembershipId: uuid } }`. Closed shape, checked in SQL as `student_import_metadata_closed` does (tenant-schema.ts L77–92) |
| `due_overrides` | jsonb, not null, default `{}` | `{ [stageId]: "YYYY-MM-DD" }`. Per-student date changes made by tutor or rabbi |
| `actor_user_id`, `actor_membership_id`, `role_grant_id`, `role`, `mode`, `guardian_id`, `context_id`, `student_identity_id` | as `student-work-schema.ts` L10–12 | The same mode checks as `translation_draft` for student and child practice, plus tutor and admin |
| `mutation_id`, `request_digest` | uuid, text | Receipt key `(tenant_id, student_id, actor_user_id, mutation_id)`; digest `^[a-f0-9]{64}$` |
| `created_at` | timestamptz | |

- **No text column.** `marks` carries no text at all (no focus line; Batch 3b Q19).
- **Dates are computed, not stored.** A due date is `ceremony_date − weeksBefore`, or the rehearsal date, unless an override exists. When the roster changes a ceremony date, the dates move with it. Overrides stay, and the tutor and rabbi see "The ceremony date changed. Check these dates." This mirrors the roster's existing "both readings need review" message (`roster.tsx`, the `review` branch of `mutate`).
- **The stage list lives in `tenant_settings.body.dvarTorah` (§2.2).** It is not in this table.

### 4.3 Migration `0043_dvar_torah_progress.sql` [Inferred number: after `0042_curated_discussions.sql`]

- `CREATE TABLE`, with the FKs and checks above.
- RLS, using the house loop (`0027_study_guides.sql` L193–203, loop at L195):
  - `ENABLE` and `FORCE ROW LEVEL SECURITY`;
  - `REVOKE ALL … FROM PUBLIC, portal_runtime`;
  - `GRANT SELECT, INSERT` to `portal_runtime`;
  - `CREATE POLICY tenant_isolation … USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))`;
  - the `portal_immutable_audit` trigger against UPDATE and DELETE.
- Extend the `audit_action_known` check (tenant-schema.ts L228) with `dvar.link-set`, `dvar.link-clear`, `dvar.stage-set` and `dvar.dates-set`. The audit row's `target_id` is the progress row id, never the doc id.
- Extend `portal_tenant_settings_valid` for `dvarTorah`.
- One migration, adversarial review required, because it touches privacy (H20 §G).

### 4.4 Access in the server [Inferred]

- **Writes are compare-and-set** on `base_version`. A stale write returns 409, and the screen says "Someone changed this since you opened it", as the roster does.
- **Reads are scoped by role** (§2.3). Before returning `doc_id`, the server checks for:
  - a tutor: an active `tutor_student` row;
  - a student: an active `student_identity`;
  - a parent in child practice: an active `guardian` with `practice_enabled`.
- **Disabled students** (`student.disabled_at`) are read only for staff and hidden from learners.

## 5. Deadlines

- **Defaults:** as in §2.1. All of them are editable per congregation (§2.2), and the tutor or rabbi can move them per student (`due_overrides`).
- **Display:** the date in the ceremony's own format, `ceremonyCountdown(...).label` (`reading.tsx` L43–48). Next to it goes a plain distance: "in 12 days" or "today". A past due date reads "Was due Sun, Feb 1".
  - No red, no "late", no "overdue" badge, no counts of missed stages (H20 tone ruling).
  - A stage that is marked done shows "Done Sun, Feb 1" instead.
- **When a due date falls after the ceremony,** say because the date was moved up close, it is shown as the ceremony date. The tutor and rabbi see "Some dates are close together. Adjust them if you need to." [Inferred]

## 6. Screens

The learner page is not tabbed. The staff page has the tabs Reading, Service parts and Lessons (`reading.tsx` L86–87, L206, L243). A d'var section is added to each:

- **Student, and parent in child practice:** a "D'var Torah" section after Service parts on the stacked page.
- **Tutor and rabbi on a student:** a fourth tab, "D'var Torah", after Lessons.
- **Rabbi only:** a new admin page, `/workspace/admin/dvar-torah`, linked from the admin navigation (`admin-nav.tsx`).
- **Parent view:** a short read-only stage summary under the preparation summary (`parent-summary.tsx`).

### 6.1 Student, 360 px

```
┌────────────────────────────────────────┐
│ D'var Torah                            │
│ Your d'var Torah is written in a       │
│ Google Doc you share with your tutor   │
│ and rabbi. This page keeps your stages │
│ and dates.                             │
│                                        │
│ Your document                          │
│ ┌────────────────────────────────────┐ │
│ │ Open your document  ↗              │ │ ← 44px tall
│ └────────────────────────────────────┘ │
│ Change link                            │
│                                        │
│ ── Stages ─────────────────────────────│
│ ✓ Choose your focus                    │
│   Done Sun, Jan 4 · Marked by you      │
│ ✓ Outline                              │
│   Done Sat, Jan 17                     │
│ ○ First draft                          │
│   Due Sat, Jan 31 · in 6 days          │
│   ┌──────────────────────────────┐     │
│   │ Ready for feedback           │     │
│   └──────────────────────────────┘     │
│ ○ Feedback on the draft                │
│   Due Sat, Feb 14 · Your rabbi marks   │
│   this                                 │
│ ○ Final text                           │
│   Due Sat, Mar 7 · Your rabbi marks    │
│   this                                 │
│ ○ Read it aloud                        │
│   Due Thu, Mar 12 (first rehearsal)    │
│                                        │
│ Ceremony Sat, Mar 28                   │
└────────────────────────────────────────┘
```

**Empty, with no link yet:**

```
┌────────────────────────────────────────┐
│ D'var Torah                            │
│ (intro as above)                       │
│                                        │
│ Your document                          │
│ No document yet. Start a Google Doc,   │
│ share it by email with your tutor and  │
│ rabbi, then paste its link here.       │
│ ┌────────────────────────────────────┐ │
│ │ https://docs.google.com/document/… │ │
│ └────────────────────────────────────┘ │
│ ┌──────────────┐                       │
│ │ Save link    │                       │
│ └──────────────┘                       │
│ Share with people, not "Anyone with    │
│ the link".                             │
│                                        │
│ ── Stages ─────────────────────────────│
│ ○ Choose your focus · Due Sat, Jan 3   │
│   [ Mark done ]                        │
│ ○ Outline · Due Sat, Jan 17            │
│   [ Mark done ]                        │
│ ○ First draft · Add your document      │
│   first                                │
│ …                                      │
└────────────────────────────────────────┘
```

**States:**

| State | What shows |
|---|---|
| Loading | "Loading your d'var Torah…" (role=status); stage rows hidden, never stale |
| Couldn't load | "Your d'var Torah couldn't be loaded." + [Reload] |
| Saving a mark | The button shows "Saving…" and is disabled; other buttons stay usable |
| Save conflict (409) | "This changed since you opened it. Nothing was overwritten." + [Reload] |
| Unclear save | "We couldn't confirm whether this saved. Reload to check before trying again." (roster wording) |
| Link refused | An inline message under the field naming the reason (B3-STRINGS D-ERR-*); the field keeps what was typed |
| Offline (installed app, 14-day reading) | "This needs a connection. Your stages show again when you're back online." Nothing is cached [Inferred: the d'var section is not part of the offline reading set] |
| Stage marked by staff | "Marked by your tutor" / "Marked by your rabbi"; the student can't undo a staff mark |

### 6.2 Tutor, student tab, 360 px

```
┌────────────────────────────────────────┐
│ [Reading][Service parts][Lessons][D'var│
│  Torah]                                │
│                                        │
│ Maya Example · Sat, Mar 28 · 54 days   │
│                                        │
│ Document  Open document ↗              │
│ Shared by the family. If it won't      │
│ open, ask them to share it with your   │
│ email.                                 │
│                                        │
│ ✓ Choose your focus   Done Jan 4       │
│   Student                              │
│ ✓ Outline             Done Jan 17      │
│ ● First draft         Ready Jan 30     │
│   Marked ready by the student          │
│ ○ Feedback on the draft  Due Feb 14    │
│   [ Feedback given ]                   │
│ ○ Final text          Due Mar 7        │
│   The rabbi marks this                 │
│ ○ Read it aloud       Due Mar 12       │
│   [ Mark done ]                        │
│                                        │
│ Change dates for this student          │
└────────────────────────────────────────┘
```

- **"Change dates"** opens a sheet. It reuses the roster's sheet pattern: a `dialog`, "Keep editing" and "Discard changes" (`roster.tsx`), and one date field per stage. Clearing a field returns that stage to the default date.
- **Tutor list cards stay as they are:** name, date and days (`students.tsx` L20–25). No d'var status is added there, so the list never becomes a scoreboard. [Inferred]
- **States** are as on the student screen, plus "No document yet. The student adds the link." when `doc_id` is null.

### 6.3 Rabbi, the d'var list, 360 px

```
┌────────────────────────────────────────┐
│ Students  Settings  …  D'var Torah     │
│                                        │
│ D'var Torah                            │
│ ( Waiting on you · All upcoming )      │ ← segmented, 44px
│                                        │
│ Waiting on you                         │
│ ┌────────────────────────────────────┐ │
│ │ Maya Example          Sat, Mar 28  │ │
│ │ First draft ready · Jan 30         │ │
│ │ Open document ↗   Open student     │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ Sam Sample            Sat, Apr 11  │ │
│ │ Final text due Mar 21              │ │
│ │ Open document ↗   Open student     │ │
│ └────────────────────────────────────┘ │
│                                        │
│ All upcoming (ceremony order)          │
│ Ari Placeholder · Sat, May 2           │
│   Next: Outline · due Mar 7            │
│ …                                      │
└────────────────────────────────────────┘
```

- **"Waiting on you"** lists students with a stage owned by the rabbi (`feedback` or `final`) that is not yet done, where:
  - the stage before it is done, or
  - its due date is within 14 days. [Inferred threshold]
- **Order:** by due date, soonest first. Disabled students and past ceremonies are left out.
- **States:**

  | State | What shows |
  |---|---|
  | Loading | "Loading d'var Torah stages…" |
  | Error | "The list couldn't be loaded, so none of it is shown." + [Reload], as the roster's "Students unavailable" does |
  | Empty, nothing waiting | "Nothing is waiting on you." |
  | No upcoming students | "No upcoming students." |

### 6.4 Parent, read only, 360 px (decided: stages and dates, no link)

```
┌────────────────────────────────────────┐
│ D'var Torah                            │
│ Outline done Jan 17.                   │
│ Next: First draft, due Sat, Jan 31.    │
│ Your child writes it in a Google Doc   │
│ they share with their tutor and rabbi. │
└────────────────────────────────────────┘
```

## 7. Settings screen (admin), 360 px

```
┌────────────────────────────────────────┐
│ D'var Torah stages                     │
│ Students see these stages and dates.   │
│ Dates count back from each ceremony.   │
│                                        │
│ 1 Choose your focus     12 weeks before│
│   Owner: Student        [Edit]         │
│ 2 Outline               10 weeks before│
│ …                                      │
│ 6 Read it aloud         First rehearsal│
│                                        │
│ [ Add a stage ]   [ Use the defaults ] │
│ [ Save stages ]                        │
└────────────────────────────────────────┘
```

Errors name the field and never echo the typed text (validation.ts L62–63, "Problems are field names only").

## 8. Notifications (Track D)

- **None fire, by default or at all, in 2.0.** The only mail stays the account and sign-in mail (H20 L81; STATE L116).
- **Candidates for Track D to weigh.** Each would need:
  - a new `kind` in `notification_preference` and `notification_delivery` (`notification-schema.ts` L12, L20, L35, L49);
  - the congregation switch in `NOTIFICATION_SWITCHES` (validation.ts L13);
  - `PORTAL_NOTIFICATIONS_ENABLED`.
- **The candidates:**
  - `dvar-ready`: to the rabbi (and the tutor) when a student marks "Ready for feedback". At most one a day per student, following the `tutor-draft` period key (notification-schema.ts L36). The subject never names the student and the body uses first names only (NOTIF L19). **No link to the doc in the mail.**
  - `dvar-due`: to the student, a week before a stage they own. This is like `practice-reminder`, off by default (REVIEW L161).
- **[Inferred] The old `tutor-draft` trigger** fires on a saved `translation_draft` (NOTIF L10). It has nothing to do with the d'var under model (c). Track D should not reuse it for the d'var.

## 9. MCP

- **No Claude access to drafts.** Claude never sees a draft, because the app never holds one.
- **No tool returns the `doc_id` or the link, and none writes progress.** That covers `roster-tools.ts`, `study-tools.ts`, `saved-tools.ts` and the other files in `src/server/mcp/`. Existing guards already refuse student data, for example in curated tools: "Every tool refuses input carrying anything from saved readings, notes or student data" (CUR L57).
- **Students can't connect Claude anyway** (MCPD L13), and a doc link handed to Claude would let Claude ask for the document through any Google connector the staff member has. [Inferred] That's the reason to keep the link out.
- **Out of 2.0, for a later ruling:** a read-only admin tool returning stage names and dates only, no link, under the admin-only `portal:roster` consent (MCPD L18). Not proposed now.

## 10. Build slices (for G)

| Slice | Size [Inferred] | Exit test | Review |
|---|---|---|---|
| B3-M1: settings key `dvarTorah`, defaults, validation in TS and SQL, admin settings UI | S | A bad stage list is refused with field names; an absent key gives the §2.1 list | — |
| B3-M2: migration 0043, the `dvar_torah_progress` table, RLS, audit actions, read/write API with role checks | M | Adversarial tests: no `doc_id` across students or tenants; a tutor without `tutor_student` gets 404; a parent in parent mode gets no `doc_id` (decided); a stale write gets 409 | Adversarial (privacy) |
| B3-M3: student, child-practice and tutor sections; the link field; dates; states | M | 360 px checks of every state in §6.1–6.2; the link opens with `noreferrer`; offline message | — |
| B3-M4: the rabbi's d'var list and the parent summary | S | The order and the "Waiting on you" rule; empty and error states | — |

M2 deploys before M3, the way the 1.8 plan deployed field-acceptance first (SIDDUR M1).

## 11. Open questions for Daniel

Decided 2026-10-24 (removed from this list): parents see stages and dates, not the link.

2. **Q2. The focus line. DECIDED (Batch 3b Q19): no free text stored.** Original rec: no free text at all; the app stores only marks and dates. Reason: it keeps the app entirely out of children's writing. A yes adds a 120-character line the rabbi sees on the list.
3. **Q3. Who gives feedback. DECIDED (Batch 3b Q19): "Rabbi owns feedback and final (Recommended)".** Original rec: the rabbi owns `feedback` and `final`, and tutors may mark `feedback`. Reason: common practice makes the d'var the rabbi's (B2 §5). CRC's guide may say otherwise.
4. Also open (not blocking): CRC's own stage list and dates, which replace §2.1 once Daniel supplies the binder (B2 header).
