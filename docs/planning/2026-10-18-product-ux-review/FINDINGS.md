# Usability findings — product UX consultation

**Review basis:** exact current source/deployment `3f1c357` in the recording-media-transport checkout, 2026-10-18. Final accepted `docs/planning/2026-10-18-family-honors/HONOREE-RELEASE-RETURN.md:3` supersedes stale pre-release STATE text. Guest/link management is deployed, but material approval and real guest links are still empty/held. The separate reading candidate `c590bc0` is **not deployed** and is only a possible response to UX-03.

**Mandate:** easy and intuitive for a person comfortable with iPhone apps. Recommendations primarily reorganize existing tasks, language, defaults and recovery; they are not engineering tickets or authorization to implement. [JOURNEYS.md](JOURNEYS.md) describes the intended experiences and role boundaries. Final navigation architecture belongs to the primary consultant's synthesis. Assessment A did not see the new Assessment B or detector findings.

## Interpretation

- **P1:** likely to cause substantial repeated hesitation, incorrect expectations, lost effort or inability to complete a core job without staff explanation.
- **P2:** meaningful friction with a workable alternative, or a readiness/policy gap that needs honest communication before wider use.
- **Direct:** inspected retained rendered evidence. It is dated/synthetic and is not new authenticated acceptance.
- **Source:** current visible flow/copy or state transition read directly. Consequences are reasoned; no new reproduction is claimed.
- **Hypothesis:** a predicted user response or a mission-defined capability without an evidenced operating journey; requires eventual permitted validation.

Paths below beginning `workspace/` are under `src/components/portal/`. Source line references are to `3f1c357`, not the unshipped reading candidate. No P0 is claimed from this consultation. Visual identity is not the underlying problem: preserve the existing reading composition, Hebrew hierarchy, existing tokens and useful native controls.

## Highest-impact themes

1. Reading and service assignment expose preparatory mechanics before a useful choice.
2. Parent/student navigation, teaching navigation and administrative setup do not yet form equally clear journeys.
3. The interface's protection of effort is strong in some forms and unexpectedly different in others.
4. Saved data, granted access, sent invitations, accepted invitations and usable material are distinct states that need understandable summaries.
5. Specialist learning content belongs beside the selected word/verse; specialist system details belong behind secondary explanations.

## UX-01 — Access acceptance does not always finish at the useful destination

**P2 · First-time parent/tutor, overlapping roles · Source.** Student-only entry auto-continues, while other signed-in roles are asked to choose a workspace. A successful invitation first continues to the generic portal. A beginner can feel they have finished signing in but still not know where their task lives.

**Evidence:** `src/components/portal/entry.tsx:32`, `:124`, `:135`; `workspace/students.tsx:101`.

**Recommended outcome:** a single unambiguous role proceeds directly to its task; multiple legitimate roles receive a plain choice naming what each permits. Invitation success ends with one relevant continuation. Role separation remains intact. **Success:** user reaches the intended student/child/teaching context without being coached on “workspaces.”

## UX-02 — Account, identity and support are a disconnected side journey

**P2 · All signed-in users, especially shared-device families · Source.** Account opens the general entry component; sign-out is present, but the experience does not clearly distinguish account help, changing role, changing child and returning to work. Entry still says CRC B’nei Mitzvah while the workspace says CRC Beit Mitzvah. Blocked users are told to ask “the congregation” without an obvious help destination.

**Evidence:** `src/app/account/page.tsx:3`; `src/components/portal/entry.tsx:93`, `:125`, `:126`, `:138`; `workspace/provider.tsx:448`.

**Recommended outcome:** one predictable account/help destination with clear return, available role choices, account-change/sign-out and congregation support. Confirm sign-out; do not promise continued private access. **Success:** a parent can explain whose account they are using and how to leave/help themselves without guessing.

## UX-03 — Reading assignment asks for syntax and process before it offers help

**P1 · Tutor/rabbi/admin · Source; directly consistent with Daniel's reported difficulty.** The current editor starts with Selection method, manual custom ranges, aliyah text entry and preview. Calendar choices require preparing a review first. Existing assignment seeding is another explicit action. The user must understand the form model before choosing a passage.

**Evidence:** `workspace/reading-editor.tsx:105`, `:110`, `:112`, `:115`, `:122`, `:138`.

**Recommended outcome:** use saved ceremony date/slot immediately; show truthful suggestions without a preliminary form submission; offer familiar book/chapter/verse selection and actual calendar helpers; keep manual multi-range/cut controls secondary; then one exact review and explicit save. Preserve custom-first selection, separate Torah/haftarah drafts, current provenance and multi-ranges. **Success:** staff can select the intended passage without knowing reference syntax or treating full portion as an automatic default. Candidate `c590bc0` illustrates a direction, not current completion.

## UX-04 — Service assignment repeats the same preparation bureaucracy

**P1 · Tutor/rabbi/admin · Source.** Choose service parts, catalog loading, checkbox selection, Prepare service review and Confirm service plan are separate visible stages. “Reload catalog and discard draft” places system vocabulary beside the ordinary job.

**Evidence:** `workspace/service-learning/editor.tsx:132`, `:134`, `:141`, `:150`.

**Recommended outcome:** saved parts and available choices are available at entry; one obvious save progression, with a short consequence review for meaningful replacement/clearing. Keep actual authorization and deliberate changes; remove unnecessary human operation of preparatory mechanics. **Success:** the teacher can state what will change and finish without learning “catalog” or “prepare.”

## UX-05 — Families must understand modes and scroll to discover destinations

**P1 · Parent/sibling, student, tutor overlaps · Source; dated student render supports long-page structure.** Staff receive Reading / Service parts / Lessons tabs; families receive stacked sections. Parents see Start and Enter child practice, and child switching within practice sits after the reading. Role, child and capability are different choices without a unified explanation.

**Evidence:** `workspace/reading.tsx:218`, `:219`, `:228`, `:255`; `workspace/students.tsx:83`, `:95`, `:97`. Render: recording-media-transport `.impeccable/review/word-tools-student-phone-closed-confirmation.png` (Oct17 synthetic).

**Recommended outcome:** keep role/current child clear, switching nearby and familiar task destinations available. Name parent practice as “Practice with [name]”; retain the deliberate boundary from the read-only overview. **Success:** users know whose work they see, their current capability and how to reach lessons/service parts without scanning the whole reading.

## UX-06 — Start, Hear, Play and close-up compete as practice entry points

**P1 · Child/adult learner, ear-first learner · Source + dated Direct.** Start opens a close-up, Hear can invoke the same opener, while words/verses and the main player support another route. The distinction is not obvious from the action names. Repeated verse tools further extend the main page.

**Evidence:** `workspace/reading.tsx:186`, `:218`; `workspace/reading-toolbar.tsx:19`; `workspace/study/view.tsx:93`, `:119`, `:144`; retained Oct17 student open/closed phone captures. Human reference playback remains administrator-only pending actual-source listening/phone acceptance in PRODUCT/STATE.

**Recommended outcome:** main-text practice is the primary experience; optional close-up is explicitly named. A short contextual hint explains word versus verse selection. Show only the playback capability that is truly available; do not label a release hold a connection failure. **Success:** a learner can predict which action listens, which changes focus and how to return. No generated or student-recording activation is recommended.

## UX-07 — “English,” personal translation and shared notes need a clearer relationship

**P2 · Learners, parents, teachers · Source.** English toggles a supplied reference; another area offers My translation/Student translation and teacher notes. Lessons use “Add a lesson” for a shared summary, potentially suggesting a scheduling action. These features are valuable but require several vocabulary decisions.

**Evidence:** `workspace/reading-toolbar.tsx:12`; `workspace/work/verse-tools.tsx:68`, `:70`; `workspace/lessons/panel.tsx:216`, `:234`.

**Recommended outcome:** consistent task names such as English reference, My translation, Teacher notes and Add lesson note, with the audience explicit before writing. Keep reference text, personal work and teachers' shared notes distinct. **Success:** a student knows which text is theirs and a tutor knows who can read a note. No scheduling feature is implied.

## UX-08 — Source exploration has several nested decisions before useful reading

**P2 · Curious learner, tutor assigning commentary · Source.** Sources → assigned/related source → edition → source text is legitimate scholarly complexity, but supported and unsupported items coexist. A novice can interpret an unavailable format/edition as personal failure or as an incomplete assignment.

**Evidence:** `workspace/study/sources/panel.tsx:120`, `:135`, `:140`; `workspace/study/sources/content-reader.tsx:10`, `:20`, `:22`, `:27`.

**Recommended outcome:** assigned material leads, optional exploration stays secondary, and the next readable choice is clear. Explain why another edition or return to the verse is needed without substituting text silently. Keep provenance/rights visible where relevant; do not present broad source coverage as completed. **Success:** learner can read an available assigned source and return to the original verse without losing their place.

## UX-09 — Progress marks are sound but not yet a simple family answer

**P2 · Parent, learner, tutor · Source; comprehension hypothesis.** Student “Got it/Still working,” tutor “Solid/Working/Not started” and days practiced measure different things. Per-verse attribution exists, but families must assemble the preparation picture from marks and sections.

**Evidence:** `workspace/progress/marks.tsx:7`, `:19`, `:36`, `:64`; `workspace/practice-calendar/view.tsx:16`.

**Recommended outcome:** a quiet plain-language summary distinguishes student confidence, tutor assessment and days practiced, with the underlying marks still accessible. Do not introduce comparison, a readiness score or raw cross-student practice reporting. **Success:** parent can identify what the child thinks versus what the tutor assessed; learner is not made to feel graded by a streak.

## UX-10 — Closing a form does not consistently protect effort

**P1 · Admin entering names/contacts; distracted phone users · Source, not newly reproduced.** Student-details Close/Cancel clears form state directly. Lessons and honors have deliberate unsaved-work handling. The same-looking sheet therefore makes different promises.

**Evidence:** `workspace/roster.tsx:73`, `:137`, `:149`; `workspace/lessons/panel.tsx:249`; `workspace/honors/sheet.tsx:69`, `:92`.

**Recommended outcome:** clean forms close immediately; changed forms offer a consistent Keep editing / Discard choice. Ordinary foreground return preserves authorized work. Actual sign-out/revocation/expiry remains a different event. **Success:** users do not lose entered contacts because they assumed X, Cancel or Back behaved like another form. Actual iPhone Back/keyboard behavior remains unverified.

## UX-11 — Recovery asks users to diagnose the save machinery

**P1 · Anyone saving during interruption/conflict · Source.** Check save, Retry same save, Check original receipt, Reload, and longer revision/confirmation language appear in different tools. Careful uncertainty handling is a strength, but the user sometimes has to choose the correct recovery mechanism.

**Evidence:** `workspace/work/verse-tools.tsx:47`, `:56`; `workspace/study/sources/panel.tsx:127`, `:129`; `workspace/honors/sheet.tsx:102`; `workspace/reading-editor.tsx:88`; `workspace/csv-import/workspace.tsx:106`.

**Recommended outcome:** one prominent “Check whether it saved” next step when uncertain, followed by the correct truthful status and any later explicit decision. Preserve original intent, drafts, and warnings about possible success; never turn ambiguity into “failed, try again.” Routine completion can simply say Saved. **Success:** a novice recovers without duplicate imports/messages or reconstructing what request they sent.

## UX-12 — Honors is a long task with repeated people and ceremony knowledge

**P2 · Parent/admin; eventual adult policy separate · Source.** Honors lists many roles and per-person fields; closing-ark people are explicitly re-entered even when already used. The current sticky save/status is useful, but completion and where to resume are less clear. Hebrew names can be unknown.

**Evidence:** `workspace/honors/fields.tsx:28`, `:31`, `:41`; `workspace/honors/sheet.tsx:99`, `:105`.

**Recommended outcome:** section overview and compact completed summaries, contextual ceremony help, deliberate reuse of entered people, and a clear saved/unsaved state. Preserve real aliyah group spans and explicit changed-ceremony review. **Success:** family can pause and return to an unfinished role without rechecking the entire form or assuming every Hebrew field is required.

## UX-13 — Link management exposes records rather than a recipient-ready outcome

**P2 · Parent/admin · Source; deployed UI with activation held.** Blessing link controls require Check link record and distinguish stored non-revoked records from usability. Creation sends nothing; the full URL must be copied immediately and cannot later be recovered. This job sits inside entering honors names.

**Evidence:** `workspace/honors/honoree-controls.tsx:10`, `:12`, `:15`, `:20`, `:22`; `workspace/honors/fields.tsx:33`; final release return confirms empty material/link tables.

**Recommended outcome:** separate “enter people” from “prepare/share their blessings.” Show a simple readiness summary and explain copy-now/no-message behavior before creation. Preserve deliberate replace/revoke and uncertainty handling. **Success:** user knows whether there is usable material, whether a link was created/copied, and that nobody has been emailed. Do not treat deployed controls as activated material or recommend automatic mail.

## UX-14 — An ordinary honoree app switch is described like an invalid invitation

**P1 before activating the real recipient journey · Honoree · Source, prospective user impact.** The guest view permanently clears on page hiding; reopening the tab displays “This invitation is unavailable,” the same broad state as an invalid link. On a phone, checking a message can therefore feel like breaking the invitation.

**Evidence:** `src/server/http/honoree-landing.ts:16`, `:23`, `:29`, `:98`. No real activated link was used in this review.

**Recommended outcome:** explain the viewing-session behavior in ordinary language and how to reopen the original invitation safely. Retain expiry, privacy, revocation and strict recipient scope. Do not promise a resume or expose why a secret link was refused. **Success:** an interrupted honoree understands the safe next action and does not believe the ceremony invitation was withdrawn. October18 permission covers text/English/credits, not audio sharing.

## UX-15 — Student setup is fragmented across contacts, people and invitations

**P1 · Rabbi/admin · Source.** Student creation saves contacts; People assigns/links accounts; Invitations sends and tracks access. These are correctly separate operations, but the administrator must remember all of them. Date/slot changes also create follow-up reading/honors tasks elsewhere.

**Evidence:** `workspace/roster.tsx:89`, `:130`, `:148`; `workspace/relationships/workspace.tsx:104`; `workspace/invitations/form.tsx:11`; `workspace/honors/sheet.tsx:16`.

**Recommended outcome:** a student setup summary that distinguishes ceremony details, teaching/material, invitation and effective access, with one next task per incomplete item. Saving an email or importing never silently links/sends. Ceremony changes show the affected review work. **Success:** admin can see what is complete and what still needs action without remembering destination names or treating contact data as permission.

## UX-16 — Per-student removal and congregation-wide revocation are too close conceptually

**P1 · Admin managing overlapping tutors/parents · Source; misunderstanding hypothesis.** Unassign/Unlink and Revoke role are both row actions. The review correctly describes consequences, but the first choice still assumes the administrator understands global versus student-specific scope.

**Evidence:** `workspace/relationships/workspace.tsx:105`, `:115`, `:122`; `workspace/relationships/review.tsx:6`.

**Recommended outcome:** lead with the common per-student task and label the wider action explicitly, for example “Remove access across the congregation,” in an appropriate secondary area. Preserve final person/student/consequence review. **Success:** user can describe who loses access to what before confirming; improving discoverability never makes revocation silent.

## UX-17 — Import starts as a data-format exercise

**P1 for routine roster intake · Admin · Source.** Raw CSV, four exact headers, format versions, encoded limits and normalized duplicate rules dominate the flow; invalid-row feedback often lists several possible faulty fields together. No stable-ID Maven importer is evidenced as completed.

**Evidence:** `workspace/csv-import/workspace.tsx:91`, `:93`, `:99`, `:100`, `:103`; MISSION:34 and current STATE integration-groundwork note.

**Recommended outcome:** one supported template and readable preview, specific field corrections and clear duplicate consequences, with raw format detail under Advanced. Retain explicit import, quiet behavior and honest unknown-outcome checking. No silent merging/identity matching. **Success:** a normal spreadsheet user can fix an identified row and explain what will be created without learning versioned CSV contracts.

## UX-18 — Printing and the office handoff do not form one clear operational journey

**P2 · Learner/admin/office · Source + bounded absence hypothesis.** Chart print and admin saved-honors print exist separately. The mission's portal-owned office roster Sheet is not evidenced as an operating end-to-end user destination; there is no office portal role by design. Planned practice-sheet/Tikkun scope does not prove an existing print button.

**Evidence:** `src/components/portal/trope-chart/print.tsx:20`; `workspace/honors/sheet.tsx:106`; `workspace/honors/print.tsx:5`; MISSION:98. Route/component inventory reviewed; no new integration run.

**Recommended outcome:** name available outputs by purpose and saved/current status; show unresolved ceremony warnings on saved copies. Document the authorized Sheet handoff when ready; do not grant staff admin access to compensate for a missing integration. **Success:** office staff know which source is authoritative, when it was current and who corrects it. Packet/supplement generation stays out of 1.0.

## UX-19 — Adult learning is supported, but honors responsibility has an unresolved gap

**P2 · Adult student/admin · Source + documented policy hold.** Adults have their own student/contact path, but family honors is exposed to linked parents/admins and adult self-edit remains held. A self-managing adult cannot infer whether the absent form is an error or someone else's responsibility.

**Evidence:** `workspace/roster.tsx:105`, `:145`, `:147`; `workspace/students.tsx:86`; `src/server/access/service.ts:65`; STATE pending adult honors policy.

**Recommended outcome:** tell the adult who currently handles honors and how to supply changes through the authorized process. If the policy later permits self-edit, organize it as that adult's ceremony task, not parent practice. **Success:** adult can complete their responsibilities without an invented parent account or unintended admin authority. This is a held capability/policy communication issue, not a recommendation to bypass the hold.

## Evidence limits and next consultation decisions

Retained Oct17 student phone captures informed UX-05/06; current source confirms the broad structure but later Sources additions mean they are not exact current visual proof. Historical Oct16 admin/family images were not treated as current behavior. No authenticated live session, real family/guest data or current iPhone hardware was used. No measured task times, contrast or VoiceOver pass is claimed. Public native evidence collected independently by the primary may supplement this report in synthesis; it was not used to alter this independent assessment.

The next decisions are organizational: each audience's default landing task, the shared task vocabulary, the few changes that deserve extra confirmation, and the meaning of Saved/Ready/Needs review across surfaces. The central recommendation is to make existing capability understandable before broadening it. No implementation is authorized or performed by these documents.

## Independent critique rubric

This rubric uses only Assessment A's evidence above. It is **provisional and primarily source-based**, supported by the retained dated/synthetic student renders already inspected. It is not measured usability, an accessibility certification, or a fresh authenticated observation. Scale: **0 = serious failure, 1 = weak, 2 = mixed, 3 = good, 4 = strong**.

| Heuristic | Score | Judgment at the current baseline |
|---|---:|---|
| Visibility of system status | 3 | Saving, loading, review and uncertainty receive feedback; everyday completion is sometimes overly technical. |
| Match with the real world | 2 | Plain reading/lesson language coexists with prepare, catalog, record and account-link concepts. |
| User control and freedom | 2 | Careful departure/recovery in many tasks; roster closing and guest interruption create inconsistent expectations. |
| Consistency and standards | 2 | Familiar individual controls, but task navigation and saving patterns vary across roles and features. |
| Error prevention | 3 | Explicit consequential reviews and bounded choices are strengths; manual references/imports still demand expertise. |
| Recognition rather than recall | 2 | Setup requires remembering relationships among contacts, invitations, accounts, material and access. |
| Flexibility and efficiency | 2 | Roster search, native choices and direct word actions help; preparation stages and repeated input slow routine work. |
| Aesthetic and minimalist design | 2 | Strong reading identity; exposed process detail and long tool/form stacks compete with the immediate task. |
| Error recovery | 3 | Honest possible-success handling and preserved intent; the user must sometimes choose between technical recovery actions. |
| Help and documentation | 2 | Useful local guidance exists; ceremony terms, blocked states and support destinations need clearer task-level help. |
| **Total** | **23/40** | **Mixed usability: prioritize journey simplification before cosmetic refinement.** |

The total is a synthesis aid, not a release gate or a claim that every role is equally weak. The largest gaps are recognition, consistent task structure, efficient ordinary actions and protection of interrupted effort. They correspond to existing findings; this rubric adds none.

### Cognitive-load decision points

| Decision point | Avoidable load | Better experience already recommended |
|---|---|---|
| Reading assignment | Understand method and syntax, prepare to discover calendar help, then choose/review. | Known ceremony context, familiar passage choice, secondary advanced detail, one meaningful review. |
| Parent return | Choose child, interpret viewing versus practice, locate lessons/service/honors in a long page. | Clear child/mode identity and a small set of task destinations. |
| Student question | Distinguish Start/Hear/Play, word tools, verse tools, English, personal work and sources. | Begin at the selected word/verse; disclose the tool relevant to the learner's question. |
| Admin setup | Remember what saving contacts does not do, then find invitation/assignment/access tasks. | Visible setup states and a clear next step; keep authorization decisions deliberate. |
| Honors/import/recovery | Repeated people, specialist formats, multiple repair choices and uncertain saved state. | Reuse known information, readable previews, specific errors and one prominent safe recovery action. |

Reading Hebrew and making ceremony decisions carry intrinsic difficulty; learning the software's preparation vocabulary is extraneous. Source review indicates **moderate-to-high avoidable load in setup/assignment**, rather than a blanket claim that every screen is overloaded. The checklist's main weaknesses are working-memory continuity, one-thing-at-a-time and progressive disclosure. Minimal-choice pressure arises where several tool/process decisions appear together; no fresh visible-option counts were measured, and collapsed native option lists are not themselves a wall of choices.

### Emotional journey

The intended sequence is **recognition → confidence → useful practice/preparation → reassurance → completion**. The named learner, prominent passage and familiar controls support recognition. Ambiguous modes and procedural stages create hesitation. Interrupted work or a guest view that suddenly says unavailable creates anxiety. Honest uncertainty handling is valuable; it should culminate in a plain, dependable next step and calm confirmation rather than additional diagnosis. Saved, Ready and Needs review must mean different, understandable things. Waiting students should know their tutor will add material, without feeling responsible for setup.

### Design specificity and strengths

**Judgment:** The current reading interface is meaningfully specific to this product. Hebrew hierarchy, phrase colors, passage identity and direct word/verse practice connect the visual language to learning. Preserve that foundation; standard task navigation and controls should make it easier to use, not dress the product in another metaphor.

1. The reading has a clear identity, and remembered display preferences support repeated practice without reconfiguration.
2. Native controls, labeled actions and generous control sizes provide a familiar base. Actual iPhone keyboard, VoiceOver and zoom acceptance remain unverified by this assessment.
3. Deliberate access/send decisions, truthful saved-state handling and recipient-scoped material protect trust. Simplification should remove procedural burden while retaining those real decisions and boundaries.
