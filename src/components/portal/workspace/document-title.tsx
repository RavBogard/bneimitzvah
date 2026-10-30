"use client";
import { useEffect } from "react";
import { signedInTitle } from "../../../lib/site/signed-in-title";
import { useIdentity } from "../../site/identity-context";

/** Keeps the tab title equal to the page's h1 when that h1 is only known in the browser (a student's name). */
export function DocumentTitle({ heading }: { heading: string }) {
  const productName = useIdentity().productName;
  useEffect(() => { document.title = signedInTitle(heading, productName); }, [heading, productName]);
  return null;
}
