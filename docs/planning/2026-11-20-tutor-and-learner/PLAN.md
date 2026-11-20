# Tutor and learner changes approved November 20

## Approved scope

Daniel approved the nine changes in the Otter follow-up and directed that **Practice** replace **Practice up close**. Practice uses the same assigned aliyah reader the tutor sees below the student overview. It has no private notes or tutor practice history. The learner's own practice tools and the tutor's private workspace serve separate tasks. The tutor walkthrough is private. Keep its transcript, learner details, and recordings outside the repository.

- The public front door gives clear routes to Study Torah, Learn to lein, and Practice a reading. Signed-in learners can resume their assigned or saved reading. Tutor mode keeps My Students reachable and makes assignment editing and Practice easy to find.
- An eligible signed-in learner can have several independent tutor relationships. Tutors can remove their own claims; a learner can remove an individual self-claim; the administrator can manage roster assignments and individual claims. Keep pre-sign-in roster linking an admin action.
- Practice shows the actual assigned aliyot and can start chant at an aliyah's first verse. Closing Practice returns to the same passage in the workspace. Keep repeat and speed visible through the reader’s playback controls. Valid changes to aliyah boundaries save with status and retry; passage changes retain their correct validation and revision handling.
- A tutor can record or upload spoken Hebrew, preview it, and share it with one learner for one assigned aliyah. The same learner can choose spoken Hebrew or the existing reference chant. Replacement and withdrawal need immediate application-level access changes. Use current assignment and tutor/student capabilities, the existing approved private-media store, and an isolated audio namespace. No streaming URL, public reader access, cache entry, or Git audio asset for the clip.
- Learners and linked guardians can enter optional pronouns. Surface the value to the appropriate tutors and CRC staff inside the authorized workspace. The shared lesson view has no private profile or notes.
- Assigned offline practice should use the existing owner-scoped public-source packs for the exact confirmed reading. Open the saved pack on the phone, turn off networking, and verify text and allowed chant playback. Maintain expiry, owner change and revocation behavior. Tutor-spoken audio stays out of the pack.

## Integration and release

- Work in the isolated `codex/toby-tutor-and-learner` worktree based on `c247ba7f`. The Shermet coder confirmed ownership of the source catalog, its timing shards and production playback verification. Reuse the reader and the pack stack.
- The guides release owns migration 0058 on `claude/guides-web-release`. Reconcile the combined migration journal and ensure 0058 is safely applied before later migrations reach production. Drizzle only applies timestamps greater than the last applied timestamp.
- Independently review tutor claim and pronoun authorization, shared Practice privacy, offline owner boundaries and tutor audio access before release. Verify important flows on a desktop and phone, run the project checks and exercise a synthetic account on a deployment when access and release gates allow.
