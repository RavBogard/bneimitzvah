# Trope engine: the Hebrew text front end

*Research, 2026-10-15. Question: how to turn the Masoretic text the sheet already holds (Sefaria, "Miqra according to the Masorah") into what a singing synthesizer needs per verse: an ordered list of syllables, each with phonemes, stress and the trope motif that applies.*

Each claim is tagged **[verified: URL]** (read at the source or run in the scratchpad today) or **[inferred]** (standard grammar or my reasoning; confirm before relying on it). Scripts and outputs are in `C:\Users\dsbog\AppData\Local\Temp\claude\C--Users-dsbog-haftarah\a7f4aefe-3700-425e-87ab-0020f95626f2\scratchpad\trope\` (`t1.mjs`, `t2.mjs`, `t3.mjs`, the Sefaria JSON dumps).

**Short version.** Sefaria's MAM text is unusually friendly to this task: it already marks the stressed syllable on every word whose accent sits at the word edge, uses the dedicated qamats-qatan codepoint, distinguishes legarmeh from paseq in markup, and wraps ketiv/qere in classed spans. Charles Loder's **havarotjs** (MIT, zero dependencies, ~80 KB of ESM) syllabifies Tiberian Hebrew and was written against this exact text; on the sample verse it got every syllable boundary and every stress right, and on the full Machar Chodesh haftarah it made no visible errors apart from Jerusalem, which it special-cases imperfectly. Recommendation: vendor havarotjs, write the phoneme map and the trope-assignment layer ourselves (they are small and the choices are the cantor's), and validate against a human-syllabified gold set plus the Python tool phonikud as an independent cross-check.

---

## 0. What the repo already does (read first)

- `scripts/fetch.mjs` calls `https://www.sefaria.org/api/v3/texts/<ref>?version=hebrew&version=english|all&return_format=default` and keeps the version whose `languageFamilyName` is `hebrew` (`HEBREW_VERSION = "Miqra according to the Masorah"`). `cleanHebrew()` strips the trailing `{ס}`/`{פ}` span into a `break` field and turns a mid-verse one into `<span class="pisqa"></span>`. Everything else (the `mam-kq` spans, `&thinsp;<b>׀</b>`, `<sup>*</sup><i class="footnote">`) is stored as-is in `sheet.json` `verses[].he`. **[verified: fetch.mjs lines 27, 131-178; fixture `tests/fixtures/week-notes/sheet.json` holds `<span class="mam-kq">…` and `&thinsp;<b>׀</b>`]**
- `template/lib.js` already has: `TETRA` (any pointing of the Name, marks only), `divineName()` (prints יי and keeps the accents), `hebrewKey()` (folds U+05C7 to qamats and U+05BA to holam for matching), `tropeTokens()`/`tropePhrases()` (TropeTrainer grouping; munach followed by a standalone `׀` token is legarmeh and ends a revia block). The trope engine should reuse `BLOCK_ENDING`/`TROPE_FAMILIES` so the chanter's-copy colors and the sung motifs agree. **[verified: lib.js 9-22, 38-44, 374-449]**

---

## 1. Parsing the marks

### 1.1 Codepoint classes (from the Unicode database, dumped locally) **[verified: `python -c unicodedata` run; names and canonical combining classes below are from Unicode 16 as shipped with Python 3.14]**

| Class | Codepoints | Notes |
|---|---|---|
| **Te'amim (accents)** | U+0591–U+05AE | 0591 etnahta, 0592 segol(ta), 0593 shalshelet, 0594 zaqef qatan, 0595 zaqef gadol, 0596 tipeha, 0597 revia, **0598 "ZARQA" (actually tsinnorit; MAM uses it as the zarqa stress helper)**, 0599 pashta, 059A yetiv, 059B tevir, 059C geresh, 059D geresh muqdam, 059E gershayim, 059F qarney para, 05A0 telisha gedola, 05A1 pazer, 05A2 atnah hafukh, 05A3 munah, 05A4 mahapakh, 05A5 merkha, 05A6 merkha kefula, 05A7 darga, 05A8 qadma, 05A9 telisha qetana, 05AA yerah ben yomo, 05AB ole, 05AC iluy, 05AD dehi, **05AE "ZINOR" (actually zarqa)**. Wikipedia and havarotjs both note the 0598/05AE name swap. **[verified: https://en.wikipedia.org/wiki/Hebrew_cantillation; havarotjs `syllabifier.js` comments]** |
| **Nikud (vowels)** | U+05B0 sheva, 05B1 hataf segol, 05B2 hataf patah, 05B3 hataf qamats, 05B4 hiriq, 05B5 tsere, 05B6 segol, 05B7 patah, 05B8 qamats, 05B9 holam, **05BA holam haser for vav**, 05BB qubuts, **05C7 qamats qatan** | ccc 10–20; 05C7 has the same combining class (18) as qamats, so normalization keeps them in the same slot. |
| **Dots on letters** | 05BC dagesh/mappiq/shureq dot, 05BF rafe, 05C1 shin dot, 05C2 sin dot | 05BC is one codepoint for three functions: dagesh lene, dagesh forte, mappiq (in final he), and the shureq dot (in vav). Context decides. |
| **Meteg / silluq** | 05BD | One codepoint for both. Silluq = the 05BD on the last word before 05C3. **[verified: https://en.wikipedia.org/wiki/Meteg]** |
| **Punctuation (not combining)** | 05BE maqaf, 05C0 paseq, 05C3 sof pasuq, 05C6 nun hafukha | ccc 0; these break the combining run, which is why `lib.js` `TETRA` excludes them. |
| **Masoretic dots** | 05AF masora circle, 05C4 upper dot, 05C5 lower dot | Rare (puncta extraordinaria, e.g. Gen 33:4). Ignore for singing. |
| **Invisible format chars** | U+034F CGJ, U+200C ZWNJ, U+200D ZWJ | CGJ blocks normalization from reordering marks; MAM inserts it inside Jerusalem and in the three dual-cantillation passages. ZWJ/ZWNJ encode meteg position inside/after a hataf vowel. **[verified: https://bdenckla.github.io/MAM-basics/MAM-for-Sefaria/ ; https://en.wikipedia.org/wiki/Meteg]** |
| **Presentation forms** | U+FB1D–FB4F | Precomposed letter+point (e.g. FB2A shin with shin dot). NFD decomposes them; MAM does not use them, but `lib.js` `HE_WORD` tolerates them. |

Practical rules for the engine:
- **Always NFD first**, then treat a word as runs of `letter + marks`. The canonical ordering puts sheva/vowel (ccc 10–20) before dagesh (21), meteg (22), rafe (23), shin/sin dot (24/25) and then accents (220/230), except where CGJ pins a different order. `hebrewKey()` in `lib.js` already does the NFD step. **[inferred from the ccc values above]**
- **Dagesh forte vs lene**: 05BC in a BeGaDKeFaT letter at the start of a word, or after a closed syllable (shva nach), is lene (changes the consonant only). 05BC in any letter after a full vowel is forte (geminate: closes the preceding syllable and starts the next). 05BC in final he = mappiq (he is pronounced /h/). 05BC on a vav that carries no other vowel = shureq /u/. **[inferred, standard grammar; havarotjs implements these]**
- **Holam on vav**: `vav + 05B9` with no vowel of its own on the vav is holam male /o/ (mater). `vav + 05BA` is MAM's explicit marking that the vav is a consonant with its own holam (עֲוֺנָהּ = *avonah*, Isa 40:2, seen in the Sefaria text today). Sefaria's text also writes some consonantal-vav holams with plain 05B9 followed by a vowel on the next letter; the disambiguating rule is "does the vav already have a vowel/sheva/dagesh?" havarotjs' `holemHaser: "update"` option rewrites those to 05BA. **[verified: Isa 40:2 fetched today contains U+05BA; havarotjs `text.d.ts`]**
- **Shin/sin**: 05C1 → /ʃ/, 05C2 → /s/. A shin with neither dot does not occur in MAM. **[inferred]**

### 1.2 Maqaf (U+05BE) **[verified: Wikipedia cantillation: "A group of words joined by hyphens is regarded as one word so they only have one accent between them"]**
Words joined by maqaf form one accent unit: only the last word carries the tonic accent; the earlier words lose their stress and are sung as unstressed syllables leading into it. In the sample, `וַיֹּאמֶר־ל֥וֹ` is one unit with the merkha on `לוֹ`, so `va-yo-mer` has no tonic syllable. A maqaf-joined non-final word may still carry a meteg (secondary stress). MAM also has `<span class="mam-implicit-maqaf">` for maqafs the editors infer from accent context (gray in Wikisource) — treat as a maqaf. **[verified: MAM-for-Sefaria doc]** Chains of three or more occur (`אֶת־כׇּל־`, `מַה־יֶּשׁ־לָּךְ` in II Kings 4:2, fetched today).

### 1.3 Paseq, legarmeh, shalshelet **[verified: MAM-for-Sefaria encoding doc; I Sam 20:21/25/41/42 fetched today]**
Both use U+05C0. MAM distinguishes them by markup:
- **Legarmeh** (munach legarmeh, a disjunctive): `&thinsp;<b>׀</b>` then a normal space, e.g. `הַחִצִּ֣ים&thinsp;<b>׀</b> מִמְּךָ֣` (20:21), `כְּפַ֣עַם&thinsp;<b>׀</b> בְּפַ֗עַם` (20:25), `יִהְיֶ֣ה&thinsp;<b>׀</b> בֵּינִ֣י` (20:42).
- **Plain paseq** (a pause mark, not an accent): `&thinsp;<small>׀</small>&thinsp;`, e.g. `קָחֶ֧נּוּ&thinsp;<small>׀</small>&thinsp;וָבֹ֛אָה` (20:21, after a darga).
The repo's `tropePhrases()` ignores the tags and infers legarmeh from "munach + `׀` token" — correct for the common case, but the `<b>`/`<small>` distinction is a free, more reliable signal: use it. Shalshelet (05 93) is always followed by paseq in the 21 books. **[inferred]**

### 1.4 Pisqa, petuchah/setumah, nun hafukha **[verified: fetch.mjs; MAM doc]**
`{ס}`/`{פ}` after the sof pasuq = paragraph break (fetch.mjs stores `break: "setumah"|"petuchah"`); mid-verse = pisqa be'emtza pasuq (fetch.mjs: `<span class="pisqa">`). For singing: a pisqa is a breath/pause with no melodic effect; the final verse of the haftarah gets the closing melody regardless. Nun hafukha (`mam-spi-invnun`) occurs only in Numbers 10 and Psalms, never in a haftarah.

### 1.5 The divine name **[verified: https://en.wikipedia.org/wiki/Tetragrammaton ; https://en.wikipedia.org/wiki/Qere_and_Ketiv ; Sefaria MAM text fetched today]**
The Tetragrammaton is a *qere perpetuum*: written יהוה, read **Adonai**, and read **Elohim** when it is adjacent to אֲדֹנָי (so that one does not say "Adonai Adonai"). The Masoretes signal which by the vowels they put on the consonants:
- Vowels of *Adonai* (sheva, holam, qamats): **יְהֹוָה** → sing *a-do-NAI* [ʔa.do.ˈnaj]. MAM/Sefaria writes the holam (U+05B9) explicitly: I Sam 20:21 `יְהֹוָֽה׃`, Isa 40:2 `יְהֹוָ֔ה` (codepoints 05D9 05B0 05D4 05B9 05D5 05B8 05D4). The Aleppo/Leningrad codices usually omit the holam (יְהוָה); the engine should accept both.
- Vowels of *Elohim* (hataf segol, holam, hiriq): **יֱהֹוִה** → sing *e-lo-HIM* [ʔe.lo.ˈhim]. Verified in Ezek 37:19, 21 (the Vayigash haftarah): `אֲדֹנָ֣י יֱהֹוִה֒` = 05D9 **05B1** 05D4 05B9 05D5 **05B4** 05D4.
- Rule for the engine: match `lib.js` `TETRA`; if the first vowel is hataf-segol (05B1) or the last vowel is hiriq (05B4) → Elohim; else → Adonai. The accents on the name (e.g. the segolta 0592 at its end in Ezek 37:19) carry over to the substitute: *e-lo-HIM* with segolta on the last syllable. The hataf-segol/hiriq variant with no holam (יֱהוִה, Gen 15:2 in Leningrad) is covered by the same test. **[inferred rule, from the verified pointings]**
- havarotjs flags these words (`word.isDivineName === true`) and leaves them unsyllabified; hebrew-transliteration maps them to its `DIVINE_NAME` / `DIVINE_NAME_ELOHIM` schema strings (test output below printed `adonaj` and `elohim`). **[verified: scratchpad run]**
- Ordinary אֲדֹנָי, אֱלֹהִים, אֵל are normal words and sing from their own vowels. The sheet's "יי" substitution is for print only; the engine must substitute *before* syllabifying, on the pointed text.

### 1.6 Ketiv/qere **[verified: MAM-for-Sefaria doc; Sefaria v3 responses fetched today]**
The **qere is what is read aloud**; the ketiv is what is written. In MAM the ketiv is bare consonants in parentheses, the qere is pointed and accented in brackets:

```
<span class="mam-kq"><span class="mam-kq-k">(על)</span> <span class="mam-kq-q">[אֶל־]</span></span>הַלֶּ֖חֶם   (I Sam 20:24)
<span class="mam-kq"><span class="mam-kq-q">[הַ֣חִצִּ֔ים]</span> <span class="mam-kq-k">(החצי)</span></span>          (I Sam 20:38)
<span class="mam-kq"><span class="mam-kq-q">[לָ֖ךְ]</span> <span class="mam-kq-k">(לכי)</span></span>                   (II Kings 4:2)
<span class="mam-kq-trivial">חֲבֵרָ֑ו</span>                                                            (Ezek 37:19)
```
Order of k and q inside the span varies (k-first in 20:24, q-first in 20:38). Other shapes in the MAM doc: `mam-kq-k` alone with no parent = *ketiv velo qere* (written, not read: skip it entirely), `mam-kq-q` alone = *qere velo ketiv* (read, not written: sing it), `mam-kq-trivial` = qere shown without the ketiv (116 pairs, e.g. חֲבֵרָ֑ו "chaverav" where the ketiv lacks the yod). The qere in 20:24 ends in a maqaf inside the span and joins `הַלֶּ֖חֶם` with no space: tokenizers must look through the tag. `return_format=text_only` keeps the parentheses and brackets but drops the classes (`(על) [אֶל־]הַלֶּ֖חֶם`), so **use `default` (what fetch.mjs does) and resolve the spans yourself**; `site/app/sheet.js` already skips `.ketiv` for words. Rule: sing the `mam-kq-q` text (strip the brackets), drop `mam-kq-k`, sing `mam-kq-trivial` as-is. Jerusalem is a special qere perpetuum: written ירושלם, read *yerushalayim*; MAM encodes it as `יְרוּשָׁלַ֙͏ִם֙` (lamed + patah + pashta + CGJ + hiriq + final mem: the hiriq has no yod to sit under). **[verified: Isa 40:2 fetched today has U+034F in that word]**

---

## 2. Syllabification

### 2.1 The rules (Tiberian, as taught) and how chant simplifies them
- **Every syllable has exactly one vowel.** Sheva and hataf vowels are the whole problem. **Sheva na (vocal)**: word-initial; the second of two consecutive shevas mid-word; under a letter with dagesh forte; after a "long" vowel (qamats, tsere, holam, hiriq-yod, shureq); after a meteg; under the first of two identical letters. **Sheva nach (silent)**: everything else, including word-final and the first of two mid-word shevas. **[verified: https://en.wikipedia.org/wiki/Shva]** Modern Israeli speech collapses this to "pronounced /e/ in word-initial sonorant/prefix clusters, otherwise silent"; religious readers keep the traditional distinction. **[verified: same page]**
- **Real-world chant**: a cantor needs a note for every pronounced vowel, so every sheva na becomes a short syllable (*ye-ho-na-TAN*, *ve-nif-KAD-ta*). Sheva nach gets nothing. Hataf vowels are sung as short syllables (*shi-la-cha-CHA*, not *shil-cha-CHA*), even though grammars group a hataf with the following syllable. **[inferred, matches the Shva page's "standard syllabification groups a hataf with the following syllable even when Modern Hebrew pronounces it as a full syllable"]** What to confirm with the cantor: shva after a long vowel mid-word (וּבֵינְךָ: *u-vei-ne-CHA* by the book, *u-vein-CHA* in most Israeli mouths; יֵֽלְכוּ with meteg: *ye-le-CHU*).
- **Dagesh forte** geminates: the consonant closes one syllable and opens the next (*vay-YO-mer*, *yip-pa-KED*, *mim-me-CHA*). For singing, the double consonant is one onset with a slightly longer closure; the synthesizer gets the consonant twice (coda + onset) or once with a length flag — a representation choice, see §6.
- **Furtive patach**: final ח, ע or הּ with patah: the vowel is sounded *before* the consonant (נֹחַ *no-ach*, גָּבֹהַּ *ga-VO-ah*, רוּחַ *RU-ach*). It is never stressed; stress stays on the preceding syllable. **[verified: https://en.wikipedia.org/wiki/Patah]**
- **Qamats qatan** = /o/ in a closed unstressed syllable (כׇּל־ *kol*, חׇכְמָה *choch-MAH*); otherwise qamats gadol /a/. **MAM marks every qamats qatan with U+05C7** ("Qamaz qatan has been added in full"), verified in Sefaria's text today (`בְּכׇל־`, `וַיָּ֙קׇם֙`, `בׇּחֳרִי־אָ֑ף`, `מִֽמׇּחֳרַ֤ת`). So the engine does not need the rule, only the codepoint; hataf qamats (05B3) is also /o/. **[verified: https://en.wikisource.org/wiki/User:Dovi/Miqra_according_to_the_Masorah abstract; https://en.wikipedia.org/wiki/Kamatz; Sefaria text]** (Ashkenazi reading says /ɔ/ for every qamats, which removes the distinction; see §4.)
- **Vav/yod as vowel vs consonant**: vav with shureq dot or holam and no own vowel = /u/, /o/; yod after hiriq/tsere/segol with no own vowel = part of the vowel (/i/, /e/, /ei/); patah + yod + vowel = /aj/ (שְׁתַּיִם *SHTA-yim*); ־ָיו = /av/ (אֲדֹנָיו *a-do-NAV*), and the trivial-qere ־ָו (חֲבֵרָו) is also /av/. **[inferred; hebrew-transliteration has `MS_SUFX` for ־ָיו]**
- **Mappiq he** (הּ): pronounced /h/ at word end (צְבָאָהּ *tse-va-AH*, with audible h). Plain final ה is silent. **Quiescent alef**: alef with no vowel of its own is silent (וַיֹּאמֶר *va-YO-mer*, רֹאשׁ *rosh*, חַטֹּאת). Alef with a vowel is a glottal onset /ʔ/ (or nothing, in practice). **[inferred, standard]**
- **Meteg + sheva**: a sheva after a meteg-marked vowel is vocal (havarotjs `shevaAfterMeteg`, default true). **[verified: havarotjs `text.d.ts`]**

### 2.2 Libraries

| Tool | What it does | Language / license | Fit |
|---|---|---|---|
| **havarotjs** 0.25.5 (Charles Loder) | `new Text(str, opts)` → words → syllables → clusters → chars, with `isAccented`, `isClosed`, `isFinal`, `vowelNames`, `taamimNames`, `isDivineName`, ketiv/qere hook. Options: `qametsQatan`, `sqnmlvy` (sheva under שׁשׂסצנמלוי after vav-consecutive is vocal), `longVowels`, `wawShureq`, `article`, `shevaAfterMeteg`, `shevaWithMeteg`, `holemHaser`, `strict`, `allowNoNiqqud`, `ketivQeres`. README says test input should come from Sefaria's MAM; the source has explicit handling of MAM's "accent helpers" (doubled pashta/segolta/zarqa/telisha), furtive patach, ole-veyored and a Jerusalem hack. | TypeScript → ESM + CJS, **MIT**, zero runtime deps, dist ≈ 80 KB JS | **Strongest candidate.** Tested below. [verified: https://github.com/charlesLoder/havarotjs ; `node_modules/havarotjs/dist/utils/syllabifier.js` lines 353-460 read today] |
| **hebrew-transliteration** 2.11.0 (same author) | `transliterate(str, schema)` built on havarotjs; schemas (SBL academic/simple, Brill, Michigan-Claremont, Romaniote, JSS, Tiberian) plus a partial-schema override, `SYLLABLE_SEPARATOR`, `STRESS_MARKER`, `DIVINE_NAME`, `DIVINE_NAME_ELOHIM`, `ADDITIONAL_FEATURES` hooks per word/syllable/cluster. | MIT, bundles its own copy of havarotjs | Useful as a **reference and as a quick IPA string generator**; its output is a flat string, so for the synthesizer we want havarotjs' objects directly. Tested below. [verified: https://github.com/charlesLoder/hebrew-transliteration ; installed dist] |
| **phonikud** (Kolani, Melichov, Calev, Alper; Interspeech 2026) | Hebrew G2P: adds nikud with an ONNX model (phonikud-onnx), then rule-based FST to IPA **with stress** (ˈ before the vowel). Inventory: a e i o u + 24 consonants (b v d h z χ t j k l m n s f p ts tʃ w ʔ ɡ ʁ ʃ ʒ dʒ). Targets *modern spoken* Hebrew; adds an invented "vocal shva" mark (reusing U+05BD) because modern shva ≠ sheva na. No secondary stress. No JS port. | Python, code CC BY 4.0, models on Hugging Face | **Independent cross-check only** (run offline in Python on nikud-only text). Its modern-Hebrew shva and stress habits will disagree systematically with Tiberian chant. [verified: https://github.com/thewh1teagle/phonikud ; https://arxiv.org/abs/2506.12311] |
| **ReNikud** (same group, June 2026) | Char-level transformer with consonant/vowel/stress heads; higher accuracy than phonikud on the MILIM benchmark. | Python | Same role as phonikud if it ships a package. [verified: https://arxiv.org/abs/2606.20179 via search] |
| **nakdimon** (Gershuni), **unikud** (Alper), **Dicta Nakdan** API (+ `dicta-nakdan` npm client) | Add nikud to unpointed text. | Python / web API | **Not needed**: our text is already pointed by the Masoretes. [verified: search results] |
| **hebrew-phonemizer** | Not found as a package; the name turns up only in searches. [verified: search] | | Skip. |
| Python **`hebrew`** (avi-perl) | Grapheme handling, gematria, `no_taamim()`, `text_only()`. No syllabification, no phonemes. MIT. | Python | Skip. [verified: https://github.com/avi-perl/hebrew] |
| **MAM-parsed / MAM-basics** (Denckla) | The MAM text itself in JSON with its reader markup resolved (qere read, paragraph flags), and the encoding docs. | GitHub | Reference for the markup; also a fallback text source if Sefaria changes its classes. [verified: https://github.com/bdenckla/MAM-parsed] |

### 2.3 What havarotjs did on the sample verse (run today, Node 24, options `{ qametsQatan, sqnmlvy, wawShureq, article, longVowels: true, strict: false }`)

`ˈ` = `isAccented`, `]` = `isClosed`:

```
וַיֹּאמֶר־   וַ] | יֹּא | מֶר־]            (no accent: maqaf-joined)
ל֥וֹ          לֹ֥וˈ
יְהוֹנָתָ֖ן   יְ | הֹו | נָ | תָ֖ןˈ]
מָחָ֣ר        מָ | חָ֣רˈ]
חֹ֑דֶשׁ        חֹ֑ˈ | דֶשׁ]                 (mil'el, etnachta on first syllable)
וְנִפְקַ֕דְתָּ  וְ | נִפְ] | קַ֕דְˈ] | תָּ
כִּ֥י          כִּ֥יˈ
יִפָּקֵ֖ד      יִ] | פָּ | קֵ֖דˈ]            (יִ closed by the forte in פּ)
מוֹשָׁבֶֽךָ׃    מֹו | שָׁ | בֶֽˈ | ךָ׃          (silluq read as the accent)
```
**All 24 syllable boundaries and all 8 stresses are correct.** It treated the word-initial shevas as vocal, the two shevas in וְנִפְקַדְתָּ as silent, detected the forte in יִפָּקֵד and וַיֹּאמֶר (`isClosed` on the preceding syllable), and took the lone meteg on the last word as silluq. Note it normalizes holam-vav order in `.text` (`ל֥וֹ` → `לֹ֥ו`); `word.original` keeps the input, so map back through `original` when you need verse offsets.

On the whole haftarah (I Sam 20:18–42 from Sefaria, 25 verses) plus a set of edge words (`t2.mjs`):
- Right: doubled pashta (`וַיָּ֙קׇם֙` → stress on יָּ֙), doubled telisha gedola (`הַ֠מֶּ֠לֶךְ` → מֶּ), telisha qetana (`זֶ֩בַח֩`), zarqa + helper (`הַנַּ֘עַר֮` → נַּ), segolta final (`בָּא֒`), meteg as ga'ya not stress (`מָֽלְאָה֙` → אָה; `הֶֽעָקֹב֙` → קֹב), meteg-then-sheva vocal (`יֵֽלְכ֥וּ` → יֵֽ | לְ | כ֥וּ), sheva under forte vocal (`מִמְּךָ֣`), hataf as its own syllable (`שִֽׁלַּחֲךָ֖`), furtive patach (`גָּבֹ֤הַּ` → גָּ | בֹ֤ˈ | הַּ, stress kept off the patach), qamats qatan via U+05C7, holam haser for vav (`עֲוֺנָ֑הּ`), mappiq he kept, divine name flagged (`isDivineName`) for both pointings, wayyiqtol gemination (`וַיִּסָּתֵ֥ר` → וַ] | יִּ] | סָּ | תֵ֥ר).
- Wrong or needs care: **Jerusalem** `יְרוּשָׁלַ֙͏ִם֙` came out as four syllables with the last one `לַ֙͏ִם֙` (patah and hiriq in one syllable) — the engine must special-case it to *ye-ru-sha-LA-yim* (five syllables, stress on *la*). **Two-accent words** (`יְהֹ֣ונָתָ֔ן` munach + zaqef, `מֹ֨ושָׁבֹ֜ו` qadma + geresh) get `isAccented` on both syllables; the engine must pick the tonic (the disjunctive / the later one) and demote the other to secondary. **`&thinsp;` and `׀`** are not whitespace to havarotjs: decode entities and split on the paseq before calling it (my first run produced tokens like `הַחִצִּ֣ים&thinsp;׀`). The **shva-after-long-vowel** choice (`וּבֵינְךָ֖` → נְ as a syllable) is grammatically right but may not be what the cantor sings; it is a one-flag option (`longVowels: false`).

hebrew-transliteration with a custom modern-Israeli partial schema and `STRESS_MARKER: { location: "before-syllable", mark: "ˈ" }` gave, for the sample verse:

```
vaj.joʔ.meʁ-ˈlo jə.ho.na.ˈtan ma.ˈχaʁ ˈχo.deʃ və.nif.ˈkad.ta ˈki jip.pa.ˈked mo.ʃa.ˈve.χa
```
Stress and syllables right; two phoneme faults: quiescent alef rendered as `ʔ` (joʔ, toʔ) and my `SHEVA: "e"` override did not take (it kept `ə`). On the edge words: `adonaj`/`elohim` substituted correctly, `ɡa.ˈvo.ah` right, `bə.χol-` right, but the stress mark lands on the wrong side of a geminate boundary (`vajˈ.ja.kom`, `hamˈ.me.leχ`) and Jerusalem is `jə.ʁu.ʃa.ˈlaī͏m`. Conclusion: use havarotjs' object model, not the string transliterator, and write the phoneme map ourselves.

---

## 3. Stress

- **Default: the tonic syllable is the one carrying the accent mark** (mil'ra, final-syllable stress, is the common case; mil'el, penultimate, is marked the same way, as in חֹ֑דֶשׁ). **[verified: Wikipedia cantillation ("Kadma… always on the accented syllable"); Sephardi Hebrew page: "stress tends to fall on the last syllable wherever Biblical Hebrew does"]**
- **Exceptions are the edge-fixed marks.** Postpositive (always on the last letter): pashta 0599, segolta 0592, telisha qetana 05A9, zarqa 05AE. Prepositive (always on the first letter): yetiv 059A, telisha gedola 05A0, and dehi 05AD (poetic books only, never in a haftarah). **[verified: Wikipedia Pashta: "placed on the last letter as well as on the accented syllable, if it's not the last"; Yetiv: "placed under the letter of the first syllable that is stressed… word is prototonic"; havarotjs source comments; MAM version notes]**
- **MAM already resolves them.** Sefaria's version notes: "When an accent is marked in an unstressed syllable, an extra accent is added in the proper place (pashta, zarqa, segol, telisha)." Verified in today's fetches: `הַחֹ֙דֶשׁ֙` (pashta twice: stress on חֹ), `וַיָּ֙קׇם֙`, `הַ֠מֶּ֠לֶךְ` and `הַ֠נְּבִיאִ֠ים` (telisha gedola twice: the *later* one is the stress), `זֶ֩בַח֩` (telisha qetana twice: the *earlier* one), `הַנַּ֘עַר֮` (zarqa 05AE at the edge, helper 0598 on the stressed syllable), `יֹאשִׁיָּ֒הוּ֒`-style doubled segolta (havarotjs comment). So the rule is: **the stress is on the copy that is not at the word edge; if there is only one copy, the stress is on the edge syllable** (final for postpositives; first for prepositives, and yetiv only ever occurs on first-syllable-stressed words). No meteg lookup is needed. For the older Sefaria version "Tanach with Ta'amei Hamikra" (tanach.us) this is not true; stay on MAM. **[verified: Sefaria `versionNotes` field in today's API response; texts above]**
- **Secondary stress (meteg/ga'ya, 05BD)**: a lighter stress one or more syllables before the tonic, mostly on open syllables two away from the accent and on long vowels before a sheva (יְהֽוֹנָתָן֙, מָֽלְאָה֙, וַֽיִּשְּׁק֣וּ, אַֽל־). Silluq is the same codepoint on the last word before 05C3; a meteg elsewhere is never the tonic (a word with both a meteg and an accent takes the accent). On a maqaf-joined non-final word that has only a meteg (`אַֽל־תַּעֲמֹ֑ד`, `לְשַֽׁלַּֽח־לִ֖י`), the meteg is the only prominence; sing it as secondary. For the synthesizer, secondary stress is a mild lengthening/weight, not a motif. **[verified: Meteg page; MAM texts; inferred for the singing treatment]**
- **Conjunctive on the same word as a disjunctive** (munach + zaqef `יְהֹ֣ונָתָ֔ן`, qadma + geresh `מֹ֨ושָׁבֹ֜ו`): the disjunctive (later mark) is the tonic and takes the motif; the earlier conjunctive mark is a secondary stress and, in TropeTrainer practice, the conjunctive's note is folded into the start of the motif. **[inferred from practice; confirm with the cantor]**
- **Furtive patach** never takes stress even when the mark sits on that letter (havarotjs enforces this). **[verified: havarotjs source]**

---

## 4. Pronunciation

- **Which tradition.** Modern Israeli ("Sephardic-style") pronunciation is what American non-Orthodox congregations have used since roughly mid-century; Wikipedia's Sephardi Hebrew page documents the features and the ha-historion/Jewish Link essays describe the post-1948 drift of American congregations toward Israeli pronunciation. I could not find a Reform-movement or ACC document that states this as policy. **[inferred; partly verified: https://en.wikipedia.org/wiki/Sephardi_Hebrew ; https://jewishlink.news/ashkenazim-and-the-sephardic-pronunciation-of-hebrew-part-iii/]** The choices to confirm with Cantor Finkel are listed at the end; the engine should treat them as a small config table (`pronunciation.json`), since each is a one-line mapping.
- **Modern Israeli inventory** **[verified: https://en.wikipedia.org/wiki/Modern_Hebrew_phonology ; matches phonikud's inventory]**: stops p b t d k ɡ ʔ; affricate ts (tʃ, dʒ only in loans); fricatives f v s z ʃ χ h (ʁ for resh); nasals m n; approximants l j (w in loans). Vowels a e i o u, no length contrast; diphthongs aj, ej (av for ־ָיו, oj in loans). Mergers: ח = כ rafe = /χ/, ע = א = /ʔ/ (or nothing), ק = כּ = /k/, ת = תּ = /t/, ו = /v/. Ashkenazi differs on: ת rafe → /s/, qamats → /ɔ/ (or /o/, /u/ by region), holam → /oj/, /au/, /ou/, tsere → /ej/, and a penultimate-stress habit in colloquial reading. **[verified: https://en.wikipedia.org/wiki/Ashkenazi_Hebrew]**
- **Proposed phoneme table** (engine-internal symbol → IPA → X-SAMPA → ARPAbet-like → DiffSinger name with the openvpi language prefix `he/`). DiffSinger dictionaries are `syllable<TAB>ph1 ph2…` text files, one per language, phonemes are language-prefixed (`zh/a`, `en/eh`, so ours would be `he/a`), `SP` and `AP` are reserved global tags, and `/ - +` are forbidden in syllable names. OpenUtau's YAML dictionaries declare `symbols: [{symbol, type: vowel|stop|fricative|…}]` and `entries: [{grapheme, phonemes}]`. **[verified: https://github.com/openvpi/DiffSinger/blob/main/docs/BestPractices.md ; https://github.com/stakira/OpenUtau/wiki/Developing-new-phonemizers]** The ARPAbet column is only for a path through an English-trained voice (chant-audio.md path 2); expect an accent there.

| Hebrew | IPA | X-SAMPA | ARPAbet-ish | DiffSinger | type |
|---|---|---|---|---|---|
| א (with vowel), ע | ʔ | ? | (none) | he/q | stop (often dropped) |
| בּ / ב | b / v | b / v | B / V | he/b, he/v | stop / fricative |
| ג | ɡ | g | G | he/g | stop |
| ד | d | d | D | he/d | stop |
| ה, הּ | h | h | HH | he/h | aspirate |
| ו | v | v | V | he/v | fricative |
| ז | z | z | Z | he/z | fricative |
| ח, כ/ך | χ | X | (HH or K; no match) | he/x | fricative |
| ט, ת, תּ | t | t | T | he/t | stop |
| י | j | j | Y | he/y | semivowel |
| כּ, ק | k | k | K | he/k | stop |
| ל | l | l | L | he/l | liquid |
| מ/ם | m | m | M | he/m | nasal |
| נ/ן | n | n | N | he/n | nasal |
| ס, שׂ | s | s | S | he/s | fricative |
| פּ / פ/ף | p / f | p / f | P / F | he/p, he/f | stop / fricative |
| צ/ץ | ts | ts | T S | he/ts | affricate |
| ר | ʁ (or r) | R (or r) | R | he/r | liquid |
| שׁ | ʃ | S | SH | he/sh | fricative |
| patah, qamats gadol, hataf patah | a | a | AA | he/a | vowel |
| segol, tsere, hataf segol, vocal sheva | e | e | EH | he/e | vowel |
| hiriq | i | i | IY | he/i | vowel |
| holam, qamats qatan, hataf qamats | o | o | OW | he/o | vowel |
| qubuts, shureq | u | u | UW | he/u | vowel |
| patah+yod, qamats+yod (אֲדֹנָי) | aj | aj | AY | he/a he/y | — |
| tsere/segol + yod | ej (or e) | ej | EY | he/e he/y | — (cantor's choice) |

Sheva nach, quiescent alef, silent final he, dagesh lene/forte dots and all accents produce no phoneme. Tsere-yod as /ej/ vs /e/ and whether vocal sheva is /e/ or a reduced [ə] are cantor choices.

---

## 5. Any verse: fetching from Sefaria

- Endpoint (already in fetch.mjs): `GET https://www.sefaria.org/api/v3/texts/{ref}?version=hebrew|Miqra according to the Masorah&return_format=default`. `version` takes `language` or `language|versionTitle` (URL-encode the pipe and spaces); `return_format` ∈ `default` (stored HTML, what we want), `wrap_all_entities`, `text_only` (strips tags; keeps the ketiv parentheses, loses the classes), `strip_only_footnotes`. The response's `versions[0].text` is a flat array for one chapter or nested arrays across chapters (fetch.mjs `flattenVerses` handles both); `available_versions` lists the other Hebrew texts (`Tanach with Ta'amei Hamikra`, `Tanach with Nikkud`, `Tanach with Text Only`), none of which have MAM's stress helpers. License of MAM on Sefaria: CC-BY-SA. **[verified: https://developers.sefaria.org/reference/get-v3-texts ; responses fetched today for I Sam 20:18, I Sam 20:18-42, Isa 40:1-5, II Kings 4:1-3, Ezek 37:19-21]**
- Spanning refs work (`Isaiah 40:1-5` returned `isSpanning: false`, `next`/`prev`); fetch.mjs's `DEFAULT_HAFTAROT` table has semicolon-separated multi-range readings (`Isaiah 27:6-28:13; 29:22-23`), which it already splits per range. So **the engine can take any `Book c:v-c:v` string and get MAM text**: reuse `sefariaText()` and `cleanHebrew()` from fetch.mjs (export them) and cache `weeks/<slug>/sheet.json` or a `cache/text/<ref>.json`. Rate: be polite (the repo already uses a pool of 4 and a UA string). The Sefaria MCP tool in this workspace (`mcp__claude_ai_Sefaria__get_text`) is an alternative for ad-hoc lookups but not for the build.
- A fallback that needs no network: Denckla's **MAM-parsed** JSON on GitHub (the same text, markup resolved). **[verified: https://github.com/bdenckla/MAM-parsed]**

---

## 6. Recommended pipeline and tests

### 6.1 Dependency-free, concretely
The repo's rule is "Node 18+, nothing to install, no `npm install`". That is compatible with **vendoring** a library's built files under its license: copy `havarotjs/dist/esm/*.js` (≈80 KB unminified, pure ESM, no runtime deps) to `template/vendor/havarotjs/` with its `LICENSE` (MIT) and a one-line provenance note (version 0.25.5, commit/date), the way `template/fonts/` carries the OFL files. Do **not** vendor hebrew-transliteration (another 130 KB, and it bundles a second copy of havarotjs); we need objects, not strings. Writing our own syllabifier is a false economy: havarotjs encodes several years of edge cases (the `syllabifier.js` accent section alone handles the seven MAM helper patterns) and is tested against the MAM text we use. What we write ourselves is small and ours to decide: (1) the HTML/markup resolver (qere, paseq, entities, divine name, Jerusalem), (2) the accent → trope-role layer (reusing `BLOCK_ENDING`), (3) the phoneme map driven by `pronunciation.json`. All pure functions, UMD-or-ESM like `lib.js`, so the same code runs in `scripts/` tests and in `site/app/`.

### 6.2 Stages
```
sheet.json verses[].he  (or a fresh Sefaria fetch)
  1. resolve markup   : NFD; decode &nbsp;/&thinsp;; strip <sup>*</sup><i class=footnote>;
                        drop .mam-kq-k; unwrap .mam-kq-q / .mam-kq-trivial (strip [ ]);
                        <b>׀</b> → LEGARMEH token, <small>׀</small> → PASEQ token;
                        .pisqa → PISQA token; implicit maqaf → maqaf
  2. divine name      : TETRA match → replace with pointed אֲדֹנָי / אֱלֹהִים, carrying the accents
                        onto the last syllable's consonant; record `name: "adonai"|"elohim"`
  3. special lexemes  : Jerusalem (CGJ pattern) → יְרוּשָׁלַיִם with the stress on לַ; table for any
                        other hand-fixed words (grows from the test fixtures)
  4. syllabify        : havarotjs Text(..., opts) per accent unit (maqaf chain = one unit);
                        map syllables back to verse offsets through word.original
  5. stress           : tonic = the unit's last disjunctive/accent syllable per §3; demote other
                        accented syllables to secondary; meteg → secondary; maqaf non-final → none
  6. trope            : per unit: accent name(s) from codepoints; family from BLOCK_ENDING (+ legarmeh
                        from the token, + sof-pasuk / sof-haftarah); position in phrase
                        (index, count, isLast) so the motif knows where the cadence goes
  7. phonemes         : cluster → phoneme list via pronunciation.json; dagesh forte → coda+onset;
                        furtive patach → vowel before consonant; quiescent alef/silent he → nothing
  8. emit             : verse JSON (below) + optional DiffSinger .ds / dictionary rows
```

### 6.3 Output representation (per verse)
```jsonc
{
  "ref": "I Samuel 20:18", "version": "Miqra according to the Masorah", "pronunciation": "israeli-v1",
  "final": false,                       // last verse of the haftarah → sof-haftarah cadence
  "units": [                            // one per accent unit (maqaf chain); words inside
    { "text": "וַיֹּאמֶר־ל֥וֹ", "words": ["וַיֹּאמֶר־", "ל֥וֹ"], "range": [0, 13],
      "accents": [{ "name": "merkha", "cp": "05A5", "role": "conjunctive" }],
      "trope": { "family": "etnachta", "phrase": 0, "pos": 0, "of": 4 },
      "syllables": [
        { "he": "וַ",  "ph": ["v","a","j"],  "stress": null,  "closed": true,  "note": "closed by forte in י" },
        { "he": "יֹּא", "ph": ["j","o"],      "stress": null,  "closed": false, "note": "quiescent alef" },
        { "he": "מֶר", "ph": ["m","e","r"],  "stress": null,  "closed": true },
        { "he": "ל֥וֹ", "ph": ["l","o"],      "stress": "tonic", "accent": "merkha", "closed": false }
      ] },
    { "text": "יְהוֹנָתָ֖ן", "accents": [{ "name": "tipcha", "cp": "0596", "role": "disjunctive" }],
      "trope": { "family": "etnachta", "phrase": 0, "pos": 1, "of": 4 },
      "syllables": [
        { "he": "יְ",  "ph": ["j","e"], "stress": null, "sheva": "na" },
        { "he": "הוֹ", "ph": ["h","o"], "stress": null },
        { "he": "נָ",  "ph": ["n","a"], "stress": null },
        { "he": "תָ֖ן", "ph": ["t","a","n"], "stress": "tonic", "accent": "tipcha", "closed": true }
      ] }
    // … מָחָ֣ר (munach) | חֹ֑דֶשׁ (etnachta; tonic = syllable 0, mil'el) | וְנִפְקַ֕דְתָּ (zaqef gadol; tonic = קַד)
    //   | כִּ֥י (merkha) | יִפָּקֵ֖ד (tipcha; "yip|pa|KED") | מוֹשָׁבֶֽךָ (silluq; tonic = בֶ, family sof-pasuk)
  ],
  "ipa": "va.jo.meʁ-ˈlo je.ho.na.ˈtan ma.ˈχaʁ ˈχo.deʃ ve.nif.ˈkad.ta ˈki jip.pa.ˈked mo.ʃa.ˈve.χa"
}
```
Phrase grouping for this verse under the repo's TropeTrainer rule: **etnachta** block = `וַיֹּאמֶר־לוֹ יְהוֹנָתָן מָחָר חֹדֶשׁ` (the tipcha folds forward), **zaqef-gadol** block = `וְנִפְקַדְתָּ`, **sof-pasuk** block = `כִּי יִפָּקֵד מוֹשָׁבֶךָ` (tipcha folds forward). Per-word accents: merkha, tipcha, munach, etnachta, zaqef gadol, merkha, tipcha, silluq. **[verified: codepoints dumped in `t1.mjs`; grouping per lib.js]**

Keep `he` per syllable as the exact NFD substring so the web sheet can highlight syllables (karaoke) without a second alignment, and keep `range` per unit so `findHebrew()`-style matching still works.

### 6.4 Edge cases for the test fixtures (each with the verse it occurs in, all from texts fetched today unless noted)
1. Maqaf chains of 2 and 3+ words; a chain whose last word is monosyllabic (`אֶת־אֶחָ֑י`, `מַה־יֶּשׁ־לָּךְ` II Kings 4:2); a chain whose non-final word has a meteg (`אַֽל־תַּעֲמֹ֑ד` 20:38, `לְשַֽׁלַּֽח־לִ֖י` 20:20).
2. Doubled postpositives: pashta `הַחֹ֙דֶשׁ֙` (20:27), `וַיָּ֙קׇם֙` (20:25), `יְרוּשָׁלַ֙͏ִם֙` (Isa 40:2, with CGJ); telisha qetana `זֶ֩בַח֩` (20:29); zarqa+helper `הַנַּ֘עַר֮` (20:41); doubled segolta (`יֹאשִׁיָּ֒הוּ֒`, II Kings 22/23, from havarotjs' comment).
3. Single postpositive on a final-stressed word: `אָמֹר֩` (20:21), `מָֽלְאָה֙`, `בָּא֒` (20:41), `אֹמַר֙` (20:22).
4. Doubled prepositive telisha gedola `הַ֠מֶּ֠לֶךְ` (20:25), `הַ֠נְּבִיאִ֠ים` (II Kings 4:1); a yetiv word (any `059A`, e.g. find one in Isaiah 40–41).
5. Legarmeh `<b>׀</b>` (20:21, 20:25, 20:41, 20:42) vs plain paseq `<small>׀</small>` (20:21 after darga); shalshelet + paseq (Gen 19:16 is Torah; find a haftarah one or mark "untested").
6. Meteg as silluq vs ga'ya; meteg before sheva (`יֵֽלְכוּ`, `וַֽיִּשְּׁק֣וּ` 20:41); meteg with ZWJ/ZWNJ inside a hataf (search the corpus).
7. Ketiv/qere, all four shapes: k-first (20:24), q-first (20:38, II Kings 4:2, 4:3), trivial (Ezek 37:19 `חֲבֵרָ֑ו`, with the ־ָו = /av/ ending), qere-velo-ketiv and ketiv-velo-qere (grep MAM-parsed for examples; II Sam 8:3 / Ruth 3:12 are classic).
8. Divine name with Adonai vowels (`יְהֹוָֽה׃` 20:21; `חַי־יְהֹוָֽה` joined by maqaf), with Elohim vowels after אֲדֹנָי (Ezek 37:19, 21 — note the accent on the Name is a segolta), the Name carrying pashta (`יְהֹוָה֙` 20:42), and the Name inside a ketiv/qere span if any exists.
9. Qamats qatan `בְּכׇל־`, `וַיָּ֙קׇם֙`, `בׇּחֳרִי־אָ֑ף` (20:34, with hataf qamats), `מִֽמׇּחֳרַ֤ת` (20:27).
10. Holam haser for vav `עֲוֺנָ֑הּ` (Isa 40:2) vs holam male `ל֥וֹ`; consonantal vav with holam written with plain 05B9 (`מִצְוֹת`-type; search).
11. Mappiq he `צְבָאָ֔הּ`, `עֲוֺנָ֑הּ`; furtive patach `גָּבֹ֤הַּ` (Isa 40:9), `מַדּ֜וּעַ` (20:27), `לֹקֵ֙חַ֙` (Ezek 37:21, furtive patach *and* doubled pashta on the same word), `יְהוֹשֻׁעַ`-type.
12. Quiescent alef `וַיֹּאמֶר`, `רֹ֣אשׁ`, `חַטֹּאתֶֽיהָ`, `לֵאמֹ֔ר` (20:42); alef with vowel `אֵלֶ֔יהָ`.
13. Sheva: initial cluster `שְׁתַּ֣יִם`; two mid-word shevas `וְנִפְקַ֕דְתָּ`, `יִשְׁמְרוּ`; under forte `מִמְּךָ֣`; after long vowel `וּבֵינְךָ֖` (20:23) and `וָהָ֑לְאָה` (20:22); sqnmlvy `וַיְהִ֣י` (20:24), `וַיְלַקֵּ֞ט` (20:38); article `הַֽמְכַסֶּ֣ה`; final sheva `לֵ֖ךְ`; double final sheva `וַיֵּבְךְּ` (Gen; find a Prophets one), `אַתְּ`.
14. Dagesh lene vs forte: `בַּשָּׂדֶ֑ה`, `הַקִּ֔יר`, BeGaDKeFaT after shva nach `תִּכְתֹּ֧ב` (Ezek 37:20).
15. Two accents on one word: `יְהֹ֣ונָתָ֔ן` (20:25), `מֹ֨ושָׁבֹ֜ו` (20:25), `וְיָ֣שַׁבְתָּ֔` (20:19), `וְהַ֨דָּבָ֔ר` (20:23).
16. Unaccented words: maqaf-joined, and words with only a meteg.
17. Pisqa mid-verse, petuchah after a verse that continues (`{פ}<br>` with text after it in 20:27 — the API returns the `<br>` and the next verse's text in the same string? No: 20:27 in today's dump has `{פ}<br>` then the verse text continues — that is a mid-verse pisqa with a line break; `cleanHebrew` handles it).
18. The haftarah's last verse (sof-haftarah motif) and a haftarah with two ranges (`Isaiah 27:6-28:13; 29:22-23`).
19. Sefaria markup noise: `<sup>*</sup><i class="footnote">…</i>`, `&nbsp;` runs, `<span class="mam-implicit-maqaf">`, `mam-spi-invnun`.

### 6.5 Validation plan
- **Gold set.** Daniel or the cantor syllabifies 3–5 haftarot by hand in a simple text form (`ye-ho-na-TAN ma-CHAR CHO-desh …`, capitals = tonic). A test parses that form and compares syllable count, boundaries and tonic index per word; report per-rule error classes (sheva, forte, furtive, edge-accent). Target: 0 stress errors, under 1% boundary disagreements (and those are usually the shva-after-long-vowel choice, which becomes a config flag once decided).
- **phonikud cross-check** (offline, Python, not part of the repo): strip te'amim, keep nikud, run `phonikud.phonemize()` on each verse, align its IPA words to ours and diff phoneme strings and stress positions. Expect systematic disagreements on vocal sheva (modern vs Tiberian), on pausal and archaic forms, and on resh; everything else that differs is a candidate bug on one side. Because phonikud is modern-Hebrew G2P, treat agreement as reassurance, disagreement as a review queue, not as ground truth.
- **Invariants** (node --test, every verse of every fetched haftarah): resolver output round-trips to the verse text minus markup; every accent unit has exactly one tonic syllable unless it is a maqaf-joined non-final word with no accent; the tonic syllable contains the tonic accent's codepoint or its MAM helper; number of syllables = number of vowels (counting hataf and vocal sheva, excluding furtive patach); no syllable has two vowels; every consonant letter yields 0 or 1 onset/coda phoneme; no `undefined` phoneme; `havarotjs` never throws (run with `strict: false` and log words it would reject under `strict: true`).
- **Trope agreement**: for every verse, the families the engine assigns equal `tropeFamiliesUsed()` from `lib.js`, so the chanter's copy and the audio never disagree.
- **Listening test**: render 10 verses with the concatenative path from chant-audio.md §2(d).3 and have the cantor mark wrong stresses; feed each into the fixtures.

---

## Questions only Daniel or the cantor can answer

1. **Pronunciation tradition**: Modern Israeli throughout (ת rafe = /t/, qamats = /a/ except qamats qatan /o/, ח and כ rafe both /χ/, ע silent or glottal, resh uvular /ʁ/)? Or does Cantor Finkel sing a trilled /r/, a distinct pharyngeal ח/ע, or tsere as /ej/ (*bei-NI* vs *be-NI*)?
2. **Vocal sheva**: a full short /e/ syllable (what a synthesizer can sing) or a reduced glide? And after a long vowel mid-word (`וּבֵינְךָ`, `יֵֽלְכוּ`): *u-vei-ne-CHA* (Tiberian rule) or *u-vein-CHA* (Israeli habit)? One flag either way.
3. **Hataf vowels**: always a sung syllable (*shi-la-cha-CHA*)? Any he elides?
4. **Furtive patach**: sung as its own short note before the consonant (*ga-VO-ah*, two notes) or as a glide inside the stressed note?
5. **Dagesh forte**: does he audibly lengthen the consonant (*yip-pa-KED*), or is it a modern single consonant? Affects whether the synth gets coda + onset or one onset.
6. **Divine name**: *Adonai* everywhere in the Adonai pointing, *Elohim* in the Elohim pointing — or does CRC use another substitution in chanted haftarah (e.g. *Hashem* in rehearsal recordings)?
7. **Two accents on one word** (munach + zaqef, qadma + geresh): does he sing the conjunctive's note on the earlier syllable, or treat it as plain secondary stress?
8. **Secondary stress (meteg)**: should the synthesizer do anything with it at all, or is only the tonic syllable musically meaningful in his style?
9. **Jerusalem and other reading conventions**: any words he reads differently from the pointing (e.g. *Yisra'el* vs *Yis-ra-EL* syllable count, `־ָיו` as *-av*)?
10. **Gold set**: which 3–5 haftarot will he (or Daniel) syllabify by hand, and in what notation? Would he rather correct the engine's output than write from scratch?
11. **Scope**: haftarot only (21-book accents, no dehi/ole-veyored), or should the engine also cover Torah and Megillot (same text system, different melodies; Esther/Lamentations/Song of Songs/Ruth/Ecclesiastes are also 21-book accents, Psalms/Proverbs/Job are not)?
12. **Vendoring approval**: is copying havarotjs' MIT-licensed `dist/esm` into `template/vendor/` acceptable under the repo's "nothing to install" rule, as the fonts are?
