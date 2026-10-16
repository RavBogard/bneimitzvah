# Numeric verse-count catalog

`catalog.ts` contains only canonical book identifiers and integer verse counts per chapter, extracted from [Sefaria's official Tanakh Shape API](https://www.sefaria.org/api/shape/Tanakh) on 2026-10-16 UTC (2026-10-15 in the project's local time zone). No Hebrew/English verse text, commentary, version descriptions, translations, identities or personal records were retained.

The [official Shape API tutorial](https://developers.sefaria.org/reference/tutorial-tanakh-trivia-game) documents that `chapters` lists each chapter's number of verses. Extraction required 39 records, known book-name syntax, 1–200 chapters per record and integer counts of 1–200 per chapter. The resulting object and every chapter array are frozen. Hebrew/Jewish versification is used; numbered books retain Sefaria/Hebcal Roman-numeral names such as `I Samuel`.

The original metadata response is ignored locally; its SHA-256 is `dc0dae9eca181e4b055b68c8681c6cdcb502bd95d703c0200430fc8d355d542e`. The committed artifact contains the numeric structure only. This factual metadata is not a grant to copy any text edition or translation from Sefaria. Later text fetching must follow the text-specific licence/provenance rules.
