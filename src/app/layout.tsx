import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { OfflineRuntime } from "../components/portal/offline/runtime";
import { IdentityProvider } from "../components/site/identity-context";
import { PerRequest } from "../components/site/per-request";
import { SiteFooter } from "../components/site/site-footer";
import { resolveIdentity } from "../lib/site/identity";

const identity = resolveIdentity();
function identityMetadata(): Metadata {
  // Siona Benjamin's CRC floor, served from public/brand, only on CRC's origins; a fork has no icon unless it adds its own. The Apple touch icon is linked by the offline runtime, on the torah origin only.
  const icon = identity.logo.kind === "crc" ? [{ url: "/brand/favicon.ico", sizes: "any" }, { url: "/brand/favicon-48.png", sizes: "48x48", type: "image/png" }]
    : identity.logo.kind === "custom" ? [{ url: identity.logo.src }] : [];
  return { title: identity.productName, referrer: "no-referrer", robots: { index: false, follow: false }, icons: { icon } };
}

export const metadata: Metadata = identityMetadata();

export default function RootLayout({ children }: { children: ReactNode }) {
  // CRC's identity is fixed by its origin, so CRC's pages stay static; only a fork renders per request.
  // The site's one footer: the congregation line and Daniel's standard credit. No page draws a second.
  return <html lang="en"><body><IdentityProvider identity={identity}>{!identity.crc && <PerRequest />}{children}<OfflineRuntime /><SiteFooter /></IdentityProvider></body></html>;
}
