# Finish Cantor Finkel's recordings: plan and production steps

2026-10-22. Branch `claude/finkel-finish`. Authority: MISSION, "Amended 2026-10-22 (Daniel, Cantor Finkel's recordings)": licence done, all recordings unrestricted; finish private storage, playback beside PocketTorah and the listening review; recordings never enter the repository; student playback of any reference audio still follows Daniel's listening acceptance. Daniel approved this finish plan on 2026-10-22 ("Approved. Do it and continue").

The engineering lead performs every production step below (upload, environment, deployment) after the adversarial review. Nothing in this branch uploads, migrates or changes production.

## What the package holds (counts only)

The private prepared package (off-repo, outside every Git working tree) has 322 clips, each a lossless master plus a 64 kbps mono MP3. 265 passed the producer's machine verification; 57 are held. Hashes and full decodes were independently verified on 2026-10-20.

| Kind | Clips | Machine-passed | Of which plain chant / plain spoken |
|---|---:|---:|---|
| Torah | 227 | 190 | 97 chant, 49 spoken (rest are drills; 18 of the chant are "faster" variants) |
| Haftarah (prophets) | 63 | 49 | 31 chant, 10 spoken |
| Megillah | 12 | 12 | not a portal reading |
| Service parts and blessings | 19 | 13 | Torah and haftarah blessings, Kiddush, K'dushah, L'dor vador, Ahavah rabbah |
| Trope instruction | 1 | 1 | |
| Total | 322 | 265 | |

Distinct verses the package lists: Torah 272, prophets 131, megillah 8.

## What plays in this release

The build script selects machine-passed, plain chant or plain spoken clips of one Torah or haftarah passage, at normal tempo. That is **167 clips**:

| | Clips | Distinct verses covered |
|---|---:|---:|
| Torah chant | 79 | 193 |
| Torah spoken | 49 | 164 |
| Haftarah chant | 29 | 82 |
| Haftarah spoken | 10 | 44 |
| All | 167 | Torah 228, haftarah 99 |

- 152 are the producer's recommended default for their passage, mode and tempo ("preferred"); students hear only these. Admins also see the 15 other takes, labelled "other take", for review.
- 32 clips are a single verse; the rest are passages of 2 to 12+ verses.
- 215 minutes, 103,363,643 bytes. The largest clip is under 4 MiB, so every clip fits one function response (4.5 MB limit) without range requests.
- Left out for now: 51 held scripture clips, 52 drills, 20 faster/slower variants, 12 megillah, 19 service parts and the trope anthem. Service parts and drills are follow-ups (below).

## How clips map to portal verses

Each clip declares canonical `Book c:v` refs, the same form the portal uses (validated against the portal's Tanakh verse table: one book, strictly forward, Torah books for Torah, prophets for haftarah). A clip is offered on any reading page that shows at least one of its verses. A clip is never cut, stitched or mixed with PocketTorah inside one playback.

## Timings: none exist, none are invented

- **Word timings: none.** The package has no validated phrase or word timing for any clip.
- **Verse boundaries: candidates only.** 243 clips carry ASR-derived verse-boundary candidates; 36 passed the producer's own boundary check; none is validated. They are not used.
- **PocketTorah's word-timing path** was CTC forced alignment (wav2vec2 espeak at a pinned revision, driven by the trope engine's phone packs), run off-repo. Reusing it for Finkel means installing PyTorch and the model privately, aligning 215 minutes, and then a timing review, because Daniel found PocketTorah's own computed boundaries inaccurate on 2026-10-18. That is a separate, reviewed step, not part of this release.

So Finkel plays **whole passages** with loop and pitch-preserving speed (0.5x to 1.25x), and the passage's verses are marked in the reading while it plays. There is no word highlighting. The 32 single-verse clips are true verse-level playback.

## Preferred over PocketTorah, and the one place it is not

Where a page has Finkel coverage, a "Cantor Finkel" player appears first, above the PocketTorah verse player, with the credit "Chanted by Cantor Josh Finkel" (chant) or "Read by Cantor Josh Finkel" (spoken). Tapping a verse or word in the reading still plays that single verse through PocketTorah, with word highlighting: Finkel has no verse timings, so a tap on verse 3 cannot honestly play verse 3 from a passage clip. One shared coordinator keeps one voice at a time; a verse tap stops the passage and Play stops the verse.

## Release hold and access (high-stakes boundary)

- **Same hold as PocketTorah, plus Finkel's own switch.** Students hear Finkel only when the existing `REFERENCE_AUDIO_STUDENT_RELEASE` is `true` **and** the new `REFERENCE_AUDIO_FINKEL_STUDENT_RELEASE` is `true`. The second switch exists because MISSION ties student playback to Daniel's listening acceptance, which may come at different times for the two sources; it can only hold Finkel back, never release it ahead of the shared hold. Until both are `true`, only a live admin grant in admin mode can list clips or fetch bytes; student, parent and tutor modes get 404 before any database or storage read. After release, students, parents (including linked-child practice, sent as parent mode) and tutors hear the preferred takes; the full list and the other takes stay admin-only.
- **Clips Daniel holds back.** The listening verdicts are not read at run time. Before the Finkel release, the lead rebuilds the manifest with `--hold <file>` listing the asset IDs Daniel marked needs-work; held clips leave the manifest entirely, so no route can serve them.
- **Two authorization passes.** Every list and media read verifies the session, CRC tenant, membership and role grant, does the provider work, then re-authorizes and requires the same session, grant revision and authority revision. CRC only: another congregation's members get 404.
- **Private bytes, server-side only.** Media is read from the existing private Blob store through the reviewed private getter (native request OIDC, path allow-list `reference-review/finkel/v1/{manifests,audio}/<sha>`, no URL, token or override fallback). The whole file is buffered, its length and SHA-256 checked against the pinned manifest, then returned `private, no-store`, `no-referrer`, `nosniff`, no CDN cache, no Range. The browser checks length and SHA-256 again before playing. No client ever sees a Blob URL or key.
- **Pinned manifest.** `REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256` pins the content-addressed manifest. Without it every Finkel route answers 404 and the reading page shows nothing.
- **Honoree links** never touch these routes.
- **Repository.** No recording, catalog, manifest, title, label, source ID or local path is committed. The repository guard now also treats `finkel-prepared-catalog/v1`, `finkel-reference-manifest/v1` and `finkel-reference-upload-plan/v1` JSON as private data, with tests.

## For the listening review (claude/listening-review)

The provider is source-agnostic; the listening page can use it without new server work:

- `GET /api/reference-audio/finkel/clips?mode=admin` lists every clip: `{ schema: "finkel-clips/v1", source: "finkel", pin, clips: [{ asset, kind, mode, verses, sha256, bytes, durationSeconds, preferred }] }`. Add `&from=<ref>&to=<ref>` (one book) for the clips touching a verse range.
- `GET /api/reference-audio/finkel/media/<sha256>.mp3?mode=admin` returns the verified bytes.
- Client helpers: `fetchFinkelClips` and `fetchFinkelAudio` in `src/components/portal/workspace/study/finkel-api.ts`, and the `FinkelPassagePlayer` component.
- Verdict columns: `source = "finkel"`, `source_pin = pin` (the manifest SHA-256), `asset = clip.asset` (`fj_` plus 20 hex), which match migration 0034's checks.

## Cost

Vercel Blob rates (unchanged since the 2026-10-17 spend notice): storage $0.023/GB-month; playback through the portal function counted at $0.17/GB (Blob transfer plus origin legs, conservatively charging every read).

- Storage: 0.103 GB = **$0.0024/month**.
- Upload: 168 create operations, well under a cent.
- Playback, 34 students, 20 days a month: 10 minutes a day = 3.3 GB = **$0.55/month**; 30 minutes a day = 9.8 GB = **$1.66/month**. Daniel's admin review of all 215 minutes once is about 0.1 GB, two cents.

This sits inside the approved $5-8/month media target together with PocketTorah's existing delivery.

## Adversarial review

The dan-auditor pass returned GO-with-fixes: no student, parent, tutor, guest, anonymous or other-congregation path reaches Finkel metadata or bytes before release; private Blob access stays server-side; never-in-repo holds. Fixed after it: a test fixture that shadowed the access service (already fixed in the pushed commit), Finkel's own release switch, the `--hold` rebuild, CLI boolean flags removed, Play disabled while the view is inactive, verse marking cleared on any pause, exact pre-release denial statuses, coordinator tests for the two new slots.

## Production steps (lead only, in order, verify after each)

No migration is needed: the provider pins a content-addressed manifest, like PocketTorah's. Migration 0026's private-review backend is untouched and stays disabled.

0. **Merge and deploy this PR as usual.** Verify: with no Finkel variable set, `GET /api/reference-audio/finkel/clips?mode=admin` answers 401 signed out and 404 signed in as admin; reading pages look unchanged.
1. **Build off-repo.** `node scripts/finkel-reference-build.mjs build --package "<prepared folder>" --out "<private output folder outside Git>"` (the lead has the folder path; it is not written here). The script refuses an output inside any Git working tree and re-hashes every selected file. Verify: it prints `clips: 167`, `objects: 168` and `manifestSha256: 3739578ea1ff7e7067392ed381296c11b7a947230fde7d878f4ff06e1c152734` (the build is deterministic for the current catalog; a different hash means the package changed, so stop and look).
2. **Confirm the CLI reaches the right private store, read-only.** In a checkout linked to the production project (`vercel link`), run `vercel blob list --prefix reference-review/finkel/v1/ --limit 5`. Verify: it succeeds against `beitmitzvah-private-media` (check in the dashboard that this is the store connected to the project) and lists nothing yet. If the CLI asks for a read-write token because the store is OIDC-only, stop: choosing a token path is a credential decision.
3. **Dry run.** `node scripts/finkel-reference-build.mjs publish --plan "<output>/plan.json" --cwd "<linked checkout>" --dry-run`. Verify: `existing: 0, created: 0, wouldCreate: 168`.
4. **Publish.** The same command without `--dry-run`. Audio goes first and the manifest last; the script relies on the CLI's documented defaults of no random suffix and no overwrite (it passes no boolean values the parser could misread), and each object is downloaded again and re-hashed before it counts. An existing identical object is reused; a differing one stops the run. Verify: `created` plus `existing` is 168.
5. **Verify the store.** `node scripts/finkel-reference-build.mjs verify --plan "<output>/plan.json" --cwd "<linked checkout>"`. Verify: `verified: 168, missing: 0, differing: 0`.
6. **Set one Production variable:** `REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256` = the manifest hash from step 1. It is not a secret. Do not set `REFERENCE_AUDIO_FINKEL_STUDENT_RELEASE` and do not change `REFERENCE_AUDIO_STUDENT_RELEASE`. Verify: the variable list shows it for Production only.
7. **Redeploy Production** from main so the variable takes effect. Verify the deployment is READY on both aliases.
8. **Check access.** (a) Signed out, the clips route answers 401. (b) As Daniel in admin mode, open a student reading inside a covered passage (the admin clip list shows which passages are covered): the Cantor Finkel player appears with "Chanted by Cantor Josh Finkel" and plays; the passage's verses are marked. (c) With the release still off, a student or parent account sees no Finkel player, and `.../clips?mode=student&from=...&to=...` answers 404. (d) Runtime logs show no 503 from `/api/reference-audio/finkel/`. (e) Blob usage shows about 103 MB added.
9. **Listening review.** Daniel reviews Finkel items on the listening-review page (source `finkel`).
10. **Student release, only on Daniel's acceptance.** If Daniel marked any Finkel clip needs-work, first rebuild with `--hold`, publish and verify (steps 1, 3-5), and set the new manifest hash (step 6). Then set `REFERENCE_AUDIO_FINKEL_STUDENT_RELEASE=true`; Finkel reaches students only when the shared `REFERENCE_AUDIO_STUDENT_RELEASE` is also `true`. Redeploy and verify that a student account sees the Cantor Finkel player and hears a clip, and that `.../clips?mode=student` (no range) still answers 404.

Rollback at any point: remove `REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256` and redeploy; every Finkel route answers 404 again. The private objects can stay where they are; they cost cents.

## Decided here

- Whole-passage playback in its own player beside PocketTorah's verse player, shown first where it has coverage; verse taps stay with PocketTorah because Finkel has no verse timings.
- Only machine-passed, plain chant or spoken, normal-tempo scripture clips in this release. Students hear the producer's recommended take; admins see every take.
- No timings of any kind are shipped; the ASR verse candidates are not used.
- Reuse the reviewed private getter, its object namespace and the verified-bytes reader rather than adding a new storage path; CRC tenant only.
- No migration (none needed). The next free number after 0034 stays free.
- Credit wording: "Chanted by Cantor Josh Finkel" and "Read by Cantor Josh Finkel".
- The reading response carries `finkelListeningEnabled: true` only when Finkel is configured and the same release rule allows the mode, so pages without Finkel make no extra request.

GATE: credit wording and player placement (student-visible) — proceeded because MISSION's 2026-10-17 release authority supersedes separate student-visible approval, the lead specified the credit form, and students see nothing until the shared listening release.
GATE: Finkel's own release switch in addition to the shared hold — proceeded because it is strictly tighter than the brief (Finkel can never release ahead of PocketTorah's hold) and MISSION ties release to Daniel's acceptance of each source; the adversarial review recommended it.

## Follow-ups (not in this release)

- Service parts: 13 machine-passed blessing and service clips, mapped into Service parts (the two Torah-blessing unit IDs are known; the others live in the private service feed).
- Drills (52) and faster/slower variants (20) as explicit practice options.
- Verse-level cuts: review the 36 machine-checked verse candidates, or run PocketTorah's CTC alignment privately, then a timing review before any word highlighting.
- The 51 held scripture clips stay held unless a person listens and overrides.
- Known low-severity limits from the adversarial review: after release any live CRC student, parent or tutor grant can hear every preferred clip (access is not tied to the student's own assignment, unlike PocketTorah's metadata); the reading hint does not check the congregation (other congregations then simply get 404); signed out, 401 versus 404 reveals whether Finkel is configured.
