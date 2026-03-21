ALTER USER postgres WITH PASSWORD 'xDyckLcdV7T6v2DFe6Gf@Dun2026!';
ALTER ROLE duneli_app WITH PASSWORD 'xDyckLcdV7T6v2DFe6Gf@Dun2026!';
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname IN ('postgres','duneli_app');
