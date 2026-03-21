-- =============================================================
-- Migration: fix_auditlog_cascade
-- Problem: audit_logs had ON DELETE CASCADE — deleting a user
--          silently wiped their entire audit trail.
-- Fix: change to RESTRICT so audit logs are preserved permanently.
-- =============================================================

ALTER TABLE "audit_logs"
  DROP CONSTRAINT "audit_logs_userId_fkey";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
