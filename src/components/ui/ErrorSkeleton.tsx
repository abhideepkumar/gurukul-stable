import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { cn } from '../../lib/utils'; // Assuming cn exists, let me check first

export function ErrorSkeleton({
  title = "Something went wrong",
  message = "An unexpected error occurred while loading this page.",
  error,
  resetErrorBoundary,
  className
}: {
  title?: string;
  message?: string;
  error?: Error | null;
  resetErrorBoundary?: () => void;
  className?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className={cn("flex flex-col items-center justify-center min-h-[400px] w-full p-8 text-center", className)}>
      <div className="rounded-full bg-red-100 p-4 mb-4">
        <AlertTriangle className="h-10 w-10 text-red-600" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-800 mb-2">{title}</h2>
      <p className="text-slate-600 mb-2 max-w-md">{message}</p>
      
      <div className="bg-slate-100 px-4 py-2 rounded-lg mb-6 w-full max-w-md border border-slate-200">
        <div className="text-xs text-slate-500 font-mono mb-1 uppercase tracking-wider text-left">Error Path</div>
        <div className="text-sm text-slate-800 font-mono text-left break-all">
          {location.pathname}
        </div>
        {error && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="text-xs text-slate-500 font-mono mb-1 uppercase tracking-wider text-left">Error Details</div>
            <div className="text-sm text-red-600 font-mono text-left break-words">
              {error.message || String(error)}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 justify-center">
        <button
          onClick={resetErrorBoundary ? resetErrorBoundary : () => window.location.reload()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors"
        >
          <RefreshCcw className="h-4 w-4" />
          Try Again
        </button>
        <button
          onClick={() => {
            if (resetErrorBoundary) resetErrorBoundary();
            navigate('/', { replace: true });
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
        >
          <Home className="h-4 w-4" />
          Return Home
        </button>
      </div>
    </div>
  );
}
