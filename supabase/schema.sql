-- ============================================================
-- GURUKUL: School Fees Management System
-- Supabase PostgreSQL Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================


-- ============================================================
-- TABLES
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
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, fee_structure_id)
);

CREATE TABLE IF NOT EXISTS dues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  student_fee_assignment_id UUID NOT NULL REFERENCES student_fee_assignments(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid')),
  paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
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


-- ============================================================
-- ROW LEVEL SECURITY
-- Enable RLS on every table to deny all access by default,
-- then selectively grant via policies below.
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


-- ============================================================
-- RLS POLICIES: Classes
-- Anyone (anon) can read and write classes.
-- ============================================================
CREATE POLICY "anon can select classes" ON classes FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert classes" ON classes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can delete classes" ON classes FOR DELETE TO anon USING (true);


-- ============================================================
-- RLS POLICIES: Fee Structures
-- ============================================================
CREATE POLICY "anon can select fee_structures" ON fee_structures FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert fee_structures" ON fee_structures FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can delete fee_structures" ON fee_structures FOR DELETE TO anon USING (true);


-- ============================================================
-- RLS POLICIES: Class Fee Defaults
-- ============================================================
CREATE POLICY "anon can select class_fee_defaults" ON class_fee_defaults FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert class_fee_defaults" ON class_fee_defaults FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can delete class_fee_defaults" ON class_fee_defaults FOR DELETE TO anon USING (true);


-- ============================================================
-- RLS POLICIES: Students
-- Reads and profile updates allowed. Inserts are locked to RPC.
-- ============================================================
CREATE POLICY "anon can select students" ON students FOR SELECT TO anon USING (true);
CREATE POLICY "anon can update students" ON students FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon can delete students" ON students FOR DELETE TO anon USING (true);
-- NOTE: No INSERT policy on students — must go through add_student_with_dues() RPC.


-- ============================================================
-- RLS POLICIES: Read-only for tables managed by RPC functions
-- Inserts/updates on these tables are ONLY done via SECURITY
-- DEFINER functions — the anon user cannot INSERT directly.
-- ============================================================
CREATE POLICY "anon can select student_fee_assignments" ON student_fee_assignments FOR SELECT TO anon USING (true);
CREATE POLICY "anon can select dues"                    ON dues                    FOR SELECT TO anon USING (true);
CREATE POLICY "anon can select transactions"            ON transactions            FOR SELECT TO anon USING (true);
CREATE POLICY "anon can select transaction_allocations" ON transaction_allocations FOR SELECT TO anon USING (true);
CREATE POLICY "anon can select payment_intents"         ON payment_intents         FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert payment_intents"         ON payment_intents         FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update payment_intents"         ON payment_intents         FOR UPDATE TO anon USING (true);


-- ============================================================
-- RPC: add_student_with_dues
--
-- Atomically:
--  1. Inserts the student row
--  2. Fetches default fee structures for their class
--  3. Creates student_fee_assignment rows
--  4. Generates 1 year of individual due rows per fee structure
--
-- SECURITY DEFINER: bypasses RLS so it can INSERT into
-- students, student_fee_assignments, and dues tables.
-- The anon role cannot insert into these tables directly.
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
  v_next_date         DATE;
  rec                 RECORD;
BEGIN
  -- 1. Validate class exists
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id) THEN
    RAISE EXCEPTION 'Class % does not exist', p_class_id;
  END IF;

  -- 2. Insert student
  INSERT INTO students (id, name, class_id, section, parent_name, phone, email)
  VALUES (v_student_id, p_name, p_class_id, p_section, p_parent_name, p_phone, p_email);

  -- 3. Determine which fee structures to use
  IF p_fee_structure_ids IS NOT NULL THEN
    -- Use explicitly provided fee structures
    FOR rec IN
      SELECT id AS fee_structure_id, amount, frequency
      FROM fee_structures
      WHERE id = ANY(p_fee_structure_ids)
    LOOP
      v_assignment_id := gen_random_uuid();
      INSERT INTO student_fee_assignments (id, student_id, fee_structure_id, start_date, end_date)
      VALUES (v_assignment_id, v_student_id, rec.fee_structure_id, v_start_date, v_end_date);

      v_current_date := v_start_date;
      WHILE v_current_date <= v_end_date LOOP
        INSERT INTO dues (id, student_id, student_fee_assignment_id, amount, due_date)
        VALUES (gen_random_uuid(), v_student_id, v_assignment_id, rec.amount, v_current_date)
        ON CONFLICT (student_id, student_fee_assignment_id, due_date) DO NOTHING;

        IF rec.frequency = 'monthly' THEN v_current_date := v_current_date + INTERVAL '1 month';
        ELSIF rec.frequency = 'quarterly' THEN v_current_date := v_current_date + INTERVAL '3 months';
        ELSIF rec.frequency = 'yearly' THEN v_current_date := v_current_date + INTERVAL '1 year';
        ELSE EXIT; END IF;
      END LOOP;
    END LOOP;
  ELSE
    -- Use class defaults
    FOR rec IN
      SELECT cfd.fee_structure_id, fs.amount, fs.frequency
      FROM class_fee_defaults cfd
      JOIN fee_structures fs ON cfd.fee_structure_id = fs.id
      WHERE cfd.class_id = p_class_id
    LOOP
      v_assignment_id := gen_random_uuid();
      INSERT INTO student_fee_assignments (id, student_id, fee_structure_id, start_date, end_date)
      VALUES (v_assignment_id, v_student_id, rec.fee_structure_id, v_start_date, v_end_date);

      v_current_date := v_start_date;
      WHILE v_current_date <= v_end_date LOOP
        INSERT INTO dues (id, student_id, student_fee_assignment_id, amount, due_date)
        VALUES (gen_random_uuid(), v_student_id, v_assignment_id, rec.amount, v_current_date)
        ON CONFLICT (student_id, student_fee_assignment_id, due_date) DO NOTHING;

        IF rec.frequency = 'monthly' THEN v_current_date := v_current_date + INTERVAL '1 month';
        ELSIF rec.frequency = 'quarterly' THEN v_current_date := v_current_date + INTERVAL '3 months';
        ELSIF rec.frequency = 'yearly' THEN v_current_date := v_current_date + INTERVAL '1 year';
        ELSE EXIT; END IF;
      END LOOP;
    END LOOP;
  END IF;

  RETURN v_student_id;
END;
$$;


-- ============================================================
-- RPC: process_payment
--
-- Atomically:
--  1. Validates total allocated == payment amount (server-side)
--  2. For each allocation: fetches the due, verifies ownership
--     and that allocated amount does not exceed balance
--  3. Inserts the transaction row
--  4. Inserts transaction_allocation rows
--  5. Updates dues.paid_amount and status
--  6. Returns the transaction id and cleared due details
--
-- SECURITY DEFINER: bypasses RLS for INSERT/UPDATE on
-- protected tables. The anon user cannot directly INSERT
-- into transactions or UPDATE dues.
-- ============================================================
CREATE TYPE payment_allocation AS (
  due_id          UUID,
  amount_allocated NUMERIC
);

CREATE TYPE cleared_due_result AS (
  due_id           UUID,
  fee_name         TEXT,
  amount_allocated NUMERIC,
  due_date         DATE
);

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
  -- 1. Basic validations
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than 0';
  END IF;

  IF array_length(p_allocations, 1) IS NULL OR array_length(p_allocations, 1) = 0 THEN
    RAISE EXCEPTION 'No dues selected for payment';
  END IF;

  IF p_payment_method NOT IN ('cash', 'online') THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
  END IF;

  -- Validate student exists
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

  -- 2. Pre-validate: sum of allocations must match payment amount
  FOREACH v_alloc IN ARRAY p_allocations LOOP
    IF v_alloc.amount_allocated > 0 THEN
      v_total_allocated := v_total_allocated + v_alloc.amount_allocated;
    END IF;
  END LOOP;

  IF abs(v_total_allocated - p_amount) > 0.01 THEN
    RAISE EXCEPTION 'Total allocated (%) does not match payment amount (%)',
      v_total_allocated, p_amount;
  END IF;

  -- 3. Insert transaction
  INSERT INTO transactions (id, student_id, amount, payment_method, reference_id, comment, date)
  VALUES (v_transaction_id, p_student_id, p_amount, p_payment_method, p_reference_id, p_comment, p_date);

  -- 4. Process each allocation
  FOREACH v_alloc IN ARRAY p_allocations LOOP
    CONTINUE WHEN v_alloc.amount_allocated <= 0;

    -- Fetch due and verify ownership + get fee name
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

    -- Update due
    v_new_paid := v_due.paid_amount + v_alloc.amount_allocated;
    v_new_status := CASE WHEN (v_due.amount - v_new_paid) < 0.01 THEN 'paid' ELSE 'partial' END;

    UPDATE dues SET paid_amount = v_new_paid, status = v_new_status WHERE id = v_due.id;

    -- Insert allocation record
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
