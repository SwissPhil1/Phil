"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOffline";

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white text-center text-sm py-1.5 px-4 md:ml-64">
      <WifiOff className="h-3.5 w-3.5 inline mr-2" />
      Mode hors ligne — données depuis le dernier téléchargement
    </div>
  );
}
