import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  // Get overall stats
  const [
    totalChapters,
    totalQuestions,
    totalFlashcards,
    totalAttempts,
    correctAttempts,
    totalReviews,
    dueFlashcards,
  ] = await Promise.all([
    prisma.chapter.count(),
    prisma.question.count(),
    prisma.flashcard.count(),
    prisma.questionAttempt.count(),
    prisma.questionAttempt.count({ where: { isCorrect: true } }),
    prisma.flashcardReview.count(),
    // Count flashcards that are due (never reviewed or overdue)
    prisma.flashcard.count({
      where: {
        OR: [
          { reviews: { none: {} } },
          {
            reviews: {
              some: {
                nextReview: { lte: new Date() },
              },
            },
          },
        ],
      },
    }),
  ]);

  // Per-chapter progress
  const chapters = await prisma.chapter.findMany({
    orderBy: [{ bookSource: "asc" }, { number: "asc" }],
    include: {
      _count: {
        select: { questions: true, flashcards: true },
      },
      questions: {
        include: {
          attempts: {
            orderBy: { attemptedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  const chapterProgress = chapters.map((ch) => {
    const attempted = ch.questions.filter((q) => q.attempts.length > 0).length;
    const correct = ch.questions.filter(
      (q) => q.attempts.length > 0 && q.attempts[0].isCorrect
    ).length;

    return {
      id: ch.id,
      title: ch.title,
      bookSource: ch.bookSource,
      number: ch.number,
      totalQuestions: ch._count.questions,
      totalFlashcards: ch._count.flashcards,
      questionsAttempted: attempted,
      questionsCorrect: correct,
      accuracy:
        attempted > 0 ? Math.round((correct / attempted) * 100) : null,
    };
  });

  return NextResponse.json({
    overview: {
      totalChapters,
      totalQuestions,
      totalFlashcards,
      totalAttempts,
      correctAttempts,
      accuracy:
        totalAttempts > 0
          ? Math.round((correctAttempts / totalAttempts) * 100)
          : null,
      totalReviews,
      dueFlashcards,
    },
    chapterProgress,
  });
}
