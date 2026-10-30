"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useIdentity } from "../../site/identity-context";

const ProductNameContext = createContext<string | null>(null);
/** The page (a server component) read the congregation's product name; the reader's tab title ends with it. */
export function ProductNameScope({ name, children }: { name: string; children: ReactNode }) {
  return <ProductNameContext.Provider value={name}>{children}</ProductNameContext.Provider>;
}
export function useProductName() {
  const scoped = useContext(ProductNameContext), identity = useIdentity();
  return scoped ?? identity.productName;
}
