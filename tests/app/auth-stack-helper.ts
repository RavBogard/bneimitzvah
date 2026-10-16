import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createAuthStack } from "../../src/server/auth/factory";
import * as schema from "../../src/server/db/auth-schema";

export async function authFixture() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "src/server/db/migrations" });
  const delivered: { email: string; url: string; token: string }[] = [];
  const auth = createAuthStack(db, schema, {
    origin: "http://localhost:3000",
    secret: randomBytes(48).toString("base64url"),
    google: { clientId: "synthetic-client", clientSecret: randomBytes(32).toString("base64url") },
    sendMagicLink: async (message) => { delivered.push(message); },
  });
  async function request(path: string, body?: unknown, cookie?: string) {
    const headers = new Headers({ origin: "http://localhost:3000", "x-forwarded-for": "127.0.0.1" });
    if (cookie) headers.set("cookie", cookie);
    if (body !== undefined) headers.set("content-type", "application/json");
    return auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }
  async function signIn(email: string) {
    const response = await request("/sign-in/magic-link", { email, callbackURL: "/" });
    if (response.status !== 200) throw new Error("Synthetic sign-in request failed");
    const message = delivered.at(-1);
    if (!message) throw new Error("Synthetic delivery was not captured");
    const redemption = await auth.handler(new Request(message.url));
    const cookie = redemption.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return { response: redemption, cookie, message };
  }
  return { client, db, auth, delivered, request, signIn };
}
