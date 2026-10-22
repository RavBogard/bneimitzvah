import type { MetadataRoute } from "next";

// Until beta (Daniel, 2026-10-22) nothing on the portal is for search engines,
// including the public reading. Pages also send X-Robots-Tag and a robots meta tag.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
