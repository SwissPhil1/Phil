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
    const now = new Date();

    // Get flashcards that are due: never reviewed OR latest review's nextReview <= now
    // Filter at DB level using OR condition instead of loading all into memory
    const dueCards = await prisma.flashcard.findMany({
      where: {
        ...where,
        OR: [
          { reviews: { none: {} } },
          { reviews: { some: { nextReview: { lte: now } } } },
        ],
      },
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

    // Post-filter: for cards with reviews, ensure the LATEST review is actually due
    // (the DB query matches "some" review due, but we need the latest one to be due)
    const trulyDue = dueCards.filter((card) => {
      if (card.reviews.length === 0) return true;
      return new Date(card.reviews[0].nextReview) <= now;
    });

    // Fisher-Yates shuffle for unbiased randomization
    for (let i = trulyDue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [trulyDue[i], trulyDue[j]] = [trulyDue[j], trulyDue[i]];
    }

    return NextResponse.json(trulyDue.slice(0, limit));
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
