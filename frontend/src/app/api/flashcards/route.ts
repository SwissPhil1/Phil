import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chapterId = searchParams.get("chapterId");
  const mode = searchParams.get("mode") || "due"; // "due" or "all"
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  const where: Record<string, unknown> = {};
  if (chapterId) where.chapterId = parseInt(chapterId, 10);

  if (mode === "due") {
    // Get flashcards that are due for review (never reviewed or nextReview <= now)
    const flashcards = await prisma.flashcard.findMany({
      where,
      include: {
        chapter: {
          select: { title: true, bookSource: true, number: true },
        },
        reviews: {
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });

    const now = new Date();
    const dueCards = flashcards.filter((card) => {
      if (card.reviews.length === 0) return true;
      return new Date(card.reviews[0].nextReview) <= now;
    });

    // Shuffle and limit
    const shuffled = dueCards.sort(() => Math.random() - 0.5).slice(0, limit);

    return NextResponse.json(shuffled);
  }

  // All flashcards for a chapter
  const flashcards = await prisma.flashcard.findMany({
    where,
    take: limit,
    include: {
      chapter: {
        select: { title: true, bookSource: true, number: true },
      },
      reviews: {
        orderBy: { reviewedAt: "desc" },
        take: 1,
      },
    },
  });

  return NextResponse.json(flashcards);
}
