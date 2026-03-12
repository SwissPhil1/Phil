"use client";

import { Download, Wifi, WifiOff, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOfflineDownload, useOnlineStatus, syncPendingReviews } from "@/hooks/useOffline";
import { useEffect, useState, useCallback } from "react";

export function OfflineDownloadButton() {
  const { progress, download, stats } = useOfflineDownload();
  const isOnline = useOnlineStatus();
  const [syncing, setSyncing] = useState(false);

  // Auto-sync when coming back online
  const doSync = useCallback(async () => {
    if (!isOnline || syncing) return;
    if (!stats || stats.pendingReviews === 0) return;
    setSyncing(true);
    try {
      await syncPendingReviews();
    } catch {
      // Retry later
    } finally {
      setSyncing(false);
    }
  }, [isOnline, syncing, stats]);

  useEffect(() => {
    doSync();
  }, [doSync]);

  const isDownloading = progress.phase !== "idle" && progress.phase !== "done" && progress.phase !== "error";

  const formatSyncTime = (date: Date | null) => {
    if (!date) return null;
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `il y a ${hours}h`;
    const days = Math.floor(hours / 24);
    return `il y a ${days}j`;
  };

  return (
    <div className="space-y-2">
      {/* Online/Offline indicator */}
      <div className="flex items-center gap-2 text-xs">
        {isOnline ? (
          <>
            <Wifi className="h-3 w-3 text-green-500" />
            <span className="text-green-600">En ligne</span>
          </>
        ) : (
          <>
            <WifiOff className="h-3 w-3 text-orange-500" />
            <span className="text-orange-600">Hors ligne</span>
          </>
        )}
        {syncing && (
          <span className="text-blue-600 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Sync...
          </span>
        )}
      </div>

      {/* Download button */}
      <Button
        size="sm"
        variant="outline"
        className="w-full text-xs h-8 gap-1.5"
        onClick={download}
        disabled={isDownloading || !isOnline}
      >
        {isDownloading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {progress.message}
          </>
        ) : progress.phase === "done" ? (
          <>
            <Check className="h-3.5 w-3.5 text-green-600" />
            Prêt hors ligne
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5" />
            {stats && stats.chapters > 0
              ? "Mettre à jour hors ligne"
              : "Télécharger hors ligne"
            }
          </>
        )}
      </Button>

      {/* Progress bar */}
      {isDownloading && progress.total > 0 && (
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
          />
        </div>
      )}

      {/* Stats */}
      {stats && stats.chapters > 0 && !isDownloading && (
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <p>{stats.chapters} chapitres, {stats.flashcards} flashcards</p>
          {stats.lastSync && <p>Sync: {formatSyncTime(stats.lastSync)}</p>}
          {stats.pendingReviews > 0 && (
            <p className="text-orange-600">{stats.pendingReviews} reviews en attente</p>
          )}
        </div>
      )}

      {/* Error */}
      {progress.phase === "error" && (
        <p className="text-[10px] text-destructive">{progress.message}</p>
      )}
    </div>
  );
}
