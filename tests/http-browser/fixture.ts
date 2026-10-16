import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { createAuthStack } from "../../src/server/auth/factory";
import { createAccessService } from "../../src/server/access/service";
import { createInvitationService } from "../../src/server/invitations/service";
import { createStudentService } from "../../src/server/students/service";
import { createPracticeService } from "../../src/server/practice/service";
import { createPortalService } from "../../src/server/portal/service";
import { createStudyService } from "../../src/server/study/service";
import { StudyUnavailable } from "../../src/server/study/types";
import { createRelationshipService } from "../../src/server/relationships/service";
import { createPendingInvitations } from "../../src/server/http/pending-invitations";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { withTenantTransaction } from "../../src/server/db/runtime";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import * as s from "../../src/server/db/index";
import { postgresAccessFixture } from "../postgres/access-fixture";
import { BROWSER_ORIGIN, BROWSER_PORT } from "./server";

const secret = () => randomBytes(48).toString("base64url");
type Mail = { email: string; url: string };

export async function browserFixture(options: { google?: boolean; emptyReadingDate?: string; failInvitationDelivery?: () => boolean } = {}) {
  const base = await postgresAccessFixture();
  try {
    // The shared disposable fixture creates the DB, migrations and restricted
    // LOGIN. Every request below uses that restricted pool, never its owner.
    const db = base.aDb;
    const deliveries: Mail[] = [];
    await base.ownerDb.insert(s.tenantHost).values({ host: `127.0.0.1:${BROWSER_PORT}`, tenantId: "crc", environment: "local", deployment: "http-browser", origin: BROWSER_ORIGIN });
    const auth = createAuthStack(db, s, { origin: BROWSER_ORIGIN, secret: secret(),
      ...(options.google ? { google: { clientId: "synthetic-browser-client", clientSecret: secret() } } : {}),
      sendMagicLink: async ({ email, url }) => { deliveries.push({ email, url }); } });
    const deployment = { environment: "local" as const, deployment: "http-browser" };
    const access = createAccessService({ db, auth, deployment });
    const invitations = createInvitationService({ db, access, transport: async ({ email, url }) => {
      deliveries.push({ email, url });
      if (options.failInvitationDelivery?.()) throw new Error("Synthetic invitation delivery failure");
    }, throttleSecret: secret() });
    const students = createStudentService({ access, signingSecret: secret(), loadReading: async (date, calendar) => ({ fetchedAt: Date.now(),
      snapshot: { date: parseCeremonyDate(date), calendar, reading: date === options.emptyReadingDate ? null : { parashah: "Synthetic", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1, ref: "Genesis 1:31-2:2" }], triennial: null }, haftarah: date === options.emptyReadingDate ? null : "Isaiah 1:1-2" } }) });
    const practice = createPracticeService({ access });
    const pendingInvitations = createPendingInvitations({ secret: secret(), origin: BROWSER_ORIGIN, environment: "local" });
    const runtime: HttpRuntime = { origin: BROWSER_ORIGIN, auth, access, invitations, students, practice, portal: createPortalService({ access, practice, sessionBindingSecret: secret() }), relationships: createRelationshipService({ access }), pendingInvitations,
      study: createStudyService({ access, practice, load: async () => { throw new StudyUnavailable("upstream"); } }),
      resolveHost: async request => {
        const host = await resolveTenantHost(db, request, deployment);
        if (host.origin !== BROWSER_ORIGIN) throw new Error("Host mismatch");
        return host;
      } };
    async function withRuntime<T>(action: (runtime: HttpRuntime) => Promise<T>) {
      // Live restricted-role preflight is retained for the injected runtime.
      await withTenantTransaction(db, { tenantId: "crc" }, async () => undefined);
      return action(runtime);
    }
    function takeMail(email: string) {
      const index = deliveries.findIndex(row => row.email === email);
      if (index < 0) throw new Error("Expected synthetic mail was not captured");
      return deliveries.splice(index, 1)[0].url;
    }
    return { ...base, runtime, withRuntime, takeMail, close: base.close };
  } catch {
    await base.close().catch(() => undefined);
    throw new Error("Browser fixture setup failed; details withheld");
  }
}
