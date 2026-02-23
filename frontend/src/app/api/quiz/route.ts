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

  const questions = await prisma.question.findMany({
    where,
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      chapter: {
        select: { title: true, bookSource: true, number: true },
      },
    },
  });

  // Shuffle questions
  const shuffled = questions.sort(() => Math.random() - 0.5);

  return NextResponse.json(shuffled);
}
