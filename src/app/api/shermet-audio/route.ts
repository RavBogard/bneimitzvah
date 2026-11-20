import { runtimeShermetAudio } from "../../../server/shermet-audio/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => runtimeShermetAudio().audio(request);
export const HEAD = GET;
