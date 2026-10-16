-- Custom SQL migration file, put your code below! --
-- PostgreSQL row locks require an UPDATE privilege. This column-only grant lets
-- authorization SHARE-lock the tenant before checking enabled status; it also
-- permits later admin defaults updates under application capability checks.
-- It grants no ability to edit tenant identity/enabled or the host directory.
GRANT UPDATE (customs) ON tenant TO portal_runtime;
