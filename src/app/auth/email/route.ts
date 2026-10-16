import { fragmentLanding } from "@/server/http/fragment-landing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const respond = (request: Request) => fragmentLanding(request, "email");
export const GET = respond;
export const POST = respond;
export const PUT = respond;
export const PATCH = respond;
export const DELETE = respond;
export const HEAD = respond;
export const OPTIONS = respond;
