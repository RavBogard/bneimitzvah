"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** A fixed path to move on to, for a page that has retired into another. Never a supplied address. */
export function RedirectTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(href); }, [href, router]);
  return <section className="workspace-state" aria-busy="true"><p role="status">One moment.</p></section>;
}
