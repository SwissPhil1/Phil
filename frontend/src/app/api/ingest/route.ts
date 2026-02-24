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

    if (action === "test-key") {
      return handleTestKey();
    } else if (action === "detect-chapters") {
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
  } catch (error: unknown) {
    console.error("Ingest error:", error);

    // Extract detailed info from Anthropic API errors
    const anthropicError = error as { status?: number; error?: { type?: string; message?: string } };
    if (anthropicError.status && anthropicError.error) {
      return NextResponse.json(
        {
          error: `Anthropic API error (${anthropicError.status}): ${anthropicError.error.message || "Unknown"}`,
          errorType: anthropicError.error.type,
          status: anthropicError.status,
        },
        { status: anthropicError.status }
      );
    }

    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Quick diagnostic: test that the API key works by sending a trivial message.
 */
async function handleTestKey() {
  const keyPreview = process.env.ANTHROPIC_API_KEY
    ? `${process.env.ANTHROPIC_API_KEY.slice(0, 10)}...${process.env.ANTHROPIC_API_KEY.slice(-4)} (${process.env.ANTHROPIC_API_KEY.length} chars)`
    : "NOT SET";

  // Show which env vars Vercel is injecting (names only, no values)
  const allEnvKeys = Object.keys(process.env).sort();
  const anthropicKeys = allEnvKeys.filter((k) => k.toUpperCase().includes("ANTHRO") || k.toUpperCase().includes("API_KEY") || k.toUpperCase().includes("CLAUDE"));
  const vercelKeys = allEnvKeys.filter((k) => k.startsWith("VERCEL") || k.startsWith("NEXT_"));

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 20,
      messages: [{ role: "user", content: "Reply with just the word: OK" }],
    });
    const text = (response.content[0] as { type: "text"; text: string }).text;
    return NextResponse.json({
      success: true,
      keyPreview,
      model: response.model,
      reply: text,
    });
  } catch (error: unknown) {
    const apiErr = error as { status?: number; error?: { type?: string; message?: string }; message?: string };
    return NextResponse.json({
      success: false,
      keyPreview,
      matchingEnvVars: anthropicKeys,
      vercelEnvVars: vercelKeys,
      totalEnvVars: allEnvKeys.length,
      projectName: process.env.VERCEL_PROJECT_NAME,
      deploymentUrl: process.env.VERCEL_URL,
      gitRef: process.env.VERCEL_GIT_COMMIT_REF,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8),
      targetEnv: process.env.VERCEL_TARGET_ENV,
      allEnvVarNames: allEnvKeys,
      errorStatus: apiErr.status,
      errorType: apiErr.error?.type,
      errorMessage: apiErr.error?.message || apiErr.message || String(error),
    });
  }
}

/**
 * Detect chapters by sending the first pages of the PDF to Claude.
 * Supports both fileId (Files API) and pdfBase64 (legacy) modes.
 */
async function handleDetectChapters(body: {
  fileId?: string;
  pdfBase64?: string;
  totalPages: number;
}) {
  const { fileId, pdfBase64, totalPages } = body;
  if (!fileId && !pdfBase64) {
    return NextResponse.json({ error: "Must provide either 'fileId' or 'pdfBase64'" }, { status: 400 });
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

  const promptText = `This is the beginning of a radiology textbook (total ${totalPages} pages).
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
- Return ONLY valid JSON, no markdown fences or explanation`;

  const response = fileId
    ? await client.beta.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        betas: ["files-api-2025-04-14"],
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "file", file_id: fileId } },
            { type: "text", text: promptText },
          ],
        }],
      })
    : await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf" as const, data: pdfBase64! } },
            { type: "text", text: promptText },
          ],
        }],
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
 * Supports two modes:
 *   1. file_id mode (new): reference a file already uploaded to Anthropic Files API
 *   2. pdfBase64 mode (legacy): send base64-encoded PDF inline
 */
async function handleProcessPdf(body: {
  fileId?: string;
  pdfBase64?: string;
  chapterTitle: string;
  chapterNumber: number;
  bookSource: string;
  appendMode?: boolean;
}) {
  const { fileId, pdfBase64, chapterTitle, chapterNumber, bookSource, appendMode } = body;

  if (!chapterTitle || !chapterNumber || !bookSource) {
    return NextResponse.json(
      { error: "Missing required fields: chapterTitle, chapterNumber, bookSource" },
      { status: 400 }
    );
  }
  if (!fileId && !pdfBase64) {
    return NextResponse.json(
      { error: "Must provide either 'fileId' or 'pdfBase64'" },
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

  const fullPrompt = `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

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

  const appendPrompt = `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

You are looking at additional pages from Chapter ${chapterNumber}: "${chapterTitle}" of a radiology textbook.
Earlier pages of this chapter have already been processed. Focus on generating questions and flashcards from the NEW content on these pages.

IMPORTANT: You can see the IMAGES in these pages. Reference specific imaging findings you can see.

Generate study materials as a JSON object with exactly these fields:

{
  "summary": "",
  "keyPoints": ["3-5 key points from these specific pages"],
  "highYield": ["2-4 high-yield facts from these pages"],
  "mnemonics": [],
  "memoryPalace": "",
  "questions": [
    {
      "questionText": "MCQ question based on content from these pages",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correctAnswer": 0,
      "explanation": "Detailed explanation",
      "difficulty": "medium",
      "category": "topic area"
    }
  ],
  "flashcards": [
    {
      "front": "Question from these pages",
      "back": "Answer with imaging characteristics",
      "category": "topic area"
    }
  ]
}

Requirements:
- Generate 8-15 questions with varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards
- Focus on content unique to THESE pages — avoid duplicating earlier material
- Questions should mimic RadPrimer / FMH2 exam style
- Return ONLY valid JSON, no markdown fences`;

  // Use beta API when referencing uploaded files, standard API for base64
  const promptText = appendMode ? appendPrompt : fullPrompt;
  const response = fileId
    ? await client.beta.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        betas: ["files-api-2025-04-14"],
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "file", file_id: fileId } },
            { type: "text", text: promptText },
          ],
        }],
      })
    : await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf" as const, data: pdfBase64! } },
            { type: "text", text: promptText },
          ],
        }],
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

  if (appendMode) {
    return await appendStudyContent(content, chapterNumber, bookSource);
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

/**
 * Append questions/flashcards to an existing chapter (for multi-chunk processing).
 * Does NOT clear existing data — just adds more content.
 */
async function appendStudyContent(
  content: StudyContent,
  chapterNumber: number,
  bookSource: string
) {
  const chapter = await prisma.chapter.findUnique({
    where: { bookSource_number: { bookSource, number: chapterNumber } },
  });

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found for appending" }, { status: 404 });
  }

  // Merge key points and high yield facts
  const existingKeyPoints: string[] = JSON.parse(chapter.keyPoints || "[]");
  const existingHighYield: string[] = JSON.parse(chapter.highYield || "[]");
  await prisma.chapter.update({
    where: { id: chapter.id },
    data: {
      keyPoints: JSON.stringify([...existingKeyPoints, ...content.keyPoints]),
      highYield: JSON.stringify([...existingHighYield, ...content.highYield]),
    },
  });

  // Append new questions
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

  // Append new flashcards
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

  const totalQuestions = await prisma.question.count({ where: { chapterId: chapter.id } });
  const totalFlashcards = await prisma.flashcard.count({ where: { chapterId: chapter.id } });

  return NextResponse.json({
    success: true,
    chapterId: chapter.id,
    questionsCreated: totalQuestions,
    flashcardsCreated: totalFlashcards,
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
