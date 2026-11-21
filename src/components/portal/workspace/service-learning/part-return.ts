"use client";
import { useEffect, useRef, type RefObject } from "react";
import { assignedPartReturn } from "../../../../lib/service-course/assigned-parts";

/** After the service panel opens, return focus to the originating part or to the list if it was replaced. */
export function useAssignedPartReturn(region: RefObject<HTMLDivElement | null>, ready: boolean, source: "music" | "plan") {
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    let first = 0, second = 0;
    const restore = () => {
      const hash = window.location.hash, target = assignedPartReturn(hash);
      if (restored.current === hash || target?.source !== source) return;
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          const node = region.current;
          if (!node || window.location.hash !== hash) return;
          const heading = node.querySelector<HTMLElement>(`[data-service-row="${CSS.escape(target.part)}"] h4`) ?? node.querySelector<HTMLElement>("[data-assigned-parts-heading]");
          if (!heading) return;
          restored.current = hash;
          heading.focus({ preventScroll: true });
          heading.scrollIntoView({ block: "center" });
        });
      });
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => { window.removeEventListener("hashchange", restore); cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [ready, region, source]);
}
