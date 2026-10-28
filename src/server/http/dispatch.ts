import "server-only";
import { handleHonorsRequest, honorsRouteMethods } from "./honors";
import { bookletRouteMethods, handleBookletRequest } from "./booklet";
import { handleSourceContentRequest, sourceContentRouteMethods } from "./source-content";
import { handleSourceAssignmentsRequest, sourceAssignmentsRouteMethods } from "./source-assignments";
import { createRuntimeScope, type HttpRuntime } from "../runtime/composition";
import { handleAuthRequest, authRouteMethods, googleCallbackFailure } from "./auth";
import { handlePortalRequest, portalRouteMethods } from "./portal";
import { handleStaffRequest, staffRouteMethods } from "./staff";
import { handleStudentWorkRequest, studentWorkRouteMethods } from "./student-work";
import { handleServiceLearningRequest, serviceLearningRouteMethods } from "./service-learning";
import { handleServiceEcosystemRequest, serviceEcosystemRouteMethods } from "./service-ecosystem";
import { handleProgressRequest, progressRouteMethods } from "./progress";
import { handleStudyGuidesRequest, studyGuidesRouteMethods } from "./study-guides";
import { handleRosterSheetRequest, rosterSheetRouteMethods } from "./roster-sheet";
import { handleMcpRequest, mcpRouteMethods } from "./mcp";
import { handleNotificationsRequest, notificationsRouteMethods } from "./notifications";
import { handleSavedRequest, savedRouteMethods } from "./saved";
import { handleLearnersRequest, learnersRouteMethods } from "./learners";
import { handleOfflineRequest, offlineRouteMethods } from "./offline";
import { accountsRouteMethods, handleAccountsRequest } from "./accounts";
import { courseProgressRouteMethods, handleCourseProgressRequest } from "./course-progress";
import { handleServiceCourseRequest, serviceCourseRouteMethods } from "./service-course-progress";
import { handleServicePartFinishedRequest, servicePartFinishedRouteMethods } from "./service-part-finished";
import { handlePracticeVisibilityRequest, practiceVisibilityRouteMethods } from "./practice-visibility";
import { handleVerseReviewRequest, verseReviewRouteMethods } from "./verse-review";
import { congregationSettingsRouteMethods, handleCongregationSettingsRequest } from "./congregation-settings";
import { claudeConnectionsRouteMethods, handleClaudeConnectionsRequest } from "./claude-connections";
import { handleLessonLogRequest, lessonLogRouteMethods } from "./lesson-log";
import { handlePracticeCalendarRequest, practiceCalendarRouteMethods } from "./practice-calendar";
import { handleRecordingsRequest, recordingsRouteMethods } from "./recordings";
import { finishReferenceReviewResponse, handleReferenceReviewRequest, referenceReviewRouteMethods } from "./reference-review";
import { errorResponse, HttpBoundaryError } from "./responses";
import { finishHonoreeGuestResponse, finishHonoreeManagementResponse, handleHonoreeRequest, honoreeManagementRouteMethods } from "./honoree";
import { handlePublicReadingRequest, isPublicReadingPath, type PublicRuntimeScope } from "./public-reading";
import { createPageViewScope, createPublicRuntimeScope } from "../runtime/public-composition";
import { handlePageViewRequest, isPageViewPath, type PageViewScope } from "./page-views";

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
export function createHttpDispatcher(withRuntime: HttpRuntimeScope = createRuntimeScope(), withPublic: PublicRuntimeScope = createPublicRuntimeScope(), withViews: PageViewScope = createPageViewScope()) {
  return async (request: Request): Promise<Response> => {
    // Google's redirect-mode return is a browser navigation: any failure, including an unavailable
    // runtime, lands on a page with a plain error rather than a JSON body.
    let googleReturn = false;
    try {
      const url = new URL(request.url);
      googleReturn = url.pathname === "/api/auth/callback/google" && request.method === "GET";
      // Signed-out reading: its own allowlist and its own runtime, which has no auth stack.
      // Cookies are never interpreted here (Authorization is refused); nothing on this branch opens a session.
      // The page-view beacon (1.5, "path and day only"): the same cookie-blind rules on a runtime smaller still; it always answers 204.
      if (isPageViewPath(url.pathname)) return await handlePageViewRequest(request, withViews);
      if (isPublicReadingPath(url.pathname)) return await handlePublicReadingRequest(request, withPublic);
      if (url.pathname === "/api/honoree/read") {
        const denied = () => errorResponse(new HttpBoundaryError(404));
        // Guest capability transport never interprets authentication cookies or
        // inherits the authenticated method/runtime diagnostic envelopes.
        try {
          if (request.method !== "POST" || url.search || request.url.length > 2048 || request.signal.aborted
            || request.headers.has("cookie") || request.headers.has("authorization") || request.headers.has("X-Practice-Context")) return denied();
          const started = performance.now();
          const response = await withRuntime(async runtime => {
            try { return await handleHonoreeRequest(request, runtime) ?? denied(); }
            catch { return denied(); }
          });
          // Runtime cleanup can await after the service barrier. Subtract the
          // entire scope duration conservatively before the final sync return.
          return finishHonoreeGuestResponse(request, response, started);
        } catch { return denied(); }
      }
      const managementMethods = honoreeManagementRouteMethods(url.pathname);
      const methods = managementMethods ?? referenceReviewRouteMethods(url.pathname) ?? bookletRouteMethods(url.pathname) ?? serviceEcosystemRouteMethods(url.pathname) ?? honorsRouteMethods(url.pathname) ?? sourceContentRouteMethods(url.pathname) ?? sourceAssignmentsRouteMethods(url.pathname) ?? authRouteMethods(url.pathname) ?? portalRouteMethods(url.pathname) ?? studentWorkRouteMethods(url.pathname) ?? serviceLearningRouteMethods(url.pathname) ?? progressRouteMethods(url.pathname) ?? studyGuidesRouteMethods(url.pathname) ?? congregationSettingsRouteMethods(url.pathname) ?? claudeConnectionsRouteMethods(url.pathname) ?? rosterSheetRouteMethods(url.pathname) ?? notificationsRouteMethods(url.pathname) ?? savedRouteMethods(url.pathname) ?? learnersRouteMethods(url.pathname) ?? offlineRouteMethods(url.pathname) ?? accountsRouteMethods(url.pathname) ?? courseProgressRouteMethods(url.pathname) ?? serviceCourseRouteMethods(url.pathname) ?? servicePartFinishedRouteMethods(url.pathname) ?? practiceVisibilityRouteMethods(url.pathname) ?? staffRouteMethods(url.pathname) ?? verseReviewRouteMethods(url.pathname) ?? mcpRouteMethods(url.pathname) ?? lessonLogRouteMethods(url.pathname) ?? practiceCalendarRouteMethods(url.pathname) ?? recordingsRouteMethods(url.pathname);
      // No provider configuration or connection required to refuse unowned
      // endpoints (including private SDK session/profile/password APIs).
      if (!methods) throw new HttpBoundaryError(404);
      if (!methods.includes(request.method)) {
        const response = errorResponse(new HttpBoundaryError(405));
        response.headers.set("allow", methods.join(", "));
        return response;
      }
      // Google controls its return's query (scopes are echoed), and a tossed odd cookie must not stop the
      // handler from consuming the state: for that one route the handler applies the cookie checks itself.
      if (request.url.length > (googleReturn ? 8192 : 2048)) throw new HttpBoundaryError();
      if (!googleReturn) cookieBoundary(request);
      if (managementMethods) {
        const response = await withRuntime(async runtime => {
          try {
            await runtime.resolveHost(request);
            return await handleHonoreeRequest(request, runtime) ?? errorResponse(new HttpBoundaryError(404));
          } catch (error) { return errorResponse(error); }
        });
        return finishHonoreeManagementResponse(request, response);
      }
      const response = await withRuntime(async (runtime) => {
        try {
          await runtime.resolveHost(request);
          const referenceReviewResponse = await handleReferenceReviewRequest(request, runtime.referenceReview);
          if (referenceReviewResponse) return referenceReviewResponse;
          return await handleBookletRequest(request, runtime) ?? await handleServiceEcosystemRequest(request, runtime) ?? await handleHonorsRequest(request, runtime) ?? await handleSourceContentRequest(request, runtime) ?? await handleSourceAssignmentsRequest(request, runtime) ?? await handleAuthRequest(request, runtime) ?? await handleStudentWorkRequest(request, runtime) ?? await handleServiceLearningRequest(request, runtime) ?? await handleProgressRequest(request, runtime) ?? await handleStudyGuidesRequest(request, runtime) ?? await handleCongregationSettingsRequest(request, runtime) ?? await handleClaudeConnectionsRequest(request, runtime) ?? await handleRosterSheetRequest(request, runtime) ?? await handleNotificationsRequest(request, runtime) ?? await handleSavedRequest(request, runtime) ?? await handleLearnersRequest(request, runtime) ?? await handleOfflineRequest(request, runtime) ?? await handleAccountsRequest(request, runtime) ?? await handleCourseProgressRequest(request, runtime) ?? await handleServiceCourseRequest(request, runtime) ?? await handleServicePartFinishedRequest(request, runtime) ?? await handlePracticeVisibilityRequest(request, runtime) ?? await handleStaffRequest(request, runtime) ?? await handleVerseReviewRequest(request, runtime) ?? await handleMcpRequest(request, runtime) ?? await handleLessonLogRequest(request, runtime) ?? await handlePracticeCalendarRequest(request, runtime) ?? await handleRecordingsRequest(request, runtime) ?? await handlePortalRequest(request, runtime) ?? errorResponse(new HttpBoundaryError(404));
        } catch (error) {
          // Expected HTTP400/413/etc stay inside the scoped runtime callback;
          // otherwise its generic application-error boundary would make503.
          return errorResponse(error);
        }
      });
      if (googleReturn && !(response.status >= 300 && response.status < 400)) return googleCallbackFailure(request);
      return finishReferenceReviewResponse(request, response);
    } catch (error) { return googleReturn ? googleCallbackFailure(request) : errorResponse(error); }
  };
}
export const dispatchRequest = createHttpDispatcher();
