import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { readFile, rm, writeFile } from "fs/promises";
import { existsSync, createWriteStream } from "fs";
import path from "path";

export const maxDuration = 60;

// Assemble chunk files into a single PDF on disk
async function assembleChunks(
  uploadDir: string,
  totalChunks: number
): Promise<string> {
  const assembledPath = path.join(uploadDir, "assembled.pdf");
  if (existsSync(assembledPath)) return assembledPath;

  const writeStream = createWriteStream(assembledPath);

  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(uploadDir, `chunk-${i}`);
    if (!existsSync(chunkPath)) {
      writeStream.destroy();
      throw new Error(
        `Missing chunk ${i}/${totalChunks}. The server instance may have changed. Please try again.`
      );
    }
    const chunkData = await readFile(chunkPath);
    writeStream.write(chunkData);
  }

  writeStream.end();
  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  return assembledPath;
}

export async function POST(request: Request) {
  let uploadDir: string | null = null;

  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { uploadId, totalChunks, startPage, endPage } = body;

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
              "Upload not found. The server instance changed between upload and extraction. Please try again.",
          },
          { status: 404 }
        );
      }

      // Assemble chunks into single file (idempotent — skips if already done)
      const assembledPath = await assembleChunks(uploadDir, totalChunks);

      // Read the assembled PDF
      const buffer = await readFile(assembledPath);

      PDFParse.setWorker();
      const parser = new PDFParse({ data: buffer });

      if (startPage && endPage) {
        // Batch mode: extract a specific page range
        const pageNumbers: number[] = [];
        for (let p = startPage; p <= endPage; p++) pageNumbers.push(p);

        const result = await parser.getText({ partial: pageNumbers });
        const text = result.text;
        const totalPages = result.total;
        await parser.destroy();

        return NextResponse.json({
          text,
          totalPages,
          startPage,
          endPage,
          done: endPage >= totalPages,
        });
      } else {
        // Discovery mode: get page count + extract first batch
        const BATCH_SIZE = 200;
        const result = await parser.getText({ first: BATCH_SIZE });
        const text = result.text;
        const totalPages = result.total;
        await parser.destroy();

        if (totalPages <= BATCH_SIZE) {
          // Small enough PDF — we got everything, cleanup and return
          await rm(uploadDir, { recursive: true, force: true }).catch(
            () => {}
          );
          uploadDir = null;
          return NextResponse.json(formatChapters(text, totalPages));
        }

        // Large PDF — return first batch + page count for client to fetch more
        return NextResponse.json({
          text,
          totalPages,
          startPage: 1,
          endPage: BATCH_SIZE,
          done: false,
        });
      }
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

      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      PDFParse.setWorker();
      const parser = new PDFParse({ data });
      const result = await parser.getText();
      const text = result.text;
      const totalPages = result.total;
      await parser.destroy();

      return NextResponse.json(formatChapters(text, totalPages));
    }
  } catch (error) {
    // Cleanup on error (but don't clean up if we need more batches)
    if (uploadDir && existsSync(uploadDir)) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("PDF extraction error:", message);
    return NextResponse.json(
      { error: `PDF extraction failed: ${message}` },
      { status: 500 }
    );
  }
}

function formatChapters(text: string, totalPages: number) {
  if (!text || text.trim().length === 0) {
    return {
      error:
        "Could not extract any text from this PDF. It may be image-based (scanned).",
    };
  }

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
    return {
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
    };
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

  return {
    chapters,
    totalPages,
    totalChars: text.length,
  };
}
