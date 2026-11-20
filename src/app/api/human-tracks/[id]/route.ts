import { humanTrackMedia } from "../../../../server/human-tracks/runtime-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return humanTrackMedia(request, (await params).id);
}
export const HEAD = GET;
