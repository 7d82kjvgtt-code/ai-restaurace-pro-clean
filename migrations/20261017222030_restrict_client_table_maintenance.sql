-- Browser roles must not maintain entire shared tables. RLS does not apply to TRUNCATE.
-- Application CRUD and trusted server/service_role privileges are preserved.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated, PUBLIC;
