import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
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

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Could not extract any text from this PDF. It may be image-based (scanned)." },
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
