import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chapterId = searchParams.get("chapterId");

  if (!chapterId) {
    return NextResponse.json({ error: "Missing chapterId" }, { status: 400 });
  }

  const notes = await prisma.chapterNote.findMany({
    where: { chapterId: parseInt(chapterId, 10) },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(notes);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;

  if (action === "create") {
    const { chapterId, content, imageUrl, color } = body;
    if (!chapterId || !content) {
      return NextResponse.json({ error: "Missing chapterId or content" }, { status: 400 });
    }

    const note = await prisma.chapterNote.create({
      data: {
        chapterId,
        content,
        imageUrl: imageUrl || null,
        color: color || "yellow",
      },
    });
    return NextResponse.json(note);
  }

  if (action === "update") {
    const { id, content, imageUrl, color } = body;
    if (!id) {
      return NextResponse.json({ error: "Missing note id" }, { status: 400 });
    }

    const note = await prisma.chapterNote.update({
      where: { id },
      data: {
        ...(content !== undefined && { content }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(color !== undefined && { color }),
      },
    });
    return NextResponse.json(note);
  }

  if (action === "delete") {
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "Missing note id" }, { status: 400 });
    }

    await prisma.chapterNote.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
