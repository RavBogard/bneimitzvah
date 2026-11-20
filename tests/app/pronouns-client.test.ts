import { afterEach, expect, it, vi } from "vitest";
import { PortalRequestError, requestPortal } from "../../src/components/portal/api";

afterEach(() => vi.unstubAllGlobals());

it("sends actual private profile GET and POST requests through the portal client", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, pronouns: "they/them", revision: 1 }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  const get = "/api/profile/pronouns?type=student&studentId=10000000-0000-4000-8000-000000000001&mode=parent";
  expect(await requestPortal(get)).toMatchObject({ pronouns: "they/them" });
  const body = { subject: { type: "own" }, pronouns: "they/them", expectedRevision: 0 };
  expect(await requestPortal("/api/profile/pronouns", body)).toMatchObject({ revision: 1 });
  expect(fetcher).toHaveBeenNthCalledWith(1, get, expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", body: undefined }));
  expect(fetcher).toHaveBeenNthCalledWith(2, "/api/profile/pronouns", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", body: JSON.stringify(body) }));
});

it("keeps profile routing closed to the intended private path and read-only query form", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const endpoint of ["https://elsewhere.example.test/api/profile/pronouns?type=own", "//elsewhere.example.test/api/profile/pronouns?type=own", "/api/profile/pronounsx?type=own", "/api/profile/pronouns?type=own#fragment", "/api/profile/pronouns?type=own\\other"]) {
    await expect(requestPortal(endpoint as never)).rejects.toBeInstanceOf(PortalRequestError);
  }
  await expect(requestPortal("/api/profile/pronouns?type=own", { pronouns: "they/them" })).rejects.toBeInstanceOf(PortalRequestError);
  expect(fetcher).not.toHaveBeenCalled();
});
