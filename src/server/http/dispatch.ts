import "server-only";
import { accountDisplayNameRouteMethods, handleAccountDisplayNameRequest } from "./account-display-name";
import { pronounsRouteMethods, handlePronounsRequest } from "./pronouns";
import { tutorSpokenRouteMethods, handleTutorSpokenRequest } from "./tutor-spoken";
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
import { guideShareRouteMethods, handleGuideShareRequest } from "./guide-share";
import { guideAdminRouteMethods, handleGuideAdminRequest } from "./guide-admin";
import { congregationSettingsRouteMethods, handleCongregationSettingsRequest } from "./congregation-settings";
import { claudeConnectionsRouteMethods, handleClaudeConnectionsRequest } from "./claude-connections";
import { handleLessonLogRequest, lessonLogRouteMethods } from "./lesson-log";
import { handlePracticeCalendarRequest, practiceCalendarRouteMethods } from "./practice-calendar";
import { errorResponse, HttpBoundaryError, recordIfUnexpected } from "./responses";
import { failureRecorded, recordUnexplainedStatus, runWithRequestContext } from "../logging/failure";
import { finishHonoreeGuestResponse, finishHonoreeManagementResponse, handleHonoreeRequest, honoreeManagementRouteMethods } from "./honoree";
import { handlePublicReadingRequest, isPublicReadingPath, type PublicRuntimeScope } from "./public-reading";
import { createPageViewScope, createPublicRuntimeScope } from "../runtime/public-composition";
import { handlePageViewRequest, isPageViewPath, type PageViewScope } from "./page-views";

export type HttpRuntimeScope = (action: (runtime: HttpRuntime) => Promise<Response>) => Promise<Response>;
/**
 * One route module: the methods it accepts for a path it owns (null for any other path) and its handler. The dispatcher
 * answers 404 and 405 (with Allow) from `methods`, so a handler only ever sees its own paths with a declared method.
 * `site` names the failure line for an unexpected error; `finish` is a module's final synchronous fence.
 */
type RouteModule = Readonly<{
  methods: (pathname: string) => readonly string[] | null;
  handle: (request: Request, runtime: HttpRuntime) => Promise<Response | null>;
  site?: string;
  finish?: (request: Request, response: Response) => Response;
}>;
/**
 * Every authenticated route module, in match order: a path belongs to the first module whose `methods` answers.
 * No two modules own the same path (tests/app/dispatch-characterization.test.ts records every one); the honoree guest
 * read, signed-out reading and the page-view beacon are cookie-blind branches ahead of this table.
 */
const routes: readonly RouteModule[] = [
  { methods: accountDisplayNameRouteMethods, handle: handleAccountDisplayNameRequest },
  { methods: pronounsRouteMethods, handle: handlePronounsRequest },
  // Honoree management: its own failure site, and the captured session fence after runtime cleanup.
  { methods: honoreeManagementRouteMethods, handle: handleHonoreeRequest, site: "dispatch/honoree-management", finish: finishHonoreeManagementResponse },
  { methods: bookletRouteMethods, handle: handleBookletRequest },
  { methods: serviceEcosystemRouteMethods, handle: handleServiceEcosystemRequest },
  { methods: honorsRouteMethods, handle: handleHonorsRequest },
  { methods: sourceContentRouteMethods, handle: handleSourceContentRequest },
  { methods: sourceAssignmentsRouteMethods, handle: handleSourceAssignmentsRequest },
  { methods: authRouteMethods, handle: handleAuthRequest },
  { methods: portalRouteMethods, handle: handlePortalRequest },
  { methods: studentWorkRouteMethods, handle: handleStudentWorkRequest },
  { methods: serviceLearningRouteMethods, handle: handleServiceLearningRequest },
  { methods: progressRouteMethods, handle: handleProgressRequest },
  { methods: studyGuidesRouteMethods, handle: handleStudyGuidesRequest },
  { methods: guideShareRouteMethods, handle: handleGuideShareRequest },
  { methods: guideAdminRouteMethods, handle: handleGuideAdminRequest },
  { methods: congregationSettingsRouteMethods, handle: handleCongregationSettingsRequest },
  { methods: claudeConnectionsRouteMethods, handle: handleClaudeConnectionsRequest },
  { methods: notificationsRouteMethods, handle: handleNotificationsRequest },
  { methods: savedRouteMethods, handle: handleSavedRequest },
  { methods: learnersRouteMethods, handle: handleLearnersRequest },
  { methods: tutorSpokenRouteMethods, handle: handleTutorSpokenRequest },
  { methods: offlineRouteMethods, handle: handleOfflineRequest },
  { methods: accountsRouteMethods, handle: handleAccountsRequest },
  { methods: courseProgressRouteMethods, handle: handleCourseProgressRequest },
  { methods: serviceCourseRouteMethods, handle: handleServiceCourseRequest },
  { methods: servicePartFinishedRouteMethods, handle: handleServicePartFinishedRequest },
  { methods: practiceVisibilityRouteMethods, handle: handlePracticeVisibilityRequest },
  { methods: staffRouteMethods, handle: handleStaffRequest },
  { methods: verseReviewRouteMethods, handle: handleVerseReviewRequest },
  { methods: mcpRouteMethods, handle: handleMcpRequest },
  { methods: lessonLogRouteMethods, handle: handleLessonLogRequest },
  { methods: practiceCalendarRouteMethods, handle: handlePracticeCalendarRequest },
];
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
  const dispatch = async (request: Request): Promise<Response> => {
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
            // The guest refusal stays uniform; an unexpected failure is only written server-side.
            catch (error) { recordIfUnexpected(error, "dispatch/honoree-guest"); return denied(); }
          });
          // Runtime cleanup can await after the service barrier. Subtract the
          // entire scope duration conservatively before the final sync return.
          return finishHonoreeGuestResponse(request, response, started);
        } catch (error) { recordIfUnexpected(error, "dispatch/honoree-guest"); return denied(); }
      }
      // One match: the first module in the table that owns the path gives both its methods and its handler.
      let route: RouteModule | undefined, methods: readonly string[] | null = null;
      for (const candidate of routes) if ((methods = candidate.methods(url.pathname))) { route = candidate; break; }
      // No provider configuration or connection required to refuse unowned
      // endpoints (including private SDK session/profile/password APIs).
      if (!route || !methods) throw new HttpBoundaryError(404);
      if (!methods.includes(request.method)) {
        const response = errorResponse(new HttpBoundaryError(405));
        response.headers.set("allow", methods.join(", "));
        return response;
      }
      // Google controls its return's query (scopes are echoed), and a tossed odd cookie must not stop the
      // handler from consuming the state: for that one route the handler applies the cookie checks itself.
      if (request.url.length > (googleReturn ? 8192 : 2048)) throw new HttpBoundaryError();
      if (!googleReturn) cookieBoundary(request);
      const owner = route;
      const response = await withRuntime(async (runtime) => {
        try {
          await runtime.resolveHost(request);
          return await owner.handle(request, runtime) ?? errorResponse(new HttpBoundaryError(404));
        } catch (error) {
          // Expected HTTP400/413/etc stay inside the scoped runtime callback;
          // otherwise its generic application-error boundary would make503.
          recordIfUnexpected(error, owner.site ?? "dispatch/handler");
          return errorResponse(error);
        }
      });
      if (owner.finish) return owner.finish(request, response);
      if (googleReturn && !(response.status >= 300 && response.status < 400)) return googleCallbackFailure(request);
      return response;
    } catch (error) {
      recordIfUnexpected(error, "dispatch/boundary");
      return googleReturn ? googleCallbackFailure(request) : errorResponse(error);
    }
  };
  // Every request runs with a generated id, its method and its redacted route (logging/redact.ts), so any failure
  // line written below names where it happened. A 5xx that no catch recorded still gets one line with the route.
  // Logging only reads the response's status; the response itself is returned unchanged.
  return (request: Request): Promise<Response> => runWithRequestContext(request, async () => {
    const response = await dispatch(request);
    try { if (response.status >= 500 && !failureRecorded()) recordUnexplainedStatus("dispatch/unrecorded-5xx", response.status); }
    catch { /* Logging cannot change the operation outcome. */ }
    return response;
  });
}
export const dispatchRequest = createHttpDispatcher();
