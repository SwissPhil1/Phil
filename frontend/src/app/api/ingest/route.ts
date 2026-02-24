import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

// Force this route to be dynamic — never pre-render at build time
export const dynamic = "force-dynamic";

// Allow up to 120s for Claude to process PDF pages (Vercel Pro default: 60s)
export const maxDuration = 120;

interface StudyContent {
  summary: string;
  keyPoints: string[];
  highYield: string[];
  mnemonics: { name: string; content: string }[];
  memoryPalace: string;
  questions: {
    questionText: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
    difficulty: string;
    category: string;
  }[];
  flashcards: {
    front: string;
    back: string;
    category: string;
  }[];
}

function getClient(): Anthropic {
  return new Anthropic();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "detect-chapters") {
      return handleDetectChapters(body);
    } else if (action === "process-pdf") {
      return handleProcessPdf(body);
    } else if (action === "process") {
      return handleProcessText(body);
    } else if (action === "seed") {
      return handleSeed();
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'detect-chapters', 'process-pdf', 'process', or 'seed'." },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Ingest error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Detect chapters by sending the first pages of the PDF to Claude.
 * Claude reads the table of contents / first pages and identifies chapter structure.
 */
async function handleDetectChapters(body: {
  pdfBase64: string;
  totalPages: number;
}) {
  const { pdfBase64, totalPages } = body;
  if (!pdfBase64) {
    return NextResponse.json({ error: "Missing 'pdfBase64' field" }, { status: 400 });
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables and redeploy." },
      { status: 500 }
    );
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: `This is the beginning of a radiology textbook (total ${totalPages} pages).
Analyze the table of contents or chapter headings visible in these pages.

Return a JSON array of chapters with this exact format:
[
  { "number": 1, "title": "Chapter Title", "startPage": 1, "endPage": 30 },
  { "number": 2, "title": "Next Chapter", "startPage": 31, "endPage": 58 }
]

Rules:
- Use the actual page numbers shown in the document
- If you can see a table of contents, use it to determine page ranges
- If no clear chapter structure is visible, divide the ${totalPages} pages into logical sections of ~30-50 pages each
- Return ONLY valid JSON, no markdown fences or explanation`,
          },
        ],
      },
    ],
  });

  let responseText = (response.content[0] as { type: "text"; text: string }).text.trim();
  if (responseText.startsWith("```")) {
    responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const chapters = JSON.parse(responseText);
    return NextResponse.json({ chapters });
  } catch {
    return NextResponse.json(
      { error: "Failed to parse chapter detection response", raw: responseText },
      { status: 500 }
    );
  }
}

/**
 * Process a PDF chunk: send actual PDF pages to Claude for analysis.
 * Claude sees text, tables, AND images (X-rays, CT, MRI, diagrams).
 */
async function handleProcessPdf(body: {
  pdfBase64: string;
  chapterTitle: string;
  chapterNumber: number;
  bookSource: string;
}) {
  const { pdfBase64, chapterTitle, chapterNumber, bookSource } = body;

  if (!pdfBase64 || !chapterTitle || !chapterNumber || !bookSource) {
    return NextResponse.json(
      { error: "Missing required fields: pdfBase64, chapterTitle, chapterNumber, bookSource" },
      { status: 400 }
    );
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables and redeploy." },
      { status: 500 }
    );
  }

  const prompt = `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

You are looking at actual pages from a radiology textbook — Chapter ${chapterNumber}: "${chapterTitle}".

IMPORTANT: You can see the IMAGES in these pages (X-rays, CT scans, MRI images, ultrasound, diagrams, anatomical illustrations). Use them to create better study materials. Reference specific imaging findings you can see.

Generate comprehensive study materials as a JSON object with exactly these fields:

{
  "summary": "A detailed summary (2-3 paragraphs) covering main concepts. Reference key imaging findings visible in the chapter's figures.",
  "keyPoints": ["8-12 key points — include imaging-specific points like 'On CT, finding X appears as...'"],
  "highYield": ["5-8 high-yield facts for the exam, including classic imaging signs"],
  "mnemonics": [{"name": "Mnemonic name", "content": "Explanation"}],
  "memoryPalace": "A vivid memory palace description linking concepts to imaging findings.",
  "questions": [
    {
      "questionText": "MCQ question — include image-based questions like 'A CT shows X finding. What is the most likely diagnosis?'",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correctAnswer": 0,
      "explanation": "Detailed explanation referencing the imaging appearance",
      "difficulty": "medium",
      "category": "topic area"
    }
  ],
  "flashcards": [
    {
      "front": "Question (include imaging-based cards like 'What is the classic CT appearance of X?')",
      "back": "Detailed answer with imaging characteristics",
      "category": "topic area"
    }
  ]
}

Requirements:
- Generate 8-15 questions with varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards
- Generate 3-5 mnemonics
- Include image-based questions that reference imaging findings from the chapter
- Questions should mimic RadPrimer / FMH2 exam style
- Focus on diagnostic imaging findings, differential diagnoses, and classic signs
- Return ONLY valid JSON, no markdown fences`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  });

  let responseText = (response.content[0] as { type: "text"; text: string }).text.trim();
  if (responseText.startsWith("```")) {
    responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let content: StudyContent;
  try {
    content = JSON.parse(responseText);
  } catch {
    return NextResponse.json(
      { error: "Failed to parse AI response as JSON", raw: responseText.slice(0, 200) },
      { status: 500 }
    );
  }

  return await saveStudyContent(content, chapterTitle, chapterNumber, bookSource);
}

/**
 * Legacy: Process a chapter from plain text (kept for backward compatibility / manual paste).
 */
async function handleProcessText(body: {
  chapterText: string;
  chapterTitle: string;
  chapterNumber: number;
  bookSource: string;
}) {
  const { chapterText, chapterTitle, chapterNumber, bookSource } = body;

  if (!chapterText || !chapterTitle || !chapterNumber || !bookSource) {
    return NextResponse.json(
      { error: "Missing required fields: chapterText, chapterTitle, chapterNumber, bookSource" },
      { status: 400 }
    );
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables and redeploy." },
      { status: 500 }
    );
  }

  const prompt = `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

Based on the following chapter content, generate comprehensive study materials in JSON format.

Chapter: ${chapterTitle}

Content:
${chapterText.slice(0, 50000)}

Generate a JSON object with exactly these fields:

{
  "summary": "A detailed summary of the chapter (2-3 paragraphs) covering the main concepts.",
  "keyPoints": ["List of 8-12 key points"],
  "highYield": ["List of 5-8 high-yield facts"],
  "mnemonics": [{"name": "Mnemonic name", "content": "Explanation"}],
  "memoryPalace": "A vivid memory palace description.",
  "questions": [{"questionText": "MCQ question", "options": ["A", "B", "C", "D"], "correctAnswer": 0, "explanation": "Why", "difficulty": "medium", "category": "topic"}],
  "flashcards": [{"front": "Question", "back": "Answer", "category": "topic"}]
}

Important:
- Generate 8-15 questions, varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards
- Generate 3-5 mnemonics
- Questions should mimic RadPrimer intermediate level
- Focus on diagnostic imaging findings and differential diagnoses
- Return ONLY valid JSON, no markdown.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  let responseText = (response.content[0] as { type: "text"; text: string }).text.trim();
  if (responseText.startsWith("```")) {
    responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let content: StudyContent;
  try {
    content = JSON.parse(responseText);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response as JSON" }, { status: 500 });
  }

  return await saveStudyContent(content, chapterTitle, chapterNumber, bookSource, chapterText.slice(0, 100000));
}

/**
 * Save study content (questions, flashcards, chapter data) to the database.
 */
async function saveStudyContent(
  content: StudyContent,
  chapterTitle: string,
  chapterNumber: number,
  bookSource: string,
  rawText?: string
) {
  const chapter = await prisma.chapter.upsert({
    where: { bookSource_number: { bookSource, number: chapterNumber } },
    update: {
      title: chapterTitle,
      rawText: rawText || null,
      summary: content.summary,
      keyPoints: JSON.stringify(content.keyPoints),
      highYield: JSON.stringify(content.highYield),
      mnemonics: JSON.stringify(content.mnemonics),
      memoryPalace: content.memoryPalace,
    },
    create: {
      bookSource,
      number: chapterNumber,
      title: chapterTitle,
      rawText: rawText || null,
      summary: content.summary,
      keyPoints: JSON.stringify(content.keyPoints),
      highYield: JSON.stringify(content.highYield),
      mnemonics: JSON.stringify(content.mnemonics),
      memoryPalace: content.memoryPalace,
    },
  });

  // Clear old questions/flashcards
  await prisma.questionAttempt.deleteMany({ where: { question: { chapterId: chapter.id } } });
  await prisma.question.deleteMany({ where: { chapterId: chapter.id } });
  await prisma.flashcardReview.deleteMany({ where: { flashcard: { chapterId: chapter.id } } });
  await prisma.flashcard.deleteMany({ where: { chapterId: chapter.id } });

  // Insert new questions
  for (const q of content.questions) {
    await prisma.question.create({
      data: {
        chapterId: chapter.id,
        questionText: q.questionText,
        options: JSON.stringify(q.options),
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        difficulty: q.difficulty || "medium",
        category: q.category,
      },
    });
  }

  // Insert new flashcards
  for (const f of content.flashcards) {
    await prisma.flashcard.create({
      data: {
        chapterId: chapter.id,
        front: f.front,
        back: f.back,
        category: f.category,
      },
    });
  }

  return NextResponse.json({
    success: true,
    chapterId: chapter.id,
    questionsCreated: content.questions.length,
    flashcardsCreated: content.flashcards.length,
  });
}

async function handleSeed() {
  const existingChapters = await prisma.chapter.count();
  if (existingChapters > 0) {
    return NextResponse.json({
      message: `Database already has ${existingChapters} chapters. Skipping seed.`,
      skipped: true,
    });
  }

  return NextResponse.json({
    message: "To seed the database, run: npx tsx prisma/seed.ts (from frontend directory)",
    skipped: false,
  });
}
