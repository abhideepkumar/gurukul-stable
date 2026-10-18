import React, { useEffect, useState } from 'react';
import { api, DEFAULT_PAGE_SIZE, type PaginatedResult } from '@/src/lib/api';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Label } from '@/src/components/ui/label';

import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';
import { Pagination } from '../components/ui/Pagination';
import { CsvImportModal } from '../components/CsvImportModal';
import { useDebounce } from '../hooks/use-debounce';

export function Students() {
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [feeStructures, setFeeStructures] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', class_id: '', section: '', parent_name: '', phone: '', email: '', admission_no: '' });
  const [selectedFeeStructures, setSelectedFeeStructures] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState(1);
  const [totalStudents, setTotalStudents] = useState(0);

  // Family / siblings management
  const [isSiblingOpen, setIsSiblingOpen] = useState(false);
  const [siblingStudent, setSiblingStudent] = useState<any>(null);
  const [siblingList, setSiblingList] = useState<any[]>([]);
  const [siblingSearch, setSiblingSearch] = useState('');
  const [siblingResults, setSiblingResults] = useState<any[]>([]);

  // Discount management for a student
  const [isDiscountOpen, setIsDiscountOpen] = useState(false);
  const [discountStudent, setDiscountStudent] = useState<any>(null);
  const [studentDiscounts, setStudentDiscounts] = useState<any[]>([]);
  const [allDiscounts, setAllDiscounts] = useState<any[]>([]);
  const [discountForm, setDiscountForm] = useState({ discount_id: '', fee_structure_id: '', effective_from: '', effective_until: '', notes: '' });

  const [isImportOpen, setIsImportOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  const loadStudents = () => {
    api.getStudents(debouncedSearch, classId, page, DEFAULT_PAGE_SIZE)
      .then((res) => {
        const result = res as PaginatedResult<any>;
        setStudents(result.data);
        setTotalStudents(result.total);
      })
      .catch(setError);
  };

  const loadClasses = () => {
    api.getClasses().then(setClasses).catch(setError);
    api.getFeeStructures().then(setFeeStructures).catch(setError);
  };

  // Watch for class_id changes in Add Student dialog to load defaults
  useEffect(() => {
    if (isAddOpen && formData.class_id) {
      api.getClassDefaults(formData.class_id)
        .then(defaults => {
          setSelectedFeeStructures(defaults.map((d: any) => d.fee_structure_id));
        })
        .catch(console.error);
    } else if (isAddOpen && !formData.class_id) {
      setSelectedFeeStructures([]);
    }
  }, [formData.class_id, isAddOpen]);

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Single-fetch on filter change: if already on page 1 fetch directly,
  // else reset to 1 and let the page effect fetch once
  useEffect(() => {
    if (page === 1) {
      loadStudents();
    } else {
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, classId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Soft duplicate warning — similar name in same class, or same phone
      try {
        const dup = await api.checkStudentDuplicate(formData.name, formData.class_id || undefined, formData.phone || undefined);
        if (dup.similar && dup.similar.length > 0) {
          const names = dup.similar.map((s: any) => `${s.name} (${s.class_name})`).join(', ');
          if (!confirm(`Possible duplicate: ${names} already exists. Add ${formData.name} anyway?`)) return;
        }
      } catch (dupErr) {
        console.warn('Duplicate check failed', dupErr);
      }
      await api.addStudent({
        ...formData,
        fee_structure_ids: selectedFeeStructures,
      });
      setIsAddOpen(false);
      setFormData({ name: '', class_id: '', section: '', parent_name: '', phone: '', email: '', admission_no: '' });
      setSelectedFeeStructures([]);
      loadStudents();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to add student');
    }
  };

  const handleEditClick = (student: any) => {
    setFormData({
      name: student.name,
      class_id: student.class_id,
      section: student.section || '',
      parent_name: student.parent_name || '',
      phone: student.phone || '',
      email: student.email || '',
      admission_no: student.admission_no || ''
    });
    setEditingStudentId(student.id);
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudentId) return;
    try {
      await api.updateStudent(editingStudentId, formData);
      setIsEditOpen(false);
      setEditingStudentId(null);
      setFormData({ name: '', class_id: '', section: '', parent_name: '', phone: '', email: '', admission_no: '' });
      loadStudents();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to update student');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this student?')) return;
    try {
      await api.deleteStudent(id);
      loadStudents();
    } catch (err) {
      console.error(err);
      alert('Failed to delete student');
    }
  };

  const openDiscountDialog = async (student: any) => {
    setDiscountStudent(student);
    setIsDiscountOpen(true);
    setDiscountForm({ discount_id: '', fee_structure_id: '', effective_from: new Date().toISOString().slice(0, 10), effective_until: '', notes: '' });
    try {
      const [sDiscounts, dCatalog] = await Promise.all([
        api.getStudentDiscounts(student.id),
        api.getDiscounts(),
      ]);
      setStudentDiscounts(sDiscounts);
      setAllDiscounts(dCatalog);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssignDiscount = async () => {
    if (!discountStudent || !discountForm.discount_id) return;
    try {
      await api.addStudentDiscount({
        student_id: discountStudent.id,
        discount_id: discountForm.discount_id,
        fee_structure_id: discountForm.fee_structure_id || null,
        effective_from: discountForm.effective_from,
        effective_until: discountForm.effective_until || null,
        notes: discountForm.notes || null,
      });
      // Recalculate all unpaid dues with the new discount
      await api.recalculateStudentDues(discountStudent.id);
      const updated = await api.getStudentDiscounts(discountStudent.id);
      setStudentDiscounts(updated);
      setDiscountForm({ discount_id: '', fee_structure_id: '', effective_from: discountForm.effective_from, effective_until: '', notes: '' });
    } catch (err) {
      alert('Failed to assign discount. It may already be assigned.');
    }
  };

  const handleRemoveDiscount = async (id: string) => {
    if (!discountStudent) return;
    try {
      await api.removeStudentDiscount(id);
      // Recalculate all unpaid dues without the removed discount
      await api.recalculateStudentDues(discountStudent.id);
      const updated = await api.getStudentDiscounts(discountStudent.id);
      setStudentDiscounts(updated);
    } catch (err) {
      alert('Failed to remove discount');
    }
  };

  // ── Family / siblings ───────────────────────────────────────
  const openSiblingDialog = async (student: any) => {
    setSiblingStudent(student);
    setIsSiblingOpen(true);
    setSiblingSearch('');
    setSiblingResults([]);
    try {
      setSiblingList(await api.getSiblings(student.id));
    } catch (err) {
      console.error(err);
      setSiblingList([]);
    }
  };

  const siblingDebouncedSearch = useDebounce(siblingSearch, 300);

  useEffect(() => {
    if (isSiblingOpen && siblingDebouncedSearch.trim().length > 1) {
      api.searchStudents(siblingDebouncedSearch)
        .then(res => {
          setSiblingResults(res.filter(r =>
            r.id !== siblingStudent?.id && !siblingList.some((l: any) => l.id === r.id)
          ));
        })
        .catch(console.error);
    } else {
      setSiblingResults([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblingDebouncedSearch, isSiblingOpen]);

  const handleLinkSibling = async (candidate: any) => {
    if (!siblingStudent) return;
    try {
      await api.linkSiblings(
        [siblingStudent.id, candidate.id],
        siblingStudent.parent_name || undefined,
        siblingStudent.phone || undefined,
      );
      setSiblingList(await api.getSiblings(siblingStudent.id));
      setSiblingSearch('');
      setSiblingResults([]);
    } catch (err: any) {
      alert(err.message || 'Failed to link sibling');
    }
  };

  const handleUnlinkSibling = async (sibId: string) => {
    if (!confirm('Unlink this sibling from the family?')) return;
    try {
      await api.unlinkSibling(sibId);
      if (siblingStudent) setSiblingList(await api.getSiblings(siblingStudent.id));
    } catch (err: any) {
      alert(err.message || 'Failed to unlink sibling');
    }
  };

  if (error) return <ErrorSkeleton error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-headline font-bold tracking-tight text-primary">Students</h2>
          <p className="text-primary/70 font-body">Manage student records and view their dues.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsImportOpen(true)} className="gap-2">
            <span className="material-symbols-outlined text-[18px]">upload</span> Import CSV
          </Button>
          <Button onClick={() => {
            setIsAddOpen(true);
            setFormData({ name: '', class_id: '', section: '', parent_name: '', phone: '', email: '', admission_no: '' });
            setSelectedFeeStructures([]);
          }} className="gap-2">
            <span className="material-symbols-outlined text-[18px]">add</span> Add Student
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <span className="material-symbols-outlined text-[18px]">search</span>
          <Input
            placeholder="Name, parent, phone, admission no..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="flex h-10 w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
        >
          <option value="">All Classes</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="text-right">Current Month</TableHead>
              <TableHead className="text-right">Pending Amount</TableHead>
              <TableHead className="w-[130px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <TableRow key={student.id}>
                <TableCell className="font-medium">
                  {student.name}
                  {student.admission_no && (
                    <span className="ml-2 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">#{student.admission_no}</span>
                  )}
                </TableCell>
                <TableCell className="text-primary/70 font-body">{student.parent_name || '-'}</TableCell>
                <TableCell>{student.class_name} {student.section && `-${student.section}`}</TableCell>
                <TableCell>{student.phone}</TableCell>
                <TableCell className="text-right font-medium text-red-600">
                  ₹{student.overdue_amount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-medium text-amber-600">
                  ₹{student.current_month_due.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-medium text-primary">
                  ₹{student.pending_amount.toLocaleString()}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary/70 font-body hover:text-emerald-600" title="Link Siblings" onClick={() => openSiblingDialog(student)}>
                      <span className="material-symbols-outlined text-[18px]">group_add</span>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary/70 font-body hover:text-amber-600" title="Manage Discounts" onClick={() => openDiscountDialog(student)}>
                      <span className="material-symbols-outlined text-[18px]">sell</span>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary/70 font-body hover:text-blue-600" onClick={() => handleEditClick(student)}>
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary/70 font-body hover:text-red-600" onClick={() => handleDelete(student.id)}>
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {students.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-primary/70 font-body">
                  No students found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={Math.ceil(totalStudents / DEFAULT_PAGE_SIZE)}
        totalItems={totalStudents}
        pageSize={DEFAULT_PAGE_SIZE}
        onPageChange={setPage}
      />

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Student</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="admission_no">Admission No</Label>
                  <Input id="admission_no" placeholder="e.g. 1042" value={formData.admission_no} onChange={e => setFormData({...formData, admission_no: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="class_id">Class</Label>
                  <select
                    id="class_id"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={formData.class_id}
                    onChange={e => setFormData({...formData, class_id: e.target.value})}
                  >
                    <option value="">Select Class</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="section">Section</Label>
                  <Input id="section" value={formData.section} onChange={e => setFormData({...formData, section: e.target.value})} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="parent_name">Parent Name</Label>
                <Input id="parent_name" required value={formData.parent_name} onChange={e => setFormData({...formData, parent_name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
              </div>
              
              {formData.class_id && (
                <div className="grid gap-2 border-t pt-4 mt-2">
                  <Label>Assigned Fee Structures</Label>
                  <p className="text-sm text-primary/70 font-body mb-2">These fee structures will generate dues for this student. Default class fees are auto-selected.</p>
                  <div className="max-h-40 overflow-y-auto space-y-2 rounded-md border p-3 bg-slate-50">
                    {feeStructures.map(fs => {
                      const isSelected = selectedFeeStructures.includes(fs.id);
                      return (
                        <label key={fs.id} className="flex items-center space-x-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedFeeStructures(prev => [...prev, fs.id]);
                              } else {
                                setSelectedFeeStructures(prev => prev.filter(id => id !== fs.id));
                              }
                            }}
                          />
                          <span>{fs.name} (₹{fs.amount.toLocaleString()} / {fs.frequency})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
              <Button type="submit">Save Student</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit_name">Full Name</Label>
                  <Input id="edit_name" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit_admission_no">Admission No</Label>
                  <Input id="edit_admission_no" placeholder="e.g. 1042" value={formData.admission_no} onChange={e => setFormData({...formData, admission_no: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit_class_id">Class</Label>
                  <select
                    id="edit_class_id"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={formData.class_id}
                    onChange={e => setFormData({...formData, class_id: e.target.value})}
                  >
                    <option value="">Select Class</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit_section">Section</Label>
                  <Input id="edit_section" value={formData.section} onChange={e => setFormData({...formData, section: e.target.value})} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_parent_name">Parent Name</Label>
                <Input id="edit_parent_name" required value={formData.parent_name} onChange={e => setFormData({...formData, parent_name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit_phone">Phone</Label>
                  <Input id="edit_phone" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit_email">Email</Label>
                  <Input id="edit_email" type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
              <Button type="submit">Update Student</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Discount Management Dialog */}
      <Dialog open={isDiscountOpen} onOpenChange={setIsDiscountOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Discounts — {discountStudent?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* Active Discounts */}
            <div>
              <h4 className="text-sm font-semibold text-primary/90 mb-2">Active Discounts</h4>
              {studentDiscounts.length === 0 ? (
                <p className="text-sm text-primary/70 font-body bg-slate-50 rounded-md p-3">No discounts assigned to this student.</p>
              ) : (
                <div className="space-y-2">
                  {studentDiscounts.map(sd => (
                    <div key={sd.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                      <div>
                        <p className="text-sm font-medium text-primary">
                          {sd.discount_name}
                          {sd.is_exclusive && <span className="ml-2 text-xs bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">Exclusive</span>}
                        </p>
                        <p className="text-xs text-primary/70 font-body">
                          {sd.discount_type === 'percentage' ? `${sd.discount_value}%` : `₹${sd.discount_value}`} off · Applies to: {sd.fee_name}
                          {sd.effective_until && ` · Until ${sd.effective_until}`}
                        </p>
                        {sd.notes && <p className="text-xs text-slate-400 mt-0.5">{sd.notes}</p>}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => handleRemoveDiscount(sd.id)}>
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Assign New Discount */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold text-primary/90 mb-3">Assign New Discount</h4>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Discount</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm"
                      value={discountForm.discount_id}
                      onChange={e => setDiscountForm({...discountForm, discount_id: e.target.value})}
                    >
                      <option value="">Select discount…</option>
                      {allDiscounts.filter(d => d.is_active).map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.discount_type === 'percentage' ? `${d.value}%` : `₹${d.value}`})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Applies To</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm"
                      value={discountForm.fee_structure_id}
                      onChange={e => setDiscountForm({...discountForm, fee_structure_id: e.target.value})}
                    >
                      <option value="">All Fees</option>
                      {feeStructures.map(fs => (
                        <option key={fs.id} value={fs.id}>{fs.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input type="date" className="h-9" value={discountForm.effective_from} onChange={e => setDiscountForm({...discountForm, effective_from: e.target.value})} />
                  </div>
                  <div>
                    <Label className="text-xs">Until (optional)</Label>
                    <Input type="date" className="h-9" value={discountForm.effective_until} onChange={e => setDiscountForm({...discountForm, effective_until: e.target.value})} />
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Input className="h-9" placeholder="e.g. Principal approved" value={discountForm.notes} onChange={e => setDiscountForm({...discountForm, notes: e.target.value})} />
                  </div>
                </div>
                <Button onClick={handleAssignDiscount} disabled={!discountForm.discount_id} className="w-full">
                  <span className="material-symbols-outlined text-[18px]">add</span> Assign Discount
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Siblings / Family Dialog */}
      <Dialog open={isSiblingOpen} onOpenChange={setIsSiblingOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Family / Siblings — {siblingStudent?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <h4 className="text-sm font-semibold text-primary/90 mb-2">Current Family</h4>
              {siblingList.length === 0 ? (
                <p className="text-sm text-primary/70 font-body bg-slate-50 rounded-md p-3">
                  No siblings linked yet. Search below to link one.
                </p>
              ) : (
                <div className="space-y-2">
                  {siblingList.map((sib: any) => (
                    <div key={sib.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                      <div>
                        <p className="text-sm font-medium text-primary">
                          {sib.name}
                          {sib.admission_no && (
                            <span className="ml-2 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">#{sib.admission_no}</span>
                          )}
                        </p>
                        <p className="text-xs text-primary/70 font-body">
                          {sib.class_name} {sib.section && `-${sib.section}`} · Pending ₹{Number(sib.pending_amount ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-red-500"
                        title="Unlink sibling"
                        onClick={() => handleUnlinkSibling(sib.id)}
                      >
                        <span className="material-symbols-outlined text-[18px]">link_off</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold text-primary/90 mb-2">Link a Sibling</h4>
              <Input
                placeholder="Search by name, parent, phone, admission no..."
                value={siblingSearch}
                onChange={(e) => setSiblingSearch(e.target.value)}
              />
              {siblingResults.length > 0 && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-slate-200">
                  {siblingResults.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between border-b border-slate-100 p-3 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-primary">{r.name}</p>
                        <p className="text-xs text-primary/70 font-body">
                          {r.parent_name && <span>{r.parent_name} · </span>}
                          {r.class_name} {r.section && `-${r.section}`}
                          {r.phone && ` · ${r.phone}`}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => handleLinkSibling(r)}
                      >
                        Link
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">
                Linking never merges fee records — siblings keep their own dues, discounts and late fees; payments can settle both at once on one receipt.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CsvImportModal 
        open={isImportOpen} 
        onOpenChange={setIsImportOpen} 
        onSuccess={loadStudents} 
      />
    </div>
  );
}
