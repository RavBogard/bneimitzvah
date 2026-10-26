import { createHash } from "node:crypto";

// Approval boundary: exact upstream bytes (plus the recorded derivatives: the Bricolage Latin WOFF2 subset and the Hebrew WOFF2 subsets
// of Noto Serif Hebrew and Taamey Frank CLM, whose tool, command, input hash and output hash are in public/fonts/PROVENANCE.md) and their adjacent notice,
// paired per family: a font never ships without its own notice. A GPL family
// also ships its unchanged upstream source ("source"), which like the font is
// accepted only byte for byte; its embedded author notice is not re-scanned.
// The same boundary admits the CRC Torah logo (family "brand-mural"): derivatives of Siona Benjamin's floor mural at
// Central Reform Congregation, committed with the congregation's permission at 512 px and under (Daniel, 2026-10-26).
// Each image ("image") is accepted only byte for byte at its exact path, never without its notice,
// public/brand/PROVENANCE.md, and never when its own header declares a side larger than BRAND_IMAGE_MAX_SIDE.
// Changing this list is a repository-protection change requiring independent
// review. No environment, option, alternate manifest or extension enables it.
export const FONT_ASSETS = Object.freeze([
  Object.freeze({ path: "public/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf", family: "noto-serif-hebrew", kind: "font", size: 183600,
    sha256: "93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165" }),
  Object.freeze({ path: "public/fonts/noto-serif-hebrew/NotoSerifHebrew-hebrew.woff2", family: "noto-serif-hebrew", kind: "font", size: 67412,
    sha256: "73b1f64236b7a25085805602ad48f6af2a53be96444a4d6e0f8556cc3e360ff5" }),
  Object.freeze({ path: "public/fonts/noto-serif-hebrew/OFL.txt", family: "noto-serif-hebrew", kind: "license", size: 4382,
    sha256: "9b9fe028b5ba74d231659a1bbaf0ed09b11e759d1ca6a070999e16d151616b47" }),
  Object.freeze({ path: "public/fonts/bricolage-grotesque/BricolageGrotesque.ttf", family: "bricolage-grotesque", kind: "font", size: 408496,
    sha256: "413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682" }),
  Object.freeze({ path: "public/fonts/bricolage-grotesque/BricolageGrotesque-latin.woff2", family: "bricolage-grotesque", kind: "font", size: 109576,
    sha256: "6a051c984a4fc560ee3045cbf604cd905396ce53cdc3b8ebe08cc11f44315d59" }),
  Object.freeze({ path: "public/fonts/bricolage-grotesque/OFL.txt", family: "bricolage-grotesque", kind: "license", size: 4403,
    sha256: "4b5a7d8f37f5602621c8a8d7358a6a2e71317e6c231c661e15aef0275d3e07ba" }),
  Object.freeze({ path: "public/fonts/stam-ashkenaz-clm/StamAshkenazCLM.ttf", family: "stam-ashkenaz-clm", kind: "font", size: 14968,
    sha256: "18aec29cd0f3e2f31049224712e740468fc893344289ceb1c86b02b619854ca6" }),
  Object.freeze({ path: "public/fonts/stam-ashkenaz-clm/LICENSE.txt", family: "stam-ashkenaz-clm", kind: "license", size: 18092,
    sha256: "8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643" }),
  Object.freeze({ path: "public/fonts/stam-ashkenaz-clm/StamAshkenazCLM.sfd", family: "stam-ashkenaz-clm", kind: "source", size: 59723,
    sha256: "ff23748b1b9df2bb1f5e26b8928342eee87ead160bdff535a505aed0f7294c45" }),
  Object.freeze({ path: "public/fonts/taamey-frank-clm/TaameyFrankCLM.ttf", family: "taamey-frank-clm", kind: "font", size: 105076,
    sha256: "f558d3564d385a6a512ce938705f47236e71457e8aa4ad9eaf6cebc3e17b991c" }),
  Object.freeze({ path: "public/fonts/taamey-frank-clm/TaameyFrankCLM-hebrew.woff2", family: "taamey-frank-clm", kind: "font", size: 26168,
    sha256: "9c89b3a4eda041db2cc287d83351d570e7655d51fa6ce3719b3090d0b8f2e9f1" }),
  Object.freeze({ path: "public/fonts/taamey-frank-clm/LICENSE.txt", family: "taamey-frank-clm", kind: "license", size: 18092,
    sha256: "8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643" }),
  Object.freeze({ path: "public/fonts/taamey-frank-clm/TaameyFrankCLM.sfd", family: "taamey-frank-clm", kind: "source", size: 566990,
    sha256: "0679128225b0a522d8def9490444c28d6add1a897d26743e5669379fc5d95fe7" }),
  Object.freeze({ path: "public/brand/mural-64.webp", family: "brand-mural", kind: "image", size: 3474,
    sha256: "a61508b3153fcdb863e41653ed0b8f46798960373f5a1ed95a802cc108b6f643" }),
  Object.freeze({ path: "public/brand/mural-128.webp", family: "brand-mural", kind: "image", size: 9832,
    sha256: "d121a030ea2a26bd9692b889b07d7f07d28d3d433eb30d05a35daf075b740cf7" }),
  Object.freeze({ path: "public/brand/mural-512.png", family: "brand-mural", kind: "image", size: 169331,
    sha256: "c08a20644f9516806b876e959b881c83476dea1eaa195f140a85319846142735" }),
  Object.freeze({ path: "public/brand/icon-192.png", family: "brand-mural", kind: "image", size: 21806,
    sha256: "d843a248e193cdce3e662ebb36b56eb123d5dbf685040a6c741ad83b39a29481" }),
  Object.freeze({ path: "public/brand/icon-512.png", family: "brand-mural", kind: "image", size: 129874,
    sha256: "a0db7e7769cd0337655a3e0cccf40549462cfe02e2bef16f2107528c9b922b5d" }),
  Object.freeze({ path: "public/brand/maskable-512.png", family: "brand-mural", kind: "image", size: 108926,
    sha256: "0e7ff2d46ff3b9395d2a68adc09ec210fe1beb1c7beedf30928c3411038670e2" }),
  Object.freeze({ path: "public/brand/apple-180.png", family: "brand-mural", kind: "image", size: 19458,
    sha256: "b2f7fc0a773f0ae8fa7f843cb88caf2a10751a6971fded21eb970a46f20e5f7d" }),
  Object.freeze({ path: "public/brand/favicon-48.png", family: "brand-mural", kind: "image", size: 3095,
    sha256: "1099e746347ec41ae60c79dbab809b0d75cb4ae425f8d48403bc85e4661d5b81" }),
  Object.freeze({ path: "public/brand/favicon.ico", family: "brand-mural", kind: "image", size: 11376,
    sha256: "e22679cbb4bb9123aeb9eb9249c80f84a2a521a5fb3f4c53f7a83f4917c32f7b" }),
  Object.freeze({ path: "public/brand/PROVENANCE.md", family: "brand-mural", kind: "license", size: 2211,
    sha256: "20bd8c33013b21942c83a7cd2d9814861736c6f55601502b6e36be2b7d126d7e" }),
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

// No copy of the mural larger than 512 px enters the repository. Dimensions come from the file's own header (PNG IHDR;
// WebP VP8, VP8L or VP8X; every ICO directory entry and the PNG or DIB header it points to). A header this reader
// cannot parse is refused, never assumed small. The pins already fix the bytes; this keeps a larger copy from being pinned.
export const BRAND_IMAGE_MAX_SIDE = 512;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngSizes(bytes, at = 0) {
  if (bytes.length < at + 24 || !PNG_SIGNATURE.equals(bytes.subarray(at, at + 8)) || bytes.toString("latin1", at + 12, at + 16) !== "IHDR") return null;
  return [{ width: bytes.readUInt32BE(at + 16), height: bytes.readUInt32BE(at + 20) }];
}
function webpSizes(bytes) {
  if (bytes.length < 30 || bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return [{ width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }];
  if (chunk === "VP8L" && bytes[20] === 0x2f) { const bits = bytes.readUInt32LE(21); return [{ width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }]; }
  if (chunk === "VP8X") return [{ width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }];
  return null;
}
function icoSizes(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  const count = bytes.readUInt16LE(4), sizes = [];
  if (!count || bytes.length < 6 + 16 * count) return null;
  for (let index = 0; index < count; index++) {
    const entry = 6 + 16 * index, length = bytes.readUInt32LE(entry + 8), offset = bytes.readUInt32LE(entry + 12);
    if (length < 24 || offset + length > bytes.length) return null;
    sizes.push({ width: bytes[entry] || 256, height: bytes[entry + 1] || 256 });
    const embedded = pngSizes(bytes, offset);
    if (embedded) sizes.push(...embedded);
    else if (bytes.readUInt32LE(offset) >= 40) sizes.push({ width: Math.abs(bytes.readInt32LE(offset + 4)), height: Math.abs(bytes.readInt32LE(offset + 8)) / 2 });
    else return null;
  }
  return sizes;
}
export function imagePixelSizes(path, content) {
  if (!(content instanceof Uint8Array)) return null;
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  const reader = { ".png": pngSizes, ".webp": webpSizes, ".ico": icoSizes }[/\.[a-z]+$/.exec(path)?.[0]];
  return reader ? reader(bytes) : null;
}
export function brandImageProblem(path, content) {
  const sizes = imagePixelSizes(path, content);
  if (!sizes?.length || sizes.some(({ width, height }) => !(width >= 1 && height >= 1))) return "reviewed brand image dimensions unreadable";
  if (sizes.some(({ width, height }) => width > BRAND_IMAGE_MAX_SIDE || height > BRAND_IMAGE_MAX_SIDE)) return `reviewed brand image larger than ${BRAND_IMAGE_MAX_SIDE} px`;
}
