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

The voice track runs in parallel with the portal releases. If it hasn't passed G3 when the rest of 1.5 is ready, 1.5 ships without generated chant; M7's code still merges but stays inert. If the Finkel-voice test falls short, there is no studio session: whatever passes Daniel's blind review ships, and otherwise generated chant waits for 2.0.

## Canonical cutover (torah.centralreform.org), outline

The switch can't be made by changing `BETTER_AUTH_URL` alone. `canonicalNavigationEnabled` requires it to equal the hard-coded `CANONICAL_ORIGIN`, and the MCP issuer and resource come from the origin. So one PR changes these together:
- `CANONICAL_ORIGIN` becomes the torah origin;
- the alias list gains beitmitzvah.centralreform.org, which then redirects;
- the origin check in `scripts/release-migrate-support.mjs`;
- the production host row, which 0034 already added.

Then, in the same deploy window:
1. Daniel sets `BETTER_AUTH_URL` in Vercel.
2. Probes confirm sign-in, alias redirects, MCP discovery and email links.
3. Daniel reconnects Claude once.

Preconditions:
- The CNAME resolves.
- Vercel reports TLS valid.
- Google lists the new JavaScript origin and redirect, checked by a live sign-in challenge.

## Order

1. Merge the landing track and apply migrations 0034 and 0035.
2. Build 1.2 and voice M0 in parallel.
3. Merge 1.2 and tag v1.2.0.
4. Build 1.3, then tag it.
5. Build 1.4 with its review, then tag it.
6. Build the 1.5 slices. Make the cutover when the steps are done.
7. Tag v1.5.0 (beta).

The voice milestones proceed alongside throughout.
