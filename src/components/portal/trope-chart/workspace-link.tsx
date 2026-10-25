"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { parseSession, requestPortal } from "../api";
import { ReturnSignInLink } from "../return-sign-in-link";

/**
 * The bar's one link, as on every other page: "Return to workspace" for a signed-in member who has a workspace, otherwise "Sign in"
 * (back to the chart). The chart is public and cached, so it asks for the session after it loads and shows nothing until it knows;
 * the bar holds its height meanwhile, so the link's arrival moves nothing (F-SITE 19).
 */
export function WorkspaceLink({ className }: { className?: string }) {
  const [member, setMember] = useState<boolean | null>(null);
  useEffect(() => {
    const request = new AbortController();
    requestPortal("/api/session", undefined, request.signal).then(value => { if (!request.signal.aborted) setMember(parseSession(value).roles.length > 0); }, () => { if (!request.signal.aborted) setMember(false); /* Signed out or unavailable: Sign in. */ });
    return () => request.abort();
  }, []);
  return member === null ? null : member ? <Link className={className} href="/workspace">Return to workspace</Link> : <ReturnSignInLink className={className}>Sign in</ReturnSignInLink>;
}
