# Claude UX return

Branch `claude/product-ux` in its own worktree (`C:/Users/dsbog/bneimitzvah-ux`), started from main `3f1c357`. Not pushed, merged or deployed: the integration stream owns that. No schema, auth, permission, token, provider or server-contract change in any milestone. The only server file touched is `src/server/http/honoree-landing.ts`: an inline presentation-script change to the guest page's wording (milestone 5). It is not a backend permission change; fragment/body transport, clearing, expiry/revocation, concealment and no replay/storage are unchanged.

Final commit for this checkpoint: the latest commit on `claude/product-ux` that updates this note (the one after `Describe a stored blessing link by its recorded expiry…`).

## Commits, oldest first

| Commit | Milestone |
| --- | --- |
| `f6399e0`, `29b1c45`, `e47263a` | Undeployed reading candidate, cherry-picked with `-x` |
| `39364a4` | 1 · Reading assignment |
| `813c554` | 3 · Roster keep/discard (UX-10) |
| `fbe1b8e` | 2 · Context and navigation, and the first return note |
| `592567b` | 4 · Student setup and access |
| `ea7c8d7` | 2 follow-up · e2e titles for the product name |
| `f71535f` | 5 · Honors, blessing links, guest recovery; UX-11 recovery wording |
| `d2ecce4` | 5 · Who arranges honors, for students (UX-19) |
| `272d908` | 6 · Service parts, notes, sources, print |
| (next) | Integration stream's `BACKEND-COORDINATION.md`, kept unchanged in its own commit |
| (next) | Blessing-link copy: recorded expiry and "no current link is recorded", per the integration review |

## 1. Reading assignment — UX-03, V03–V04

- Reuses the candidate and finishes the journey it left open.
- Ceremony date and service are shown in words and reused. The date's reading appears as "Suggested for this service" with its reason, or the existing honest fallback when a suggestion would be unsafe.
- Passages:
  - Every plain passage gets book / chapter / verse pickers.
  - **Add another passage** and **Remove passage N** make multi-range readings ordinary.
  - Typed references remain under Advanced and are never flattened.
- **Divide into aliyot (optional)** picks each aliyah start from the chosen verses. If the verses change and the divisions no longer fit, they are shown as a mismatch with **Start divisions again**; they are never dropped silently.
- One review lists ceremony, verses, aliyot and what it **Replaces**. **Save assignment** then says what the student will see.
- A date-change flag shows a notice and replaces nothing.
- An uncertain save offers **Check what saved** and never retries automatically.

## 2. Context and navigation — UX-02, UX-05, UX-06 (partial UX-01)

- One product name, CRC Beit Mitzvah, on the entry page, page titles and trope chart.
- The account page says what each role link is for.
- Parents see "Read-only overview" and a **Practice with [child]** action. In practice, switching to another child sits above the reading.
- **Practice up close** and **Close-up** replace Start and Hear, so no label promises audio.
- Single-role auto-continue (UX-01) was not done; see the decisions section.

## 3. Predictable editing — UX-10, UX-11

- Student details now ask **Keep editing / Discard changes** on X, Cancel, Escape, controlled navigation and page unload, like lessons and honors.
- Recovery wording is unified (UX-11, completed in milestone 5):
  - Every uncertain save in reading, import, honors, blessing links, verse tools, sources, progress marks and service parts leads with **Check what saved**.
  - The exact resend stays as a secondary action: **Send the same save again** / **Send the same request again**.
  - The messages say the save may have succeeded and that nothing is sent twice automatically.

## 4. Student setup and access — UX-15, UX-16, UX-17; V09–V10

**People and access** opens with a **Setup** summary:
- Tutor, accepted family access and student sign-in, each shown as Done / To do / Optional with its next step.
- It says that a saved email and an unaccepted invitation are not access.
- It links to Invitations and to the student page where the reading is assigned.

Removal scope:
- The ordinary row action is **Remove from [first name]**.
- Removal across the congregation (**Remove as a tutor/parent/student**) is in a separate, closed section.
- Every review states its scope ("Changes access to X only" / "across the whole congregation") before the consequence.

Invitations and the roster:
- Invitations read **Not accepted yet** until accepted. The list says an invitation isn't access.
- Adding a student says no invitation was sent and points to People.

Import:
- The page leads with a **Download the template** link and plain required-column guidance. Other layouts and limits sit under Advanced.
- A client-side helper (`csv-import/hints.ts`, unit-tested) works as follows:
  - It mirrors the server rules to name the columns to fix in each refused row, without echoing cell values.
  - It explains a bad header, a byte-order mark or broken quoting before anything is sent.
  - The server preview stays the authority.
- Duplicates say that a second record would be created and nothing merged.
- An uncertain import offers **Check what saved**.

## 5. Honors and guest recovery — UX-12, UX-13, UX-14, UX-19; V11–V13

Honors form:
- A section overview shows what each part holds ("2 people", "1 of 3 named", "Not decided") and jumps to it.
- Closing the ark offers **Add the people who opened the ark**. This copies the names as new entries; nothing is linked.
- Dates and service read in words. The intro says saving part of the form and returning later is fine, and that Hebrew names are optional.
- Real aliyah groups, changed-ceremony review and saved-version printing are unchanged.

Blessing links:
- The copy says nothing is sent, the person shares the link themselves, and the full link is shown once.
- A stored link is described as the current recorded link, with its recorded expiry. It "can't be shown again; replace it to get a new one", and the record "doesn't confirm the link opens or that the blessings are ready". When there is none, the controls say "No current link is recorded for this aliyah", which stays true after a revocation.

Guest page (`src/server/http/honoree-landing.ts`):
- After an app or tab switch it now reads "Your blessings were closed for privacy" and says leaving doesn't cancel the invitation and the original link opens it again.
- Refusal, timeout and expiry keep the general wording. The first cause is kept, so a later abort can't overwrite it.
- Unchanged: token handling, concealment, clearing paths and expiry.
- Review:
  - A second agent reviewed this adversarially and confirmed the guest read path never consumes a link.
  - It also caught an e2e expectation, which was fixed.
- Known limit, left alone because changing it would touch access logic: a link first opened in a background tab still shows the general wording.

Students now see a short **Family honors** note saying their family or the congregation office arranges honors, and that names go through the office (UX-19). Adult self-editing stays held.

## 6. Study, service and output coherence — UX-04, UX-07, UX-08, UX-18

- **Service parts:**
  - **Review service parts → Check before saving → Save service parts** replace the prepare/confirm wording.
  - "Discard choices and start again" replaces "Reload catalog and discard draft".
  - Results state what the student has now.
- **Notes:**
  - Staff see **Teacher notes** ("The student can read these notes.") beside Student translation; learners keep My translation / Notes from your teachers.
  - Lessons use **Add lesson note** and keep their existing audience line.
- **Sources:** an unavailable format or edition is described as a limit of this site, not the reader's mistake. **Back to the verse** replaces Close source.
- **Print:** the honors button names the saved version. The printout says later changes aren't included and that the office makes corrections.

## Verification (final state, `272d908`)

- Private disposable Postgres in WSL (port 56817) and the repo's isolated browser server. No shared database and no production data.
- `npm run typecheck`: passes. Engine `node --test`: 357 pass. App Vitest: 1,743 pass, 1 skipped, including new tests for the CSV hints, access scope and guest-page wording. `npm run check:repo`: 3 pass.
- Full http-browser suite after a fresh build: 40 files, 184 tests pass, 3 skipped.
- Playwright e2e (`npm run test:e2e`, after a fresh `npm run build`): 30/30.
- Updated tests follow only deliberate wording changes, plus three behaviour updates:
  - roster Escape now asks before discarding;
  - congregation-wide removal sits in its own section;
  - the guest page has separate departure wording.
- Synthetic desktop and phone captures, in both light and dark, were inspected locally in the ignored `.impeccable/review/` folder. This is Chromium emulation only, not iPhone/Safari or VoiceOver acceptance.

## Dependencies and decisions for the integration owner / Daniel

- **Test wording conflicts:** expect conflicts if `codex/reading-assignment-flow` or other branches that edit these browser tests merge separately. Take this branch's labels.
- **Clearing a date-change flag:** there is no ordinary "keep this reading" action. Adding one is a server-contract decision.
- **Single-role auto-continue (UX-01):** deferred, because the portal privacy tests depend on the signed-in entry page.
- **Product name outside the UI:** the auth app name, the invitation email subject and the magic-link landing title still say "CRC B'nei Mitzvah" (`src/server/auth/factory.ts`, `src/server/mail/transport.ts`, `src/server/http/fragment-landing.ts`). These are server and provider surfaces owned by the other stream.
- **Not done in these milestones** (each is larger than a presentation change):
  - showing saved service parts and choices on entry without a load step (UX-04);
  - moving blessing links into a step separate from entering names (UX-13);
  - listing readable source editions first (UX-08);
  - telling an adult student their honors status specifically (needs student kind on the student view);
  - per-student pending invitations in Setup (needs an invitation filter by student).
- **Release holds:** adult honors self-editing, reference-audio release and real material/blessing activation all stay held. UX-14 is addressed in wording but should still be validated on a real phone before real honoree activation.
