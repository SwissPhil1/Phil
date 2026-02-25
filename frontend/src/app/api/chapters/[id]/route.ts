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

  // Count stored PDF chunks for this chapter (each chunk ≈ 3 pages)
  const pdfChunkCount = await prisma.pdfChunk.count({
    where: { bookSource: chapter.bookSource, chapterNum: chapter.number },
  });
  const estimatedPages = pdfChunkCount * 3;

  // Find matching chapters from other books (same logic as merge)
  const titleStopWords = [
    "chapter", "section", "part", "the", "and", "for", "with", "from",
    "imaging", "radiology", "radiologic", "radiological", "diagnostic",
    "introduction", "overview", "principles", "approach", "review",
  ];
  const titleWords = chapter.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w: string) => w.length > 3 && !titleStopWords.includes(w));

  const relatedChapters = titleWords.length > 0
    ? await prisma.chapter.findMany({
        where: {
          bookSource: { not: chapter.bookSource },
          AND: titleWords.map((word: string) => ({
            title: { contains: word, mode: "insensitive" as const },
          })),
        },
        select: { id: true, bookSource: true, number: true, title: true },
      })
    : [];

  // Get chunk counts for related chapters too
  const relatedWithPages = await Promise.all(
    relatedChapters.map(async (rc) => {
      const chunks = await prisma.pdfChunk.count({
        where: { bookSource: rc.bookSource, chapterNum: rc.number },
      });
      return { ...rc, pdfChunkCount: chunks, estimatedPages: chunks * 3 };
    })
  );

  return NextResponse.json({
    ...chapter,
    pdfChunkCount,
    estimatedPages,
    relatedChapters: relatedWithPages,
  });
}
