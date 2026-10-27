import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

const css = (path: string) => readFileSync(path, "utf8");

test("the player's transport stays in reach while the passage scrolls: sticky above the dock, flat inside a full-screen practice view, and out of the Choose bar's way", () => {
  const player = css("src/components/portal/workspace/study/reading-player.module.css");
  expect(player).toMatch(/\.player \{ display: contents;/);
  expect(player).toMatch(/\.top \{ position: sticky; bottom: calc\(var\(--player-clear, var\(--dock-clear, 0px\)\) \+ 0\.5rem\);/);
  expect(player).toMatch(/:global\(dialog\) \.top \{ --player-clear: 0px; \}/);
  expect(player).toMatch(/:global\(html:has\(\[data-choose-bar\]\)\) \.top \{ position: static; \}/);
  expect(readFileSync("src/components/portal/workspace/study/reading-player.tsx", "utf8")).toContain('className={styles.top} data-player-transport=""');
});

test("a phrase end is a wider space, never a drawn bar", () => {
  const sources = [css("src/components/portal/workspace/study/annotations.module.css"), css("src/app/globals.css"), css("src/components/portal/workspace/study/lift.tsx")];
  for (const source of sources) expect(source).not.toMatch(/inset 0\.14em 0 0 0 #13202f/);
  expect(sources[0]).toMatch(/\.word\[data-phrase-end\] \{ margin-inline-end: 0\.3em; \}/);
});
