"use client";
import { useEffect } from "react";
import { signedInTitle } from "../../../lib/site/signed-in-title";

/** Keeps the tab title equal to the page's h1 when that h1 is only known in the browser (a student's name). */
export function DocumentTitle({ heading }: { heading: string }) {
  useEffect(() => { document.title = signedInTitle(heading); }, [heading]);
  return null;
}
