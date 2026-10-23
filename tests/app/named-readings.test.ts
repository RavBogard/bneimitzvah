import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { NAMED_READINGS, namedReading } from "../../src/lib/readings/named-readings";
import { canonicalReadingRef } from "../../src/lib/readings/reading-ref";

// The catalog is numbers and English names extracted from Hebcal (CC BY 4.0); see named-readings.PROVENANCE.md.
const passages = (slug: string) => namedReading(slug)?.passages.map(passage => [passage.label, passage.kind, passage.ref]);

test("every passage is a canonical reference of its own kind, so every named reading opens on the ref routes", () => {
  expect(NAMED_READINGS.length).toBeGreaterThan(61);
  for (const reading of NAMED_READINGS) {
    expect(reading.passages.length, reading.slug).toBeGreaterThan(0);
    for (const passage of reading.passages) {
      expect(["torah", "haftarah"], reading.slug).toContain(passage.kind);
      expect(canonicalReadingRef(passage.ref, passage.kind), `${reading.slug}: ${passage.ref}`).not.toBeNull();
    }
    expect(new Set(reading.passages.map(passage => passage.label)).size, reading.slug).toBe(reading.passages.length);
    expect(Object.isFrozen(reading) && Object.isFrozen(reading.passages) && reading.passages.every(Object.isFrozen), reading.slug).toBe(true);
  }
  expect(Object.isFrozen(NAMED_READINGS)).toBe(true);
});

test("slugs are unique address keys; names are plain ASCII; groups are the four the chooser shows", () => {
  const slugs = NAMED_READINGS.map(reading => reading.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
  for (const reading of NAMED_READINGS) {
    expect(reading.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/); expect(reading.slug.length).toBeLessThanOrEqual(64);
    expect(reading.name).toMatch(/^[\x20-\x7e]{1,80}$/);
    expect(["parashah", "special", "festival", "fast"]).toContain(reading.group);
    for (const passage of reading.passages) expect(passage.label).toMatch(/^(?:Torah(?: [2-9])?|Maftir|Aliyah [1-7]|Haftarah)$/);
  }
  expect(namedReading("bereshit")?.name).toBe("Bereshit");
  for (const value of ["", "Bereshit", "__proto__", "constructor", "toString", "bereshit ", undefined, null, 1, ["bereshit"]]) expect(namedReading(value), String(value)).toBeNull();
});

test("61 parashiyot (54 and the 7 combined), in Torah order, each opening with its whole Torah reading", () => {
  const parashot = NAMED_READINGS.filter(reading => reading.group === "parashah");
  expect(parashot).toHaveLength(61);
  expect(parashot.filter(reading => reading.name.includes("-") && reading.name !== "Lech-Lecha")).toHaveLength(7);
  expect(parashot[0].slug).toBe("bereshit"); expect(parashot.at(-1)!.slug).toBe("vezot-haberakhah");
  for (const reading of parashot) { expect(reading.passages[0].label, reading.slug).toBe("Torah"); expect(reading.passages[0].ref, reading.slug).not.toContain(";"); }
  // The parashiyot come first, then the other groups.
  expect(NAMED_READINGS.findIndex(reading => reading.group !== "parashah")).toBe(61);
  const order = ["vayakhel", "pekudei", "vayakhel-pekudei", "vayikra"].map(slug => parashot.findIndex(reading => reading.slug === slug));
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("spot facts", () => {
  expect(passages("bereshit")).toEqual([["Torah", "torah", "Genesis 1:1-6:8"], ["Haftarah", "haftarah", "Isaiah 42:5-43:10"]]);
  expect(passages("noach")?.[0][2]).toBe("Genesis 6:9-11:32");
  expect(passages("shemot")?.[1][2]).toBe("Isaiah 27:6-28:13; Isaiah 29:22-23");
  expect(passages("mishpatim")?.[1][2]).toBe("Jeremiah 34:8-22; Jeremiah 33:25-26");
  expect(passages("vayakhel-pekudei")?.[0][2]).toBe("Exodus 35:1-40:38");
  expect(passages("nitzavim-vayeilech")?.[0][2]).toBe("Deuteronomy 29:9-31:30");
  expect(passages("matot-masei")?.[0][2]).toBe("Numbers 30:2-36:13");
  expect(passages("vezot-haberakhah")).toEqual([["Torah", "torah", "Deuteronomy 33:1-34:12"], ["Haftarah", "haftarah", "Joshua 1:1-18"]]);
  expect(passages("haazinu")?.[1][2]).toBe("II Samuel 22:1-51");
  // Special Shabbatot: the readings they replace, not the parashah.
  expect(passages("shabbat-shekalim")).toEqual([["Maftir", "torah", "Exodus 30:11-16"], ["Haftarah", "haftarah", "II Kings 12:1-17"]]);
  expect(passages("shabbat-zachor")?.[0][2]).toBe("Deuteronomy 25:17-19");
  expect(passages("shabbat-hagadol")).toEqual([["Haftarah", "haftarah", "Malachi 3:4-24"]]);
  expect(passages("shabbat-shuva-with-haazinu")?.[0][2]).toBe("Hosea 14:2-10; Joel 2:15-27");
  // A festival reading that crosses books is split into passages; a fast's gap stays inside one passage.
  expect(passages("simchat-torah")).toEqual([["Torah", "torah", "Deuteronomy 33:1-34:12"], ["Torah 2", "torah", "Genesis 1:1-2:3"],
    ["Maftir", "torah", "Numbers 29:35-30:1"], ["Haftarah", "haftarah", "Joshua 1:1-18"]]);
  expect(passages("rosh-hashana-i")).toEqual([["Torah", "torah", "Genesis 21:1-34"], ["Maftir", "torah", "Numbers 29:1-6"], ["Haftarah", "haftarah", "I Samuel 1:1-2:10"]]);
  expect(passages("tzom-gedaliah-mincha")).toEqual([["Torah", "torah", "Exodus 32:11-14; Exodus 34:1-10"], ["Haftarah", "haftarah", "Isaiah 55:6-56:8"]]);
  expect(passages("yom-kippur-mincha")?.[0][2]).toBe("Leviticus 18:1-30");
  // Where the Shabbat form reads differently, both forms are kept under Hebcal's names.
  expect(passages("shavuot-ii")?.[0][2]).toBe("Deuteronomy 15:19-16:17");
  expect(passages("shavuot-ii-on-shabbat")?.[0][2]).toBe("Deuteronomy 14:22-16:17");
  expect(namedReading("yom-kippur-on-shabbat")).toBeNull(); // the same reading either way: one entry
});

test("the extractor is hand-run only: no npm script or test runs it, and the provenance names Hebcal's licence and the raw hash", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
  expect(Object.values(scripts).some(command => command.includes("named-readings-extract"))).toBe(false);
  const extractor = readFileSync("scripts/named-readings-extract.mjs", "utf8");
  expect(extractor).toContain("NODE_TEST_CONTEXT");
  const provenance = readFileSync("src/lib/readings/named-readings.PROVENANCE.md", "utf8");
  expect(provenance).toContain("CC BY 4.0"); expect(provenance).toMatch(/SHA-256.*`[a-f0-9]{64}`/);
  expect(readFileSync("src/lib/readings/named-readings.ts", "utf8")).not.toMatch(/[֐-׿]/); // no Hebrew, no text
});
