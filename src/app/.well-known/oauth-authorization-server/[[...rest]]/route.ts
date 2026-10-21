import { dispatchRequest } from "@/server/http/dispatch";

// Static OAuth discovery for the portal MCP, served by the same closed dispatcher as /api.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = dispatchRequest;
