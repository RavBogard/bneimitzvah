import { resolveIdentity } from "./identity";
/** A signed-in page's tab title: its h1, then the product ("Students | CRC Torah"). Screen-reader users and people with several tabs open tell pages apart by it. The product name comes from the congregation's identity settings. */
export const signedInTitle = (heading: string, productName: string = resolveIdentity().productName) => `${heading} | ${productName}`;
