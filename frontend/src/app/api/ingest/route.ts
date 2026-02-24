import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

// Force this route to be dynamic — never pre-render at build time
export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "extract") {
      return handleExtract(body);
    } else if (action === "process") {
      return handleProcess(body);
    } else if (action === "seed") {
      return handleSeed();
    } else {
      return NextResponse.json({ error: "Invalid action. Use 'extract', 'process', or 'seed'." }, { status: 400 });
    }
  } catch (error) {
    console.error("Ingest error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * Extract chapters from PDF text content.
 * The client sends the text (extracted client-side or via FileReader).
 */
async function handleExtract(body: { text: string }) {
  const { text } = body;
  if (!text) {
    return NextResponse.json({ error: "Missing 'text' field" }, { status: 400 });
  }

  const chapterPattern = /(?:^|\n)\s*(?:CHAPTER|Chapter)\s+(\d+)[:\s.]*([^\n]+)/gm;
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
      chapters: [{ number: 1, title: "Full Document", charCount: text.length }],
    });
  }

  const chapters = matches.map((m, i) => {
    const start = m.index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    return {
      number: m.number,
      title: m.title,
      charCount: end - start,
    };
  });

  return NextResponse.json({ chapters });
}

/**
 * Process a single chapter: send text to Claude, save results to DB.
 */
async function handleProcess(body: {
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

  // Let the Anthropic SDK read ANTHROPIC_API_KEY from the environment itself.
  // Passing it explicitly can cause issues if Next.js inlines the value at build time.
  let client: Anthropic;
  try {
    client = new Anthropic();
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

  // Save to database via Prisma
  const chapter = await prisma.chapter.upsert({
    where: { bookSource_number: { bookSource, number: chapterNumber } },
    update: {
      title: chapterTitle,
      rawText: chapterText.slice(0, 100000),
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
      rawText: chapterText.slice(0, 100000),
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
 * Run the seed to populate the 4 sample chapters.
 */
async function handleSeed() {
  const existingChapters = await prisma.chapter.count();
  if (existingChapters > 0) {
    return NextResponse.json({
      message: `Database already has ${existingChapters} chapters. Skipping seed.`,
      skipped: true,
    });
  }

  // Dynamically import and run the seed
  // For now, return instructions
  return NextResponse.json({
    message: "To seed the database, run: npx tsx prisma/seed.ts (from frontend directory)",
    skipped: false,
  });
}
