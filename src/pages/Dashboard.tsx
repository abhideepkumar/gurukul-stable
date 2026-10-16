import { useEffect, useState } from 'react';
import { api } from '@/src/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';

import { ErrorSkeleton } from '../components/ui/ErrorSkeleton';

export function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const CACHE_KEY = 'gurukul_dashboard_cache';
  const CACHE_TTL_MS = 5 * 60 * 1000;

  const load = async (force = false) => {
    try {
      if (!force) {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (Date.now() - cached.at < CACHE_TTL_MS) {
            setData(cached.data);
            return;
          }
        }
      }
      setIsRefreshing(true);
      const fresh = await api.getDashboard();
      setData(fresh);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: fresh }));
    } catch (e: any) {
      // Serve stale cache rather than blank page when offline/rate-limited
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw && !data) {
        try { setData(JSON.parse(raw).data); return; } catch { /* fall through */ }
      }
      setError(e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <ErrorSkeleton error={error} />;
  if (!data) return <div>Loading...</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-headline font-bold tracking-tight text-primary">Dashboard</h2>
          <p className="text-primary/70 font-body mt-1">Overview of school finances and student dues.</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={isRefreshing}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-primary/70">Total Students</CardTitle>
            <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px] text-primary">group</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.total_students}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-primary/70">Current Month Collection</CardTitle>
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px] text-emerald-600">trending_up</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">₹{data.current_month_collection.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-primary/70">Current Month Dues</CardTitle>
            <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px] text-primary">currency_rupee</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{data.current_month_dues.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-primary/70">Total Overdue Amount</CardTitle>
            <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px] text-error">error</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">₹{data.total_overdue.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
