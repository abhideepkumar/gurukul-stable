import React, { useState, useEffect, useMemo } from 'react';
import { api, DEFAULT_PAGE_SIZE } from '@/src/lib/api';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/src/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/src/components/ui/dialog';

import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';
import { Pagination } from '../components/ui/Pagination';

export default function Classes() {
  const [classes, setClasses] = useState<any[]>([]);
  const [feeStructures, setFeeStructures] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  
  const [selectedClass, setSelectedClass] = useState<any | null>(null);
  const [classDefaults, setClassDefaults] = useState<any[]>([]);
  const [isDefaultsOpen, setIsDefaultsOpen] = useState(false);
  const [selectedFeeId, setSelectedFeeId] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState(1);

  const paginatedClasses = useMemo(() => {
    const from = (page - 1) * DEFAULT_PAGE_SIZE;
    return classes.slice(from, from + DEFAULT_PAGE_SIZE);
  }, [classes, page]);

  useEffect(() => {
    loadClasses();
    loadFeeStructures();
  }, []);

  const loadClasses = async () => {
    try {
      const data = await api.getClasses();
      setClasses(data);
    } catch (error: any) {
      setError(error);
    }
  };

  const loadFeeStructures = async () => {
    try {
      const data = await api.getFeeStructures();
      setFeeStructures(data);
    } catch (error: any) {
      setError(error);
    }
  };

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addClass({ name: newClassName });
      setIsAddOpen(false);
      setNewClassName('');
      loadClasses();
    } catch (error) {
      alert('Failed to add class');
    }
  };

  const openDefaults = async (cls: any) => {
    setSelectedClass(cls);
    setIsDefaultsOpen(true);
    try {
      const data = await api.getClassDefaults(cls.id);
      setClassDefaults(data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddDefault = async () => {
    if (!selectedFeeId || !selectedClass) return;
    try {
      await api.addClassDefault(selectedClass.id, selectedFeeId);
      const data = await api.getClassDefaults(selectedClass.id);
      setClassDefaults(data);
      setSelectedFeeId('');
    } catch (error) {
      alert('Failed to add default fee');
    }
  };

  const handleRemoveDefault = async (feeStructureId: string) => {
    if (!selectedClass) return;
    try {
      await api.removeClassDefault(selectedClass.id, feeStructureId);
      const data = await api.getClassDefaults(selectedClass.id);
      setClassDefaults(data);
    } catch (error) {
      alert('Failed to remove default fee');
    }
  };

  if (error) return <ErrorSkeleton error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Classes</h1>
          <p className="text-muted-foreground">Manage classes and their default fee structures.</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}><span className="material-symbols-outlined text-[18px]">add</span> Add Class</Button>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Class</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddClass} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Class Name</Label>
                <Input
                  id="name"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="e.g., Grade 1"
                  required
                />
              </div>
              <Button type="submit" className="w-full">Save Class</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class Name</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                    No classes found. Add one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedClasses.map((cls) => (
                  <TableRow key={cls.id}>
                    <TableCell className="font-medium">{cls.name}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openDefaults(cls)}>
                        <span className="material-symbols-outlined text-[18px]">settings</span>
                        Manage Default Fees
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pagination
        currentPage={page}
        totalPages={Math.ceil(classes.length / DEFAULT_PAGE_SIZE)}
        totalItems={classes.length}
        pageSize={DEFAULT_PAGE_SIZE}
        onPageChange={setPage}
      />

      <Dialog open={isDefaultsOpen} onOpenChange={setIsDefaultsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Default Fees for {selectedClass?.name}</DialogTitle>
            <DialogDescription>
              These fees will be automatically assigned to any new student added to this class.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="flex gap-4 items-end">
              <div className="flex-1 space-y-2">
                <Label>Select Fee Structure</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedFeeId}
                  onChange={(e) => setSelectedFeeId(e.target.value)}
                >
                  <option value="">-- Select Fee --</option>
                  {feeStructures.map(fs => (
                    <option key={fs.id} value={fs.id}>{fs.name} (₹{fs.amount} / {fs.frequency})</option>
                  ))}
                </select>
              </div>
              <Button onClick={handleAddDefault} disabled={!selectedFeeId}>Add Default</Button>
            </div>

            <div className="border rounded-md">
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
                  {classDefaults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                        No default fees assigned.
                      </TableCell>
                    </TableRow>
                  ) : (
                    classDefaults.map((def) => (
                      <TableRow key={def.id}>
                        <TableCell className="font-medium">{def.name}</TableCell>
                        <TableCell>₹{def.amount}</TableCell>
                        <TableCell className="capitalize">{def.frequency}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => handleRemoveDefault(def.fee_structure_id)}>
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
