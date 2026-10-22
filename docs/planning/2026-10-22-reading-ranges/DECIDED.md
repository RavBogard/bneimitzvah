# Release 1.0.2: multi-range haftarot and duplicated reference cuts

Branch `claude/fix-reading-ranges`. Found by the 2026-10-22 read-only coverage count.

## Decided here (Claude, 2026-10-22; Daniel may overrule)

- **Model.** A reading is an ordered list of segments, each one forward range inside one book. Stored assignments already keep this as `ref` joined by "; ", and the calendar snapshot's `haftarah` now uses the same form ("Isaiah 27:6-28:13; Isaiah 29:22-23"). No migration, no new column; a single range is a list of one, so existing data and APIs are unchanged.
- **Order rule.** Torah keeps its rule (segments follow one another inside one book). A haftarah's segments may cross books (Shabbat Shuva) or return to an earlier chapter (Mishpatim: Jeremiah 34:8-22, then 33:25-26), and are read and shown in the order given. A verse may never repeat; each segment still runs forward.
- **Isolation.** If Hebcal's haftarah fails validation, the snapshot keeps the Torah reading and sets `haftarah` to null; staff choose the haftarah by hand, as on any date without one.
- **Display.** A multi-segment haftarah is shown the way multi-range readings already are: segments joined by "; " with en dashes ("Isaiah 27:6–28:13; Isaiah 29:22–23"). No new UI.
- **Guide keys.** A multi-segment haftarah's study-guide key joins each segment's key in order ("jeremiah-34-8-34-22-jeremiah-33-25-33-26"); single-range keys are unchanged and still fit the database's key check.
- **Duplicated cuts.** When a verse has more than one cut, the resolver no longer refuses it. It prefers a ready cut, then the recording whose verses best match the whole reading being studied (shared verses over the verses of both), then the archive file name, then the asset id. Studying Re'eh's haftarah (Isaiah 54:11-55:5) picks Re'eh's own recording over Noach's longer one. The catalog carries no parashah label, so "the reading's own recording" is measured by fit, which matches it for Noach, Re'eh and Ki Teitzei. The release gate and G3 are untouched.

## Open items that wait on Daniel

- **Bug B is not yet audible on the student page.** The published short-v1 manifest (6,984 cuts) was built with ambiguous references excluded by design (`ambiguousReadyEntries: 44`), so none of the 44 Isaiah 54:1-55:5 cuts has a short source. The resolver now selects a cut for those verses, but the short page plays nothing until a supplementary short-source build and publication adds those cuts and the manifest pin moves. That is a media publication, outside this change.
