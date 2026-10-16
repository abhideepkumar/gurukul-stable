/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';

const Students = lazy(() => import('./pages/Students').then(m => ({ default: m.Students })));
const FeeStructures = lazy(() => import('./pages/FeeStructures').then(m => ({ default: m.FeeStructures })));
const Payments = lazy(() => import('./pages/Payments').then(m => ({ default: m.Payments })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const Discounts = lazy(() => import('./pages/Discounts').then(m => ({ default: m.Discounts })));
const LateFeeRules = lazy(() => import('./pages/LateFeeRules').then(m => ({ default: m.LateFeeRules })));
// Classes has a default export
const Classes = lazy(() => import('./pages/Classes'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="classes" element={<Suspense fallback={<PageFallback />}><Classes /></Suspense>} />
              <Route path="students" element={<Suspense fallback={<PageFallback />}><Students /></Suspense>} />
              <Route path="fees" element={<Suspense fallback={<PageFallback />}><FeeStructures /></Suspense>} />
              <Route path="discounts" element={<Suspense fallback={<PageFallback />}><Discounts /></Suspense>} />
              <Route path="late-fees" element={<Suspense fallback={<PageFallback />}><LateFeeRules /></Suspense>} />
              <Route path="payments" element={<Suspense fallback={<PageFallback />}><Payments /></Suspense>} />
              <Route path="reports" element={<Suspense fallback={<PageFallback />}><Reports /></Suspense>} />
            </Route>
          </Routes>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
