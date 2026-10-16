import React, { ReactNode } from 'react';
import { ErrorSkeleton } from './ui/ErrorSkeleton';
import { logger } from '../lib/logger';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode | ((props: { error: Error; resetErrorBoundary: () => void }) => ReactNode);
  onReset?: () => void;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('Uncaught error', error, { componentStack: errorInfo.componentStack?.slice(0, 500) });
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  public resetErrorBoundary = () => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null
    });
  };

  public render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      
      if (typeof fallback === 'function') {
        return fallback({
             error: this.state.error!,
             resetErrorBoundary: this.resetErrorBoundary
        });
      }
      
      if (fallback !== undefined) {
        return fallback;
      }

      // Default fallback
      return <ErrorSkeleton error={this.state.error} resetErrorBoundary={this.resetErrorBoundary} />;
    }

    return this.props.children;
  }
}
