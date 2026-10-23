# Named readings catalog

`named-readings.ts` holds only English names and numeric book/chapter/verse ranges for the parashiyot, special Shabbatot, diaspora festivals and fasts that "Any reading" offers. It was extracted by `scripts/named-readings-extract.mjs` (hand-run, never part of `npm test`) from [Hebcal's leyning API](https://www.hebcal.com/home/4277/leyning-torah-reading-api), whose calendar data is © Hebcal, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). No verse text, translation, summary or Hebrew was retained.

- **Extracted:** 2026-10-23 (UTC, Hebcal's own response time), diaspora calendar (`i=off`), full kriyah (`triennial=off`).
- **Span:** quarterly requests 2024-09-01 to 2032-09-30 for everything; then 2032-10-01 to 2044-09-30 only for a parashah whose own Torah or haftarah the base span never gives (listed under Notes).
- **Raw responses:** 81 JSON answers, kept outside the repository. SHA-256 over the lines `<url>\n<sha256 of body>\n` in request order: `b770667ce20ac72225b0a4e2a1bdc9c6cb288ad9cb39264dbdf3b546571cf25a`.
- **Result:** 107 entries (61 parashah, 17 special, 19 festival, 10 fast).

## Rules

- A parashah's Torah is aliyot 1–7 joined, from years where no special reason replaces an aliyah (an aliyah's own note such as "some sources use 4:19-26" leaves the whole range unchanged); every such year must agree. Its haftarah comes from years where Hebcal gives no haftarah `reason`; every such year must agree, and a parashah with no such year has no haftarah here.
- Vezot Haberakhah is read only on Simchat Torah: its Torah is the aliyot Hebcal marks parashah 54 that day, and its haftarah is Simchat Torah's.
- A special Shabbat is one entry per Hebcal reason, holding exactly the readings that reason replaces (an aliyah, the maftir, the haftarah), identical in every year it occurs.
- A festival or fast is its aliyot in passages: a change of book, or a step backwards, starts a new passage (so a Torah passage never crosses books and `expandReadingRanges` is unchanged); a gap inside one book is a further "; " segment. The maftir is its own passage unless it continues the last aliyah (a fast-day Mincha). A name and its "(on Shabbat)" form are one entry when every year agrees, else two entries under Hebcal's names. A maftir that changes from year to year is left out.
- Every passage passed `canonicalReadingRef` (`reading-ref.ts`) at extraction; anything else is refused, never repaired.

## Refused

- Vayakhel-Pekudei: haftarah (never read without a special haftarah in the span; Torah only)
- Vayeilech: haftarah (never read without a special haftarah in the span; Torah only)

## Notes

- Miketz: its own haftarah is never read in the base span; haftarah taken from the supplementary span
- Vayakhel: its own haftarah is never read in the base span; haftarah taken from the supplementary span
- Tzav: its own haftarah is never read in the base span; haftarah taken from the supplementary span
- Pinchas: its own haftarah is never read in the base span; haftarah taken from the supplementary span
- Metzora: its own haftarah is never read in the base span; haftarah taken from the supplementary span
- Kedoshim: its own haftarah is never read in the base span; haftarah taken from the supplementary span
- Matot: never read alone in the base span; torah taken from the supplementary span
- Matot: its own haftarah is never read in the base span; haftarah taken from the supplementary span
- Masei: never read alone in the base span; torah taken from the supplementary span
- Masei: its own haftarah is never read in the base span; haftarah taken from the supplementary span
- Vezot Haberakhah: aliyot Hebcal marks parashah 54 on Simchat Torah, with Simchat Torah's haftarah
- not a special Shabbat in this catalog (left to the parashah or a custom passage): "Pinchas occurring after 17 Tammuz"
- not a special Shabbat in this catalog (left to the parashah or a custom passage): "Matot-Masei on Shabbat Rosh Chodesh"
- not a special Shabbat in this catalog (left to the parashah or a custom passage): "Ki Teitzei with 3rd Haftarah of Consolation"
- Sukkot Shabbat Chol ha-Moed: maftir changes from year to year (Numbers 29:17-22 | Numbers 29:23-28 | Numbers 29:26-31); left out
