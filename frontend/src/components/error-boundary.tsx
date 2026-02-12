"use client";

import { Component, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorCount: prev.errorCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isNetwork =
        this.state.error?.message?.includes("fetch") ||
        this.state.error?.message?.includes("network") ||
        this.state.error?.message?.includes("502");

      return (
        <div className="p-8 flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <div className="text-center max-w-md">
            <h2 className="text-lg font-bold mb-2">
              {isNetwork ? "Connection Error" : "Something went wrong"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isNetwork
                ? "Unable to reach the backend server. It may be starting up or temporarily unavailable."
                : this.state.error?.message || "An unexpected error occurred while rendering this page."}
            </p>
            {this.state.errorCount > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Retry attempt {this.state.errorCount}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
            <Link
              href="/"
              className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors"
            >
              <Home className="w-4 h-4" />
              Go home
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
