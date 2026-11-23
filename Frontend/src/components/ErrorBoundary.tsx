import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="surface-panel rounded-xl p-8 text-center space-y-3 border border-amber-200 bg-amber-50/40">
          <h3 className="font-display text-base font-semibold text-slate-900">
            {this.props.fallbackTitle || 'Unable to display this view'}
          </h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            {this.state.error?.message || 'An unexpected rendering error occurred. Please refresh the telemetry view.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="inline-flex items-center rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
          >
            Retry View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
