import { expect, test } from "vitest";

// 1.9 N16 (G21, G22): the settings view's operator facts and the Claude connector line. The staff Sheet update went with the Sheet (Daniel, 2026-11-17).
import { parseSettingsView } from "../../src/components/portal/workspace/settings/api";
import { connectLine, connectorAddress } from "../../src/components/portal/workspace/connections/workspace";

test("the settings view carries the operator's email switch", () => {
  const view = { version: 0, settings: {}, updatedAt: null, defaults: { rabbiDisplayName: "the rabbi", siddurUrl: "https://siddur.centralreform.org/" } };
  expect(parseSettingsView({ ok: true, view: { ...view, portal: { email: true } } }).portal).toEqual({ email: true });
  // An older server without the field: email unknown (no line is shown).
  expect(parseSettingsView({ ok: true, view }).portal).toEqual({ email: null });
  expect(() => parseSettingsView({ ok: true, view: { ...view, portal: { email: "yes" } } })).toThrow();
  expect(() => parseSettingsView({ ok: true, view: { ...view, portal: { email: true, extra: 1 } } })).toThrow();
});

test("the Claude connections empty state names this portal's connector address in Daniel's approved line (the one wording test)", () => {
  expect(connectorAddress("https://torah.centralreform.org")).toBe("https://torah.centralreform.org/api/mcp");
  expect(connectLine(connectorAddress("https://torah.centralreform.org"))).toBe(
    "To connect, add this portal as a connector in Claude (Settings -> Connectors) using https://torah.centralreform.org/api/mcp, then sign in here when Claude asks.");
});
