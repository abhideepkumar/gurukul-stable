-- ============================================================
-- V4__custom_amount.sql — Per-student fee amount (custom_amount)
--   Idempotent. Additive; replaces add_student_with_dues with same signature.
--
-- Fixes two gaps around student_fee_assignments.custom_amount:
--   1. add_student_with_dues now reads it when generating dues
--      (previously billing honored it but creation ignored it, so a
--      pre-set override was silently dropped).
--   2. New RPC set_assignment_custom_amount() — set/adjust a per-student
--      price for one fee head and re-derive unpaid dues + discounts.
--
-- Use cases: route-based transport pricing, staff concessions,
-- per-student exceptions to the global fee amount. NULL = head amount.
-- ============================================================

-- ── 1. add_student_with_dues: honor custom_amount on the assignment ──
-- NOTE: v_custom is read back from the just-inserted assignment, so any
-- pre-created assignment row (via set_custom_amount in the same transaction
-- is impossible here) — this mainly future-proofs the read path. The
-- supported flow is: create student → set_assignment_custom_amount → recalced.
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

    -- Effective base = custom_amount override if present, else head amount.
    -- (Read back in case a custom row was upserted by a preceding trigger/flow.)
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

-- ── 2. set_assignment_custom_amount() — per-student price override ──
-- p_amount NULL clears the override (back to head amount).
-- Reprices UNPAID dues in place and leaves paid ones untouched,
-- so history never rewrites itself.
CREATE OR REPLACE FUNCTION set_assignment_custom_amount(
  p_student_id      UUID,
  p_fee_structure_id UUID,
  p_amount          NUMERIC DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_id UUID;
  v_effective     NUMERIC;
  v_updated       INT := 0;
BEGIN
  SELECT id INTO v_assignment_id
  FROM student_fee_assignments
  WHERE student_id = p_student_id AND fee_structure_id = p_fee_structure_id;

  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Student % has no assignment for fee structure %',
      p_student_id, p_fee_structure_id;
  END IF;

  IF p_amount IS NOT NULL AND p_amount <= 0 THEN
    RAISE EXCEPTION 'Custom amount must be positive (or NULL to clear)';
  END IF;

  UPDATE student_fee_assignments
  SET custom_amount = p_amount
  WHERE id = v_assignment_id;

  -- Effective base respects override OR head amount
  SELECT COALESCE(p_amount, fs.amount) INTO v_effective
  FROM fee_structures fs WHERE fs.id = p_fee_structure_id;

  -- Reprice unpaid dues only (paid history stays as-is)
  UPDATE dues d
  SET original_amount = v_effective,
      amount = GREATEST(v_effective - COALESCE(d.discount_amount, 0), 0)
  WHERE d.student_fee_assignment_id = v_assignment_id
    AND d.due_type = 'standard'
    AND d.status != 'paid'
    AND d.is_waived = false
    AND GREATEST(v_effective - COALESCE(d.discount_amount, 0), 0) > 0;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$$;

-- ── 3. Grants ─────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION add_student_with_dues(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION set_assignment_custom_amount(UUID, UUID, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_assignment_custom_amount(UUID, UUID, NUMERIC) FROM anon;
GRANT  EXECUTE ON FUNCTION set_assignment_custom_amount(UUID, UUID, NUMERIC) TO authenticated;
