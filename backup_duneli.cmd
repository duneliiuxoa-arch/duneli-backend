@echo off
:: =============================================================
:: Duneli PostgreSQL Backup Script
:: =============================================================
:: SETUP INSTRUCTIONS:
::   1. Set PGPASSWORD in Windows Environment Variables (not here).
::      Control Panel > System > Advanced > Environment Variables
::      Variable name : PGPASSWORD
::      Variable value: <your strong 16+ char password>
::
::   2. Update DB_USER and DB_NAME below if needed.
::
::   3. Schedule this script in Windows Task Scheduler:
::      Action: Start a program
::      Program: cmd.exe
::      Arguments: /c "C:\path\to\backup_duneli.cmd"
::      Trigger: Daily at 02:00 AM
::
::   4. For off-site backup, add an rclone/aws-cli command below
::      to sync C:\postgres_backups\ to S3 or Google Drive.
:: =============================================================

set DB_HOST=localhost
set DB_PORT=5432
set DB_USER=duneli_app
set DB_NAME=duneli

:: PGPASSWORD must be set as a Windows Environment Variable — NOT here.
:: If not set, pg_dump will prompt for a password (which will fail in Task Scheduler).
if "%PGPASSWORD%"=="" (
  echo [ERROR] PGPASSWORD environment variable is not set. Aborting backup.
  exit /b 1
)

:: Create backup directory if it does not exist
if not exist "C:\postgres_backups" mkdir "C:\postgres_backups"

:: Generate datestamp for the filename
for /f %%i in ('powershell -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set DATESTAMP=%%i

set BACKUP_FILE=C:\postgres_backups\duneli_%DATESTAMP%.backup

echo [INFO] Starting backup of database '%DB_NAME%' ...

"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" ^
  -h %DB_HOST% ^
  -p %DB_PORT% ^
  -U %DB_USER% ^
  -d %DB_NAME% ^
  -F c ^
  -f "%BACKUP_FILE%"

if %ERRORLEVEL% neq 0 (
  echo [ERROR] pg_dump failed with exit code %ERRORLEVEL%.
  exit /b %ERRORLEVEL%
)

echo [OK] Backup saved to: %BACKUP_FILE%
:: =============================================================
:: (Optional) Off-site sync to AWS S3
:: Requires AWS CLI installed and configured: https://aws.amazon.com/cli/
:: Uncomment and set your bucket name to enable.
:: =============================================================
:: set S3_BUCKET=s3://your-bucket-name/duneli-backups/
:: aws s3 cp "%BACKUP_FILE%" "%S3_BUCKET%duneli_%DATESTAMP%.backup"
:: if %ERRORLEVEL% neq 0 (
::   echo [WARN] S3 upload failed, backup is local only.
:: ) else (
::   echo [OK] Backup also uploaded to %S3_BUCKET%
:: )

:: =============================================================
:: (Optional) Purge local backups older than 30 days
:: =============================================================
:: forfiles /p "C:\postgres_backups" /s /m *.backup /d -30 /c "cmd /c del @path"

echo [INFO] Backup complete.
