import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { readFile, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const maxDuration = 60;

export async function POST(request: Request) {
  let uploadDir: string | null = null;

  try {
    const contentType = request.headers.get("content-type") || "";

    let pdfBuffer: Buffer;

    if (contentType.includes("application/json")) {
      // Chunked upload mode: reassemble from /tmp
      const body = await request.json();
      const { uploadId, totalChunks } = body;

      if (!uploadId || !totalChunks) {
        return NextResponse.json(
          { error: "Missing uploadId or totalChunks" },
          { status: 400 }
        );
      }

      if (!/^[a-zA-Z0-9-]+$/.test(uploadId)) {
        return NextResponse.json(
          { error: "Invalid uploadId" },
          { status: 400 }
        );
      }

      uploadDir = path.join("/tmp", `pdf-upload-${uploadId}`);
      if (!existsSync(uploadDir)) {
        return NextResponse.json(
          {
            error:
              "Upload not found. Chunks may have been stored on a different server instance. Please try uploading again.",
          },
          { status: 404 }
        );
      }

      // Read and concatenate all chunks in order
      const chunks: Buffer[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(uploadDir, `chunk-${i}`);
        if (!existsSync(chunkPath)) {
          return NextResponse.json(
            {
              error: `Missing chunk ${i}/${totalChunks}. Please try uploading again.`,
            },
            { status: 404 }
          );
        }
        chunks.push(await readFile(chunkPath));
      }

      pdfBuffer = Buffer.concat(chunks);
    } else {
      // Direct upload mode (small files under 4.5MB)
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json(
          { error: "No file provided" },
          { status: 400 }
        );
      }

      pdfBuffer = Buffer.from(await file.arrayBuffer());
    }

    // Parse PDF
    const data = new Uint8Array(pdfBuffer);
    PDFParse.setWorker();
    const parser = new PDFParse({ data });
    const result = await parser.getText();
    const text = result.text;
    const totalPages = result.total;
    await parser.destroy();

    // Cleanup /tmp chunks
    if (uploadDir && existsSync(uploadDir)) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        {
          error:
            "Could not extract any text from this PDF. It may be image-based (scanned).",
        },
        { status: 422 }
      );
    }

    // Detect chapters
    const chapterPattern =
      /(?:^|\n)\s*(?:CHAPTER|Chapter)\s+(\d+)[:\s.]*([^\n]+)/gm;
    const matches: { index: number; number: number; title: string }[] = [];

    let match;
    while ((match = chapterPattern.exec(text)) !== null) {
      matches.push({
        index: match.index,
        number: parseInt(match[1], 10),
        title: match[2].trim(),
      });
    }

    if (matches.length === 0) {
      return NextResponse.json({
        chapters: [
          {
            number: 1,
            title: "Full Document",
            charCount: text.length,
            text: text.slice(0, 100000),
          },
        ],
        totalPages,
        totalChars: text.length,
      });
    }

    const chapters = matches.map((m, i) => {
      const start = m.index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const chapterText = text.slice(start, end);
      return {
        number: m.number,
        title: m.title,
        charCount: chapterText.length,
        text: chapterText,
      };
    });

    return NextResponse.json({
      chapters,
      totalPages,
      totalChars: text.length,
    });
  } catch (error) {
    // Cleanup on error
    if (uploadDir && existsSync(uploadDir)) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }

    console.error("PDF extraction error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to extract text from PDF",
      },
      { status: 500 }
    );
  }
}
