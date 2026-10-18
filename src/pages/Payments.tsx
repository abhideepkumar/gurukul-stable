import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Label } from '@/src/components/ui/label';

import { format } from 'date-fns';
import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';
import { useDebounce } from '../hooks/use-debounce';
import { logger } from '@/src/lib/logger';

// Declare Razorpay on window (loaded from checkout.js in index.html)
declare global {
  interface Window {
    Razorpay: any;
  }
}

export function Payments() {
  const { user } = useAuth();

  // Search + cart state. selectedStudents[0] is the primary anchor child.
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<any[]>([]);
  const [availableSiblings, setAvailableSiblings] = useState<any[]>([]);
  const [isAddingFamily, setIsAddingFamily] = useState(false);

  const [duesByStudent, setDuesByStudent] = useState<Record<string, any[]>>({});
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [paymentData, setPaymentData] = useState({ payment_method: 'cash', reference_id: '', comment: '', date: format(new Date(), 'yyyy-MM-dd') });
  const [error, setError] = useState<Error | null>(null);

  const [isAddBillOpen, setIsAddBillOpen] = useState(false);
  const [billData, setBillData] = useState({ amount: '', title: '', due_date: format(new Date(), 'yyyy-MM-dd'), description: '' });
  const [billStudentId, setBillStudentId] = useState('');
  const [isAddingBill, setIsAddingBill] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // Ranked, server-side search (name / parent / phone / admission no, typo-tolerant)
  useEffect(() => {
    if (debouncedSearch.trim().length > 1) {
      api.searchStudents(debouncedSearch).then(setSearchResults).catch(setError);
    } else {
      setSearchResults([]);
    }
  }, [debouncedSearch]);

  // Flat lookup of every due currently in the cart (due ids are globally unique)
  const dueMap = useMemo(() => {
    const m: Record<string, any> = {};
    selectedStudents.forEach(s => (duesByStudent[s.id] ?? []).forEach(d => { m[d.id] = d; }));
    return m;
  }, [selectedStudents, duesByStudent]);

  const totalAllocated = useMemo(
    () => Object.values(allocations).reduce((sum, v) => sum + (v || 0), 0),
    [allocations],
  );

  const childrenWithSelection = useMemo(
    () => selectedStudents.filter(s => (duesByStudent[s.id] ?? []).some(d => (allocations[d.id] ?? 0) > 0)),
    [selectedStudents, duesByStudent, allocations],
  );

  // ── Loaders ─────────────────────────────────────────────────
  const loadDuesFor = (studentId: string) => {
    api.getStudentDues(studentId)
      .then(dues => setDuesByStudent(prev => ({ ...prev, [studentId]: dues })))
      .catch(setError);
  };

  const loadBillingFor = async (studentId: string) => {
    const billing = await api.getStudentBilling(studentId);
    setDuesByStudent(prev => ({ ...prev, [studentId]: billing.dues ?? [] }));
    return billing;
  };

  const loadHistory = (studentId: string) => {
    api.getStudentTransactions(studentId)
      .then((res) => setHistory(Array.isArray(res) ? res : (res as any).data ?? []))
      .catch((e) => logger.error('History load failed', e, { studentId }));
  };

  // ── Cart handlers ───────────────────────────────────────────
  const handleSelectStudent = async (student: any) => {
    setSelectedStudents([student]);
    setAvailableSiblings([]);
    setDuesByStudent({});
    setAllocations({});
    setHistory([]);
    setActiveTab('pending');
    setSearch('');
    setSearchResults([]);
    setBillStudentId(student.id);

    // Single RPC: evaluates late fees + returns dues + recent history
    try {
      const billing = await loadBillingFor(student.id);
      setHistory(billing.transactions ?? []);
    } catch (err) {
      logger.warn('Billing load failed, falling back', { studentId: student.id });
      loadDuesFor(student.id);
      loadHistory(student.id);
    }

    try {
      const sibs = await api.getSiblings(student.id);
      setAvailableSiblings(sibs);
    } catch (err) {
      logger.warn('Sibling load failed', { studentId: student.id, error: String(err) });
      setAvailableSiblings([]);
    }
  };

  const handleAddSibling = async (sib: any) => {
    if (selectedStudents.some(s => s.id === sib.id)) return;
    setIsAddingFamily(true);
    setSelectedStudents(prev => [...prev, sib]);
    setAvailableSiblings(prev => prev.filter(s => s.id !== sib.id));
    try {
      await loadBillingFor(sib.id);
    } catch (err) {
      logger.warn('Sibling billing load failed', { studentId: sib.id, error: String(err) });
      loadDuesFor(sib.id);
    } finally {
      setIsAddingFamily(false);
    }
  };

  const handleAddAllSiblings = async () => {
    const toAdd = availableSiblings.filter(s => !selectedStudents.some(p => p.id === s.id));
    if (toAdd.length === 0) return;
    setIsAddingFamily(true);
    setSelectedStudents(prev => [...prev, ...toAdd]);
    setAvailableSiblings([]);
    await Promise.allSettled(toAdd.map(s =>
      api.getStudentBilling(s.id)
        .then(billing => setDuesByStudent(prev => ({ ...prev, [s.id]: billing.dues ?? [] })))
        .catch(err => {
          logger.warn('Sibling billing load failed', { studentId: s.id, error: String(err) });
          loadDuesFor(s.id);
        })
    ));
    setIsAddingFamily(false);
  };

  const handleRemoveSibling = (studentId: string) => {
    const sib = selectedStudents.find(s => s.id === studentId);
    if (!sib) return;
    const dueIds = new Set((duesByStudent[studentId] ?? []).map(d => d.id));
    setAllocations(prev => {
      const next = { ...prev };
      dueIds.forEach(id => delete next[id]);
      return next;
    });
    setDuesByStudent(prev => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
    setSelectedStudents(prev => prev.filter(s => s.id !== studentId));
    setAvailableSiblings(prev => prev.some(s => s.id === studentId) ? prev : [...prev, sib]);
  };

  const handleChangeStudent = () => {
    setSelectedStudents([]);
    setAvailableSiblings([]);
    setDuesByStudent({});
    setAllocations({});
    setHistory([]);
    setActiveTab('pending');
  };

  const handleWaiveDue = async (dueId: string, studentId: string) => {
    if (!confirm('Waive this late fee? It will be marked as paid/waived.')) return;
    try {
      await api.waiveDue(dueId, user?.email ?? 'admin', 'Manual waiver');
      loadDuesFor(studentId);
    } catch (err) {
      alert('Failed to waive due');
    }
  };

  const handleAddBill = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = billStudentId || selectedStudents[0]?.id;
    if (!targetId) return;
    setIsAddingBill(true);
    try {
      await api.addCustomDue({
        student_id: targetId,
        amount: parseFloat(billData.amount),
        title: billData.title,
        due_date: billData.due_date,
        description: billData.description
      });
      setIsAddBillOpen(false);
      setBillData({ amount: '', title: '', due_date: format(new Date(), 'yyyy-MM-dd'), description: '' });
      loadDuesFor(targetId);
    } catch (err: any) {
      alert(err.message || 'Failed to add custom bill');
    } finally {
      setIsAddingBill(false);
    }
  };

  // ── Payment ─────────────────────────────────────────────────
  const buildEnrichedDues = (clearedDues: any[]) => {
    return clearedDues.map(cd => {
      const originalDue = dueMap[cd.due_id];
      return {
        ...cd,
        due_type: cd.due_type ?? originalDue?.due_type ?? 'standard',
        original_amount: cd.original_amount ?? originalDue?.original_amount ?? 0,
        discount_amount: cd.discount_amount ?? originalDue?.discount_amount ?? 0,
        discount_details: cd.discount_details ?? originalDue?.discount_details ?? [],
        previous_paid: cd.previous_paid ?? originalDue?.paid_amount ?? 0,
      };
    });
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) return;

    // Partition allocations per child: one child = single payment, N children = family payment
    const partitions = selectedStudents
      .map(s => {
        const sDues = duesByStudent[s.id] ?? [];
        const allocs = sDues
          .filter(d => (allocations[d.id] ?? 0) > 0)
          .map(d => ({ due_id: d.id, amount_allocated: allocations[d.id] }));
        const amount = allocs.reduce((sum, a) => sum + a.amount_allocated, 0);
        return { student: s, student_id: s.id, amount, allocations: allocs };
      })
      .filter(p => p.allocations.length > 0);

    if (partitions.length === 0) {
      alert('Please select at least one due and enter an amount to pay.');
      return;
    }

    const grandTotal = partitions.reduce((sum, p) => sum + p.amount, 0);
    const studentsById = Object.fromEntries(selectedStudents.map(s => [s.id, s]));
    // Idempotency key: one per submit attempt
    const idempotencyKey = crypto.randomUUID();

    try {
      if (paymentData.payment_method === 'razorpay') {
        if (partitions.length > 1) {
          alert('Razorpay checkout works per child. Pay one child at a time, or switch to Cash / Online for a single family payment.');
          return;
        }
        // ── Razorpay Inline Modal Flow ────────────────────────
        setIsProcessing(true);
        const target = partitions[0];

        // 1. Create order on the server via edge function
        const orderData = await api.createRazorpayOrder({
          student_id: target.student_id,
          amount: target.amount,
          allocations: target.allocations,
        });

        // 2. Open Razorpay checkout modal
        const options = {
          key: orderData.key_id,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'School Fee System',
          description: `Fee payment for ${target.student.name}`,
          order_id: orderData.order_id,
          handler: async function (response: any) {
            // 3. After user pays, verify the signature via edge function
            try {
              const verifyRes = await api.verifyRazorpayPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              });

              // 4. Show receipt modal
              setReceiptData({
                receipt_no: verifyRes.receipt_no || null,
                transaction_id: verifyRes.transaction_id || orderData.order_id,
                student_name: target.student.name,
                class_name: target.student.class_name,
                section: target.student.section,
                amount: target.amount.toString(),
                payment_method: 'razorpay',
                reference_id: response.razorpay_payment_id,
                comment: `Razorpay Online Payment`,
                date: format(new Date(), 'yyyy-MM-dd'),
                cleared_dues: buildEnrichedDues(verifyRes.cleared_dues || []),
                students: [target.student],
              });
              setIsReceiptOpen(true);
              setAllocations({});
              // Dashboard caches stats for 5 min — a payment makes it stale
              localStorage.removeItem('gurukul_dashboard_cache');
              loadDuesFor(target.student_id);
            } catch (verifyErr: any) {
              logger.error('Razorpay verify failed', verifyErr);
              alert(verifyErr.message || 'Payment verification failed');
            } finally {
              setIsProcessing(false);
            }
          },
          modal: {
            ondismiss: function () {
              setIsProcessing(false);
            },
          },
          prefill: {
            name: target.student.parent_name || target.student.name,
            contact: target.student.phone || '',
            email: target.student.email || '',
          },
          theme: {
            color: '#2563eb', // blue-600 to match UI
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function (response: any) {
          setIsProcessing(false);
          alert(`Payment failed: ${response.error.description}`);
        });
        rzp.open();
        return;
      }

      // ── Cash / Manual Online Flow ───────────────────────────
      // One atomic server call: N children → 1 receipt, N transactions.
      setIsProcessing(true);
      const res = await api.processFamilyPayment({
        payments: partitions.map(p => ({
          student_id: p.student_id,
          amount: p.amount,
          allocations: p.allocations,
        })),
        payment_method: paymentData.payment_method,
        reference_id: paymentData.reference_id,
        comment: paymentData.comment,
        date: paymentData.date,
        collected_by: user?.email ?? null,
        idempotency_key: idempotencyKey,
      });

      const single = partitions.length === 1;
      setReceiptData({
        receipt_no: res.receipt_no || null,
        transaction_id: res.transaction_ids?.[0] ?? '',
        student_name: single ? partitions[0].student.name : `Family (${partitions.length} children)`,
        class_name: single ? partitions[0].student.class_name : '',
        section: single ? partitions[0].student.section : '',
        amount: String(res.amount ?? grandTotal),
        payment_method: paymentData.payment_method,
        reference_id: paymentData.reference_id,
        comment: paymentData.comment,
        date: paymentData.date,
        collected_by: user?.email ?? '',
        cleared_dues: buildEnrichedDues(res.cleared_dues || []),
        students: partitions.map(p => studentsById[p.student_id]).filter(Boolean),
      });
      setIsReceiptOpen(true);

      setPaymentData({ payment_method: 'cash', reference_id: '', comment: '', date: format(new Date(), 'yyyy-MM-dd') });
      setAllocations({});
      // Dashboard caches stats for 5 min — a payment makes it stale
      localStorage.removeItem('gurukul_dashboard_cache');
      // Refresh billing for every child that was paid
      partitions.forEach(p => loadDuesFor(p.student_id));
    } catch (err: any) {
      logger.error('Payment failed', err, { studentIds: partitions.map(p => p.student_id) });
      alert(err.message || 'Failed to process payment');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Allocation helpers ──────────────────────────────────────
  const handleAllocationChange = (dueId: string, amount: string, maxAmount: number) => {
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) {
      const newAlloc = { ...allocations };
      delete newAlloc[dueId];
      setAllocations(newAlloc);
      return;
    }

    if (val > maxAmount) {
      setAllocations(prev => ({ ...prev, [dueId]: maxAmount }));
    } else {
      setAllocations(prev => ({ ...prev, [dueId]: val }));
    }
  };

  const toggleDueSelection = (dueId: string, maxAmount: number) => {
    if (allocations[dueId]) {
      const newAlloc = { ...allocations };
      delete newAlloc[dueId];
      setAllocations(newAlloc);
    } else {
      setAllocations(prev => ({ ...prev, [dueId]: maxAmount }));
    }
  };

  const categorizeDue = (dueDateStr: string) => {
    const dueDate = new Date(dueDateStr);
    const now = new Date();
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    if (dueDate < new Date(now.getFullYear(), now.getMonth(), 1)) {
      return 'Overdue';
    } else if (dueDate <= currentMonthEnd) {
      return 'Current Month';
    } else {
      return 'Future';
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const allocSubtotal = (studentId: string) =>
    (duesByStudent[studentId] ?? []).reduce((sum, d) => sum + (allocations[d.id] ?? 0), 0);

  if (error) return <ErrorSkeleton error={error} />;

  const isFamily = selectedStudents.length > 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-4xl font-headline font-bold tracking-tight text-primary">Payments & Dues</h2>
        <p className="text-primary/70 font-body">Record payments for students — siblings settle on one receipt.</p>
      </div>

      {selectedStudents.length === 0 ? (
        <div className="max-w-xl space-y-4">
          <Label>Search Student to Manage</Label>
          <div className="relative">
            <span className="material-symbols-outlined text-[18px]">search</span>
            <Input
              placeholder="Student, parent, phone, or admission no..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {searchResults.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white shadow-sm">
              {searchResults.map(student => (
                <div
                  key={student.id}
                  className="flex cursor-pointer items-center justify-between border-b border-slate-100 p-4 last:border-0 hover:bg-slate-50"
                  onClick={() => handleSelectStudent(student)}
                >
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {student.name}
                      {student.admission_no && (
                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">#{student.admission_no}</span>
                      )}
                    </div>
                    <div className="text-sm text-primary/70 font-body">
                      {student.parent_name && <span>{student.parent_name} • </span>}
                      {student.class_name} {student.section && `-${student.section}`} • {student.phone}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-red-600">
                      Pending: ₹{Number(student.pending_amount).toLocaleString()}
                    </div>
                    {student.matched_on && (
                      <div className="text-[10px] text-slate-400">{student.matched_on}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold">{selectedStudents[0].name}</h3>
                <p className="text-primary/70 font-body">
                  {selectedStudents[0].class_name} {selectedStudents[0].section && `-${selectedStudents[0].section}`}
                  {selectedStudents[0].phone && ` • ${selectedStudents[0].phone}`}
                </p>
              </div>
              <Button variant="outline" onClick={handleChangeStudent}>Change Student</Button>
            </div>

            {(availableSiblings.length > 0 || isFamily) && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <span className="text-sm text-primary/70 font-body">Family:</span>
                {selectedStudents.map((s, i) => (
                  <span
                    key={s.id}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${i === 0 ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}
                  >
                    {s.name}
                    {i > 0 && (
                      <button
                        type="button"
                        className="text-emerald-700 hover:text-red-600 font-bold leading-none"
                        title={`Remove ${s.name} from this payment`}
                        onClick={() => handleRemoveSibling(s.id)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {availableSiblings.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={isAddingFamily}
                    onClick={() => handleAddSibling(s)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
                  >
                    + {s.name}
                  </button>
                ))}
                {availableSiblings.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isAddingFamily}
                    onClick={handleAddAllSiblings}
                    className="h-7 text-xs"
                  >
                    {isAddingFamily ? 'Adding…' : `Add all ${availableSiblings.length} siblings`}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex border-b border-slate-200">
            <button
              className={`px-4 py-2 font-medium text-sm border-b-2 flex items-center gap-2 ${activeTab === 'pending' ? 'border-blue-600 text-blue-600' : 'border-transparent text-primary/70 font-body hover:text-primary/90 hover:border-slate-300'}`}
              onClick={() => setActiveTab('pending')}
            >
              <span className="material-symbols-outlined text-[18px]">receipt_long</span> Pending Dues
            </button>
            <button
              className={`px-4 py-2 font-medium text-sm border-b-2 flex items-center gap-2 ${activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-primary/70 font-body hover:text-primary/90 hover:border-slate-300'}`}
              onClick={() => setActiveTab('history')}
            >
              <span className="material-symbols-outlined text-[18px]">history</span> Payment History
            </button>
          </div>

          {activeTab === 'pending' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-lg font-medium">1. Select Dues to Pay</h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setBillStudentId(selectedStudents[0].id); setIsAddBillOpen(true); }}
                  className="gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span> Add Custom Bill
                </Button>
              </div>
              <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]"></TableHead>
                      <TableHead>Fee Type</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="w-[120px] text-right">Allocate (₹)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedStudents.map(s => {
                      const payable = (duesByStudent[s.id] ?? []).filter(d => d.status !== 'paid' && !d.is_waived);
                      const subtotal = allocSubtotal(s.id);
                      return (
                        <React.Fragment key={s.id}>
                          {isFamily && (
                            <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                              <TableCell colSpan={5} className="py-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold">
                                    {s.name}
                                    <span className="ml-1 font-normal text-primary/70">
                                      • {s.class_name} {s.section && `-${s.section}`}
                                    </span>
                                  </span>
                                  {subtotal > 0 && (
                                    <span className="text-xs font-medium text-emerald-700">Selected: ₹{subtotal.toLocaleString()}</span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                          {payable.map((due) => {
                            const balance = due.amount - due.paid_amount;
                            const isSelected = allocations[due.id] !== undefined;
                            const category = categorizeDue(due.due_date);
                            const isLateFee = due.due_type === 'late_fee';
                            return (
                              <TableRow key={due.id} className={`${isSelected ? 'bg-blue-50/50' : ''} ${isLateFee ? 'bg-amber-50/30' : ''}`}>
                                <TableCell>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    checked={isSelected}
                                    onChange={() => toggleDueSelection(due.id, balance)}
                                  />
                                </TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-2">
                                    {isLateFee && <span className="material-symbols-outlined text-[18px]">warning</span>}
                                    <div>
                                      {isLateFee ? 'Late Fee' : due.fee_name}
                                      {isLateFee && <span className="text-xs text-slate-400 ml-1">({due.fee_name})</span>}
                                      <div className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                        category === 'Overdue' ? 'bg-red-100 text-red-800' :
                                        category === 'Current Month' ? 'bg-amber-100 text-amber-800' :
                                        'bg-slate-100 text-slate-800'
                                      }`}>
                                        {category}
                                      </div>
                                      {due.discount_amount > 0 && (
                                        <span className="ml-1.5 text-[10px] text-emerald-600 font-medium">
                                          (₹{due.discount_amount} off)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm">{format(new Date(due.due_date), 'MMM yyyy')}</TableCell>
                                <TableCell className="text-right font-medium text-red-600 px-4">
                                  ₹{balance.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {isLateFee && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-slate-400 hover:text-red-500"
                                        title="Waive this late fee"
                                        onClick={() => handleWaiveDue(due.id, s.id)}
                                      >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                      </Button>
                                    )}
                                    {isSelected ? (
                                      <Input
                                        type="number"
                                        min="0"
                                        max={balance}
                                        step="0.01"
                                        className="h-8 w-24 text-right"
                                        value={allocations[due.id] || ''}
                                        onChange={(e) => handleAllocationChange(due.id, e.target.value, balance)}
                                      />
                                    ) : (
                                      <span className="text-slate-300">-</span>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {payable.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5} className="h-16 text-center text-primary/70 font-body text-sm">
                                No pending dues for {isFamily ? s.name : 'this student'}.
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-lg font-medium">2. Payment Details</h4>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 shadow-sm space-y-4 sticky top-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Total Allocated:</span>
                    <span className="font-bold text-blue-600">
                      ₹{totalAllocated.toLocaleString()}
                    </span>
                  </div>
                  {childrenWithSelection.length > 1 && (
                    <p className="text-[11px] text-emerald-700 font-body">
                      Family payment — one receipt for {childrenWithSelection.length} children.
                    </p>
                  )}
                </div>

                <form onSubmit={handlePayment} className="space-y-4">
                  <div className="grid gap-2">
                    <Label>Total Payment Amount (₹)</Label>
                    <div className="h-10 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-lg font-bold text-blue-700 flex items-center">
                      ₹{totalAllocated.toLocaleString()}
                    </div>
                    <p className="text-[10px] text-primary/70 font-body italic">Automatically calculated from allocations above.</p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="date">Payment Date</Label>
                    <Input id="date" type="date" required value={paymentData.date} onChange={e => setPaymentData({...paymentData, date: e.target.value})} />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="payment_method">Payment Method</Label>
                    <select
                      id="payment_method"
                      className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                      value={paymentData.payment_method}
                      onChange={e => setPaymentData({...paymentData, payment_method: e.target.value})}
                    >
                      <option value="cash">Cash</option>
                      <option value="online">Online (Manual Bank Trx)</option>
                      <option value="razorpay" disabled={childrenWithSelection.length > 1}>
                        Razorpay (Online / UPI){childrenWithSelection.length > 1 ? ' — per child' : ''}
                      </option>
                    </select>
                    {childrenWithSelection.length > 1 && paymentData.payment_method === 'razorpay' && (
                      <p className="text-[11px] text-amber-700">Razorpay works per child — pay one child at a time.</p>
                    )}
                  </div>

                  {paymentData.payment_method === 'online' && (
                    <div className="grid gap-2">
                      <Label htmlFor="reference_id">Reference ID (UPI/Txn ID)</Label>
                      <Input id="reference_id" required value={paymentData.reference_id} onChange={e => setPaymentData({...paymentData, reference_id: e.target.value})} />
                    </div>
                  )}

                  {paymentData.payment_method !== 'razorpay' && (
                    <div className="grid gap-2">
                      <Label htmlFor="comment">Comment (Optional)</Label>
                      <Input id="comment" placeholder="e.g. Paid in full" value={paymentData.comment} onChange={e => setPaymentData({...paymentData, comment: e.target.value})} />
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full h-12 text-lg font-semibold mt-4 bg-blue-600 hover:bg-blue-700 text-white"
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Processing...</>
                    ) : paymentData.payment_method === 'razorpay' ? (
                      "Pay with Razorpay"
                    ) : childrenWithSelection.length > 1 ? (
                      `Process Family Payment`
                    ) : (
                      "Process Payment"
                    )}
                  </Button>
                </form>
              </div>
            </div>
          </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4">
              <h4 className="text-lg font-medium">Payment History — {selectedStudents[0].name}</h4>
              <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Items Paid</TableHead>
                      <TableHead className="text-right">Amount (₹)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-medium">{format(new Date(tx.date), 'dd MMM yyyy')}</TableCell>
                        <TableCell className="capitalize">{tx.payment_method}</TableCell>
                        <TableCell className="text-primary/70 font-body text-sm">{tx.reference_id || '-'}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 max-w-[250px]">
                            {tx.allocations_details?.map((alloc: any, idx: number) => (
                              <span key={idx} className="inline-flex items-center rounded-sm bg-slate-100 px-2 py-0.5 text-[11px] text-slate-800">
                                {alloc.fee_name}: ₹{alloc.amount.toLocaleString()}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">
                          ₹{tx.amount.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {history.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-primary/70 font-body">
                          No payment history found for this student.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Custom Bill Dialog */}
      <Dialog open={isAddBillOpen} onOpenChange={setIsAddBillOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleAddBill}>
            <DialogHeader>
              <DialogTitle>Add Custom Bill</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {selectedStudents.length > 1 && (
                <div className="grid gap-2">
                  <Label htmlFor="bill_student">Student</Label>
                  <select
                    id="bill_student"
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                    value={billStudentId}
                    onChange={e => setBillStudentId(e.target.value)}
                  >
                    {selectedStudents.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.class_name})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="title">Bill Name / Description</Label>
                <Input id="title" placeholder="e.g. Transport Arrears, Fines..." required value={billData.title} onChange={e => setBillData({...billData, title: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="amount">Amount (₹)</Label>
                <Input id="amount" type="number" min="1" step="0.01" required value={billData.amount} onChange={e => setBillData({...billData, amount: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="due_date">Due Date</Label>
                <Input id="due_date" type="date" required value={billData.due_date} onChange={e => setBillData({...billData, due_date: e.target.value})} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddBillOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isAddingBill}>
                {isAddingBill ? <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Adding...</> : 'Add Bill'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Receipt Modal */}
      <Dialog open={isReceiptOpen} onOpenChange={setIsReceiptOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center">Payment Receipt</DialogTitle>
          </DialogHeader>
          {receiptData && (() => {
            const groups = receiptData.students && receiptData.students.length > 1
              ? receiptData.students
                  .map((s: any) => ({
                    student: s,
                    dues: (receiptData.cleared_dues ?? []).filter((d: any) => d.student_id === s.id),
                  }))
                  .filter((g: any) => g.dues.length > 0)
              : [{ student: null, dues: receiptData.cleared_dues ?? [] }];
            return (
            <div className="space-y-6 print:p-8" id="receipt-content">
              <div className="text-center border-b pb-4">
                <h2 className="text-2xl font-bold">School Fee System</h2>
                <p className="text-sm text-primary/70 font-body">Official Payment Receipt</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-primary/70 font-body">{receiptData.receipt_no ? 'Receipt No' : 'Transaction ID'}</p>
                  <p className="font-medium">
                    {receiptData.receipt_no || (receiptData.transaction_id || '').split('-')[0].toUpperCase() || '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-primary/70 font-body">Date</p>
                  <p className="font-medium">{format(new Date(receiptData.date), 'dd MMM yyyy')}</p>
                </div>
                <div>
                  <p className="text-primary/70 font-body">Student Name</p>
                  <p className="font-medium">{receiptData.student_name}</p>
                </div>
                {receiptData.class_name && (
                  <div className="text-right">
                    <p className="text-primary/70 font-body">Class</p>
                    <p className="font-medium">{receiptData.class_name} {receiptData.section && `-${receiptData.section}`}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-b py-4">
                <div className="flex justify-between font-medium mb-2">
                  <span>Payment Method</span>
                  <span className="capitalize">{receiptData.payment_method}</span>
                </div>
                {receiptData.reference_id && (
                  <div className="flex justify-between text-sm text-slate-600 mb-2">
                    <span>Reference ID</span>
                    <span className="text-right max-w-[60%] break-all">{receiptData.reference_id}</span>
                  </div>
                )}
                {receiptData.comment && (
                  <div className="flex justify-between text-sm text-slate-600 mb-2">
                    <span>Comment</span>
                    <span className="text-right max-w-[60%]">{receiptData.comment}</span>
                  </div>
                )}
                {receiptData.collected_by && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Collected By</span>
                    <span>{receiptData.collected_by}</span>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-lg">Amount Paid</span>
                  <span className="font-bold text-2xl">₹{parseFloat(receiptData.amount).toLocaleString()}</span>
                </div>
              </div>

              {groups.length > 0 && groups[0].dues.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2 text-primary/70 font-body border-b pb-1">Payment Breakdown</h4>
                  <div className="text-sm space-y-3 mt-3">
                    {groups.map((group: any, gi: number) => (
                      <div key={gi} className="space-y-3">
                        {group.student && (
                          <div className="flex items-center justify-between rounded bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                            <span>{group.student.name}</span>
                            <span>{group.student.class_name}{group.student.section ? `-${group.student.section}` : ''}</span>
                          </div>
                        )}
                        {group.dues.map((due: any, idx: number) => {
                          const base = due.original_amount ?? 0;
                          const disc = due.discount_amount ?? 0;
                          const prev = due.previous_paid ?? due.previous_paid_amount ?? 0;
                          const balanceBefore = base - disc - prev;
                          const isPartial = due.amount_allocated < balanceBefore - 0.01;

                          return (
                            <div key={idx} className="flex flex-col space-y-1 pb-2 border-b border-slate-100 last:border-0">
                              <div className="flex justify-between font-medium text-primary">
                                <span>
                                  {due.due_type === 'late_fee' ? 'Late Fee: ' : ''}{due.fee_name}
                                  <span className="text-primary/70 font-body font-normal text-xs ml-1">({format(new Date(due.due_date), 'MMM yyyy')})</span>
                                </span>
                                <span>₹{due.amount_allocated.toLocaleString()}</span>
                              </div>

                              <div className="flex justify-between text-xs text-primary/70 font-body">
                                 <div>
                                   Base: ₹{Number(base).toLocaleString()}
                                   {disc > 0 && ` | Discount: -₹${Number(disc).toLocaleString()}`}
                                   {prev > 0 && ` | Prev. Paid: ₹${Number(prev).toLocaleString()}`}
                                 </div>
                                 {isPartial && (
                                   <span className="text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded">Partial Payment</span>
                                 )}
                              </div>

                              {Array.isArray(due.discount_details) && due.discount_details.length > 0 && (
                                 <div className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1.5 rounded mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                   <span className="font-medium">Applied Discounts:</span>
                                   {due.discount_details.map((dd: any, i: number) => (
                                      <span key={i}>
                                        • {dd.name} (-₹{dd.calculated.toLocaleString()})
                                      </span>
                                   ))}
                                 </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            );
          })()}
          <DialogFooter className="print:hidden">
            <Button type="button" variant="outline" onClick={() => setIsReceiptOpen(false)}>Close</Button>
            <Button onClick={handlePrint} className="gap-2">
              <span className="material-symbols-outlined text-[18px]">print</span> Print Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
