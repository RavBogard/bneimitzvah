import type { createServiceEcosystemService } from "../../../../server/service-ecosystem/service";
import type { ServiceUnitMaterial } from "../../../../lib/service-learning/types";
import { PortalRequestError } from "../../api";
import { identifier, type BaseMode } from "../api";
import { material } from "./api";

export type MyService = Awaited<ReturnType<ReturnType<typeof createServiceEcosystemService>["view"]>>;
export type ConnectedService = Extract<MyService, { parts: unknown }>;
export async function serviceRequest(mode: BaseMode, studentId: string, action: "view" | "synchronize" | "assign" | "progress" | "request" | "respond" | "resource" | "material"|"separate", body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
  identifier(studentId);
  const path = `/api/students/${studentId}/my-service${action === "view" ? `?mode=${mode}` : `/${action}`}`;
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 20_000);
  try {
    const response = await fetch(path, { method: action === "view" ? "GET" : "POST", body: action === "view" ? undefined : JSON.stringify({ mode, ...body }),
      headers: { accept: "application/json", ...(action === "view" ? {} : { "content-type": "application/json" }) }, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) throw new PortalRequestError(response.status);
    if (!response.headers.get("content-type")?.startsWith("application/json") || !response.body) throw new PortalRequestError(503);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 256 * 1024) throw new PortalRequestError(503); chunks.push(next.value); } }
    finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch (error) { if (error instanceof PortalRequestError) throw error; throw new PortalRequestError(503); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
export async function readMyService(mode: BaseMode, studentId: string, signal: AbortSignal): Promise<MyService> {
  const value = await serviceRequest(mode, studentId, "view", {}, signal);
  if (!value || typeof value !== "object" || !["unscheduled", "stale", "pending", "linked", "ambiguous", "unavailable", "review_required"].includes(String((value as { state?: unknown }).state))) throw new PortalRequestError(503);
  const view = value as MyService;
  if ("parts" in view && (!Array.isArray(view.parts) || !Array.isArray(view.rows) || !Array.isArray(view.requests))) throw new PortalRequestError(503);
  return view;
}
export async function readServiceMaterial(mode: BaseMode, studentId: string, rowId: string, signal: AbortSignal): Promise<ServiceUnitMaterial> {
  const value = await serviceRequest(mode, studentId, "material", { rowId }, signal);
  if (!value || typeof value !== "object" || !("material" in value)) throw new PortalRequestError(503);
  return material(value.material);
}
