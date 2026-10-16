import React, { useEffect, useState } from 'react';
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
  const [students, setStudents] = useState<any[]>([]);
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [dues, setDues] = useState<any[]>([]);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [paymentData, setPaymentData] = useState({ payment_method: 'cash', reference_id: '', comment: '', date: format(new Date(), 'yyyy-MM-dd') });
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [error, setError] = useState<Error | null>(null);

  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [history, setHistory] = useState<any[]>([]);
  const [isAddBillOpen, setIsAddBillOpen] = useState(false);
  const [billData, setBillData] = useState({ amount: '', title: '', due_date: format(new Date(), 'yyyy-MM-dd'), description: '' });
  const [isAddingBill, setIsAddingBill] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    if (debouncedSearch.length > 2) {
      api.getStudents(debouncedSearch).then(res => setStudents(res as any[])).catch(setError);
    } else {
      setStudents([]);
    }
  }, [debouncedSearch]);

  const loadDues = (studentId: string) => {
    api.getStudentDues(studentId).then(setDues).catch(setError);
  };

  const loadHistory = (studentId: string) => {
    api.getStudentTransactions(studentId).then((res) => setHistory(Array.isArray(res) ? res : (res as any).data ?? [])).catch((e) => logger.error('History load failed', e, { studentId }));
  };

  const handleSelectStudent = async (student: any) => {
    setSelectedStudent(student);
    setSearch('');
    setStudents([]);
    setAllocations({});
    // Single RPC: evaluates late fees + returns dues + recent history
    try {
      const billing = await api.getStudentBilling(student.id);
      setDues(billing.dues ?? []);
      setHistory(billing.transactions ?? []);
    } catch (err) {
      logger.warn('Billing load failed, falling back', { studentId: student.id });
      loadDues(student.id);
      loadHistory(student.id);
    }
  };

  const handleWaiveDue = async (dueId: string) => {
    if (!confirm('Waive this late fee? It will be marked as paid/waived.')) return;
    try {
      await api.waiveDue(dueId, user?.email ?? 'admin', 'Manual waiver');
      if (selectedStudent) loadDues(selectedStudent.id);
    } catch (err) {
      alert('Failed to waive due');
    }
  };

  const handleAddBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;
    setIsAddingBill(true);
    try {
      await api.addCustomDue({
        student_id: selectedStudent.id,
        amount: parseFloat(billData.amount),
        title: billData.title,
        due_date: billData.due_date,
        description: billData.description
      });
      setIsAddBillOpen(false);
      setBillData({ amount: '', title: '', due_date: format(new Date(), 'yyyy-MM-dd'), description: '' });
      loadDues(selectedStudent.id);
    } catch (err: any) {
      alert(err.message || 'Failed to add custom bill');
    } finally {
      setIsAddingBill(false);
    }
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) return;
    
    const allocationArray = Object.entries(allocations)
      .filter(([_, amount]) => (amount as number) > 0)
      .map(([due_id, amount_allocated]) => ({ due_id, amount_allocated: amount_allocated as number }));

    if (allocationArray.length === 0) {
      alert('Please select at least one due and enter an amount to pay.');
      return;
    }

    const totalAllocated = allocationArray.reduce((sum, alloc) => sum + alloc.amount_allocated, 0);
    // Idempotency key: one per submit attempt, reused on retry-safe paths
    const idempotencyKey = crypto.randomUUID();

    const buildEnrichedDues = (clearedDues: any[]) => {
      return clearedDues.map(cd => {
        const originalDue = dues.find(d => d.id === cd.due_id);
        return {
          ...cd,
          due_type: originalDue?.due_type || 'standard',
          original_amount: originalDue?.original_amount || 0,
          discount_amount: originalDue?.discount_amount || 0,
          discount_details: originalDue?.discount_details || [],
          previous_paid_amount: originalDue?.paid_amount || 0,
          total_due_amount: originalDue?.amount || 0
        };
      });
    };

    try {
      if (paymentData.payment_method === 'razorpay') {
        // ── Razorpay Inline Modal Flow ────────────────────────
        setIsProcessing(true);

        // 1. Create order on the server via edge function
        const orderData = await api.createRazorpayOrder({
          student_id: selectedStudent.id,
          amount: totalAllocated,
          allocations: allocationArray,
        });

        // 2. Open Razorpay checkout modal
        const options = {
          key: orderData.key_id,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'School Fee System',
          description: `Fee payment for ${selectedStudent.name}`,
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
                transaction_id: verifyRes.transaction_id || orderData.order_id,
                student_name: selectedStudent.name,
                class_name: selectedStudent.class_name,
                section: selectedStudent.section,
                amount: totalAllocated.toString(),
                payment_method: 'razorpay',
                reference_id: response.razorpay_payment_id,
                comment: `Razorpay Online Payment`,
                date: format(new Date(), 'yyyy-MM-dd'),
                cleared_dues: buildEnrichedDues(verifyRes.cleared_dues || []),
              });
              setIsReceiptOpen(true);
              setAllocations({});
              // Dashboard caches stats for 5 min — a payment makes it stale
              localStorage.removeItem('gurukul_dashboard_cache');
              loadDues(selectedStudent.id);
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
            name: selectedStudent.parent_name || selectedStudent.name,
            contact: selectedStudent.phone || '',
            email: selectedStudent.email || '',
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

      // ── Cash / Manual Online Flow (existing) ────────────────
      setIsProcessing(true);
      const res = await api.processPayment({
        student_id: selectedStudent.id,
        amount: totalAllocated,
        payment_method: paymentData.payment_method,
        reference_id: paymentData.reference_id,
        comment: paymentData.comment,
        date: paymentData.date,
        allocations: allocationArray,
        idempotency_key: idempotencyKey,
      });
      
      setReceiptData({
        transaction_id: res.transaction_id,
        student_name: selectedStudent.name,
        class_name: selectedStudent.class_name,
        section: selectedStudent.section,
        amount: totalAllocated.toString(),
        payment_method: paymentData.payment_method,
        reference_id: paymentData.reference_id,
        comment: paymentData.comment,
        date: paymentData.date,
        cleared_dues: buildEnrichedDues(res.cleared_dues || [])
      });
      setIsReceiptOpen(true);

      setPaymentData({ payment_method: 'cash', reference_id: '', comment: '', date: format(new Date(), 'yyyy-MM-dd') });
      setAllocations({});
      // Dashboard caches stats for 5 min — a payment makes it stale
      localStorage.removeItem('gurukul_dashboard_cache');
      loadDues(selectedStudent.id);
    } catch (err: any) {
      logger.error('Payment failed', err, { studentId: selectedStudent?.id });
      alert(err.message || 'Failed to process payment');
    } finally {
      setIsProcessing(false);
    }
  };

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

  if (error) return <ErrorSkeleton error={error} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-4xl font-headline font-bold tracking-tight text-primary">Payments & Dues</h2>
        <p className="text-primary/70 font-body">Record payments for students.</p>
      </div>

      {!selectedStudent ? (
        <div className="max-w-xl space-y-4">
          <Label>Search Student to Manage</Label>
          <div className="relative">
            <span className="material-symbols-outlined text-[18px]">search</span>
            <Input
              placeholder="Search by name or phone..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {students.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white shadow-sm">
              {students.map(student => (
                <div 
                  key={student.id} 
                  className="flex cursor-pointer items-center justify-between border-b border-slate-100 p-4 last:border-0 hover:bg-slate-50"
                  onClick={() => handleSelectStudent(student)}
                >
                  <div>
                    <div className="font-medium">{student.name}</div>
                    <div className="text-sm text-primary/70 font-body">{student.class_name} {student.section && `-${student.section}`} • {student.phone}</div>
                  </div>
                  <div className="text-right text-sm font-medium text-red-600">
                    Pending: ₹{student.pending_amount.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <h3 className="text-xl font-semibold">{selectedStudent.name}</h3>
              <p className="text-primary/70 font-body">{selectedStudent.class_name} {selectedStudent.section && `-${selectedStudent.section}`} • {selectedStudent.phone}</p>
            </div>
            <Button variant="outline" onClick={() => setSelectedStudent(null)}>Change Student</Button>
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
                <Button size="sm" variant="outline" onClick={() => setIsAddBillOpen(true)} className="gap-2">
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
                    {dues.filter(d => d.status !== 'paid' && !d.is_waived).map((due) => {
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
                                  onClick={() => handleWaiveDue(due.id)}
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
                    {dues.filter(d => d.status !== 'paid').length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-primary/70 font-body">
                          No pending dues available for payment.
                        </TableCell>
                      </TableRow>
                    )}
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
                      ₹{Object.values(allocations).reduce((sum: number, val) => sum + ((val as number) || 0), 0).toLocaleString()}
                    </span>
                  </div>
                </div>

                <form onSubmit={handlePayment} className="space-y-4">
                  <div className="grid gap-2">
                    <Label>Total Payment Amount (₹)</Label>
                    <div className="h-10 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-lg font-bold text-blue-700 flex items-center">
                      ₹{Object.values(allocations).reduce((sum: number, val) => sum + ((val as number) || 0), 0).toLocaleString()}
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
                      <option value="razorpay">Razorpay (Online / UPI)</option>
                    </select>
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
              <h4 className="text-lg font-medium">Payment History</h4>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">Payment Receipt</DialogTitle>
          </DialogHeader>
          {receiptData && (
            <div className="space-y-6 print:p-8" id="receipt-content">
              <div className="text-center border-b pb-4">
                <h2 className="text-2xl font-bold">School Fee System</h2>
                <p className="text-sm text-primary/70 font-body">Official Payment Receipt</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-primary/70 font-body">Transaction ID</p>
                  <p className="font-medium">{receiptData.transaction_id.split('-')[0].toUpperCase()}</p>
                </div>
                <div className="text-right">
                  <p className="text-primary/70 font-body">Date</p>
                  <p className="font-medium">{format(new Date(receiptData.date), 'dd MMM yyyy')}</p>
                </div>
                <div>
                  <p className="text-primary/70 font-body">Student Name</p>
                  <p className="font-medium">{receiptData.student_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-primary/70 font-body">Class</p>
                  <p className="font-medium">{receiptData.class_name} {receiptData.section && `-${receiptData.section}`}</p>
                </div>
              </div>

              <div className="border-t border-b py-4">
                <div className="flex justify-between font-medium mb-2">
                  <span>Payment Method</span>
                  <span className="capitalize">{receiptData.payment_method}</span>
                </div>
                {receiptData.reference_id && (
                  <div className="flex justify-between text-sm text-slate-600 mb-2">
                    <span>Reference ID</span>
                    <span>{receiptData.reference_id}</span>
                  </div>
                )}
                {receiptData.comment && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Comment</span>
                    <span className="text-right max-w-[60%]">{receiptData.comment}</span>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-lg">Amount Paid</span>
                  <span className="font-bold text-2xl">₹{parseFloat(receiptData.amount).toLocaleString()}</span>
                </div>
              </div>

              {receiptData.cleared_dues && receiptData.cleared_dues.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2 text-primary/70 font-body border-b pb-1">Payment Breakdown</h4>
                  <div className="text-sm space-y-3 mt-3">
                    {receiptData.cleared_dues.map((due: any, idx: number) => {
                      const balanceBeforeThisPayment = due.total_due_amount - due.previous_paid_amount;
                      const isPartial = due.amount_allocated < balanceBeforeThisPayment;
                      
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
                               Base: ₹{due.original_amount.toLocaleString()}
                               {due.discount_amount > 0 && ` | Discount: -₹${due.discount_amount.toLocaleString()}`}
                               {due.previous_paid_amount > 0 && ` | Prev. Paid: ₹${due.previous_paid_amount.toLocaleString()}`}
                             </div>
                             {isPartial && (
                               <span className="text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded">Partial Payment</span>
                             )}
                          </div>
                          
                          {due.discount_details && due.discount_details.length > 0 && (
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
                </div>
              )}
            </div>
          )}
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
