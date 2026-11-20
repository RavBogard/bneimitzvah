import { runtimeShermetLibrary } from "../../../../server/shermet-audio/library";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => runtimeShermetLibrary().media(request);
export const HEAD = GET;
