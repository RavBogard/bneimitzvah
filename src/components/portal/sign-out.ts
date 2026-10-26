import { parseAcknowledgement, requestPortal } from "./api";
import { forgetPendingRequest } from "./pending-request";
import { rememberSignedIn } from "./signed-in-hint";
import { purgeOffline } from "../../lib/offline/pack-index";

/**
 * Signs out. Saved readings leave the device before the session does (1.5 A1, §3.4), which never throws; the request then ends the session,
 * a Connect Claude request never outlives the account that started it, and this browser's signed-in hint is cleared. Throws when the
 * server's answer is not ok, so the caller can say it could not sign the person out.
 */
export async function signOutOfPortal(): Promise<void> {
  await purgeOffline();
  parseAcknowledgement(await requestPortal("/api/auth/sign-out", {}), "ok");
  forgetPendingRequest();
  rememberSignedIn(false);
}
