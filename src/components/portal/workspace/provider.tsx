"use client";
import { createDepartureGuards, type DeparturePurpose } from "./departure-guards";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { parseSession, PortalRequestError, requestPortal, type SessionSummary } from "../api";
import { workspaceApi, type Assigned, type Context, type ReadingMode } from "./api";
import { PracticeCoordinator } from "./practice";
import { fetchStudyPage, type StudyKind, type StudyPage, type StudyVerse } from "./study/api";
import { explorationApi, type ExplorationPreparation, type PreparedExploration } from "./study/exploration-api";
import { fetchReferenceAudio } from "./study/reference-api";
import { checkShortReferenceSelection, fetchShortReferencePage } from "./study/short-reference-api";
import { createShortReferenceBridge, type ShortReferenceOwner } from "./study/short-reference-bridge";
import { fetchWordToolsAids, fetchWordToolsDetails } from "./study/word-tools-api";
import { createSourceContentClient, captureEditionChoice, captureEditionPage, isSourceMissing, SourceContentError, type SourceContentClient, type SourceContentTarget, type EditionPageRequest, type EditionChoice } from "./study/sources/content-api";
import { createSourceContentBudget } from "./study/sources/content-budget";
import { createSourceAssignmentClient, SourceClientError, type SourceAssignmentClient } from "./study/sources/api";
import type { StudyWordAids } from "../../../lib/hebrew/word-aids";
import type { StudyWordDetails } from "../../../lib/hebrew/word-details";
import type { ReferenceResolution } from "../../../lib/reference-audio/source";
import { fetchWork, type WorkOperation, type WorkPage, type WorkHistory, type WorkReceipt, type WorkRecovery } from "./work/api";
import { fetchProgress, type ProgressOperation, type ProgressRows, type ProgressSaved } from "./progress/api";
import { fetchGuide, type GuideFetch, type GuideOperation, type ThemeReadResult } from "./study/guide-api";
import { serviceApi, type FinishedPart, type ServiceMetadata, type ServicePlan, type ServiceUnitResponse } from "./service-learning/api";
import {readMyService as readMyServiceApi,readServiceMaterial as readMyServiceMaterialApi,serviceRequest,type MyService}from "./service-learning/ecosystem-api";
import type{ServiceUnitMaterial}from "../../../lib/service-learning/types";
import { fetchLessons, type LessonOperation, type LessonResult } from "./lessons/api";
import { fetchPracticeCalendar, type PracticeAck, type PracticeDates, type PracticeOperation } from "./practice-calendar/api";
import { reloadWorkspaceScopes, type ReloadRegistration } from "./reload-barrier";
import { createQuietRefresh } from "./quiet-refresh";
import { TabBar, TabSkipLink } from "../shell/tab-bar";

import { fetchShortExplorationPage, checkShortExplorationExpectation } from "./study/short-exploration-api";
import { createShortExplorationOwner as composeShortExplorationOwner, type ShortExplorationOwner } from "./study/short-exploration-owner";
import { SiteBar } from "../../site/site-bar";
import { rememberSignedIn } from "../signed-in-hint";
import { rolePaths } from "../shell/role-home";

export { rolePaths };
type WorkLifecycle = { pause(): void; clear(): void; settle(): Promise<void>; hasUnsaved(): boolean; reveal(): void };
type Workspace = {
  summary: SessionSummary; context: Context | null; epoch: number; busy: boolean; notice: string;
  selectChild(id: string): Promise<void>; exitPractice(): Promise<void>; refresh(): void;
  read(mode: ReadingMode, id: string, signal: AbortSignal): Promise<Assigned>;
  readVerified(mode: ReadingMode, id: string, signal: AbortSignal): Promise<Assigned>;
  readStudy(baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal): Promise<StudyPage>;
  readExploration(baseline: Assigned, signal: AbortSignal): Promise<ExplorationPreparation>;
  readExplorationPage(baseline: Assigned, prepared: PreparedExploration, offset: number, signal: AbortSignal): Promise<StudyPage>;
  readReference(baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal): Promise<ReferenceResolution>;
  createShortReferenceOwner(baseline: Assigned, kind: StudyKind, offset: number, viewLive: () => boolean): ShortReferenceOwner;
  createShortExplorationOwner(baseline: Assigned, prepared: PreparedExploration, page: StudyPage, viewLive: () => boolean): ShortExplorationOwner;
  readWordAids(baseline: Assigned, kind: StudyKind, offset: number, verse: StudyVerse, signal: AbortSignal): Promise<StudyWordAids>;
  readWordDetails(baseline: Assigned, kind: StudyKind, offset: number, verse: StudyVerse, index: number, signal: AbortSignal): Promise<StudyWordDetails>;
  createSources(baseline: Assigned, kind: StudyKind, offset: number): SourceAssignmentClient;
  createSourceContent(baseline: Assigned, kind: StudyKind, offset: number, target: SourceContentTarget): SourceContentClient;
  readWork(baseline: Assigned, kind: StudyKind, operation: WorkOperation, signal: AbortSignal): Promise<WorkPage | WorkHistory | WorkReceipt | WorkRecovery>;
  readProgress(baseline: Assigned, kind: StudyKind, operation: ProgressOperation, signal: AbortSignal): Promise<ProgressRows | ProgressSaved>;
  readGuide(baseline: Assigned, kind: StudyKind, operation: GuideOperation, signal: AbortSignal): Promise<GuideFetch | ThemeReadResult>;
  readServiceMetadata(mode: ReadingMode, id: string, signal: AbortSignal): Promise<ServiceMetadata>;
  /** 2.0 SC5: the per-part finished mark, for a tutor or an admin only. */
  readServiceFinished(mode: "admin" | "tutor", id: string, signal: AbortSignal): Promise<FinishedPart[]>;
  readMyService(mode:ReadingMode,id:string,signal:AbortSignal):Promise<MyService>;
  readMyServiceMaterial(mode:ReadingMode,id:string,rowId:string,signal:AbortSignal):Promise<ServiceUnitMaterial>;
  requestMyService(mode:ReadingMode,id:string,action:Parameters<typeof serviceRequest>[2],body:Record<string,unknown>,signal:AbortSignal):Promise<unknown>;
  readServiceUnit(mode: ReadingMode, id: string, plan: ServicePlan, unitId: string, signal: AbortSignal): Promise<ServiceUnitResponse>;
  readLessons(mode: ReadingMode, id: string, operation: LessonOperation, signal: AbortSignal): Promise<LessonResult>;
  readPracticeCalendar(mode: ReadingMode, id: string, operation: PracticeOperation, signal: AbortSignal): Promise<PracticeDates | PracticeAck>;
  verifyServiceSession(signal: AbortSignal): Promise<void>;
  serviceAuthorityFailed(status: number): void;
  registerWork(value: WorkLifecycle): () => void;
  completeWork(value: WorkLifecycle): void;
  registerDeparture(guard: () => Promise<boolean>, purpose?: DeparturePurpose): () => void;
  guardDeparture(purpose?: DeparturePurpose): Promise<boolean>;
  registerReload(reload: () => Promise<void>): () => void;
  registerQuiet(verify: (signal: AbortSignal) => Promise<boolean>): () => void;
  /** True while access is being checked or has failed: the workspace is hidden. */
  concealed: boolean;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() { const value = useContext(WorkspaceContext); if (!value) throw new Error("Workspace unavailable"); return value; }
/** Shows a modal dialog only while the workspace is visible. A modal left open
 *  inside the hidden workspace renders nothing yet still blocks the whole page,
 *  so it leaves the top layer during an access check and returns afterwards. */
export function useWorkspaceModal(dialog: RefObject<HTMLDialogElement | null>, open: boolean) {
  const concealed = useContext(WorkspaceContext)?.concealed ?? false;
  useLayoutEffect(() => {
    const node = dialog.current; if (!node) return;
    if (open && !concealed) { if (!node.open) node.showModal(); }
    else if (node.open) node.close();
  }, [dialog, open, concealed]);
  return open && !concealed;
}
export const statusOf = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;
/** A refusal clears the view and re-checks access. If the re-checked view keeps being refused,
 *  automatic re-checks stop: the workspace stays concealed until the person asks to check again,
 *  so a persistent refusal can never become a request loop. */
export const DENIAL_REFRESH_LIMIT = 3, DENIAL_REFRESH_WINDOW_MS = 60_000;
/** Said when a parent's practice access ends; the notice also carries its kind, for a test or a style. */
const PRACTICE_ACCESS_CHANGED = "Practice access changed. Choose an available child again.";
const isParentPath = (path: string) => path === "/workspace/parent" || path.startsWith("/workspace/practice/");

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter(), pathname = usePathname();
  const coordinator = useRef<PracticeCoordinator | null>(null);
  if (!coordinator.current) coordinator.current = new PracticeCoordinator();
  const practice = coordinator.current;
  const [summary, setSummary] = useState<SessionSummary | null>(null), [failure, setFailure] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const checkingRef = useRef(true);
  const [context, setContext] = useState<Context | null>(null), [busy, setBusy] = useState(false), [epoch, setEpoch] = useState(0), [notice, setNotice] = useState("");
  const currentEpoch = useRef(epoch); currentEpoch.current = epoch;
  const [workNotice, setWorkNotice] = useState("");
  const sequence = useRef(0), currentPath = useRef(pathname), routeRevision = useRef(0), sessionAbort = useRef<AbortController | null>(null);
  const binding = useRef<string | null>(null), reloaders = useRef(new Set<ReloadRegistration>());
  const quiet = useRef<ReturnType<typeof createQuietRefresh> | null>(null);
  const quietScopes = useRef(new Set<(signal: AbortSignal) => Promise<boolean>>()), quietRevision = useRef(0);
  const work = useRef(new Set<WorkLifecycle>()), departures = useRef(createDepartureGuards());
  const completeWork = useCallback((value: WorkLifecycle) => { if (!checkingRef.current && work.current.has(value)) value.reveal(); }, []);
  const registerWork = useCallback((value: WorkLifecycle) => { work.current.add(value); return () => {
    if (value.hasUnsaved()) setWorkNotice("The view changed unexpectedly. Unsent work in the previous view was discarded; an unconfirmed request may have saved. Work cannot be restored after leaving the tab.");
    work.current.delete(value);
  }; }, []);
  const registerDeparture = useCallback((guard: () => Promise<boolean>, purpose?: DeparturePurpose) => departures.current.register(guard, purpose), []);
  const guardDeparture = useCallback((purpose?: DeparturePurpose) => departures.current.check(purpose), []);
  const clearWork = useCallback(() => { work.current.forEach(value => value.clear()); }, []);
  const registerReload = useCallback((reload: () => Promise<void>) => { const registration = { reload }; reloaders.current.add(registration); return () => { reloaders.current.delete(registration); }; }, []);
  const registerQuiet = useCallback((verify: (signal: AbortSignal) => Promise<boolean>) => {
    quietScopes.current.add(verify); quietRevision.current++;
    return () => { quietScopes.current.delete(verify); quietRevision.current++; };
  }, []);
  if (currentPath.current !== pathname) { currentPath.current = pathname; routeRevision.current++; }
  // Leaving the workspace altogether (the Account page, where roles are switched, sits outside it) is a route change too: a late answer must not navigate from a page that is gone.
  useEffect(() => () => { routeRevision.current++; }, []);
  const visibleNotice = isParentPath(pathname) ? notice : "";

  const refresh = useCallback(() => {
    quiet.current?.cancel();
    const turn = ++sequence.current;
    sessionAbort.current?.abort();
    const request = new AbortController(); sessionAbort.current = request;
    checkingRef.current = true; practice.pause(); work.current.forEach(value => value.pause()); setChecking(true); setFailure(null);
    void (async () => {
      const next = parseSession(await requestPortal("/api/session", undefined, request.signal));
      if (request.signal.aborted || turn !== sequence.current) return;
      const sameBinding = binding.current === next.sessionBinding;
      if (binding.current && !sameBinding) {
        clearWork();
        practice.invalidate(); setContext(null);
        if (!practice.pending) try { await practice.exit(); } catch { /* Exact stale-session cleanup only; never restore the old subtree. */ }
      }
      const active = practice.selection;
      if (active) {
        const matchingPath = currentPath.current === `/workspace/practice/${active.context.studentId}`;
        if (!matchingPath || !next.roles.includes("parent")) {
          practice.invalidate();
          try { await practice.exit(); } catch {
            if (!request.signal.aborted && turn === sequence.current && isParentPath(currentPath.current)) setNotice("Practice was closed in this tab. Its server outcome could not be confirmed; other tabs were not changed.");
          }
        } else {
          const practiceGeneration = practice.generation, practicePath = `/workspace/practice/${active.context.studentId}`;
          try {
            await workspaceApi.reading("child-practice", active.context.studentId, active, request.signal);
            if (Date.parse(active.context.expiresAt) <= Date.now()) throw new PortalRequestError(404);
          } catch (error) {
            if (![403, 404].includes(statusOf(error))) throw error;
            if (request.signal.aborted || turn !== sequence.current || practice.generation !== practiceGeneration || practice.selection?.context.id !== active.context.id || currentPath.current !== practicePath) return;
            clearWork(); practice.invalidate(); setContext(null); setEpoch(value => value + 1);
            setNotice(PRACTICE_ACCESS_CHANGED);
            // Keep checking/hidden until this route's fresh session and roster finish.
            router.replace("/workspace/parent"); return;
          }
        }
      }
      if (request.signal.aborted || turn !== sequence.current) return;
      if (sameBinding) {
        await Promise.all([...work.current].map(value => value.settle()));
        await reloadWorkspaceScopes(reloaders.current, async () => {
          const verified = parseSession(await requestPortal("/api/session", undefined, request.signal));
          if (verified.sessionBinding !== next.sessionBinding) throw new PortalRequestError(401);
        });
      }
      if (request.signal.aborted || turn !== sequence.current) return;
      binding.current = next.sessionBinding;
      checkingRef.current = false; work.current.forEach(value => value.reveal());
      setContext(practice.selection?.context ?? null); setSummary(next); setChecking(false);
    })().catch(error => {
      if (request.signal.aborted || turn !== sequence.current) return;
      clearWork(); practice.invalidate(); binding.current = null; setSummary(null); setContext(null); setChecking(false); setFailure(statusOf(error));
    });
  }, [practice, clearWork, router]);
  const denials = useRef<number[]>([]);
  // Every automatic clear-and-re-check after a 401/403/404 goes through here.
  const refreshAfterDenial = useCallback((status: number) => {
    clearWork();
    const now = Date.now(), recent = denials.current.filter(at => now - at < DENIAL_REFRESH_WINDOW_MS);
    recent.push(now); denials.current = recent;
    if (recent.length <= DENIAL_REFRESH_LIMIT) { refresh(); return; }
    // Same concealment as a failed access check, without starting another one.
    quiet.current?.cancel(); sequence.current++; sessionAbort.current?.abort(); checkingRef.current = true;
    practice.invalidate(); binding.current = null; setSummary(null); setContext(null); setChecking(false); setFailure(status === 401 ? 401 : 403);
  }, [practice, clearWork, refresh]);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") quiet.current?.request();
      else quiet.current?.cancel();
    };
    const shown = () => quiet.current?.request();
    window.addEventListener("focus", shown); window.addEventListener("pageshow", shown); document.addEventListener("visibilitychange", visible);
    return () => {
      quiet.current?.cancel();
      sequence.current++; sessionAbort.current?.abort(); clearWork(); practice.invalidate();
      if (!practice.pending) void practice.exit().catch(() => undefined);
      window.removeEventListener("focus", shown); window.removeEventListener("pageshow", shown); document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, practice, clearWork]);
  useEffect(() => { if (!isParentPath(pathname)) setNotice(""); refresh(); }, [pathname, refresh]);
  useEffect(() => {
    if (!context) return;
    const remaining = Math.max(0, Date.parse(context.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      if (practice.selection?.context.id !== context.id) return;
      clearWork(); practice.invalidate(); setContext(null); setEpoch(value => value + 1);
      if (currentPath.current === `/workspace/practice/${context.studentId}`) { setNotice("This practice session expired. Choose a child to enter again."); router.replace("/workspace/parent"); }
    }, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [context, practice, router, clearWork]);

  async function selectChild(id: string) {
    if (practice.pending) return;
    if (!await guardDeparture()) return;
    quiet.current?.cancel();
    clearWork();
    const route = routeRevision.current;
    setBusy(true); setContext(null); setNotice(""); setEpoch(value => value + 1);
    try {
      const next = await practice.select(id);
      if (next && route === routeRevision.current) { setContext(next); router.push(`/workspace/practice/${next.studentId}`); }
    } catch {
      if (route === routeRevision.current) {
        setNotice("Practice selection couldn’t be confirmed. Choose a child again; no previous practice view has been restored.");
        router.replace("/workspace/parent");
      }
    } finally { setBusy(false); }
  }
  async function exitPractice() {
    if (practice.pending) return;
    if (!await guardDeparture()) return;
    quiet.current?.cancel();
    clearWork();
    const route = routeRevision.current;
    setBusy(true); setContext(null); setEpoch(value => value + 1);
    try { await practice.exit(); if (route === routeRevision.current) setNotice("You’re back in your read-only parent view."); }
    catch { if (route === routeRevision.current) setNotice("This tab no longer has an active practice view. Its server closure could not be confirmed; choose a child again if needed."); }
    finally { setBusy(false); if (route === routeRevision.current) router.replace("/workspace/parent"); }
  }
  const read = useCallback(async (mode: ReadingMode, id: string, signal: AbortSignal) => {
    const generation = practice.generation, active = practice.selection;
    if (mode === "child-practice" && (!active || active.context.studentId !== id)) throw new PortalRequestError(404);
    try {
      const value = await workspaceApi.reading(mode, id, mode === "child-practice" ? active! : undefined, signal);
      if (generation !== practice.generation || signal.aborted) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && generation === practice.generation && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}` && [401, 403, 404].includes(statusOf(error))) {
        practice.invalidate(); setContext(null); setNotice(PRACTICE_ACCESS_CHANGED); setEpoch(value => value + 1); router.replace("/workspace/parent");
      }
      throw error;
    }
  }, [practice, router]);
  const verifyWorkSession = useCallback(async (signal: AbortSignal) => {
    const expected = binding.current;
    const fresh = parseSession(await requestPortal("/api/session", undefined, signal));
    if (signal.aborted) throw new PortalRequestError(409);
    if (!expected || binding.current !== expected || fresh.sessionBinding !== expected) { clearWork(); throw new PortalRequestError(401); }
  }, [clearWork]);
  const readVerified = useCallback(async (mode: ReadingMode, id: string, signal: AbortSignal) => {
    await verifyWorkSession(signal);
    const value = await read(mode, id, signal);
    await verifyWorkSession(signal);
    return value;
  }, [read, verifyWorkSession]);
  const quietEnvironment = useRef({ readVerified, refresh }); quietEnvironment.current = { readVerified, refresh };
  if (!quiet.current) {
    const capture = () => !binding.current || checkingRef.current ? null
      : JSON.stringify([binding.current, currentPath.current, routeRevision.current, practice.generation, sequence.current, quietRevision.current]);
    quiet.current = createQuietRefresh({
      capture,
      verify: async (signal, snapshot) => {
        const expected = binding.current;
        const live = () => { if (signal.aborted || capture() !== snapshot) throw new PortalRequestError(409); };
        live();
        const first = parseSession(await requestPortal("/api/session", undefined, signal)); live();
        if (first.sessionBinding !== expected) throw new PortalRequestError(401);
        const scopes = [...quietScopes.current];
        const unchanged = await Promise.all(scopes.map(verify => verify(signal))); live();
        // An active child can outlive a reading registration during a transition.
        if (!scopes.length && practice.selection) {
          const active = practice.selection;
          if (currentPath.current !== `/workspace/practice/${active.context.studentId}` || Date.parse(active.context.expiresAt) <= Date.now()) throw new PortalRequestError(404);
          await quietEnvironment.current.readVerified("child-practice", active.context.studentId, signal); live();
        }
        const final = parseSession(await requestPortal("/api/session", undefined, signal)); live();
        if (final.sessionBinding !== expected) throw new PortalRequestError(401);
        return unchanged.every(Boolean);
      },
      denied: error => [401, 403, 404].includes(statusOf(error)),
      changed: reason => {
        if (reason === "metadata") { quietEnvironment.current.refresh(); return; }
        const active = practice.selection;
        clearWork(); practice.invalidate(); setContext(null); setEpoch(value => value + 1);
        if (active && currentPath.current === `/workspace/practice/${active.context.studentId}`) {
          setNotice(PRACTICE_ACCESS_CHANGED); router.replace("/workspace/parent");
        }
        quietEnvironment.current.refresh();
      },
    });
  }
  const readStudy = useCallback(async (baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal) => {
    const generation = practice.generation, active = practice.selection, mode = baseline.mode, id = baseline.student.id;
    if (mode === "child-practice" && (!active || active.context.studentId !== id)) throw new PortalRequestError(404);
    try {
      const value = await fetchStudyPage(baseline, kind, offset, signal, mode === "child-practice" ? active! : undefined);
      if (generation !== practice.generation || signal.aborted) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && generation === practice.generation && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}` && [401, 403, 404].includes(statusOf(error))) {
        practice.invalidate(); setContext(null); setNotice(PRACTICE_ACCESS_CHANGED); setEpoch(value => value + 1); router.replace("/workspace/parent");
      }
      throw error;
    }
  }, [practice, router]);

  const readWork = useCallback(async (baseline: Assigned, kind: StudyKind, operation: WorkOperation, signal: AbortSignal) => {
    const generation = practice.generation, active = practice.selection, mode = baseline.mode, id = baseline.student.id;
    if (mode === "child-practice" && (!active || active.context.studentId !== id || active.context.id !== baseline.context?.id)) throw new PortalRequestError(404);
    try {
      if (operation.type === "recovery") await verifyWorkSession(signal);
      const value = await fetchWork(baseline, kind, operation, signal, mode === "child-practice" ? active! : undefined);
      if (operation.type === "recovery") await verifyWorkSession(signal);
      if (generation !== practice.generation || signal.aborted) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && generation === practice.generation && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}` && [401, 403, 404].includes(statusOf(error)) && !(operation.type === "receipt" && statusOf(error) === 404)) {
        clearWork(); practice.invalidate(); setContext(null); setNotice(PRACTICE_ACCESS_CHANGED); setEpoch(value => value + 1); router.replace("/workspace/parent");
      }
      throw error;
    }
  }, [practice, router, clearWork, verifyWorkSession]);
  const readProgress = useCallback(async (baseline: Assigned, kind: StudyKind, operation: ProgressOperation, signal: AbortSignal) => {
    const generation = practice.generation, active = practice.selection, mode = baseline.mode, id = baseline.student.id;
    if (mode === "child-practice" && (!active || active.context.studentId !== id || active.context.id !== baseline.context?.id)) throw new PortalRequestError(404);
    try {
      const value = await fetchProgress(baseline, kind, operation, signal, mode === "child-practice" ? active! : undefined);
      if (generation !== practice.generation || signal.aborted) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && generation === practice.generation && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}` && [401, 403, 404].includes(statusOf(error))) {
        clearWork(); practice.invalidate(); setContext(null); setNotice(PRACTICE_ACCESS_CHANGED); setEpoch(value => value + 1); router.replace("/workspace/parent");
      }
      throw error;
    }
  }, [practice, router, clearWork]);
  // The study guide follows the same child-practice binding and access-change recovery as verse marks.
  const readGuide = useCallback(async (baseline: Assigned, kind: StudyKind, operation: GuideOperation, signal: AbortSignal) => {
    const generation = practice.generation, active = practice.selection, mode = baseline.mode, id = baseline.student.id;
    if (mode === "child-practice" && (!active || active.context.studentId !== id || active.context.id !== baseline.context?.id)) throw new PortalRequestError(404);
    try {
      const value = await fetchGuide(baseline, kind, operation, signal, mode === "child-practice" ? active! : undefined);
      if (generation !== practice.generation || signal.aborted) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && generation === practice.generation && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}` && [401, 403, 404].includes(statusOf(error))) {
        clearWork(); practice.invalidate(); setContext(null); setNotice(PRACTICE_ACCESS_CHANGED); setEpoch(value => value + 1); router.replace("/workspace/parent");
      }
      throw error;
    }
  }, [practice, router, clearWork]);
  const deny = useCallback((status: number, mode: ReadingMode, id: string) => {
    if (status !== 401 && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}`) {
      clearWork(); practice.invalidate(); setContext(null); setNotice(PRACTICE_ACCESS_CHANGED); setEpoch(value => value + 1); router.replace("/workspace/parent");
    } else refreshAfterDenial(status);
  }, [practice, clearWork, router, refreshAfterDenial]);
  // Optional material (reference-audio metadata) can be refused for reasons of its own. Such a
  // refusal is not proof that the student view is gone: re-read the authority-bearing reading
  // under fresh session checks first. A 401/403/404 there clears exactly as before; a
  // successful read keeps the refusal local to the optional feature.
  const confirmAuthority = useCallback(async (mode: ReadingMode, id: string, generation: number, route: number) => {
    const turn = sequence.current, request = new AbortController(), timer = setTimeout(() => request.abort(), 20_000);
    let status: number | null = null;
    // Only a confirmed reading keeps the refusal local. Unconfirmed (timeout, 5xx) fails closed
    // into the bounded re-check; a stale 409 means a newer check already owns this view.
    try { await readVerified(mode, id, request.signal); } catch (error) { status = request.signal.aborted ? 503 : statusOf(error); }
    finally { clearTimeout(timer); }
    if (status === null || status === 409 || turn !== sequence.current || route !== routeRevision.current) return;
    // A child-practice refusal was already invalidated by read(); still clear unsent work.
    if (generation !== practice.generation) { clearWork(); return; }
    deny([401, 403, 404].includes(status) ? status : 403, mode, id);
  }, [practice, readVerified, deny, clearWork]);
  /** `refreshOnDenied`: true clears on 401/403/404; false keeps 403/404 local; "confirm" keeps
   *  403/404 local only once the authority-bearing reading is confirmed. A 401 always clears. */
  const serviceRead = useCallback(async <T,>(mode: ReadingMode, id: string, signal: AbortSignal, action: (selection?: typeof practice.selection) => Promise<T>, refreshOnDenied: boolean | "confirm" = true): Promise<T> => {
    const generation = practice.generation, active = practice.selection, route = routeRevision.current;
    if (mode === "child-practice" && (!active || active.context.studentId !== id)) throw new PortalRequestError(404);
    const check = () => { if (signal.aborted || generation !== practice.generation || route !== routeRevision.current || mode === "child-practice" && (practice.selection?.handle !== active?.handle || practice.selection?.context.id !== active?.context.id)) throw new PortalRequestError(409); };
    try {
      await verifyWorkSession(signal); check();
      const value = await action(mode === "child-practice" ? active : undefined);
      check(); await verifyWorkSession(signal); check(); return value;
    } catch (error) {
      const current = !signal.aborted && generation === practice.generation && route === routeRevision.current, status = statusOf(error);
      if (current && status === 401) deny(401, mode, id);
      else if (refreshOnDenied === "confirm" && current && [403, 404].includes(status)) void confirmAuthority(mode, id, generation, route);
      else if (refreshOnDenied && current && [403, 404].includes(status)) deny(status, mode, id);
      throw error;
    }
  }, [practice, verifyWorkSession, deny, confirmAuthority]);
  const readServiceMetadata = useCallback((mode: ReadingMode, id: string, signal: AbortSignal) => serviceRead(mode, id, signal, selection => serviceApi.metadata(mode, id, signal, selection ?? undefined)), [serviceRead]);
  const readServiceFinished = useCallback((mode: "admin" | "tutor", id: string, signal: AbortSignal) => serviceRead(mode, id, signal, () => serviceApi.finished(mode, id, signal)), [serviceRead]);
  const readMyService=useCallback((mode:ReadingMode,id:string,signal:AbortSignal)=>serviceRead(mode,id,signal,selection=>readMyServiceApi(mode,id,signal,selection??undefined)),[serviceRead]);
  const readMyServiceMaterial=useCallback((mode:ReadingMode,id:string,rowId:string,signal:AbortSignal)=>serviceRead(mode,id,signal,selection=>readMyServiceMaterialApi(mode,id,rowId,signal,selection??undefined)),[serviceRead]);
  const requestMyService=useCallback((mode:ReadingMode,id:string,action:Parameters<typeof serviceRequest>[2],body:Record<string,unknown>,signal:AbortSignal)=>serviceRead(mode,id,signal,selection=>serviceRequest(mode,id,action,body,signal,selection??undefined)),[serviceRead]);
  const readExploration = useCallback((baseline: Assigned, signal: AbortSignal) =>
    serviceRead(baseline.mode, baseline.student.id, signal, selection => explorationApi.prepare(baseline, signal, selection ?? undefined)), [serviceRead]);
  const readExplorationPage = useCallback((baseline: Assigned, prepared: PreparedExploration, offset: number, signal: AbortSignal) =>
    serviceRead(baseline.mode, baseline.student.id, signal, selection => explorationApi.page(baseline, prepared, offset, signal, selection ?? undefined)), [serviceRead]);
  const readReference = useCallback((baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal) => {
    const selected = practice.selection;
    if (baseline.mode === "child-practice" && (!selected || selected.context.studentId !== baseline.student.id || selected.context.id !== baseline.context?.id
      || selected.context.authorityRevision !== baseline.context.authorityRevision || selected.context.expiresAt !== baseline.context.expiresAt)) return Promise.reject(new PortalRequestError(409));
    return serviceRead(baseline.mode, baseline.student.id, signal, selection => fetchReferenceAudio(baseline, kind, offset, signal, selection ?? undefined), "confirm");
  }, [practice, serviceRead]);
  const createShortReferenceOwner = useCallback((baseline: Assigned, kind: StudyKind, offset: number, viewLive: () => boolean) => {
    const base = structuredClone(baseline), baseKey = JSON.stringify(base), sessionBinding = binding.current, capturedEpoch = currentEpoch.current;
    const path = currentPath.current, route = routeRevision.current, generation = practice.generation;
    const selected = base.mode === "child-practice" && practice.selection ? structuredClone(practice.selection) : undefined;
    checkShortReferenceSelection(base, selected);
    const sameSelection = (value: typeof practice.selection | undefined) => JSON.stringify(value ?? undefined) === JSON.stringify(selected);
    const live = () => Boolean(sessionBinding && binding.current === sessionBinding && !checkingRef.current && !practice.pending
      && currentEpoch.current === capturedEpoch && currentPath.current === path && routeRevision.current === route && practice.generation === generation
      && JSON.stringify(baseline) === baseKey && (base.mode !== "child-practice" || sameSelection(practice.selection)));
    const fetchScope = () => JSON.stringify([sequence.current, quietRevision.current, binding.current, currentPath.current, routeRevision.current, practice.generation]);
    return createShortReferenceBridge({ binding: { baseline: base, kind, offset, sessionBinding: sessionBinding ?? "", epoch: capturedEpoch, selection: selected }, live, viewLive,
      read: async (value, selectedKind, pageOffset, signal) => {
        const stamp = fetchScope(), check = () => { if (signal.aborted || !live() || !viewLive() || fetchScope() !== stamp) throw new PortalRequestError(409); };
        check();
        const page = await serviceRead(value.mode, value.student.id, signal, async actual => {
          check(); if (!sameSelection(actual)) throw new PortalRequestError(409);
          const result = await fetchShortReferencePage(value, selectedKind, pageOffset, signal, actual ?? undefined); check(); return result;
        }, "confirm");
        check(); return page;
      },
    });
  }, [practice, serviceRead]);
  const createShortExplorationOwner = useCallback((baseline: Assigned, suppliedPrepared: PreparedExploration, suppliedPage: StudyPage, viewLive: () => boolean) => {
    const base = structuredClone(baseline), baseKey = JSON.stringify(base), sessionBinding = binding.current, capturedEpoch = currentEpoch.current;
    const path = currentPath.current, route = routeRevision.current, generation = practice.generation;
    const selected = base.mode === "child-practice" && practice.selection ? structuredClone(practice.selection) : undefined;
    const prepared = structuredClone(suppliedPrepared), page = structuredClone(suppliedPage), preparedKey = JSON.stringify(prepared), pageKey = JSON.stringify(page);
    checkShortExplorationExpectation(base, prepared, page, selected);
    const sameSelection = (value: typeof practice.selection | undefined) => JSON.stringify(value ?? undefined) === JSON.stringify(selected);
    const live = () => Boolean(sessionBinding && binding.current === sessionBinding && !checkingRef.current && !practice.pending
      && currentEpoch.current === capturedEpoch && currentPath.current === path && routeRevision.current === route && practice.generation === generation
      && JSON.stringify(baseline) === baseKey && JSON.stringify(suppliedPrepared) === preparedKey && JSON.stringify(suppliedPage) === pageKey && prepared.expiresAt > Date.now() && (base.mode !== "child-practice" || sameSelection(practice.selection)));
    const fetchScope = () => JSON.stringify([sequence.current, quietRevision.current, binding.current, currentPath.current, routeRevision.current, practice.generation]);
    return composeShortExplorationOwner({ binding: { baseline: base, prepared, page, sessionBinding: sessionBinding ?? "", epoch: capturedEpoch, selection: selected }, live: () => live() && viewLive(),
      read: async (value, currentPrepared, currentPage, signal) => {
        const stamp = fetchScope(), check = () => { if (signal.aborted || !live() || !viewLive() || fetchScope() !== stamp) throw new PortalRequestError(409); };
        check();
        const page = await serviceRead(value.mode, value.student.id, signal, async actual => {
          check(); if (!sameSelection(actual)) throw new PortalRequestError(409);
          const result = await fetchShortExplorationPage(value, currentPrepared, currentPage, signal, actual ?? undefined); check(); return result;
        }, "confirm");
        check(); return page;
      },
    });
  }, [practice, serviceRead]);
  const readWordAids = useCallback((baseline: Assigned, kind: StudyKind, offset: number, verse: StudyVerse, signal: AbortSignal) => {
    const selected = practice.selection;
    if (baseline.mode === "child-practice" && (!selected || selected.context.studentId !== baseline.student.id || selected.context.id !== baseline.context?.id
      || selected.context.authorityRevision !== baseline.context.authorityRevision || selected.context.expiresAt !== baseline.context.expiresAt)) return Promise.reject(new PortalRequestError(409));
    return serviceRead(baseline.mode, baseline.student.id, signal, selection => fetchWordToolsAids(baseline, kind, offset, verse, signal, selection ?? undefined));
  }, [practice, serviceRead]);
  const readWordDetails = useCallback((baseline: Assigned, kind: StudyKind, offset: number, verse: StudyVerse, index: number, signal: AbortSignal) => {
    const selected = practice.selection;
    if (baseline.mode === "child-practice" && (!selected || selected.context.studentId !== baseline.student.id || selected.context.id !== baseline.context?.id
      || selected.context.authorityRevision !== baseline.context.authorityRevision || selected.context.expiresAt !== baseline.context.expiresAt)) return Promise.reject(new PortalRequestError(409));
    return serviceRead(baseline.mode, baseline.student.id, signal, selection => fetchWordToolsDetails(baseline, kind, offset, verse, index, signal, selection ?? undefined));
  }, [practice, serviceRead]);
  const createSources = useCallback((baseline: Assigned, kind: StudyKind, offset: number): SourceAssignmentClient => {
    const base = structuredClone(baseline);
    const selected = practice.selection, generation = practice.generation, route = routeRevision.current, turn = sequence.current, session = binding.current;
    if (base.mode === "child-practice" && (!selected || selected.context.studentId !== base.student.id || selected.context.id !== base.context?.id)) throw new PortalRequestError(404);
    const captured = selected ? structuredClone(selected) : undefined;
    const client = createSourceAssignmentClient({ baseline: base, kind, offset, selection: base.mode === "child-practice" ? captured : undefined });
    const sameOwner = () => generation === practice.generation && route === routeRevision.current && turn === sequence.current && session !== null && session === binding.current
      && (base.mode !== "child-practice" || practice.selection?.handle === captured?.handle && practice.selection?.context.id === captured?.context.id);
    const check = (signal: AbortSignal) => { if (signal.aborted || !sameOwner()) throw new SourceClientError(409, "stale-revision"); };
    const probe = async (signal: AbortSignal) => {
      check(signal);
      const fresh = parseSession(await requestPortal("/api/session", undefined, signal));
      check(signal); // An obsolete probe cannot clear a replacement workspace.
      if (fresh.sessionBinding !== session) throw new PortalRequestError(401);
    };
    const authorityFailure = (error: unknown, signal: AbortSignal) => {
      if (signal.aborted || !sameOwner() || ![401, 403, 404].includes(statusOf(error))) return;
      clearWork();
      if (base.mode === "child-practice" && currentPath.current === `/workspace/practice/${base.student.id}`) {
        practice.invalidate(); setContext(null); setNotice(PRACTICE_ACCESS_CHANGED); setEpoch(value => value + 1); router.replace("/workspace/parent");
      } else refreshAfterDenial(statusOf(error));
    };
    async function run<T>(signal: AbortSignal, action: () => Promise<T>, mutation: boolean): Promise<T> {
      let dispatched = false;
      try {
        await probe(signal); check(signal);
        let value: T | undefined, error: unknown, failed = false;
        dispatched = mutation;
        try { value = await action(); } catch (caught) { error = caught; failed = true; authorityFailure(caught, signal); }
        // Stage even a definite API refusal until the final live session/fence check.
        await probe(signal); check(signal);
        if (failed) throw error;
        return value as T;
      } catch (error) {
        authorityFailure(error, signal);
        if (dispatched && !(error instanceof SourceClientError && error.definite && sameOwner() && !signal.aborted)) throw new SourceClientError();
        throw error;
      }
    }
    return Object.freeze({ ref: client.ref, canEdit: client.canEdit,
      read: signal => run(signal, () => client.read(signal), false), discover: (paging, signal) => run(signal, () => client.discover(paging, signal), false),
      write: (intent, signal) => run(signal, () => client.write(intent, signal), true), receipt: (intent, signal) => run(signal, () => client.receipt(intent, signal), true) });
  }, [practice, clearWork, refreshAfterDenial, router]);
  const createSourceContent = useCallback((baseline: Assigned, kind: StudyKind, offset: number, target: SourceContentTarget): SourceContentClient => {
    const base = structuredClone(baseline), selected = practice.selection, captured = selected ? structuredClone(selected) : undefined;
    const generation = practice.generation, route = routeRevision.current, turn = sequence.current, session = binding.current;
    const client = createSourceContentClient({ baseline: base, kind, offset, selection: base.mode === "child-practice" ? captured : undefined }, target);
    const sameOwner = () => generation === practice.generation && route === routeRevision.current && turn === sequence.current && session !== null && session === binding.current
      && (base.mode !== "child-practice" || practice.selection?.handle === captured?.handle && practice.selection?.context.id === captured?.context.id);
    const check = (signal: AbortSignal) => { if (signal.aborted || !sameOwner()) throw new SourceContentError(409, "stale-revision"); };
    const probe = async (signal: AbortSignal) => { check(signal); const fresh = parseSession(await requestPortal("/api/session", undefined, signal)); check(signal); if (fresh.sessionBinding !== session) throw new PortalRequestError(401); };
    const authorityFailure = (error: unknown, signal: AbortSignal) => {
      if (isSourceMissing(error) || signal.aborted || !sameOwner() || ![401, 403, 404].includes(statusOf(error))) return;
      clearWork();
      if (base.mode === "child-practice" && currentPath.current === `/workspace/practice/${base.student.id}`) {
        practice.invalidate(); setContext(null); setNotice(PRACTICE_ACCESS_CHANGED); setEpoch(value => value + 1); router.replace("/workspace/parent");
      } else refreshAfterDenial(statusOf(error));
    };
    async function run<T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const budget = createSourceContentBudget(signal);
      try {
        await budget.run(12000, probe); check(signal);
        let value: T | undefined, error: unknown, failed = false;
        try { value = await budget.run(30000, action); } catch (caught) { error = caught; failed = true; authorityFailure(caught, signal); }
        await budget.run(12000, probe); check(signal); budget.check();
        if (failed) throw error; return value as T;
      } catch (error) { authorityFailure(error, signal); throw error; }
      finally { budget.dispose(); }
    }
    return Object.freeze({
      editions: (page: EditionPageRequest, signal: AbortSignal) => { const request = captureEditionPage(page); return run(signal, phase => client.editions(request, phase)); },
      text: (choice: EditionChoice, signal: AbortSignal) => { const request = captureEditionChoice(choice); return run(signal, phase => client.text(request, phase)); }
    });
  }, [practice, clearWork, refreshAfterDenial, router]);
  const readServiceUnit = useCallback((mode: ReadingMode, id: string, plan: ServicePlan, unitId: string, signal: AbortSignal) => serviceRead(mode, id, signal, selection => serviceApi.unit(mode, id, plan, unitId, signal, selection ?? undefined)), [serviceRead]);
  // Lesson notes share the service path: fresh session checks around each request, and the same access-failure handling.
  const readLessons = useCallback((mode: ReadingMode, id: string, operation: LessonOperation, signal: AbortSignal) => serviceRead(mode, id, signal, selection => fetchLessons(mode, id, operation, signal, selection ?? undefined)), [serviceRead]);
  // The practice calendar uses the same path; it reads dates only and reports a visit only when asked.
  // Material/link 403/404 refusals stay local; a current session 401 always clears
  // and conceals the whole workspace through the existing access-check path.
  const readPracticeCalendar = useCallback((mode: ReadingMode, id: string, operation: PracticeOperation, signal: AbortSignal) => serviceRead(mode, id, signal, selection => fetchPracticeCalendar(mode, id, operation, signal, selection ?? undefined), false), [serviceRead]);
  const serviceAuthorityFailed = useCallback((status: number) => { if ([401, 403, 404].includes(status)) refreshAfterDenial(status); }, [refreshAfterDenial]);
  const verifyServiceSession = useCallback(async (signal: AbortSignal) => { try { await verifyWorkSession(signal); } catch (error) { if (!signal.aborted) serviceAuthorityFailed(statusOf(error)); throw error; } }, [verifyWorkSession, serviceAuthorityFailed]);
  const controlledLink = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); void guardDeparture().then(leave => { if (leave) { clearWork(); router.push(href); } });
  };

  // The tab bar belongs to a checked, signed-in workspace; it never shows over the access check.
  const shellShown = Boolean(summary) && !checking && failure === null;
  // A checked session is what the site bar on the public pages remembers (the same hint the reader's Save uses).
  useEffect(() => { if (shellShown) rememberSignedIn(true); }, [shellShown]);
  return <div className="portal-shell workspace-shell" data-rail-pending={!shellShown && failure === null ? "" : undefined}>
    <a className="skip-link" href="#workspace-main">{pathname.startsWith("/mine") ? "Skip to main content" : "Skip to workspace"}</a>
    {shellShown && <TabSkipLink roles={summary!.roles} />}
    <SiteBar signedIn onNavigate={controlledLink} />
    <main id="workspace-main" className="workspace-main">
      {(checking || !summary) && <section className="workspace-state" data-testid="workspace-state" data-workspace-state={failure === null ? "checking" : failure === 401 ? "signed-out" : failure === 403 || failure === 404 ? "access-changed" : "unavailable"} aria-live="polite"><h1>{failure === null ? "Checking your access" : failure === 401 ? "Sign in to continue" : failure === 403 || failure === 404 ? "Access has changed" : "Workspace unavailable"}</h1>
        <p>{failure === null ? "Your student information is hidden until access has been checked." : failure === 401 ? "Use the account on your invitation." : failure === 403 || failure === 404 ? "The requested access is not available. Your previous student view has been cleared." : "We couldn’t load the workspace. Please try again shortly."}</p>
        {failure === 401 ? <a className="button-primary" href="/sign-in">Sign in</a> : failure !== null && <button className="button-primary" onClick={() => { denials.current = []; refresh(); }}>Check access again</button>}</section>
      }
      {summary && <div hidden={checking || failure !== null} inert={checking || failure !== null} aria-hidden={checking || failure !== null}>
        <WorkspaceContext.Provider key={summary.sessionBinding} value={{ summary, context, epoch, busy, notice: visibleNotice, selectChild, exitPractice, refresh, read, readVerified, readStudy, readExploration, readExplorationPage, readReference, createShortReferenceOwner, createShortExplorationOwner, readWordAids, readWordDetails, createSources, createSourceContent, readWork, readProgress, readGuide, readServiceMetadata, readServiceFinished,readMyService,readMyServiceMaterial,requestMyService,readServiceUnit, readLessons, readPracticeCalendar, verifyServiceSession, serviceAuthorityFailed, registerWork, completeWork, registerDeparture, guardDeparture, registerReload, registerQuiet, concealed: checking || failure !== null }}>
          {visibleNotice && <p className="workspace-notice" role="status" data-testid="workspace-notice" data-notice-kind={visibleNotice === PRACTICE_ACCESS_CHANGED ? "practice-access-changed" : undefined}>{visibleNotice}</p>}
          {workNotice && <p className="workspace-notice" role="status">{workNotice}</p>}
          {children}
        </WorkspaceContext.Provider></div>}
    </main>
    {shellShown && <TabBar roles={summary!.roles} onNavigate={controlledLink} />}
  </div>;
}

export function WorkspaceLink({ href, children, ...rest }: { href: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const { guardDeparture } = useWorkspace(), router = useRouter();
  return <Link {...rest} href={href} onClick={event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void guardDeparture().then(leave => { if (leave) router.push(href); }); }}>{children}</Link>;
}

export function RequireRole({ role, children }: { role: keyof typeof rolePaths; children: ReactNode }) {
  const { summary } = useWorkspace();
  return summary.roles.includes(role) ? children : <section className="workspace-state" data-testid="role-unavailable"><h1>Role unavailable</h1><p>This account doesn’t have that access. Choose one of your available roles.</p><a href="/workspace">Choose a role</a></section>;
}
