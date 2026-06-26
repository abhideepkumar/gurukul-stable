import React, { useEffect, useState } from 'react';
import { api } from '@/src/lib/api';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';

import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';

export function LateFeeRules() {
  const [rules, setRules] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [feeStructures, setFeeStructures] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    fee_structure_id: '',
    class_id: '',
    grace_period_days: '5',
    penalty_type: 'fixed_once' as 'fixed_once' | 'fixed_daily' | 'percentage_monthly',
    penalty_value: '',
    max_penalty: '',
  });

  const loadData = async () => {
    try {
      const [r, c, fs] = await Promise.all([
        api.getLateFeeRules(),
        api.getClasses(),
        api.getFeeStructures(),
      ]);
      setRules(r);
      setClasses(c);
      setFeeStructures(fs);
    } catch (err: any) {
      setError(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setFormData({
      name: '', fee_structure_id: '', class_id: '',
      grace_period_days: '5', penalty_type: 'fixed_once',
      penalty_value: '', max_penalty: '',
    });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addLateFeeRule({
        name: formData.name,
        fee_structure_id: formData.fee_structure_id || null,
        class_id: formData.class_id || null,
        grace_period_days: parseInt(formData.grace_period_days) || 0,
        penalty_type: formData.penalty_type,
        penalty_value: parseFloat(formData.penalty_value),
        max_penalty: formData.max_penalty ? parseFloat(formData.max_penalty) : null,
      });
      setIsAddOpen(false);
      resetForm();
      loadData();
    } catch (err) {
      alert('Failed to add late fee rule');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this late fee rule?')) return;
    try {
      await api.deleteLateFeeRule(id);
      loadData();
    } catch (err) {
      alert('Failed to delete rule');
    }
  };

  const penaltyLabel = (type: string) => {
    switch (type) {
      case 'fixed_once': return 'Fixed (One-Time)';
      case 'fixed_daily': return 'Fixed (Per Day)';
      case 'percentage_monthly': return '% of Outstanding / Month';
      default: return type;
    }
  };

  // Preview calculator
  const previewPenalty = () => {
    const val = parseFloat(formData.penalty_value);
    if (!val) return null;
    const days = 15; // example: 15 days late after grace
    switch (formData.penalty_type) {
      case 'fixed_once': return `₹${val} one-time fine`;
      case 'fixed_daily': return `₹${val}/day × ${days} days = ₹${val * days} (example: 15 days late)`;
      case 'percentage_monthly': return `${val}% of outstanding per month (example: ₹2,000 due → ₹${(2000 * val / 100).toFixed(0)}/month)`;
      default: return null;
    }
  };

  if (error) return <ErrorSkeleton error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-headline font-bold tracking-tight text-primary">Late Fee Rules</h2>
          <p className="text-primary/70 font-body">Configure automatic penalties for overdue payments.</p>
        </div>
        <Button onClick={() => { setIsAddOpen(true); resetForm(); }} className="gap-2">
          <span className="material-symbols-outlined text-[18px]">add</span> Add Rule
        </Button>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule Name</TableHead>
              <TableHead>Applies To</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Grace Period</TableHead>
              <TableHead>Penalty Type</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Max Cap</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell>{rule.fee_name}</TableCell>
                <TableCell>{rule.class_name}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 text-sm">
                    <span className="material-symbols-outlined text-[18px]">schedule</span>
                    {rule.grace_period_days} days
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-xs font-medium rounded-full bg-slate-100 px-2 py-0.5">
                    {penaltyLabel(rule.penalty_type)}
                  </span>
                </TableCell>
                <TableCell className="font-medium">
                  {rule.penalty_type === 'percentage_monthly'
                    ? `${rule.penalty_value}%`
                    : `₹${rule.penalty_value.toLocaleString()}`}
                </TableCell>
                <TableCell>
                  {rule.max_penalty ? `₹${rule.max_penalty.toLocaleString()}` : '—'}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary/70 font-body hover:text-red-600" onClick={() => handleDelete(rule.id)}>
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-primary/70 font-body">
                  No late fee rules defined. Late fees won't be charged until you create a rule.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Late Fee Rule</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="rule_name">Rule Name</Label>
                <Input id="rule_name" required placeholder="e.g. Standard Late Fine" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Applies To Fee</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={formData.fee_structure_id}
                    onChange={e => setFormData({...formData, fee_structure_id: e.target.value})}
                  >
                    <option value="">All Fees</option>
                    {feeStructures.map(fs => (
                      <option key={fs.id} value={fs.id}>{fs.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label>Applies To Class</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={formData.class_id}
                    onChange={e => setFormData({...formData, class_id: e.target.value})}
                  >
                    <option value="">All Classes</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Grace Period (days after due date)</Label>
                <Input type="number" min="0" value={formData.grace_period_days} onChange={e => setFormData({...formData, grace_period_days: e.target.value})} />
                <p className="text-xs text-primary/70 font-body">Penalty won't apply until this many days after the due date.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Penalty Type</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={formData.penalty_type}
                    onChange={e => setFormData({...formData, penalty_type: e.target.value as any})}
                  >
                    <option value="fixed_once">Fixed — One-Time</option>
                    <option value="fixed_daily">Fixed — Per Day Late</option>
                    <option value="percentage_monthly">% of Outstanding Per Month</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label>
                    {formData.penalty_type === 'percentage_monthly' ? 'Percentage (%)' : 'Amount (₹)'}
                  </Label>
                  <Input
                    type="number" min="0" step="0.01" required
                    placeholder={formData.penalty_type === 'percentage_monthly' ? 'e.g. 2' : 'e.g. 100'}
                    value={formData.penalty_value}
                    onChange={e => setFormData({...formData, penalty_value: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Maximum Penalty Cap (₹) — Optional</Label>
                <Input
                  type="number" min="0" step="0.01"
                  placeholder="e.g. 500 (leave blank for no cap)"
                  value={formData.max_penalty}
                  onChange={e => setFormData({...formData, max_penalty: e.target.value})}
                />
              </div>

              {/* Preview */}
              {previewPenalty() && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <span className="material-symbols-outlined text-[18px]">warning</span>
                  <div>
                    <p className="text-sm font-medium text-amber-800">Preview</p>
                    <p className="text-xs text-amber-700">{previewPenalty()}</p>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
              <Button type="submit">Save Rule</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
