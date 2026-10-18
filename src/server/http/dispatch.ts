import "server-only";
import { handleSourceContentRequest, sourceContentRouteMethods } from "./source-content";
import { handleSourceAssignmentsRequest, sourceAssignmentsRouteMethods } from "./source-assignments";
import { createRuntimeScope, type HttpRuntime } from "../runtime/composition";
import { handleAuthRequest, authRouteMethods } from "./auth";
import { handlePortalRequest, portalRouteMethods } from "./portal";
import { handleStudentWorkRequest, studentWorkRouteMethods } from "./student-work";
import { handleServiceLearningRequest, serviceLearningRouteMethods } from "./service-learning";
import { handleProgressRequest, progressRouteMethods } from "./progress";
import { handleLessonLogRequest, lessonLogRouteMethods } from "./lesson-log";
import { handlePracticeCalendarRequest, practiceCalendarRouteMethods } from "./practice-calendar";
import { handleRecordingsRequest, recordingsRouteMethods } from "./recordings";
import { errorResponse, HttpBoundaryError } from "./responses";

export type HttpRuntimeScope = (action: (runtime: HttpRuntime) => Promise<Response>) => Promise<Response>;
function cookieBoundary(request: Request) {
  const cookie = request.headers.get("cookie");
  if (cookie === null) return;
  if (Buffer.byteLength(cookie) > 16 * 1024 || /[\x00-\x1f\x7f]/.test(cookie)) throw new HttpBoundaryError();
  const names = new Set<string>();
  for (const part of cookie.split(";")) {
    const pair = part.trim(); if (!pair) continue;
    const equal = pair.indexOf("="); const name = pair.slice(0, equal);
    if (equal < 1 || !/^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/.test(name) || names.has(name)) throw new HttpBoundaryError();
    names.add(name);
  }
}
export function createHttpDispatcher(withRuntime: HttpRuntimeScope = createRuntimeScope()) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const methods = sourceContentRouteMethods(url.pathname) ?? sourceAssignmentsRouteMethods(url.pathname) ?? authRouteMethods(url.pathname) ?? portalRouteMethods(url.pathname) ?? studentWorkRouteMethods(url.pathname) ?? serviceLearningRouteMethods(url.pathname) ?? progressRouteMethods(url.pathname) ?? lessonLogRouteMethods(url.pathname) ?? practiceCalendarRouteMethods(url.pathname) ?? recordingsRouteMethods(url.pathname);
      // No provider configuration or connection required to refuse unowned
      // endpoints (including private SDK session/profile/password APIs).
      if (!methods) throw new HttpBoundaryError(404);
      if (!methods.includes(request.method)) {
        const response = errorResponse(new HttpBoundaryError(405));
        response.headers.set("allow", methods.join(", "));
        return response;
      }
      if (request.url.length > 2048) throw new HttpBoundaryError();
      cookieBoundary(request);
      return await withRuntime(async (runtime) => {
        try {
          await runtime.resolveHost(request);
          return await handleSourceContentRequest(request, runtime) ?? await handleSourceAssignmentsRequest(request, runtime) ?? await handleAuthRequest(request, runtime) ?? await handleStudentWorkRequest(request, runtime) ?? await handleServiceLearningRequest(request, runtime) ?? await handleProgressRequest(request, runtime) ?? await handleLessonLogRequest(request, runtime) ?? await handlePracticeCalendarRequest(request, runtime) ?? await handleRecordingsRequest(request, runtime) ?? await handlePortalRequest(request, runtime) ?? errorResponse(new HttpBoundaryError(404));
        } catch (error) {
          // Expected HTTP400/413/etc stay inside the scoped runtime callback;
          // otherwise its generic application-error boundary would make503.
          return errorResponse(error);
        }
      });
    } catch (error) { return errorResponse(error); }
  };
}
export const dispatchRequest = createHttpDispatcher();
