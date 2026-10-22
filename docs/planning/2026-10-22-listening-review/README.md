# Reference-audio listening review (2026-10-22)

Daniel ruled on 2026-10-22 that he will do the reference-audio listening review this week, on his phone ([1.5 research, rulings](../../superpowers/research/2026-10-22-release-1-5-research.md#daniels-rulings-on-this-document-2026-10-22-binding)). On the same day he ruled that Cantor Finkel's recordings are licensed without restriction and belong in this review (MISSION, "Amended 2026-10-22 (Daniel, Cantor Finkel's recordings)"). **Superseded in part, later on 2026-10-22 (MISSION "show rather than hide"):** human recordings (PocketTorah and Cantor Finkel) go live without a listening review, and the review gate now applies only to generated chant (G3). The release-flip steps below are kept for reference but no longer wait on this page. The page stays useful as a per-verse diagnostic of the boundary repair and of tap-to-playing time on a phone, and as the harness for generated chant once it has a source provider. **Earlier the same day Daniel ruled that the review waits for the boundary repair** (refined word starts from the audio, real word ends, 5 ms fades; branch `claude/boundary-repair`) and that Finkel's clips join the same pass (STATE, 1.0.1 log). This page is ready for that pass; the sample must be regenerated (and its version bumped) if the repair changes the published manifest. This folder records what gates student reference playback today, what is still unfixed, and what this slice adds.

## 1. Findings (read before Daniel listens)

### The blocker: the reported boundary problem is unfixed on record

On 2026-10-18 Daniel failed live reference playback on every passage he tried: word tapping was slow, boundaries were inaccurate, and it was not as smooth as TropeTrainer (MISSION line 12; recorded in 4f6acc7; STATE "Current priority after Daniel's actual listening — playback acceptance FAILED").

- **Boundaries: no repair exists.** Word onsets are our own CTC forced alignment of the PocketTorah recordings (wav2vec2/espeak; [SOURCE-READINESS](../2026-10-17-reference-player/SOURCE-READINESS.md), the `tools/` row: "aligned starts, not labels, are the player data"). In the published catalog, 7,040 of the 7,072 word-timed verse clips start exactly 80 ms before the first aligned onset. A word drill plays from one onset to the next ([reference-player design](../../superpowers/specs/2026-10-17-reference-player-design.md): "Onsets do not prove clean phonetic ends"). STATE kept "native word-boundary precision and source CTC timing correctness" as separate open requirements. No commit after 2026-10-18 touches the alignment, the onsets or the verse cut points. The 6,984-clip short corpus work (`scripts/reference-short-corpus-build.mjs`, STATE "Independent full-library acceptance") is about byte and frame geometry. Root accepted it "without acoustic approval". MISSION ruling 18 forbids inventing timings. A repair would have to re-align, not hand-edit.
- **Latency: rebuilt, never measured on a phone.** The whole-recording transport was replaced by per-verse short MP3s. The main reading, the proposed Torah and assigned rows, and the close-up all play these clips: d68ba26, 32151b2, d4280c1, 917aecc, b98cce7, 87b5442 and 1fd77c7. 7ea5a7c also reuses in-flight audio. The only timing evidence is synthetic. `tests/app/reference-preparation-performance.test.ts` uses a fake clock, and STATE says the native browser window "does not establish click latency". Off-repo operator records outside Git show production with `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE=true` and the manifest pin set (inspection of 2026-10-20). They also show clip GETs from the CDN in 58–320 ms (public probe on d017fc9). That is the fetch only, not tap-to-sound on a phone.
- **No second listening is on record** since 2026-10-18.

What this means for Daniel's time: he may hear the same boundary faults again. The review page records them per verse, as "Verse starts or ends in the wrong place", "Word highlighting is out of step" and "A word drill plays the wrong span". It also times, on his phone, the first tap on each verse until the player reaches its playing state (not the moment sound is heard). One pass therefore gives the first real measurement of both problems.

### What gates student reference playback today

One flag, `REFERENCE_AUDIO_STUDENT_RELEASE`. Production holds `false`.
- Parsed at `src/server/runtime/config.ts:59-64`. Only `"true"`/`"false"` are accepted, and `"true"` requires `REFERENCE_AUDIO_CATALOG_SHA256`.
- Composed at `src/server/runtime/composition.ts` into four places:
  - the short assigned-reading service (`short-service.ts:28`, `listeningEnabled = released || mode === "admin"`, which masks every reference to `unavailable` at `:54`);
  - the short exploration service (`short-exploration-service.ts:41`);
  - the legacy whole-recording service (`service.ts:35`);
  - (until this PR) **the service-music ecosystem** too: `composition.ts:145` → `service-ecosystem/service.ts:120,190`, which hides CRC Music audio from students. This PR splits that onto its own flag, `SERVICE_AUDIO_STUDENT_RELEASE` (on only when exactly `"true"`; unset or malformed is off and never fails startup), so releasing reference audio can no longer release service audio, and the reverse. Both resolve through `audioReleases()` in `src/server/runtime/composition.ts`; tests in `tests/app/audio-release-flags.test.ts` and `tests/app/service-ecosystem.test.ts`.
- The reading response carries the same predicate as `referenceListeningEnabled` (`src/server/http/portal.ts:414`). While it is false the client builds no player, prepares no audio metadata and shows no Hear controls (`study/view.tsx:104`, `study/exploration-view.tsx:54`).
- Clip bytes are public by content hash at `/reference-audio/short-v1/<sha256>.mp3` (`src/server/reference-audio/runtime-short.ts`, which hard-codes `studentRelease: false` for its own metadata). A student never receives a hash while the flag is false.
- Tests: `tests/app/reference-short-service.test.ts` ("default release and actual authority deny…"), `tests/app/reference-runtime.test.ts`, `tests/app/reference-review-runtime-config.test.ts:24`.

### What admins can already hear, and where

The administrator exception is `mode === "admin"` in the predicates above.
- An admin hears exactly the student player in a student's reading at `/workspace/admin/students/<id>/reading`: flowing text, verse-first taps, the Practice word drill, Repeat and pitch-preserving Speed.
- An admin also hears it in the full-parashah exploration for an unassigned student.
- `/workspace/admin/reference-review` ("Recording review") is the separate, parked Finkel private batch review. It is not PocketTorah.

### Acceptance criteria on record

No numeric bar exists for human reference audio.
- MISSION line 20: G1/G2/G3 "do not gate authentic reference playback. Reference provenance, attribution, timing review and Daniel's listening acceptance still apply."
- MISSION line 12: playback must be "as smooth as TropeTrainer". Structural or synthetic checks "are not listening acceptance". Latency and acoustic boundaries must be repaired.
- MISSION lines 10 and 16: verse-first taps, flowing text, looping and pitch-preserving speed.
- The historical "26-clip spot-check" ([contract](../2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md), open item 3) is still pending, and so are the 36 `start-moved` holds. Those 36 stay unplayable.
- The only numeric bar anywhere is G3 for generated chant: at least 95% melody passes and zero "would teach wrong" (MISSION ruling 16). The page shows it **for comparison only**.
- Setting a bar for reference audio is Daniel's call. One conflict to note: [HANDOFF](../2026-10-21-torah-study/HANDOFF.md):48 calls G3 a gate on "generated or reference chant", which is looser than MISSION line 20. MISSION wins.

### What flipping the release involves (after Daniel passes)

This is a logged gate decision, not automatic. Nothing in this slice reads a verdict to change access.
1. Daniel's verdicts are in `listening_review_verdict`. Log in STATE: `GATE: student reference release — proceeded because Daniel passed the listening review (<stress-set and random-draw counts>, sample listening-sample/v2, source pin <pin>)`.
2. In Vercel Production, set `REFERENCE_AUDIO_STUDENT_RELEASE=true`. Leave `REFERENCE_AUDIO_CATALOG_SHA256`, `BLOB_STORE_ID`, `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE` and `REFERENCE_AUDIO_SHORT_MANIFEST_SHA256` unchanged. Then redeploy from the Git source, because environment values bind at deploy.
3. Leave `SERVICE_AUDIO_STUDENT_RELEASE` unset. It governs only CRC Music service audio and is a separate decision with its own logged gate.
4. Verify signed in as a student: Hear controls appear and a tap plays. Verify the 36 held and the 9 capacity-held verses still say no reviewed recording, and that CRC Music audio is still hidden. The rollback is `false` and a redeploy.
5. Finkel clips need their own provider and their own verdicts. Passing PocketTorah does not pass Finkel, and the reverse holds too; the tally is per source.

## 2. What this slice adds

An admin-only page, **Admin → Listening review** (`/workspace/admin/listening-review`), with three routes:
- `GET /api/admin/listening-review`
- `GET /api/admin/listening-review/items/<id>`
- `POST /api/admin/listening-review/verdicts`

- **Sample (`listening-sample/v2`, 54 PocketTorah verses), regenerated by `scripts/listening-sample.mjs`** from the private index (`catalog.json`, SHA `48c8147b…`) and the published clip manifest (`7784feb9…`, the production pin). Only citations, the seed and those two digests are committed, in `src/lib/listening-review/sample-generated.ts`. A candidate is a verse in exactly one recording, ready for playback with word timings, with a published clip matching its cut exactly: 6,983 verses, exactly what a student could play. The 36 `start-moved` holds, the 22 duplicated references, the 9 capacity holds and the one verse without word timing are excluded. Every sampled verse is a candidate, and the script stops if a named verse is not.
  - **Stress set (34):** 14 named verses (Genesis 1:1, the Song of the Sea, the Decalogue, Sh'ma, the priestly blessing, the last verse of the Torah, two ketiv/qere verses, first verses of recordings, familiar haftarah openings). Then, for Torah and haftarah separately, the verses at the extremes of each boundary measure: closest word onsets (3 + 3), longest (2 + 2), fewest words (2 + 1), least room after the last word (2 + 2) and longest pause after it (1 + 2). Ties break in canonical book order. The result has 20 Torah verses across all five books and 14 haftarah verses.
  - **Random draw (20):** a seeded shuffle (`crc-listening-review-2026-10-22`) of every other candidate, so its counts estimate the whole collection rather than the hardest cases. Regenerate with `node scripts/listening-sample.mjs --catalog <catalog.json> --manifest <manifest.json>`; a changed list must bump the sample version.
- **Same player as students:** the student `FlowingStudyText` and `ReadingPlayer` give verse-first taps, word highlighting, the Practice word drill, Repeat and pitch-preserving Speed. The clip resolution is the same as students get (`resolveReference` + `findShortSource` through the same pinned catalog and manifest loaders). **Not included:** the Word tools panel (meanings, grammar, syllable stress, word-by-word Hear). Its reads are bound to a student's assignment, so it cannot be wired here without a student; the Practice selector inside the player gives the same word drills. The only change to the student player is an optional `onPlaybackState` observer. The page uses it to time the first tap on a verse until the player's "playing" state (after the clip is fetched, decoded and `play()` resolves; not the moment sound is heard). That one number is shown as "First tap to playing" and saved with the verdict. The observer never affects playback.
- **Verdicts:** Pass / Needs work, optional reasons and an optional note. Rows go in `listening_review_verdict`, which is append-only. The latest row per reviewer and item counts. Each row binds the source, the exact clip played and a source pin, SHA-256 of `pocket-torah/short-v1:<catalog>:<manifest>`. A re-cut never inherits verdicts. A clip that changed since the page loaded is refused (`changed`).
- **Tally:** per source and per set (stress set, random draw), for the signed-in reviewer, in plain counts only: "31 of 34 passed, 2 need work, 0 would teach wrong (34 of 34 heard)". A verse that does not resolve to a clip now is shown as not available and is not counted, so it can never block "all heard". The page never says a set is accepted. G3's 95% / zero "would teach wrong" appears only as a labelled comparison for generated chant, a different gate.
- **Source-agnostic:** each item names its source (`pocket-torah` | `finkel`). The second source plugs in through `ListeningSourceProvider` (`src/server/listening-review/sources.ts`). Until a `finkel` provider is composed, its items show "not available yet" and count nowhere.
- **Student boundary:** these routes are admin-only (`read-defaults` / `manage-defaults`, admin grant in admin mode). They refuse a practice-context header, never serve bytes and never touch `REFERENCE_AUDIO_STUDENT_RELEASE`. `tests/app/listening-review.test.ts` proves a saved Pass leaves the unreleased student page masked.

### Interface for the Finkel source

```ts
type ListeningSourceProvider = Readonly<{
  id: "pocket-torah" | "finkel";
  pin(): string | null;                       // 64-hex identity of the audio served; null = not configured
  resolve(verse: StudyVerse, kind: "torah" | "haftarah", signal: AbortSignal): Promise<ReferenceShortResolution | null>;
  playable?(verses: readonly { ref: string; kind: "torah" | "haftarah" }[], signal: AbortSignal): Promise<ReadonlySet<string>>;  // optional, no text needed
}>;
```

`resolve` must return the student player's wire shape, `reference-resolution/short-v1`, or `null` when there is no clip. `playable` lets the overview count only verses that would actually play. The verdict row stores `source.id`, which must match `^[a-z]{2}_[a-f0-9]{20,64}$`. Finkel items are added to the sample with `source: "finkel"` and ids `fj-…`. Adding them changes the sample version.

### Migration 0034 (0032 and 0033 are reserved for open PRs #17 and #21)

`0034_listening_review.sql` creates:
- table `listening_review_verdict`, with constraints `listening_review_receipt_key`, `listening_review_admin`, `listening_review_item`, `listening_review_source`, `listening_review_verdict_value`, `listening_review_note`, `listening_review_latency` and `listening_review_instant`;
- four FKs: `…_tenant_id_tenant_id_fk`, `listening_review_actor_fk`, `listening_review_grant_fk` and `listening_review_role_fk`;
- RLS enabled and forced;
- `REVOKE ALL` from PUBLIC and portal_runtime, then `GRANT SELECT, INSERT` to portal_runtime;
- policy `tenant_isolation`, whose WITH CHECK requires the request tenant and `role='admin' AND mode='admin'`;
- trigger `immutable_listening_verdict`, which calls `portal_immutable_audit()`.

It replaces `audit_action_known` with the prior list plus `listening-review.set`. The new list also carries 0032's and 0033's actions, so the audit list (only) is right whichever lands first.

It needs `public.portal_settings_text`, from 0030. **Merge order: #17 (0032) first, then #21 (0033), then this PR (0034).** When this branch takes main after both, the journal must read 0031 idx 31, 0032 idx 32, 0033 idx 33, 0034 idx 34. Regenerate `meta/0034_snapshot.json` with `npm run db:generate` so its `prevId` chains to 0033's snapshot; `tests/app/listening-review-migration.test.ts` compares the two. 0034's `when` (1792672221744) must stay later than 0033's (1792652103327 on #21), which it is. If the order changes, `tests/migration-journal.test.mjs` fails until the later migration is renumbered and retimed. Drizzle skips any migration whose `when` predates the last one applied.

## 3. Daniel's phone steps

1. On the phone, open https://beitmitzvah.centralreform.org and sign in with the admin account.
2. Go straight to https://beitmitzvah.centralreform.org/workspace/admin/listening-review. Or, from the admin area (Students), tap **Listening review** in the row of admin tabs; swipe the row sideways if it is hidden.
3. Turn the ringer and sound on. Headphones help with boundaries.
4. For each verse:
   - Tap any Hebrew word. The whole verse plays and the words light up as they are sung.
   - Try **Practice**: pick one word to hear its drill. Try **Repeat** and **Speed** (0.5×–1.25×) once or twice along the way.
   - Tap **Pass** or **Needs work**. For Needs work, tick what was wrong; "Would teach wrong" is the serious one. Add a note if useful.
   - Tap **Save and go to next**.
5. The tally at the top counts as he goes, separately for the stress set (the 34 hardest and best-known verses) and the random draw (20 ordinary verses). "All 54 verses" at the bottom jumps to any verse. He can stop and come back, because saved verdicts stay. Re-marking a verse replaces his earlier verdict.
6. "First tap to playing" under the player is this phone's time from his first tap on that verse until the player started. It is saved with the verdict. It does not include any silence at the start of the clip.

## Decided here

- GATE: reused the admin `read-defaults`/`manage-defaults` capabilities for the review rather than adding new ones — proceeded because the admin grant is the rabbi/clergy (study spec S21) and the page is admin-only like settings.
- GATE: the tally counts only the signed-in reviewer's own verdicts — proceeded because the acceptance is Daniel's, and another admin's marks must not mix into his.
- GATE: showed G3's numbers as a labelled comparison, not as the bar — proceeded because no reference-audio bar is on record and setting one is Daniel's decision.
- GATE: added optional Needs-work reasons and automatic tap-to-sound timing beyond Pass/Needs work/note — proceeded because the reported failures were latency and boundaries, the page is admin-only, and the reasons make his one pass diagnostic.
- GATE: the sample excludes the 36 `start-moved` holds, the 22 duplicated references and the 9 capacity holds — proceeded because students cannot hear those verses either. Listening to them is a separate hold review.
- GATE: split CRC Music service audio onto `SERVICE_AUDIO_STUDENT_RELEASE` (coordinator, 2026-10-22) — proceeded because one flag must not release two different kinds of audio; production keeps both off, so nothing changes for students.
- GATE: sample v2 = generated stress set plus a seeded 20-verse random draw, tallied separately in plain counts (second adversarial pass, M1) — proceeded because a hand-picked list with an acceptance-sounding line overclaimed.
