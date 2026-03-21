-- =============================================================
-- Duneli — One-time restricted role setup
-- Run this file as the postgres superuser:
--
--   psql -U postgres -d duneli -f "C:\Users\SIMRAN\OneDrive\Desktop\iuXoa\Duneli\duneli database\prisma\sql\setup_restricted_role.sql"
--
-- Then restart your app — it will connect as duneli_app automatically.
-- =============================================================

-- Step 1: Create restricted role with strong password
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'duneli_app') THEN
    CREATE ROLE duneli_app WITH
      LOGIN
      PASSWORD 'REPLACE_BEFORE_RUNNING'
      NOSUPERUSER
      INHERIT
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION;
    RAISE NOTICE 'Role duneli_app created successfully.';
  ELSE
    ALTER ROLE duneli_app WITH PASSWORD 'Dun3l1@Secure#2026!xK';
    RAISE NOTICE 'Role duneli_app already exists — password updated.';
  END IF;
END
$$;

-- Step 2: Grant connection to the duneli database
GRANT CONNECT ON DATABASE duneli TO duneli_app;

-- Step 3: Grant schema usage
GRANT USAGE ON SCHEMA public TO duneli_app;

-- Step 4: Grant table and sequence permissions on existing objects
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO duneli_app;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO duneli_app;

-- Step 5: Grant permissions on future tables and sequences automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO duneli_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, USAGE ON SEQUENCES TO duneli_app;

-- Done
SELECT 'duneli_app role is ready.' AS status;
