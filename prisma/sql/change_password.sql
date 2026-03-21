-- =============================================================
-- Duneli — Change duneli_app password
-- Run as postgres superuser in psql:
--
--   psql -U postgres -d duneli -f "C:\Users\SIMRAN\OneDrive\Desktop\iuXoa\Duneli\duneli database\prisma\sql\change_password.sql"
--
-- This rotates the password on the restricted role to match .env.
-- =============================================================

ALTER ROLE duneli_app WITH PASSWORD '6ucxzjh73WUPcScnN*vuYa5C';

SELECT 'Password updated successfully.' AS status;
