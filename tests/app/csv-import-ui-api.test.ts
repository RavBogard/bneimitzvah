import { afterEach, expect, test, vi } from "vitest";
import { checkCsvSize, CSV_HEADER, csvApi, parsePreview } from "../../src/components/portal/workspace/csv-import/api";
const csv = `${CSV_HEADER}\nSynthetic,Import,2027-01-02,parent@example.test,`;
const preview = { validRows: 1, issues: [], duplicateRows: [], requiresDuplicateConfirmation: false, canConfirm: true, binding: "v1.synthetic" };
afterEach(() => vi.unstubAllGlobals());
test("preview accepts row diagnostics and duplicate decisions only when confirmation and binding agree", () => {
  expect(parsePreview(preview, false)).toEqual(preview);
  const duplicate = { ...preview, duplicateRows: [2], requiresDuplicateConfirmation: true, canConfirm: false, binding: null };
  expect(parsePreview(duplicate, false).canConfirm).toBe(false);
  expect(() => parsePreview(duplicate, true)).toThrow();
  expect(parsePreview({ ...duplicate, canConfirm: true, binding: preview.binding }, true).canConfirm).toBe(true);
  for (const row of [{ ...preview, binding: null }, { ...preview, canConfirm: false }, { ...preview, validRows: 0 }, { ...preview, duplicateRows: [501, 501] }, { ...preview, issues: [{ row: 1, code: "invalid-row" }] }, { ...preview, rows: [csv] }]) expect(() => parsePreview(row, false)).toThrow();
});
test("UTF-8 and encoded-envelope limits are separate and no local parser invents extra CSV fields", () => {
  expect(CSV_HEADER).toBe("firstName,lastName,ceremonyDate,parentEmail,ownEmail"); expect(() => checkCsvSize(csv, false)).not.toThrow();
  expect(() => checkCsvSize("א".repeat(524289), false)).toThrow();
  expect(() => checkCsvSize("\u0001".repeat(400000), false)).toThrow();
  expect(() => checkCsvSize("", false)).toThrow();
});
test("CSV commit sends exact reviewed bytes/choice/binding, validates count and unique IDs, and never retries", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, ids: [id] }), { headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  expect(await csvApi.confirm(csv, false, preview)).toEqual([id]);
  const [path, options] = fetch.mock.calls[0]; expect(path).toBe("/api/admin/students/import/confirm"); expect(JSON.parse(options.body)).toEqual({ csv, allowDuplicates: false, binding: preview.binding }); expect(options.cache).toBe("no-store"); expect(options.referrerPolicy).toBe("no-referrer");
  fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ ok: true, ids: [] }), { headers: { "content-type": "application/json" } })); await expect(csvApi.confirm(csv, false, preview)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockReset().mockRejectedValue(new Error("Synthetic lost response")); await expect(csvApi.confirm(csv, false, preview)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});
