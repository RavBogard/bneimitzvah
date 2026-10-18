import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { Release } from "../data/honoree";
import { AccessDenied } from "../access/errors";
import { catalog } from "../service-learning/data";
import { parseServiceFeed } from "../service-learning/feed";
import { APPROVED_BOOKLET, projectBooklet } from "./booklet-projector";
import { material, unitPair } from "./recipient-material";

/** Called only after the service holds lifecycle then active-release locks. */
export async function loadHonoreeMaterial<Q extends PgQueryResultHKT>(release: Release, tx: AccessTransaction<Q>, live: () => void) {
  live();
  if (release.state !== "active" || (release.slot !== "morning" && release.slot !== "havdalah")) throw new AccessDenied(404);
  const row = await catalog(tx, release.tenantId, release.catalogId); live();
  try {
    if (!row || row.tenantId !== release.tenantId || row.id !== release.catalogId || row.identity !== release.catalogIdentity || row.identity !== APPROVED_BOOKLET.identity) throw 0;
    for (const key of ["feedSha256", "provenanceSha256", "artifactRepo", "artifactCommit", "artifactRunId", "sourceGitSha"] as const) {
      if (row.pins[key] !== APPROVED_BOOKLET[key]) throw 0;
    }
    const feed = parseServiceFeed(row.feedBytes, row.provenanceBytes, row.pins); live();
    if (feed.identity !== row.identity) throw 0;
    const result = material(projectBooklet(feed, release.slot), release.projectionDigest), pair = unitPair(release.slot);
    if (release.beforeId !== pair[0] || release.afterId !== pair[1] || release.materialVersion !== result.version || JSON.stringify(release.notices) !== JSON.stringify(result.credits)) throw 0;
    live(); return result;
  } catch { throw new AccessDenied(404); }
}
