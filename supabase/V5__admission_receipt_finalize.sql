-- ============================================================
-- V5__admission_receipt_finalize.sql
--   Idempotent. Apply AFTER V4 (in-order re-apply is the supported path).
--
-- What it does:
--   1. students.admission_no gets a real uniqueness guarantee
--      (partial unique index — NULLs stay allowed).
--   2. add_student_with_dues learns p_admission_no (8th arg, DEFAULT NULL).
--      The old 7-arg signature is dropped so there is exactly ONE version.
--      Existing 7-positional-arg calls still resolve — PostgreSQL fills the
--      default. Client sends named args via PostgREST — unaffected.
--   3. finalize_transaction_receipt() — attaches a receipt number to an
--      already-created transaction (used by razorpay-verify on success).
--      Idempotent: re-calling returns the same receipt.
--
-- ⚠ Re-apply order matters: checkpoint → V2 → V3 → V4 → V5.
--   Running V4 after V5 would resurrect the old 7-arg function.
-- ============================================================

-- ── 1. Admission number uniqueness ───────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_admission_no
  ON students (admission_no)
  WHERE admission_no IS NOT NULL;

-- ── 2. add_student_with_dues + p_admission_no ────────────────
DROP FUNCTION IF EXISTS add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION add_student_with_dues(
  p_name          TEXT,
  p_class_id      UUID,
  p_fee_structure_ids UUID[] DEFAULT NULL,
  p_section       TEXT DEFAULT NULL,
  p_parent_name   TEXT DEFAULT NULL,
  p_phone         TEXT DEFAULT NULL,
  p_email         TEXT DEFAULT NULL,
  p_admission_no  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id        UUID := gen_random_uuid();
  v_assignment_id     UUID;
  v_start_date        DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_end_date          DATE := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 year')::DATE;
  v_current_date      DATE;
  rec                 RECORD;
  v_base_amount       NUMERIC;
  v_discount_total    NUMERIC;
  v_net_amount        NUMERIC;
  v_discount_details  JSONB;
  d_rec               RECORD;
  v_disc_calc         NUMERIC;
BEGIN
  -- 1. Validate class exists
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id) THEN
    RAISE EXCEPTION 'Class % does not exist', p_class_id;
  END IF;

  -- 1b. Admission number uniqueness (friendly message; index is the guarantee)
  IF p_admission_no IS NOT NULL AND EXISTS (
    SELECT 1 FROM students WHERE admission_no = p_admission_no
  ) THEN
    RAISE EXCEPTION 'Admission number % is already assigned to another student', p_admission_no;
  END IF;

  -- 2. Insert student
  INSERT INTO students (id, name, class_id, section, parent_name, phone, email, admission_no)
  VALUES (v_student_id, p_name, p_class_id, p_section, p_parent_name, p_phone, p_email,
          NULLIF(trim(COALESCE(p_admission_no, '')), ''));

  -- 3. Determine fee structures (explicit or class defaults)
  FOR rec IN
    SELECT fs.id AS fee_structure_id, fs.amount, fs.frequency
    FROM fee_structures fs
    WHERE (
      (p_fee_structure_ids IS NOT NULL AND fs.id = ANY(p_fee_structure_ids))
      OR
      (p_fee_structure_ids IS NULL AND fs.id IN (
        SELECT cfd.fee_structure_id FROM class_fee_defaults cfd WHERE cfd.class_id = p_class_id
      ))
    )
  LOOP
    v_assignment_id := gen_random_uuid();
    INSERT INTO student_fee_assignments (id, student_id, fee_structure_id, start_date, end_date)
    VALUES (v_assignment_id, v_student_id, rec.fee_structure_id, v_start_date, v_end_date);

    -- Effective base = custom_amount override if present, else head amount.
    v_base_amount := COALESCE(
      (SELECT custom_amount FROM student_fee_assignments WHERE id = v_assignment_id),
      rec.amount
    );

    -- Calculate discounts for this fee
    v_discount_total := 0;
    v_discount_details := '[]'::jsonb;
    v_net_amount := v_base_amount;

    FOR d_rec IN
      SELECT d.name, d.discount_type, d.value, d.max_discount_amount, d.is_exclusive, d.priority
      FROM student_discounts sd
      JOIN discounts d ON sd.discount_id = d.id
      WHERE sd.student_id = v_student_id
        AND (sd.fee_structure_id IS NULL OR sd.fee_structure_id = rec.fee_structure_id)
        AND sd.is_active = true AND d.is_active = true
        AND sd.effective_from <= CURRENT_DATE
        AND (sd.effective_until IS NULL OR sd.effective_until >= CURRENT_DATE)
      ORDER BY d.is_exclusive DESC,
               (CASE WHEN d.discount_type = 'percentage' THEN 0 ELSE 1 END),
               d.priority ASC
    LOOP
      IF d_rec.is_exclusive THEN
        IF d_rec.discount_type = 'percentage' THEN
          v_disc_calc := v_base_amount * d_rec.value / 100;
          IF d_rec.max_discount_amount IS NOT NULL THEN v_disc_calc := LEAST(v_disc_calc, d_rec.max_discount_amount); END IF;
        ELSE
          v_disc_calc := LEAST(d_rec.value, v_base_amount);
        END IF;
        v_discount_total := LEAST(v_disc_calc, v_base_amount);
        v_discount_details := jsonb_build_array(jsonb_build_object('name', d_rec.name, 'type', d_rec.discount_type, 'value', d_rec.value, 'calculated', v_discount_total));
        v_net_amount := GREATEST(v_base_amount - v_discount_total, 0);
        EXIT;
      END IF;

      IF d_rec.discount_type = 'percentage' THEN
        v_disc_calc := v_net_amount * d_rec.value / 100;
        IF d_rec.max_discount_amount IS NOT NULL THEN v_disc_calc := LEAST(v_disc_calc, d_rec.max_discount_amount); END IF;
      ELSE
        v_disc_calc := LEAST(d_rec.value, v_net_amount);
      END IF;
      v_disc_calc := LEAST(v_disc_calc, v_net_amount);
      v_discount_total := v_discount_total + v_disc_calc;
      v_net_amount := v_net_amount - v_disc_calc;
      v_discount_details := v_discount_details || jsonb_build_array(jsonb_build_object('name', d_rec.name, 'type', d_rec.discount_type, 'value', d_rec.value, 'calculated', v_disc_calc));
    END LOOP;

    -- Generate dues for the year
    v_current_date := v_start_date;
    WHILE v_current_date <= v_end_date LOOP
      IF v_net_amount > 0 THEN
        INSERT INTO dues (id, student_id, student_fee_assignment_id, amount, original_amount, discount_amount, discount_details, due_date, due_type)
        VALUES (gen_random_uuid(), v_student_id, v_assignment_id, v_net_amount, v_base_amount, v_discount_total, v_discount_details, v_current_date, 'standard')
        ON CONFLICT (student_id, student_fee_assignment_id, due_date) WHERE due_type = 'standard' DO NOTHING;
      END IF;

      IF rec.frequency = 'monthly' THEN v_current_date := v_current_date + INTERVAL '1 month';
      ELSIF rec.frequency = 'quarterly' THEN v_current_date := v_current_date + INTERVAL '3 months';
      ELSIF rec.frequency = 'yearly' THEN v_current_date := v_current_date + INTERVAL '1 year';
      ELSE EXIT; END IF;
    END LOOP;
  END LOOP;

  RETURN v_student_id;
END;
$$;

-- ── 3. finalize_transaction_receipt() ────────────────────────
-- Attach receipt number to a transaction that already exists
-- (Razorpay verify path). Locks the txn row, so racing callers
-- return the same receipt instead of burning two numbers.
-- Service-role only by design (no authenticated grant).
CREATE OR REPLACE FUNCTION finalize_transaction_receipt(
  p_transaction_id UUID,
  p_collected_by   TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn        RECORD;
  v_receipt_id UUID;
  v_receipt_no TEXT;
BEGIN
  SELECT id, student_id, amount, payment_method, reference_id, comment, date, receipt_id
  INTO v_txn
  FROM transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % not found', p_transaction_id;
  END IF;

  -- Already finalized → return existing (idempotent)
  IF v_txn.receipt_id IS NOT NULL THEN
    SELECT id, receipt_no INTO v_receipt_id, v_receipt_no
    FROM receipts WHERE id = v_txn.receipt_id;
    RETURN json_build_object('receipt_id', v_receipt_id, 'receipt_no', v_receipt_no);
  END IF;

  v_receipt_no := next_receipt_number(v_txn.date);

  INSERT INTO receipts
    (id, receipt_no, student_id, amount, payment_method, reference_id, comment, date, collected_by)
  VALUES
    (gen_random_uuid(), v_receipt_no, v_txn.student_id, v_txn.amount, v_txn.payment_method,
     v_txn.reference_id, v_txn.comment, v_txn.date, p_collected_by)
  RETURNING id INTO v_receipt_id;

  UPDATE transactions SET receipt_id = v_receipt_id WHERE id = p_transaction_id;

  RETURN json_build_object('receipt_id', v_receipt_id, 'receipt_no', v_receipt_no);
END;
$$;

-- ── 4. student_summary: expose admission_no / phone_normalized / family_id ──
-- The view was created from students with `s.*` BEFORE V2 added columns,
-- so its column list is frozen and lacks admission_no. Recreate with an
-- explicit projection (stable across future students columns).
DROP VIEW IF EXISTS student_summary;
CREATE VIEW student_summary AS
SELECT
  s.id, s.name, s.class_id, s.section, s.parent_name, s.phone, s.email,
  s.last_late_fee_eval, s.created_at,
  s.admission_no, s.phone_normalized, s.family_id,
  c.name AS class_name,
  COALESCE(SUM(CASE WHEN d.due_date < date_trunc('month', CURRENT_DATE) AND d.status != 'paid'
                THEN d.amount - d.paid_amount ELSE 0 END), 0) AS overdue_amount,
  COALESCE(SUM(CASE WHEN d.due_date >= date_trunc('month', CURRENT_DATE)
                     AND d.due_date <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')
                     AND d.status != 'paid'
                THEN d.amount - d.paid_amount ELSE 0 END), 0) AS current_month_due,
  COALESCE(SUM(CASE WHEN d.status != 'paid'
                THEN d.amount - d.paid_amount ELSE 0 END), 0) AS pending_amount
FROM students s
LEFT JOIN classes c ON s.class_id = c.id
LEFT JOIN dues d ON d.student_id = s.id
GROUP BY s.id, c.name;

GRANT SELECT ON student_summary TO authenticated;
GRANT SELECT ON student_summary TO service_role;

-- ── 6. Grants ─────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- finalize_transaction_receipt: service role only (edge functions).
-- No grant to authenticated/anon; revoke default PUBLIC execute.
REVOKE EXECUTE ON FUNCTION finalize_transaction_receipt(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION finalize_transaction_receipt(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION finalize_transaction_receipt(UUID, TEXT) FROM authenticated;
