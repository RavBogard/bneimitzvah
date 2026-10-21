"use client";
import { useEffect, useState } from "react";
import { DEFAULT_LINKS, settingsApi, type Links } from "./api";

/**
 * The congregation's siddur and music links. Until the read settles (or if it fails) the page keeps
 * the links it has always shown, so nothing disappears while it loads.
 */
export function useCongregationLinks(enabled: boolean): Links {
  const [links, setLinks] = useState<Links>(DEFAULT_LINKS);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    settingsApi.links(controller.signal).then(value => { if (!controller.signal.aborted) setLinks(value); }, () => undefined);
    return () => controller.abort();
  }, [enabled]);
  return links;
}
