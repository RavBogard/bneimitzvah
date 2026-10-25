import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

// The component page: every N9 component in every state, in fixture words, for the browser tests to measure (roles, names,
// contrast, target size, focus trap). It exists only where CRC_COMPONENT_PAGE=1 (the built end-to-end server sets it);
// everywhere else, including production, the address is a 404 and none of its words ship to anyone.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Components | CRC Torah", referrer: "no-referrer", robots: { index: false, follow: false, nocache: true } };

export default function DesignSystemPage() {
  if (process.env.CRC_COMPONENT_PAGE !== "1") notFound();
  return <Gallery />;
}
