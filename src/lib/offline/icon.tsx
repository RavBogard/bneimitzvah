import { ImageResponse } from "next/og";

/**
 * Daniel's app icon (B5, 2026-10-23): option 2, the yad pointing to a word, drawn exactly as
 * docs/planning/2026-10-23-cowork-offload/icons/option-2-yad.svg (strokes as drawn, never thinner).
 * Shapes only, full-bleed lake, so one drawing serves the any, maskable and Apple icons: everything sits
 * inside the maskable safe circle. Rendered at build time; no image file enters the repository.
 */
export const LAKE = "#1d5ba6";
export const CANVAS = "#ebf2fa";
export const YAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" fill="${LAKE}"/>
<g transform="translate(256 256) scale(0.9) translate(-256 -256)">
<g transform="rotate(35 256 256)">
<circle cx="256" cy="84" r="30" fill="#ffffff"/>
<rect x="238" y="84" width="36" height="170" rx="18" fill="#ffffff"/>
<rect x="216" y="238" width="80" height="24" rx="12" fill="#ffffff"/>
<rect x="206" y="270" width="100" height="70" rx="30" fill="#ffffff"/>
<rect x="206" y="300" width="38" height="96" rx="19" fill="#ffffff"/>
</g>
<rect x="124" y="388" width="120" height="34" rx="17" fill="#f7b500"/>
</g>
</svg>`;

/** The PNG sizes served: the manifest's any and maskable icons, the Apple touch icon, and the favicon. */
export const ICON_SIZES = Object.freeze({ "icon-192.png": 192, "icon-512.png": 512, "maskable-512.png": 512, "apple-180.png": 180, "favicon-48.png": 48 } as const);
export type IconName = keyof typeof ICON_SIZES;

export function iconResponse(size: number): Response {
  const src = `data:image/svg+xml;base64,${Buffer.from(YAD_SVG).toString("base64")}`;
  // eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG by ImageResponse, never to the page
  const image = new ImageResponse(<img src={src} width={size} height={size} alt="" />, { width: size, height: size });
  image.headers.set("cache-control", "public, max-age=86400");
  return image;
}
