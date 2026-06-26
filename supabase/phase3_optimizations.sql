-- ============================================================
-- PHASE 3 MIGRATION: Optimizations & Performance
-- Run this in the Supabase SQL Editor AFTER phase2_late_fees.sql
-- ============================================================


-- ============================================================
-- 1. ADD CRITICAL MISSING INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_dues_student_id ON dues(student_id);
CREATE INDEX IF NOT EXISTS idx_dues_status ON dues(status) WHERE status != 'paid';
CREATE INDEX IF NOT EXISTS idx_dues_due_date ON dues(due_date);
CREATE INDEX IF NOT EXISTS idx_dues_student_status ON dues(student_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_transactions_student_id ON transactions(student_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);

CREATE INDEX IF NOT EXISTS idx_student_discounts_student_id ON student_discounts(student_id);
CREATE INDEX IF NOT EXISTS idx_sfa_student_id ON student_fee_assignments(student_id);


-- ============================================================
-- 2. ADD COLUMN FOR LATE FEE OPTIMIZATION
-- ============================================================

ALTER TABLE students ADD COLUMN IF NOT EXISTS last_late_fee_eval DATE;


-- ============================================================
-- 3. HELPER RPC: calculate_discount_for_fee
-- Extracts discount logic to a single reusable function
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_discount_for_fee(
  p_student_id UUID,
  p_fee_structure_id UUID,
  p_base_amount NUMERIC,
  p_reference_date DATE,
  OUT v_discount_total NUMERIC,
  OUT v_net_amount NUMERIC,
  OUT v_discount_details JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d_rec RECORD;
  v_disc_calc NUMERIC;
BEGIN
  v_discount_total := 0;
  v_discount_details := '[]'::jsonb;
  v_net_amount := p_base_amount;

  FOR d_rec IN
    SELECT d.name, d.discount_type, d.value, d.max_discount_amount, d.is_exclusive, d.priority
    FROM student_discounts sd
    JOIN discounts d ON sd.discount_id = d.id
    WHERE sd.student_id = p_student_id
      AND (sd.fee_structure_id IS NULL OR sd.fee_structure_id = p_fee_structure_id)
      AND sd.is_active = true AND d.is_active = true
      AND sd.effective_from <= p_reference_date
      AND (sd.effective_until IS NULL OR sd.effective_until >= p_reference_date)
    ORDER BY d.is_exclusive DESC,
             (CASE WHEN d.discount_type = 'percentage' THEN 0 ELSE 1 END),
             d.priority ASC
  LOOP
    IF d_rec.is_exclusive THEN
      IF d_rec.discount_type = 'percentage' THEN
        v_disc_calc := p_base_amount * d_rec.value / 100;
        IF d_rec.max_discount_amount IS NOT NULL THEN v_disc_calc := LEAST(v_disc_calc, d_rec.max_discount_amount); END IF;
      ELSE
        v_disc_calc := LEAST(d_rec.value, p_base_amount);
      END IF;
      v_discount_total := LEAST(v_disc_calc, p_base_amount);
      v_discount_details := jsonb_build_array(jsonb_build_object('name', d_rec.name, 'type', d_rec.discount_type, 'value', d_rec.value, 'calculated', v_discount_total));
      v_net_amount := GREATEST(p_base_amount - v_discount_total, 0);
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
END;
$$;


-- ============================================================
-- 4. UPDATE RPC: add_student_with_dues
-- Uses helper, generates dues only up to current_month + 1
-- ============================================================

CREATE OR REPLACE FUNCTION add_student_with_dues(
  p_name        TEXT,
  p_class_id    UUID,
  p_fee_structure_ids UUID[] DEFAULT NULL,
  p_section     TEXT DEFAULT NULL,
  p_parent_name TEXT DEFAULT NULL,
  p_phone       TEXT DEFAULT NULL,
  p_email       TEXT DEFAULT NULL
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
  v_end_date          DATE := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::DATE; -- Only generate current and next month
  v_current_date      DATE;
  rec                 RECORD;
  v_base_amount       NUMERIC;
  v_discount_total    NUMERIC;
  v_net_amount        NUMERIC;
  v_discount_details  JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id) THEN
    RAISE EXCEPTION 'Class % does not exist', p_class_id;
  END IF;

  INSERT INTO students (id, name, class_id, section, parent_name, phone, email)
  VALUES (v_student_id, p_name, p_class_id, p_section, p_parent_name, p_phone, p_email);

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
    VALUES (v_assignment_id, v_student_id, rec.fee_structure_id, v_start_date, v_start_date + INTERVAL '1 year'); -- Keep assignment for 1 year

    v_base_amount := rec.amount;

    -- Generate dues for current month + 1
    v_current_date := v_start_date;
    WHILE v_current_date <= v_end_date LOOP
      
      -- Calculate discounts for this specific date
      SELECT discount_total, net_amount, discount_details 
      INTO v_discount_total, v_net_amount, v_discount_details
      FROM calculate_discount_for_fee(v_student_id, rec.fee_structure_id, v_base_amount, v_current_date);

      IF v_net_amount > 0 THEN
        INSERT INTO dues (id, student_id, student_fee_assignment_id, amount, original_amount, discount_amount, discount_details, due_date, due_type)
        VALUES (gen_random_uuid(), v_student_id, v_assignment_id, v_net_amount, v_base_amount, v_discount_total, v_discount_details, v_current_date, 'standard')
        ON CONFLICT (student_id, student_fee_assignment_id, due_date) DO NOTHING;
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


-- ============================================================
-- 5. UPDATE RPC: recalculate_student_dues
-- Uses helper function
-- ============================================================

CREATE OR REPLACE FUNCTION recalculate_student_dues(p_student_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due            RECORD;
  v_discount_total NUMERIC;
  v_net_amount     NUMERIC;
  v_discount_details JSONB;
  v_updated_count  INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

  FOR v_due IN
    SELECT d.id, d.due_date, d.paid_amount,
           sfa.fee_structure_id,
           COALESCE(sfa.custom_amount, fs.amount) AS base_amount
    FROM dues d
    JOIN student_fee_assignments sfa ON d.student_fee_assignment_id = sfa.id
    JOIN fee_structures fs ON sfa.fee_structure_id = fs.id
    WHERE d.student_id = p_student_id
      AND d.due_type = 'standard'
      AND d.status != 'paid'
      AND d.is_waived = false
  LOOP
    
    SELECT discount_total, net_amount, discount_details 
    INTO v_discount_total, v_net_amount, v_discount_details
    FROM calculate_discount_for_fee(p_student_id, v_due.fee_structure_id, v_due.base_amount, v_due.due_date);

    IF v_net_amount < v_due.paid_amount THEN
      v_net_amount := v_due.paid_amount;
      v_discount_total := v_due.base_amount - v_net_amount;
    END IF;

    UPDATE dues
    SET original_amount = v_due.base_amount,
        discount_amount = v_discount_total,
        discount_details = v_discount_details,
        amount = v_net_amount,
        status = CASE WHEN v_net_amount - v_due.paid_amount < 0.01 THEN 'paid'
                      WHEN v_due.paid_amount > 0 THEN 'partial'
                      ELSE 'unpaid' END
    WHERE id = v_due.id;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  RETURN v_updated_count;
END;
$$;


-- ============================================================
-- 6. UPDATE RPC: evaluate_student_late_fees
-- Adds daily evaluation guard
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
  IF EXISTS (SELECT 1 FROM students WHERE id = p_student_id AND last_late_fee_eval = CURRENT_DATE) THEN
    RETURN; -- Already evaluated today
  END IF;

  SELECT class_id INTO v_student_class FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

  UPDATE students SET last_late_fee_eval = CURRENT_DATE WHERE id = p_student_id;

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

    IF NOT FOUND THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM fee_structures
      WHERE id = v_due.fee_structure_id AND applies_late_fee = true
    ) THEN CONTINUE; END IF;

    v_days_overdue := (CURRENT_DATE - v_due.due_date) - v_rule.grace_period_days;
    IF v_days_overdue <= 0 THEN CONTINUE; END IF;

    CASE v_rule.penalty_type
      WHEN 'fixed_once' THEN v_penalty := v_rule.penalty_value;
      WHEN 'fixed_daily' THEN v_penalty := v_days_overdue * v_rule.penalty_value;
      WHEN 'percentage_monthly' THEN
        v_penalty := (v_due.amount - v_due.paid_amount) * v_rule.penalty_value / 100.0 * CEIL(v_days_overdue / 30.0);
    END CASE;

    IF v_rule.max_penalty IS NOT NULL THEN v_penalty := LEAST(v_penalty, v_rule.max_penalty); END IF;
    v_penalty := ROUND(v_penalty, 2);
    IF v_penalty <= 0 THEN CONTINUE; END IF;

    SELECT id INTO v_existing_id FROM dues
    WHERE parent_due_id = v_due.id AND due_type = 'late_fee' AND is_waived = false LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      IF v_rule.penalty_type = 'fixed_once' THEN CONTINUE; END IF;
      UPDATE dues SET amount = v_penalty, original_amount = v_penalty
      WHERE id = v_existing_id AND status != 'paid';
    ELSE
      INSERT INTO dues (id, student_id, student_fee_assignment_id, amount, original_amount, due_date, due_type, parent_due_id, status)
      VALUES (gen_random_uuid(), p_student_id, v_due.student_fee_assignment_id, v_penalty, v_penalty, v_due.due_date, 'late_fee', v_due.id, 'unpaid');
    END IF;
  END LOOP;
END;
$$;


-- ============================================================
-- 7. RPC: get_dashboard_stats
-- Pre-aggregates dashboard stats
-- ============================================================

CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_month_end   DATE := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
BEGIN
  RETURN json_build_object(
    'total_students',           (SELECT COUNT(*) FROM students),
    'current_month_collection', COALESCE((SELECT SUM(amount) FROM transactions WHERE date BETWEEN v_month_start AND v_month_end), 0),
    'current_month_dues',       COALESCE((SELECT SUM(amount) FROM dues WHERE due_date BETWEEN v_month_start AND v_month_end), 0),
    'total_overdue',            COALESCE((SELECT SUM(amount - paid_amount) FROM dues WHERE due_date < v_month_start AND status != 'paid'), 0)
  );
END;
$$;


-- ============================================================
-- 8. RPC: get_defaulters_report
-- Pre-aggregates defaulters report
-- ============================================================

CREATE OR REPLACE FUNCTION get_defaulters_report()
RETURNS TABLE(id UUID, name TEXT, phone TEXT, class_name TEXT, pending_amount NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    COALESCE(s.phone, '') AS phone,
    c.name AS class_name,
    SUM(d.amount - d.paid_amount) AS pending_amount
  FROM dues d
  JOIN students s ON d.student_id = s.id
  JOIN classes c ON s.class_id = c.id
  WHERE d.due_date < date_trunc('month', CURRENT_DATE)
    AND d.status != 'paid'
  GROUP BY s.id, s.name, s.phone, c.name
  HAVING SUM(d.amount - d.paid_amount) > 0
  ORDER BY pending_amount DESC;
$$;


-- ============================================================
-- 9. VIEW: student_summary
-- Resolves N+1 query pattern on Students list
-- ============================================================

CREATE OR REPLACE VIEW student_summary AS
SELECT
  s.*,
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


-- ============================================================
-- 10. RPC: bulk_import_students
-- Executes CSV import loop on the server
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_import_students(p_students JSONB)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  v_student_id UUID;
  v_class_id UUID;
  v_results JSON[] := '{}';
  v_errors  JSON[] := '{}';
  i INTEGER;
  due_amount NUMERIC;
  due_desc TEXT;
  due_date_str TEXT;
  due_date_val DATE;
BEGIN
  FOR item IN SELECT jsonb_array_elements(p_students)
  LOOP
    BEGIN
      SELECT id INTO v_class_id FROM classes 
      WHERE lower(name) = lower(item->>'Class Name');
      
      IF v_class_id IS NULL THEN
        v_errors := array_append(v_errors, json_build_object('name', item->>'Name', 'error', 'Class not found'));
        CONTINUE;
      END IF;

      v_student_id := add_student_with_dues(
        item->>'Name', v_class_id, NULL,
        NULLIF(item->>'Section', ''), NULLIF(item->>'Parent Name', ''),
        NULLIF(item->>'Phone', ''), NULLIF(item->>'Email', '')
      );

      -- Iterate over potential old dues 1 to 10
      FOR i IN 1..10 LOOP
        due_amount := NULLIF(item->>('Old Due ' || i || ' Amount'), '')::NUMERIC;
        IF due_amount IS NOT NULL AND due_amount > 0 THEN
          due_desc := item->>('Old Due ' || i || ' Desc');
          due_date_str := item->>('Old Due ' || i || ' Date');
          
          IF due_desc IS NULL OR due_desc = '' THEN
            RAISE EXCEPTION 'Missing Description for Old Due %', i;
          END IF;
          
          IF due_date_str IS NULL OR due_date_str = '' THEN
            due_date_val := CURRENT_DATE;
          ELSE
            due_date_val := due_date_str::DATE;
          END IF;

          PERFORM add_custom_due(v_student_id, due_amount, due_desc, due_date_val, 'Bulk Import - Old Due ' || i);
        END IF;
      END LOOP;

      v_results := array_append(v_results, json_build_object('name', item->>'Name', 'id', v_student_id));
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, json_build_object('name', item->>'Name', 'error', SQLERRM));
    END;
  END LOOP;
  
  RETURN json_build_object('imported', array_to_json(v_results), 'errors', array_to_json(v_errors));
END;
$$;
