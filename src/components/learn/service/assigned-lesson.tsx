"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { assignedLessonTarget, assignedPartsHref, type AssignedLessonTarget } from "../../../lib/service-course/assigned-parts";
import { CRC_TENANT, type ServiceSlot } from "../../../lib/service-course/course";
import { lessonForUnit } from "../../../lib/service-course/path";
import { PortalRequestError } from "../../portal/api";
import { serviceApi } from "../../portal/workspace/service-learning/api";
import { serviceRequest } from "../../portal/workspace/service-learning/ecosystem-api";
import type { Selection } from "../../portal/workspace/api";
import { useChildLearning } from "../child-practice";

const subscribe = (listen: () => void) => { window.addEventListener("hashchange", listen); return () => window.removeEventListener("hashchange", listen); };
type Status = { state: "loading" | "changed" | "failed" } | { state: "ready"; slot: ServiceSlot };
const changed = (): never => { throw new PortalRequestError(409); };

export async function checkAssignedLesson(target: AssignedLessonTarget, lessonId: string, complete: boolean, signal: AbortSignal, child?: Selection): Promise<ServiceSlot> {
  if (child && child.context.studentId !== target.studentId) return changed();
  const mode = child ? "child-practice" : "student";
  if (target.source === "music") {
    const value = await serviceRequest(mode, target.studentId, "lesson", { rowId: target.rowId, key: target.key, lessonId, complete }, signal, child);
    const result = value as { ok?: unknown; slot?: unknown } | null;
    if (result?.ok !== true || result.slot !== "morning" && result.slot !== "havdalah") throw new PortalRequestError(503);
    return result.slot;
  }
  if (complete) return serviceApi.completeLesson(mode, target.studentId, { planId: target.planId, planRevision: target.revision, catalogIdentity: target.catalogIdentity, unitId: target.unitId, lessonId }, signal, child);
  const result = await serviceApi.metadata(mode, target.studentId, signal, child);
  if (result.state !== "assigned" || result.plan.id !== target.planId || result.plan.revision !== target.revision
    || result.plan.catalogIdentity !== target.catalogIdentity || result.plan.needsReview
    || !result.units.some(unit => unit.id === target.unitId) || lessonForUnit(CRC_TENANT, target.unitId) !== lessonId) return changed();
  return target.unitId.endsWith("@bm-maariv") ? "havdalah" : "morning";
}

export function useAssignedServiceLesson(lessonId: string) {
  const child = useChildLearning();
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const target = useMemo(() => assignedLessonTarget(hash), [hash]);
  const scope = useMemo(() => ({ target, child, lessonId }), [target, child, lessonId]);
  const [reply, setReply] = useState<{ scope: typeof scope; status: Status }>();
  const [attempt, setAttempt] = useState(0);
  const check = useCallback((complete: boolean, signal: AbortSignal) => target
    ? checkAssignedLesson(target, lessonId, complete, signal, child?.selection)
    : Promise.reject(new PortalRequestError(409)), [target, lessonId, child]);
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    void check(false, controller.signal).then(slot => {
      if (!controller.signal.aborted) setReply({ scope, status: { state: "ready", slot } });
    }, error => {
      if (!controller.signal.aborted) setReply({ scope, status: {
        state: error instanceof PortalRequestError && [401, 403, 404, 409].includes(error.status) ? "changed" : "failed",
      } });
    });
    return () => controller.abort();
  }, [attempt, check, scope, target]);
  if (!target) return null;
  const status: Status = reply?.scope === scope ? reply.status : { state: "loading" };
  return { status, scope, check, retry: () => { setReply(undefined); setAttempt(n => n + 1); }, back: assignedPartsHref(child?.selection.context.studentId, target) };
}
