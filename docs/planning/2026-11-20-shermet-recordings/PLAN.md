# Cantor Wendy Shermet in CRC Torah

On November 20, 2026, Daniel selected Cantor Wendy Shermet of Temple Israel, Omaha as CRC’s default recorded voice throughout the product. Daniel confirmed that the rabbi’s permission covers CRC public streaming, shared reading links and offline practice on learners’ devices. A portal for Omaha is a separate future decision. Credit both Shermet and Temple Israel, Omaha.

## Implementation and acceptance

1. Inventory the published collection, including Torah, weekly and special haftarot, trope instruction, blessings, holiday variants and Megillot. Preserve Omaha’s page and row labels for each source. Report listed rows, distinct files, verified full verses and timed verses separately. [Omaha collection](https://www.templeisraelomaha.com/cantors-classroom) · [Special haftarot](https://www.templeisraelomaha.com/special-haftarot.html)
2. Acquire the original files outside Git. Verify each recording by decoding the full file and recording its duration and SHA-256. Bind public playback to the CRC identity and the verified inventory. Use the source label for a variant or unresolved reference until the corresponding verse can be identified.
3. Prefer Shermet on public, shared and assigned readings, the practice modal, Learn and new offline saves. Preserve existing saved practice. Align phrases and word taps to the Hebrew text and Shermet’s own performance. Use her full verse when available, even if fine timing is pending. Show the actual source when a different recording plays.
4. Make standalone recordings discoverable from relevant practice surfaces. Retain the tune or occasion named by Omaha. Compare verified ordinary verses with the CRC baseline of 5,846 Torah and 1,629 haftarah verses. [Coverage baseline](../../archive/superpowers/research/2026-10-22-reference-audio-coverage.md)
5. Independently review recording access and offline scope. Verify reader, Learn, mixed-source fallback and offline playback. Run CI on the release commit, then check the public deployment.

## Inventory evidence

The public site yielded 247 catalog pages, 8,326 playable rows and 8,154 distinct media URLs. The Chanukah blessings and Jeremiah 31:1–19 listings display titles or verse labels without a player or media link. One special Samuel page requires sign-in. Recordings on other public pages can still match overlapping references. Inventory and acquisition receipts are outside Git in the local shermet-collection media directory.

The first 20 decoded recordings cover Genesis 1:1, 1:27–30 and 22:1–4, Exodus 35:1–6, Numbers 6:26–27 and Micah 7:18–20. Credited full-verse exercises independently identify several of these files. [Genesis opening](https://voices.sefaria.org/sheets/415562) · [Exodus exercises](https://voices.sefaria.org/sheets/386127) · [Micah recordings](https://www.templeisraelomaha.com/micah-718-20.html)
