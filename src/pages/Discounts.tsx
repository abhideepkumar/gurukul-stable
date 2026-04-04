import React, { useEffect, useState } from 'react';
import { api } from '@/src/lib/api';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Plus, Trash2, Edit, Percent, BadgeDollarSign, ShieldAlert } from 'lucide-react';
import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';

export function Discounts() {
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    discount_type: 'percentage' as 'percentage' | 'fixed',
    value: '',
    max_discount_amount: '',
    is_exclusive: false,
    priority: '0',
  });

  const loadDiscounts = () => {
    api.getDiscounts().then(setDiscounts).catch(setError);
  };

  useEffect(() => {
    loadDiscounts();
  }, []);

  const resetForm = () => {
    setFormData({
      name: '', discount_type: 'percentage', value: '',
      max_discount_amount: '', is_exclusive: false, priority: '0',
    });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addDiscount({
        name: formData.name,
        discount_type: formData.discount_type,
        value: parseFloat(formData.value),
        max_discount_amount: formData.max_discount_amount ? parseFloat(formData.max_discount_amount) : null,
        is_exclusive: formData.is_exclusive,
        priority: parseInt(formData.priority) || 0,
      });
      setIsAddOpen(false);
      resetForm();
      loadDiscounts();
    } catch (err) {
      alert('Failed to add discount');
    }
  };

  const handleEditClick = (d: any) => {
    setFormData({
      name: d.name,
      discount_type: d.discount_type,
      value: String(d.value),
      max_discount_amount: d.max_discount_amount ? String(d.max_discount_amount) : '',
      is_exclusive: d.is_exclusive,
      priority: String(d.priority),
    });
    setEditingId(d.id);
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    try {
      await api.updateDiscount(editingId, {
        name: formData.name,
        discount_type: formData.discount_type,
        value: parseFloat(formData.value),
        max_discount_amount: formData.max_discount_amount ? parseFloat(formData.max_discount_amount) : null,
        is_exclusive: formData.is_exclusive,
        priority: parseInt(formData.priority) || 0,
      });
      setIsEditOpen(false);
      setEditingId(null);
      resetForm();
      loadDiscounts();
    } catch (err) {
      alert('Failed to update discount');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this discount? Students with this discount will lose it.')) return;
    try {
      await api.deleteDiscount(id);
      loadDiscounts();
    } catch (err) {
      alert('Failed to delete discount. It may be in use by students.');
    }
  };

  if (error) return <ErrorSkeleton error={error} />;

  const renderForm = (onSubmit: (e: React.FormEvent) => void, submitLabel: string) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Discount Name</Label>
          <Input id="name" required placeholder="e.g. Sibling Discount - 2nd Child" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="discount_type">Type</Label>
            <select
              id="discount_type"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
              value={formData.discount_type}
              onChange={e => setFormData({...formData, discount_type: e.target.value as 'percentage' | 'fixed'})}
            >
              <option value="percentage">Percentage (%)</option>
              <option value="fixed">Fixed Amount (₹)</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="value">
              {formData.discount_type === 'percentage' ? 'Percentage (%)' : 'Amount (₹)'}
            </Label>
            <Input
              id="value" type="number" min="0" step="0.01" required
              placeholder={formData.discount_type === 'percentage' ? 'e.g. 10' : 'e.g. 500'}
              value={formData.value}
              onChange={e => setFormData({...formData, value: e.target.value})}
            />
          </div>
        </div>

        {formData.discount_type === 'percentage' && (
          <div className="grid gap-2">
            <Label htmlFor="max_discount_amount">Max Discount Cap (₹) — Optional</Label>
            <Input
              id="max_discount_amount" type="number" min="0" step="0.01"
              placeholder="e.g. 5000 (leave blank for no cap)"
              value={formData.max_discount_amount}
              onChange={e => setFormData({...formData, max_discount_amount: e.target.value})}
            />
            <p className="text-xs text-slate-500">Even if percentage is high, discount won't exceed this amount.</p>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="priority">Priority (lower = applied first)</Label>
          <Input
            id="priority" type="number" min="0"
            value={formData.priority}
            onChange={e => setFormData({...formData, priority: e.target.value})}
          />
          <p className="text-xs text-slate-500">When multiple discounts stack, percentage discounts with lower priority are applied first.</p>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-md border border-amber-200 bg-amber-50">
          <input
            type="checkbox"
            id="is_exclusive"
            className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            checked={formData.is_exclusive}
            onChange={e => setFormData({...formData, is_exclusive: e.target.checked})}
          />
          <div>
            <Label htmlFor="is_exclusive" className="font-medium text-amber-800">Exclusive Discount</Label>
            <p className="text-xs text-amber-600">If checked, no other discount can stack with this one (e.g. RTE 100%).</p>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => { setIsAddOpen(false); setIsEditOpen(false); resetForm(); }}>Cancel</Button>
        <Button type="submit">{submitLabel}</Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">Discounts</h2>
          <p className="text-slate-500">Define reusable discount types that can be assigned to students.</p>
        </div>
        <Button onClick={() => { setIsAddOpen(true); resetForm(); }} className="gap-2">
          <Plus className="h-4 w-4" /> Add Discount
        </Button>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Max Cap</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Exclusive</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {discounts.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 text-sm">
                    {d.discount_type === 'percentage' ? (
                      <><Percent className="h-3 w-3 text-blue-500" /> Percentage</>
                    ) : (
                      <><BadgeDollarSign className="h-3 w-3 text-emerald-500" /> Fixed</>
                    )}
                  </span>
                </TableCell>
                <TableCell className="font-medium">
                  {d.discount_type === 'percentage' ? `${d.value}%` : `₹${d.value.toLocaleString()}`}
                </TableCell>
                <TableCell>
                  {d.max_discount_amount ? `₹${d.max_discount_amount.toLocaleString()}` : '—'}
                </TableCell>
                <TableCell>{d.priority}</TableCell>
                <TableCell>
                  {d.is_exclusive && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      <ShieldAlert className="h-3 w-3" /> Exclusive
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-blue-600" onClick={() => handleEditClick(d)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-red-600" onClick={() => handleDelete(d.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {discounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                  No discounts defined. Create your first discount to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Discount</DialogTitle>
          </DialogHeader>
          {renderForm(handleAdd, 'Save Discount')}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Discount</DialogTitle>
          </DialogHeader>
          {renderForm(handleEditSubmit, 'Update Discount')}
        </DialogContent>
      </Dialog>
    </div>
  );
}
