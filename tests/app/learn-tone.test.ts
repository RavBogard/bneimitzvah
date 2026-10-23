import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { toneProblems } from "../../src/lib/learn/tone";

// Daniel's tone rule over every learner-facing string of the course: the components, the routes and
// lessons.json. No exclamation point, emoji, streak, badge, score or pep talk.
const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
const sources = [...walk(join(root, "src/components/learn")), ...walk(join(root, "src/app/learn"))].filter(path => /\.(tsx?|css)$/.test(path) && !path.endsWith(".css"));
/** Prose-like pieces of a source file: JSX text and quoted strings with at least one space and a letter. */
function prose(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/>([^<>{}=;()&|\n]*[A-Za-z][^<>{}=;()&|\n]*)</g)) out.push(m[1].trim());
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) { const text = m[1] ?? m[2] ?? ""; if (/[A-Za-z]{2,} [A-Za-z]/.test(text)) out.push(text); }
  return out.filter(Boolean);
}
const strings = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

describe("the course's tone", () => {
  it("finds the source files", () => { expect(sources.length).toBeGreaterThan(8); });
  it("keeps every learner-facing string in the components and routes inside the tone rule", () => {
    const found: string[] = [];
    for (const path of sources) for (const text of prose(readFileSync(path, "utf8"))) for (const problem of toneProblems(text)) found.push(`${relative(root, path)}: ${problem} in "${text.slice(0, 60)}"`);
    expect(found).toEqual([]);
  });
  it("keeps every string in lessons.json inside the tone rule", () => {
    const course = JSON.parse(readFileSync(join(root, "src/lib/learn/lessons.json"), "utf8"));
    const found = strings(course).flatMap(text => toneProblems(text).map(problem => `${problem} in "${text.slice(0, 60)}"`));
    expect(found).toEqual([]);
  });
  it("catches the banned forms", () => {
    for (const bad of ["Great job!", "You got this.", "Keep it up", "Level up", "Your streak", "A new badge", "awesome work", "Nice 🎉"]) expect(toneProblems(bad).length, bad).toBeGreaterThan(0);
    expect(toneProblems("Done. These come back on Thursday.")).toEqual([]);
    expect(prose('<p>Great job!</p> x = "Keep it up" `you got this`').flatMap(toneProblems).length).toBe(4);
  });
});
