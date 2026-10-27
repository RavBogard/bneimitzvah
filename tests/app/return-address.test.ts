import { describe, expect, it } from "vitest";
import { returnAddress, signInAddress, RETURN_ADDRESS_MAX } from "../../src/lib/site/return-address";
import { publicSignInBoundary } from "../../src/components/portal/sign-in-boundary";
import { parseCodeResult, PortalRequestError } from "../../src/components/portal/api";
import { parseSaveReturn, readAddress, saveReturnAddress } from "../../src/components/portal/public-reading/urls";

// Release 1.9 N20: where sign-in may go back to. Synthetic addresses only.
describe("the return address", () => {
  it("keeps same-origin relative addresses on the pages sign-in returns to", () => {
    for (const value of ["/", "/account", "/read", "/readings", "/readings?add=1", "/read?date=2026-10-31", "/read?date=2026-10-31&kind=haftarah&verse=3&lens=study",
      "/read?ref=Genesis+18%3A1-10&kind=torah", "/read?reading=rosh-hashanah-1&passage=2", "/read?saved=0b0e9c8e-8f3c-4b8a-9a52-2a4c1e8f9d10",
      readAddress({ mode: "ref", ref: "Genesis 18:1-33", kind: "torah", mark: "Genesis 18:1-5; 18:10" }, { verse: 4, study: true }),
      saveReturnAddress("/read?date=2026-10-31", ["Genesis 18:1-10"])])
      expect(returnAddress(value), value).toBe(value);
  });
  it("refuses any scheme, host, backslash, encoded host or separator, control character, fragment, or other page", () => {
    for (const value of [
      "//evil.example", "//evil.example/read", "///evil.example", "/\\evil.example", "\\\\evil.example", "/read\\..\\x", "https://evil.example/read", "http:/read",
      "javascript:alert(1)", "data:text/html,x", "evil.example/read", "read", "", " /read", "/read ", "/re ad", "/read\t", "/read\n", "/read\r\n//evil.example",
      "/read\u0000", "/read\u007f", "/réad", "/read?x= ", "/%2F%2Fevil.example", "/%2f/evil.example", "/%5Cevil.example", "/read%2F..%2F..", "/%2e%2e/read",
      "/read/../account", "/./read", "/read/", "/READ", "/read#top", "/read?verse=1#x", "/account?x=1", "/?token=private", "/?", "/read?",
      "/read?x=%00", "/read?x=%1f", "/read?x=%7F", "/read?x=%", "/read?x=%zz", "/read?x=<script>", "/read?x='1'", "/read?x=\"1\"", "/read?x=`1`",
      "/sign-in", "/sign-in?return=/read", "/api/auth/sign-out", "/auth/email", "/connect", "/workspace/admin", "/learn", "/invitations/accept",
      `/read?x=${"a".repeat(RETURN_ADDRESS_MAX)}`])
      expect(returnAddress(value), JSON.stringify(value)).toBeNull();
    for (const value of [undefined, null, 1, ["/read"], { toString: () => "/read" }, new URL("https://evil.example/read")]) expect(returnAddress(value)).toBeNull();
  });
  it("builds /sign-in with the return only when it is one", () => {
    expect(signInAddress(null)).toBe("/sign-in");
    expect(signInAddress("/")).toBe("/sign-in");
    expect(signInAddress("//evil.example")).toBe("/sign-in");
    expect(signInAddress("/account")).toBe("/sign-in?return=%2Faccount");
    const address = signInAddress("/read?date=2026-10-31&verse=2");
    expect(address).toBe("/sign-in?return=%2Fread%3Fdate%3D2026-10-31%26verse%3D2");
    expect(new URLSearchParams(address.slice("/sign-in?".length)).get("return")).toBe("/read?date=2026-10-31&verse=2");
  });
});

describe("/sign-in and the code answer carry it", () => {
  it("drops a refused return to the default and never mixes it with the Account intent", () => {
    expect(publicSignInBoundary({ return: "/read?date=2026-10-31" }, "sign-in")).toMatchObject({ inlineGoogle: true, back: "/read?date=2026-10-31", referrer: "strict-origin-when-cross-origin" });
    for (const value of ["//evil.example", "https://evil.example/", "/\\evil.example", "/%2F%2Fevil.example", ["/read", "/read"], "/sign-in"])
      expect(publicSignInBoundary({ return: value }, "sign-in"), JSON.stringify(value)).toMatchObject({ inlineGoogle: true, back: null });
    expect(publicSignInBoundary({ intent: "account", return: "/read" }, "sign-in")).toMatchObject({ intent: "account", back: null });
    // The home takes no query at all, so no return.
    expect(publicSignInBoundary({ return: "/read" }, "home")).toMatchObject({ inlineGoogle: false, back: null });
    expect(publicSignInBoundary({ return: "/read", token: "synthetic" }, "sign-in")).toMatchObject({ inlineGoogle: false, back: null });
  });
  it("accepts a code answer only for a fixed landing or a return address", () => {
    for (const next of ["/", "/account", "/invitations/accept", "/read?date=2026-10-31&save=1"]) expect(parseCodeResult({ ok: true, next })).toBe(next);
    for (const next of ["//evil.example", "https://evil.example", "/sign-in", "/?token=private", "/workspace/admin", "javascript:alert(1)", 1, null])
      expect(() => parseCodeResult({ ok: true, next }), String(next)).toThrow(PortalRequestError);
    expect(() => parseCodeResult({ ok: true, next: "/", extra: 1 })).toThrow(PortalRequestError);
    expect(() => parseCodeResult({ ok: false, next: "/" })).toThrow(PortalRequestError);
  });
});

describe("the save offer on the way back", () => {
  it("adds save=1 and a selection to the reading's address, and reads them once", () => {
    const back = saveReturnAddress("/read?date=2026-10-31&lens=study", ["Genesis 18:1-10", "Genesis 18:12"]);
    expect(parseSaveReturn(back.slice("/read".length))).toEqual({ choose: ["Genesis 18:1-10", "Genesis 18:12"], offer: true });
    expect(saveReturnAddress("/read")).toBe("/read?save=1");
    expect(parseSaveReturn("?save=1")).toEqual({ choose: null, offer: true });
    // A selection without the offer, a duplicated or odd value, is not chosen.
    for (const search of ["?choose=Genesis+18%3A1-10", "?save=1&choose=%3Cscript%3E", "?save=1&choose=a&choose=b", "?save=2", "?save=1&save=1", ""])
      expect(parseSaveReturn(search).choose, search).toBeNull();
    expect(parseSaveReturn("?save=1&save=1").offer).toBe(false);
    // Neither is ever written back into the page's own address.
    expect(readAddress({ mode: "week", date: "2026-10-31", kind: null }, { today: "2026-10-24" })).toBe("/read?date=2026-10-31");
  });
});
