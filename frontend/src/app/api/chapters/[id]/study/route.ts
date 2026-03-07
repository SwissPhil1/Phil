import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

/** POST /api/chapters/[id]/study — mark chapter as studied now */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chapterId = parseInt(id, 10);
  if (isNaN(chapterId)) {
    return NextResponse.json({ error: "Invalid chapter ID" }, { status: 400 });
  }

  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const updated = await prisma.chapter.update({
    where: { id: chapterId },
    data: { lastStudiedAt: new Date() },
    select: { id: true, lastStudiedAt: true },
  });

  return NextResponse.json(updated);
}
