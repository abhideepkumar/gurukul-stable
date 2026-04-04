-- ============================================================
-- GURUKUL: RLS Policy Migration
-- Run this in your Supabase SQL Editor to switch from
-- anon → authenticated policies.
--
-- 1. Drops all existing anon policies
-- 2. Creates new authenticated policies
-- ============================================================

-- ─── Drop old anon policies ────────────────────────────────

-- Classes
DROP POLICY IF EXISTS "anon can select classes" ON classes;
DROP POLICY IF EXISTS "anon can insert classes" ON classes;
DROP POLICY IF EXISTS "anon can delete classes" ON classes;

-- Fee Structures
DROP POLICY IF EXISTS "anon can select fee_structures" ON fee_structures;
DROP POLICY IF EXISTS "anon can insert fee_structures" ON fee_structures;
DROP POLICY IF EXISTS "anon can delete fee_structures" ON fee_structures;

-- Class Fee Defaults
DROP POLICY IF EXISTS "anon can select class_fee_defaults" ON class_fee_defaults;
DROP POLICY IF EXISTS "anon can insert class_fee_defaults" ON class_fee_defaults;
DROP POLICY IF EXISTS "anon can delete class_fee_defaults" ON class_fee_defaults;

-- Students
DROP POLICY IF EXISTS "anon can select students" ON students;
DROP POLICY IF EXISTS "anon can update students" ON students;
DROP POLICY IF EXISTS "anon can delete students" ON students;

-- Read-only tables
DROP POLICY IF EXISTS "anon can select student_fee_assignments" ON student_fee_assignments;
DROP POLICY IF EXISTS "anon can select dues" ON dues;
DROP POLICY IF EXISTS "anon can select transactions" ON transactions;
DROP POLICY IF EXISTS "anon can select transaction_allocations" ON transaction_allocations;
DROP POLICY IF EXISTS "anon can select payment_intents" ON payment_intents;
DROP POLICY IF EXISTS "anon can insert payment_intents" ON payment_intents;
DROP POLICY IF EXISTS "anon can update payment_intents" ON payment_intents;


-- ─── Create authenticated policies ─────────────────────────

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

-- Students
CREATE POLICY "auth can select students" ON students FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can update students" ON students FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth can delete students" ON students FOR DELETE TO authenticated USING (true);

-- Read-only tables (inserts/updates managed by SECURITY DEFINER RPCs)
CREATE POLICY "auth can select student_fee_assignments" ON student_fee_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can select dues"                    ON dues                    FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can select transactions"            ON transactions            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can select transaction_allocations" ON transaction_allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can select payment_intents"         ON payment_intents         FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can insert payment_intents"         ON payment_intents         FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth can update payment_intents"         ON payment_intents         FOR UPDATE TO authenticated USING (true);
