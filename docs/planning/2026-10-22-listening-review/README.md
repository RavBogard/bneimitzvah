# Reference-audio listening review (2026-10-22)

Daniel ruled on 2026-10-22 that he will do the reference-audio listening review this week, on his phone ([1.5 research, rulings](../../superpowers/research/2026-10-22-release-1-5-research.md#daniels-rulings-on-this-document-2026-10-22-binding)). On the same day he ruled that Cantor Finkel's recordings are licensed without restriction and belong in this review (MISSION, "Amended 2026-10-22 (Daniel, Cantor Finkel's recordings)"). This folder records what gates student reference playback today, what is still unfixed, and what this slice adds.

## 1. Findings (read before Daniel listens)

### The blocker: the reported boundary problem is unfixed on record

On 2026-10-18 Daniel failed live reference playback on every passage he tried: word tapping was slow, boundaries were inaccurate, and it was not as smooth as TropeTrainer (MISSION line 12; recorded in 4f6acc7; STATE "Current priority after Daniel's actual listening — playback acceptance FAILED").

- **Boundaries: no repair exists.** Word onsets are our own CTC forced alignment of the PocketTorah recordings (wav2vec2/espeak; [SOURCE-READINESS](../2026-10-17-reference-player/SOURCE-READINESS.md), the `tools/` row: "aligned starts, not labels, are the player data"). In the published catalog, 7,040 of the 7,072 word-timed verse clips start exactly 80 ms before the first aligned onset. A word drill plays from one onset to the next ([reference-player design](../../superpowers/specs/2026-10-17-reference-player-design.md): "Onsets do not prove clean phonetic ends"). STATE kept "native word-boundary precision and source CTC timing correctness" as separate open requirements. No commit after 2026-10-18 touches the alignment, the onsets or the verse cut points. The 6,984-clip short corpus work (`scripts/reference-short-corpus-build.mjs`, STATE "Independent full-library acceptance") is about byte and frame geometry. Root accepted it "without acoustic approval". MISSION ruling 18 forbids inventing timings. A repair would have to re-align, not hand-edit.
- **Latency: rebuilt, never measured on a phone.** The whole-recording transport was replaced by per-verse short MP3s. The main reading, the proposed Torah and assigned rows, and the close-up all play these clips: d68ba26, 32151b2, d4280c1, 917aecc, b98cce7, 87b5442 and 1fd77c7. 7ea5a7c also reuses in-flight audio. The only timing evidence is synthetic. `tests/app/reference-preparation-performance.test.ts` uses a fake clock, and STATE says the native browser window "does not establish click latency". Off-repo operator records outside Git show production with `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE=true` and the manifest pin set (inspection of 2026-10-20). They also show clip GETs from the CDN in 58–320 ms (public probe on d017fc9). That is the fetch only, not tap-to-sound on a phone.
- **No second listening is on record** since 2026-10-18.

What this means for Daniel's time: he may hear the same boundary faults again. The review page records them per verse, as "Verse starts or ends in the wrong place", "Word highlighting is out of step" and "A word drill plays the wrong span". It also times tap-to-sound on his phone for every verse. One pass therefore gives the first real measurement of both problems.

### What gates student reference playback today

One flag, `REFERENCE_AUDIO_STUDENT_RELEASE`. Production holds `false`.
- Parsed at `src/server/runtime/config.ts:59-64`. Only `"true"`/`"false"` are accepted, and `"true"` requires `REFERENCE_AUDIO_CATALOG_SHA256`.
- Composed at `src/server/runtime/composition.ts` into four places:
  - the short assigned-reading service (`short-service.ts:28`, `listeningEnabled = released || mode === "admin"`, which masks every reference to `unavailable` at `:54`);
  - the short exploration service (`short-exploration-service.ts:41`);
  - the legacy whole-recording service (`service.ts:35`);
  - **the service-music ecosystem** (`composition.ts:145` → `service-ecosystem/service.ts:120,190`, which also hides CRC Music audio from students).
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
1. Daniel's verdicts are in `listening_review_verdict`. Log in STATE: `GATE: student reference release — proceeded because Daniel passed the listening review (<tally>, sample listening-sample/v1, source pin <pin>)`.
2. In Vercel Production, set `REFERENCE_AUDIO_STUDENT_RELEASE=true`. Leave `REFERENCE_AUDIO_CATALOG_SHA256`, `BLOB_STORE_ID`, `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE` and `REFERENCE_AUDIO_SHORT_MANIFEST_SHA256` unchanged. Then redeploy from the Git source, because environment values bind at deploy.
3. **Coupling to decide first:** the same flag releases CRC Music service audio to students (`composition.ts:145`). If that should not move together, split the flag before flipping.
4. Verify signed in as a student: Hear controls appear and a tap plays. Verify the 36 held and the 9 capacity-held verses still say no reviewed recording. The rollback is `false` and a redeploy.
5. Finkel clips need their own provider and their own verdicts. Passing PocketTorah does not pass Finkel, and the reverse holds too; the tally is per source.

## 2. What this slice adds

An admin-only page, **Admin → Listening review** (`/workspace/admin/listening-review`), with three routes:
- `GET /api/admin/listening-review`
- `GET /api/admin/listening-review/items/<id>`
- `POST /api/admin/listening-review/verdicts`

- **Sample:** `src/lib/listening-review/sample.ts` (`listening-sample/v1`), 34 PocketTorah verses: 20 Torah verses across all five books and 14 haftarah verses across the Prophets. They were picked from the private index, using only verses that are playable, in one recording, word-timed and published. The picks cover 3-word verses up to the 65-second Ezekiel 43:11, the closest word onsets in the collection (40 ms), the least and the most room after the last word, the first verses of recordings, ketiv/qere words, the Decalogue and the Song of the Sea. Each item says why it was chosen.
- **Same player as students:** the student `FlowingStudyText` and `ReadingPlayer` give verse-first taps, word highlighting, the Practice word drill, Repeat and pitch-preserving Speed. The clip resolution is the same as students get (`resolveReference` + `findShortSource` through the same pinned catalog and manifest loaders). The only change to the student player is an optional `onPlaybackState` observer, which the page uses to time tap to sound. It never affects playback.
- **Verdicts:** Pass / Needs work, optional reasons and an optional note. Rows go in `listening_review_verdict`, which is append-only. The latest row per reviewer and item counts. Each row binds the source, the exact clip played and a source pin, SHA-256 of `pocket-torah/short-v1:<catalog>:<manifest>`. A re-cut never inherits verdicts. A clip that changed since the page loaded is refused (`changed`).
- **Tally:** per source, for the signed-in reviewer: heard, pass, need work, pass rate and "would teach wrong". It is shown beside G3's bar, labelled as a comparison.
- **Source-agnostic:** each item names its source (`pocket-torah` | `finkel`). The second source plugs in through `ListeningSourceProvider` (`src/server/listening-review/sources.ts`). Until a `finkel` provider is composed, its items show "not available yet" and count nowhere.
- **Student boundary:** these routes are admin-only (`read-defaults` / `manage-defaults`, admin grant in admin mode). They refuse a practice-context header, never serve bytes and never touch `REFERENCE_AUDIO_STUDENT_RELEASE`. `tests/app/listening-review.test.ts` proves a saved Pass leaves the unreleased student page masked.

### Interface for the Finkel source

```ts
type ListeningSourceProvider = Readonly<{
  id: "pocket-torah" | "finkel";
  pin(): string | null;                       // 64-hex identity of the audio served; null = not configured
  resolve(verse: StudyVerse, kind: "torah" | "haftarah", signal: AbortSignal): Promise<ReferenceShortResolution | null>;
}>;
```

`resolve` must return the student player's wire shape, `reference-resolution/short-v1`, or `null` when there is no clip. The verdict row stores `source.id`, which must match `^[a-z]{2}_[a-f0-9]{20,64}$`. Finkel items are added to the sample with `source: "finkel"` and ids `fj-…`. Adding them changes the sample version.

### Migration 0034 (0032 and 0033 are reserved for open PRs #17 and #21)

`0034_listening_review.sql` creates:
- table `listening_review_verdict`, with constraints `listening_review_receipt_key`, `listening_review_admin`, `listening_review_item`, `listening_review_source`, `listening_review_verdict_value`, `listening_review_note`, `listening_review_latency` and `listening_review_instant`;
- four FKs: `…_tenant_id_tenant_id_fk`, `listening_review_actor_fk`, `listening_review_grant_fk` and `listening_review_role_fk`;
- RLS enabled and forced;
- `REVOKE ALL` from PUBLIC and portal_runtime, then `GRANT SELECT, INSERT` to portal_runtime;
- policy `tenant_isolation`, whose WITH CHECK requires the request tenant and `role='admin' AND mode='admin'`;
- trigger `immutable_listening_verdict`, which calls `portal_immutable_audit()`.

It replaces `audit_action_known` with the prior list plus `listening-review.set`. The new list also carries 0032's and 0033's actions, so the audit list (only) is right whichever lands first.

It needs `public.portal_settings_text`, from 0030. **Ordering:** drizzle skips a migration whose journal `when` predates the last applied one. The journal times of #17's 0032 and #21's 0033 are earlier than 0034's. Whichever of them merges after this one must be renumbered above 0034 and regenerate its `when` and `idx`, and its audit list must keep `listening-review.set`. The new `tests/migration-journal.test.mjs` now fails CI if the journal's position, number or time ever runs backwards.

## 3. Daniel's phone steps

1. On the phone, open https://beitmitzvah.centralreform.org and sign in with the admin account.
2. Go straight to https://beitmitzvah.centralreform.org/workspace/admin/listening-review. Or, from the admin area (Students), tap **Listening review** in the row of admin tabs; swipe the row sideways if it is hidden.
3. Turn the ringer and sound on. Headphones help with boundaries.
4. For each verse:
   - Tap any Hebrew word. The whole verse plays and the words light up as they are sung.
   - Try **Practice**: pick one word to hear its drill. Try **Repeat** and **Speed** (0.5×–1.25×) once or twice along the way.
   - Tap **Pass** or **Needs work**. For Needs work, tick what was wrong; "Would teach wrong" is the serious one. Add a note if useful.
   - Tap **Save and go to next**.
5. The tally at the top counts as he goes. "All 34 verses" at the bottom jumps to any verse. He can stop and come back, because saved verdicts stay. Re-marking a verse replaces his earlier verdict.
6. "Tap to sound" under the player is the phone's own measurement for that verse. It is saved with the verdict.

## Decided here

- GATE: reused the admin `read-defaults`/`manage-defaults` capabilities for the review rather than adding new ones — proceeded because the admin grant is the rabbi/clergy (study spec S21) and the page is admin-only like settings.
- GATE: the tally counts only the signed-in reviewer's own verdicts — proceeded because the acceptance is Daniel's, and another admin's marks must not mix into his.
- GATE: showed G3's numbers as a labelled comparison, not as the bar — proceeded because no reference-audio bar is on record and setting one is Daniel's decision.
- GATE: added optional Needs-work reasons and automatic tap-to-sound timing beyond Pass/Needs work/note — proceeded because the reported failures were latency and boundaries, the page is admin-only, and the reasons make his one pass diagnostic.
- GATE: the sample excludes the 36 `start-moved` holds, the 22 duplicated references and the 9 capacity holds — proceeded because students cannot hear those verses either. Listening to them is a separate hold review.
