import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessDatabase } from "../access/types";
import type { createPracticeService } from "../practice/service";
import { createGuideChecker } from "../study-guides/citations";
import { createStudyGuideService } from "../study-guides/service";
import type { RelatedSourceCatalog } from "../study/sources/metadata";
import type { StudyPage, StudyRequest } from "../study/types";
import { INSTRUCTIONS, SERVER_INFO } from "./instructions";
import { createMcpAuthService, type McpActor } from "./service";
import { createTools } from "./tools";
import { answerRpc } from "./transport";

/**
 * The composed portal MCP, closed over its database: the HTTP layer sees only the OAuth steps,
 * bearer authentication and one JSON-RPC answer, never a transaction or a service with writes.
 */
export function createMcpEndpoint<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>; secret: string;
  loadText: (request: StudyRequest) => Promise<StudyPage>; related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>;
}) {
  const mcp = createMcpAuthService({ db: input.db, access: input.access, secret: input.secret });
  const guides = createStudyGuideService({ access: input.access, practice: input.practice, check: createGuideChecker({ related: input.related }) });
  const tools = createTools<Q>();
  return Object.freeze({
    register: mcp.register, authorize: mcp.authorize, describe: mcp.describe, approve: mcp.approve, deny: mcp.deny,
    token: mcp.token, revoke: mcp.revoke, authenticate: mcp.authenticate,
    answer: (body: unknown, actor: McpActor, signal: AbortSignal) => answerRpc(body, { tools, instructions: INSTRUCTIONS, serverInfo: SERVER_INFO, signal,
      ctx: { actor, mcp, guides, loadText: input.loadText, related: input.related, db: input.db } }),
  });
}
export type McpEndpoint = ReturnType<typeof createMcpEndpoint>;
