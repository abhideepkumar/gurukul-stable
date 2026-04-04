-- ============================================================
-- GURUKUL: Security Hardening Migration
-- Run this in Supabase SQL Editor AFTER migrate_rls_to_auth.sql
-- ============================================================


-- ============================================================
-- FIX 1: Lock down SECURITY DEFINER RPCs
--
-- By default, PostgreSQL grants EXECUTE on functions to PUBLIC.
-- Our SECURITY DEFINER functions bypass ALL RLS, so an anonymous
-- user could call them directly via the REST API to:
--   - add_student_with_dues: inject fake students + dues
--   - process_payment: record fake cash payments
-- ============================================================

-- Revoke from everyone first
REVOKE EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) FROM anon;

-- Grant ONLY to authenticated users
GRANT EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) TO authenticated;


-- ============================================================
-- FIX 2: Tighten payment_intents policies
--
-- The old schema allowed anon INSERT/UPDATE on payment_intents.
-- Even after migrate_rls_to_auth.sql, we should verify these
-- are locked to authenticated only. But more importantly, the
-- edge functions use SERVICE_ROLE_KEY (bypasses RLS entirely),
-- so authenticated users do NOT need direct write access to
-- this table at all — edge functions handle it.
-- ============================================================

-- Drop any stale policies that might remain
DROP POLICY IF EXISTS "auth can insert payment_intents" ON payment_intents;
DROP POLICY IF EXISTS "auth can update payment_intents" ON payment_intents;

-- No direct INSERT/UPDATE policies needed — edge functions use service_role.
-- Only SELECT is needed so the frontend can read intent status if desired.
-- (The "auth can select payment_intents" policy from migrate_rls_to_auth.sql
--  is sufficient and already exists.)


-- ============================================================
-- FIX 3: Add input length constraints
--
-- Without length limits, a malicious user could send megabytes
-- of data in text fields, consuming storage and slowing queries.
-- ============================================================

-- Classes
ALTER TABLE classes
  DROP CONSTRAINT IF EXISTS chk_classes_name_length,
  ADD CONSTRAINT chk_classes_name_length CHECK (length(name) <= 100);

-- Fee Structures
ALTER TABLE fee_structures
  DROP CONSTRAINT IF EXISTS chk_fee_name_length,
  ADD CONSTRAINT chk_fee_name_length CHECK (length(name) <= 200);

-- Students
ALTER TABLE students
  DROP CONSTRAINT IF EXISTS chk_student_name_length,
  ADD CONSTRAINT chk_student_name_length CHECK (length(name) <= 200);

ALTER TABLE students
  DROP CONSTRAINT IF EXISTS chk_student_phone_length,
  ADD CONSTRAINT chk_student_phone_length CHECK (length(phone) <= 20);

ALTER TABLE students
  DROP CONSTRAINT IF EXISTS chk_student_email_length,
  ADD CONSTRAINT chk_student_email_length CHECK (length(email) <= 254);

ALTER TABLE students
  DROP CONSTRAINT IF EXISTS chk_student_parent_name_length,
  ADD CONSTRAINT chk_student_parent_name_length CHECK (length(parent_name) <= 200);

ALTER TABLE students
  DROP CONSTRAINT IF EXISTS chk_student_section_length,
  ADD CONSTRAINT chk_student_section_length CHECK (length(section) <= 10);

-- Transactions
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_tx_reference_length,
  ADD CONSTRAINT chk_tx_reference_length CHECK (length(reference_id) <= 200);

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_tx_comment_length,
  ADD CONSTRAINT chk_tx_comment_length CHECK (length(comment) <= 500);
