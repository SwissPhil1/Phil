"use client";

import { useState, useEffect, useCallback } from "react";
import {
  db,
  type OfflineChapter,
  type OfflineFlashcard,
  setLastSyncTime,
  getOfflineStats,
} from "@/lib/offline-db";

// ── Online/offline status ───────────────────────────────────────────────────

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Set initial state
    setIsOnline(navigator.onLine);

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline;
}

// ── Download all data for offline use ───────────────────────────────────────

export interface DownloadProgress {
  phase: "idle" | "chapters" | "study-guides" | "flashcards" | "done" | "error";
  current: number;
  total: number;
  message: string;
}

export function useOfflineDownload() {
  const [progress, setProgress] = useState<DownloadProgress>({
    phase: "idle",
    current: 0,
    total: 0,
    message: "",
  });
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getOfflineStats>> | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const s = await getOfflineStats();
      setStats(s);
    } catch {
      // IndexedDB not available
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const download = useCallback(async () => {
    try {
      // Phase 1: Download chapter list
      setProgress({ phase: "chapters", current: 0, total: 0, message: "Downloading chapters..." });
      const chaptersRes = await fetch("/api/chapters?stats=1");
      if (!chaptersRes.ok) throw new Error("Failed to fetch chapters");
      const chapters: Array<{
        id: number;
        bookSource: string;
        number: number;
        title: string;
        organ: string | null;
        summary: string | null;
        lastStudiedAt: string | null;
        _count: { questions: number; flashcards: number };
      }> = await chaptersRes.json();

      // Filter out image cases
      const studyChapters = chapters.filter((ch) => ch.bookSource !== "image_cases");
      setProgress({
        phase: "chapters",
        current: studyChapters.length,
        total: studyChapters.length,
        message: `Found ${studyChapters.length} chapters`,
      });

      // Phase 2: Download full study guides for each chapter
      setProgress({
        phase: "study-guides",
        current: 0,
        total: studyChapters.length,
        message: "Downloading study guides...",
      });

      for (let i = 0; i < studyChapters.length; i++) {
        const ch = studyChapters[i];
        let studyGuide: string | null = null;

        try {
          const detailRes = await fetch(`/api/chapters/${ch.id}`);
          if (detailRes.ok) {
            const detail = await detailRes.json();
            studyGuide = detail.studyGuide || null;
          }
        } catch {
          // Skip this chapter's study guide
        }

        const offlineCh: OfflineChapter = {
          id: ch.id,
          bookSource: ch.bookSource,
          number: ch.number,
          title: ch.title,
          organ: ch.organ,
          summary: ch.summary,
          studyGuide,
          lastStudiedAt: ch.lastStudiedAt,
          questionCount: ch._count.questions,
          flashcardCount: ch._count.flashcards,
        };
        await db.chapters.put(offlineCh);

        setProgress({
          phase: "study-guides",
          current: i + 1,
          total: studyChapters.length,
          message: `Study guides: ${i + 1}/${studyChapters.length}`,
        });
      }

      // Phase 3: Download all flashcards
      setProgress({ phase: "flashcards", current: 0, total: 0, message: "Downloading flashcards..." });
      const flashcardsRes = await fetch("/api/flashcards?mode=all&limit=10000");
      if (flashcardsRes.ok) {
        const flashcards: Array<{
          id: number;
          chapterId: number;
          front: string;
          back: string;
          reviews?: Array<{
            nextReview: string;
            interval: number;
            easeFactor: number;
            repetitions: number;
          }>;
        }> = await flashcardsRes.json();

        const offlineCards: OfflineFlashcard[] = flashcards.map((fc) => {
          const latestReview = fc.reviews?.[0];
          return {
            id: fc.id,
            chapterId: fc.chapterId,
            front: fc.front,
            back: fc.back,
            nextReview: latestReview?.nextReview ?? null,
            interval: latestReview?.interval ?? 0,
            easeFactor: latestReview?.easeFactor ?? 2.5,
            repetitions: latestReview?.repetitions ?? 0,
          };
        });

        await db.flashcards.clear();
        await db.flashcards.bulkPut(offlineCards);

        setProgress({
          phase: "flashcards",
          current: flashcards.length,
          total: flashcards.length,
          message: `${flashcards.length} flashcards downloaded`,
        });
      }

      // Phase 4: Pre-cache page bundles for offline navigation
      setProgress({ phase: "flashcards", current: 0, total: 0, message: "Caching pages for offline..." });
      try {
        // Fetch a chapter detail page to cache the JS chunks needed for /chapters/[id]
        if (studyChapters.length > 0) {
          await fetch(`/chapters/${studyChapters[0].id}`, { credentials: "same-origin" });
        }
        // Also cache dashboard and flashcards pages
        await Promise.allSettled([
          fetch("/", { credentials: "same-origin" }),
          fetch("/flashcards", { credentials: "same-origin" }),
          fetch("/chapters", { credentials: "same-origin" }),
        ]);
      } catch {
        // Non-critical — pages may already be cached
      }

      // Done
      await setLastSyncTime(new Date());
      await loadStats();
      setProgress({
        phase: "done",
        current: 0,
        total: 0,
        message: "Download complete! App is ready for offline use.",
      });
    } catch (err) {
      setProgress({
        phase: "error",
        current: 0,
        total: 0,
        message: err instanceof Error ? err.message : "Download failed",
      });
    }
  }, [loadStats]);

  return { progress, download, stats };
}

// ── Offline data access ─────────────────────────────────────────────────────

export async function getOfflineChapters(): Promise<OfflineChapter[]> {
  return db.chapters.toArray();
}

export async function getOfflineChapter(id: number): Promise<OfflineChapter | undefined> {
  return db.chapters.get(id);
}

export async function getOfflineFlashcards(chapterId?: number): Promise<OfflineFlashcard[]> {
  if (chapterId) {
    return db.flashcards.where("chapterId").equals(chapterId).toArray();
  }
  return db.flashcards.toArray();
}

export async function getOfflineFlashcardsForReview(limit = 20): Promise<OfflineFlashcard[]> {
  const now = new Date().toISOString();
  // Get cards due for review (nextReview <= now or null)
  const allCards = await db.flashcards.toArray();
  const dueCards = allCards
    .filter((c) => !c.nextReview || c.nextReview <= now)
    .sort((a, b) => {
      // Prioritize: never reviewed > oldest due
      if (!a.nextReview && b.nextReview) return -1;
      if (a.nextReview && !b.nextReview) return 1;
      if (a.nextReview && b.nextReview) return a.nextReview.localeCompare(b.nextReview);
      return 0;
    });
  return dueCards.slice(0, limit);
}

/** Queue a flashcard review for later sync */
export async function queueOfflineReview(flashcardId: number, quality: number): Promise<void> {
  await db.pendingReviews.add({
    flashcardId,
    quality,
    reviewedAt: new Date().toISOString(),
  });

  // Also update the local flashcard's next review date (simplified SM-2)
  const card = await db.flashcards.get(flashcardId);
  if (card) {
    let { interval, easeFactor, repetitions } = card;
    if (quality >= 3) {
      repetitions += 1;
      if (repetitions === 1) interval = 1;
      else if (repetitions === 2) interval = 6;
      else interval = Math.round(interval * easeFactor);
    } else {
      repetitions = 0;
      interval = 1;
    }
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);

    await db.flashcards.update(flashcardId, {
      interval,
      easeFactor,
      repetitions,
      nextReview: nextReview.toISOString(),
    });
  }
}

// ── Sync pending reviews ────────────────────────────────────────────────────

export async function syncPendingReviews(): Promise<{ synced: number; failed: number }> {
  const pending = await db.pendingReviews.toArray();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const review of pending) {
    try {
      const res = await fetch("/api/flashcards/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flashcardId: review.flashcardId,
          quality: review.quality,
        }),
      });
      if (res.ok) {
        await db.pendingReviews.delete(review.id!);
        synced++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}
