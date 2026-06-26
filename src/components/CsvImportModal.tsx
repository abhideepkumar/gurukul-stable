import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { api } from '@/src/lib/api';
import { Download, Upload, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

interface CsvImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Robust lightweight CSV Parser (handles quotes & commas inside values)
function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [], inQuotes = false, val = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { val += '"'; i++; } // Escaped quote
        else { inQuotes = false; }
      } else {
        val += char;
      }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { row.push(val.trim()); val = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i++; // Handle CRLF
        row.push(val.trim()); result.push(row); row = []; val = '';
      } else {
        val += char;
      }
    }
  }
  if (val || row.length > 0) { row.push(val.trim()); result.push(row); }
  return result.filter(r => r.some(c => c !== '')); // Remove completely empty rows
}

export function CsvImportModal({ open, onOpenChange, onSuccess }: CsvImportModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [classesMap, setClassesMap] = useState<Record<string, string>>({});
  
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  
  const [progress, setProgress] = useState({ current: 0, total: 0, failed: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [importErrors, setImportErrors] = useState<Array<{name: string, error: string}>>([]);

  // 1. Fetch available classes on mount to build a name-to-UUID map
  useEffect(() => {
    if (open) {
      api.getClasses().then(res => {
        const map: Record<string, string> = {};
        res.forEach((c: any) => {
          map[c.name.toLowerCase()] = c.id;
        });
        setClassesMap(map);
      }).catch(console.error);
    } else {
      // Reset state when closed
      setStep(1);
      setParsedData([]);
      setValidationErrors([]);
    }
  }, [open]);

  // Clear import errors when starting fresh
  const resetState = () => {
    setStep(1);
    setParsedData([]);
    setValidationErrors([]);
    setImportErrors([]);
  };

  // 2. Download Template
  const handleDownloadTemplate = () => {
    const headers = [
      "Name", "Class Name", "Section", "Parent Name", "Phone", "Email",
      "Old Due 1 Amount", "Old Due 1 Desc", "Old Due 1 Date",
      "Old Due 2 Amount", "Old Due 2 Desc", "Old Due 2 Date"
    ];
    const example = [
      "Aarav Kumar", "Class 1", "A", "Rajesh Kumar", "9876543210", "aarav@example.com",
      "500", "Transport Fine", "2023-10-15",
      "", "", ""
    ];
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + example.join(",");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "student_import_template.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // 3. Handle File Upload & Validation
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const rows = parseCSV(text);
      
      if (rows.length < 2) {
        setValidationErrors(["CSV appears to be empty or has no data rows."]);
        return;
      }

      const h = rows[0].map(h => h.trim());
      setHeaders(h);
      
      const dataRows = rows.slice(1);
      let errors: string[] = [];
      let parsedObjects = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const obj: Record<string, string> = {};
        h.forEach((header, idx) => {
          obj[header] = row[idx] || '';
        });

        // Validation Rules
        const rowNum = i + 2; // +1 for header, +1 for 0-index
        if (!obj["Name"]) errors.push(`Row ${rowNum}: 'Name' is required.`);
        
        const className = obj["Class Name"];
        if (!className) {
          errors.push(`Row ${rowNum}: 'Class Name' is required.`);
        } else if (!classesMap[className.toLowerCase()]) {
          errors.push(`Row ${rowNum}: Class '${className}' does not exist in the system.`);
        }

        parsedObjects.push(obj);
      }

      setParsedData(parsedObjects);
      setValidationErrors(errors);
      setStep(2);
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  // 4. Orchestrate Import in one Bulk API call
  const handleStartImport = async () => {
    if (validationErrors.length > 0) return;
    
    setStep(3);
    setIsProcessing(true);
    setProgress({ current: 0, total: parsedData.length, failed: 0 });
    setImportErrors([]);

    try {
      const response = await api.bulkImportStudents(parsedData);
      
      const importedCount = response?.imported?.length || 0;
      const failedItems: Array<{name: string, error: string}> = response?.errors || [];
      const failedCount = failedItems.length;

      setProgress({
        current: importedCount + failedCount,
        total: parsedData.length,
        failed: failedCount
      });

      if (failedCount > 0) {
        setImportErrors(failedItems);
      }
    } catch (err: any) {
      console.error(`Bulk import failed:`, err);
      setProgress(prev => ({ ...prev, failed: prev.total }));
      setImportErrors([{ name: 'All rows', error: err.message || 'Unknown error' }]);
    }

    setIsProcessing(false);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!isProcessing) { if (!val) resetState(); onOpenChange(val); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Import Students & Old Dues</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-6 py-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <Upload className="h-6 w-6 text-blue-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium">Upload Student Data</h3>
              <p className="text-sm text-slate-500 max-w-sm mx-auto">
                Upload a CSV file containing student details. You can also include multiple past dues per student.
              </p>
            </div>
            
            <div className="flex flex-col gap-4 items-center justify-center pt-4">
              <Button variant="outline" onClick={handleDownloadTemplate} className="w-64 gap-2">
                <Download className="h-4 w-4" /> Download Template
              </Button>
              <div className="relative">
                <Input 
                  type="file" 
                  accept=".csv" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                  onChange={handleFileUpload}
                />
                <Button className="w-64 gap-2">
                  <Upload className="h-4 w-4" /> Select CSV File
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div>
                <h4 className="font-medium text-slate-900">Validation Results</h4>
                <p className="text-sm text-slate-500">{parsedData.length} students found in file.</p>
              </div>
              {validationErrors.length === 0 ? (
                 <div className="flex items-center text-emerald-600 bg-emerald-50 px-3 py-1 rounded-md text-sm font-medium">
                   <CheckCircle2 className="w-4 h-4 mr-2" /> All Good
                 </div>
              ) : (
                 <div className="flex items-center text-red-600 bg-red-50 px-3 py-1 rounded-md text-sm font-medium">
                   <AlertCircle className="w-4 h-4 mr-2" /> {validationErrors.length} Errors Found
                 </div>
              )}
            </div>

            {validationErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4 max-h-48 overflow-y-auto">
                <h5 className="text-red-800 font-medium text-sm mb-2">Please fix these errors in your CSV before importing:</h5>
                <ul className="text-sm text-red-600 space-y-1 list-disc list-inside">
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border border-slate-200 rounded-md overflow-hidden max-h-64 overflow-y-auto bg-white">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Class</th>
                    <th className="px-4 py-2">Phone</th>
                    <th className="px-4 py-2 text-right">Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsedData.slice(0, 50).map((row, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-2 font-medium">{row["Name"]}</td>
                      <td className="px-4 py-2">{row["Class Name"]} {row["Section"] && `(${row["Section"]})`}</td>
                      <td className="px-4 py-2">{row["Phone"] || '-'}</td>
                      <td className="px-4 py-2 text-right text-xs text-slate-500">
                         {Object.keys(row).filter(k => k.includes('Amount') && row[k]).length} old dues
                      </td>
                    </tr>
                  ))}
                  {parsedData.length > 50 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-center text-slate-500 bg-slate-50/50 italic">
                        ...and {parsedData.length - 50} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={handleStartImport} disabled={validationErrors.length > 0}>
                Begin Import ({parsedData.length} rows)
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
           <div className="space-y-6 py-8 text-center">
             {isProcessing ? (
               <>
                 <Loader2 className="mx-auto h-10 w-10 text-blue-600 animate-spin mb-4" />
                 <h3 className="text-xl font-medium">Importing Students...</h3>
                 <p className="text-slate-500 mt-2">Please do not close this window.</p>
                 
                 <div className="w-full max-w-md mx-auto mt-6 bg-slate-100 rounded-full h-3 overflow-hidden">
                   <div 
                     className="bg-blue-600 h-full transition-all duration-300 ease-out"
                     style={{ width: `${(progress.current / progress.total) * 100}%` }}
                   />
                 </div>
                 <div className="mt-4 text-sm font-medium text-slate-700">
                   {progress.current} / {progress.total} processed
                 </div>
               </>
             ) : (
               <>
                 <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
                   <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                 </div>
                 <h3 className="text-2xl font-bold text-slate-900">Import Complete</h3>
                 <div className="mt-2 text-slate-600 space-y-1">
                   <p>Successfully imported: <span className="font-bold text-emerald-600">{progress.current - progress.failed}</span> students</p>
                   {progress.failed > 0 && <p>Failed: <span className="font-bold text-red-600">{progress.failed}</span></p>}
                 </div>
                 {importErrors.length > 0 && (
                   <div className="mt-4 text-left bg-red-50 border border-red-200 rounded-md p-4 max-h-48 overflow-y-auto">
                     <h5 className="text-red-800 font-semibold text-sm mb-2">Failed Rows:</h5>
                     <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                       {importErrors.map((e, i) => (
                         <li key={i}><span className="font-medium">{e.name}</span>: {e.error}</li>
                       ))}
                     </ul>
                   </div>
                 )}
                 <div className="mt-8">
                   <Button onClick={() => { onOpenChange(false); onSuccess(); }}>View Students</Button>
                 </div>
               </>
             )}
           </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
