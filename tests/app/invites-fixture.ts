import { randomBytes } from "node:crypto";
import { accessFixture } from "./access-fixture";
import { createInvitationService } from "../../src/server/invitations/service";
import type { CookieMutationRequest } from "../../src/server/http/mutations";

export async function invitesFixture() {
  const base = await accessFixture();
  const identities = { ...base.identities } as Record<"admin" | "multi" | "learner" | "recipient" | "newStudent", { id: string; cookie: string; sessionId: string }>;
  for (const [key, email] of [["recipient", "recipient@example.test"], ["newStudent", "student-new@example.test"]] as const) {
    await base.owner(async () => {
      const { cookie } = await base.signIn(email);
      const current = await base.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } });
      if (!current) throw new Error("Synthetic invitation recipient setup failed");
      identities[key] = { id: current.user.id, cookie, sessionId: current.session.id };
    });
  }
  const delivered: { email: string; url: string }[] = [];
  let shouldFail = false;
  let transportOutsideTransaction = false;
  let duringTransport: (() => Promise<void>) | undefined;
  const service = createInvitationService({ db: base.db, access: base.service, throttleSecret: randomBytes(48).toString("base64url"), transport: async (message) => {
    const state = await base.client.query<{ scope: string | null }>("select current_setting('app.tenant_id',true) scope");
    transportOutsideTransaction = !state.rows[0].scope;
    delivered.push(message);
    if (duringTransport) await duringTransport();
    if (shouldFail) throw new Error("Synthetic private delivery failure");
  } });
  function request(who: keyof typeof identities, origin = "http://localhost:3000", extra: Record<string, string> = {}, method = "POST"): CookieMutationRequest {
    return { url: `${origin}/invitations`, method, headers: new Headers({ cookie: identities[who].cookie, origin, ...extra }) };
  }
  const token = (index = delivered.length - 1) => new URL(delivered[index].url).searchParams.get("token")!;
  return { ...base, identities, invitations: service, delivered, request, token, failDelivery: (value: boolean) => { shouldFail = value; }, duringTransport: (callback: () => Promise<void>) => { duringTransport = callback; }, outsideTransport: () => transportOutsideTransaction };
}
