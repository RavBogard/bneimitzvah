import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

const css = (path: string) => readFileSync(path, "utf8");

test("the player transport is in the document flow", () => {
  const player = css("src/components/portal/workspace/study/reading-player.module.css");
  expect(player.match(/\.top \{([^}]+)\}/)?.[1]).not.toMatch(/position:\s*(?:sticky|fixed)/);
});

test("a phrase end is a wider space, never a drawn bar", () => {
  const sources = [css("src/components/portal/workspace/study/annotations.module.css"), css("src/app/globals.css"), css("src/components/portal/workspace/study/lift.tsx")];
  for (const source of sources) expect(source).not.toMatch(/inset 0\.14em 0 0 0 #13202f/);
  expect(sources[0]).toMatch(/\.word\[data-phrase-end\] \{ margin-inline-end: 0\.3em; \}/);
});
