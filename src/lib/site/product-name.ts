/**
 * Shown only when the tenant's product name cannot be read (a build or a request without the database). The name itself
 * lives in `tenant.product_name` and is read through src/server/data/product-name.ts; this is the same default the root layout uses.
 */
export const FALLBACK_PRODUCT_NAME = "CRC Torah";
/** A page title: the parts, then the product name, in the app's existing "Page | Product" pattern. */
export const pageTitle = (productName: string, ...parts: string[]) => [...parts, productName].join(" | ");
