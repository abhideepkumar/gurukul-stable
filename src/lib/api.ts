import { supabase } from './supabase';
import { format, startOfMonth, endOfMonth } from 'date-fns';

// ─── Error helper ────────────────────────────────────────────
function throwOnError<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// ─── Types ───────────────────────────────────────────────────
export interface PaymentAllocation {
  due_id: string;
  amount_allocated: number;
}

// ─── Classes ─────────────────────────────────────────────────
async function getClasses() {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .order('name', { ascending: true });
  return throwOnError(data, error);
}

async function addClass(payload: { name: string }) {
  const { data, error } = await supabase
    .from('classes')
    .insert({ name: payload.name })
    .select()
    .single();
  return throwOnError(data, error);
}

async function getClassDefaults(classId: string) {
  const { data, error } = await supabase
    .from('class_fee_defaults')
    .select('*, fee_structures(id, name, amount, frequency)')
    .eq('class_id', classId);
  // Flatten to match old API shape: { id, class_id, fee_structure_id, name, amount, frequency }
  const flat = (data ?? []).map((row: any) => ({
    id: row.id,
    class_id: row.class_id,
    fee_structure_id: row.fee_structure_id,
    name: row.fee_structures?.name,
    amount: row.fee_structures?.amount,
    frequency: row.fee_structures?.frequency,
  }));
  if (error) throw new Error(error.message);
  return flat;
}

async function addClassDefault(classId: string, feeStructureId: string) {
  const { error } = await supabase
    .from('class_fee_defaults')
    .insert({ class_id: classId, fee_structure_id: feeStructureId });
  if (error) throw new Error(error.message);
  return { success: true };
}

async function removeClassDefault(classId: string, feeStructureId: string) {
  const { error } = await supabase
    .from('class_fee_defaults')
    .delete()
    .eq('class_id', classId)
    .eq('fee_structure_id', feeStructureId);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ─── Fee Structures ───────────────────────────────────────────
async function getFeeStructures() {
  const { data, error } = await supabase
    .from('fee_structures')
    .select('*')
    .order('name', { ascending: true });
  return throwOnError(data, error);
}

async function addFeeStructure(payload: { name: string; amount: number; frequency: string }) {
  const { data, error } = await supabase
    .from('fee_structures')
    .insert(payload)
    .select()
    .single();
  return throwOnError(data, error);
}

async function deleteFeeStructure(id: string) {
  const { error } = await supabase.from('fee_structures').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ─── Students ────────────────────────────────────────────────
async function getStudents(search?: string, classId?: string) {
  const currentMonthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const currentMonthEnd   = format(endOfMonth(new Date()), 'yyyy-MM-dd');

  // Fetch students with their class name
  let query = supabase
    .from('students')
    .select('*, classes(name)')
    .order('name', { ascending: true });

  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  if (classId) query = query.eq('class_id', classId);

  const { data: students, error: studentsError } = await query;
  if (studentsError) throw new Error(studentsError.message);

  // Fetch dues separately to compute aggregates
  const studentIds = (students ?? []).map((s: any) => s.id);
  if (studentIds.length === 0) return [];

  const { data: dues, error: duesError } = await supabase
    .from('dues')
    .select('student_id, amount, paid_amount, due_date, status')
    .in('student_id', studentIds);

  if (duesError) throw new Error(duesError.message);

  // Aggregate per student
  return (students ?? []).map((student: any) => {
    const studentDues = (dues ?? []).filter((d: any) => d.student_id === student.id);
    let overdue_amount = 0;
    let current_month_due = 0;
    let pending_amount = 0;

    for (const d of studentDues) {
      if (d.status === 'paid') continue;
      const balance = d.amount - d.paid_amount;
      if (d.due_date < currentMonthStart) {
        overdue_amount += balance;
      } else if (d.due_date >= currentMonthStart && d.due_date <= currentMonthEnd) {
        current_month_due += balance;
      }
      if (d.due_date <= currentMonthEnd) {
        pending_amount += balance;
      }
    }

    return {
      ...student,
      class_name: student.classes?.name,
      overdue_amount,
      current_month_due,
      pending_amount,
    };
  });
}

async function addStudent(payload: {
  name: string; class_id: string; section?: string;
  parent_name?: string; phone?: string; email?: string;
  fee_structure_ids?: string[];
}) {
  // Uses SECURITY DEFINER RPC — cannot INSERT directly to students
  const { data, error } = await supabase.rpc('add_student_with_dues', {
    p_name:              payload.name,
    p_class_id:          payload.class_id,
    p_fee_structure_ids: payload.fee_structure_ids || null,
    p_section:           payload.section     || null,
    p_parent_name:       payload.parent_name || null,
    p_phone:             payload.phone       || null,
    p_email:             payload.email       || null,
  });
  return throwOnError(data, error);
}

async function updateStudent(id: string, payload: {
  name: string; class_id: string; section?: string;
  parent_name?: string; phone?: string; email?: string;
}) {
  const { error } = await supabase
    .from('students')
    .update({
      name:        payload.name,
      class_id:    payload.class_id,
      section:     payload.section     || null,
      parent_name: payload.parent_name || null,
      phone:       payload.phone       || null,
      email:       payload.email       || null,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

async function deleteStudent(id: string) {
  const { error } = await supabase.from('students').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

async function getStudentDues(studentId: string) {
  const { data, error } = await supabase
    .from('dues')
    .select(`
      id, amount, paid_amount, due_date, status,
      student_fee_assignments!inner(
        fee_structures!inner(name)
      )
    `)
    .eq('student_id', studentId)
    .order('due_date', { ascending: true });

  if (error) throw new Error(error.message);

  // Flatten fee_name to match old API shape
  return (data ?? []).map((d: any) => ({
    id:           d.id,
    amount:       d.amount,
    paid_amount:  d.paid_amount,
    due_date:     d.due_date,
    status:       d.status,
    fee_name:     d.student_fee_assignments?.fee_structures?.name,
  }));
}

// ─── Payments ─────────────────────────────────────────────────
async function processPayment(payload: {
  student_id: string;
  amount: number;
  payment_method: string;
  reference_id?: string;
  comment?: string;
  date: string;
  allocations: PaymentAllocation[];
}) {
  // Map allocations into the composite type array Postgres expects
  const allocationsArg = payload.allocations.map(a => ({
    due_id:           a.due_id,
    amount_allocated: a.amount_allocated,
  }));

  const { data, error } = await supabase.rpc('process_payment', {
    p_student_id:     payload.student_id,
    p_amount:         payload.amount,
    p_payment_method: payload.payment_method,
    p_reference_id:   payload.reference_id   || null,
    p_comment:        payload.comment         || null,
    p_date:           payload.date,
    p_allocations:    allocationsArg,
  });

  if (error) throw new Error(error.message);
  return data as { transaction_id: string; cleared_dues: any[] };
}

async function createRazorpayOrder(payload: {
  student_id: string;
  amount: number;
  allocations: PaymentAllocation[];
}) {
  const allocationsArg = payload.allocations.map(a => ({
    due_id:           a.due_id,
    amount_allocated: a.amount_allocated,
  }));

  const { data, error } = await supabase.functions.invoke('razorpay-create-order', {
    body: {
      student_id: payload.student_id,
      amount: payload.amount,
      allocations: allocationsArg,
    }
  });

  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to create Razorpay order');
  
  return data as {
    success: boolean;
    order_id: string;
    amount: number;
    currency: string;
    key_id: string;
    intent_id: string;
  };
}

async function verifyRazorpayPayment(payload: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}) {
  const { data, error } = await supabase.functions.invoke('razorpay-verify', {
    body: payload,
  });

  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Payment verification failed');
  
  return data as {
    success: boolean;
    transaction_id: string;
    cleared_dues: any[];
  };
}

// ─── Dashboard ────────────────────────────────────────────────
async function getDashboard() {
  const currentMonthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const currentMonthEnd   = format(endOfMonth(new Date()), 'yyyy-MM-dd');

  const [studentsRes, txRes, currentDuesRes, overdueDuesRes] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact', head: true }),
    supabase.from('transactions')
      .select('amount')
      .gte('date', currentMonthStart)
      .lte('date', currentMonthEnd),
    supabase.from('dues')
      .select('amount')
      .gte('due_date', currentMonthStart)
      .lte('due_date', currentMonthEnd),
    supabase.from('dues')
      .select('amount, paid_amount')
      .lt('due_date', currentMonthStart)
      .neq('status', 'paid'),
  ]);

  if (studentsRes.error) throw new Error(studentsRes.error.message);
  if (txRes.error) throw new Error(txRes.error.message);
  if (currentDuesRes.error) throw new Error(currentDuesRes.error.message);
  if (overdueDuesRes.error) throw new Error(overdueDuesRes.error.message);

  const current_month_collection = (txRes.data ?? []).reduce((s: number, r: any) => s + r.amount, 0);
  const current_month_dues       = (currentDuesRes.data ?? []).reduce((s: number, r: any) => s + r.amount, 0);
  const total_overdue            = (overdueDuesRes.data ?? []).reduce((s: number, r: any) => s + (r.amount - r.paid_amount), 0);

  return {
    total_students:           studentsRes.count ?? 0,
    current_month_collection,
    current_month_dues,
    total_overdue,
  };
}

// ─── Reports ──────────────────────────────────────────────────
async function getDefaulters() {
  const currentMonthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from('dues')
    .select(`
      student_id, amount, paid_amount,
      students!inner(id, name, phone, classes!inner(name))
    `)
    .lt('due_date', currentMonthStart)
    .neq('status', 'paid');

  if (error) throw new Error(error.message);

  // Aggregate pending amounts per student
  const map = new Map<string, any>();
  for (const row of data ?? []) {
    const s = (row as any).students;
    const existing = map.get(s.id) ?? {
      id: s.id,
      name: s.name,
      phone: s.phone,
      class_name: s.classes?.name,
      pending_amount: 0,
    };
    existing.pending_amount += row.amount - row.paid_amount;
    map.set(s.id, existing);
  }

  return Array.from(map.values())
    .filter(s => s.pending_amount > 0)
    .sort((a, b) => b.pending_amount - a.pending_amount);
}

async function getTransactions(startDate?: string, endDate?: string) {
  let query = supabase
    .from('transactions')
    .select(`
      *, students!inner(name, classes!inner(name))
    `)
    .order('date', { ascending: false });

  if (startDate && endDate) {
    query = query.gte('date', startDate).lte('date', endDate);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((t: any) => ({
    ...t,
    student_name: t.students?.name,
    class_name:   t.students?.classes?.name,
  }));
}

// ─── Exported API object ──────────────────────────────────────
export const api = {
  // Classes
  getClasses,
  addClass,
  getClassDefaults,
  addClassDefault,
  removeClassDefault,

  // Fee Structures
  getFeeStructures,
  addFeeStructure,
  deleteFeeStructure,

  // Students
  getStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  getStudentDues,

  // Payments
  processPayment,
  createRazorpayOrder,
  verifyRazorpayPayment,

  // Dashboard & Reports
  getDashboard,
  getDefaulters,
  getTransactions,
};
