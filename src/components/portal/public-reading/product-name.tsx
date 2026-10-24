"use client";
import { createContext, useContext, type ReactNode } from "react";
import { FALLBACK_PRODUCT_NAME } from "../../../lib/site/product-name";

const ProductNameContext = createContext<string>(FALLBACK_PRODUCT_NAME);
/** The page (a server component) read the congregation's product name; the reader's tab title ends with it. */
export function ProductNameScope({ name, children }: { name: string; children: ReactNode }) {
  return <ProductNameContext.Provider value={name}>{children}</ProductNameContext.Provider>;
}
export const useProductName = () => useContext(ProductNameContext);
