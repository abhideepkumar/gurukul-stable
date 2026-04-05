-- ============================================================
-- GURUKUL: Billing Enhancements (Custom Bills & Old Dues)
-- Run this in Supabase SQL Editor
-- ============================================================

-- Function to dynamically create a custom bill (or old due)
-- It safely creates/reuses a fee structure and inserts the due.
CREATE OR REPLACE FUNCTION add_custom_due(
  p_student_id UUID,
  p_amount NUMERIC,
  p_title TEXT,
  p_due_date DATE,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee_structure_id UUID;
  v_assignment_id UUID;
  v_due_id UUID;
BEGIN
  -- 1. Validate student
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

  -- 2. Find or create the Fee Structure for this title
  SELECT id INTO v_fee_structure_id 
  FROM fee_structures 
  WHERE lower(name) = lower(p_title) 
  LIMIT 1;

  IF v_fee_structure_id IS NULL THEN
    v_fee_structure_id := gen_random_uuid();
    INSERT INTO fee_structures (id, name, amount, frequency, fee_category, is_optional, applies_late_fee)
    VALUES (v_fee_structure_id, p_title, p_amount, 'one_time', 'other', true, false);
  END IF;

  -- 3. Find or create the Student Fee Assignment
  SELECT id INTO v_assignment_id
  FROM student_fee_assignments
  WHERE student_id = p_student_id AND fee_structure_id = v_fee_structure_id
  LIMIT 1;

  IF v_assignment_id IS NULL THEN
    v_assignment_id := gen_random_uuid();
    INSERT INTO student_fee_assignments (id, student_id, fee_structure_id, start_date, end_date)
    VALUES (v_assignment_id, p_student_id, v_fee_structure_id, p_due_date, p_due_date);
  END IF;

  -- 4. Insert or Update the Due
  -- If a due with the exact same title & date exists for this student, sum the amounts.
  INSERT INTO dues (id, student_id, student_fee_assignment_id, amount, original_amount, due_date, due_type)
  VALUES (gen_random_uuid(), p_student_id, v_assignment_id, p_amount, p_amount, p_due_date, 'standard')
  ON CONFLICT (student_id, student_fee_assignment_id, due_date) 
  DO UPDATE SET 
    amount = dues.amount + EXCLUDED.amount,
    original_amount = dues.original_amount + EXCLUDED.original_amount
  RETURNING id INTO v_due_id;

  RETURN v_due_id;
END;
$$;


-- Lock down RPC to authenticated users
REVOKE EXECUTE ON FUNCTION add_custom_due(UUID, NUMERIC, TEXT, DATE, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION add_custom_due(UUID, NUMERIC, TEXT, DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION add_custom_due(UUID, NUMERIC, TEXT, DATE, TEXT) TO authenticated;
