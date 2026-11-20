import { isCrcEnvironment } from "../../../../lib/site/identity";
import { parseShermetTiming } from "../../../../lib/reference-audio/shermet-timing";
import { SHERMET_TIMINGS } from "../../../../server/shermet-audio/timing-catalog";
import { SHERMET_PILOT_RECORDINGS } from "../../../../server/shermet-audio/pilot-metadata";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const refs = new URL(request.url).searchParams.getAll("ref");
  const recording = isCrcEnvironment(process.env) && refs.length === 1 ? SHERMET_PILOT_RECORDINGS.find(entry => entry.ref === refs[0]) : null;
  const matches = recording ? SHERMET_TIMINGS.filter(entry => entry.ref === recording.ref && entry.audioSha256 === recording.sha256 && entry.kind === recording.kind) : [];
  const timing = matches.length === 1 ? parseShermetTiming(matches[0]) : null;
  return Response.json({ timing }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
