import { afterEach, expect, test, vi } from "vitest";
import type { ReactElement } from "react";

// 1.9 N16 (G21, G22): the staff Sheet update's 20-second limit, the settings view's operator facts, and the Claude connector line.
// A DOM-free hook host: the Sheet button's state lives in an array, so its click handler can run without a browser.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual,
    useState: (value: unknown) => { const i = host.cursor++; if (!(i in host.slots)) host.slots[i] = value; return [host.slots[i], (next: unknown) => { host.slots[i] = typeof next === "function" ? next(host.slots[i]) : next; }]; },
  };
});
import { SHEET_UPDATE_TIMEOUT_MS, UpdateStaffSheet } from "../../src/components/portal/workspace/roster-sheet/update-button";
import { parseSettingsView } from "../../src/components/portal/workspace/settings/api";
import { connectLine, connectorAddress } from "../../src/components/portal/workspace/connections/workspace";

afterEach(() => { vi.unstubAllGlobals(); host.slots = []; });
type Node = ReactElement<{ children?: unknown; onClick?: () => Promise<void> | void }>;
function render() { host.cursor = 0; return UpdateStaffSheet({ timeoutMs: 20 }) as Node; }
const parts = (tree: Node) => (tree.props.children as Node[]);
const label = (tree: Node) => parts(tree)[0].props.children, status = (tree: Node) => parts(tree)[1].props.children;

test("the staff Sheet update gives up after its limit with the approved line, and says so only for a timeout", async () => {
  expect(SHEET_UPDATE_TIMEOUT_MS).toBe(20_000);
  expect(label(render())).toBe("Update the staff roster Sheet");
  // A request that never answers is cut off by the limit.
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
  await parts(render())[0].props.onClick!();
  await vi.waitFor(() => expect(status(render())).toBe("This is taking a while. Try again in a minute."));
  // A network failure inside the limit keeps its own words.
  host.slots = [];
  vi.stubGlobal("fetch", async () => { throw new TypeError("network"); });
  await parts(render())[0].props.onClick!();
  await vi.waitFor(() => expect(status(render())).toBe("The update didn’t go through. Try again."));
});

test("the settings view carries the operator's email switch and whether the roster sheet field is this congregation's to set", () => {
  const view = { version: 0, settings: {}, updatedAt: null, defaults: { rabbiDisplayName: "the rabbi", siddurUrl: "https://siddur.centralreform.org/" } };
  expect(parseSettingsView({ ok: true, view: { ...view, portal: { email: true, rosterSheetId: false } } }).portal).toEqual({ email: true, rosterSheetId: false });
  // An older server without the field: email unknown (no line is shown), the field stays.
  expect(parseSettingsView({ ok: true, view }).portal).toEqual({ email: null, rosterSheetId: true });
  expect(() => parseSettingsView({ ok: true, view: { ...view, portal: { email: "yes", rosterSheetId: false } } })).toThrow();
  expect(() => parseSettingsView({ ok: true, view: { ...view, portal: { email: true, rosterSheetId: false, extra: 1 } } })).toThrow();
});

test("the Claude connections empty state names this portal's connector address in Daniel's approved line (the one wording test)", () => {
  expect(connectorAddress("https://torah.centralreform.org")).toBe("https://torah.centralreform.org/api/mcp");
  expect(connectLine(connectorAddress("https://torah.centralreform.org"))).toBe(
    "To connect, add this portal as a connector in Claude (Settings -> Connectors) using https://torah.centralreform.org/api/mcp, then sign in here when Claude asks.");
});
