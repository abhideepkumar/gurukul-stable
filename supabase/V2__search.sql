-- ============================================================
-- V2__search.sql  —  Robust search (name / phone / parent / admission no)
-- Idempotent: safe to re-run. Additive only.
--
-- What it does:
--   1. Adds students.admission_no (school's admission register number)
--   2. Adds students.phone_normalized (digits-only copy for reliable phone search)
--   3. Enables pg_trgm for fuzzy name/parent matching
--   4. Adds trigram GIN indexes + a partial dues index for the summary view
--   5. Adds search_students() RPC — ranked server-side search
--
-- Backfill: phone_normalized is filled for ALL existing rows here.
--           admission_no is NOT backfilled (unknown); fill from registers.
--           A trigger keeps phone_normalized correct for future edits.
-- ============================================================

-- ── 1. Columns (nullable → existing rows unaffected) ─────────
ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_no      TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS phone_normalized  TEXT;

-- ── 2. Extensions (already available on Supabase; no-op if present) ──
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ── 3. Backfill normalized phone (digits only, last 10 for +91 handling) ──
UPDATE students
SET phone_normalized = RIGHT(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10)
WHERE phone_normalized IS NULL AND phone IS NOT NULL;

-- ── 4. Trigger: keep phone_normalized in sync on insert/update ──
CREATE OR REPLACE FUNCTION sync_phone_normalized()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone_normalized := RIGHT(regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g'), 10);
  IF NEW.phone_normalized = '' THEN
    NEW.phone_normalized := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_phone_normalized ON students;
CREATE TRIGGER trg_sync_phone_normalized
  BEFORE INSERT OR UPDATE OF phone ON students
  FOR EACH ROW
  EXECUTE FUNCTION sync_phone_normalized();

-- ── 5. Indexes ────────────────────────────────────────────────
-- Trigram indexes drive ILIKE '%…%' without full scans.
CREATE INDEX IF NOT EXISTS idx_students_name_trgm
  ON students USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_students_parent_trgm
  ON students USING gin (parent_name gin_trgm_ops);

-- Exact-match fast paths
CREATE INDEX IF NOT EXISTS idx_students_phone_norm
  ON students (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_students_admission
  ON students (admission_no)
  WHERE admission_no IS NOT NULL;

-- The student_summary view aggregates (student_id, due_date) for every
-- student row on every list load; without this it seq-scans all dues.
-- Partial index: unpaid dues are the only ones the sums care about.
CREATE INDEX IF NOT EXISTS idx_dues_unpaid_student_date
  ON dues (student_id, due_date)
  WHERE status != 'paid';

-- ── 6. Duplicate lookup helper (admission number + soft-dup warning) ──
CREATE OR REPLACE FUNCTION check_student_duplicate(
  p_name      TEXT,
  p_class_id  UUID DEFAULT NULL,
  p_phone     TEXT DEFAULT NULL,
  p_exclude   UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'admission_no_taken',
      EXISTS (
        SELECT 1 FROM students
        WHERE p_name ~ '^[0-9]+$' AND admission_no = p_name
          AND (p_exclude IS NULL OR id != p_exclude)
      ),
    'similar',
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', s.id, 'name', s.name, 'class_name', c.name,
          'parent_name', s.parent_name, 'phone', s.phone
        ))
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE (p_exclude IS NULL OR s.id != p_exclude)
          AND s.name ILIKE p_name
          AND (p_class_id IS NULL OR s.class_id = p_class_id)
          AND (p_phone IS NULL
               OR s.phone_normalized = RIGHT(regexp_replace(COALESCE(p_phone,''), '\D', '', 'g'), 10))
        LIMIT 5
      ), '[]'::json)
  );
$$;

-- ── 7. search_students() — ranked server-side search ─────────
-- Ranks: exact phone/admission (0) → exact name (1) → prefix (2)
--        → substring (3) → fuzzy similarity ≥ 0.3 (4).
-- No LIKE-validation needed (unlike PostgREST .or() strings) — this is
-- why the client can pass raw user input safely.
CREATE OR REPLACE FUNCTION search_students(
  p_query TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE(
  id              UUID,
  name            TEXT,
  class_name      TEXT,
  section         TEXT,
  parent_name     TEXT,
  phone           TEXT,
  admission_no    TEXT,
  pending_amount  NUMERIC,
  overdue_amount  NUMERIC,
  current_month_due NUMERIC,
  matched_on      TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits TEXT;
  v_q      TEXT := NULLIF(trim(COALESCE(p_query, '')), '');
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  IF v_q IS NULL OR length(v_q) < 2 THEN
    RETURN;
  END IF;

  v_digits := RIGHT(regexp_replace(v_q, '\D', '', 'g'), 10);

  RETURN QUERY
  WITH scored AS (
    SELECT
      s.id, s.name, c.name AS class_name, s.section,
      s.parent_name, s.phone, s.admission_no,
      ss.pending_amount, ss.overdue_amount, ss.current_month_due,
      CASE
        WHEN v_digits <> '' AND s.phone_normalized = v_digits        THEN 0
        WHEN v_digits <> '' AND s.admission_no    = v_digits         THEN 0
        WHEN lower(s.name) = lower(v_q)                              THEN 1
        WHEN s.name ILIKE v_q || '%'                                 THEN 2
        WHEN s.name ILIKE '%' || v_q || '%'                          THEN 3
        WHEN s.parent_name ILIKE v_q || '%'                          THEN 3
        WHEN v_digits <> '' AND s.phone ILIKE '%' || v_digits || '%' THEN 3
        WHEN s.name % v_q OR s.parent_name % v_q                     THEN 4
        ELSE 5
      END AS rank
    FROM students s
    JOIN classes c        ON c.id = s.class_id
    JOIN student_summary ss ON ss.id = s.id
    WHERE
      s.name ILIKE '%' || v_q || '%'
      OR s.parent_name ILIKE '%' || v_q || '%'
      OR (v_digits <> '' AND s.phone ILIKE '%' || v_digits || '%')
      OR (v_digits <> '' AND s.admission_no = v_digits)
      OR s.name % v_q
      OR s.parent_name % v_q
  )
  SELECT
    sc.id, sc.name, sc.class_name, sc.section,
    sc.parent_name, sc.phone, sc.admission_no,
    COALESCE(sc.pending_amount, 0),
    COALESCE(sc.overdue_amount, 0),
    COALESCE(sc.current_month_due, 0),
    CASE sc.rank
      WHEN 0 THEN 'phone/admission'
      WHEN 1 THEN 'name exact'
      WHEN 2 THEN 'name prefix'
      WHEN 3 THEN 'partial'
      ELSE 'fuzzy'
    END
  FROM scored sc
  WHERE sc.rank < 5
  ORDER BY sc.rank, sc.name
  LIMIT v_limit;
END;
$$;

-- ── 8. Grants (match existing RPC security pattern) ──────────
REVOKE EXECUTE ON FUNCTION search_students(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION search_students(TEXT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION search_students(TEXT, INT) TO authenticated;

REVOKE EXECUTE ON FUNCTION check_student_duplicate(TEXT, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION check_student_duplicate(TEXT, UUID, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION check_student_duplicate(TEXT, UUID, TEXT, UUID) TO authenticated;
