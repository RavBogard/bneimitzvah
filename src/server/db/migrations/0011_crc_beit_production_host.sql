-- Add only the approved canonical origin; preserve both earlier rows for rollback.
-- Runtime still selects exactly one BETTER_AUTH_URL. Navigation aliases confer
-- no API authority and intentionally receive no additional directory rows.
INSERT INTO tenant_host (host, tenant_id, environment, deployment, origin)
  VALUES ('beitmitzvah.centralreform.org', 'crc', 'production', 'production', 'https://beitmitzvah.centralreform.org');
