"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface LoadingSkeletonProps {
  variant?: "cards" | "table" | "feed" | "stats";
  count?: number;
}

function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`bg-muted/40 rounded animate-pulse ${className}`} />;
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 space-y-2">
        <SkeletonBar className="h-3 w-16" />
        <SkeletonBar className="h-8 w-12" />
        <SkeletonBar className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

function TableRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3 px-4 border-b border-border/20">
      <SkeletonBar className="h-4 w-32" />
      <SkeletonBar className="h-4 w-16" />
      <SkeletonBar className="h-4 w-20" />
      <SkeletonBar className="h-4 w-12" />
      <SkeletonBar className="h-4 w-16 ml-auto" />
    </div>
  );
}

function FeedItemSkeleton() {
  return (
    <div className="flex items-start gap-3 p-3 border-b border-border/20">
      <SkeletonBar className="w-8 h-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <SkeletonBar className="h-4 w-40" />
        <div className="flex gap-2">
          <SkeletonBar className="h-5 w-16 rounded-full" />
          <SkeletonBar className="h-4 w-12" />
        </div>
      </div>
      <div className="space-y-1 text-right">
        <SkeletonBar className="h-3 w-16 ml-auto" />
        <SkeletonBar className="h-4 w-12 ml-auto" />
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <SkeletonBar className="h-5 w-32" />
      </CardHeader>
      <CardContent className="space-y-3">
        <SkeletonBar className="h-4 w-full" />
        <SkeletonBar className="h-4 w-3/4" />
        <SkeletonBar className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

export function LoadingSkeleton({ variant = "cards", count = 4 }: LoadingSkeletonProps) {
  if (variant === "stats") {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (variant === "table") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <SkeletonBar className="h-5 w-40" />
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: count }).map((_, i) => (
            <TableRowSkeleton key={i} />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (variant === "feed") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <SkeletonBar className="h-5 w-32" />
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: count }).map((_, i) => (
            <FeedItemSkeleton key={i} />
          ))}
        </CardContent>
      </Card>
    );
  }

  // Default: cards grid
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
