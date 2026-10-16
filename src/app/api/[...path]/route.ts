import { dispatchRequest } from "@/server/http/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = dispatchRequest;
export const POST = dispatchRequest;
export const PUT = dispatchRequest;
export const PATCH = dispatchRequest;
export const DELETE = dispatchRequest;
export const HEAD = dispatchRequest;
export const OPTIONS = dispatchRequest;
