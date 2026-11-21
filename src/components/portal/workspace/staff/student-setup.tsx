"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { StudentSetup } from "../../../../server/staff/service";
import type { Assigned } from "../api";
import { statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { staffApi } from "./api";
import { STUDENT_SETUP_ID, setupDetailsHref, setupInviteHref } from "./student-setup-address";
import styles from "./student-setup.module.css";

type Item = { name: string; state: "Ready" | "Pending" | "Not applicable"; detail: string; action?: ReactNode };
type Active = Extract<StudentSetup, { state: "active" }>;
const invitationDetail: Record<Extract<Active, { kind: string }>["invitation"], string> = {
  none: "An invitation hasn’t been prepared for the current contact.",
  prepared: "An invitation is prepared. Access begins after acceptance.",
  sent: "The invitation was sent. Acceptance is pending.",
  failed: "The invitation was prepared, but delivery failed.",
  expired: "The invitation expired before it was accepted.",
  accepted: "The invitation was accepted and access is linked.",
  unneeded: "Access is already linked.",
};

export function StudentSetupChecklist({ mode, baseline, openReading }: { mode: "admin" | "tutor"; baseline: Assigned; openReading(event: { currentTarget: HTMLElement }): void }) {
  const { epoch, summary, registerReload, serviceAuthorityFailed } = useWorkspace();
  const id = baseline.student.id;
  const scope = JSON.stringify([summary.sessionBinding, epoch, mode, id, baseline.student.revision, baseline.readings.map(reading => [reading.id, reading.revision])]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const pending = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ scope: string; setup?: StudentSetup; failed?: true }>();
  const load = useCallback(async () => {
    pending.current?.abort();
    const request = new AbortController(); pending.current = request;
    const live = () => !request.signal.aborted && scopeRef.current === scope;
    try {
      const setup = await staffApi.setup(mode, id, request.signal);
      if (live()) setResult({ scope, setup });
    } catch (error) {
      if (!live()) return;
      const status = statusOf(error);
      if ([401, 403, 404].includes(status)) serviceAuthorityFailed(status);
      else setResult({ scope, failed: true });
    }
  }, [id, mode, scope, serviceAuthorityFailed]);
  useEffect(() => {
    void load();
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void load(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", restored);
    return () => { pending.current?.abort(); document.removeEventListener("visibilitychange", visible); window.removeEventListener("pageshow", restored); };
  }, [load]);
  useEffect(() => registerReload(load), [load, registerReload]);
  const current = result?.scope === scope ? result : undefined;
  return <section className={styles.setup} aria-labelledby={STUDENT_SETUP_ID}>
    <h2 id={STUDENT_SETUP_ID} tabIndex={-1}>Student setup</h2>
    {current?.setup?.state === "active" ? <SetupItems setup={current.setup} openReading={openReading} />
      : current?.setup?.state === "ended" ? <p>Setup no longer applies to this ceremony.</p>
        : current?.failed ? <div role="status"><p>Setup status couldn’t be checked.</p><button className="button-secondary" type="button" onClick={() => void load()}>Try again</button></div>
          : <p role="status">Checking setup…</p>}
  </section>;
}

function SetupItems({ setup, openReading }: { setup: Active; openReading(event: { currentTarget: HTMLElement }): void }) {
  const { id, service, reading, tutor } = setup, admin = "kind" in setup;
  const people = `/workspace/admin/students/${encodeURIComponent(id)}/access`;
  const items: Item[] = [
    { name: "Ceremony date and service", state: service === "ready" ? "Ready" : "Pending",
      detail: service === "ready" ? "Date and service slot are set." : admin ? "Date is on file. Choose morning or Havdalah." : "Date is on file. The service slot is still open.",
      action: admin && service === "unknown-slot" ? <WorkspaceLink href={setupDetailsHref(id)}>Set service slot</WorkspaceLink> : undefined },
    { name: "Reading", state: reading === "ready" ? "Ready" : "Pending",
      detail: reading === "ready" ? "The assigned reading is confirmed." : reading === "review" ? "Check the reading against the current ceremony." : "No verses have been assigned.",
      action: reading !== "ready" ? <button className="button-text" type="button" onClick={openReading}>Open reading editor</button> : undefined },
    { name: "Tutor", state: tutor ? "Ready" : "Pending", detail: tutor ? "A tutor is assigned." : "Choose a tutor.",
      action: admin && !tutor ? <WorkspaceLink href={`${people}#people-tutors`}>Open tutor assignments</WorkspaceLink> : undefined },
  ];
  if (admin) {
    const { kind, access, contact, invitation } = setup;
    const child = kind === "child", invitationReady = invitation === "accepted" || invitation === "unneeded";
    items.unshift({ name: "Contact and access", state: contact && access === "ready" ? "Ready" : "Pending",
      detail: !contact ? child ? "Add a parent contact." : "Add the student’s email address."
        : access === "ready" ? "Contact is on file and practice access is available."
          : access === "practice-off" ? "Parent access is linked. Practice access is off."
            : child ? "Parent contact is on file. Practice access still needs to be linked." : "Contact is on file. The student’s sign-in still needs to be linked.",
      action: !contact ? <WorkspaceLink href={setupDetailsHref(id)}>Edit contact</WorkspaceLink>
        : access !== "ready" ? <WorkspaceLink href={`${people}#${child ? "people-parents" : "people-students"}`}>Open access settings</WorkspaceLink> : undefined });
    items.push({ name: child ? "Parent invitation" : "Student invitation", state: invitation === "unneeded" ? "Not applicable" : invitation === "accepted" ? "Ready" : "Pending",
      detail: invitationDetail[invitation], action: invitationReady ? undefined : contact
        ? <WorkspaceLink href={setupInviteHref(id, child ? "parent" : "student")}>Open invitations</WorkspaceLink>
        : <WorkspaceLink href={setupDetailsHref(id)}>Add invitation contact</WorkspaceLink> });
  }
  return <ul className={styles.steps}>{items.map(item => <li key={item.name} data-setup-state={item.state}>
    <div className={styles.line}><h3>{item.name}</h3><span>{item.state}</span></div>
    <p>{item.detail}</p>
    {item.action && <div className={styles.action}>{item.action}</div>}
  </li>)}</ul>;
}
