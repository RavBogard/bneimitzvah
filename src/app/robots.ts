import type { MetadataRoute } from "next";
import { selectedCanonicalOrigin } from "../lib/navigation/canonical";
import { robotsTxt } from "../lib/site/indexing";

// Until PUBLIC_INDEXING is switched on (Daniel decides when, 2026-10-23) nothing on the portal is for search engines,
// including the public reading. Pages also send X-Robots-Tag and a robots meta tag. Read per request: the canonical origin is runtime config.
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return robotsTxt(selectedCanonicalOrigin(process.env));
}
