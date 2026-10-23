import type { Metadata } from "next";
import { PublicReading } from "../../components/portal/public-reading/view";

// Open to anyone (Daniel, 2026-10-22), but not for search engines until beta.
// A static shell: the browser picks the Shabbat, so the CDN serves this page itself.
export const metadata: Metadata = {
  title: "This week’s reading | CRC Torah",
  description: "This Shabbat’s Torah portion and haftarah with trope, translation and recordings.",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function ReadPage() {
  return <PublicReading />;
}
