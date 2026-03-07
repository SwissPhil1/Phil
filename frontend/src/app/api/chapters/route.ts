import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const withStats = searchParams.get("stats") === "1";

  const where = book ? { bookSource: book } : {};

  const chapters = await prisma.chapter.findMany({
    where,
    orderBy: [{ bookSource: "asc" }, { number: "asc" }],
    include: {
      _count: {
        select: {
          questions: true,
          flashcards: true,
        },
      },
      ...(withStats
        ? {
            questions: {
              select: {
                id: true,
                attempts: {
                  select: { isCorrect: true },
                  orderBy: { attemptedAt: "desc" as const },
                  take: 1, // latest attempt per question
                },
              },
            },
          }
        : {}),
    },
  });

  if (withStats) {
    // Compute quiz accuracy per chapter from latest attempts
    const enriched = chapters.map((ch) => {
      const questions = (ch as typeof ch & { questions?: { id: number; attempts: { isCorrect: boolean }[] }[] }).questions;
      let quizAccuracy: number | null = null;
      let totalAttempted = 0;
      let totalCorrect = 0;

      if (questions) {
        for (const q of questions) {
          if (q.attempts.length > 0) {
            totalAttempted++;
            if (q.attempts[0].isCorrect) totalCorrect++;
          }
        }
        if (totalAttempted > 0) {
          quizAccuracy = Math.round((totalCorrect / totalAttempted) * 100);
        }
      }

      // Strip verbose questions from response
      const { questions: _q, ...rest } = ch as typeof ch & { questions?: unknown };
      return { ...rest, quizAccuracy, questionsAttempted: totalAttempted };
    });

    return NextResponse.json(enriched);
  }

  return NextResponse.json(chapters);
}

/**
 * Batch-update organ field for multiple chapters.
 * Body: { updates: Array<{ id: number; organ: string }> }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { updates } = body;

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "updates array is required" }, { status: 400 });
  }

  const results = await Promise.all(
    updates.map(({ id, organ }: { id: number; organ: string }) =>
      prisma.chapter.update({
        where: { id },
        data: { organ },
        select: { id: true, title: true, organ: true },
      })
    )
  );

  return NextResponse.json({ updated: results });
}
