# Releases 1.2 to 1.5: execution plan

2026-10-22. Daniel: "proceed to full and independent implementation and deployment of 1.5." This plan carries out:
- the [leyning platform spec](../../superpowers/specs/2026-10-22-leyning-platform-design.md) §6;
- the [voice build plan](../../superpowers/research/2026-10-22-voice/VOICE-BUILD-PLAN.md);
- the 1.5 rulings recorded in STATE.md (2026-10-22, popups).

Each release is merged, deployed, probed and tagged, and gets a STATE GATE line. High-stakes slices get an adversarial pass before merge.

## Tracks

| Track | Branch(es) | Content | Gate |
|---|---|---|---|
| Landing now | PR #28 tikkun columns; PR #29 commentary data; `claude/crc-torah-front-door` | The tikkun menu; `/api/public/commentary` (Rashi, Women's Commentary); the CRC Torah front door; migrations 0034 (host) and 0035 (product name) | CI on all four jobs |
| **1.2** | `claude/study-lens` | <ul><li>The Lein / Study switch: `/read?lens=study`, remembered for adults, with Lein the default for students and signed-out visitors.</li><li>Study verse rows with English on and Rashi inline: English-led, bold dibbur hamatchil, Hebrew on tap, three lines then More.</li><li>The Works menu: Rashi on, plus the Women's Commentary.</li><li>The comment-to-word link (letters only, never guessed).</li><li>"Rashi (n)" in Lein's verse tools.</li><li>Tikkun off in Study.</li><li>Credit at each comment's foot.</li><li>The front door's Study link restored.</li><li>Torah study guides shown in Study for everyone (ruling 8).</li></ul> | Impeccable finish review |
| **1.3** | `claude/shelf` | <ul><li>"More on this verse": curated commentary, midrash, halakhah, Talmud and Targum from Sefaria links, every edition credited.</li><li>Works for Ramban, Ibn Ezra, Sforno and others.</li><li>Compare translations.</li><li>"Any reading" (`/read?ref=`): by parashah, haftarah, holiday or range.</li></ul> | — |
| **1.4** | `claude/accounts` | <ul><li>Account requests.</li><li>The **Member** role.</li><li>**Approver** designation per congregation: any admin approves, and Daniel designates other rabbis and admins as approvers.</li><li>Existing parents and tutors are members automatically.</li><li>Two emails: the request goes to the approvers, and the approval goes to the member.</li><li>My readings, My translation, My notes, starred comments, practice marks.</li><li>The translate drill.</li></ul> | **Adversarial security review** (auth, tenant isolation, saved-data privacy) |
| **1.5 beta** | `claude/learn-to-lein`, `claude/installable`, `claude/sign-in-code`, cutover | <ul><li>Learn to lein: families, this week's occurrences, and hear-and-name. Claude writes the lessons, and they go live at once.</li><li>Recall drills.</li><li>The installable app, with 14-day offline reading and reference audio. PocketTorah clips are never encrypted (CC BY-SA).</li><li>The typed sign-in code.</li><li>The canonical switch to torah.centralreform.org, once the [forwarded steps](../2026-10-22-crc-torah-cutover/FORWARD-STEPS.md) are done.</li></ul> | Auth review for the code; cutover plan below |
| **Voice** (to 1.5 beta) | `claude/voice-m0`, then off-repo work in C:/private/voice-pilot | <ul><li>M0: guards, the `voice/` folder and the engine timing files.</li><li>M1: Experiment 1. A kill means stop for good.</li><li>M2–M6.</li><li>M7 portal integration: the generated source, live key shift, the label, and report-a-mistake for signed-in people. Everyone hears it after G3.</li><li>M8 operations.</li></ul> | G3: Daniel's blind sample. Production refuses generated audio until the approved release-identity hash is in env. |

**Daniel, 2026-10-22: "Those all come before the voice generator work."** He briefly put voice before the offline app, then confirmed "Voice goes last". The voice track waits until 1.2 to 1.5 are released, the offline app and sign-in code included. M0 is paused at a clean point on `claude/voice-m0` (worktree C:/Users/dsbog/bneimitzvah-chant, still at c15fc45, nothing written in the repo). Done off-repo: uv 0.13.5 installed; DiffSinger v2.5.1 plus cherry-picks 920ba91 and 8a07f76 (tree 2bd40c4, to be pinned by tree hash), MakeDiffSinger 1edcd66 and SingingVocoders 4d0889c cloned to C:/private/voice-pilot/src with licences recorded; two patches with author emails withheld in C:/private/voice-pilot/patches. Resume at M0 Part A step 1: verify the patches reproduce tree 2bd40c4, then the `voice/` files, guards, exit tests and engine timing files. Run DiffSinger from a `git archive` copy at C:/private/voice-pilot/DiffSinger, because a clone is itself a Git tree. Afterwards, if it hasn't passed G3 when the rest of 1.5 is ready, 1.5 ships without generated chant; M7's code still merges but stays inert. If the Finkel-voice test falls short, there is no studio session: whatever passes Daniel's blind review ships, and otherwise generated chant waits for 2.0.

## Canonical cutover and the 1.5 installable slices

The full design is in [2026-10-22-installable-sign-in-code-cutover](../../superpowers/plans/2026-10-22-installable-sign-in-code-cutover.md). It supersedes the earlier outline here in two ways:
- **Two hard-coded origins chosen by the env var.** A code PR, inert when merged, lets `BETTER_AUTH_URL` select beitmitzvah or torah. The switch is then Daniel setting the env var and a redeploy, and rollback is the reverse. This removes the 503 window.
- **`scripts/release-migrate-support.mjs` stays unchanged.** It is pinned to its release base and checks the beitmitzvah host row, which stays.

**Order within 1.5:**
1. The typed sign-in code (Better Auth `emailOTP`, no migration, auth review).
2. The two-origin code PR.
3. The switch window, after FORWARD-STEPS is done, with the runbook's preflight probes.
4. A1, the installed app: worker, manifest, This week offline, purge on sign-out. Registration is gated to the torah origin, so it must not reach devices before the switch.
5. A2: assigned and saved readings offline. Depends on 1.3's ref routes and 1.4.

**Wording for Daniel before A1 and B ship** (one popup when those slices are ready):
- the sign-in email's code lines;
- the install and offline copy;
- the app icon;
- whether parents' child-practice view goes offline (recommended: not in 1.5).

## Order

1. Merge the landing track and apply migrations 0034 and 0035.
2. Build 1.2.
3. Merge 1.2 and tag v1.2.0.
4. Build 1.3, then tag it.
5. Build 1.4 with its review, then tag it.
6. Build the 1.5 slices. Make the cutover when the steps are done.
7. Tag v1.5.0 (beta).
8. Then the voice track resumes from M0.
