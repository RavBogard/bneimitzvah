# Friday preparation consultation state

Daniel confirmed the [consultant plan](CONSULTANT-PLAN.md) through the mission discussion, numbered alignment questions, and later corrections to the [plain-language plan](PLAIN-LANGUAGE-PLAN.md). Application implementation remains with Claude's active coding stream.

## Confirmed direction

- Default to the whole parashah; allow any desired verse selection. Selections from Claude open directly in Study, with full-portion context easy to reach.
- Independent exploration in the app and common custom readings for leining/drashing are central. A Claude session and a custom study guide are optional.
- Word taps open meaning in Study and hearing in Lein. Meaning and original commentary lead Daniel's preparation.
- Custom study guides are rare, mainly when a rabbi studies with someone. The recommended authoring route is MCP, following Daniel's suggestion; the normal app needs no guide editor or question builder.
- When such material exists, show it beside its verses and in its optional question list. It contains no required introductions or connecting prose and is available to everyone.
- Commentary is English only. Important untranslated sources can receive a credited Claude translation added through MCP.
- Telling Claude to add a discussion publishes it immediately. Accurate attribution and review identity remain required.
- Thinking and writing stay in Claude. Cut the existing personal reader's writing controls; preserve stored work. Add no new notebooks or collection-management workflow.
- Plan owner-authorized Claude access to the person's preparation. Current staff/MCP authority does not reach saved personal work.
- Optional printed original commentary follows the bilingual reading. Keep existing generated student guides secondary to the original-source Study experience.

## Evidence and next action

The plan links current source, Sefaria API documentation, public desktop/phone-width app observations, and the active print branch. Later research inspected Sefaria's live reader and the haftarah live reader plus read-only source at 33c04bc for verse-linked source panels, plain-language word explanations, full-source expansion, and keyboard navigation. Main was reviewed at e63a661, with fa32d86 checked for overlap; print advanced from 391ccfa to db433ab. No fresh authenticated walkthrough or physical-print acceptance is claimed.

Next: the active Claude coding stream reads [CLAUDE-HANDOFF.md](CLAUDE-HANDOFF.md) after current commitments, reconciles against integrated source, and designs common custom readings and independent in-app exploration. Keep occasional curation later in priority. Exact gestures, panel composition, initial source density, and appendix grouping remain recommendations. Reuse the plan; do not repeat the mission interview. The older 2026-10-18 handoff now points here and marks its setup/ownership instructions historical.

Only consultation planning documents were added or updated. No application code, kickoff mission/state files, active implementation plans, branches, tests, or deployment settings were changed. The handoff was prepared for Daniel to give Claude; no message was sent to another task.


## M2b Choose verses (UI)

GATE: Choose verses, Change verses and Whole portion built as one mode of the reading text (verse numbers toggle, words inert while choosing) -- proceeded because the labels are the approved plan's and the rest are minimal literal strings listed in the PR.

GATE: Change verses on a saved reading opens the whole portion (or the chapters the selection spans) so verses can be added as well as dropped; where neither exists the reading's own verses are the only choices -- proceeded because it is routine design inside the plan.

GATE: a selection address is `/read?ref=<portion>&kind=..&mark=<selection>`; the way back is `/read?ref=<selection>`; a saved reading keeps the view in page state and its address stays `?saved=<id>` -- proceeded because it adds one optional query key and no server change.
