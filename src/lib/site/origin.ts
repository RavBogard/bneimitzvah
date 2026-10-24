import { selectedCanonicalOrigin } from "../navigation/canonical";

/**
 * Where relative metadata URLs (the share card) resolve: the canonical origin BETTER_AUTH_URL selects in production,
 * never an alias such as the vercel.app host. Outside production none is selected and Next's own default applies.
 */
export function publicMetadataBase(env: Readonly<Record<string, string | undefined>> = process.env): URL | undefined {
  const origin = selectedCanonicalOrigin(env);
  return origin ? new URL(origin) : undefined;
}
