import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  // Get all chapters with their organ, questions, and attempts
  const chapters = await prisma.chapter.findMany({
    include: {
      questions: {
        include: {
          attempts: true,
        },
      },
      flashcards: {
        include: {
          reviews: {
            orderBy: { reviewedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  // Build per-organ stats
  const organStats: Record<string, {
    organ: string;
    totalQuestions: number;
    attempted: number;
    correct: number;
    accuracy: number | null;
    totalFlashcards: number;
    dueFlashcards: number;
    avgEaseFactor: number | null;
    chapters: string[];
  }> = {};

  const categoryStats: Record<string, {
    category: string;
    totalQuestions: number;
    attempted: number;
    correct: number;
    accuracy: number | null;
  }> = {};

  const now = new Date();

  for (const ch of chapters) {
    const organKey = ch.organ || ch.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").substring(0, 30);
    const organLabel = ch.organ || ch.title;

    if (!organStats[organKey]) {
      organStats[organKey] = {
        organ: organLabel,
        totalQuestions: 0,
        attempted: 0,
        correct: 0,
        accuracy: null,
        totalFlashcards: 0,
        dueFlashcards: 0,
        avgEaseFactor: null,
        chapters: [],
      };
    }

    const stat = organStats[organKey];
    stat.chapters.push(ch.title);

    for (const q of ch.questions) {
      stat.totalQuestions++;
      if (q.attempts.length > 0) {
        stat.attempted++;
        // Use latest attempt
        const latest = q.attempts.sort(
          (a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime()
        )[0];
        if (latest.isCorrect) stat.correct++;
      }

      // Category stats
      const cat = q.category || "uncategorized";
      if (!categoryStats[cat]) {
        categoryStats[cat] = { category: cat, totalQuestions: 0, attempted: 0, correct: 0, accuracy: null };
      }
      categoryStats[cat].totalQuestions++;
      if (q.attempts.length > 0) {
        categoryStats[cat].attempted++;
        const latest = q.attempts.sort(
          (a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime()
        )[0];
        if (latest.isCorrect) categoryStats[cat].correct++;
      }
    }

    // Flashcard stats
    const easeFactors: number[] = [];
    for (const fc of ch.flashcards) {
      stat.totalFlashcards++;
      if (fc.reviews.length === 0 || new Date(fc.reviews[0].nextReview) <= now) {
        stat.dueFlashcards++;
      }
      if (fc.reviews.length > 0) {
        easeFactors.push(fc.reviews[0].easeFactor);
      }
    }
    if (easeFactors.length > 0) {
      stat.avgEaseFactor = Math.round(
        (easeFactors.reduce((a, b) => a + b, 0) / easeFactors.length) * 100
      ) / 100;
    }
  }

  // Calculate accuracy for each group
  for (const stat of Object.values(organStats)) {
    stat.accuracy = stat.attempted > 0 ? Math.round((stat.correct / stat.attempted) * 100) : null;
  }
  for (const stat of Object.values(categoryStats)) {
    stat.accuracy = stat.attempted > 0 ? Math.round((stat.correct / stat.attempted) * 100) : null;
  }

  // Sort organs by accuracy (worst first = areas needing most work)
  const weakAreas = Object.values(organStats)
    .filter((s) => s.attempted > 0)
    .sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100));

  const strongAreas = Object.values(organStats)
    .filter((s) => s.attempted > 0)
    .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));

  // Recent activity (last 7 days)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentAttempts = await prisma.questionAttempt.count({
    where: { attemptedAt: { gte: weekAgo } },
  });
  const recentCorrect = await prisma.questionAttempt.count({
    where: { attemptedAt: { gte: weekAgo }, isCorrect: true },
  });
  const recentReviews = await prisma.flashcardReview.count({
    where: { reviewedAt: { gte: weekAgo } },
  });

  return NextResponse.json({
    weakAreas: weakAreas.slice(0, 10),
    strongAreas: strongAreas.slice(0, 5),
    categoryStats: Object.values(categoryStats).sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100)),
    allOrgans: Object.values(organStats),
    recentActivity: {
      attempts: recentAttempts,
      correct: recentCorrect,
      accuracy: recentAttempts > 0 ? Math.round((recentCorrect / recentAttempts) * 100) : null,
      flashcardsReviewed: recentReviews,
    },
  });
}
