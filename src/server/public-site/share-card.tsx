import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { readPublicProductName } from "./names";

/**
 * The plain share card every public page sends to link previews (MISSION 2026-10-23, item 10; the mark changed 2026-10-26): the page
 * title and the product name on lake blue, beside Siona Benjamin's CRC floor, cropped off the right edge. No photo, no emoji, nothing
 * that varies by visitor; the public congregation is fixed, so one card per path is safe to cache. Hebrew falls back to Noto Serif Hebrew.
 */
export const SHARE_CARD_SIZE = Object.freeze({ width: 1200, height: 630 });
export const SHARE_CARD_TYPE = "image/png";
const LAKE = "#1d5ba6", MARIGOLD = "#f7b500", WHITE = "#ffffff";
/** The mural disc at its native size: vertically centred (630 - 512) / 2 = 59 from the top, 96px of it cropped off the right edge. */
const MURAL = Object.freeze({ size: 512, top: 59, right: -96 });
/** The widest the title runs, so it never goes under the disc (which starts at 1200 + 96 - 512 = 784). */
const TITLE_MAX_WIDTH = 620;

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
let mural: Promise<string> | null = null;
/** The 512 px disc (public/brand/mural-512.png) as a data address, read once. */
const readMural = () => mural ??= readFile(join(process.cwd(), "public", "brand", "mural-512.png")).then(bytes => `data:image/png;base64,${bytes.toString("base64")}`).catch(error => { mural = null; throw error; });

/** A long title steps down so it still sits in a few calm lines inside TITLE_MAX_WIDTH. */
export const titleSize = (title: string) => title.length <= 14 ? 104 : title.length <= 24 ? 84 : title.length <= 40 ? 68 : 56;

export async function renderShareCard(title: string, productName?: string): Promise<ImageResponse> {
  const [name, [sans, hebrew], disc] = await Promise.all([productName ?? readPublicProductName(), readFonts(), readMural()]);
  const family = "Bricolage Grotesque, Noto Serif Hebrew";
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", background: LAKE, padding: "72px 88px", fontFamily: family, color: WHITE }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG by ImageResponse, never to the page */}
      <img src={disc} width={MURAL.size} height={MURAL.size} alt="" style={{ position: "absolute", top: MURAL.top, right: MURAL.right }} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", width: 120, height: 12, background: MARIGOLD, borderRadius: 6, marginBottom: 40 }} />
        <div style={{ display: "flex", fontSize: titleSize(title), fontWeight: 800, lineHeight: 1.08, letterSpacing: -2, maxWidth: TITLE_MAX_WIDTH }}>{title}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG by ImageResponse, never to the page */}
        <img src={disc} width={56} height={56} alt="" />
        <div style={{ display: "flex", marginLeft: 20, fontSize: 40, fontWeight: 750, color: WHITE }}>{name}</div>
      </div>
    </div>,
    { ...SHARE_CARD_SIZE, fonts: [{ name: "Bricolage Grotesque", data: sans, weight: 800, style: "normal" }, { name: "Noto Serif Hebrew", data: hebrew, weight: 400, style: "normal" }] },
  );
}
