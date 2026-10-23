import { expect, it } from "vitest";
import { leinHref } from "../../src/components/learn/lein-link";
import { parseReadAddress } from "../../src/components/portal/public-reading/urls";

it("builds /read's own deep link: a Shabbat (kind only for the haftarah) or a canonical ref, and the verse", () => {
  expect(leinHref({ date: "2026-10-24", kind: "torah", verse: 3 })).toBe("/read?date=2026-10-24&verse=3");
  expect(leinHref({ date: "2026-10-24", kind: "haftarah", verse: 2 })).toBe("/read?date=2026-10-24&kind=haftarah&verse=2");
  expect(leinHref({ ref: "Genesis 12:1-8", kind: "torah", verse: 1 })).toBe("/read?ref=Genesis+12%3A1-8&kind=torah&verse=1");
  expect(parseReadAddress(leinHref({ date: "2026-10-24", kind: "haftarah", verse: 2 }).slice("/read".length))).toEqual({ target: { mode: "week", date: "2026-10-24", kind: "haftarah" }, verse: 2, study: false });
});
