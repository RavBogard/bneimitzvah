import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

// The congregation's name belongs to settings (src/lib/site/identity.ts), never to a string in the app. This fails when "Central Reform" or
// "CRC Torah" appears in code under src/. Comments are free; the identity module and the About page's licensed-artwork credit (shown on CRC's
// origins only) are the two places that may name them. Other CRC strings (a short "CRC", CRC-only resources) are reviewed by hand.
const ALLOWED = new Set(["src/lib/site/identity.ts"]);
const PATTERN = /Central Reform|CRC Torah/;
const SOURCE = /\.(?:ts|tsx|mjs|js)$/;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : SOURCE.test(entry.name) ? [path] : [];
  });
}
// Block comments, then line comments that start a line or follow whitespace (so "https://" is untouched).
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(line => line.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");

test("no app code names Central Reform or CRC Torah outside the identity module and the About credit", () => {
  const found = [];
  for (const file of files("src")) {
    const name = relative(".", file).split(sep).join("/");
    if (ALLOWED.has(name)) continue;
    code(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
      if (!PATTERN.test(line)) return;
      // The About credit for the floor artwork, rendered only when the identity is CRC's.
      if (name === "src/app/about/page.tsx" && line.includes("identity.crc") && line.includes("Siona Benjamin")) return;
      found.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});
