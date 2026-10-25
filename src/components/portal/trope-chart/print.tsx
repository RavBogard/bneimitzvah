"use client";
import { useEffect, useRef, useState } from "react";
import { HEBREW_FONT_PROOF } from "../../../lib/trope/chart-catalog";

const face = '400 32px "CRC Noto Serif Hebrew"';
async function ready() {
  const loaded = await document.fonts.load(face, HEBREW_FONT_PROOF);
  if (!loaded.length || !loaded.every(font => font.status === "loaded") || !document.fonts.check(face, HEBREW_FONT_PROOF)) throw new Error("Chart font unavailable");
}
export function PrintChart() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"), gate = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; void ready().then(() => { if (alive.current) setState("ready"); }, () => { if (alive.current) setState("error"); }); return () => { alive.current = false; }; }, []);
  async function print() {
    if (gate.current || state !== "ready") return;
    gate.current = true;
    try { await ready(); if (alive.current) window.print(); }
    catch { if (alive.current) setState("error"); }
    finally { gate.current = false; }
  }
  return <div data-chart-print-controls data-chart-font-state={state}>
    <button className="button-primary" disabled={state !== "ready"} onClick={() => void print()}>Print chart</button>
    <p role="status">{state === "ready" ? "" : state === "loading" ? "Preparing the Hebrew for printing…" : "The Hebrew font could not be loaded. Reload the chart before printing."}</p>
    {state === "error" && <button className="button-secondary" onClick={() => window.location.reload()}>Reload chart</button>}
  </div>;
}
