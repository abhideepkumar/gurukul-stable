import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
      <div className="rounded-full bg-error/10 p-4 mb-4">
        <span className="material-symbols-outlined text-[40px] text-error">error</span>
      </div>
      <h2 className="text-2xl font-headline font-semibold text-primary mb-2">{title}</h2>
      <p className="text-primary/70 font-body mb-2 max-w-md">{message}</p>
      
      <div className="bg-primary/5 px-4 py-3 rounded-2xl mb-6 w-full max-w-md border border-primary/10">
        <div className="text-xs text-primary/50 font-mono mb-1 uppercase tracking-wider text-left">Error Path</div>
        <div className="text-sm text-primary font-mono text-left break-all">
          {location.pathname}
        </div>
        {error && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            <div className="text-xs text-primary/50 font-mono mb-1 uppercase tracking-wider text-left">Error Details</div>
            <div className="text-sm text-error font-mono text-left break-words">
              {error.message || String(error)}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 justify-center">
        <button
          onClick={resetErrorBoundary ? resetErrorBoundary : () => window.location.reload()}
          className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-white rounded-full hover:bg-primary/90 editorial-shadow transition-all hover:scale-105 font-medium text-sm"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Try Again
        </button>
        <button
          onClick={() => {
            if (resetErrorBoundary) resetErrorBoundary();
            navigate('/', { replace: true });
          }}
          className="inline-flex items-center gap-2 px-8 py-3 bg-surface text-primary border border-primary/20 rounded-full hover:bg-primary/5 transition-all font-medium text-sm"
        >
          <span className="material-symbols-outlined text-[18px]">home</span>
          Return Home
        </button>
      </div>
    </div>
  );
}
