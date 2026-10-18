-- ============================================================
-- V3__families_receipts.sql  —  Siblings + receipt-first payments
-- Idempotent: safe to re-run. Additive only.
--
-- Concepts:
--   families   — a group of sibling students (explicit, admin-linked)
--   receipts   — the money document. One per counter payment; families share one.
--   receipt_counters — row-locked sequence per academic-year scope
--
-- Honestly NOT here yet (V4, needs a transaction_id backfill decision):
--   transactions.receipt_id  — so receipts can group Razorpay payments too.
--
-- What it does:
--   1. families table + students.family_id + auto-cleanup on unlink
--   2. receipts + receipt_counters tables
--   3. next_receipt_number() — concurrency-safe, contiguous per AY scope
--   4. process_family_payment() — ATOMIC multi-child counter payment
--      (all children's transactions commit together or none do)
--   5. Everyone keeps working: process_payment is unchanged.
-- ============================================================

-- ── 1. Families ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS families (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT,                                 -- e.g. "Sharma family" (optional label)
  phone         TEXT,                                 -- primary contact for the family
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS family_id UUID;
CREATE INDEX IF NOT EXISTS idx_students_family ON students(family_id);

DO $$
BEGIN
  ALTER TABLE students
    ADD CONSTRAINT fk_students_family
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Link siblings: one family for all passed students. Reuses an existing
-- family when any of them is already in one; otherwise creates a new family.
CREATE OR REPLACE FUNCTION link_siblings(
  p_student_ids UUID[],
  p_name        TEXT DEFAULT NULL,
  p_phone       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_count     INT;
BEGIN
  IF p_student_ids IS NULL OR array_length(p_student_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Need at least 2 students to link siblings';
  END IF;

  SELECT COUNT(*) INTO v_count FROM students WHERE id = ANY(p_student_ids);
  IF v_count <> array_length(p_student_ids, 1) THEN
    RAISE EXCEPTION 'One or more student ids do not exist';
  END IF;

  -- Reuse an existing family if any of the students already has one
  SELECT family_id INTO v_family_id
  FROM students
  WHERE id = ANY(p_student_ids) AND family_id IS NOT NULL
  LIMIT 1;

  IF v_family_id IS NULL THEN
    INSERT INTO families (name, phone) VALUES (p_name, p_phone)
    RETURNING id INTO v_family_id;
  END IF;

  UPDATE students SET family_id = v_family_id WHERE id = ANY(p_student_ids);

  RETURN v_family_id;
END;
$$;

-- Unlink one student; delete the family when it has < 2 members left.
CREATE OR REPLACE FUNCTION unlink_sibling(p_student_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_remaining INT;
BEGIN
  SELECT family_id INTO v_family_id FROM students WHERE id = p_student_id;

  UPDATE students SET family_id = NULL WHERE id = p_student_id;

  IF v_family_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_remaining FROM students WHERE family_id = v_family_id;
    IF v_remaining < 2 THEN
      UPDATE students SET family_id = NULL WHERE family_id = v_family_id;
      DELETE FROM families WHERE id = v_family_id;
    END IF;
  END IF;
END;
$$;

-- Siblings of a student, with their summary balances (for the chips UI).
CREATE OR REPLACE FUNCTION get_siblings(p_student_id UUID)
RETURNS TABLE(
  id UUID, name TEXT, class_name TEXT, section TEXT,
  parent_name TEXT, phone TEXT, admission_no TEXT,
  pending_amount NUMERIC, overdue_amount NUMERIC, current_month_due NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, s.name, c.name, s.section, s.parent_name, s.phone, s.admission_no,
    COALESCE(ss.pending_amount, 0),
    COALESCE(ss.overdue_amount, 0),
    COALESCE(ss.current_month_due, 0)
  FROM students s
  JOIN students anchor ON anchor.id = p_student_id
  JOIN classes c       ON c.id = s.class_id
  JOIN student_summary ss ON ss.id = s.id
  WHERE anchor.family_id IS NOT NULL
    AND s.family_id = anchor.family_id
    AND s.id != anchor.id
  ORDER BY s.name;
$$;

-- ── 2. Receipts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no      TEXT UNIQUE NOT NULL,
  student_id      UUID REFERENCES students(id) ON DELETE SET NULL, -- NULL for family receipts
  family_id       UUID REFERENCES families(id) ON DELETE SET NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash','online','razorpay')),
  reference_id    TEXT,
  comment         TEXT,
  date            DATE NOT NULL,
  collected_by    TEXT,                          -- staff email; powers day-close report
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipts_date     ON receipts(date);
CREATE INDEX IF NOT EXISTS idx_receipts_student  ON receipts(student_id);
CREATE INDEX IF NOT EXISTS idx_receipts_family   ON receipts(family_id);

-- Link transactions back to their receipt (NULL for legacy/razorpay-until-verify).
-- Additive + nullable: process_payment keeps working untouched.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS receipt_id UUID;
DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT fk_transactions_receipt
    FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_transactions_receipt ON transactions(receipt_id);

CREATE TABLE IF NOT EXISTS receipt_counters (
  scope      TEXT PRIMARY KEY,     -- e.g. '2025-26' (Indian academic year)
  last_no    INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. next_receipt_number() — concurrency-safe sequence ─────
-- Format: RCPT-2025-26-0001
-- Academic year: April 1 → March 31.
CREATE OR REPLACE FUNCTION next_receipt_number(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope  TEXT;
  v_no     INT;
BEGIN
  v_scope := CASE
    WHEN EXTRACT(MONTH FROM p_date) >= 4
      THEN EXTRACT(YEAR FROM p_date)::INT::TEXT || '-' ||
           RIGHT((EXTRACT(YEAR FROM p_date)::INT + 1)::TEXT, 2)
    ELSE (EXTRACT(YEAR FROM p_date)::INT - 1)::TEXT || '-' ||
         RIGHT(EXTRACT(YEAR FROM p_date)::INT::TEXT, 2)
  END;

  INSERT INTO receipt_counters (scope, last_no)
  VALUES (v_scope, 0)
  ON CONFLICT (scope) DO NOTHING;

  UPDATE receipt_counters
  SET last_no = last_no + 1, updated_at = NOW()
  WHERE scope = v_scope
  RETURNING last_no INTO v_no;

  RETURN 'RCPT-' || v_scope || '-' || lpad(v_no::TEXT, 4, '0');
END;
$$;

-- ── 4. process_family_payment() — ATOMIC sibling counter payment ──
-- One RPC call = one receipt = N child transactions, committed together.
-- Mirrors every validation of process_payment, extended to N children.
--
-- p_payments shape:
--   [{ "student_id": "<uuid>",
--      "amount": 1500,
--      "allocations": [{ "due_id": "<uuid>", "amount_allocated": 1500 }] }]
--
-- Idempotent replay: same p_idempotency_key returns the original result.
CREATE OR REPLACE FUNCTION process_family_payment(
  p_payments        JSONB,
  p_payment_method  TEXT,
  p_reference_id    TEXT DEFAULT NULL,
  p_comment         TEXT DEFAULT NULL,
  p_date            DATE DEFAULT CURRENT_DATE,
  p_collected_by    TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id     UUID := gen_random_uuid();
  v_receipt_no     TEXT;
  v_family_id      UUID;
  v_student_ids    UUID[];
  v_total          NUMERIC := 0;
  v_child          RECORD;
  v_alloc          RECORD;
  v_due            RECORD;
  v_due_balance    NUMERIC;
  v_new_paid       NUMERIC;
  v_new_status     TEXT;
  v_total_alloc    NUMERIC;
  v_tx_id          UUID;
  v_tx_ids         JSONB := '[]'::jsonb;
  v_cleared        JSONB := '[]'::jsonb;
  v_existing       JSON;
BEGIN
  -- ── Validations ──────────────────────────────────────────
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'No children in payment';
  END IF;

  IF p_payment_method NOT IN ('cash', 'online', 'razorpay') THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT json_build_object(
      'receipt_id',   r.id,
      'receipt_no',   r.receipt_no,
      'amount',       r.amount,
      'cleared_dues', COALESCE((
        SELECT json_agg(json_build_object(
          'student_id',       t.student_id,
          'transaction_id',   t.id,
          'due_id',           ta.fee_due_id,
          'amount_allocated', ta.amount_applied,
          'fee_name',         fs.name,
          'due_date',         d.due_date,
          'due_type',         d.due_type,
          'original_amount',  d.original_amount,
          'discount_amount',  d.discount_amount,
          'discount_details', d.discount_details,
          'paid_amount',      d.paid_amount
        ))
        FROM transactions t
        JOIN transaction_allocations ta ON ta.transaction_id = t.id
        JOIN dues d  ON d.id = ta.fee_due_id
        JOIN student_fee_assignments sfa ON d.student_fee_assignment_id = sfa.id
        JOIN fee_structures fs ON sfa.fee_structure_id = fs.id
        WHERE t.receipt_id = r.id
      ), '[]'::json)
    )
    INTO v_existing
    FROM receipts r
    WHERE r.idempotency_key = p_idempotency_key;

    IF FOUND AND v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT array_agg(DISTINCT (elem->>'student_id')::UUID)
  INTO v_student_ids
  FROM jsonb_array_elements(p_payments) elem;

  IF v_student_ids IS NULL THEN
    RAISE EXCEPTION 'No valid students in payment';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM students WHERE id = ANY(v_student_ids)) THEN
    RAISE EXCEPTION 'No student exists for this payment';
  END IF;

  -- All children that have a family must share it (blocks odd client states)
  SELECT family_id INTO v_family_id FROM students WHERE id = v_student_ids[1];
  IF v_family_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM students
    WHERE id = ANY(v_student_ids)
      AND family_id IS DISTINCT FROM v_family_id
  ) THEN
    RAISE EXCEPTION 'Students do not all belong to the same family';
  END IF;

  -- ── Lock every target due BEFORE numbering (fewer holes on failure) ──
  PERFORM 1
  FROM dues d
  WHERE d.id IN (
    SELECT (a->>'due_id')::UUID
    FROM jsonb_array_elements(p_payments) elem,
         jsonb_array_elements(elem->'allocations') a
  )
  FOR UPDATE;

  -- ── Allocate receipt number + insert receipt ─────────────
  v_receipt_no := next_receipt_number(p_date);

  INSERT INTO receipts
    (id, receipt_no, student_id, family_id, amount, payment_method,
     reference_id, comment, date, collected_by, idempotency_key)
  VALUES
    (v_receipt_id,
     v_receipt_no,
     CASE WHEN jsonb_array_length(p_payments) = 1 THEN v_student_ids[1] END,
     CASE WHEN jsonb_array_length(p_payments) > 1 THEN v_family_id END,
     1, -- placeholder, updated below once totals are known
     p_payment_method, p_reference_id, p_comment, p_date,
     p_collected_by, p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Lost the race on the same key — return the winner's result
  IF NOT FOUND AND p_idempotency_key IS NOT NULL THEN
    SELECT json_build_object(
      'receipt_id',   r.id,
      'receipt_no',   r.receipt_no,
      'amount',       r.amount,
      'cleared_dues', '[]'::json
    )
    INTO v_existing
    FROM receipts r
    WHERE r.idempotency_key = p_idempotency_key;
    RETURN v_existing;
  END IF;

  -- ── Process each child ───────────────────────────────────
  FOR v_child IN SELECT * FROM jsonb_to_recordset(p_payments)
    AS x(student_id UUID, amount NUMERIC, allocations JSONB)
  LOOP
    IF v_child.amount IS NULL OR v_child.amount <= 0 THEN
      RAISE EXCEPTION 'Amount must be greater than 0 for student %', v_child.student_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM students WHERE id = v_child.student_id) THEN
      RAISE EXCEPTION 'Student % does not exist', v_child.student_id;
    END IF;

    IF v_child.allocations IS NULL OR jsonb_array_length(v_child.allocations) = 0 THEN
      RAISE EXCEPTION 'No dues selected for student %', v_child.student_id;
    END IF;

    SELECT COALESCE(SUM((a->>'amount_allocated')::NUMERIC), 0)
    INTO v_total_alloc
    FROM jsonb_array_elements(v_child.allocations) a;

    IF abs(v_total_alloc - v_child.amount) > 0.01 THEN
      RAISE EXCEPTION 'Allocated (%) does not match amount (%) for student %',
        v_total_alloc, v_child.amount, v_child.student_id;
    END IF;

    v_tx_id := gen_random_uuid();

    INSERT INTO transactions
      (id, student_id, amount, payment_method, reference_id, comment, date, idempotency_key, receipt_id)
    VALUES
      (v_tx_id, v_child.student_id, v_child.amount, p_payment_method,
       p_reference_id, p_comment, p_date, NULL, v_receipt_id);

    v_tx_ids := v_tx_ids || to_jsonb(v_tx_id);
    v_total  := v_total + v_child.amount;

    FOR v_alloc IN SELECT * FROM jsonb_to_recordset(v_child.allocations)
      AS y(due_id UUID, amount_allocated NUMERIC)
    LOOP
      CONTINUE WHEN v_alloc.amount_allocated <= 0;

      SELECT d.id, d.amount, d.paid_amount, d.status,
             fs.name AS fee_name, d.due_date, d.due_type,
             d.original_amount, d.discount_amount, d.discount_details
      INTO v_due
      FROM dues d
      JOIN student_fee_assignments sfa ON d.student_fee_assignment_id = sfa.id
      JOIN fee_structures fs ON sfa.fee_structure_id = fs.id
      WHERE d.id = v_alloc.due_id
        AND d.student_id = v_child.student_id
        AND d.is_waived = false;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Due % not found or does not belong to student %',
          v_alloc.due_id, v_child.student_id;
      END IF;

      IF v_due.status = 'paid' THEN
        RAISE EXCEPTION 'Due % is already fully paid', v_alloc.due_id;
      END IF;

      v_due_balance := v_due.amount - v_due.paid_amount;

      IF v_alloc.amount_allocated > v_due_balance + 0.01 THEN
        RAISE EXCEPTION 'Cannot allocate % to due "%". Remaining balance is only %',
          v_alloc.amount_allocated, v_due.fee_name, v_due_balance;
      END IF;

      v_new_paid   := v_due.paid_amount + v_alloc.amount_allocated;
      v_new_status := CASE WHEN (v_due.amount - v_new_paid) < 0.01 THEN 'paid' ELSE 'partial' END;

      UPDATE dues SET paid_amount = v_new_paid, status = v_new_status WHERE id = v_due.id;

      INSERT INTO transaction_allocations (id, transaction_id, fee_due_id, amount_applied)
      VALUES (gen_random_uuid(), v_tx_id, v_due.id, v_alloc.amount_allocated);

      v_cleared := v_cleared || jsonb_build_object(
        'student_id',       v_child.student_id,
        'transaction_id',   v_tx_id,
        'due_id',           v_due.id,
        'amount_allocated', v_alloc.amount_allocated,
        'fee_name',         v_due.fee_name,
        'due_date',         v_due.due_date,
        'due_type',         v_due.due_type,
        'original_amount',  v_due.original_amount,
        'discount_amount',  COALESCE(v_due.discount_amount, 0),
        'discount_details', COALESCE(v_due.discount_details, '[]'::jsonb),
        'previous_paid',    v_due.paid_amount
      );
    END LOOP;
  END LOOP;

  UPDATE receipts SET amount = v_total WHERE id = v_receipt_id;

  RETURN json_build_object(
    'receipt_id',   v_receipt_id,
    'receipt_no',   v_receipt_no,
    'amount',       v_total,
    'transaction_ids', v_tx_ids,
    'cleared_dues', v_cleared
  );
END;
$$;

-- ── 5. Grants ─────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION link_siblings(UUID[], TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION link_siblings(UUID[], TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION link_siblings(UUID[], TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION unlink_sibling(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION unlink_sibling(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION unlink_sibling(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_siblings(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_siblings(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION get_siblings(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION next_receipt_number(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION next_receipt_number(DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION next_receipt_number(DATE) TO authenticated;

REVOKE EXECUTE ON FUNCTION process_family_payment(JSONB, TEXT, TEXT, TEXT, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_family_payment(JSONB, TEXT, TEXT, TEXT, DATE, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION process_family_payment(JSONB, TEXT, TEXT, TEXT, DATE, TEXT, TEXT) TO authenticated;
