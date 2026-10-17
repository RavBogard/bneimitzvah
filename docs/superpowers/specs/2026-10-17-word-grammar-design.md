# Hebrew word meanings and grammar: pure source adapter

## Settled decisions (Daniel, binding)

Word meanings/grammar and Hebrew syllables/stress belong in1.0. No transliteration. Reuse the haftarah research rather than restarting it. This checkpoint is pure server-side source parsing, grammar decoding and conservative canonical-word correspondence; no interface, endpoint, database or provider call.

## Root decisions

Adapt the tested STEP TAHOT/TBESH parsing and morphology decoding in read-only `C:/Users/dsbog/haftarah/scripts/words.mjs` (haftarah HEAD33c04bcb417d644411fd40871200102354d2c609). Do not import that script, its template library, CLI, filesystem/cache/download behavior, old page DTO or OSHB fallback. Source pin remains STEP `bd09545c7a44b39ace20f16c0359915f2aa23a62`. Official current [STEP data README](https://github.com/STEPBible/STEPBible-Data) explicitly offers CC BY4.0 reuse with attribution and recorded changes; this is existing approved source research, not new paid service or permission to put licensed text in Git. Cached raw source stays outside Git. Synthetic tests only.

Own new modules under `src/server/study/lexical/` and focused new tests. Preserve the frozen word-aid files, existing engine/projector and all unrelated WIP. Keep the adapter server-only and pure: no filesystem, environment, imports of external packages, network, logging or persistence. No raw source/error strings escape through thrown errors; bounded fixed errors or unavailable results only.

First seam: parse the pinned TAHOT and TBESH formats into bounded immutable internal source records, decode recognized morphology into factual features and provide a canonical-word alignment function. Skip LXX-only source rows; use Hebrew-number override when present, and qere rows/ketiv metadata as the old tested parser does. Reject malformed/duplicate/nonconsecutive/ambiguous row identities rather than silently overwrite them. Source transliteration/pronunciation columns must be discarded at parse time. Retain only source Hebrew, short English gloss, lemma identifier, exact recognized grammar features and qere metadata needed for correspondence. A lexicon gloss describes a dictionary sense, never an authoritative translation of an occurrence. Unknown morphology stays explicitly unavailable; never infer a root from consonants or guess missing tags.

Bound input strings to32MiB UTF8 per file, line length16KiB,200000 source rows,512 rows per verse, morphemes16 per word, bounded gloss/code/lemma fields; canonical expected words/count also obey the existing projector's8KiB/512 limits. Reject invalid Unicode/invalid numeric chapter/verse/word fields. Avoid pathological unbounded regex/matrix work. Return copies with frozen nested records; do not mutate input.

Correspondence uses the portal's actual NFC `projectStudyVerse` read words supplied by the caller, including qere/maqaf order. Consonant skeleton comparison may remove Hebrew marks and known segmentation/punctuation, not arbitrary Latin/HTML. Do not replace divine names with an unrelated spelling to force a match. Exact full ordered count/skeleton correspondence is proved. If supporting partial LCS matches, retain a pair only when it belongs to every optimal monotone alignment; otherwise withhold it. Repeated identical words are the explicit regression: a single arbitrary traceback does not prove identity. If that unique-match algorithm is too large for this checkpoint, full ordered matches plus closed whole-verse mismatch is an acceptable conservative first seam; document the limit. No fabricated syllable offsets or source text replacement. Public DTO/hash binding and runtime private corpus packaging will be a later reviewed slice.

## Acceptance

Independent expected synthetic tests for pinned-format Hebrew-number overrides, LXX exclusion, qere/ketiv, maqaf and affix segmentation, recognized verb/noun/pronoun features, no transliteration retention, malformed/duplicate/out-of-range rows, unknown tags, bounds, copying/deep freezing and repeated-word ambiguity. Do not copy real fixture verses/glosses or corpus into Git. Focused tests, typecheck, unchanged repository protection and a second worker review before integration. Record reuse differences/credit in a short adapter comment and return note.

## Open items that wait on Daniel

None for this pure adapter. No new provider, paid service, corpus publication, summaries or interface is authorized by this checkpoint alone; those later slices remain within the product plan and require their own bounded design/integration review.

## Approved cached-format clarification

A source row whose canonical verse or lemma identity is known but whose retained fields, ordering, duplicate identity or alternatives cannot be proved holds that entire unit permanently. Outputs are discriminated: `StepVerse` is `{ref,status:'ready',words}` or `{ref,status:'unavailable',reason:'source-format'}`; dictionary entries similarly have `lemma,status:'ready',...` or `lemma,status:'unavailable',reason:'source-format'`. Holds cannot be overwritten by later valid rows and alignment requires a ready verse. Unparseable identities, invalid reference fields or file-level safety bounds still refuse the file. Exact pinned L annotations, terminal lemma `+` notation and fixed TBESH relationship suffixes may normalize without retaining discarded source syntax; alternatives are never resolved by selecting the first headword. Excluded LXX ordering IDs may have four digits (positive, <=9999); retained reading rows still obey the512-row bound and exact consecutive order. These distinctions are validated with synthetic structural fixtures, not copied corpus rows.
