import type { AliyahPerson, HonorsRead } from "../../../../lib/honors/types";
import { spanLabel } from "./draft";
import { serviceSlotTime } from "../service-slot";
import type { ServiceSettings } from "../settings/api";
export type PrintLine = Readonly<{ heading: string; lines: readonly string[] }>;
/** Only a fresh, verified committed DTO reaches this projection. Drafts have no print path. */
export function savedHonorsPrint(value: HonorsRead, studentName: string, services: ServiceSettings = {}): readonly PrintLine[] {
  if (!value.saved) throw Error("There is no saved honors form to print.");
  const saved = value.saved, form = saved.form, context = saved.reviewedContext, snapshot = context.snapshot;
  // The congregation's name and start time for the service when its settings give them.
  const time = serviceSlotTime(snapshot.serviceSlot, services), slot = snapshot.serviceSlot === "unknown" ? "Service time not confirmed"
    : `${services[snapshot.serviceSlot]?.label ?? (snapshot.serviceSlot === "morning" ? "Morning" : "Havdalah")}${time ? ` · ${time}` : ""}`;
  const list = (title: string, people: readonly { englishName: string; relationship?: string | null }[]): PrintLine => ({ heading: title, lines: people.length ? people.map((p, i) => `${i + 1}. ${p.englishName}${p.relationship ? ` · ${p.relationship}` : ""}`) : ["No participants entered"] });
  const person = (p: AliyahPerson, i: number) => `${i + 1}. ${p.englishName} · Hebrew name: ${p.hebrewName ?? "Not entered"} · First parent’s Hebrew name: ${p.parent1HebrewName ?? "Not entered"} · Second parent’s Hebrew name: ${p.parent2HebrewName ?? "Not entered"}${p.relationship ? ` · Relationship: ${p.relationship}` : ""}`;
  return Object.freeze([
    { heading: "Saved family honors", lines: [studentName, `Ceremony: ${snapshot.ceremonyDate} · ${slot}`, `Saved version ${saved.version} · ${saved.createdAt}`, "This copy shows the saved version above. Changes made after it are not included; the portal holds the current form, and the congregation office makes corrections.",
      ...(value.needsReview || context.readingNeedsReview || context.unknownSlot ? ["NEEDS REVIEW — check the saved ceremony and reading details with the congregation."] : [])] },
    list("Opening the ark", form.openingArk), list("Generation to generation", form.generationToGeneration), list("Undressing the Torah", form.undressingTorah),
    { heading: "Torah reading", lines: [snapshot.torah?.ref ?? "No reading assigned", ...(context.status !== "assigned" ? ["Aliyah divisions were not confirmed in this saved form."] : [])] },
    ...context.spans.map((span, i) => { const people = form.aliyot.find(a => a.startVerse === span.startVerse)?.participants ?? []; return { heading: `Aliyah ${i + 1} · ${spanLabel(span)}`, lines: people.length ? people.map(person) : ["No participants entered"] }; }),
    list("Redressing the Torah", form.redressingTorah), list("Closing the ark", form.closingArk),
    { heading: "Parental blessing", lines: [form.parentalBlessing.participation === "yes" ? `Yes · ${form.parentalBlessing.delivery ?? "Delivery not decided"}` : form.parentalBlessing.participation === "no" ? "No" : "Not decided"] }
  ]);
}
export function printSavedHonors(value: HonorsRead, studentName: string, services: ServiceSettings = {}): () => void {
  const lines = savedHonorsPrint(value, studentName, services), frame = document.createElement("iframe");
  frame.title = "Saved family honors print copy"; frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0"; document.body.append(frame);
  const cleanup = () => frame.remove();
  try {
    const doc = frame.contentDocument, win = frame.contentWindow; if (!doc || !win) throw Error("Print unavailable");
    const title = doc.createElement("title"); title.textContent = "Saved family honors"; doc.head.append(title);
    const style = doc.createElement("style"); style.textContent = "@page{margin:18mm}body{font:12pt system-ui,sans-serif;color:#111;line-height:1.5}section{break-inside:avoid;border-top:1px solid #aaa;padding:10px 0}h1{font-size:22pt}h2{font-size:14pt;margin:0 0 6px}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}bdi{unicode-bidi:plaintext}"; doc.head.append(style);
    for (const [i, block] of lines.entries()) { const section = doc.createElement("section"), heading = doc.createElement(i === 0 ? "h1" : "h2"); heading.textContent = block.heading; section.append(heading);
      for (const line of block.lines) { const p = doc.createElement("p"), bdi = doc.createElement("bdi"); bdi.dir = "auto"; bdi.textContent = line; p.append(bdi); section.append(p); } doc.body.append(section); }
    win.addEventListener("afterprint", cleanup, { once: true }); win.focus(); win.print(); return cleanup;
  } catch (error) { cleanup(); throw error; }
}
