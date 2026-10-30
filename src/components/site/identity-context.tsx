"use client";
import { createContext, useContext, type ReactNode } from "react";
import { CRC_IDENTITY, type Identity, type Logo } from "../../lib/site/identity";

// The root layout (a server component) resolves the identity from settings and provides it here. Without a provider (tests, isolated
// renders) the default is CRC's, the same default the server uses in local development.
const IdentityContext = createContext<Identity>(CRC_IDENTITY);
export function IdentityProvider({ identity, children }: { identity: Identity; children: ReactNode }) {
  return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}
export const useIdentity = () => useContext(IdentityContext);

/** The congregation's mark at a size, as an image address set. CRC's floor only for CRC; a fork's own file, or nothing. */
export function markImage(logo: Logo, size: "small" | "large"): { src: string; srcSet?: string } | null {
  if (logo.kind === "none") return null;
  if (logo.kind === "custom") return { src: logo.src };
  return size === "small" ? { src: "/brand/mural-64.webp", srcSet: "/brand/mural-64.webp 1x, /brand/mural-128.webp 2x" } : { src: "/brand/mural-512.png" };
}
