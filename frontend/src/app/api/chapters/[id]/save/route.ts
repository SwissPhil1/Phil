import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chapterId = parseInt(id, 10);

  if (isNaN(chapterId)) {
    return NextResponse.json({ error: "Invalid chapter ID" }, { status: 400 });
  }

  const body = await request.json();
  const { studyGuide } = body;

  if (typeof studyGuide !== "string") {
    return NextResponse.json({ error: "studyGuide must be a string" }, { status: 400 });
  }

  await prisma.chapter.update({
    where: { id: chapterId },
    data: { studyGuide },
  });

  return NextResponse.json({ success: true });
}
