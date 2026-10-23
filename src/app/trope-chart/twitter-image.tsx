import { renderShareCard } from "../../server/public-site/share-card";

// Share card for link previews: plain, the same for every visitor, built once and cached.
export const revalidate = 3600;
export const alt = "Trope chart";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default async function Image() {
  return renderShareCard("Trope chart");
}
