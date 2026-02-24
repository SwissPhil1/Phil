import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/sources
 *
 * Create or update a source (book) record.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, bookSource, totalPages } = body;

    if (!name || !bookSource) {
      return NextResponse.json({ error: "Missing name or bookSource" }, { status: 400 });
    }

    const source = await prisma.source.upsert({
      where: { bookSource: String(bookSource) },
      update: { name: String(name), totalPages: Number(totalPages) || 0 },
      create: { name: String(name), bookSource: String(bookSource), totalPages: Number(totalPages) || 0 },
    });

    return NextResponse.json(source);
  } catch (error: unknown) {
    console.error("Create source error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/sources
 *
 * Returns all uploaded sources with chapter counts and content status.
 */
export async function GET() {
  try {
    const sources = await prisma.source.findMany({
      orderBy: { createdAt: "asc" },
    });

    // Get chapter counts per book source
    const chapters = await prisma.chapter.groupBy({
      by: ["bookSource"],
      _count: { id: true },
    });

    // Get chapters with content (have questions or study guide)
    const chaptersWithContent = await prisma.chapter.findMany({
      select: {
        bookSource: true,
        id: true,
        pdfBlobUrls: true,
        studyGuide: true,
        _count: { select: { questions: true } },
      },
    });

    const chapterCountMap = new Map(chapters.map((c) => [c.bookSource, c._count.id]));

    const contentCountMap = new Map<string, { stored: number; generated: number }>();
    for (const ch of chaptersWithContent) {
      const entry = contentCountMap.get(ch.bookSource) || { stored: 0, generated: 0 };
      const hasBlobs = ch.pdfBlobUrls && JSON.parse(ch.pdfBlobUrls).length > 0;
      if (hasBlobs) entry.stored++;
      if (ch._count.questions > 0 || ch.studyGuide) entry.generated++;
      contentCountMap.set(ch.bookSource, entry);
    }

    const result = sources.map((s) => ({
      ...s,
      chaptersStored: chapterCountMap.get(s.bookSource) || 0,
      chaptersWithContent: contentCountMap.get(s.bookSource)?.generated || 0,
      chaptersWithBlobs: contentCountMap.get(s.bookSource)?.stored || 0,
    }));

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Sources error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
