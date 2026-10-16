import { afterEach, expect, test, vi } from "vitest";
import { identityLabels, makeReview, parseRelationships, parseTutors, relationshipApi, type Relationships } from "../../src/components/portal/workspace/relationships/api";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tutor = { id: id(2), displayName: "Synthetic Tutor", revision: 2, isCantor: false };
function data(): Relationships { return { student: { id: id(1), firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02", revision: 1, disabled: false },
  guardians: [{ id: id(3), revision: 4, parentGrantId: id(4), parentGrantRevision: 5, displayName: "Synthetic Parent", practiceEnabled: false, effectiveRead: true, effectivePractice: false }], identities: [{ id: id(5), studentGrantId: id(6), studentGrantRevision: 2, displayName: "Synthetic Student", effectivePractice: true }], tutors: [] }; }
afterEach(() => vi.unstubAllGlobals());
test("closed relationship projection binds identity, revisions and effective access without accepting disabled practice", () => {
  expect(parseRelationships(data(), id(1))).toEqual(data());
  expect(parseRelationships({ ...data(), student: { ...data().student, firstName: "Synthetic@name" } }, id(1)).student.firstName).toBe("Synthetic@name");
  for (const value of [{ ...data(), ownerId: id(9) }, { ...data(), student: { ...data().student, disabled: true } }, { ...data(), guardians: [{ ...data().guardians[0], effectivePractice: true }] }]) expect(() => parseRelationships(value, id(1))).toThrow();
  expect(() => parseRelationships(data(), id(9))).toThrow();
  expect(() => parseTutors({ tutors: [tutor, tutor] })).toThrow();
  expect(() => parseTutors({ tutors: [tutor] }, id(3))).toThrow();
});
test("review fingerprints change for renamed targets, student disable, parent link revision and ordinary grant revision", () => {
  const value = data(), action = { kind: "practice" as const, linkId: id(3), enabled: true };
  const review = makeReview(action, value, [tutor]);
  expect(review.body).toEqual({ expectedRevision: 4, practiceEnabled: true });
  for (const changed of [{ ...value, student: { ...value.student, firstName: "Changed" } }, { ...value, guardians: [{ ...value.guardians[0], revision: 5 }] }, { ...value, guardians: [{ ...value.guardians[0], parentGrantRevision: 6 }] }]) expect(makeReview(action, changed, [tutor]).fingerprint).not.toBe(review.fingerprint);
  expect(() => makeReview(action, { ...value, student: { ...value.student, disabled: true } }, [tutor])).toThrow();
  const grant = makeReview({ kind: "grant", group: "guardians", linkId: id(3), grantId: id(4) }, value, []);
  expect(grant.body).toEqual({ expectedRevision: 5, expectedState: "active" }); expect(grant.consequence).toContain("ALL linked children");
  expect(makeReview({ kind: "link", group: "guardians", linkId: id(3) }, value, []).body).toEqual({ expectedState: "active" });
  expect(() => makeReview({ kind: "grant", group: "guardians", linkId: id(3), grantId: id(9) }, value, [])).toThrow();
});
test("reviewing tutor assignment requires an eligible unassigned identity and uses the published body", () => {
  const value = data(), action = { kind: "assign" as const, grantId: tutor.id };
  expect(makeReview(action, value, [tutor]).body).toEqual({ tutorGrantId: tutor.id, expectedState: "unassigned" });
  expect(() => makeReview(action, value, [])).toThrow();
  expect(() => makeReview(action, { ...value, student: { ...value.student, disabled: true } }, [tutor])).toThrow();
  expect(() => makeReview(action, { ...value, tutors: [{ id: id(8), tutorGrantId: tutor.id, tutorGrantRevision: 2, displayName: tutor.displayName, isCantor: false, effectiveRead: true }] }, [tutor])).toThrow();
  expect(identityLabels([tutor]).get(tutor.id)).toBe(tutor.displayName);
  const collision = { ...tutor, id: id(7) }, labels = identityLabels([tutor, collision]);
  expect(labels.get(tutor.id)).toBe(`${tutor.displayName} · ${tutor.id.slice(-8)}`); expect(labels.get(collision.id)).not.toBe(labels.get(tutor.id));
  expect(makeReview(action, value, [tutor]).grantId).toBe(tutor.id);
});
test("cantor writes preserve same-revision no-op semantics and never retry unknown or wrong-identity outcomes", async () => {
  const review = makeReview({ kind: "cantor", grantId: tutor.id, enabled: true }, null, [tutor]);
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, id: tutor.id, revision: 2, isCantor: true }), { headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  await relationshipApi.mutate(review);
  const [path, options] = fetch.mock.calls[0]; expect(path).toBe(`/api/admin/tutors/${tutor.id}/cantor`); expect(JSON.parse(options.body)).toEqual({ expectedRevision: 2, isCantor: true }); expect(options.credentials).toBe("same-origin"); expect(options.headers["X-Practice-Context"]).toBeUndefined();
  fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ ok: true, id: id(9), revision: 3, isCantor: true }), { headers: { "content-type": "application/json" } }));
  await expect(relationshipApi.mutate(review)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockReset().mockRejectedValue(new Error("Synthetic lost response")); await expect(relationshipApi.mutate(review)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});
