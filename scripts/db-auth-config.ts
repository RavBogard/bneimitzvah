// Offline schema-generation config. No providers, environment secrets or delivery.
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createAuthStack } from "../src/server/auth/factory";

export const auth = createAuthStack(drizzle(new PGlite()), {}, {
  origin: "http://localhost:3000",
  secret: randomBytes(48).toString("base64url"),
  sendMagicLink: async () => { throw new Error("Schema generation cannot send mail"); },
});
