-- CRC Torah's address (Daniel, 2026-10-22). Add its directory row alongside the
-- existing ones, which all stay for rollback. Runtime still selects exactly one
-- BETTER_AUTH_URL, and the canonical stays beitmitzvah until DNS and the Google
-- sign-in origin are ready; until then this host only redirects there.
INSERT INTO tenant_host (host, tenant_id, environment, deployment, origin)
  VALUES ('torah.centralreform.org', 'crc', 'production', 'production', 'https://torah.centralreform.org');
