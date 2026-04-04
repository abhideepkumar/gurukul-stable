import { useEffect, useState } from 'react';
import { api } from '@/src/lib/api';
import { Button } from '@/src/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Download } from 'lucide-react';
import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';

export function Reports() {
  const [activeTab, setActiveTab] = useState<'defaulters' | 'transactions'>('defaulters');
  const [defaulters, setDefaulters] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (activeTab === 'defaulters') {
      api.getDefaulters().then(setDefaulters).catch(setError);
    } else {
      loadTransactions();
    }
  }, [activeTab]);

  const loadTransactions = () => {
    api.getTransactions(dateRange.start, dateRange.end).then(setTransactions).catch(setError);
  };

  // Sanitize a CSV cell to prevent CSV injection (formula injection).
  // Values starting with =, +, -, @, \t, \r can execute formulas in Excel.
  const sanitizeCSVCell = (value: any): string => {
    const str = String(value ?? '');
    // Prefix dangerous characters with a single quote to neutralize them
    const dangerous = ['=', '+', '-', '@', '\t', '\r'];
    let safe = str;
    if (dangerous.some(ch => safe.startsWith(ch))) {
      safe = `'${safe}`;
    }
    // Escape double quotes and wrap in quotes if it contains commas, quotes, or newlines
    if (safe.includes('"') || safe.includes(',') || safe.includes('\n')) {
      safe = `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };

  const handleExportCSV = () => {
    const rows: string[][] = [];
    
    if (activeTab === 'defaulters') {
      rows.push(["Name", "Class", "Phone", "Overdue Amount"]);
      defaulters.forEach(d => {
        rows.push([
          sanitizeCSVCell(d.name),
          sanitizeCSVCell(d.class_name),
          sanitizeCSVCell(d.phone),
          sanitizeCSVCell(d.overdue_amount),
        ]);
      });
    } else {
      rows.push(["Date", "Student Name", "Class", "Amount", "Method", "Reference ID"]);
      transactions.forEach(t => {
        rows.push([
          sanitizeCSVCell(t.date),
          sanitizeCSVCell(t.student_name),
          sanitizeCSVCell(t.class_name),
          sanitizeCSVCell(t.amount),
          sanitizeCSVCell(t.payment_method),
          sanitizeCSVCell(t.reference_id || ''),
        ]);
      });
    }

    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${activeTab}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (error) return <ErrorSkeleton error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">Reports</h2>
          <p className="text-slate-500">View and export financial reports.</p>
        </div>
        <Button onClick={handleExportCSV} className="gap-2">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="flex gap-4 border-b border-slate-200">
        <button
          className={`pb-2 text-sm font-medium ${activeTab === 'defaulters' ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          onClick={() => setActiveTab('defaulters')}
        >
          Defaulters List
        </button>
        <button
          className={`pb-2 text-sm font-medium ${activeTab === 'transactions' ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          onClick={() => setActiveTab('transactions')}
        >
          Transactions
        </button>
      </div>

      {activeTab === 'defaulters' ? (
        <div className="rounded-md border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Overdue Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {defaulters.map((student) => (
                <TableRow key={student.id}>
                  <TableCell className="font-medium">{student.name}</TableCell>
                  <TableCell>{student.class_name}</TableCell>
                  <TableCell>{student.phone}</TableCell>
                  <TableCell className="text-right font-medium text-red-600">
                    ₹{student.overdue_amount.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {defaulters.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-slate-500">
                    No defaulters found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-4">
            <input 
              type="date" 
              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={dateRange.start}
              onChange={e => setDateRange({...dateRange, start: e.target.value})}
            />
            <input 
              type="date" 
              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={dateRange.end}
              onChange={e => setDateRange({...dateRange, end: e.target.value})}
            />
            <Button variant="secondary" onClick={loadTransactions}>Filter</Button>
          </div>
          <div className="rounded-md border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>{tx.date}</TableCell>
                    <TableCell className="font-medium">{tx.student_name}</TableCell>
                    <TableCell>{tx.class_name}</TableCell>
                    <TableCell className="font-medium text-emerald-600">₹{tx.amount.toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{tx.payment_method}</TableCell>
                    <TableCell>{tx.reference_id || '-'}</TableCell>
                  </TableRow>
                ))}
                {transactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                      No transactions found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
