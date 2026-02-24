import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * POST /api/store-pdf
 *
 * Stores a PDF chunk directly in the Postgres database.
 * No external blob storage needed — uses the DB you already have.
 *
 * Expects FormData with:
 *   - pdf: File (the PDF chunk)
 *   - bookSource: string (e.g. "core_radiology")
 *   - chapterNum: string (e.g. "1")
 *   - chunkIndex: string (e.g. "0")
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get("pdf") as File | null;
    const bookSource = formData.get("bookSource") as string | null;
    const chapterNum = parseInt(formData.get("chapterNum") as string, 10);
    const chunkIndex = parseInt(formData.get("chunkIndex") as string, 10);

    if (!pdfFile) {
      return NextResponse.json({ error: "Missing 'pdf' file" }, { status: 400 });
    }
    if (!bookSource || isNaN(chapterNum) || isNaN(chunkIndex)) {
      return NextResponse.json({ error: "Missing bookSource, chapterNum, or chunkIndex" }, { status: 400 });
    }

    const buffer = await pdfFile.arrayBuffer();
    const data = Buffer.from(buffer);

    // Upsert: replace if chunk already exists (e.g. re-upload)
    await prisma.pdfChunk.upsert({
      where: {
        bookSource_chapterNum_chunkIndex: { bookSource, chapterNum, chunkIndex },
      },
      update: { data },
      create: { bookSource, chapterNum, chunkIndex, data },
    });

    return NextResponse.json({
      success: true,
      stored: `${bookSource}/ch${chapterNum}/chunk${chunkIndex}`,
    });
  } catch (error: unknown) {
    console.error("Store-pdf error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
