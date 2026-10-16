// Shared explicit opt-in for tests against the disposable loopback CI service.
// A general application DATABASE_URL is intentionally never accepted.
export function disposableConfig() {
  const env = process.env;
  if (env.POSTGRES_TEST_DISPOSABLE !== "1" || env.PGDATABASE !== "portal_rls_test"
      || !["127.0.0.1", "localhost", "::1"].includes(env.PGHOST)
      || !env.PGUSER || !env.PGPASSWORD || !/^\d+$/.test(env.PGPORT ?? "")) {
    throw new Error("Postgres gate requires explicit disposable loopback configuration");
  }
  return {
    host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE,
    user: env.PGUSER, password: env.PGPASSWORD,
    connectionTimeoutMillis: 5000, statement_timeout: 10000,
  };
}

// Never retain driver diagnostics, SQL, row values or connection details.
export async function query(client, text, values) {
  try { return await client.query(text, values); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/.test(error?.code ?? "") ? error.code : "unknown";
    throw Object.assign(new Error(`Postgres gate query failed (${code})`), { code });
  }
}
