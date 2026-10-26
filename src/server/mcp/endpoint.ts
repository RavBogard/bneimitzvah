import { createDelegatedInvitations, type InvitationTransport } from "../invitations/service";
import "server-only";
import { createHmac } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessDatabase } from "../access/types";
import type { createPracticeService } from "../practice/service";
import { createGuideChecker } from "../study-guides/citations";
import { createStudyGuideService } from "../study-guides/service";
import type { RelatedSourceCatalog } from "../study/sources/metadata";
import type { StudyPage, StudyRequest } from "../study/types";
import { createDelegatedSourceAssignments } from "../study/source-assignments-service";
import { createReadingWork } from "../students/service";
import type { Calendar, Snapshot } from "../../lib/readings/proposals";
import { INSTRUCTIONS, SERVER_INFO } from "./instructions";
import { createMcpAuthService, type McpActor } from "./service";
import { createTools } from "./tools";
import { answerRpc } from "./transport";
import { createDiscussionService } from "../discussions/service";
import { createSefariaPinnedSourceReader, type PinnedSourceReader } from "../study/source-text";

/**
 * The composed portal MCP, closed over its database: the HTTP layer sees only the OAuth steps,
 * bearer authentication and one JSON-RPC answer, never a transaction or a service with writes.
 */
export function createMcpEndpoint<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>; secret: string;
  loadText: (request: StudyRequest) => Promise<StudyPage>; related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>;
  /** The portal's calendar reader (Hebcal), for the reading tools. */
  loadReading: (date: string, calendar: Calendar) => Promise<{ snapshot: Snapshot; fetchedAt: number }>;
  /** One Sefaria passage in one named edition, for the curated discussion checks (1.7 M6); live Sefaria when omitted. */
  pinnedSource?: PinnedSourceReader;
  /** The clock, for tests; Date.now otherwise. */
  now?: () => number;
  /** The portal's invitation email and send budget, for invite_tutor; without it the tool answers that invitations are unavailable. */
  invitations?: { transport: InvitationTransport; throttleSecret: string };
}) {
  const mcp = createMcpAuthService({ db: input.db, access: input.access, secret: input.secret, now: input.now });
  const guides = createStudyGuideService({ access: input.access, practice: input.practice, check: createGuideChecker({ related: input.related }) });
  // The reading editor's and the source panel's own write paths, for the roster-consented setup tools.
  const readings = createReadingWork<Q>({ loadReading: input.loadReading, now: input.now,
    signingSecret: createHmac("sha256", input.secret).update("portal-mcp:reading-preparations/v1").digest("base64url") });
  const sources = createDelegatedSourceAssignments<Q>({ related: input.related });
  const discussions = createDiscussionService<Q>({ pinned: input.pinnedSource ?? createSefariaPinnedSourceReader({ fetch: (...args) => globalThis.fetch(...args) }) });
  const invitations = input.invitations ? createDelegatedInvitations<Q>({ db: input.db, ...input.invitations }) : null;
  const tools = createTools<Q>();
  return Object.freeze({
    register: mcp.register, authorize: mcp.authorize, describe: mcp.describe, approve: mcp.approve, deny: mcp.deny,
    token: mcp.token, revoke: mcp.revoke, authenticate: mcp.authenticate,
    answer: (body: unknown, actor: McpActor, signal: AbortSignal) => answerRpc(body, { tools, instructions: INSTRUCTIONS, serverInfo: SERVER_INFO, signal,
      ctx: { actor, mcp, guides, loadText: input.loadText, related: input.related, loadReading: input.loadReading, db: input.db, readings, sources, discussions, invitations } }),
  });
}
export type McpEndpoint = ReturnType<typeof createMcpEndpoint>;
