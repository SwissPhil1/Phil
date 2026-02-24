import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Allow up to 5 minutes — uploading + splitting large PDFs takes time
export const maxDuration = 300;

// Disable Next.js body parser so we can receive large FormData uploads
export const runtime = "nodejs";

interface UploadedChunk {
  fileId: string;
  chapterNumber: number;
  chunkIndex: number;
  totalChunks: number;
  pageStart: number;
  pageEnd: number;
}

interface ChapterInput {
  number: number;
  title: string;
  startPage: number;
  endPage: number;
}

/**
 * POST /api/upload-pdf
 *
 * Accepts a PDF via FormData + chapter definitions as JSON.
 * Server-side: splits the PDF into chunks per chapter, uploads each chunk
 * to the Anthropic Files API, returns file IDs for each chunk.
 *
 * This moves all heavy lifting (base64 encoding, PDF splitting) OFF the
 * client (iPad) and onto the server.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get("pdf") as File | null;
    const chaptersJson = formData.get("chapters") as string | null;
    const maxPagesPerChunk = parseInt(formData.get("maxPagesPerChunk") as string || "100", 10);

    if (!pdfFile) {
      return NextResponse.json({ error: "Missing 'pdf' file in form data" }, { status: 400 });
    }
    if (!chaptersJson) {
      return NextResponse.json({ error: "Missing 'chapters' JSON in form data" }, { status: 400 });
    }

    let chapters: ChapterInput[];
    try {
      chapters = JSON.parse(chaptersJson);
    } catch {
      return NextResponse.json({ error: "Invalid 'chapters' JSON" }, { status: 400 });
    }

    // Read the PDF into memory
    const pdfBuffer = await pdfFile.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfBuffer);

    let client: Anthropic;
    try {
      client = new Anthropic();
    } catch {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const fullPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPdfPages = fullPdf.getPageCount();

    const uploadedChunks: UploadedChunk[] = [];

    for (const chapter of chapters) {
      const startIdx = Math.max(0, chapter.startPage - 1); // 1-based → 0-based
      const endIdx = Math.min(totalPdfPages, chapter.endPage);
      const chapterPageCount = endIdx - startIdx;
      const numChunks = Math.ceil(chapterPageCount / maxPagesPerChunk);

      for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
        const chunkStart = startIdx + chunkIdx * maxPagesPerChunk;
        const chunkEnd = Math.min(chunkStart + maxPagesPerChunk, endIdx);
        const pagesToCopy = chunkEnd - chunkStart;

        // Extract this chunk's pages into a new PDF
        const chunkPdf = await PDFDocument.create();
        const indices = Array.from({ length: pagesToCopy }, (_, i) => chunkStart + i);
        const pages = await chunkPdf.copyPages(fullPdf, indices);
        pages.forEach((p) => chunkPdf.addPage(p));
        const chunkBytes = await chunkPdf.save();

        // Upload to Anthropic Files API
        const file = new File(
          [Buffer.from(chunkBytes)],
          `ch${chapter.number}_chunk${chunkIdx + 1}.pdf`,
          { type: "application/pdf" }
        );

        const uploaded = await client.beta.files.upload({ file });

        uploadedChunks.push({
          fileId: uploaded.id,
          chapterNumber: chapter.number,
          chunkIndex: chunkIdx,
          totalChunks: numChunks,
          pageStart: chunkStart + 1, // back to 1-based for display
          pageEnd: chunkEnd,
        });
      }
    }

    return NextResponse.json({
      success: true,
      totalChunks: uploadedChunks.length,
      chunks: uploadedChunks,
    });
  } catch (error: unknown) {
    console.error("Upload-pdf error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
