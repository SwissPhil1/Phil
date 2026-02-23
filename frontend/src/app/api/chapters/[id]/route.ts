import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chapterId = parseInt(id, 10);

  if (isNaN(chapterId)) {
    return NextResponse.json({ error: "Invalid chapter ID" }, { status: 400 });
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: {
      questions: {
        select: {
          id: true,
          questionText: true,
          difficulty: true,
          category: true,
        },
      },
      flashcards: {
        select: {
          id: true,
          front: true,
          category: true,
        },
      },
    },
  });

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  return NextResponse.json(chapter);
}
