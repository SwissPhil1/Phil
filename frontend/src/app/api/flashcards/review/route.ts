import { prisma } from "@/lib/prisma";
import { calculateSM2 } from "@/lib/sm2";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { flashcardId, quality } = body;

  if (flashcardId === undefined || quality === undefined) {
    return NextResponse.json(
      { error: "flashcardId and quality are required" },
      { status: 400 }
    );
  }

  if (typeof flashcardId !== "number" || typeof quality !== "number") {
    return NextResponse.json(
      { error: "flashcardId and quality must be numbers" },
      { status: 400 }
    );
  }

  if (quality < 0 || quality > 5) {
    return NextResponse.json(
      { error: "quality must be between 0 and 5" },
      { status: 400 }
    );
  }

  // Get the latest review for this flashcard
  const lastReview = await prisma.flashcardReview.findFirst({
    where: { flashcardId },
    orderBy: { reviewedAt: "desc" },
  });

  const previousEF = lastReview?.easeFactor ?? 2.5;
  const previousInterval = lastReview?.interval ?? 1;
  const previousReps = lastReview?.repetitions ?? 0;

  const result = calculateSM2(quality, previousEF, previousInterval, previousReps);

  const review = await prisma.flashcardReview.create({
    data: {
      flashcardId,
      quality,
      easeFactor: result.easeFactor,
      interval: result.interval,
      repetitions: result.repetitions,
      nextReview: result.nextReview,
    },
  });

  return NextResponse.json({
    ...review,
    nextReviewIn: `${result.interval} day${result.interval !== 1 ? "s" : ""}`,
  });
}
