/**
 * Offline-aware fetch wrapper.
 * When online: uses normal fetch.
 * When offline: reads from IndexedDB for known API patterns.
 */
import { db } from "@/lib/offline-db";

/** Check if we're offline */
function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/**
 * Fetch with offline fallback.
 * Intercepts known API routes and returns data from IndexedDB when offline.
 */
export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  // Only intercept GET requests when offline
  if (!isOffline() || (init?.method && init.method !== "GET")) {
    return fetch(input, init);
  }

  // Try online first (might work in some offline scenarios)
  try {
    const res = await fetch(input, init);
    if (res.ok) return res;
  } catch {
    // Network failed — fall through to offline
  }

  // ── Offline handlers for known API routes ──────────────────────────────

  // GET /api/chapters?stats=1
  if (url.includes("/api/chapters") && !url.match(/\/api\/chapters\/\d+/)) {
    const chapters = await db.chapters.toArray();
    const mapped = chapters.map((ch) => ({
      id: ch.id,
      bookSource: ch.bookSource,
      number: ch.number,
      title: ch.title,
      organ: ch.organ,
      summary: ch.summary,
      lastStudiedAt: ch.lastStudiedAt,
      _count: { questions: ch.questionCount, flashcards: ch.flashcardCount },
      quizAccuracy: null,
      questionsAttempted: 0,
    }));
    return jsonResponse(mapped);
  }

  // GET /api/chapters/:id
  const chapterMatch = url.match(/\/api\/chapters\/(\d+)/);
  if (chapterMatch) {
    const id = parseInt(chapterMatch[1], 10);
    const chapter = await db.chapters.get(id);
    if (chapter) {
      return jsonResponse({
        id: chapter.id,
        bookSource: chapter.bookSource,
        number: chapter.number,
        title: chapter.title,
        organ: chapter.organ,
        summary: chapter.summary,
        studyGuide: chapter.studyGuide,
        keyPoints: null,
        highYield: null,
        mnemonics: null,
        pdfChunkCount: 0,
        estimatedPages: 0,
        sourceChapterId: null,
        sourceChapter: null,
        relatedChapters: [],
        questions: [],
        flashcards: [],
      });
    }
  }

  // GET /api/flashcards
  if (url.includes("/api/flashcards")) {
    const urlObj = new URL(url, "http://localhost");
    const mode = urlObj.searchParams.get("mode") || "due";
    const chapterId = urlObj.searchParams.get("chapterId");

    if (mode === "stats") {
      const allCards = await db.flashcards.toArray();
      const now = new Date();
      const dueCount = allCards.filter((c) => !c.nextReview || new Date(c.nextReview) <= now).length;
      return jsonResponse({
        counts: { new: 0, learning: 0, due: dueCount, reviewDue: dueCount, mature: 0, total: allCards.length },
        streak: 0,
        xp: { total: 0, today: 0 },
        newCardsToday: 0,
        organDueCounts: {},
        organStats: {},
        weakestOrgan: null,
        weeklyHistory: [],
      });
    }

    let cards = await db.flashcards.toArray();
    if (chapterId) {
      cards = cards.filter((c) => c.chapterId === parseInt(chapterId, 10));
    }

    if (mode === "due") {
      const now = new Date().toISOString();
      cards = cards
        .filter((c) => !c.nextReview || c.nextReview <= now)
        .slice(0, 50);
    }

    const mapped = cards.map((c) => ({
      id: c.id,
      chapterId: c.chapterId,
      front: c.front,
      back: c.back,
      isNew: c.repetitions === 0,
      system: null,
      chapter: { title: "", bookSource: "", number: 0, organ: null },
      reviews: c.nextReview
        ? [{ nextReview: c.nextReview, interval: c.interval, easeFactor: c.easeFactor, repetitions: c.repetitions }]
        : [],
    }));
    return jsonResponse(mapped);
  }

  // GET /api/progress
  if (url.includes("/api/progress")) {
    const chapters = await db.chapters.toArray();
    const allCards = await db.flashcards.toArray();
    const now = new Date();
    const dueCount = allCards.filter((c) => !c.nextReview || new Date(c.nextReview) <= now).length;
    const totalQuestions = chapters.reduce((sum, ch) => sum + ch.questionCount, 0);
    const totalFlashcards = allCards.length;

    return jsonResponse({
      overview: {
        totalChapters: chapters.length,
        totalQuestions,
        totalFlashcards,
        totalAttempts: 0,
        correctAttempts: 0,
        accuracy: null,
        totalReviews: 0,
        dueFlashcards: dueCount,
      },
      chapterProgress: chapters.map((ch) => ({
        id: ch.id,
        title: ch.title,
        bookSource: ch.bookSource,
        number: ch.number,
        totalQuestions: ch.questionCount,
        totalFlashcards: ch.flashcardCount,
        questionsAttempted: 0,
        questionsCorrect: 0,
        accuracy: null,
      })),
    });
  }

  // GET /api/taxonomy
  if (url.includes("/api/taxonomy")) {
    // Return empty array — taxonomy cached in state anyway
    return jsonResponse([]);
  }

  // Fallback: return offline error
  return new Response(
    JSON.stringify({ error: "You are offline and this data is not cached" }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
