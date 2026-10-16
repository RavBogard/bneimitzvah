-- Daniel authorized the stable Vercel hostname while custom-domain DNS is pending.
-- Both directory entries name CRC; runtime still accepts only BETTER_AUTH_URL's
-- selected exact origin, never both origins or arbitrary Vercel preview aliases.
INSERT INTO tenant_host (host, tenant_id, environment, deployment, origin)
  VALUES ('bneimitzvah.vercel.app', 'crc', 'production', 'production', 'https://bneimitzvah.vercel.app');
