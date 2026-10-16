// Generation is offline. Deployment/CI migration credentials are supplied to the
// separate migration runner, never loaded while importing application modules.
// Keep generation-only drizzle-kit out of the app's optional peer graph; invoke
// its exact pinned version through the db:generate script.
export default {
  dialect: "postgresql",
  schema: "./src/server/db/*schema.ts",
  out: "./src/server/db/migrations",
  strict: true,
};
