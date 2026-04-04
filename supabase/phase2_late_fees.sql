-- ============================================================
-- PHASE 2 MIGRATION: Late Fees System
-- Run this in the Supabase SQL Editor AFTER phase1_discounts.sql
-- ============================================================


-- ============================================================
-- 1. CREATE LATE FEE RULES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS late_fee_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  fee_structure_id UUID NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  class_id UUID NULL REFERENCES classes(id) ON DELETE CASCADE,
  grace_period_days INTEGER NOT NULL DEFAULT 5,
  penalty_type TEXT NOT NULL CHECK (penalty_type IN ('fixed_once', 'fixed_daily', 'percentage_monthly')),
  penalty_value NUMERIC(12,2) NOT NULL CHECK (penalty_value > 0),
  max_penalty NUMERIC(12,2) NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE late_fee_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth can select late_fee_rules" ON late_fee_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert late_fee_rules" ON late_fee_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can update late_fee_rules" ON late_fee_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth can delete late_fee_rules" ON late_fee_rules FOR DELETE TO authenticated USING (true);


-- ============================================================
-- 3. RPC: evaluate_student_late_fees
--
-- On-demand late fee evaluation for a single student.
-- Called when admin opens the payment screen or views dues.
-- Calculates and UPSERTS late fee due records.
--
-- SECURITY DEFINER: can INSERT/UPDATE dues table.
-- ============================================================

CREATE OR REPLACE FUNCTION evaluate_student_late_fees(p_student_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due           RECORD;
  v_rule          RECORD;
  v_days_overdue  INTEGER;
  v_penalty       NUMERIC;
  v_existing_id   UUID;
  v_student_class UUID;
BEGIN
  -- Get the student's class
  SELECT class_id INTO v_student_class FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

  -- Loop through all unpaid/partial standard dues that are past due
  FOR v_due IN
    SELECT d.id, d.amount, d.paid_amount, d.due_date, d.student_fee_assignment_id,
           sfa.fee_structure_id
    FROM dues d
    JOIN student_fee_assignments sfa ON d.student_fee_assignment_id = sfa.id
    WHERE d.student_id = p_student_id
      AND d.due_type = 'standard'
      AND d.status != 'paid'
      AND d.is_waived = false
      AND d.due_date < CURRENT_DATE
  LOOP
    -- Find the best matching late fee rule:
    -- 1. Exact match on fee_structure_id + class_id
    -- 2. fee_structure_id match with NULL class
    -- 3. class_id match with NULL fee_structure
    -- 4. Both NULL (global default)
    SELECT * INTO v_rule
    FROM late_fee_rules
    WHERE is_active = true
      AND (fee_structure_id IS NULL OR fee_structure_id = v_due.fee_structure_id)
      AND (class_id IS NULL OR class_id = v_student_class)
    ORDER BY
      (CASE WHEN fee_structure_id IS NOT NULL AND class_id IS NOT NULL THEN 0
            WHEN fee_structure_id IS NOT NULL THEN 1
            WHEN class_id IS NOT NULL THEN 2
            ELSE 3 END) ASC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE; -- no rule applies to this fee
    END IF;

    -- Check if the fee structure allows late fees
    IF NOT EXISTS (
      SELECT 1 FROM fee_structures 
      WHERE id = v_due.fee_structure_id AND applies_late_fee = true
    ) THEN
      CONTINUE;
    END IF;

    -- Calculate days overdue past the grace period
    v_days_overdue := (CURRENT_DATE - v_due.due_date) - v_rule.grace_period_days;
    IF v_days_overdue <= 0 THEN
      CONTINUE; -- still within grace period
    END IF;

    -- Calculate penalty
    CASE v_rule.penalty_type
      WHEN 'fixed_once' THEN
        v_penalty := v_rule.penalty_value;
      WHEN 'fixed_daily' THEN
        v_penalty := v_days_overdue * v_rule.penalty_value;
      WHEN 'percentage_monthly' THEN
        v_penalty := (v_due.amount - v_due.paid_amount) * v_rule.penalty_value / 100.0 
                     * CEIL(v_days_overdue / 30.0);
    END CASE;

    -- Apply max penalty cap
    IF v_rule.max_penalty IS NOT NULL THEN
      v_penalty := LEAST(v_penalty, v_rule.max_penalty);
    END IF;

    -- Round to 2 decimal places
    v_penalty := ROUND(v_penalty, 2);

    IF v_penalty <= 0 THEN
      CONTINUE;
    END IF;

    -- Check if a late fee due already exists for this parent due
    SELECT id INTO v_existing_id
    FROM dues
    WHERE parent_due_id = v_due.id
      AND due_type = 'late_fee'
      AND is_waived = false
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- For fixed_once: don't update, it was already generated
      IF v_rule.penalty_type = 'fixed_once' THEN
        CONTINUE;
      END IF;
      -- For daily/percentage: update the amount (it grows over time)
      UPDATE dues
      SET amount = v_penalty,
          original_amount = v_penalty
      WHERE id = v_existing_id
        AND status != 'paid'; -- don't update if already paid
    ELSE
      -- Create new late fee due
      INSERT INTO dues (
        id, student_id, student_fee_assignment_id,
        amount, original_amount, due_date,
        due_type, parent_due_id, status
      ) VALUES (
        gen_random_uuid(), p_student_id, v_due.student_fee_assignment_id,
        v_penalty, v_penalty, v_due.due_date,
        'late_fee', v_due.id, 'unpaid'
      );
    END IF;
  END LOOP;
END;
$$;


-- ============================================================
-- 4. RPC: waive_due
--
-- Allows admin to waive a due (typically a late fee).
-- Sets is_waived = true and records who waived it.
-- SECURITY DEFINER: can UPDATE dues table.
-- ============================================================

CREATE OR REPLACE FUNCTION waive_due(
  p_due_id UUID,
  p_waived_by TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE dues
  SET is_waived = true,
      waived_by = p_waived_by,
      waived_reason = p_reason,
      status = 'paid',
      paid_amount = amount
  WHERE id = p_due_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Due % not found', p_due_id;
  END IF;
END;
$$;
