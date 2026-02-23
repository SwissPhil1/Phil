import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");

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
    },
  });

  return NextResponse.json(chapters);
}
