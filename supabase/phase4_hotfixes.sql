-- ============================================================
-- GURUKUL: Phase 4 — Hotfixes & Security Grants
-- Run this in Supabase SQL Editor AFTER phase3_optimizations.sql
-- ============================================================


-- ============================================================
-- FIX 1: Add 'processing' status to payment_intents
-- The razorpay-verify edge function atomically sets status to
-- 'processing' before finalizing, preventing double-processing.
-- The original CHECK constraint didn't include this value.
-- ============================================================

ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_status_check;

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_status_check
    CHECK (status IN ('pending', 'processing', 'success', 'failed'));


-- ============================================================
-- FIX 2: Add 'razorpay' as a valid payment method
-- Without this, the transactions table rejects Razorpay payments
-- with a CHECK constraint violation, since 'online' is ambiguous
-- and doesn't distinguish Razorpay from manual bank transfers.
-- ============================================================

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_payment_method_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_payment_method_check
    CHECK (payment_method IN ('cash', 'online', 'razorpay'));

-- Update the process_payment RPC to allow 'razorpay' method
CREATE OR REPLACE FUNCTION process_payment(
  p_student_id     UUID,
  p_amount         NUMERIC,
  p_payment_method TEXT,
  p_reference_id   TEXT DEFAULT NULL,
  p_comment        TEXT DEFAULT NULL,
  p_date           DATE DEFAULT CURRENT_DATE,
  p_allocations    payment_allocation[] DEFAULT '{}'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID := gen_random_uuid();
  v_total_allocated NUMERIC := 0;
  v_alloc           payment_allocation;
  v_due             RECORD;
  v_due_balance     NUMERIC;
  v_new_paid        NUMERIC;
  v_new_status      TEXT;
  v_cleared_dues    JSON[] := '{}';
  v_result          JSON;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than 0';
  END IF;

  IF array_length(p_allocations, 1) IS NULL OR array_length(p_allocations, 1) = 0 THEN
    RAISE EXCEPTION 'No dues selected for payment';
  END IF;

  -- Extended to include 'razorpay' as a valid online payment method
  IF p_payment_method NOT IN ('cash', 'online', 'razorpay') THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

  -- Sum of allocations must match payment amount
  FOREACH v_alloc IN ARRAY p_allocations LOOP
    IF v_alloc.amount_allocated > 0 THEN
      v_total_allocated := v_total_allocated + v_alloc.amount_allocated;
    END IF;
  END LOOP;

  IF abs(v_total_allocated - p_amount) > 0.01 THEN
    RAISE EXCEPTION 'Total allocated (%) does not match payment amount (%)',
      v_total_allocated, p_amount;
  END IF;

  -- Insert transaction
  INSERT INTO transactions (id, student_id, amount, payment_method, reference_id, comment, date)
  VALUES (v_transaction_id, p_student_id, p_amount, p_payment_method, p_reference_id, p_comment, p_date);

  -- Process each allocation
  FOREACH v_alloc IN ARRAY p_allocations LOOP
    CONTINUE WHEN v_alloc.amount_allocated <= 0;

    SELECT d.id, d.amount, d.paid_amount, d.status, fs.name AS fee_name, d.due_date
    INTO v_due
    FROM dues d
    JOIN student_fee_assignments sfa ON d.student_fee_assignment_id = sfa.id
    JOIN fee_structures fs ON sfa.fee_structure_id = fs.id
    WHERE d.id = v_alloc.due_id AND d.student_id = p_student_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Due % not found or does not belong to student %',
        v_alloc.due_id, p_student_id;
    END IF;

    IF v_due.status = 'paid' THEN
      RAISE EXCEPTION 'Due % is already fully paid', v_alloc.due_id;
    END IF;

    v_due_balance := v_due.amount - v_due.paid_amount;

    IF v_alloc.amount_allocated > v_due_balance + 0.01 THEN
      RAISE EXCEPTION 'Cannot allocate % to due "%". Remaining balance is only %',
        v_alloc.amount_allocated, v_due.fee_name, v_due_balance;
    END IF;

    v_new_paid := v_due.paid_amount + v_alloc.amount_allocated;
    v_new_status := CASE WHEN (v_due.amount - v_new_paid) < 0.01 THEN 'paid' ELSE 'partial' END;

    UPDATE dues SET paid_amount = v_new_paid, status = v_new_status WHERE id = v_due.id;

    INSERT INTO transaction_allocations (id, transaction_id, fee_due_id, amount_applied)
    VALUES (gen_random_uuid(), v_transaction_id, v_due.id, v_alloc.amount_allocated);

    v_cleared_dues := array_append(v_cleared_dues, json_build_object(
      'due_id',           v_due.id,
      'fee_name',         v_due.fee_name,
      'amount_allocated', v_alloc.amount_allocated,
      'due_date',         v_due.due_date
    ));
  END LOOP;

  v_result := json_build_object(
    'transaction_id', v_transaction_id,
    'cleared_dues',   array_to_json(v_cleared_dues)
  );

  RETURN v_result;
END;
$$;


-- ============================================================
-- FIX 3: Grant EXECUTE on all Phase 3 RPCs to authenticated
-- The Phase 3 migration created these functions but forgot to
-- lock them down. Without this, ANYONE with the anon key can
-- call bulk_import_students and flood the database.
-- ============================================================

-- get_dashboard_stats
REVOKE EXECUTE ON FUNCTION get_dashboard_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_dashboard_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION get_dashboard_stats() TO authenticated;

-- get_defaulters_report
REVOKE EXECUTE ON FUNCTION get_defaulters_report() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_defaulters_report() FROM anon;
GRANT  EXECUTE ON FUNCTION get_defaulters_report() TO authenticated;

-- bulk_import_students
REVOKE EXECUTE ON FUNCTION bulk_import_students(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bulk_import_students(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION bulk_import_students(JSONB) TO authenticated;

-- calculate_discount_for_fee (internal helper — no public access needed)
REVOKE EXECUTE ON FUNCTION calculate_discount_for_fee(UUID, UUID, NUMERIC, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_discount_for_fee(UUID, UUID, NUMERIC, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION calculate_discount_for_fee(UUID, UUID, NUMERIC, DATE) TO authenticated;

-- Also ensure the updated process_payment grants are current
REVOKE EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) FROM anon;
GRANT  EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) TO authenticated;
