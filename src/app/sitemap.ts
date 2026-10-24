import type { MetadataRoute } from "next";
import { selectedCanonicalOrigin } from "../lib/navigation/canonical";
import { sitemapEntries } from "../lib/site/sitemap";

// The canonical origin is runtime config (BETTER_AUTH_URL, one of CANONICAL_ORIGINS), so this is read per request.
// Outside production no origin is selected and the sitemap is empty. robots.txt names it only once PUBLIC_INDEXING is on.
export const dynamic = "force-dynamic";
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(selectedCanonicalOrigin(process.env));
}
