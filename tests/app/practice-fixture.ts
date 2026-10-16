import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import type { CookieMutationRequest } from "../../src/server/http/mutations";

export async function practiceFixture() {
  const base = await accessFixture();
  function request(who: keyof typeof base.identities = "multi", handle?: string, options: { method?: string; origin?: string; headers?: Record<string, string>; cookie?: string } = {}): CookieMutationRequest {
    const origin = options.origin ?? "http://localhost:3000";
    return { url: `${origin}/practice`, method: options.method ?? "POST", headers: new Headers({ origin,
      cookie: options.cookie ?? base.identities[who].cookie, ...(handle === undefined ? {} : { "X-Practice-Context": handle }), ...options.headers }) };
  }
  const practice = createPracticeService({ access: base.service });
  return { ...base, practice, request };
}
