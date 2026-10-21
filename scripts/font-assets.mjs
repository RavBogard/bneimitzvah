import { createHash } from "node:crypto";

// Approval boundary: exact unchanged upstream bytes and their adjacent notice,
// paired per family: a font never ships without its own notice. A GPL family
// also ships its unchanged upstream source ("source"), which like the font is
// accepted only byte for byte; its embedded author notice is not re-scanned.
// Changing this list is a repository-protection change requiring independent
// review. No environment, option, alternate manifest or extension enables it.
export const FONT_ASSETS = Object.freeze([
  Object.freeze({ path: "public/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf", family: "noto-serif-hebrew", kind: "font", size: 183600,
    sha256: "93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165" }),
  Object.freeze({ path: "public/fonts/noto-serif-hebrew/OFL.txt", family: "noto-serif-hebrew", kind: "license", size: 4382,
    sha256: "9b9fe028b5ba74d231659a1bbaf0ed09b11e759d1ca6a070999e16d151616b47" }),
  Object.freeze({ path: "public/fonts/bricolage-grotesque/BricolageGrotesque.ttf", family: "bricolage-grotesque", kind: "font", size: 408496,
    sha256: "413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682" }),
  Object.freeze({ path: "public/fonts/bricolage-grotesque/OFL.txt", family: "bricolage-grotesque", kind: "license", size: 4403,
    sha256: "4b5a7d8f37f5602621c8a8d7358a6a2e71317e6c231c661e15aef0275d3e07ba" }),
  Object.freeze({ path: "public/fonts/stam-ashkenaz-clm/StamAshkenazCLM.ttf", family: "stam-ashkenaz-clm", kind: "font", size: 14968,
    sha256: "18aec29cd0f3e2f31049224712e740468fc893344289ceb1c86b02b619854ca6" }),
  Object.freeze({ path: "public/fonts/stam-ashkenaz-clm/LICENSE.txt", family: "stam-ashkenaz-clm", kind: "license", size: 18092,
    sha256: "8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643" }),
  Object.freeze({ path: "public/fonts/stam-ashkenaz-clm/StamAshkenazCLM.sfd", family: "stam-ashkenaz-clm", kind: "source", size: 59723,
    sha256: "ff23748b1b9df2bb1f5e26b8928342eee87ead160bdff535a505aed0f7294c45" }),
]);

// Deliberately no path normalization or case folding at the trust boundary.
export const reviewedFontAsset = path => FONT_ASSETS.find(asset => asset.path === path) ?? null;

// Pure byte comparator. inspectRepository obtains pins only from the immutable
// registry above; accepting a test vector here is not a runtime registry hook.
export function matchesAssetPin(bytes, pin) {
  return bytes instanceof Uint8Array && Number.isSafeInteger(pin?.size) && pin.size >= 0
    && typeof pin.sha256 === "string" && /^[0-9a-f]{64}$/.test(pin.sha256)
    && bytes.byteLength === pin.size && createHash("sha256").update(bytes).digest("hex") === pin.sha256;
}
