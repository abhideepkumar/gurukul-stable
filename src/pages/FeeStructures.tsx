import React, { useEffect, useState, useMemo } from 'react';
import { api, DEFAULT_PAGE_SIZE } from '@/src/lib/api';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Label } from '@/src/components/ui/label';

import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';
import { Pagination } from '../components/ui/Pagination';

export function FeeStructures() {
  const [fees, setFees] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', amount: '', frequency: 'monthly' });
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState(1);

  const paginatedFees = useMemo(() => {
    const from = (page - 1) * DEFAULT_PAGE_SIZE;
    return fees.slice(from, from + DEFAULT_PAGE_SIZE);
  }, [fees, page]);

  const loadFees = () => {
    api.getFeeStructures().then(setFees).catch(setError);
  };

  useEffect(() => {
    loadFees();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addFeeStructure({ ...formData, amount: parseFloat(formData.amount) });
      setIsAddOpen(false);
      setFormData({ name: '', amount: '', frequency: 'monthly' });
      loadFees();
    } catch (err) {
      console.error(err);
      alert('Failed to add fee structure');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this fee structure?')) return;
    try {
      await api.deleteFeeStructure(id);
      loadFees();
    } catch (err) {
      console.error(err);
      alert('Failed to delete fee structure');
    }
  };

  if (error) return <ErrorSkeleton error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-headline font-bold tracking-tight text-primary">Fee Structures</h2>
          <p className="text-primary/70 font-body">Define reusable fee types and their frequencies.</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)} className="gap-2">
          <span className="material-symbols-outlined text-[18px]">add</span> Add Fee
        </Button>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fee Name</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Frequency</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedFees.map((fee) => (
              <TableRow key={fee.id}>
                <TableCell className="font-medium">{fee.name}</TableCell>
                <TableCell>₹{fee.amount.toLocaleString()}</TableCell>
                <TableCell className="capitalize">{fee.frequency}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary/70 font-body hover:text-red-600" onClick={() => handleDelete(fee.id)}>
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {fees.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-primary/70 font-body">
                  No fee structures defined.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={Math.ceil(fees.length / DEFAULT_PAGE_SIZE)}
        totalItems={fees.length}
        pageSize={DEFAULT_PAGE_SIZE}
        onPageChange={setPage}
      />

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Fee Structure</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Fee Name</Label>
                <Input id="name" required placeholder="e.g. Tuition Fee" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="amount">Amount (₹)</Label>
                <Input id="amount" type="number" min="0" step="0.01" required value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="frequency">Frequency</Label>
                <select 
                  id="frequency" 
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                  value={formData.frequency} 
                  onChange={e => setFormData({...formData, frequency: e.target.value})}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
              <Button type="submit">Save Fee</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
