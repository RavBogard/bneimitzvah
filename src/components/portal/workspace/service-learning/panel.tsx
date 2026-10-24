"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Assigned, ReadingMode } from "../api";
import { statusOf, useWorkspace } from "../provider";
import { ServiceUnitView } from "../../service-learning/unit-view";
import type { ServiceUnitMaterial } from "../../../../lib/service-learning/types";
import type { ServiceMetadata, ServicePlan } from "./api";
import { ServicePlanEditor } from "./editor";
import { MyServicePanel } from "./my-service";
import { useCongregation } from "../settings/links";
import { SiddurPageLink } from "../../siddur-link";

export type ServiceReload = { clear(): void; reload(baseline: Assigned, signal: AbortSignal): Promise<void> };
export function ServiceLearningPanel({ id, mode, studentId, baseline, register, reloadReading, onDepartureActive, onVisit }: {
  id: string; mode: ReadingMode; studentId: string; baseline: Assigned | null;
  register(value: ServiceReload): () => void; reloadReading(): Promise<Assigned>; onDepartureActive(active: boolean): void;
  /** Called only when the reader chooses a part and it opens; a reload that restores the choice is not a visit. */
  onVisit?(plan: ServicePlan, unitId: string): void;
}) {
  const { summary, epoch, readServiceMetadata, readServiceUnit, registerWork } = useWorkspace();
  const scope = JSON.stringify([summary.sessionBinding, epoch, mode, studentId]), scopeRef = useRef(scope); scopeRef.current = scope;
  const [state, setState] = useState<{ scope: string; metadata?: ServiceMetadata; material?: ServiceUnitMaterial; selected?: string; loading?: boolean; unitLoading?: boolean; error?: number }>({ scope });
  const metadata = useRef<ServiceMetadata | null>(null), choice = useRef<string | null>(null), generation = useRef(0), request = useRef<AbortController | null>(null);
  const congregation = useCongregation(Boolean(baseline));
  const [connectedScope,setConnectedScope]=useState<string|null>(null);
  const connected=connectedScope===scope,connectionChanged=useCallback((value:boolean)=>setConnectedScope(value?scope:null),[scope]);
  const clear = useCallback(() => { generation.current++; request.current?.abort(); request.current = null; metadata.current = null; setState({ scope: scopeRef.current, loading: true }); }, []);
  const read = useRef({ readServiceMetadata, readServiceUnit }); read.current = { readServiceMetadata, readServiceUnit };
  const reload = useCallback(async (value: Assigned, signal: AbortSignal) => {
    clear(); const turn = generation.current, selectedScope = scopeRef.current;
    try {
      const next = await read.current.readServiceMetadata(value.mode, value.student.id, signal);
      if (signal.aborted || turn !== generation.current || selectedScope !== scopeRef.current) return;
      metadata.current = next;
      const selected = next.state === "assigned" && next.units.some(unit => unit.id === choice.current) ? choice.current! : undefined;
      if (!selected) choice.current = null;
      setState({ scope: selectedScope, metadata: next, selected, unitLoading: Boolean(selected) });
      if (next.state === "assigned" && selected) {
        const unit = await read.current.readServiceUnit(value.mode, value.student.id, next.plan, selected, signal);
        if (signal.aborted || turn !== generation.current || selectedScope !== scopeRef.current) return;
        if (unit.state === "withdrawn") { choice.current = null; metadata.current = unit; setState({ scope: selectedScope, metadata: unit }); }
        else setState({ scope: selectedScope, metadata: next, selected, material: unit.material });
      }
    } catch (error) {
      if (signal.aborted || turn !== generation.current || selectedScope !== scopeRef.current) return;
      metadata.current = null; setState({ scope: selectedScope, error: statusOf(error) });
      // Provider failures are local. An authority failure must not reveal retained data.
      if ([401, 403, 404].includes(statusOf(error))) throw error;
    }
  }, [clear]);
  useLayoutEffect(() => register({ clear, reload }), [register, clear, reload]);
  useLayoutEffect(() => registerWork({ pause: clear, clear: () => { choice.current = null; clear(); }, settle: async () => {}, hasUnsaved: () => false, reveal: () => {} }), [registerWork, clear]);
  useLayoutEffect(() => { clear(); return clear; }, [scope, clear]);
  async function select(unitId: string) {
    const current = metadata.current; if (current?.state !== "assigned" || !current.units.some(unit => unit.id === unitId)) return;
    request.current?.abort(); const controller = new AbortController(), turn = ++generation.current, selectedScope = scopeRef.current; request.current = controller;
    choice.current = unitId; setState({ scope: selectedScope, metadata: current, selected: unitId, unitLoading: true });
    try {
      const result = await readServiceUnit(mode, studentId, current.plan, unitId, controller.signal);
      if (controller.signal.aborted || turn !== generation.current || selectedScope !== scopeRef.current) return;
      if (result.state === "withdrawn") { metadata.current = result; choice.current = null; setState({ scope: selectedScope, metadata: result }); }
      else { setState({ scope: selectedScope, metadata: current, selected: unitId, material: result.material }); onVisit?.(result.plan, unitId); }
    } catch (error) { if (!controller.signal.aborted && turn === generation.current && selectedScope === scopeRef.current) { metadata.current = null; setState({ scope: selectedScope, error: statusOf(error) }); } }
  }
  const current = state.scope === scope ? state : null, assigned = current?.metadata;
  async function confirmed() { await reloadReading(); if (!metadata.current) throw new Error("Service plan reload unavailable"); return metadata.current; }
  return <section id={id} className="service-learning-panel" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} tabIndex={-1}>Service parts</h2>
    {assigned?.state === "assigned" && <SiddurPageLink siddurUrl={congregation.links.siddurUrl} page={assigned.serviceStart} block>Your whole service in the siddur, from page {assigned.serviceStart}</SiddurPageLink>}
    <MyServicePanel mode={mode} studentId={studentId} baseline={baseline} onConnected={connectionChanged} />
    <details className="service-additional-practice" open={!connected}><summary>{connected?"Additional practice":"Assigned service material"}</summary>
    {!current || current.loading ? <p role="status">Checking assigned service parts…</p> : current.error ? <div role="status"><p>{current.error === 409 ? "The service plan changed. Reload it before choosing a part." : [401, 403, 404].includes(current.error) ? "Service parts are no longer available in this view." : "Service parts are unavailable. Your scripture reading is separate."}</p><button className="button-secondary" onClick={() => void reloadReading().catch(() => undefined)}>Reload service parts</button></div> : assigned && <>
      {assigned.state === "no-plan" && <p>No service parts have been assigned yet.</p>}
      {assigned.state === "cleared" && <p>The service plan was explicitly cleared. No service parts are assigned.</p>}
      {assigned.state === "withdrawn" && <p>The assigned service material has been withdrawn. Ask your tutor or rabbi about a replacement.</p>}
      {assigned.state !== "no-plan" && assigned.plan.needsReview && <p className="reading-review">Service parts need review with your tutor or rabbi. The ceremony date or service may have changed.</p>}
      {assigned.state === "assigned" && <>
        <p>Choose an assigned part to read. Only the chosen part opens here.</p>
        <ul className="service-part-choices">{assigned.units.map(unit => <li key={unit.id}><button type="button" className="button-secondary" aria-pressed={current.selected === unit.id} onClick={() => void select(unit.id)}>{unit.name}</button><SiddurPageLink siddurUrl={congregation.links.siddurUrl} page={unit.page}>Open in the siddur, page {unit.page}</SiddurPageLink></li>)}</ul>
        {current.unitLoading && <p role="status">Loading the selected service part…</p>}
        {current.material && <ServiceUnitView key={JSON.stringify([scope, assigned.plan.id, assigned.plan.revision, assigned.plan.catalogIdentity, current.selected])} material={current.material} />}
      </>}
    </>}
    {(mode === "admin" || mode === "tutor") && <ServicePlanEditor key={scope} mode={mode} studentId={studentId} baseline={baseline} metadata={assigned ?? null} onConfirmed={confirmed} reloadReading={reloadReading} onDepartureActive={onDepartureActive} />}
    </details>
  </section>;
}
