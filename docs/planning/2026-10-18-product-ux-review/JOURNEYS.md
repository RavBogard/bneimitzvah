# Role journeys — product UX consultation

**Baseline:** current repository/release source `3f1c357`, read from `C:/Users/dsbog/.codex/worktrees/recording-media-transport/bneimitzvah` on 2026-10-18. `HONOREE-RELEASE-RETURN.md` Final release accepted records exact-source deployment of `3f1c357` and supersedes the older STATE production paragraph. Guest/link-management code is deployed; real material approval and guest links remain absent/held. Deployed code is not proof of an activated recipient journey. The reading-assignment candidate `c590bc0` is a separate, unshipped proposal and is not used as current behavior here.

**Mandate:** reorganize existing features into clearer journeys for a person comfortable with iPhone apps, without assuming product or ceremony expertise. This is consultation, not an implementation plan. No code, tests, servers, deployment, commitments or policy changes. Findings and their evidence are in [FINDINGS.md](FINDINGS.md). Assessment A remained independent of the new Assessment B.

## People and boundaries

| Audience | Their job | Boundaries that a clearer journey must preserve |
|---|---|---|
| Child student | Learn their reading and service parts; understand words; work on translation; mark personal progress. | Only their authorized material. No student chatbot, visible transliteration, generated audio or student-recording activation in this release. |
| Adult student | The same learning tasks, with adult language and responsibility for their own contact. | A student role does not become clergy/admin. Adult honors self-edit is held pending policy; do not make an adult pose as a parent. |
| Linked parent/guardian | Follow each child's reading, tutor notes, lessons and progress; enter honors; deliberately practice with a child. | Dashboard read-only except honors. Delegated child practice is explicit and child-specific. Sibling and tab scope remain clear. |
| Tutor/cantor | Teach assigned students; set readings, service parts and sources; assess verses; leave lesson notes. | Cantor is a tutor designation, not another workspace or access tier. Teaching access is limited to assigned students. |
| Rabbi/admin | Prepare student records; arrange teaching/family access; assign/review material; manage ceremony changes and honors. | Saved contacts/imports do not silently invite, link accounts or send mail. Broad access changes require deliberate understanding. |
| Honoree | Open a private link and prepare their own aliyah blessings. | No login required, no family dashboard, no sibling/other-aliyah material. October18 permission covers booklet blessing text/English/credits; it does not approve booklet publication or audio sharing. Material approval/activation and real recipient links remain held, despite deployed guest/management code. |
| Office roster consumer | Read the portal-owned roster Sheet and approved ceremony information needed for office work. | MISSION explicitly calls for **no office/staff portal role**. The Sheet handoff is not a reason to grant admin access. No scheduling/pay/hour features or custom packet builder in 1.0. |

One person can occupy several legitimate roles. Navigation should distinguish “what I am doing” from “whose material I am viewing.” Role convenience must never silently widen authority.

## Recommended organizing principle — proposal for synthesis

Preserve the existing reading interface's Hebrew, color and typography. Favor a stable identity/context area and a small set of familiar task destinations over another visual world. A student returns to learning; a parent returns to the selected child's preparation; a tutor returns to the teaching session; an admin returns to student setup and exceptions. Exact navigation architecture remains the primary consultant's synthesis decision.

Use one visible next action per task. Reading/service changes need a concise review of meaningful consequences; ordinary marks, notes and honors edits need familiar Save behavior. Account, support and sign-out should be consistently findable without competing with the reading. Honoree and office journeys remain intentionally narrow.

## J01 — Accept access and arrive somewhere useful

- **Trigger/outcome:** a student, parent or tutor opens an invitation and wants to reach the right material.
- **Current obstacles:** signing in, accepting access and choosing a workspace are separate mental steps. Single-role student auto-entry exists; other roles can encounter another chooser. Invalid/expired messages direct people generally to “the congregation.”
- **Proposed steps:** open invitation → choose Google or email sign-in → see the named role/student access being accepted → accept once → continue directly to the relevant permitted destination. Keep a deliberate role choice when genuinely ambiguous.
- **Recovery:** wrong account has an explicit change-account route; expired link points to the latest invitation and a clear support destination. Do not reveal whether an arbitrary email is enrolled.
- **Clear success:** “You're ready to view [appropriate task]” with one continuation. Acceptance never implies a student reading has already been assigned.
- **Related:** UX-01, UX-02, UX-15.

## J02 — Return, change role, get help or leave safely

- **Trigger/outcome:** a returning user wants to resume; a shared-device user wants to confirm sign-out; a blocked user needs help.
- **Current obstacles:** Account is the general entry component rather than a clearly differentiated account/help destination; names vary between entry and workspace. Role switching, choosing a student and child practice represent different concepts.
- **Proposed steps:** enter the appropriate authorized workspace → identify current role/student → resume the last relevant task where safe. Account offers a clear return to work, role change when available, help, and sign-out. These are conceptually distinct from switching children.
- **Recovery:** explain whether material is loading, access changed, or sign-in expired. Preserve normal tab-return continuity; do not restore private content after genuine authority loss. Unsaved work receives a clear keep/discard choice where permitted.
- **Clear success:** resumed work is identifiable; sign-out is explicitly confirmed. No private “last reading” appears to the next account.
- **Related:** UX-01, UX-02, UX-05, UX-10, UX-11.

## J03 — Practice an assigned reading, child or adult

- **Trigger/outcome:** the learner returns to practice Torah or haftarah and wants a useful first action within seconds.
- **Current obstacles:** Start opens a close-up while listening is also available in the main passage; Hear adds another possible interpretation. Later tools and lesson/service information extend the page. Human reference playback is still administrator-only pending listening/phone acceptance, so visible machinery is not proof of learner release.
- **Proposed steps:** see own passage and ceremony context → choose Torah/haftarah if needed → read/play from the main flowing text when authorized → repeat a word/verse or adjust speed → optionally open close-up → mark how it is going.
- **Recovery/empty:** no assignment says the tutor will add it, with an appropriate contact path. Unavailable text/audio distinguishes “not ready here” from “try your connection.” Return to the same verse/scroll after ordinary interruption.
- **Clear success:** the learner can identify the practiced passage, stop playback, and see a saved self-check. No score, recording submission or generated feedback is implied.
- **Related:** UX-05, UX-06, UX-09.

## J04 — Understand a word, translation or assigned source

- **Trigger/outcome:** the learner has a question about a specific word/verse without wanting to lose the reading.
- **Current obstacles:** global Word tools, per-verse tools, English visibility, personal translation, teacher notes and source/edition browsing are spread across several disclosures and repeated blocks.
- **Proposed steps:** select the relevant word/verse → choose a clearly named purpose: Hear / Meaning / Hebrew syllables and stress / English reference / My translation / Teacher notes / Sources. Show the tutor's assigned sources before optional broader exploration; retain edition choice and attribution when reading.
- **Recovery:** a held source/edition says it is not available here, offers a valid alternative or return to the verse, and does not look like a broken student assignment. Personal text stays distinct from the supplied reference translation.
- **Clear success:** the learner returns to the same reading position; any personal work has a clear saved status. No invented meaning, silent edition substitution or visible transliteration.
- **Related:** UX-06, UX-07, UX-08, UX-11.

## J05 — Parent checks one child's preparation and switches siblings

- **Trigger/outcome:** a parent wants to know what a child is preparing, what the tutor said and what needs attention.
- **Current obstacles:** child cards, honors entry, reading, practice entry, progress, service parts and lesson notes are distributed through a long page. Students' and tutors' progress assessments have different meanings.
- **Proposed steps:** select child → see an unmistakable child identity/ceremony → see current reading, recent lesson and attributed progress → open Reading / Service parts / Lessons / Family honors as needed → switch child near the same identity area.
- **Recovery:** missing links explain who can fix them; partial/unavailable information does not reuse a sibling's data. A successful sibling switch updates the whole visible context.
- **Clear success:** the parent knows which child, which passage and whose assessment they saw. No implied practice-editing authority from viewing the dashboard.
- **Related:** UX-05, UX-09, UX-12.

## J06 — Parent deliberately practices with a child

- **Trigger/outcome:** the parent wants the child-specific practice capabilities rather than only the overview.
- **Current obstacles:** “Enter child practice,” “Child practice,” and per-tab explanations expose a system mode; switching is after the reading. Refresh cannot recreate the delegated selection.
- **Proposed steps:** choose “Practice with [child]” → clearly enter that child's practice → use permitted tools → switch to another linked child or return to parent overview from a consistently placed control.
- **Recovery:** if practice expires or a reload loses the selection, explain that the parent must choose the child again. Keep the current child's name visible and require a deliberate new choice; do not silently restore authority.
- **Clear success:** parent knows which child's practice is active and can leave it without signing out of their own account.
- **Related:** UX-05, UX-11.

## J07 — Tutor/cantor conducts and records a lesson

- **Trigger/outcome:** the teacher selects an assigned student, practices material, assesses progress and leaves a useful summary.
- **Current obstacles:** staff task tabs work well, but reading/word/verse tools can be lengthy; “Add a lesson” can sound like scheduling rather than writing a summary. Switching students should remain easy with unsaved work protected.
- **Proposed steps:** choose student → Reading / Service parts / Lessons → practice and assess relevant verses → “Add lesson note” → see that the student/family will read it → Save. Choose assigned sources beside the relevant verse when needed.
- **Recovery:** retain draft note and give a clear keep/discard decision on changing student. A conflict identifies the changed material and preserves the teacher's original wording for review.
- **Clear success:** a dated shared note appears under the correct student; tutor assessment is explicitly distinct from student self-check. No hours, billing or scheduling are introduced.
- **Related:** UX-05, UX-07, UX-09, UX-10, UX-11.

## J08 — Assign or change Torah/haftarah

- **Trigger/outcome:** tutor/admin knows the ceremony and wants to assign the exact student passage.
- **Current obstacles:** current release starts with selection method/manual syntax; calendar suggestions appear only after preparing a proposal; custom references, cuts and preview all compete at entry. Existing assignments require an extra Use current action to seed a draft.
- **Proposed steps:** show saved date/slot and available calendar context → choose own verses by familiar book/chapter/verse controls or choose an actual suggested helper → optionally adjust multiple ranges/aliyah boundaries → review exact passage/consequences → save explicitly.
- **Recovery:** missing slot leads to its owner/setting; holiday/unavailable-calendar cases honestly support custom references. Existing multi-ranges and provenance must survive without silent conversion. A stale or uncertain result has a single understandable check-current route.
- **Clear success:** the exact reading is confirmed for the correct student. Torah and haftarah drafts stay separate. The earlier candidate is a proposal embodying some of these ideas, not deployed evidence.
- **Related:** UX-03, UX-10, UX-11, UX-15.

## J09 — Choose, change and study service parts

- **Trigger/outcome:** staff assign parts; student/parent reads the selected material.
- **Current obstacles:** staff must load a catalog, select, prepare a review and confirm; “Reload catalog and discard draft” competes with the task. Readers must choose a part after locating the section.
- **Proposed steps:** show current ceremony and saved parts → staff select from available parts immediately → save, with one concise confirmation only for meaningful replacement/clearing. Readers choose a named part and read it, with source notes/credits available.
- **Recovery:** unknown slot identifies the missing setup step; unavailable/withdrawn material gives a truthful next action without substituting another source. Draft choices remain separate from the saved plan.
- **Clear success:** saved assigned parts are named and visible; selecting a part for study does not change the assignment. External prayer audio/feed capability must not be implied when absent/held.
- **Related:** UX-04, UX-05, UX-11.

## J10 — Admin prepares a student and the right people

- **Trigger/outcome:** rabbi/admin creates a child/adult record, sets the ceremony, appoints a tutor and deliberately arranges account access.
- **Current obstacles:** saving contacts, assigning a tutor, inviting accounts and accepting invitations are distinct destinations; “People” does not describe a beginner's next step. Per-student removal and congregation-wide revocation sit together.
- **Proposed steps:** save student/ceremony → see a compact setup summary (Reading / Tutor / Family or own access) → choose the next incomplete task → review the exact person/student/consequence → explicitly send or change access. Adults use their own contact, not a manufactured parent relationship.
- **Recovery:** uncertain saves are checked before another creation. Wrong account/expired invitation has a clear recovery. Disable/remove actions name their actual scope and preserve history as applicable.
- **Clear success:** a setup summary distinguishes record saved, invitation sent, invitation accepted, and effective student access. It never treats one as proof of the others.
- **Related:** UX-01, UX-02, UX-10, UX-15, UX-16, UX-19.

## J11 — Admin imports and reconciles a roster quietly

- **Trigger/outcome:** administrator brings an existing list into the portal without accidental duplicates or messages.
- **Current obstacles:** raw CSV is central, several exact header formats are documented, and errors often name several possible invalid fields at once. Maven stable-ID integration is not a current completed workflow.
- **Proposed steps:** choose a supported file/template → inspect a readable preview of people/dates/slots → fix specific row/field problems → understand duplicates as additional records, not updates → explicitly import → see what was created and what still needs setup. Invitations remain a later explicit task.
- **Recovery:** an unknown outcome leads to checking the existing roster before another import. No automatic name/date identity matching or silent header/data repair. A missing Maven/Sheet connector is a held capability, not an instruction to use a nonexistent button.
- **Clear success:** exact record count and quiet outcome are clear; pending tutor proposals do not masquerade as assignments.
- **Related:** UX-11, UX-15, UX-17, UX-18.

## J12 — Family completes and maintains honors

- **Trigger/outcome:** linked parent/admin identifies people for ceremony roles over several visits.
- **Current obstacles:** a long form, repeated names, specialist role terms and unknown Hebrew names; link-management controls add another job inside aliyah groups in current source.
- **Proposed steps:** identify ceremony → see a short section overview → complete a role/group → reuse people already entered deliberately where appropriate → save names → return later to an honest saved/completion summary. Context help explains the role, not the software.
- **Recovery:** changed date/reading/divisions requires review of actual group mapping; never silently move people between aliyot. Unknown Hebrew names are explicitly acceptable. Dirty close offers keep/discard; uncertain saves preserve the original action.
- **Clear success:** names are saved under the correct ceremony and aliyah spans. Names saved does not mean anyone has been invited. Adult self-edit remains a separate held policy question.
- **Related:** UX-10, UX-11, UX-12, UX-13, UX-19.

## J13 — Ceremony date, slot or reading changes

- **Trigger/outcome:** clergy changes a ceremony detail and wants teaching, honors and office information to remain trustworthy.
- **Current obstacles:** reading review flags, honors span review, service catalog changes and roster information are separate surfaces. A user can mistake saving the date for completing all follow-up.
- **Proposed steps:** change the authoritative ceremony detail → see what remains saved and what now needs review → review Torah/haftarah and service parts → preserve/remap actual honors groups deliberately → update the authorized office handoff when that capability exists.
- **Recovery:** show old/current context together; preserve original people/text until an explicit decision. Never infer a morning service or invent a holiday mapping.
- **Clear success:** affected items are individually resolved or clearly marked outstanding. Do not declare the ceremony ready merely because the date saved.
- **Related:** UX-03, UX-04, UX-12, UX-15, UX-18.

## J14 — Prepare a honoree blessing link (deployed controls; activation held)

- **Trigger/outcome:** authorized parent/admin wants to give someone the blessings for one saved aliyah.
- **Current obstacles:** names/ceremony review, Check link record, Create, copy-now URL and replacement/revocation form a procedural journey. A stored record is explicitly not proof of a usable link; creation sends nothing.
- **Proposed steps:** save/review the intended aliyah → see a plain-language readiness/status summary → explicitly create the scoped link → copy and deliberately share through an allowed channel. Explain copy-now behavior before creation. Keep this job distinct from entering names.
- **Recovery:** replacement clearly invalidates the previous link; uncertain action is checked before repeating; leaving cannot cancel a committed action. Material/readiness holds remain holds.
- **Clear success:** user knows exactly which aliyah, whether a link was created, whether it was copied, and that no invitation was sent. This is a proposed usable journey around deployed controls; empty/held material and link state is not recipient readiness.
- **Related:** UX-13, UX-14.

## J15 — Honoree opens their first link (deployed route; no real activated links)

- **Trigger/outcome:** a recipient opens the original private link to prepare their own blessing.
- **Current obstacles:** designed page gives a single scoped reading, but hiding/leaving the tab permanently clears it; the generic “invitation unavailable” message also appears on ordinary app switching. No audio permission follows from text permission.
- **Proposed steps:** open original link → recognize student/date and own aliyah → read Before / After blessings with English and required credits → understand availability/end of session. No account/workspace choice.
- **Recovery:** explain the safe way to return by reopening the original invitation; distinguish a closed viewing session in its guidance without promising recovery, extending expiry or revealing private link validity. If still unavailable, ask the sender for a new link.
- **Clear success:** recipient can prepare only their own blessings. No family roster, other aliyot, booklet download or unapproved audio is offered.
- **Related:** UX-13, UX-14.

## J16 — Print and office handoff

- **Trigger/outcome:** learner needs a reference chart; admin needs a trustworthy saved honors copy; office needs the approved roster.
- **Current obstacles:** chart printing and admin-only saved-honors printing are different destinations. A portal-owned office Sheet is mission-defined but not evidenced as an operating end-to-end surface. Tikkun/practice-sheet scope is not proof of an existing print control.
- **Proposed steps:** choose the existing output by purpose → know what saved/current information it represents → print/read it → return to the previous task. Keep “Saved honors copy” distinct from a live roster. Office staff use their authorized Sheet access, not a new portal role.
- **Recovery:** unresolved ceremony/reading warnings remain visible on the printed honors copy; failed font preparation does not print a misleading chart. Held outputs are described honestly, with no fictitious download button.
- **Clear success:** user knows which output, which ceremony/version and whether review remains. No student recordings, private event history or unrelated account data enters office output. Packet/supplement generation remains out of 1.0.
- **Related:** UX-18, UX-19.

## Cross-journey tradeoffs

- **Fewer steps versus deliberate authority:** hide preparatory mechanics, not real decisions about a person, saved replacement or destructive scope.
- **Convenient return versus private access:** preserve ordinary reading position and drafts while authorized; never promise cross-account, expired-link or delegated-context restoration.
- **Clear defaults versus ceremony variation:** default to known saved details and custom passage selection; unknown dates/slots/holiday practice remain explicit.
- **A unified experience versus different responsibilities:** reuse task vocabulary, but retain parent, student, tutor, admin, guest and office boundaries. No “super dashboard” that blurs who can do what.
- **Reorganization versus new scope:** the main recommendation is navigation, sequencing, language and recovery around current features. Held adult self-edit, honoree activation, office integration and planned print capabilities require separate decisions and cannot be wished into existence by a better menu.

These journeys propose outcomes for the primary consultant's overall recommendation. They do not authorize implementation or reopen Daniel's confirmed visual direction, licensing, spending or release decisions.
