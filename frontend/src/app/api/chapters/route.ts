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
