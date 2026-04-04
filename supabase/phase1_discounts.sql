-- ============================================================
-- PHASE 1 MIGRATION: Discounts System
-- Run this in the Supabase SQL Editor
-- ============================================================


-- ============================================================
-- 1. ALTER EXISTING TABLES
-- ============================================================

-- fee_structures: add category and opt-in metadata
ALTER TABLE fee_structures 
  ADD COLUMN IF NOT EXISTS fee_category TEXT DEFAULT 'tuition' 
    CHECK (fee_category IN ('tuition','transport','lab','library','exam','activity','admission','deposit','other')),
  ADD COLUMN IF NOT EXISTS is_optional BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS applies_late_fee BOOLEAN DEFAULT true;

-- fee_structures: allow 'one_time' frequency
ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_frequency_check;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_frequency_check 
  CHECK (frequency IN ('monthly', 'quarterly', 'yearly', 'one_time'));

-- student_fee_assignments: per-student amount override + soft disable
ALTER TABLE student_fee_assignments
  ADD COLUMN IF NOT EXISTS custom_amount NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- dues: discount tracking and due_type for future late fees
ALTER TABLE dues
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_details JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS due_type TEXT DEFAULT 'standard' 
    CHECK (due_type IN ('standard', 'late_fee')),
  ADD COLUMN IF NOT EXISTS parent_due_id UUID NULL REFERENCES dues(id),
  ADD COLUMN IF NOT EXISTS is_waived BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS waived_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS waived_reason TEXT NULL;

-- Backfill: set original_amount = amount for all existing dues
UPDATE dues SET original_amount = amount WHERE original_amount IS NULL;


-- ============================================================
-- 2. CREATE NEW TABLES
-- ============================================================

-- Discount catalog: defines available discount types
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

-- Links students to active discounts for specific (or all) fee structures
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


-- ============================================================
-- 3. ROW LEVEL SECURITY FOR NEW TABLES
-- ============================================================

ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_discounts ENABLE ROW LEVEL SECURITY;

-- Drop old anon policies if they exist (in case migration was already run)
DROP POLICY IF EXISTS "anon can select discounts" ON discounts;
DROP POLICY IF EXISTS "anon can insert discounts" ON discounts;
DROP POLICY IF EXISTS "anon can update discounts" ON discounts;
DROP POLICY IF EXISTS "anon can delete discounts" ON discounts;
DROP POLICY IF EXISTS "anon can select student_discounts" ON student_discounts;
DROP POLICY IF EXISTS "anon can insert student_discounts" ON student_discounts;
DROP POLICY IF EXISTS "anon can update student_discounts" ON student_discounts;
DROP POLICY IF EXISTS "anon can delete student_discounts" ON student_discounts;

-- Authenticated policies (matching existing app auth setup)
CREATE POLICY "auth can select discounts" ON discounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert discounts" ON discounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can update discounts" ON discounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth can delete discounts" ON discounts FOR DELETE TO authenticated USING (true);

CREATE POLICY "auth can select student_discounts" ON student_discounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert student_discounts" ON student_discounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can update student_discounts" ON student_discounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth can delete student_discounts" ON student_discounts FOR DELETE TO authenticated USING (true);


-- ============================================================
-- 4. UPDATED RPC: add_student_with_dues (with discount support)
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

  -- 3. Determine which fee structures to use
  IF p_fee_structure_ids IS NOT NULL THEN
    FOR rec IN
      SELECT id AS fee_structure_id, amount, frequency
      FROM fee_structures
      WHERE id = ANY(p_fee_structure_ids)
    LOOP
      v_assignment_id := gen_random_uuid();
      INSERT INTO student_fee_assignments (id, student_id, fee_structure_id, start_date, end_date)
      VALUES (v_assignment_id, v_student_id, rec.fee_structure_id, v_start_date, v_end_date);

      -- Calculate discount for this fee
      v_base_amount := rec.amount;
      v_discount_total := 0;
      v_discount_details := '[]'::jsonb;
      v_net_amount := v_base_amount;

      -- Fetch applicable discounts for this student + fee
      FOR d_rec IN
        SELECT d.name, d.discount_type, d.value, d.max_discount_amount, d.is_exclusive, d.priority
        FROM student_discounts sd
        JOIN discounts d ON sd.discount_id = d.id
        WHERE sd.student_id = v_student_id
          AND (sd.fee_structure_id IS NULL OR sd.fee_structure_id = rec.fee_structure_id)
          AND sd.is_active = true
          AND d.is_active = true
          AND sd.effective_from <= CURRENT_DATE
          AND (sd.effective_until IS NULL OR sd.effective_until >= CURRENT_DATE)
        ORDER BY d.is_exclusive DESC, 
                 (CASE WHEN d.discount_type = 'percentage' THEN 0 ELSE 1 END),
                 d.priority ASC
      LOOP
        -- Exclusive discount: apply only this one
        IF d_rec.is_exclusive THEN
          IF d_rec.discount_type = 'percentage' THEN
            v_disc_calc := v_base_amount * d_rec.value / 100;
            IF d_rec.max_discount_amount IS NOT NULL THEN
              v_disc_calc := LEAST(v_disc_calc, d_rec.max_discount_amount);
            END IF;
          ELSE
            v_disc_calc := LEAST(d_rec.value, v_base_amount);
          END IF;
          v_discount_total := LEAST(v_disc_calc, v_base_amount);
          v_discount_details := jsonb_build_array(jsonb_build_object(
            'name', d_rec.name, 'type', d_rec.discount_type, 
            'value', d_rec.value, 'calculated', v_discount_total
          ));
          v_net_amount := GREATEST(v_base_amount - v_discount_total, 0);
          EXIT; -- exclusive: stop after this one
        END IF;

        -- Non-exclusive: apply in order
        IF d_rec.discount_type = 'percentage' THEN
          v_disc_calc := v_net_amount * d_rec.value / 100;
          IF d_rec.max_discount_amount IS NOT NULL THEN
            v_disc_calc := LEAST(v_disc_calc, d_rec.max_discount_amount);
          END IF;
        ELSE
          v_disc_calc := LEAST(d_rec.value, v_net_amount);
        END IF;
        v_disc_calc := LEAST(v_disc_calc, v_net_amount); -- floor guard
        v_discount_total := v_discount_total + v_disc_calc;
        v_net_amount := v_net_amount - v_disc_calc;
        v_discount_details := v_discount_details || jsonb_build_array(jsonb_build_object(
          'name', d_rec.name, 'type', d_rec.discount_type, 
          'value', d_rec.value, 'calculated', v_disc_calc
        ));
      END LOOP;

      -- Generate dues for the year
      v_current_date := v_start_date;
      WHILE v_current_date <= v_end_date LOOP
        -- Skip generating ₹0 dues (fully discounted like RTE)
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
  ELSE
    -- Use class defaults (same logic)
    FOR rec IN
      SELECT cfd.fee_structure_id, fs.amount, fs.frequency
      FROM class_fee_defaults cfd
      JOIN fee_structures fs ON cfd.fee_structure_id = fs.id
      WHERE cfd.class_id = p_class_id
    LOOP
      v_assignment_id := gen_random_uuid();
      INSERT INTO student_fee_assignments (id, student_id, fee_structure_id, start_date, end_date)
      VALUES (v_assignment_id, v_student_id, rec.fee_structure_id, v_start_date, v_end_date);

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
  END IF;

  RETURN v_student_id;
END;
$$;
