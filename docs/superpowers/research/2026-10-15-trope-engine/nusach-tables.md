# Nusach tables: what to transcribe after Binder/Avery, and from which source

Research round 1, 2026-10-15. Companion to `trope-grammar.md` (Eastern Ashkenazi haftarah cells, §2.3) and `torah-grammar.md` (Eastern Ashkenazi Torah, written by another agent; not repeated here).

Daniel's ruling (2026-10-15): the engine offers **options**. Each option is a cell table transcribed from a **standard published melody**, and each table cites its printed or recorded source. This report asks, for each candidate nusach: what is the best transcribable source, how is the tradition built musically, and how far is it from the engine's Eastern Ashkenazi model (cell = trope x context, upbeats + core in scale degrees, the three syllable-fitting rules, `trope/cells/haftarah.json`).

Marks: **[V]** I read it myself in the source cited (for printed music: I read the notes off the scan; a second reader should check them before they become JSON). **[I]** my inference. **[needs the book]** I could not see the source.

---

## 0. Bottom line

1. **The best single source for the non-Ashkenazi traditions is A. Z. Idelsohn's *Thesaurus of Oriental Hebrew Melodies* (1914-1929). It is in the public domain and is scanned on archive.org.** Vol. 5 (Moroccan, 1929) has a full Moroccan Prophets table, a Spanish-Moroccan (Gibraltar) Prophets table, the Shabbat Hazon haftarah, and Moroccan Torah tables. Vol. 4 (Oriental Sephardim, 1923) has the Oriental-Sephardi Prophets table, an Aleppo Prophets table and an Aleppo Torah table. Vol. 1 (1914) is Yemenite. TropeTrainer's successor product labels its Moroccan voicing "Sephardic Moroccan (Idelsohn)" [V https://www.tropetrainer.com/voicing], so the commercial product draws on the same source.
2. **Spanish & Portuguese (London) is the easiest non-Ashkenazi table and fits the cell model almost exactly.** The S&P *Daily and Occasional Prayer Book* prints a complete haftarah ta'amim table in staff notation and tonic sol-fa, including conjunctive+disjunctive pairs, which is our `before` context. A scan is online and there are matching recordings.
3. **Moroccan and Oriental-Sephardi/Syrian haftarah break the "one distinct motif per ta'am" assumption more than they break the cell model.** Most te'amim are two- to four-note figures on or next to a reciting tone, and several disjunctives share one figure. The cell/upbeat model still works. It needs (a) cell aliasing (one cell serving several te'amim), (b) a per-table "reciting tone" fallback for te'amim the source does not notate, and (c) for Syrian, non-tempered intervals (fractional semitones, which `midi.mjs` currently truncates).
4. **Yemenite is the one real outlier.** It has eight motifs in four classes, and the conjunctives are a monotone. It needs a ta'am-to-class map before cell lookup, which is small work.
5. **Pronunciation is coupled.** Every Sephardi/Mizrahi table needs a matching `pronunciation.json` profile with pharyngeal ח/ע, and S&P needs ע as [ŋ]. The current symbol set and the synthesis phoneme maps have none of these.

**Recommended order after Binder/Avery:** (1) Ashkenazi traditional, from Jacobson; (2) Moroccan, from Idelsohn vol. 5 no. 271, checked against a modern recording; (3) Spanish & Portuguese, from the London prayer book; (4) Syrian/Oriental Sephardi, from Idelsohn vol. 4 nos. 312/328, checked against the pizmonim.org Kairey haftarot. Details in §8.

---

## 1. Copyright frame (applies to every row below)

- **The melodies are traditional oral chant.** No one owns "how Moroccans chant tevir".
- **A printed notation edition is a copyrighted work** where it is recent: Jacobson 2002/2017, Portnoy & Wolff 2000-2002, Neeman 1955, the 1965 S&P prayer book, Rodrigues Pereira 1994, Tunkel 2004. TropeTrainer's `tropedef.xml` is Kinnor's data (trope-grammar §5) and is a reference only.
- **Reducing a printed melody to a table of scale degrees** (deg, held/short, trope, context) keeps the melodic facts and drops the engraving, layout, rhythm detail, commentary and selection. That is our own expression. The risk is low for a short table of motifs. It rises if we reproduce a book's *whole verses or exercises* or its exact ordering and text, or if we ship a book's audio. [I; not legal advice]
- **Public domain:** Idelsohn's *Thesaurus* vols. 1-5 (published 1914-1929; Idelsohn died 1938): published before 1931, so PD in the US as of 2026, and life+70 has expired elsewhere. Also the *Jewish Encyclopedia* (1906), Baer's *Ba'al T'fillah* (1877), Sulzer, and Idelsohn's *Jewish Music in its Historical Development* (1929, PD in the US as published 1929).
- **Recordings** (pizmonim.org, londonsephardimusic.org, Darké Abotenou, chabad.org) are used only as **listening checks** to confirm or correct a printed table. We cite them; we neither copy nor ship their audio. londonsephardimusic.org explicitly allows non-commercial use with attribution [V].
- **Flag:** the S&P 1965 table and anything from Jacobson are recent editions. Transcribing their cells to degrees is fine in my judgment, but cite them and do not reproduce their pages. Prefer PD cross-checks (Idelsohn, JE 1906, Baer) where they exist.

---

## 2. Structural typology: does the cell model fit?

| Type | Traditions | What a "cell" is | Engine fit |
|---|---|---|---|
| **A. One motif per ta'am, context-sensitive** | Eastern Ashkenazi (Binder, Jacobson, Rosowsky, Chabad), Western Ashkenazi/British, Spanish & Portuguese | Each ta'am has its own figure; conjunctives have figures that change with the following disjunctive | **Fits as is.** Western Ashkenazi adds a coda on every verse ending (an `endOfVerse` context) |
| **B. Few figures around a reciting tone; disjunctives share figures** | Moroccan (general and Spanish-Moroccan), Oriental Sephardi / Jerusalem / Syrian haftarah | Conjunctives and near-companions (tipcha, pashta, zarka) are short lead-ins on the reciting tone. Second- and third-level disjunctives share one or two cadential figures | **Fits with aliasing plus a reciting-tone fallback.** Same word-level cells, but many te'amim point to one cell, and unlisted te'amim recite on the tone |
| **C. Class-based (Babylonian residue)** | Yemenite | 8 motifs in 4 patterns: *molikh* (conjunctives and minor disjunctives), *mafsik* (most 3rd-level), *ma'amid* (most 2nd-level), etnachta and silluq | **Needs a ta'am-to-class map** before cell lookup; the conjunctives are a monotone |
| **D. Maqam-based melody over the ta'amim** | Syrian (Aleppo) Torah in sigah; Syrian haftarah; weekly-maqam inflection of the prayers | Motifs as in B, but in a non-tempered maqam (sigah = E half-flat; bayati with a neutral 2nd) | **B plus microtones.** Fractional semitones in the degree map, and pitch bend or float MIDI in the renderer |

Sources for the typology: Wikipedia, "Hebrew cantillation" [V https://en.wikipedia.org/wiki/Hebrew_cantillation]. Quotes: "in the Sephardi haftarah modes different disjunctives often have the same or closely similar motifs, reducing the total number of effective motifs" to about eight. "In the Sephardic cantillation modes ... the conjunctives (and to some extent the 'near companions' such as tifcha, pashta and zarqa) are rendered as flourishes leading into the motif of the following disjunctive rather than as motifs in their own right." The one-motif-per-symbol reinterpretation "has gone furthest in the Western Ashkenazi and Ottoman (Jerusalem-Sephardi, Syrian etc.) traditions." On the Yemenite system: "eight distinctive motifs ... molikh ... mafsik ... ma'amid ... etnaḥa and silluq", "equally of the system used for the Torah and ... the other books." Idelsohn, *Jewish Music* (1929) pp. 50-51 [V archive.org `jewishmusicinits00idel_0`]: the Prophetic mode is "built of motives just as is the mode of the Pentateuch." His Hebrew introduction to vol. 4 [V archive.org `otsarneginotyisr00idel`, OCR] describes the Oriental-Sephardi Prophets and haftarah modes (quoted in §4.4).

What the table shows: the **syllable-fitting rules do not change** across traditions. Every printed table I read sets the cadential figure so that its stressed note lands on the word's stressed syllable, with the pre-tonic syllables on the lead-in note. What changes is the **number of distinct cells** and whether **unlisted te'amim** need a default.

---

## 3. Scale and mode, and the engine's degree map

`degreeSemitones()` in `trope/melody.mjs` reads `table.degrees.semitones` per table, so **any diatonic mode is already supported by writing a different map**. Two gaps:

1. **Fixed `-1` entry.** `haftarah.json` maps `-1` (the 6th below) to -4 semitones, a natural-minor B♭ under D. Moroccan and S&P need the major 6th below (-3) as a *diatonic* degree, not an `alt`. Each table must carry its own map; that is already the design, so just set it.
2. **Microtones.** Maqam sigah and bayati need quarter tones (e.g. 2 = 1.5 semitones). `degreeSemitones` will return a float if the map holds one. `midi.mjs` does `e.midi & 0x7f`, which truncates the float, so the MIDI preview would lose the quarter tone. The fix is a pitch-bend event per note, or float MIDI in the score JSON for the singing renderers. SoulX/DiffSinger take f0 or float note numbers [I from synthesis-survey]. Roughly half a day of work.

| Nusach | Haftarah scale as printed | Map |
|---|---|---|
| Binder/Avery, Ashkenazi traditional | natural minor; relative-major cadence at the end (trope-grammar §2.1) | existing |
| Spanish & Portuguese (London) | A minor, la-based tonic sol-fa; *fe* (raised 6th below) before tevir's cadence [V] | natural minor; `alt:+1` on `-1` for *fe* |
| Moroccan (Idelsohn 271) | final D, reciting tone E, range B3-A4, **B natural, F natural**: D dorian / Idelsohn's "d-e-f-g a-b-c-d" Prophetic scale [V] | dorian: 6 below = -3 |
| Spanish-Moroccan (Gibraltar, Idelsohn 273) | one flat, final D, reciting tone A, B♮ once in mahpach [V] | natural minor + `alt` |
| Oriental Sephardi / Aleppo Prophets (Idelsohn 312, 328) | one flat, centre G, 2nd A above [V]. Idelsohn calls the Prophetic mode "identical with the scale of the Arabic mode Bayati" [V *Jewish Music* p. 50], so the 2nd may be a **neutral (3/4-tone) second** in practice [I] | bayati: 2 = 1.5 (to confirm by ear) |
| Aleppo Torah (Idelsohn 325) | written with Idelsohn's special key signature on the staff (his sign for the sigah note) [V scan, sign not decoded] | sigah, quarter tones |
| Yemenite | single tetrachord (Idelsohn: "the single tetrachordal range of the Yemenite mode") [V *Jewish Music* p. 51] | tetrachord, map trivially |
| Western Ashkenazi / British | TropeTrainer's British haftarah is F major [V trope-grammar §5] | major; verse coda |

Idelsohn's notation uses **×** before some notes in the Moroccan and Aleppo tables (e.g. Aleppo tevir "G ×F G A G"; Moroccan Torah "D ×D#"). I read it as his mark for a raised or quarter-tone inflection, but I did not find his legend. Needs a check of vol. 1's introduction [needs the book].

---

## 4. Per-nusach findings

### 4.1 Ashkenazi traditional (Eastern), haftarah: "Rosowsky / Common Melody" option

- **What exists in the repo:** `haftarah.json` carries `rosowsky` and `common` variants per cell, transcribed from TropeTrainer's tables. Those are Kinnor data, a reference design, not a citable published melody.
- **Rosowsky is not a haftarah source.** His book is *The Cantillation of the Bible: The Five Books of Moses* (1957), Torah only [V https://www.tropetrainer.com/voicing; Wikipedia bibliography]. TropeTrainer's "Rosowsky" haftarah table has no printed counterpart I could find [I]. **Do not label a table "Rosowsky haftarah".**
- **Citable sources, best first:**
  1. **Joshua R. Jacobson, *Chanting the Hebrew Bible*** (JPS 2002; student ed. 2005; 2nd ed. 2017), with companion recordings. A complete haftarah system: 66 numbered phrases in the scheme reproduced on sarahbolts.com, organised exactly like our cells (etnachta, zakef-katon groups, final-siluk patterns) [V trope-grammar §2.3]. Copyrighted notation. **[needs the book]**
  2. **Portnoy & Wolff, *The Art of Cantillation* vol. 2** (haftarot and megillot, 2002, with CD). Copyrighted. **[needs the book]**
  3. **Pinchas Spiro, *Haftarah Chanting*** (Tara). Malin 2016 transcribes a Spiro recording and gives scale-degree analysis (open access, Yuval 10) [V https://jewish-music.huji.ac.il/media/2302/download/].
  4. **PD cross-checks:** *Jewish Encyclopedia* 1906, "Cantillation" (Francis L. Cohen), which sets a passage in the haftarah mode with the coda [V https://www.jewishencyclopedia.com/articles/3986-cantillation]. Idelsohn 1929, Table VII no. 6, "Ashkenazic Prophets in Eastern Europe", and no. 7, the Torah-ending motif that hands over to the Prophets mode [V list of contents and p. 51 text; table not read].
- **Structure:** type A, the same model and the same ~44-66 cells as Binder/Avery. **No engine change.**
- **Recommendation:** transcribe Jacobson's haftarah phrases into degrees as a separate table, `haftarah-ashkenazi-jacobson.json`. Use Malin's scale-degree statements and JE 1906 as the PD check. Keep the TropeTrainer columns only as a sanity check.

### 4.2 Moroccan, haftarah (and Torah)

**Sources**

| Source | What | Status |
|---|---|---|
| **Idelsohn, *Thesaurus* vol. 5, *Songs of the Moroccan Jews*** (English ed. 1928/29), §VII "Intonations of the biblical accents", nos. 263-302, pp. 100-113 | No. 271, "Nĕbiim (Prophets)": a full ta'amim table. No. 272: Joshua 1:14 chanted. No. 273: "Mode of Prophets-Gibraltar" table; no. 274: Josh 1:14 in it. Nos. 275-276: Gibraltar Prophets for the feasts and the Shabbat Hazon haftarah. Nos. 263-270: Torah tables and examples. No. 296: a third "Prophets" table (final G, sof pasuq ends on A, Sephardi names *sofar holeh*, *tarha*); its community is named only in the Hebrew introduction, which I could not decode from the OCR | **PD.** Scan: https://archive.org/details/31761125265157 (PDF pages 117-122, 130-132) [V] |
| **Darké Abotenou** (book and YouTube channel) | *The Laws and Customs of the Jews of Morocco*, ISBN 9781937887636; Torah and haftara recordings | Copyrighted; listening check [V citation in https://en.wikipedia.org/wiki/Moroccan_cantillation] |
| Isaac Benchetrit, isaacbenchetrit.com/haftara | Every weekly and holiday haftarah recorded "in the traditional Moroccan version"; "Copyright 5776" | Listening check [V http://isaacbenchetrit.com/haftara/index-he.html] |
| Joshua Maroof (Yeshivat Deah VeHaskel) | "Taamim for Haftara, Moroccan style" (the ta'amim names chanted, i.e. a zarqa table in sound) on SoundCloud; Haftarat Bemidbar, Moroccan | Listening check; the best quick audio for a cell table [V https://soundcloud.com/joshua-maroof/taamim-for-haftara-moroccan , https://www.ydvh.org/samples-of-sephardic-cantillation/] |
| tht.co.il (טע"מא), bar-mitzva.com | Full Moroccan Torah and haftarot recordings | Listening check |
| R. Meir Elazar Atia (d. 2019); Koren *Avoteinu* Moroccan siddur | Liturgy; no haftarah cantillation source found | Not a source for this |
| Rav Mordechai Lebhar | Nothing on haftarah cantillation found | Not found |

**Superseded by `moroccan-table.md` (2026-10-15), which re-reads no. 271 (zarqa's 2nd note is A, not G), resolves the × mark and the qadma/azla labels, and transcribes no. 272.** **Structure of the Moroccan haftarah, from Idelsohn no. 271** [V, my reading of the scan; written with no key signature, final D]. Notes as written, left to right; I have not split upbeat from core (see below):

| Ta'am (Idelsohn's label) | Notes | Degrees (D = 1, dorian) |
|---|---|---|
| zarqa | E G E F E F E D | 2 4 2 3 2 3 2 1 |
| segol | D E D C | 1 2 1 7_ |
| qadma (= Ashkenazi pashta) | G E | 4 2 |
| wĕazla (qadma-azla) | E E D C | 2 2 1 7_ |
| rĕbiʿa, "z.g. u. gersaim" (revia = zakef gadol = gershayim) | E E-D C | 2 2-1 7_ |
| merḥa (before etnachta's tipcha) | E E | 2 2 |
| ṭifḥa (before etnachta) | E E | 2 2 |
| munaḥ | E E | 2 2 |
| atnaḥ | D D | 1 1 |
| talsa | C E | 7_ 2 |
| tĕrên qadmin | E G A G E | 2 4 5 4 2 |
| tĕbir | E D-C | 2 1-7_ |
| merḥa (sof-pasuq group) | D C B | 1 7_ 6_ |
| ṭifḥa (sof-pasuq group) | C D | 7_ 1 |
| sôf pasuq | C D E D | 7_ 1 2 1 |

What the table shows:

- **A reciting tone on E (degree 2) over a final on D.** Merha, tipcha (etnachta half) and munach are *identical* ("E E"). Atnach is a bare cadence onto the final ("D D"). Sof pasuq is a turn around the final (7_ 1 2 1).
- **Merges:** revia = zakef gadol = gershayim (printed as one entry), and azla has the same contour (2 2 1 7_). That leaves about **13 distinct figures** for the whole system, against 44 in Binder/Avery.
- **The two halves differ:** the sof-pasuq half sits *below* the final (7_, 6_), the etnachta half on the tone *above* it (2). So the engine still needs the `group` context (tipcha@sof-pasuk vs tipcha), as in the Ashkenazi table.
- **Not in the table:** zakef katon, pashta, mahpach, darga, pazer, geresh, yetiv, telisha gedola/ketana as separate items. They must come from the chanted example no. 272 (Josh 1:14, which contains zakef katon, pashta and more) or from a modern recording. Until then they fall back to the reciting tone, plus the following disjunctive's lead-in. **[needs transcription of 272 and a listening check]**
- **Wikipedia adds** [V https://en.wikipedia.org/wiki/Moroccan_cantillation, uncited article]: "Darga and Tevir differ depending on whether they fall mid-verse or near a verse's end. When two sets appear in one verse, they are always read to two different tunes." That is a positional context the engine does not have yet (`tevir` near verse end vs mid-verse). There is a distinct **Spanish-Moroccan** haftarah tune; on holidays Spanish-Moroccans use the general tune; there is a special **Three Weeks (Tlata dePuranuta)** tune; and some use the Spanish tune on Tisha b'Av.
- **Contemporary drift:** a commenter on Maroof's sample says it "isnt the usual morrocan tune ... sounds like a diff version of yerushalmi" and that the Halab tune "is being replace[d] with yerushalmi versions" [V ydvh.org, anecdotal]. **Idelsohn 1929 may not match what a living Moroccan reader sings.** Check no. 271 against Benchetrit or Darké Abotenou before shipping.

**Spanish-Moroccan (Gibraltar), Idelsohn no. 273** [V; one flat, final D]: rebia F G A B♭-A-G A. Telisha (ketana and gedola) F G A C G A. Mahpach A B♮ C B♮ D. Pashta C C A. Munach A A. **Zakef katon G A = tipcha G A = atnach G A** (three te'amim, one figure, ending on the reciting tone A). Merha F F. Tipcha (sof-pasuq group) F E G. **Sof pasuq A G F E D** (descending pentachord to the final). This is the clearest "recitation tone + one closing cadence" system in the sources. Here **etnachta does not cadence at all**; only sof pasuq reaches the final.

**Moroccan Torah** (Idelsohn 263, 265-268 and Gibraltar 269): final E with D#, no key signature; or one-flat variants. Idelsohn's "Pentateuch mode ... e-f-g-a + b-c-d-e" [V *Jewish Music* p. 50]; Wikipedia names the nuba Khassar, a branch of Hijaz al-Kabir. Out of scope for a first table; same source, same shape.

**Engine extension for Moroccan:** (1) `aliases` in the table, so one cell serves several te'amim (`"revia": "revia", "zakef-gadol": "revia", "gershayim": "revia"`); (2) a table-level `recitingTone` (deg 2) used for any ta'am or context with no cell, sung on every syllable, with the following cell's upbeat absorbing the pre-tonic syllables as now; (3) the dorian degree map; (4) later, a `nearVerseEnd` context for darga/tevir. The syllable-fitting code is unchanged.

### 4.3 Spanish & Portuguese (Western Sephardic), haftarah and Torah

**Sources**

| Source | What | Status |
|---|---|---|
| ***Book of Prayer of the Spanish and Portuguese Jews' Congregation, London*, vol. 1, *Daily and Occasional Prayers*** (ed. Vivian Ridler, Oxford UP, 1965, reprinted): "the parashah and haftarah melodies are set out at the end of the volume" [V Wikipedia bibliography]. pp. 362-364 Parashah, pp. 365-367 Haphtarah, staff notation **with tonic sol-fa under every note**, each ta'am and each common conjunctive+disjunctive pair printed separately | Copyright 1965 edition. Scan "with permission" at http://www.londonsephardimusic.org/files/Docs/Tangamim.pdf [V, I read pp. 365-366] |
| Jonathan Cohen, London Sephardi Music, "Ta'amim" | Recordings of the Torah chant (Va'etchanan), haftarah cantillation, and the **Haftarot Dipuranita** (special tune for the three haftarot between 17 Tammuz and 9 Av: Mattot, Massei, Devarim) | "Non-commercial use is allowed and encouraged, but please quote your source" [V https://sites.google.com/site/londonsephardimusic/ta-amim] |
| Abraham Lopes Cardozo, *Sephardic Songs of Praise* (Tara, 1987) | Songs with notation; **no evidence it contains ta'amim tables** | [needs the book]; probably not the right source |
| Martin Rodrigues Pereira, *Hochmat Shelomoh* (New York 1994, ISBN 0-933676-37-9) | Torah cantillation, S&P custom, including the "High Na'um" ta'am elyon passages | Torah only; copyrighted [V Wikipedia bibliography] |
| David de Pinna's transcription in Jablonski's *Biblia Hebraica* (Berlin 1699) | Amsterdam Portuguese Pentateuch and Prophets modes | PD; historical; [needs the book] [V Idelsohn *Jewish Music*, reference] |
| Shearith Israel (New York), Bevis Marks recordings | Exist on aggregator pages; none verified | Listening check only |

**Structure, London haftarah** [V, my reading of pp. 365-366; A minor, degrees from la = 1: t = 2, d' = 3, r' = 4, m' = 5, f' = 6, s = 7_, *fe* = raised 6th below]:

| Printed item | Sol-fa | Degrees |
|---|---|---|
| Atnah | d' t l | 3 2 1 |
| Ma'arikh + Tarha (merha + tipcha before etnachta), printed as one pair | l t / d' r' d' d' t | [1 2] 3-4-3, 3-2 |
| Zakef katon | l d' t l | 1 3 2 1 |
| Shofar holekh + zakef katon (munach + zakef) | t t t l / t d' t l | 2 2 2 1 / 2 3 2 1 |
| Segolta | d' t l | 3 2 1 |
| Zarka | r' m' r' f' m' t | 4 5 4 6 5 2 |
| Rebia | m' r' d' t l | 5 4 3 2 1 |
| Zakef gadol | r' m' r' r'-d'-t l | 4 5 4 4-3-2 1 |
| Azla geresh | m' m' r' r'-d'-t l | 5 5 4 4-3-2 1 |
| Shene gerishin (gershayim) | r' m' m' r' r'-d'-t l | 4 5 5 4 4-3-2 1 |
| Darga + tebir | l l d' t l / s fe s l t l | 1 1 3 2 1 / 7_ ♯6_ 7_ 1 2 1 |
| Yetib | m' t | 5 2 |
| Ma'arikh tarha ma'arikh sof pasuk | r' m' r' d' t / r' r' m' r' / l t d' t l (held) | ... 1 2 3 2 1 |

What the table shows:

- **One printed figure per ta'am**, plus printed **conjunctive+disjunctive pairs**. Of all the non-Ashkenazi sources, this is the closest to the TropeTrainer/our `before` context model. The book also notes on p. 364 (parashah) that "the cantillation Holech, Ma-a-reech, and Azla varies ... according to the ta-ngam which follows them", which is exactly `munach>X`, `mercha>X`.
- **But nearly every disjunctive descends to la (degree 1):** atnah 3-2-1, segolta 3-2-1, zakef katon 1-3-2-1, revia 5-4-3-2-1, zakef gadol / geresh / gershayim ...4-3-2-1. That is the "Sephardi disjunctives share motifs" effect. The cells are distinct in their *openings*, which is what makes the model still worthwhile.
- **Size:** about 25-30 cells for haftarah. Wikipedia says Sephardim have no special end-of-haftarah coda but do have a verse-end coda [V Hebrew cantillation, §Sephardi]. The printed "Ma'arikh Sof Pasuk" is probably that verse-end form [I].
- **Special readings:** Dipuranita (3 haftarot) is a separate table; the recordings exist, the notation does not.
- **Engine extension:** none beyond the minor-mode map with *fe*. The Torah table (pp. 362-364) is in the same scan and has the same shape.

### 4.4 Syrian (Aleppo) and Oriental Sephardi / Jerusalem, haftarah and Torah

**Sources**

| Source | What | Status |
|---|---|---|
| **Idelsohn, *Thesaurus* vol. 4, *Songs of the Oriental Sephardim*** (1923; Hebrew ed. in *Otsar neginot Yisra'el* vols. 3-5) | **No. 312 "Propheten"**: Oriental-Sephardi Prophets table + Josh 1:14; **no. 313 "II Propheten"**: 1 Sam 1:1-3; **no. 325 Aleppo Pentateuch** table + Exod 12:21-22 (no. 326); **no. 327** Damascus end-of-parasha; **no. 328 Aleppo "Proph. טעמי נביאים"** table + Josh 1:14 (no. 329) | **PD.** Scan: https://archive.org/details/otsarneginotyisr00idel (page images n180, n181, n186; book pp. 226, 231-232) [V] |
| pizmonim.org (Sephardic Pizmonim Project) | **A complete set of weekly haftarot read by M. Kairey** (Syrian), plus Haim Daya, Moshe Dwek, Moshe Dabbah. "Names of the ta'amim" recordings for Torah and Nevi'im (Haim Daya; Max E. Tawil's "Torah and Haftarah introductory lessons"). G. Shrem's introductory verses of the haftarah. A maqam table by book (Torah = sigah; Psalms = nahawand for Syrians; Song of Songs = bayat; Esther = saba) | No license stated; listening check [V https://www.pizmonim.org/taamim.php , https://www.pizmonim.org/section.php?maqam=Haftarot] |
| Yeshivat Deah VeHaskel | Haftarat Bemidbar, Syrian/Yerushalmi | Listening check [V] |

**Idelsohn on the Oriental-Sephardi haftarah** (Hebrew introduction to vol. 4, OCR from the archive.org text, my translation) [V, OCR partly garbled]: there is a **Prophets mode** "in which sof pasuq rises in order to join the verses, because this mode is meant for study and fluent reading. But there are places that read the haftarah in this mode too, such as the Balkans and **sometimes Aleppo**. The only difference between the Prophets mode (nos. 328, 329) and the **haftarah mode** (nos. 312, 313) is the sof pasuq motive ... The ending of the Prophets mode given here is the Aleppo custom; the other Sephardim end on the fourth." So the **Syrian haftarah = the Oriental-Sephardi Prophets table with a closing (not rising) sof pasuq.** No. 312 shows that closing form (Josh 1:14 ends with a descent to D).

**Aleppo Prophets table, no. 328** [V, my reading; one flat, centre G = 1, so A = 2, B♭ = 3, C = 4, F = 7_]:

| Ta'am | Notes | Degrees |
|---|---|---|
| zarqa | [F] C B♭ A | [7_] 4 3 2 |
| segol | A G A G | 2 1 2 1 |
| rebia | C B♭ A G | 4 3 2 1 |
| mahpach / pashta | [F] C B♮ / C A | [7_] 4 ♮3 / 4 2 |
| zakef katon | [A] B♭-A G | [2] 3-2 1 |
| merha / tifha (etnachta half) | G G-A / G A | 1 1-2 / 1 2 |
| atnach | B♭ A G | 3 2 1 |
| tevir | [A] G ×F G A G | [2] 1 ×7_ 1 2 1 |
| sof pasuq (verse-linking, mid-reading) | C B♭ A G A | 4 3 2 1 **2** |
| sof pasuq (last) | [C] G A | [4] 1 **2** |

The pattern is clear: **etnachta, zakef katon, rebia and segol all close on G**, and sof pasuq in this study mode closes *up* on A. That is Idelsohn's "rises to join the verses". For the haftarah, take no. 312's sof pasuq instead **[needs a careful transcription of 312]**. The figures are two to four notes, mostly stepwise in a fourth: type B/D. The scale is bayati-like; whether A is a neutral second must be settled by ear against Kairey's recordings.

**Syrian Torah** is maqam **sigah** (Wikipedia; pizmonim.org [V]). Idelsohn no. 325 notates it with a special key signature, and the reading has quarter tones throughout. Syrians also have two Torah forms, a simple one in general use and an elaborate one for professional hazzanim [V Wikipedia]. A Syrian Torah table therefore requires the microtone extension; transcribe it from Idelsohn 325 with Tawil's "names of the ta'amim" recording as the check.

**Weekly maqam:** Syrian prayers change maqam weekly. I found **no source saying the haftarah chant follows the weekly maqam**; Idelsohn treats the Prophets mode as fixed. Treat the haftarah as one table [I].

### 4.5 Yemenite

- **Sources:** Idelsohn, *Thesaurus* vol. 1, *Songs of the Yemenite Jews* (1914; PD; archive.org `thesaurusoforien00idel` v.1-2 and `hebrischoriental00idel`) [V item exists; pages not read]. Uri Sharvit, "The Musical Realization of Biblical Cantillation Symbols in the Jewish Yemenite Tradition", *Yuval* 4 (1982), 179-210 [V citation]; Yuval is published by the HUJI Jewish Music Research Centre, and recent issues are open access [I for vol. 4]. Ben-Shalom, Keshet & Yeger-Granot, CIM14 (2014), on sof-pasuq finalis variation by two Yemenite readers [V prior-art]. Idelsohn 1929, Table VII nos. 1 and 3 (Yemenite Pentateuch and Prophets) [V contents list].
- **Structure:** type C. Eight motifs in four classes (molikh / mafsik / ma'amid / etnach and silluq); conjunctives monotone. Idelsohn: the Yemenites use the Prophetic mode for the Pentateuch too, and the Yemenite Prophets mode is a single tetrachord [V]. A table holds about 8 cells plus a ta'am-to-class map.
- **Engine:** a `classes` map in the table (ta'am to class) before `selectCell`; conjunctives become `recitingTone`. Small.
- **Pronunciation:** the most distinctive profile of all (§5). For an AI voice without Yemenite training data, this is the hardest to make sound right.
- **Priority:** low; it is not among Daniel's named first three.

### 4.6 Italian

- **Sources:** the Leo Levi collection of Italian Jewish recordings (1950s), National Library of Israel sound archive. The melodies vary by city; Rome resembles S&P, the north differs [V Wikipedia]. Bartolocci's *Bibliotheca Magna Rabbinica* vol. IV (Rome c. 1675-93) prints "Sephard. and Ital. for Pent. and Haftara in music notes" (PD, historical) [V Idelsohn *Jewish Music*, reference]. No modern published trope chart found.
- **Structure:** unknown in detail [needs the recordings]; Rome is probably type A/B like S&P [I].
- **Priority:** last. Archival only; rights to the NLI recordings are unclear for anything beyond listening.

### 4.7 Western Ashkenazi / British ("Minhag Anglia")

- **Sources:** Victor Tunkel, *The Music of the Hebrew Bible: The Western Ashkenazi Tradition* (Tymsder 2004, ISBN 978-0-9531104-8-3); its catalogue description stresses the Pentateuch, and haftarah coverage is unconfirmed [V https://jewish-music.huji.ac.il/en/content/music-hebrew-bible-western-ashkenazi-tradition ; needs the book]. Chani Smith, *Learn to Leyn* (London 2004, CD, Western Ashkenazi melody), already cited in trope-grammar for the fitting rules. The Hertz Chumash (Torah melody). Salomon Sulzer's Torah notation (PD, http://www.shulmusic.org/sheetmusic/sulzer/sulz_99.htm). Abraham Baer, *Ba'al T'fillah* (1877, PD) pp. 30-42, the "most valuable" Ashkenazi transcription per JE 1906 [V reference]; whether it includes the German haftarah mode is unconfirmed [I that it does; needs the book]. The United Synagogue's online resources: none found.
- **Structure:** type A. Distinctive feature: **a coda motif at the end of every haftarah verse**, plus a different end-of-haftarah coda modulating minor to major [V Wikipedia]. TropeTrainer's British haftarah is in F major [V].
- **Engine:** an `endOfVerse` context that replaces the sof-pasuq group with the coda on every verse. The engine already has `endOfReading`, so this is the same mechanism with a different trigger. Small.

### 4.8 Chabad

- **Sources:** chabad.org Torah-reading pages by Michoel Slavin (reader at 770): weekly haftarah recordings, possibly incomplete ("Ki Savo is the last Haftorah Rabbi Slavin recorded", per a reader comment) [V search result https://www.chabad.org/931078 , not opened]. TropeTrainer has a Chabad haftarah table (A minor) [V]. No printed Chabad haftarah chart found.
- **Structure:** type A, Eastern Ashkenazi, close to "Common Melody" [I from TropeTrainer's grouping].
- **Engine:** none. The work is transcribing from recordings (no printed source), which is weaker for Daniel's "standard published melody" rule.
- **Pronunciation:** Chabad Ashkenazi (§5), which is the bigger change.

---

## 5. Pronunciation coupling (`trope/pronunciation.json`)

The existing profile `israeli-v1` has `rules.ayin` of `''` or `'q'`, `alefOnset` of `''` or `'q'`, ח = `x`, ת = `t` in both forms, qamats = `a`. Each new nusach table should name its default profile. Proposed profiles [I from standard descriptions of the reading traditions; each needs a native listener]:

| Profile | ח | ע | ת rafe | ק | צ / ט | ו | qamats (gadol) | tsere | holam | vocal sheva | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `israeli-v1` (now) | x | none | t | k | ts / t | v | a | e | o | e | |
| `moroccan` | **ħ** | **ʕ** | t | k (q among older readers) | ts or s / t | v (w among some) | a (qatan o) | e | o | e, strictly kept | ר alveolar or uvular; dagesh forte geminated; ג rafe sometimes distinct |
| `syrian` | **ħ** | **ʕ** | t | **q** | **sˤ / tˤ** (emphatic) | **w** | a | e | o | e | strong gemination; ה always sounded |
| `sp-london` | ħ | **ŋ** (velar nasal; hence "Ta-ngamim") [V site title note] | t | k | ts / t | v | a (qatan o) | e | o | e | no ultra-short schwa reduction |
| `yemenite` | ħ | ʕ | **θ** (and ד rafe **ð**, ג rafe **ɣ** or ʒ) | g or q | sˤ / tˤ | w | **ɔ** | e | **ø** (Sanaani) | a-coloured | the most distinct; mil'el vs mil'ra strictly kept |
| `ashkenazi-chabad` | x | none | **s** | k | ts / t | v | **o** (ɔ) | **ei** | **oi** | e | penultimate stress *in speech*, but chant follows the Masoretic stress |
| `ashkenazi-western` | x | none | s | k | ts / t | v | ɔ | ei | **au** (German) / **ou** (British) | e | |

Engineering implications:

- Add symbols **ħ ʕ q sˤ tˤ w ŋ θ ð ɣ ɔ ø** to `symbols`, with IPA, X-SAMPA and an ARPAbet fallback. The synthesis models have no Hebrew (synthesis-survey), and ħ/ʕ have no English phoneme. The fallback is `hh` for ħ and a glottal stop or nothing for ʕ, which falls below the "slightly American on resh and chet" quality bar.
- Daniel ruled that accented-but-correct ships. **A Moroccan or Syrian table sung with Israeli pronunciation is a mismatch a Sephardi listener hears at once.** Each Sephardi table should ship with its profile as default and an "Israeli pronunciation" override.
- The `syllabifier` options stay the same: every tradition here reads the Tiberian syllable structure. Sephardi readers keep the vocal sheva and the hataf vowels more consistently than Israeli speech does, so `longVowels: true` is right for them.

---

## 6. Haftarah vs Torah vs special readings

| Nusach | Haftarah mode distinct from Torah? | Special haftarah tunes | End of haftarah |
|---|---|---|---|
| Eastern Ashkenazi | Yes (minor Prophets mode) | Eicha trope for Devarim and Tisha b'Av haftarot (trope-grammar §5) | Coda modulating to relative major, last verse only |
| Western Ashkenazi | Yes | (as East) | Coda on **every** verse, plus a final major coda |
| Spanish & Portuguese | Yes [V London book: separate "Parashah" and "Haphtarah" tables] | **Dipuranita** (3 haftarot before 9 Av), recorded [V] | No special end coda [V Wikipedia] |
| Moroccan | Yes (general + Spanish-Moroccan haftarah tunes) | **Tlata dePuranuta** (Three Weeks); Gibraltar Shabbat Hazon (Idelsohn 276); Spanish tune on Tisha b'Av for some [V] | Not described |
| Oriental Sephardi / Syrian | Yes: Torah in sigah; haftarah in the Prophets mode with a closing sof pasuq. **Aleppo sometimes reads the haftarah in the study mode** (rising sof pasuq) [V Idelsohn] | Not found | Not found |
| Yemenite | **Same class system**; Idelsohn says the Prophetic mode serves the Pentateuch too [V] | Not found | Not found |

For the engine, "Torah and haftarah" means two tables per nusach for every tradition except the Yemenite, where one table may serve both [I].

---

## 7. Cell counts and the model, compared

| Table | Distinct cells (est.) | Contexts needed | New engine features |
|---|---|---|---|
| Binder/Avery haftarah (done) | 44 | before / group / endOfReading / onOneWord | none |
| Ashkenazi traditional (Jacobson) | 45-66 | same | none |
| Spanish & Portuguese London | 25-30 | before (printed as pairs) | none |
| Moroccan (Idelsohn 271) | ~13 printed + ~8 to infer | group (sof-pasuq vs etnachta half); later nearVerseEnd for darga/tevir | aliases, recitingTone, dorian map |
| Spanish-Moroccan (Idelsohn 273) | ~12 | few | aliases, recitingTone |
| Oriental Sephardi / Syrian (Idelsohn 312/328) | ~20 | group; verse-linking vs closing sof pasuq | aliases, microtones (pitch bend / float MIDI) |
| Yemenite | 8 | class map | classes, recitingTone |
| Western Ashkenazi | ~40 | + endOfVerse | endOfVerse coda |
| Chabad | ~40 | same as Ashkenazi | none |

---

## 8. Recommendation: the first four tables after Binder/Avery

### 1. Ashkenazi traditional: `haftarah-ashkenazi-jacobson.json`

- **Source:** Jacobson, *Chanting the Hebrew Bible* (JPS 2002/2017), haftarah chapter and phrase list, with its companion recordings. PD checks: JE 1906 "Cantillation", Idelsohn 1929 Table VII no. 6, Malin 2016's scale-degree statements.
- **Effort:** 10-14 h (66 phrases to degrees, ~6 h; proof against the recordings, ~4 h; JSON + the 39-verse render check, ~3 h). Buying the book is a prerequisite.
- **Engine extension:** none.
- **Sample cells** (from Malin's scale-degree statements of the traditional mode [V via trope-grammar §2.1/2.3]; Jacobson's own values **need the book**): sof pasuk [5] 3, 1 (Kalib's arpeggio; ends on 1). Etnachta [1] 3, 5-4 (93.6% of 94 cantors use <1,3,5,4> in some form). Tipcha [3] 4 ("moves up and does not return"). Zakef katon [4] 5, 3 (ends on 3).

### 2. Moroccan: `haftarah-moroccan-idelsohn.json`

- **Source:** Idelsohn, *Thesaurus* vol. 5 (1929), no. 271 "Nĕbiim" table and no. 272 (Josh 1:14), PD, https://archive.org/details/31761125265157 . Listening check against Benchetrit's recordings or Darké Abotenou, and Maroof's ta'amim recording, to confirm the reciting tone and to fill zakef katon, pashta, mahpach, darga, pazer, geresh, yetiv.
- **Effort:** 10-16 h (table 3 h; transcribe 272 and assign each note to its ta'am, 3 h; fill the missing te'amim from recordings, 4-8 h; JSON + aliases, 2 h). Plus 4-6 h of engine work.
- **Engine extension:** `aliases`, `recitingTone`, per-table dorian map; `pronunciation: "moroccan"` with ħ/ʕ.
- **Sample cells** (my reading of no. 271, D = 1, upbeat/core split **not yet assigned**): sof pasuq 7_ 1 2 1. Etnachta 1 1. Tipcha (etnachta half) 2 2, identical to merha and munach. Revia = zakef gadol = gershayim 2 2-1 7_. Zakef katon: **not printed in 271; needs 272 or a recording.**

### 3. Spanish & Portuguese (London): `haftarah-sp-london.json`

- **Source:** *Book of Prayer of the Spanish and Portuguese Jews' Congregation, London*, vol. 1 (ed. Ridler, OUP 1965), pp. 365-367 "Haphtarah", in tonic sol-fa. Scan at londonsephardimusic.org (posted with the congregation's permission). Check against Jonathan Cohen's haftarah cantillation recording (non-commercial use with attribution). Copyrighted edition of a traditional melody: transcribe to degrees, cite, do not reproduce the pages.
- **Effort:** 6-8 h (sol-fa makes the pitches unambiguous; ~30 items; the pairs map straight onto `before` contexts). Dipuranita is a further 6-10 h from the recordings alone.
- **Engine extension:** none (minor map with an `alt` for *fe*). Needs a `sp-london` pronunciation profile (ע = ŋ, ח = ħ).
- **Sample cells** (A = 1) [V my reading]: sof pasuk ...1, 2, 3, 2, 1 (held). Atnah 3, 2, 1. Tarha (before atnah, after ma'arikh) [1, 2] 3-4-3, 3-2. Zakef katon 1, 3, 2, 1.

### 4. Syrian / Oriental Sephardi: `haftarah-syrian-idelsohn.json`

- **Source:** Idelsohn, *Thesaurus* vol. 4 (1923), no. 312 "Propheten" (haftarah mode, closing sof pasuq) with no. 328 "Proph. Aleppo" for Aleppo variants. PD, https://archive.org/details/otsarneginotyisr00idel . Listening check: M. Kairey's complete haftarot and the "names of the ta'amim" recordings at pizmonim.org, which also settles whether the second degree is neutral.
- **Effort:** 12-18 h (table 4 h; the 312 vs 328 sof-pasuq choice and the × marks, 2 h; ear-checking intervals against Kairey, 4-8 h; JSON, 2 h). Plus microtone support, about 0.5-1 day (pitch bend in `midi.mjs`; float pitch through to the renderer).
- **Engine extension:** aliases, recitingTone, fractional-semitone map, `pronunciation: "syrian"` (ħ, ʕ, q, emphatics, w).
- **Sample cells** (my reading of the **Aleppo study-mode** table no. 328, G = 1): sof pasuq 4, 3, 2, 1, **2** (rising, verse-linking; the haftarah form from no. 312 descends to the final, **needs transcription**). Etnachta 3, 2, 1. Tipcha 1, 2. Zakef katon [2] 3-2, 1.

**Why this order:** (1) closes the Ashkenazi option with a citable source and no engine work. (2) is the tradition Daniel named, and it forces the two small, reusable extensions (aliases, recitingTone) that every Sephardi table needs. (3) is the cheapest high-quality table once the extensions exist. (4) adds microtones, the only structurally new piece, last. Western Ashkenazi (endOfVerse coda) and Chabad (no extension, but no printed source) come next; then Yemenite (class map); Italian last.

---

## 9. Sources consulted (URLs)

- Idelsohn, *Thesaurus* vol. 5 (Moroccan), archive.org: https://archive.org/details/31761125265157 (page images used: `page/n117`-`n122`, `n130`)
- Idelsohn, *Otsar neginot Yisra'el* vols. 3-5 (Hebrew ed. incl. vol. 4 Oriental Sephardim), archive.org: https://archive.org/details/otsarneginotyisr00idel (page images `n180`, `n181`, `n186`; djvu text for the introduction)
- Idelsohn, *Jewish Music in its Historical Development* (1929): https://archive.org/details/jewishmusicinits00idel_0
- Idelsohn vols. 1-2: https://archive.org/details/thesaurusoforien00idel ; https://archive.org/details/hebrischoriental00idel
- London S&P ta'amim scan: http://www.londonsephardimusic.org/files/Docs/Tangamim.pdf ; recordings: https://sites.google.com/site/londonsephardimusic/ta-amim
- pizmonim.org: https://www.pizmonim.org/taamim.php ; https://www.pizmonim.org/section.php?maqam=Haftarot
- Wikipedia: https://en.wikipedia.org/wiki/Hebrew_cantillation ; https://en.wikipedia.org/wiki/Moroccan_cantillation
- TropeTrainer voicings: https://www.tropetrainer.com/voicing
- Jewish Encyclopedia 1906: https://www.jewishencyclopedia.com/articles/3986-cantillation
- Malin 2016: https://jewish-music.huji.ac.il/media/2302/download/
- Moroccan recordings: http://isaacbenchetrit.com/haftara/index-he.html ; https://soundcloud.com/joshua-maroof/taamim-for-haftara-moroccan ; https://www.ydvh.org/samples-of-sephardic-cantillation/
- Tunkel catalogue: https://jewish-music.huji.ac.il/en/content/music-hebrew-bible-western-ashkenazi-tradition
- Sulzer Torah: http://www.shulmusic.org/sheetmusic/sulzer/sulz_99.htm
- Chabad recordings: https://www.chabad.org/931078

---

## Questions only Daniel can answer

1. **"Standard published melody" vs living practice.** Idelsohn's 1929 Moroccan table may differ from what Moroccan readers sing today (Yerushalmi influence is reported). Should the Moroccan option cite Idelsohn and say "as notated 1929", or must it match a living reader's recording, even though recordings are a weaker "published" source?
2. **Which Moroccan:** the general (Arab-Moroccan) haftarah tune, the Spanish-Moroccan (Gibraltar/Tetouan) tune, or both as two options?
3. **Which Syrian:** the closing haftarah form (Idelsohn 312) or Aleppo's sometimes-used study mode with the rising sof pasuq (328)? And is "Syrian" enough, or do you want "Jerusalem Sephardi" as a separate option?
4. **Buying books:** Jacobson (needed for the Ashkenazi traditional table), and optionally Portnoy & Wolff, Tunkel, Rodrigues Pereira. Approve the purchase?
5. **Pronunciation default per table:** should a Moroccan, Syrian or S&P table *default* to its own pronunciation (pharyngeal ח/ע, S&P ע as "ng"), with Israeli as an override? Or the reverse? This affects how accented the AI voice will sound.
6. **Recent-edition sources:** comfortable citing and transcribing to degrees from copyrighted editions (Jacobson 2002/2017; the 1965 S&P prayer book), given that we publish only our degree tables and never their pages or audio?
7. **Special readings:** do you want the special tunes (S&P Dipuranita, Moroccan Three Weeks, Gibraltar Shabbat Hazon, Ashkenazi Eicha-trope haftarot) as part of each option, or out of scope for now?
8. **Is the "Common Melody" a separate option from Jacobson,** given it has no printed source of its own (only TropeTrainer's data)? And should the TropeTrainer-derived `rosowsky`/`common` variants be removed from `haftarah.json` once a citable Ashkenazi table exists, to keep every shipped table on a published source?
9. **Torah tables for the Sephardi options:** build them at the same time as each haftarah table (the same Idelsohn volumes and the same London scan contain them), or haftarah first across all options?
