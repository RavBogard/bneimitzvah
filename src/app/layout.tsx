import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "CRC Beit Mitzvah", referrer: "no-referrer", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  // Daniel's standard credit, on every page, as in his other apps ("A project of Rabbi Daniel Bogard").
  return <html lang="en"><body>{children}<footer className="site-credit">A project of <a href="https://danielbogard.com" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Rabbi Daniel Bogard</a></footer></body></html>;
}
