import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { readPublicProductName } from "./names";

/**
 * The plain share card every public page sends to link previews (MISSION 2026-10-23, item 10): the page title,
 * the product name and the yad. No photo, no emoji, nothing that varies by visitor; the public congregation is fixed,
 * so one card per path is safe to cache. The inks are the app's (globals.css); Hebrew falls back to Noto Serif Hebrew.
 */
export const SHARE_CARD_SIZE = Object.freeze({ width: 1200, height: 630 });
export const SHARE_CARD_TYPE = "image/png";
const INK = "#13202f", MUTED = "#4b5a6b", CANVAS = "#ebf2fa", LAKE = "#1d5ba6", MARIGOLD = "#f7b500";

const fontRoot = join(process.cwd(), "public", "fonts");
// The card's renderer cannot read the axis names of a variable font, so each font is drawn at its default instance
// (Bricolage Grotesque ExtraBold, Noto Serif Hebrew Regular): the variation tables are set aside in memory, the files stay as pinned.
const VARIATION_TABLES = new Set(["fvar", "gvar", "avar", "cvar", "HVAR", "VVAR", "MVAR", "STAT"]);
export function defaultInstance(font: Buffer): Buffer {
  const copy = Buffer.from(font), count = copy.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16;
    if (VARIATION_TABLES.has(copy.toString("latin1", at, at + 4))) copy.write("zzzz", at, "latin1");
  }
  return copy;
}
const loadFont = async (file: string) => defaultInstance(await readFile(join(fontRoot, file)));
let fonts: Promise<[Buffer, Buffer]> | null = null;
const readFonts = () => fonts ??= Promise.all([loadFont("bricolage-grotesque/BricolageGrotesque.ttf"), loadFont("noto-serif-hebrew/NotoSerifHebrew.ttf")]).catch(error => { fonts = null; throw error; });

/** The yad icon (docs/planning/2026-10-23-cowork-offload/icons/option-2-yad.svg), drawn inline at `size` pixels. */
function Yad({ size }: { size: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={size} height={size}>
    <rect width="512" height="512" rx="104" fill={LAKE} />
    <g transform="translate(256 256) scale(0.9) translate(-256 -256)">
      <g transform="rotate(35 256 256)">
        <circle cx="256" cy="84" r="30" fill="#ffffff" />
        <rect x="238" y="84" width="36" height="170" rx="18" fill="#ffffff" />
        <rect x="216" y="238" width="80" height="24" rx="12" fill="#ffffff" />
        <rect x="206" y="270" width="100" height="70" rx="30" fill="#ffffff" />
        <rect x="206" y="300" width="38" height="96" rx="19" fill="#ffffff" />
      </g>
      <rect x="124" y="388" width="120" height="34" rx="17" fill={MARIGOLD} />
    </g>
  </svg>;
}

/** A long title steps down so it still sits in two calm lines. */
export const titleSize = (title: string) => title.length <= 22 ? 112 : title.length <= 40 ? 88 : 68;

export async function renderShareCard(title: string, productName?: string): Promise<ImageResponse> {
  const [name, [sans, hebrew]] = await Promise.all([productName ?? readPublicProductName(), readFonts()]);
  const family = "Bricolage Grotesque, Noto Serif Hebrew";
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: CANVAS, padding: "72px 88px", fontFamily: family, color: INK }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Yad size={104} />
        <div style={{ display: "flex", marginLeft: 32, fontSize: 44, fontWeight: 400, color: MUTED }}>{name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", width: 120, height: 12, background: MARIGOLD, borderRadius: 6, marginBottom: 40 }} />
        <div style={{ display: "flex", fontSize: titleSize(title), fontWeight: 800, lineHeight: 1.08, letterSpacing: -2, maxWidth: 1000 }}>{title}</div>
      </div>
    </div>,
    { ...SHARE_CARD_SIZE, fonts: [{ name: "Bricolage Grotesque", data: sans, weight: 800, style: "normal" }, { name: "Noto Serif Hebrew", data: hebrew, weight: 400, style: "normal" }] },
  );
}
