# Replacing the "Parashat HaShavua" study guide booklets

Written 2026-10-28 at Daniel's request: what the app would need to revise and add to replace the booklets CRC students have used as their main text, and to do clearly better than them. Based on the series' published descriptions (no copy of the booklet was read) and on main at `20b94408`.

## What the booklet is

"Parashat HaShavua: The Weekly Torah Portion — The Bar/Bat Mitzvah Study Guide" is one paperback per portion. Hara Person was series editor, and David E. S. Stein and Philip D. Stern also worked on it. It was published by URJ Press around 2007 and is now sold by Behrman House. Retailer descriptions list:

1. The blessings for studying Torah and for the Torah reading.
2. An overview of the portion.
3. The full Torah text in vocalized Hebrew with an English translation.
4. The same text unvocalized, for practising from a scroll-like page.
5. Commentary excerpts from Plaut's *The Torah: A Modern Commentary* (CCAR Press).
6. Theme essays and study questions from Harvey Fields' *A Torah Commentary for Our Times* (URJ Press), meant to help the student write a speech.
7. The haftarah in Hebrew and English.
8. A "Torah in Action" page that suggests mitzvah projects.
9. A list of resources.

Its job, in short: one Reform voice to explain the text, the text in a form you can practise from, and a way into the speech.

## Where the app already stands

| Booklet part | In the app now | Verdict |
|---|---|---|
| 1. Blessings | Siddur blessings on the public reading page; prayer audio is Daniel's 2.1 recording list | Mostly covered; chanted blessing audio still to come |
| 2. Overview | Study-guide overview card ("About this portion") with themes, Claude-written, labelled by review state | Built, but only where a guide exists. Bamidbar was the first in production; custom guides are meant to be rare |
| 3. Hebrew + English | Reader with trope colour, JPS 1985 English, word tools, reference audio, the student's own aliyot | Better than the book |
| 4. Unvocalized text | Tikkun view | Better than the book (switches instantly, tied to the same verses) |
| 5. Plaut commentary | Verse notes with Sefaria sources in guides; rabbi-curated discussions ("Sources on this verse") | Different in kind: original sources rather than one modern Reform voice. Thin where nothing is curated |
| 6. Fields themes + questions for the speech | Theme list with "I read this" ticks; no questions | Gap, and cut on purpose: D'var Torah is out of the app ("that all happens with the rabbi"), and S3 rules out reflection prompts |
| 7. Haftarah | Haftarah reading equal to Torah, with its own guide slot and a link to the week's Torah from Scratch sheet | Covered for reading; understanding depends on guide coverage |
| 8. Torah in Action | Nothing; mitzvah projects are outside the product scope in MISSION | Gap, also on purpose |
| 9. Resources | Curated discussions and Sefaria links | Covered where curated |

Things the booklet cannot do and the app already does: audio for every verse; trope teaching (Learn to lein); only the student's own verses, chosen by the rabbi; tutor and parent visibility of practice; phone and offline use; the service course; honors and rehearsal dates.

## What would have to change to retire the booklet

These are in order of value. The first three are needed before a family could be told "you don't need the book".

1. **An understanding layer for every reading, not only curated ones.** Today a student whose portion has no guide gets the text and sources, but no "what is this portion about". The booklet always has one. Option A: generate a base guide (overview plus three or four themes with sources) for all 54 portions, the doubled weeks, and every haftarah CRC uses. Do this in the study voice, labelled "Written by Claude for CRC · not yet reviewed", as S13 already allows. Option B: give only the overview and themes, with no verse notes. Option A is my recommendation: it uses the pipeline that already exists (the operator bridge or MCP), and it costs Claude time, not money.

2. **One printable "my portion" booklet per student.** Families and tutors still want paper. The print sheet could grow into a booklet with: the blessings, the overview, the student's own verses in Hebrew with trope colour and English, the same verses as tikkun, the themes and sources, and the haftarah. It would run under the existing licence filter. This is the direct replacement for the paperback, and it is better than it: it holds only the student's own verses, with CRC's own framing.

3. **A Reform modern-commentary voice.** Plaut's commentary is what makes the booklet feel Reform. The app shows classical sources, which are excellent, but not a modern liberal reading. There are three ways to fill this:
   - (a) The study-voice document (S14) already asks guides to read in a historical-critical, humanistic voice. Make sure every generated guide gets this.
   - (b) License Plaut and Fields excerpts from CCAR Press and URJ. Hara Person now leads the CCAR, so the conversation is short. **This is a licence question, so it is Daniel's.**
   - (c) Daniel's own teaching, built up over time in the curated discussions.

   I'd start with (a), because it is free and can be done now, and ask about (b) only if (a) feels thin.

4. **Questions to talk over (needs Daniel's ruling).** The booklet's questions exist for the speech, and the speech is out of the app. But questions also serve study: a parent and child at the table, or a tutor opening a lesson. A short "Talk about it" line under each theme would serve that. It would have no writing box and save nothing. This bends S3 ("no reflection prompts"), so it is an alignment question, not something to build quietly.

5. **Haftarah understanding at parity.** The haftarah needs the same overview and themes as the Torah reading (S20 already says they are equal), plus a short line on why this haftarah goes with this portion. The booklet does this weakly; the app could do it well.

6. **Chanted blessings.** Audio for the Torah and haftarah blessings. This is already on Daniel's 2.1 recording list; it should be listed as part of retiring the book.

7. **"Torah in Action" (optional, needs Daniel's ruling).** Mitzvah projects are outside scope by MISSION. A middle path: one line per theme saying where the idea lives today, with no project tracking. I would leave this out unless Daniel wants it.

## Where the app can go well beyond the booklet

- **Personal, not generic.** The book prints the whole portion; the app shows the student's own aliyot and the themes inside them.
- **Hear it, not just read it.** Every verse has audio, and trope colour links what the student sees to what they hear.
- **Living, not frozen.** The rabbi can add a source this year; the 2007 commentary never changes.
- **Shared.** Parents and tutors see what was read, so study becomes a conversation, not homework done alone.
- **Free and on the phone.** No booklet to buy per family, and nothing to lose.

## Constraints to keep

- No licensed text in the repo. The Plaut, Fields and JPS 1985 text stays out of git, as now. Licensed excerpts, if bought, would live only in the database under the licence filter.
- No invented citations. Every generated source is a Sefaria reference that the server returned.
- D'var Torah stays out unless Daniel reverses his 2026-10-24 ruling. This analysis does not propose reversing it; it only notes that the booklet's questions also serve study (item 4).

## Questions for Daniel

1. Should a base guide be generated for every portion and haftarah, so no student is left without "what is this about"? (Recommended)
2. Should the print sheet grow into a per-student booklet that replaces the paperback?
3. Should the app add discussion questions with no writing, despite S3?
4. Should we ask CCAR/URJ about licensing Plaut and Fields excerpts, or rely on the study voice?

## Sources

- [Behrman House: Parashat HaShavua series pages](https://store.behrmanhouse.com/index.php/parashat-hashavua-b-har.html)
- [IsraelBookShop: The Bar/Bat Mitzvah Study Guide](https://www.israelbookshop.com/products/parashat-hashavua-the-bar-bat-mitzvah-study-guide)
- [Amazon: Vayishlach edition, Person, Stein and Stern](https://www.amazon.com/Parashat-Hashavua-Weekly-Torah-Portion/dp/B00CFVHUKU)
