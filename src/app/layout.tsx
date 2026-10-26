import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { OfflineRuntime } from "../components/portal/offline/runtime";
import { SiteFooter } from "../components/site/site-footer";

export const metadata: Metadata = { title: "CRC Torah", referrer: "no-referrer", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  // The site's one footer: the congregation line and Daniel's standard credit. No page draws a second.
  return <html lang="en"><body>{children}<OfflineRuntime /><SiteFooter /></body></html>;
}
