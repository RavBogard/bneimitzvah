import { createHash } from "node:crypto";

// Approval boundary: exact unchanged upstream bytes and their adjacent notice.
// Changing this list is a repository-protection change requiring independent
// review. No environment, option, alternate manifest or extension enables it.
export const FONT_ASSETS = Object.freeze([
  Object.freeze({ path: "public/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf", kind: "font", size: 183600,
    sha256: "93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165" }),
  Object.freeze({ path: "public/fonts/noto-serif-hebrew/OFL.txt", kind: "license", size: 4382,
    sha256: "9b9fe028b5ba74d231659a1bbaf0ed09b11e759d1ca6a070999e16d151616b47" }),
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
