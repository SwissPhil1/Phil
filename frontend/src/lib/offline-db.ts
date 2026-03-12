import Dexie, { type EntityTable } from "dexie";

// ── Types matching the remote API shapes ────────────────────────────────────

export interface OfflineChapter {
  id: number;
  bookSource: string;
  number: number;
  title: string;
  organ: string | null;
  summary: string | null;
  studyGuide: string | null;
  lastStudiedAt: string | null;
  questionCount: number;
  flashcardCount: number;
}

export interface OfflineFlashcard {
  id: number;
  chapterId: number;
  front: string;
  back: string;
  nextReview: string | null;
  interval: number;
  easeFactor: number;
  repetitions: number;
}

export interface PendingReview {
  id?: number; // auto-incremented
  flashcardId: number;
  quality: number;
  reviewedAt: string;
}

export interface OfflineMeta {
  key: string;
  value: string;
}

// ── Database definition ─────────────────────────────────────────────────────

class RadioReviseDB extends Dexie {
  chapters!: EntityTable<OfflineChapter, "id">;
  flashcards!: EntityTable<OfflineFlashcard, "id">;
  pendingReviews!: EntityTable<PendingReview, "id">;
  meta!: EntityTable<OfflineMeta, "key">;

  constructor() {
    super("RadioReviseOffline");
    this.version(1).stores({
      chapters: "id, bookSource, organ",
      flashcards: "id, chapterId, nextReview",
      pendingReviews: "++id, flashcardId",
      meta: "key",
    });
  }
}

export const db = new RadioReviseDB();

// ── Helpers ─────────────────────────────────────────────────────────────────

export async function getLastSyncTime(): Promise<Date | null> {
  const meta = await db.meta.get("lastSyncTime");
  return meta ? new Date(meta.value) : null;
}

export async function setLastSyncTime(date: Date): Promise<void> {
  await db.meta.put({ key: "lastSyncTime", value: date.toISOString() });
}

export async function clearOfflineData(): Promise<void> {
  await db.chapters.clear();
  await db.flashcards.clear();
  await db.pendingReviews.clear();
  await db.meta.delete("lastSyncTime");
}

export async function getOfflineStats(): Promise<{
  chapters: number;
  flashcards: number;
  pendingReviews: number;
  lastSync: Date | null;
}> {
  const [chapters, flashcards, pendingReviews, lastSync] = await Promise.all([
    db.chapters.count(),
    db.flashcards.count(),
    db.pendingReviews.count(),
    getLastSyncTime(),
  ]);
  return { chapters, flashcards, pendingReviews, lastSync };
}
