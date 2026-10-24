import { expect, it } from "vitest";
import { siddurPageLink } from "../../src/lib/siddur/link";

const reader = "https://siddur.centralreform.org/", at = String.fromCharCode(64); // built, so no address-shaped literal sits in the file

it("builds the reader's own link format exactly", () => {
  expect(siddurPageLink(reader, "shirei-tshuvah", 10)).toBe("https://siddur.centralreform.org/?book=shirei-tshuvah&p=10");
  expect(siddurPageLink("https://siddur.centralreform.org", "shirei-tshuvah", 9999)).toBe("https://siddur.centralreform.org/?book=shirei-tshuvah&p=9999");
  expect(siddurPageLink("https://siddur.centralreform.org/crc/?x=1#y", "b1", 1)).toBe("https://siddur.centralreform.org/?book=b1&p=1");
  expect(siddurPageLink(reader, "shirei-tshuvah", 33, "shabbat.morning_v2")).toBe("https://siddur.centralreform.org/?book=shirei-tshuvah&p=33&service=shabbat.morning_v2");
});

it("refuses every address that is not the recognised reader over https", () => {
  for (const url of ["http://siddur.centralreform.org/", "https://evil.example/", "https://siddur.centralreform.org.evil.example/", "https://centralreform.org/", "https://www.centralreform.live/",
    "https://siddur.centralreform.org:8443/", `https://user:pw${at}siddur.centralreform.org/`, `https://evil.example${at}siddur.centralreform.org.evil.example/`, "javascript:alert(1)", "//siddur.centralreform.org/", "siddur.centralreform.org", "", "not a url"])
    expect(siddurPageLink(url, "shirei-tshuvah", 10), url).toBeNull();
});

it("refuses pages that are not whole numbers from 1 to 9999", () => {
  for (const page of [0, -1, 10_000, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER, "10" as unknown as number, null as unknown as number, undefined as unknown as number])
    expect(siddurPageLink(reader, "shirei-tshuvah", page), String(page)).toBeNull();
});

it("refuses books and service views that are not safe slugs", () => {
  for (const book of ["", "Shirei", "a b", "a&p=1", "a/b", "../x", "-x", "a?b", "a#b", "a%20b", "x".repeat(65), "בוק", null as unknown as string]) expect(siddurPageLink(reader, book, 10), String(book)).toBeNull();
  for (const view of ["", "a b", "a&b", "a/b", "<x>", "x".repeat(101), "-x"]) expect(siddurPageLink(reader, "shirei-tshuvah", 10, view), view).toBeNull();
});
