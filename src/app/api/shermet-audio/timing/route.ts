import { isCrcEnvironment } from "../../../../lib/site/identity";
import { getPublishedShermetTiming } from "../../../../server/shermet-audio/timing-catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const refs = new URL(request.url).searchParams.getAll("ref");
  const rows = refs.length <= 32 && isCrcEnvironment(process.env) ? await Promise.all(refs.map(getPublishedShermetTiming)) : [];
  const timings = rows.filter(row => row !== null);
  return Response.json(refs.length === 1 ? { timing: timings[0] ?? null } : { timings }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
