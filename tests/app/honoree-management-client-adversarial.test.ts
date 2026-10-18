import { expect, test, vi } from "vitest";
import { createHonoreeOwner } from "../../src/components/portal/workspace/honors/honoree-owner";
import { HonoreeClientError, type HonoreeClient, type LinkIntent } from "../../src/components/portal/workspace/honors/honoree-api";
import type { HonorsState } from "../../src/components/portal/workspace/honors/owner";
import { emptyHonors } from "../../src/components/portal/workspace/honors/draft";

const studentId = "10000000-0000-4000-8000-000000000001", mutationId = "10000000-0000-4000-8000-000000000002", oldStart = "Genesis 1:1", nextStart = "Genesis 1:3", linkId = "A".repeat(22);
function saved(startVerse = oldStart, version = 1): HonorsState {
  const snapshot = { schemaVersion: 1 as const, tenantId: "crc", studentId, ceremonyDate: "2027-01-02", serviceSlot: "morning" as const, torah: { id: studentId, revision: version, ref: startVerse, basis: "custom" as const, confirmation: { confirmationDate: "2027-01-02", serviceSlot: "morning" as const, slotProvenance: 1, needsReview: false }, verses: [startVerse], cuts: [] } };
  const context = { hash: String(version).repeat(64), snapshot, spans: [{ startVerse, endVerse: startVerse }], status: "assigned" as const, unknownSlot: false, readingNeedsReview: false };
  const form = { ...emptyHonors(), aliyot: [{ startVerse, participants: [{ id: studentId, englishName: "Invented person", relationship: null, hebrewName: null, parent1HebrewName: null, parent2HebrewName: null }] }] };
  return { phase: "ready", current: { ok: true, studentId, currentVersion: version, currentContext: context, saved: { version, form, reviewedContext: context, createdAt: "2027-01-02T00:00:00.000Z" }, needsReview: false }, draft: form, draftContext: context, baseVersion: version, dirty: false, reviewed: true, pending: null, error: null, savedNotice: false };
}

test("independent client: changed current spans never remap an uncertain original intent or prevent old-record revocation", async () => {
  let honors = saved();
  const api: HonoreeClient = { status: vi.fn(async () => null), mutate: vi.fn(async () => { throw new HonoreeClientError(404); }), receipt: vi.fn(async (intent: LinkIntent) => ({ ok: true as const, outcome: "committed" as const, replayed: true, operation: intent.operation, linkId, startVerse: intent.startVerse })) };
  const newId = vi.fn(() => mutationId), owner = createHonoreeOwner(api, { honors: () => honors, blocked: () => false, changed() {} }, newId);
  await owner.status(oldStart); await owner.issue(oldStart);
  const original = owner.state.pending;
  expect(original).not.toBe(null); owner.pause(); honors = saved(nextStart, 2); owner.resume();
  expect(await owner.issue(nextStart)).toBe(false);
  await owner.check();
  expect(vi.mocked(api.receipt).mock.calls[0][0]).toBe(original);
  expect(newId).toHaveBeenCalledTimes(1); expect(owner.state.pending).toBe(null); expect(owner.state.secret).toBe(null);
  expect(owner.state.records[oldStart]?.id).toBe(linkId);
  expect(owner.canIssue(oldStart)).toBe(false); expect(owner.canRevoke(oldStart)).toBe(true);
  expect(owner.confirm("revoke", oldStart)).toBe(true);
  vi.mocked(api.mutate).mockImplementationOnce(async intent => ({ ok: true, outcome: "committed", replayed: false, operation: intent.operation, linkId, startVerse: intent.startVerse }));
  await owner.acceptConfirmation();
  expect(vi.mocked(api.mutate).mock.calls[1][0]).toMatchObject({ operation: "revoke", startVerse: oldStart, linkId, expectedVersion: 2, contextHash: "2".repeat(64) });
  expect(owner.state.records[oldStart]).toBe(null); expect(owner.state.secret).toBe(null);
});
