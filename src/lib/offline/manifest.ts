/**
 * The web app manifest (§3.8 with E1): name and short_name are the congregation's productName (CRC's is
 * "CRC Torah"), so the route is not a fixed string. No push fields. The page links it only on the torah
 * origin (§3.1), so it is inert on every other host.
 */
export const MANIFEST_THEME = "#1d5ba6";
export const MANIFEST_BACKGROUND = "#ebf2fa";
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
/** A product name fit for a manifest and for the install strings: 1 to 120 characters, trimmed, no controls. */
export function plainProductName(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.trim() === value && Array.from(value).length <= 120 && !CONTROLS.test(value) ? value : null;
}
export function webManifest(productName: string) {
  const name = plainProductName(productName);
  if (!name) throw new Error("Product name refused");
  return Object.freeze({
    id: "/", name, short_name: name, start_url: "/", scope: "/", display: "standalone",
    theme_color: MANIFEST_THEME, background_color: MANIFEST_BACKGROUND,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
}
