import React, { useEffect, useState } from 'react';
import { api } from '@/src/lib/api';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/src/components/ui/dialog';
import { Label } from '@/src/components/ui/label';
import { Search, Plus, Trash2, Edit } from 'lucide-react';
import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';

export function Students() {
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [feeStructures, setFeeStructures] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', class_id: '', section: '', parent_name: '', phone: '', email: '' });
  const [selectedFeeStructures, setSelectedFeeStructures] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const loadStudents = () => {
    api.getStudents(search, classId).then(setStudents).catch(setError);
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
  }, [search, classId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addStudent({
        ...formData,
        fee_structure_ids: selectedFeeStructures,
      });
      setIsAddOpen(false);
      setFormData({ name: '', class_id: '', section: '', parent_name: '', phone: '', email: '' });
      setSelectedFeeStructures([]);
      loadStudents();
    } catch (err) {
      console.error(err);
      alert('Failed to add student');
    }
  };

  const handleEditClick = (student: any) => {
    setFormData({
      name: student.name,
      class_id: student.class_id,
      section: student.section || '',
      parent_name: student.parent_name || '',
      phone: student.phone || '',
      email: student.email || ''
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
      setFormData({ name: '', class_id: '', section: '', parent_name: '', phone: '', email: '' });
      loadStudents();
    } catch (err) {
      console.error(err);
      alert('Failed to update student');
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

  if (error) return <ErrorSkeleton error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">Students</h2>
          <p className="text-slate-500">Manage student records and view their dues.</p>
        </div>
        <Button onClick={() => {
          setIsAddOpen(true);
          setFormData({ name: '', class_id: '', section: '', parent_name: '', phone: '', email: '' });
          setSelectedFeeStructures([]);
        }} className="gap-2">
          <Plus className="h-4 w-4" /> Add Student
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Search by name or phone..."
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
              <TableHead>Class</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="text-right">Current Month</TableHead>
              <TableHead className="text-right">Pending Amount</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <TableRow key={student.id}>
                <TableCell className="font-medium">{student.name}</TableCell>
                <TableCell>{student.class_name} {student.section && `-${student.section}`}</TableCell>
                <TableCell>{student.phone}</TableCell>
                <TableCell className="text-right font-medium text-red-600">
                  ₹{student.overdue_amount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-medium text-amber-600">
                  ₹{student.current_month_due.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-medium text-slate-900">
                  ₹{student.pending_amount.toLocaleString()}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-blue-600" onClick={() => handleEditClick(student)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-red-600" onClick={() => handleDelete(student.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {students.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                  No students found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Student</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
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
                  <p className="text-sm text-slate-500 mb-2">These fee structures will generate dues for this student. Default class fees are auto-selected.</p>
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
              <div className="grid gap-2">
                <Label htmlFor="edit_name">Full Name</Label>
                <Input id="edit_name" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
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
    </div>
  );
}
