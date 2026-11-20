import { isCrcEnvironment } from "../../../../lib/site/identity";
import { parseShermetTiming } from "../../../../lib/reference-audio/shermet-timing";
import { getShermetTiming } from "../../../../server/shermet-audio/timing-catalog";
import { SHERMET_PILOT_RECORDINGS } from "../../../../server/shermet-audio/pilot-metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const refs = new URL(request.url).searchParams.getAll("ref");
  const rows = refs.length <= 32 && isCrcEnvironment(process.env) ? await Promise.all(refs.map(async ref => {
    const recording = SHERMET_PILOT_RECORDINGS.find(entry => entry.ref === ref);
    const timing = recording ? parseShermetTiming(await getShermetTiming(recording.ref, recording.sha256)) : null;
    return timing?.kind === recording?.kind ? timing : null;
  })) : [];
  const timings = rows.filter(row => row !== null);
  return Response.json(refs.length === 1 ? { timing: timings[0] ?? null } : { timings }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
