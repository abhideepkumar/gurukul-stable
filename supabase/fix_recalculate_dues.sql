-- ============================================================
-- FIX: Recalculate dues when discounts change
-- Run this in the Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION recalculate_student_dues(p_student_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due           RECORD;
  v_base_amount   NUMERIC;
  v_discount_total NUMERIC;
  v_net_amount    NUMERIC;
  v_discount_details JSONB;
  d_rec           RECORD;
  v_disc_calc     NUMERIC;
  v_updated_count INTEGER := 0;
BEGIN
  -- Validate student exists
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student % does not exist', p_student_id;
  END IF;

  -- Loop through all unpaid/partial STANDARD dues for this student
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
    -- Recalculate discount for this due
    v_base_amount := v_due.base_amount;
    v_discount_total := 0;
    v_discount_details := '[]'::jsonb;
    v_net_amount := v_base_amount;

    -- Fetch currently active discounts for this student + fee
    FOR d_rec IN
      SELECT d.name, d.discount_type, d.value, d.max_discount_amount, d.is_exclusive, d.priority
      FROM student_discounts sd
      JOIN discounts d ON sd.discount_id = d.id
      WHERE sd.student_id = p_student_id
        AND (sd.fee_structure_id IS NULL OR sd.fee_structure_id = v_due.fee_structure_id)
        AND sd.is_active = true
        AND d.is_active = true
        AND sd.effective_from <= v_due.due_date
        AND (sd.effective_until IS NULL OR sd.effective_until >= v_due.due_date)
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
        EXIT; -- exclusive: stop
      END IF;

      -- Non-exclusive: apply in priority order
      IF d_rec.discount_type = 'percentage' THEN
        v_disc_calc := v_net_amount * d_rec.value / 100;
        IF d_rec.max_discount_amount IS NOT NULL THEN
          v_disc_calc := LEAST(v_disc_calc, d_rec.max_discount_amount);
        END IF;
      ELSE
        v_disc_calc := LEAST(d_rec.value, v_net_amount);
      END IF;
      v_disc_calc := LEAST(v_disc_calc, v_net_amount);
      v_discount_total := v_discount_total + v_disc_calc;
      v_net_amount := v_net_amount - v_disc_calc;
      v_discount_details := v_discount_details || jsonb_build_array(jsonb_build_object(
        'name', d_rec.name, 'type', d_rec.discount_type,
        'value', d_rec.value, 'calculated', v_disc_calc
      ));
    END LOOP;

    -- Ensure net_amount doesn't go below what's already been paid
    IF v_net_amount < v_due.paid_amount THEN
      v_net_amount := v_due.paid_amount;
      v_discount_total := v_base_amount - v_net_amount;
    END IF;

    -- Update the due record
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
