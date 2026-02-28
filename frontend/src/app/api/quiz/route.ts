import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chapterId = searchParams.get("chapterId");
  const difficulty = searchParams.get("difficulty");
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  const where: Record<string, unknown> = {};
  if (chapterId) where.chapterId = parseInt(chapterId, 10);
  if (difficulty) where.difficulty = difficulty;

  const allQuestions = await prisma.question.findMany({
    where,
    include: {
      chapter: {
        select: { title: true, bookSource: true, number: true },
      },
    },
  });

  // Fisher-Yates shuffle for unbiased randomization
  for (let i = allQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
  }

  return NextResponse.json(allQuestions.slice(0, limit));
}
