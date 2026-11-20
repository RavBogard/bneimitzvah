import { isCrcEnvironment } from "../../../../lib/site/identity";
import { parseShermetTiming } from "../../../../lib/reference-audio/shermet-timing";
import { SHERMET_TIMINGS } from "../../../../server/shermet-audio/timing-catalog";
import { SHERMET_PILOT_RECORDINGS } from "../../../../server/shermet-audio/pilot-metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const refs = new URL(request.url).searchParams.getAll("ref");
  const timings = refs.length <= 32 && isCrcEnvironment(process.env) ? refs.flatMap(ref => {
    const recording = SHERMET_PILOT_RECORDINGS.find(entry => entry.ref === ref);
    const matches = recording ? SHERMET_TIMINGS.filter(entry => entry.ref === recording.ref && entry.audioSha256 === recording.sha256 && entry.kind === recording.kind) : [];
    const timing = matches.length === 1 ? parseShermetTiming(matches[0]) : null;
    return timing ? [timing] : [];
  }) : [];
  return Response.json(refs.length === 1 ? { timing: timings[0] ?? null } : { timings }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
