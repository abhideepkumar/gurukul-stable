import { supabase } from './supabase';

// ─── Error helper ────────────────────────────────────────────
function throwOnError<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// ─── Types ───────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 20;

export interface PaginatedResult<T> {
  data: T[];
  total: number;
}

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
async function getStudents(search?: string, classId?: string, page?: number, limit?: number): Promise<any[] | PaginatedResult<any>> {
  const paginated = page !== undefined && limit !== undefined;

  // Use the student_summary view to avoid N+1 queries.
  // Explicit column list (no SELECT *) + hard cap on unpaginated search.
  const cols = 'id,name,class_id,section,parent_name,phone,email,admission_no,class_name,pending_amount,current_month_due,overdue_amount';
  let query = supabase
    .from('student_summary')
    .select(cols, paginated ? { count: 'exact' } : {})
    .order('name', { ascending: true });

  if (search) {
    // Strip characters that would break PostgREST .or() filter syntax
    const safe = search.replace(/[,()]/g, ' ').trim();
    if (safe) {
      query = query.or(
        `name.ilike.%${safe}%,phone.ilike.%${safe}%,parent_name.ilike.%${safe}%,admission_no.ilike.%${safe}%`
      );
    }
  }
  if (classId) query = query.eq('class_id', classId);

  if (paginated) {
    const safeLimit = Math.min(Math.max(limit!, 1), 100);
    const from = (page! - 1) * safeLimit;
    const to   = page! * safeLimit - 1;
    query = query.range(from, to);
  } else {
    query = query.limit(20);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return paginated ? { data: data ?? [], total: count ?? 0 } : (data ?? []);
}

async function addStudent(payload: {
  name: string; class_id: string; section?: string;
  parent_name?: string; phone?: string; email?: string;
  admission_no?: string;
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
    p_admission_no:      payload.admission_no || null,
  });
  return throwOnError(data, error);
}

async function updateStudent(id: string, payload: {
  name: string; class_id: string; section?: string;
  parent_name?: string; phone?: string; email?: string;
  admission_no?: string;
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
      admission_no: payload.admission_no?.trim() || null,
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

async function bulkImportStudents(students: any[]) {
  const { data, error } = await supabase.rpc('bulk_import_students', {
    p_students: students,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function getStudentDues(studentId: string) {
  const { data, error } = await supabase
    .from('dues')
    .select(`
      id, amount, paid_amount, due_date, status,
      original_amount, discount_amount, discount_details,
      due_type, parent_due_id, is_waived, waived_reason,
      student_fee_assignments!inner(
        fee_structures!inner(name)
      )
    `)
    .eq('student_id', studentId)
    .order('due_date', { ascending: true });

  if (error) throw new Error(error.message);

  // Flatten fee_name to match old API shape
  return (data ?? []).map((d: any) => ({
    id:              d.id,
    amount:          d.amount,
    paid_amount:     d.paid_amount,
    due_date:        d.due_date,
    status:          d.status,
    fee_name:        d.student_fee_assignments?.fee_structures?.name,
    original_amount: d.original_amount,
    discount_amount: d.discount_amount ?? 0,
    discount_details: d.discount_details ?? [],
    due_type:        d.due_type ?? 'standard',
    parent_due_id:   d.parent_due_id,
    is_waived:       d.is_waived ?? false,
    waived_reason:   d.waived_reason,
  }));
}

// ─── Custom Dues ────────────────────────────────────────────────
async function addCustomDue(payload: {
  student_id: string;
  amount: number;
  title: string;
  due_date: string;
  description?: string;
}) {
  const { data, error } = await supabase.rpc('add_custom_due', {
    p_student_id: payload.student_id,
    p_amount: payload.amount,
    p_title: payload.title,
    p_due_date: payload.due_date,
    p_description: payload.description || null,
  });
  if (error) throw new Error(error.message);
  return data;
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
  idempotency_key?: string;
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
    p_idempotency_key: payload.idempotency_key || null,
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
    receipt_no?: string | null;
  };
}

// ─── Search ───────────────────────────────────────────────────
// Ranked server-side search: name / phone / parent_name / admission_no + fuzzy.
// Returns rows with a `matched_on` label so the UI can show why a row matched.
async function searchStudents(query: string, limit = 20): Promise<any[]> {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase.rpc('search_students', {
    p_query: query.trim(),
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function checkStudentDuplicate(name: string, classId?: string, phone?: string, excludeId?: string) {
  const { data, error } = await supabase.rpc('check_student_duplicate', {
    p_name: name,
    p_class_id: classId || null,
    p_phone: phone || null,
    p_exclude: excludeId || null,
  });
  if (error) throw new Error(error.message);
  return data as { admission_no_taken: boolean; similar: any[] };
}

// ─── Families (siblings) ──────────────────────────────────────
async function linkSiblings(studentIds: string[], name?: string, phone?: string) {
  const { data, error } = await supabase.rpc('link_siblings', {
    p_student_ids: studentIds,
    p_name: name || null,
    p_phone: phone || null,
  });
  if (error) throw new Error(error.message);
  return data as string; // family_id
}

async function unlinkSibling(studentId: string) {
  const { error } = await supabase.rpc('unlink_sibling', { p_student_id: studentId });
  if (error) throw new Error(error.message);
  return { success: true };
}

async function getSiblings(studentId: string): Promise<any[]> {
  const { data, error } = await supabase.rpc('get_siblings', { p_student_id: studentId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── Family payment (atomic, receipt-numbered) ────────────────
async function processFamilyPayment(payload: {
  payments: { student_id: string; amount: number; allocations: PaymentAllocation[] }[];
  payment_method: string;
  reference_id?: string;
  comment?: string;
  date: string;
  collected_by?: string | null;
  idempotency_key?: string;
}) {
  const { data, error } = await supabase.rpc('process_family_payment', {
    p_payments: payload.payments.map(p => ({
      student_id: p.student_id,
      amount: p.amount,
      allocations: p.allocations.map(a => ({ due_id: a.due_id, amount_allocated: a.amount_allocated })),
    })),
    p_payment_method: payload.payment_method,
    p_reference_id: payload.reference_id || null,
    p_comment: payload.comment || null,
    p_date: payload.date,
    p_collected_by: payload.collected_by || null,
    p_idempotency_key: payload.idempotency_key || null,
  });
  if (error) throw new Error(error.message);
  return data as {
    receipt_id: string;
    receipt_no: string;
    amount: number;
    transaction_ids: string[];
    cleared_dues: any[];
  };
}

// ─── Per-student fee amount override ──────────────────────────
async function setAssignmentCustomAmount(studentId: string, feeStructureId: string, amount: number | null) {
  const { data, error } = await supabase.rpc('set_assignment_custom_amount', {
    p_student_id: studentId,
    p_fee_structure_id: feeStructureId,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);
  return data as number; // count of repriced unpaid dues
}

// ─── Dashboard ────────────────────────────────────────────────
async function getDashboard() {
  const { data, error } = await supabase.rpc('get_dashboard_stats');
  if (error) throw new Error(error.message);
  return data;
}

async function getStudentTransactions(studentId: string, page?: number, limit?: number): Promise<any[] | PaginatedResult<any>> {
  const paginated = page !== undefined && limit !== undefined;
  let query = supabase
    .from('transactions')
    .select(`
      id, amount, payment_method, reference_id, comment, date,
      transaction_allocations(
        amount_applied,
        fee_due_id,
        dues(
          student_fee_assignments(fee_structures(name))
        )
      )
    `, paginated ? { count: 'exact' } : {})
    .eq('student_id', studentId)
    .order('date', { ascending: false });

  if (paginated) {
    const safeLimit = Math.min(Math.max(limit!, 1), 100);
    query = query.range((page! - 1) * safeLimit, page! * safeLimit - 1);
  } else {
    query = query.limit(50);
  }

  const { data, error, count } = await query;

  if (error) throw new Error(error.message);
  
  const mapped = (data ?? []).map((t: any) => ({
    ...t,
    allocations_details: t.transaction_allocations?.map((alloc: any) => ({
      amount: alloc.amount_applied,
      fee_name: alloc.dues?.student_fee_assignments?.fee_structures?.name || 'Unknown'
    })) || []
  }));
  return paginated ? { data: mapped, total: count ?? 0 } : mapped;
}

// ─── Reports ──────────────────────────────────────────────────
async function getDefaulters(page?: number, limit?: number, search?: string): Promise<any[] | PaginatedResult<any>> {
  // Server-paginated when page+limit given; legacy full-fetch otherwise
  if (page !== undefined && limit !== undefined) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const offset = (page - 1) * safeLimit;
    const { data, error } = await supabase.rpc('get_defaulters_report_paged', {
      p_limit: safeLimit,
      p_offset: offset,
      p_search: search || null,
    });
    if (error) throw new Error(error.message);
    return { data: (data as any)?.data ?? [], total: (data as any)?.total ?? 0 };
  }
  const { data, error } = await supabase.rpc('get_defaulters_report');
  if (error) throw new Error(error.message);
  return data;
}

async function getTransactions(startDate?: string, endDate?: string, page?: number, limit?: number): Promise<any[] | PaginatedResult<any>> {
  const paginated = page !== undefined && limit !== undefined;

  let query = supabase
    .from('transactions')
    .select(
      `*, students!inner(name, classes!inner(name))`,
      paginated ? { count: 'exact' } : {},
    )
    .order('date', { ascending: false });

  if (startDate && endDate) {
    query = query.gte('date', startDate).lte('date', endDate);
  }

  if (paginated) {
    const safeLimit = Math.min(Math.max(limit!, 1), 100);
    const from = (page! - 1) * safeLimit;
    const to   = page! * safeLimit - 1;
    query = query.range(from, to);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const mapped = (data ?? []).map((t: any) => ({
    ...t,
    student_name: t.students?.name,
    class_name:   t.students?.classes?.name,
  }));

  return paginated ? { data: mapped, total: count ?? 0 } : mapped;
}

// ─── Discounts ────────────────────────────────────────────────
async function getDiscounts() {
  const { data, error } = await supabase
    .from('discounts')
    .select('*')
    .order('priority', { ascending: true });
  return throwOnError(data, error);
}

async function addDiscount(payload: {
  name: string;
  discount_type: 'percentage' | 'fixed';
  value: number;
  max_discount_amount?: number | null;
  is_exclusive?: boolean;
  priority?: number;
}) {
  const { data, error } = await supabase
    .from('discounts')
    .insert({
      name: payload.name,
      discount_type: payload.discount_type,
      value: payload.value,
      max_discount_amount: payload.max_discount_amount ?? null,
      is_exclusive: payload.is_exclusive ?? false,
      priority: payload.priority ?? 0,
    })
    .select()
    .single();
  return throwOnError(data, error);
}

async function updateDiscount(id: string, payload: {
  name: string;
  discount_type: 'percentage' | 'fixed';
  value: number;
  max_discount_amount?: number | null;
  is_exclusive?: boolean;
  priority?: number;
  is_active?: boolean;
}) {
  const { error } = await supabase
    .from('discounts')
    .update({
      name: payload.name,
      discount_type: payload.discount_type,
      value: payload.value,
      max_discount_amount: payload.max_discount_amount ?? null,
      is_exclusive: payload.is_exclusive ?? false,
      priority: payload.priority ?? 0,
      is_active: payload.is_active ?? true,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

async function deleteDiscount(id: string) {
  const { error } = await supabase.from('discounts').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ─── Student Discounts ────────────────────────────────────────
async function getStudentDiscounts(studentId: string) {
  const { data, error } = await supabase
    .from('student_discounts')
    .select('*, discounts(*), fee_structures(id, name)')
    .eq('student_id', studentId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    student_id: row.student_id,
    discount_id: row.discount_id,
    fee_structure_id: row.fee_structure_id,
    effective_from: row.effective_from,
    effective_until: row.effective_until,
    approved_by: row.approved_by,
    notes: row.notes,
    discount_name: row.discounts?.name,
    discount_type: row.discounts?.discount_type,
    discount_value: row.discounts?.value,
    is_exclusive: row.discounts?.is_exclusive,
    fee_name: row.fee_structures?.name ?? 'All Fees',
  }));
}

async function addStudentDiscount(payload: {
  student_id: string;
  discount_id: string;
  fee_structure_id?: string | null;
  effective_from: string;
  effective_until?: string | null;
  approved_by?: string | null;
  notes?: string | null;
}) {
  const { data, error } = await supabase
    .from('student_discounts')
    .insert({
      student_id: payload.student_id,
      discount_id: payload.discount_id,
      fee_structure_id: payload.fee_structure_id ?? null,
      effective_from: payload.effective_from,
      effective_until: payload.effective_until ?? null,
      approved_by: payload.approved_by ?? null,
      notes: payload.notes ?? null,
    })
    .select()
    .single();
  return throwOnError(data, error);
}

async function removeStudentDiscount(id: string) {
  const { error } = await supabase
    .from('student_discounts')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

async function recalculateStudentDues(studentId: string) {
  const { data, error } = await supabase.rpc('recalculate_student_dues', {
    p_student_id: studentId,
  });
  if (error) throw new Error(error.message);
  return data as number; // returns count of updated dues
}

// ─── Late Fee Rules ───────────────────────────────────────────
async function getLateFeeRules() {
  const { data, error } = await supabase
    .from('late_fee_rules')
    .select('*, fee_structures(name), classes(name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...r,
    fee_name: r.fee_structures?.name ?? 'All Fees',
    class_name: r.classes?.name ?? 'All Classes',
  }));
}

async function addLateFeeRule(payload: {
  name: string;
  fee_structure_id?: string | null;
  class_id?: string | null;
  grace_period_days: number;
  penalty_type: 'fixed_once' | 'fixed_daily' | 'percentage_monthly';
  penalty_value: number;
  max_penalty?: number | null;
}) {
  const { data, error } = await supabase
    .from('late_fee_rules')
    .insert({
      name: payload.name,
      fee_structure_id: payload.fee_structure_id ?? null,
      class_id: payload.class_id ?? null,
      grace_period_days: payload.grace_period_days,
      penalty_type: payload.penalty_type,
      penalty_value: payload.penalty_value,
      max_penalty: payload.max_penalty ?? null,
    })
    .select()
    .single();
  return throwOnError(data, error);
}

async function deleteLateFeeRule(id: string) {
  const { error } = await supabase.from('late_fee_rules').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

async function evaluateLateFees(studentId: string) {
  const { error } = await supabase.rpc('evaluate_student_late_fees', {
    p_student_id: studentId,
  });
  if (error) throw new Error(error.message);
  return { success: true };
}

async function getStudentBilling(studentId: string) {
  const { data, error } = await supabase.rpc('get_student_billing', {
    p_student_id: studentId,
  });
  if (error) throw new Error(error.message);
  return data as { dues: any[]; transactions: any[] };
}

async function waiveDue(dueId: string, waivedBy?: string, reason?: string) {
  const { error } = await supabase.rpc('waive_due', {
    p_due_id: dueId,
    p_waived_by: waivedBy ?? null,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return { success: true };
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
  bulkImportStudents,
  getStudentDues,

  // Search
  searchStudents,
  checkStudentDuplicate,

  // Families (siblings)
  linkSiblings,
  unlinkSibling,
  getSiblings,

  // Payments
  addCustomDue,
  getStudentTransactions,
  processPayment,
  processFamilyPayment,
  setAssignmentCustomAmount,
  createRazorpayOrder,
  verifyRazorpayPayment,

  // Dashboard & Reports
  getDashboard,
  getDefaulters,
  getTransactions,

  // Discounts
  getDiscounts,
  addDiscount,
  updateDiscount,
  deleteDiscount,
  getStudentDiscounts,
  addStudentDiscount,
  removeStudentDiscount,
  recalculateStudentDues,

  // Late Fees
  getLateFeeRules,
  addLateFeeRule,
  deleteLateFeeRule,
  evaluateLateFees,
  getStudentBilling,
  waiveDue,
};
