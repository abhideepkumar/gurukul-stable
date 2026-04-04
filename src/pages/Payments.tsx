import React, { useEffect, useState, useRef } from 'react';
import { api } from '@/src/lib/api';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Label } from '@/src/components/ui/label';
import { Search, Receipt, Printer, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';
import { useDebounce } from '../hooks/use-debounce';

// Declare Razorpay on window (loaded from checkout.js in index.html)
declare global {
  interface Window {
    Razorpay: any;
  }
}

export function Payments() {
  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [dues, setDues] = useState<any[]>([]);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [paymentData, setPaymentData] = useState({ payment_method: 'cash', reference_id: '', comment: '', date: format(new Date(), 'yyyy-MM-dd') });
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [error, setError] = useState<Error | null>(null);

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

  const handleSelectStudent = (student: any) => {
    setSelectedStudent(student);
    loadDues(student.id);
    setSearch('');
    setStudents([]);
    setAllocations({});
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const allocationArray = Object.entries(allocations)
      .filter(([_, amount]) => (amount as number) > 0)
      .map(([due_id, amount_allocated]) => ({ due_id, amount_allocated: amount_allocated as number }));

    if (allocationArray.length === 0) {
      alert('Please select at least one due and enter an amount to pay.');
      return;
    }

    const totalAllocated = allocationArray.reduce((sum, alloc) => sum + alloc.amount_allocated, 0);

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
                cleared_dues: verifyRes.cleared_dues,
              });
              setIsReceiptOpen(true);
              setAllocations({});
              loadDues(selectedStudent.id);
            } catch (verifyErr: any) {
              console.error(verifyErr);
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
      const res = await api.processPayment({
        student_id: selectedStudent.id,
        amount: totalAllocated,
        payment_method: paymentData.payment_method,
        reference_id: paymentData.reference_id,
        comment: paymentData.comment,
        date: paymentData.date,
        allocations: allocationArray
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
        cleared_dues: res.cleared_dues
      });
      setIsReceiptOpen(true);

      setPaymentData({ payment_method: 'cash', reference_id: '', comment: '', date: format(new Date(), 'yyyy-MM-dd') });
      setAllocations({});
      loadDues(selectedStudent.id);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to process payment');
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
        <h2 className="text-3xl font-bold tracking-tight text-slate-900">Payments & Dues</h2>
        <p className="text-slate-500">Record payments for students.</p>
      </div>

      {!selectedStudent ? (
        <div className="max-w-xl space-y-4">
          <Label>Search Student to Manage</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
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
                    <div className="text-sm text-slate-500">{student.class_name} {student.section && `-${student.section}`} • {student.phone}</div>
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
              <p className="text-slate-500">{selectedStudent.class_name} {selectedStudent.section && `-${selectedStudent.section}`} • {selectedStudent.phone}</p>
            </div>
            <Button variant="outline" onClick={() => setSelectedStudent(null)}>Change Student</Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h4 className="text-lg font-medium">1. Select Dues to Pay</h4>
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
                    {dues.filter(d => d.status !== 'paid').map((due) => {
                      const balance = due.amount - due.paid_amount;
                      const isSelected = allocations[due.id] !== undefined;
                      const category = categorizeDue(due.due_date);
                      return (
                        <TableRow key={due.id} className={isSelected ? "bg-blue-50/50" : ""}>
                          <TableCell>
                            <input 
                              type="checkbox" 
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={isSelected}
                              onChange={() => toggleDueSelection(due.id, balance)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {due.fee_name}
                            <div className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              category === 'Overdue' ? 'bg-red-100 text-red-800' :
                              category === 'Current Month' ? 'bg-amber-100 text-amber-800' :
                              'bg-slate-100 text-slate-800'
                            }`}>
                              {category}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{format(new Date(due.due_date), 'MMM yyyy')}</TableCell>
                          <TableCell className="text-right font-medium text-red-600 px-4">
                            ₹{balance.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {isSelected ? (
                              <Input 
                                type="number" 
                                min="0" 
                                max={balance} 
                                step="0.01"
                                className="h-8 w-full text-right"
                                value={allocations[due.id] || ''}
                                onChange={(e) => handleAllocationChange(due.id, e.target.value, balance)}
                              />
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {dues.filter(d => d.status !== 'paid').length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-slate-500">
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
                    <p className="text-[10px] text-slate-500 italic">Automatically calculated from allocations above.</p>
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
                      <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing...</>
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
        </div>
      )}

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
                <p className="text-sm text-slate-500">Official Payment Receipt</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Transaction ID</p>
                  <p className="font-medium">{receiptData.transaction_id.split('-')[0].toUpperCase()}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">Date</p>
                  <p className="font-medium">{format(new Date(receiptData.date), 'dd MMM yyyy')}</p>
                </div>
                <div>
                  <p className="text-slate-500">Student Name</p>
                  <p className="font-medium">{receiptData.student_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">Class</p>
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
                  <h4 className="font-medium text-sm mb-2 text-slate-500">Cleared Dues</h4>
                  <ul className="text-sm space-y-1">
                    {receiptData.cleared_dues.map((due: any, idx: number) => (
                      <li key={idx} className="flex justify-between">
                        <span>{due.fee_name} ({format(new Date(due.due_date), 'MMM yyyy')})</span>
                        <span>₹{due.amount_allocated.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="print:hidden">
            <Button type="button" variant="outline" onClick={() => setIsReceiptOpen(false)}>Close</Button>
            <Button onClick={handlePrint} className="gap-2">
              <Printer className="h-4 w-4" /> Print Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
