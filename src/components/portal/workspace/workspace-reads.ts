import { PortalRequestError } from "../api";
import { workspaceApi, type Assigned, type ReadingMode, type Selection } from "./api";
import type { PracticeCoordinator } from "./practice";
import { fetchStudyPage, type StudyKind, type StudyVerse } from "./study/api";
import { explorationApi, type PreparedExploration } from "./study/exploration-api";
import { checkShortReferenceSelection, fetchShortReferencePage } from "./study/short-reference-api";
import { createShortReferenceBridge } from "./study/short-reference-bridge";
import { fetchShortExplorationPage, checkShortExplorationExpectation } from "./study/short-exploration-api";
import { createShortExplorationOwner as composeShortExplorationOwner } from "./study/short-exploration-owner";
import { fetchWordToolsAids, fetchWordToolsDetails } from "./study/word-tools-api";
import { createSourceContentClient, captureEditionChoice, captureEditionPage, isSourceMissing, SourceContentError, type SourceContentClient, type SourceContentTarget, type EditionPageRequest, type EditionChoice } from "./study/sources/content-api";
import { createSourceContentBudget } from "./study/sources/content-budget";
import { createSourceAssignmentClient, SourceClientError, type SourceAssignmentClient } from "./study/sources/api";
import type { StudyPage } from "./study/api";
import { fetchWork, type WorkOperation } from "./work/api";
import { fetchProgress, type ProgressOperation } from "./progress/api";
import { fetchGuide, type GuideOperation } from "./study/guide-api";
import { serviceApi, type ServicePlan } from "./service-learning/api";
import { readMyService as readMyServiceApi, readServiceMaterial as readMyServiceMaterialApi, serviceRequest } from "./service-learning/ecosystem-api";
import { fetchLessons, type LessonOperation } from "./lessons/api";
import { fetchPracticeCalendar, type PracticeOperation } from "./practice-calendar/api";

export const statusOf = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;

/**
 * What the reads need from the provider. The server decides every read; nothing here proves or re-proves access.
 * `version` is the one staleness value: the provider bumps it whenever it drops private state (a refusal, another person
 * signed in, a practice sitting starting, ending or expiring). An answer that arrives after a bump belongs to a view that
 * is gone: it is thrown away as a 409, and its refusal (if any) is ignored, so it can never clear the view that replaced it.
 */
export type ReadEnvironment = {
  practice: PracticeCoordinator;
  version(): number;
  sessionBinding(): string | null;
  /** The central 401/403 handler (provider.tsx `denied`). */
  denied(status: number): void;
  /** A child-practice read refused on that sitting's own page ends the sitting; false when this is not that page. */
  practiceRefused(studentId: string): boolean;
  clearWork(): void;
};

/**
 * What a 403/404 means for a read (a 401 always goes to the central handler: the person is signed out).
 * - "view": the page shows its own "unavailable" state; in a practice sitting it ends the sitting.
 * - "central": the student view is gone: the practice sitting ends, or the whole workspace shows "Access has changed".
 * - "local": optional material refused for reasons of its own (reference audio, a practice-calendar visit): the page carries on.
 * - "receipt": as "view", except a 404 (a receipt the server no longer holds) is the caller's alone.
 */
type Refusal = "view" | "central" | "local" | "receipt";

export function createWorkspaceReads(env: ReadEnvironment) {
  const { practice } = env;
  function refused(status: number, mode: ReadingMode, id: string, refusal: Refusal) {
    if (status === 401) { env.denied(401); return; }
    if (status !== 403 && status !== 404 || refusal === "local" || refusal === "receipt" && status === 404) return;
    if (mode === "child-practice" && env.practiceRefused(id)) return;
    if (refusal === "central") env.denied(status);
  }
  /**
   * The one way a workspace read goes out: one request, no session check around it. The practice handle travels only
   * with a child-practice read of the very child its sitting was opened for; any other read never carries it.
   */
  async function guarded<T>(mode: ReadingMode, id: string, signal: AbortSignal, action: (selection: Selection | undefined) => Promise<T>, refusal: Refusal): Promise<T> {
    const started = env.version(), selection = practice.selection;
    if (mode === "child-practice" && (!selection || selection.context.studentId !== id)) throw new PortalRequestError(404);
    try {
      const value = await action(mode === "child-practice" ? selection! : undefined);
      if (signal.aborted || env.version() !== started) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && env.version() === started) refused(statusOf(error), mode, id, refusal);
      throw error;
    }
  }
  /** A child-practice baseline belongs to the sitting it was read in; a page still showing an older sitting sends nothing. */
  const sameSitting = (baseline: Assigned) => baseline.mode !== "child-practice" || practice.selection?.context.id === baseline.context?.id;
  const sameContext = (baseline: Assigned) => baseline.mode !== "child-practice" || Boolean(practice.selection && baseline.context && practice.selection.context.id === baseline.context.id
    && practice.selection.context.studentId === baseline.student.id && practice.selection.context.authorityRevision === baseline.context.authorityRevision && practice.selection.context.expiresAt === baseline.context.expiresAt);
  const sitting = (baseline: Assigned) => { if (!sameSitting(baseline)) throw new PortalRequestError(404); };

  /** An owner made now stays live while this view does: same version, same session, same sitting. */
  function liveFrom(base: Assigned) {
    const version = env.version(), binding = env.sessionBinding(), handle = base.mode === "child-practice" ? practice.selection?.handle : undefined;
    return () => Boolean(binding) && env.version() === version && env.sessionBinding() === binding && !practice.pending && (base.mode !== "child-practice" || practice.selection?.handle === handle);
  }
  const sameHandle = (actual: Selection | undefined, captured: Selection | undefined) => actual?.handle === captured?.handle && actual?.context.id === captured?.context.id;

  return {
    read: (mode: ReadingMode, id: string, signal: AbortSignal) => guarded(mode, id, signal, selection => workspaceApi.reading(mode, id, selection, signal), "view"),
    readStudy: (baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal) =>
      guarded(baseline.mode, baseline.student.id, signal, selection => fetchStudyPage(baseline, kind, offset, signal, selection), "view"),
    readWork: (baseline: Assigned, kind: StudyKind, operation: WorkOperation, signal: AbortSignal) => { sitting(baseline);
      return guarded(baseline.mode, baseline.student.id, signal, selection => fetchWork(baseline, kind, operation, signal, selection), operation.type === "receipt" ? "receipt" : "view"); },
    readProgress: (baseline: Assigned, kind: StudyKind, operation: ProgressOperation, signal: AbortSignal) => { sitting(baseline);
      return guarded(baseline.mode, baseline.student.id, signal, selection => fetchProgress(baseline, kind, operation, signal, selection), "view"); },
    // The study guide follows the same child-practice binding as verse marks.
    readGuide: (baseline: Assigned, kind: StudyKind, operation: GuideOperation, signal: AbortSignal) => { sitting(baseline);
      return guarded(baseline.mode, baseline.student.id, signal, selection => fetchGuide(baseline, kind, operation, signal, selection), "view"); },
    readServiceMetadata: (mode: ReadingMode, id: string, signal: AbortSignal) => guarded(mode, id, signal, selection => serviceApi.metadata(mode, id, signal, selection), "central"),
    /** 2.0 SC5: the per-part finished mark, for a tutor or an admin only. */
    readServiceFinished: (mode: "admin" | "tutor", id: string, signal: AbortSignal) => guarded(mode, id, signal, () => serviceApi.finished(mode, id, signal), "central"),
    readMyService: (mode: ReadingMode, id: string, signal: AbortSignal) => guarded(mode, id, signal, selection => readMyServiceApi(mode, id, signal, selection), "central"),
    readMyServiceMaterial: (mode: ReadingMode, id: string, rowId: string, signal: AbortSignal) => guarded(mode, id, signal, selection => readMyServiceMaterialApi(mode, id, rowId, signal, selection), "central"),
    requestMyService: (mode: ReadingMode, id: string, action: Parameters<typeof serviceRequest>[2], body: Record<string, unknown>, signal: AbortSignal) =>
      guarded(mode, id, signal, selection => serviceRequest(mode, id, action, body, signal, selection), "central"),
    readServiceUnit: (mode: ReadingMode, id: string, plan: ServicePlan, unitId: string, signal: AbortSignal) => guarded(mode, id, signal, selection => serviceApi.unit(mode, id, plan, unitId, signal, selection), "central"),
    readLessons: (mode: ReadingMode, id: string, operation: LessonOperation, signal: AbortSignal) => guarded(mode, id, signal, selection => fetchLessons(mode, id, operation, signal, selection), "central"),
    // The practice calendar reads dates only and reports a visit only when asked; a refused visit or link stays on the calendar.
    readPracticeCalendar: (mode: ReadingMode, id: string, operation: PracticeOperation, signal: AbortSignal) => guarded(mode, id, signal, selection => fetchPracticeCalendar(mode, id, operation, signal, selection), "local"),
    readExploration: (baseline: Assigned, signal: AbortSignal) => guarded(baseline.mode, baseline.student.id, signal, selection => explorationApi.prepare(baseline, signal, selection), "central"),
    readExplorationPage: (baseline: Assigned, prepared: PreparedExploration, offset: number, signal: AbortSignal) =>
      guarded(baseline.mode, baseline.student.id, signal, selection => explorationApi.page(baseline, prepared, offset, signal, selection), "central"),
    readWordAids: (baseline: Assigned, kind: StudyKind, offset: number, verse: StudyVerse, signal: AbortSignal) => sameContext(baseline)
      ? guarded(baseline.mode, baseline.student.id, signal, selection => fetchWordToolsAids(baseline, kind, offset, verse, signal, selection), "central") : Promise.reject(new PortalRequestError(409)),
    readWordDetails: (baseline: Assigned, kind: StudyKind, offset: number, verse: StudyVerse, index: number, signal: AbortSignal) => sameContext(baseline)
      ? guarded(baseline.mode, baseline.student.id, signal, selection => fetchWordToolsDetails(baseline, kind, offset, verse, index, signal, selection), "central") : Promise.reject(new PortalRequestError(409)),

    /** Reference audio for an assigned page. Optional material: a refusal stays with the player. */
    createShortReferenceOwner(baseline: Assigned, kind: StudyKind, offset: number, viewLive: () => boolean) {
      const base = structuredClone(baseline), selected = base.mode === "child-practice" && practice.selection ? structuredClone(practice.selection) : undefined;
      checkShortReferenceSelection(base, selected);
      const live = liveFrom(base);
      return createShortReferenceBridge({ binding: { baseline: base, kind, offset, sessionBinding: env.sessionBinding() ?? "", epoch: env.version(), selection: selected }, live, viewLive,
        read: (value, selectedKind, pageOffset, signal) => guarded(value.mode, value.student.id, signal, actual => {
          if (!live() || !viewLive() || !sameHandle(actual, selected)) throw new PortalRequestError(409);
          return fetchShortReferencePage(value, selectedKind, pageOffset, signal, actual);
        }, "local") });
    },
    /** Reference audio for a proposed (not yet confirmed) portion. Optional material, as above. */
    createShortExplorationOwner(baseline: Assigned, suppliedPrepared: PreparedExploration, suppliedPage: StudyPage, viewLive: () => boolean) {
      const base = structuredClone(baseline), selected = base.mode === "child-practice" && practice.selection ? structuredClone(practice.selection) : undefined;
      const prepared = structuredClone(suppliedPrepared), page = structuredClone(suppliedPage);
      checkShortExplorationExpectation(base, prepared, page, selected);
      const live = liveFrom(base);
      return composeShortExplorationOwner({ binding: { baseline: base, prepared, page, sessionBinding: env.sessionBinding() ?? "", epoch: env.version(), selection: selected },
        live: () => live() && viewLive() && prepared.expiresAt > Date.now(),
        read: (value, currentPrepared, currentPage, signal) => guarded(value.mode, value.student.id, signal, actual => {
          if (!live() || !viewLive() || !sameHandle(actual, selected)) throw new PortalRequestError(409);
          return fetchShortExplorationPage(value, currentPrepared, currentPage, signal, actual);
        }, "local") });
    },

    /** The Sources panel's assignment client: one request per call. A refusal ends the sitting or goes to the central handler. */
    createSources(baseline: Assigned, kind: StudyKind, offset: number): SourceAssignmentClient {
      const base = structuredClone(baseline);
      if (base.mode === "child-practice" && (!practice.selection || practice.selection.context.studentId !== base.student.id || !sameSitting(base))) throw new PortalRequestError(404);
      const captured = base.mode === "child-practice" && practice.selection ? structuredClone(practice.selection) : undefined, live = liveFrom(base);
      const client = createSourceAssignmentClient({ baseline: base, kind, offset, selection: captured });
      const check = (signal: AbortSignal) => { if (signal.aborted || !live()) throw new SourceClientError(409, "stale-revision"); };
      const authorityFailure = (error: unknown, signal: AbortSignal) => {
        if (signal.aborted || !live() || ![401, 403, 404].includes(statusOf(error))) return;
        env.clearWork(); refused(statusOf(error), base.mode, base.student.id, "central");
      };
      async function run<T>(signal: AbortSignal, action: () => Promise<T>, mutation: boolean): Promise<T> {
        check(signal);
        try { const value = await action(); check(signal); return value; }
        catch (error) {
          authorityFailure(error, signal);
          // A write whose answer is not a definite refusal may have saved: its outcome is unknown.
          if (mutation && !(error instanceof SourceClientError && error.definite && live() && !signal.aborted)) throw new SourceClientError();
          throw error;
        }
      }
      return Object.freeze({ ref: client.ref, canEdit: client.canEdit,
        read: signal => run(signal, () => client.read(signal), false), discover: (paging, signal) => run(signal, () => client.discover(paging, signal), false),
        write: (intent, signal) => run(signal, () => client.write(intent, signal), true), receipt: (intent, signal) => run(signal, () => client.receipt(intent, signal), true) });
    },
    /** The Sources panel's commentary text client: one request per call, inside the panel's 30-second budget. */
    createSourceContent(baseline: Assigned, kind: StudyKind, offset: number, target: SourceContentTarget): SourceContentClient {
      const base = structuredClone(baseline), captured = base.mode === "child-practice" && practice.selection ? structuredClone(practice.selection) : undefined, live = liveFrom(base);
      const client = createSourceContentClient({ baseline: base, kind, offset, selection: captured }, target);
      const check = (signal: AbortSignal) => { if (signal.aborted || !live()) throw new SourceContentError(409, "stale-revision"); };
      const authorityFailure = (error: unknown, signal: AbortSignal) => {
        if (isSourceMissing(error) || signal.aborted || !live() || ![401, 403, 404].includes(statusOf(error))) return;
        env.clearWork(); refused(statusOf(error), base.mode, base.student.id, "central");
      };
      async function run<T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const budget = createSourceContentBudget(signal);
        try { check(signal); const value = await budget.run(30000, action); check(signal); budget.check(); return value; }
        catch (error) { authorityFailure(error, signal); throw error; }
        finally { budget.dispose(); }
      }
      return Object.freeze({
        editions: (page: EditionPageRequest, signal: AbortSignal) => { const request = captureEditionPage(page); return run(signal, phase => client.editions(request, phase)); },
        text: (choice: EditionChoice, signal: AbortSignal) => { const request = captureEditionChoice(choice); return run(signal, phase => client.text(request, phase)); },
      });
    },
  };
}
export type WorkspaceReads = ReturnType<typeof createWorkspaceReads>;
