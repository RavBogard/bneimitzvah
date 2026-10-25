"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { parseSession, requestPortal } from "../api";

/**
 * "Return to workspace" for a signed-in member who has a workspace. The chart is public and cached, so it asks for the
 * session after it loads; a signed-out visitor, or any failure, shows nothing.
 */
export function WorkspaceLink({ className }: { className?: string }) {
  const [member, setMember] = useState(false);
  useEffect(() => {
    const request = new AbortController();
    requestPortal("/api/session", undefined, request.signal).then(value => { if (!request.signal.aborted) setMember(parseSession(value).roles.length > 0); }, () => { /* Signed out or unavailable: no link. */ });
    return () => request.abort();
  }, []);
  return member ? <Link className={className} href="/workspace">Return to workspace</Link> : null;
}
