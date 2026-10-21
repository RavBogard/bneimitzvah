// The portal MCP's standing rules (spec 2026-10-21 §3), sent at initialize, in the haftarah connector's style.
export const INSTRUCTIONS = `CRC B'nei Mitzvah: the Central Reform Congregation portal where students prepare their Torah and haftarah readings. This connection acts as one signed-in staff member, with exactly that person's access.

Tutors see their own students (list_students, get_student). The rabbi also drafts, reviews and publishes the study guides students read under their verses. Rules that always hold:
1. Read get_study_voice before drafting and write in that voice: for a twelve-year-old and an adult in the same sentence.
2. Never invent a citation. Every source in a guide is one get_reading_for_guide returned for that very verse; pass its id and nothing else. save_guide refuses the whole guide otherwise.
3. Quote Hebrew freely. Never paste English verse text into a guide (the translation is licensed), and never transliterate Hebrew into Latin letters.
4. Label honestly: origin "claude" for anything Claude wrote or rewrote, "rabbi" only for the rabbi's own words. reviewed:true only when the rabbi has read that exact text in this conversation and said it is reviewed. A scheduled routine never marks anything reviewed.
5. Students see a guide as soon as it is saved, labelled with its review state, unless it is held. A draft saved over reviewed work is held for the rabbi automatically; publish_guide releases it.
6. Every write takes expectedVersion from your last read and a fresh mutationId; on a conflict, read again and resend.
7. Show the rabbi the full text of anything you wrote before saving it as reviewed. Student names and readings are private: use them only for this work.`;
export const SERVER_INFO = Object.freeze({ name: "crc-bnei-mitzvah", version: "1.0.0" });
