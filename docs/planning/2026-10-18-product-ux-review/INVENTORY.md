# Product surface inventory

Consultant inventory, 2026-10-18. The product goal is to help a student prepare their assigned reading and service, help a family prepare their part, and help staff guide that preparation. “An ordinary iPhone user” means someone comfortable with familiar taps, lists and forms, without requiring software vocabulary or reference syntax.

This is an inventory of the existing product and its boundaries, not a proposed navigation structure or an implementation plan. Root owns the proposed information architecture and priorities.

## What is actually available

The source baseline is release commit `3f1c357d7ebadb2419e50196145ad1f5625dddcc` in the recording-media-transport checkout. The newer **Final release accepted** section of HONOREE-RELEASE-RETURN records this exact source deployed and the honoree database change applied. It supersedes the older production and preparation paragraphs still in STATE. This inventory relies on that recorded release evidence; it does not independently establish that every authenticated production journey works with real content today.

Status terms used below:

- **Released surface:** present in the recorded deployed source. Its actual content and the person's permissions can still make it empty or unavailable.
- **Released foundation, use held:** the interface/transport exists, but material approval or activation prevents claiming a usable real journey.
- **Separate local checkpoint:** evaluated work outside the released baseline.
- **Planned/parked:** a mission requirement or retained prototype, without an ordinary usable surface found in this baseline.

The important distinctions are:

| Area | Current product status |
| --- | --- |
| Sign-in, role workspaces, assignments, study tools, staff management | Released surfaces; ordinary users remain limited to their authorized relationships. |
| Family honors | Released for base guardians and administrators. Adult students editing their own honors remains held. |
| Reference listening | Reading/player interface exists, but current state records student release held for Daniel's real-source listening and phone acceptance. A visible Start/Hear control is not evidence of released student audio. |
| Honoree blessing links and guest landing | Released foundation. The accepted release records empty material/link/operation tables and no issued real links. Real guest use awaits the separate approved-material activation. |
| Simplified date-assisted reading editor | Separate locally accepted checkpoint in the reading-assignment-flow checkout. The released baseline still has the earlier selection-method/custom-reference editor; the new canonical selectors are not in this baseline. |
| Maven, owned roster Sheet, MCP, congregation settings/onboarding | Mission scope; no ordinary user-facing routes located. Planner or operator groundwork is not an available integration journey. |
| Generated chant and student recording upload | Parked outside the revised1.0 release. Retained code or old plans do not make these active product features. |

## People and access boundaries

| Person | Main purpose | Existing authority and important limits |
| --- | --- | --- |
| Student, child or adult | Know the assigned passage, practice it, study words, write a translation and review teacher guidance. | Own authorized readings and work. Student self-checks differ from tutor assessments. No general chatbot. Adult status does not currently unlock self-editing family honors. |
| Parent/base guardian | Follow a linked child's preparation and organize family participation. | Parent dashboard is read-only for study work, with the family-honors exception. Child practice is an explicit per-tab switch. Contact details or a copied child URL do not grant access. |
| Parent in child practice | Help a specifically selected child practice using that child's permitted tools. | This is a separate selected mode, not tutor authority. Sibling choice and return to parent view are explicit; another tab retains its own choice. |
| Tutor | Prepare assigned students, assign readings/sources/service parts, assess verses and keep lesson notes. | Assigned students only. Tutor access does not imply access to private family honors. |
| Rabbi/administrator | Manage student records, people, invitations and preparation across the congregation. | Explicit access management and reviewed changes. A roster contact is not an account grant; imports send no invitations. |
| Invited honoree | Read the before/after blessings for their own aliyah without creating an account. | Separate private expiring/revocable bearer link. No other family's information, participant names, full booklet or audio. Real use remains held by activation. |
| Visitor/signed-in account with no role | Sign in, accept the appropriate invitation or get help obtaining access. | Authentication alone does not establish a congregation role or linked-student authority. |

## Entry, account and route inventory

The App Router contains **17 page routes and three additional user-facing landing handlers**. Layouts and API endpoints are not counted as separate product screens. Dynamic student identifiers describe one route pattern, not one page for every child.

| Existing route | Person and starting point | Intended end state and important alternatives | Status |
| --- | --- | --- | --- |
| `/` | Visitor opening the portal or returning from email. | Choose Google or email sign-in; a sole student role enters the student's reading automatically. Multiple roles lead to a deliberate workspace choice; no role explains how to obtain access. | Released surface. |
| `/sign-in` | Signed-out or expired-session recovery; authentication-error return. | Start a fresh sign-in, with a clear failure/retry state when the prior attempt could not be verified. | Released surface. |
| `/auth/email` | Person opening the original emailed sign-in link. | Confirm continuation using the link, then establish a session. Invalid/expired/altered links must fail safely. Secret transport is not a reusable ordinary page URL. | Released landing handler. |
| `/account` | Account link from a workspace. | See current available roles and sign out. Unlike the home entry, it does not automatically take a sole student role away from account controls. | Released surface; no editable profile/preferences screen located. |
| `/invitations/open` | Recipient opening the original invitation email. | Continue into the reviewed invitation flow without automatically granting access. | Released landing handler. |
| `/invitations/accept` | Signed-in invited recipient. | Check role/student, explicitly accept, then continue to the portal. Wrong account, expired/revoked/changed invitation and uncertain outcome have their own recovery states. | Released surface. |
| `/workspace` | Signed-in person following a generic workspace link. | Choose an available role; a sole student role proceeds directly to reading. A no-role account is told to use its invitation or seek help. | Released surface. |
| `/workspace/student` | Authorized student. | Open the selected assigned reading and its practice/study tools; understand what to do if nothing is assigned. | Released surface; listening remains separately gated. |
| `/workspace/parent` | Parent using their own account. | Choose a linked child, see their preparation, open Family honors, or explicitly enter child practice. | Released surface. |
| `/workspace/practice/[studentId]` | Parent explicitly choosing child practice in this tab. | Practice as that selected child, switch to a linked sibling or return to the parent view. A copied/reloaded route without the required selection returns to choosing a child. | Released surface. |
| `/workspace/tutor` | Tutor starting a teaching session. | Choose an assigned student. Loading, empty assignment list and unavailable list have explicit states. | Released surface. |
| `/workspace/tutor/[studentId]` | Tutor choosing a student card or returning to a focused student page. | Work through Reading, Service parts and Lessons for that student. An unavailable relationship cannot retain the previous student's material. | Released surface. |
| `/workspace/admin/students` | Administrator starting roster work. | Search/open a student, add/edit a record, open honors, import, or move into preparation and people management. Empty/search-miss/disabled/conflict/unavailable states are distinct. | Released surface. |
| `/workspace/admin/students/[studentId]/reading` | Administrator opening a student's page. | Guide that student's Reading, Service parts and Lessons; follow People and access for that same student. | Released surface. |
| `/workspace/admin/students/[studentId]/access` | Administrator managing a student's people. | Understand current tutors, parent links and student identities; review assignment, unlink/revocation, invitations and disabling choices. | Released surface. |
| `/workspace/admin/tutors` | Administrator managing congregation tutors. | Understand tutor role availability and assignments, with reviewed role/access changes. | Released surface. |
| `/workspace/admin/invitations` | Administrator inviting a parent, student or tutor, or reviewing prior invitations. | Review a specific recipient/role/student before sending; inspect, replace or revoke existing invitations. Sending, acceptance and usable access are distinct states. | Released surface; no bulk/automatic mail implied. |
| `/workspace/admin/students/import` | Administrator bringing in a roster file. | Select/edit CSV, preview valid/problem/duplicate rows, then explicitly import reviewed student records. Contacts and tutor proposals do not silently create access. | Released CSV surface. No live Maven/Sheet interface located. |
| `/trope-chart` | Person following the chart link, including outside an authenticated workspace. | Find trope names/phrase families and use the printable chart. Return to workspace is available. | Released public reference page. |
| `/honoree` | Recipient reopening their private original blessing link. | See only their assigned aliyah context and before/after blessing text with English and credits. Invalid, expired, revoked or unavailable material produces one nonrevealing unavailable state. | Released landing foundation; real material/link activation held. |

## Important surfaces inside those pages

| Surface/task | How a person reaches it and knows they have finished | Product states and limits that must survive reorganization |
| --- | --- | --- |
| Role/account navigation | Available roles in entry or workspace header; Account for sign-out. | A role switch changes authority; it is not merely a visual tab. Sign-out failure must remain honest on shared devices. |
| Reading overview and Torah/haftarah choice | Student or chosen child/student opens an assigned reading; selects the reading kind. | Date/countdown, exact passage and assignment status. No-assignment, missing text, changed assignment and denied access are different situations. Torah and haftarah both remain in scope. |
| Hebrew reading and English reference | Flowing Hebrew in the main reading, with optional English and adjustable size/color. | Vowels/cantillation, qere/ketiv and real section boundaries matter. Missing English is explicit; another edition must not silently replace the chosen reference. No visible transliteration. |
| Direct listening | Start/Hear, a word, or a verse number; controls for playback, selected word/verse practice, looping and speed. | Reference provenance and correct word timing are required. Player availability is separate from text availability. No claim that the visible interface means student release or real listening acceptance. |
| Optional verse close-up | A verse's up-close action. | A supporting study view; never a compulsory preliminary step for main-reading listening. Closing should return to the originating reading. |
| Word tools | Word tools beside the reading, selected word, previous/next word, Hear this word. | Hebrew syllables/stress; occurrence meaning, grammar and dictionary senses. Partial/unavailable word aids are honest. This is not proof of every dictionary or “this word elsewhere” capability. |
| Translation drafts | Your translation & notes → My translation. | Student/child-practice editing and explicit saves; staff/parents read saved work. Draft, saved, conflict, changed assignment, history and unconfirmed save must be distinguishable. |
| Teacher guidance on a verse | Translation & notes → Student-visible notes / Notes from your teachers. | Authorized staff author notes; learners read them. Attribution/history and earlier-assignment context prevent an old note being mistaken for new work. |
| Sources/commentary | Sources under the relevant verse; assigned sources first, then related browsing and Read source. | Staff choose/save assignments; families browse/read without assigning. Content reading has explicit work/edition/extent selection and missing content. Narrow supported content extents do not mean all source types/rights are covered. |
| Verse progress | Marks alongside verses and in verse study controls. | Student Still working/Got it differs from tutor Not started/Working/Solid. Parent observation is not staff assessment authority. There is no leaderboard. |
| Practice calendar | Quiet week strip and Practice calendar disclosure near the reading. | Days practiced and month navigation; other people receive appropriate bounded practice information, not detailed cross-student activity analytics. |
| Reading assignment | Staff Change/Assign verses opens a sheet. Review exact assignment, explicitly confirm, then see the authoritative saved assignment. | Released editor uses selection method/reference input and optional calendar preparation/preview. Retain ordered multi-range references, Torah aliyah divisions, cut-only provenance, calendar uncertainty and no automatic replacement. New date-first native selectors are a separate local checkpoint. |
| Staff Hebrew preview and verse selection | Inside the assignment editor. | Preview a whole portion/custom range, choose start/end and stage verses or boundaries. Previewing is not assigning; only confirmation changes the saved assignment. |
| Service parts | Learner service section or staff Service parts tab. | Read assigned units in source order with credits. Staff choose catalog units and review/confirm. Unknown service slot, unavailable catalog, withdrawn material, stale plan and an empty plan have different meanings. Real catalog/media availability was not freshly observed in this review. |
| Lessons | Staff Lessons tab; family's lesson notes area. | Staff add/edit/delete a dated lesson summary; family reads it. No hours, billing or scheduling function. Draft and changed/deleted/uncertain states need clear recovery. |
| Student record sheet | Admin Add student or student details. | Child/adult, ceremony date, service slot and relevant contact details. Unknown slot is explicit. Creating a contact record does not invite or grant access. |
| People and access | Student page → People and access; Tutors at congregation level. | Assign/unassign existing tutors, link/unlink people, review role revocations and disable a student. Relationship removal and revoking a person's role are consequentially different. |
| Family honors | Parent selects child → Family honors; admin roster honors action. | Opening/closing ark, generation to generation, undressing/redressing Torah, actual aliyah groups, English/Hebrew names and parental blessing logistics. Unknown names can remain blank; multiple participants and ordering are supported. Save honors is explicit. |
| Honors review and recovery | Same family-honors sheet after date, reading or span changes, or interrupted saving. | Reconcile actual aliyah spans and review ceremony changes. A saved form is not a confirmed reading; an unconfirmed save may have succeeded. Tutor and child-practice views do not acquire family-form access. |
| Saved honors printing | Administrator's saved honors form → Print saved form. | A fresh verified saved version is printed, with review warnings when applicable. The draft has no print path. No general assigned-reading print workflow was located. |
| Blessing-link management | A saved, reviewed aliyah in the authorized family-honors sheet. | Check record; create once and copy now; replace/revoke after confirmation. Creating a link does not send mail. A recorded link is not proof it is currently usable. Old aliyah records, unavailable material and uncertain original actions require truthful states. |
| Honoree guest reading | Private original link outside the account workspace. | Own aliyah only; before/after blessings, English and required credits. The link's fragment is cleared. The current guest surface clears private content when backgrounded/frozen or expired; reopening the original invitation is the recovery path. No blessing audio is approved here. |
| Printable trope chart | Trope chart → print action. | Public invented-letter examples and phrase-family guidance, with licensing/credit information. This is distinct from a personalized practice-sheet print feature. |
| Global loading, access and departure recovery | Any role surface on expiry, revoked relationship, controlled navigation or unsaved work. | Quiet unchanged reading return should retain context. True loss of access removes private content. “Unsaved,” “saved” and “may have saved” cannot be collapsed into one reassuring message. |

## Requirements without a complete ordinary journey located

These are omissions from the usable-surface inventory, not instructions to build them during this review.

| Requirement or anticipated area | Current assessment |
| --- | --- |
| Congregation settings, default source choices and onboarding | Confirmed scope in mission/product context; no corresponding user-facing settings/onboarding route located. Exact administrator workflow still needs definition. |
| Read-only Maven import and owned roster Sheet | Stable-ID/planner groundwork is recorded, but no live ordinary management journey was found. CSV is the actual existing import screen. Never infer live provider synchronization from a plan. |
| MCP operations | Product requirement/integration work, without an end-user page or complete ordinary operator journey established by this surface review. |
| Main-reading translation edition picker | English visibility exists; richer edition selection is not established for the main reading. Source-content edition selection is a different feature. |
| Full BDB/word-elsewhere/commentary breadth | Existing word facts/dictionary and related-source tools are real subsets. Broader coverage and source rights remain incomplete. |
| Tikkun, personalized printable practice sheets and trope-family drills | Mission/product requirements or historical plans, but no complete ordinary dedicated journey located in current portal routes/components. The public chart is not a substitute for all three. |
| Ear-first learning preference and independent pitch adjustment | Ear-first is a product direction; no dedicated preference journey found. Pitch adjustment remains deferred pending reliable speed/alignment. |
| Student reference listening release | Real-source timing/listening and Daniel's phone acceptance remain separate gates. |
| Real honoree material activation | Narrow booklet text permission is recorded; separate owner-only activation remains required. No approved audio sharing. |
| Adult honors self-edit | Policy decision remains held; do not portray the guardian form as available to an adult student automatically. |
| Student recording upload/submission and generated chant | Parked. Do not bring their prototypes or old release requirements into the current primary journey. |
| Offline/PWA, digests, reminders and other notification extras | Follow1.0. No generic private caching or ordinary notification-preference journey is established here. |
| Second-congregation provisioning | Tenant protection exists, but actual second-tenant onboarding needs Daniel; no self-service congregation setup should be assumed. |

## Permission and content constraints for a product redesign

Reorganizing the same features may simplify the navigation, but it must preserve the difference between a student record, a contact, a role and a linked relationship. Parents still need to select a child; tutors remain limited to assigned students; private honors remains guardian/admin work; staff review and explicit confirmation still precede consequential assignments or access changes.

Material availability is also part of the experience. Missing reference audio, unavailable source editions and a blessing whose material has not been activated cannot be represented as complete lessons. The honoree permission is limited to CRC's own invited recipient, own aliyah, before/after booklet text, English and required credits. It does not authorize publishing the booklet or sharing its audio. Licensed translations, real families and recordings must not enter these documentation artifacts.

Source references and the practical research needed to turn this inventory into a validated product plan are in [EVIDENCE.md](EVIDENCE.md).
