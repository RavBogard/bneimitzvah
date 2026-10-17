import { runRuntimeReadProbe, runtimeReadNotFound } from "../../../../server/media/runtime-read-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (request.method !== "GET") return runtimeReadNotFound();
  return runRuntimeReadProbe(request);
}
export const HEAD = runtimeReadNotFound;
export const POST = runtimeReadNotFound;
export const PUT = runtimeReadNotFound;
export const PATCH = runtimeReadNotFound;
export const DELETE = runtimeReadNotFound;
export const OPTIONS = runtimeReadNotFound;
