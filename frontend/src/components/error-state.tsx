"use client";

import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  error: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorState({ error, onRetry, compact }: ErrorStateProps) {
  const isNetwork =
    error.includes("fetch") ||
    error.includes("network") ||
    error.includes("502") ||
    error.includes("Backend unavailable");

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
        {isNetwork ? (
          <WifiOff className="w-4 h-4 text-red-400 shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
        )}
        <span className="text-sm text-red-400 flex-1">
          {isNetwork ? "Backend unavailable" : error}
        </span>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className="border-red-500/20">
      <CardContent className="py-12 flex flex-col items-center gap-4">
        {isNetwork ? (
          <WifiOff className="w-8 h-8 text-red-400" />
        ) : (
          <AlertTriangle className="w-8 h-8 text-red-400" />
        )}
        <div className="text-center">
          <div className="font-medium text-sm mb-1">
            {isNetwork
              ? "Cannot reach the backend"
              : "Something went wrong"}
          </div>
          <p className="text-xs text-muted-foreground max-w-sm">
            {isNetwork
              ? "The API server may be starting up or experiencing issues. Railway free-tier services sleep after inactivity."
              : error}
          </p>
        </div>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface RefreshIndicatorProps {
  refreshIn: number | null;
}

export function RefreshIndicator({ refreshIn }: RefreshIndicatorProps) {
  if (refreshIn == null) return null;
  return (
    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
      refresh in {refreshIn}s
    </span>
  );
}
