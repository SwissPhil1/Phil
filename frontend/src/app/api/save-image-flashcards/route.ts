import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Save image-based flashcards after user review.
 * Finds or creates a chapter with bookSource "image_cases" for the given organ.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { organ, modality, cards } = body as {
      organ: string;
      modality: string;
      cards: Array<{
        front: string;
        back: string;
        imageDataUri?: string;
        backImageDataUri?: string;
      }>;
    };

    if (!organ || !cards || cards.length === 0) {
      return NextResponse.json({ error: "Missing organ or cards" }, { status: 400 });
    }

    // Find or create chapter for image cases
    let chapter = await prisma.chapter.findFirst({
      where: { bookSource: "image_cases", organ },
    });

    if (!chapter) {
      // Find max number among image_cases chapters to auto-increment
      const maxChapter = await prisma.chapter.findFirst({
        where: { bookSource: "image_cases" },
        orderBy: { number: "desc" },
      });
      const nextNumber = (maxChapter?.number ?? 0) + 1;

      chapter = await prisma.chapter.create({
        data: {
          bookSource: "image_cases",
          number: nextNumber,
          title: `Image Cases — ${organ}`,
          organ,
        },
      });
    }

    // Create flashcards
    const category = `imaging:${modality}`;
    const created = await prisma.flashcard.createMany({
      data: cards.map((card) => ({
        chapterId: chapter!.id,
        front: card.front,
        back: card.back,
        category,
        imageUrl: card.imageDataUri || null,
        backImageUrl: card.backImageDataUri || null,
      })),
    });

    return NextResponse.json({
      success: true,
      count: created.count,
      chapterId: chapter.id,
    });
  } catch (error) {
    console.error("Save image flashcards error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 500 }
    );
  }
}
