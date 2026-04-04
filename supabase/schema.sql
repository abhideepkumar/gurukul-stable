-- ============================================================
-- GURUKUL: School Fees Management System
-- Complete PostgreSQL Schema (Supabase)
--
-- This single file contains ALL tables, RLS policies, RPCs,
-- and security hardening. Run it in the Supabase SQL Editor
-- on a FRESH project, or use it as the canonical reference.
--
-- Includes:
--   • Core tables (classes, students, fees, dues, transactions)
--   • Discount system (discounts, student_discounts)
--   • Late fee system (late_fee_rules)
--   • Payment intents (Razorpay integration)
--   • All RLS policies (authenticated role)
--   • RPCs: add_student_with_dues, process_payment,
--           recalculate_student_dues, evaluate_student_late_fees,
--           waive_due
--   • Input validation constraints
--   • Security hardening (RPC access control)
-- ============================================================


-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly', 'one_time')),
  fee_category TEXT DEFAULT 'tuition'
    CHECK (fee_category IN ('tuition','transport','lab','library','exam','activity','admission','deposit','other')),
  is_optional BOOLEAN DEFAULT false,
  applies_late_fee BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_fee_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  fee_structure_id UUID NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(class_id, fee_structure_id)
);

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  class_id UUID NOT NULL REFERENCES classes(id),
  section TEXT,
  parent_name TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_fee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_structure_id UUID NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  custom_amount NUMERIC(12,2) NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, fee_structure_id)
);

CREATE TABLE IF NOT EXISTS dues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  student_fee_assignment_id UUID NOT NULL REFERENCES student_fee_assignments(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  original_amount NUMERIC(12, 2),
  discount_amount NUMERIC(12, 2) DEFAULT 0,
  discount_details JSONB DEFAULT '[]'::jsonb,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid')),
  paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_type TEXT DEFAULT 'standard' CHECK (due_type IN ('standard', 'late_fee')),
  parent_due_id UUID NULL REFERENCES dues(id),
  is_waived BOOLEAN DEFAULT false,
  waived_by TEXT NULL,
  waived_reason TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, student_fee_assignment_id, due_date)
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'online')),
  reference_id TEXT,
  comment TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  fee_due_id UUID NOT NULL REFERENCES dues(id) ON DELETE CASCADE,
  amount_applied NUMERIC(12, 2) NOT NULL CHECK (amount_applied > 0)
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_order_id TEXT UNIQUE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  allocations JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  value NUMERIC(12,2) NOT NULL CHECK (value > 0),
  max_discount_amount NUMERIC(12,2) NULL,
  is_exclusive BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  fee_structure_id UUID NULL REFERENCES fee_structures(id),
  effective_from DATE NOT NULL,
  effective_until DATE NULL,
  approved_by TEXT NULL,
  notes TEXT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, discount_id, fee_structure_id)
);

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

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_fee_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_fee_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dues ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE late_fee_rules ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 3. RLS POLICIES (authenticated role only)
-- ============================================================

-- Classes
CREATE POLICY "auth can select classes" ON classes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert classes" ON classes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can delete classes" ON classes FOR DELETE TO authenticated USING (true);

-- Fee Structures
CREATE POLICY "auth can select fee_structures" ON fee_structures FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert fee_structures" ON fee_structures FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can delete fee_structures" ON fee_structures FOR DELETE TO authenticated USING (true);

-- Class Fee Defaults
CREATE POLICY "auth can select class_fee_defaults" ON class_fee_defaults FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert class_fee_defaults" ON class_fee_defaults FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can delete class_fee_defaults" ON class_fee_defaults FOR DELETE TO authenticated USING (true);

-- Students (no direct INSERT — must use add_student_with_dues RPC)
CREATE POLICY "auth can select students" ON students FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can update students" ON students FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth can delete students" ON students FOR DELETE TO authenticated USING (true);

-- Read-only tables (writes managed by SECURITY DEFINER RPCs)
CREATE POLICY "auth can select student_fee_assignments" ON student_fee_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can select dues"                    ON dues                    FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can select transactions"            ON transactions            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can select transaction_allocations" ON transaction_allocations FOR SELECT TO authenticated USING (true);

-- Payment Intents (read-only — edge functions use service_role for writes)
CREATE POLICY "auth can select payment_intents" ON payment_intents FOR SELECT TO authenticated USING (true);

-- Discounts
CREATE POLICY "auth can select discounts" ON discounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert discounts" ON discounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can update discounts" ON discounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth can delete discounts" ON discounts FOR DELETE TO authenticated USING (true);

-- Student Discounts
CREATE POLICY "auth can select student_discounts" ON student_discounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert student_discounts" ON student_discounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can update student_discounts" ON student_discounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth can delete student_discounts" ON student_discounts FOR DELETE TO authenticated USING (true);

-- Late Fee Rules
CREATE POLICY "auth can select late_fee_rules" ON late_fee_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert late_fee_rules" ON late_fee_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can update late_fee_rules" ON late_fee_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth can delete late_fee_rules" ON late_fee_rules FOR DELETE TO authenticated USING (true);


-- ============================================================
-- 4. INPUT VALIDATION CONSTRAINTS
-- ============================================================

ALTER TABLE classes
  DROP CONSTRAINT IF EXISTS chk_classes_name_length,
  ADD CONSTRAINT chk_classes_name_length CHECK (length(name) <= 100);

ALTER TABLE fee_structures
  DROP CONSTRAINT IF EXISTS chk_fee_name_length,
  ADD CONSTRAINT chk_fee_name_length CHECK (length(name) <= 200);

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

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_tx_reference_length,
  ADD CONSTRAINT chk_tx_reference_length CHECK (length(reference_id) <= 200);

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_tx_comment_length,
  ADD CONSTRAINT chk_tx_comment_length CHECK (length(comment) <= 500);


-- ============================================================
-- 5. COMPOSITE TYPES (for RPC parameters)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE payment_allocation AS (
    due_id          UUID,
    amount_allocated NUMERIC
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE cleared_due_result AS (
    due_id           UUID,
    fee_name         TEXT,
    amount_allocated NUMERIC,
    due_date         DATE
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================
-- 6. RPC: add_student_with_dues
--
-- Atomically:
--  1. Inserts the student
--  2. Creates fee assignments (from explicit list or class defaults)
--  3. Applies discounts from student_discounts
--  4. Generates 1 year of due rows per fee structure
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

  -- 2. Insert student
  INSERT INTO students (id, name, class_id, section, parent_name, phone, email)
  VALUES (v_student_id, p_name, p_class_id, p_section, p_parent_name, p_phone, p_email);

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

    -- Calculate discounts for this fee
    v_base_amount := rec.amount;
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
-- 7. RPC: process_payment
--
-- Atomically:
--  1. Validates allocations match payment amount
--  2. Inserts transaction + allocation records
--  3. Updates dues (paid_amount, status)
--  4. Returns transaction id and cleared due details
-- ============================================================

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

  IF p_payment_method NOT IN ('cash', 'online') THEN
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
-- 8. RPC: recalculate_student_dues
--
-- Recalculates discounts on all unpaid dues for a student.
-- Called after assigning or removing a discount.
-- Returns count of updated dues.
-- ============================================================

CREATE OR REPLACE FUNCTION recalculate_student_dues(p_student_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due            RECORD;
  v_base_amount    NUMERIC;
  v_discount_total NUMERIC;
  v_net_amount     NUMERIC;
  v_discount_details JSONB;
  d_rec            RECORD;
  v_disc_calc      NUMERIC;
  v_updated_count  INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

  FOR v_due IN
    SELECT d.id, d.student_fee_assignment_id, d.due_date, d.paid_amount, d.status,
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
    v_base_amount := v_due.base_amount;
    v_discount_total := 0;
    v_discount_details := '[]'::jsonb;
    v_net_amount := v_base_amount;

    FOR d_rec IN
      SELECT d.name, d.discount_type, d.value, d.max_discount_amount, d.is_exclusive, d.priority
      FROM student_discounts sd
      JOIN discounts d ON sd.discount_id = d.id
      WHERE sd.student_id = p_student_id
        AND (sd.fee_structure_id IS NULL OR sd.fee_structure_id = v_due.fee_structure_id)
        AND sd.is_active = true AND d.is_active = true
        AND sd.effective_from <= v_due.due_date
        AND (sd.effective_until IS NULL OR sd.effective_until >= v_due.due_date)
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

    -- Don't reduce below already-paid amount
    IF v_net_amount < v_due.paid_amount THEN
      v_net_amount := v_due.paid_amount;
      v_discount_total := v_base_amount - v_net_amount;
    END IF;

    UPDATE dues
    SET original_amount = v_base_amount,
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
-- 9. RPC: evaluate_student_late_fees
--
-- On-demand late fee evaluation for a student.
-- Called when admin opens the payment screen.
-- Calculates and UPSERTS late fee due records.
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
  SELECT class_id INTO v_student_class FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

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
    -- Find best matching rule (most specific first)
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

    -- Skip if fee doesn't allow late fees
    IF NOT EXISTS (
      SELECT 1 FROM fee_structures
      WHERE id = v_due.fee_structure_id AND applies_late_fee = true
    ) THEN CONTINUE; END IF;

    v_days_overdue := (CURRENT_DATE - v_due.due_date) - v_rule.grace_period_days;
    IF v_days_overdue <= 0 THEN CONTINUE; END IF;

    CASE v_rule.penalty_type
      WHEN 'fixed_once' THEN
        v_penalty := v_rule.penalty_value;
      WHEN 'fixed_daily' THEN
        v_penalty := v_days_overdue * v_rule.penalty_value;
      WHEN 'percentage_monthly' THEN
        v_penalty := (v_due.amount - v_due.paid_amount) * v_rule.penalty_value / 100.0
                     * CEIL(v_days_overdue / 30.0);
    END CASE;

    IF v_rule.max_penalty IS NOT NULL THEN
      v_penalty := LEAST(v_penalty, v_rule.max_penalty);
    END IF;

    v_penalty := ROUND(v_penalty, 2);
    IF v_penalty <= 0 THEN CONTINUE; END IF;

    -- Check for existing late fee due
    SELECT id INTO v_existing_id
    FROM dues
    WHERE parent_due_id = v_due.id AND due_type = 'late_fee' AND is_waived = false
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      IF v_rule.penalty_type = 'fixed_once' THEN CONTINUE; END IF;
      UPDATE dues SET amount = v_penalty, original_amount = v_penalty
      WHERE id = v_existing_id AND status != 'paid';
    ELSE
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
-- 10. RPC: waive_due
--
-- Marks a due as waived (typically a late fee).
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


-- ============================================================
-- 11. SECURITY HARDENING: Lock down RPCs
--
-- SECURITY DEFINER functions bypass RLS. Restrict to
-- authenticated users only — deny anon and PUBLIC.
-- ============================================================

REVOKE EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) FROM anon;
GRANT EXECUTE ON FUNCTION process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE, payment_allocation[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION recalculate_student_dues(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recalculate_student_dues(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION recalculate_student_dues(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION evaluate_student_late_fees(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION evaluate_student_late_fees(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION evaluate_student_late_fees(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION waive_due(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION waive_due(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION waive_due(UUID, TEXT, TEXT) TO authenticated;
