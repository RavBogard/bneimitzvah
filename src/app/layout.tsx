import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "CRC Beit Mitzvah", referrer: "no-referrer", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
