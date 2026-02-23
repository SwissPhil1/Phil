#!/usr/bin/env npx tsx
/**
 * RadioRevise PDF Ingestion Pipeline (TypeScript/Prisma)
 *
 * Extracts text from radiology textbook PDFs chapter by chapter,
 * then uses Claude API to generate study content.
 *
 * Usage:
 *   npx tsx scripts/ingest.ts --pdf /path/to/book.pdf --book core_radiology
 *   npx tsx scripts/ingest.ts --pdf /path/to/book.pdf --book crack_the_core
 *   npx tsx scripts/ingest.ts --pdf /path/to/book.pdf --book core_radiology --chapters 1,2,5
 *
 * Requires:
 *   - DATABASE_URL environment variable (PostgreSQL)
 *   - ANTHROPIC_API_KEY environment variable
 */

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

// Load .env from frontend directory
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../.env") });

const prisma = new PrismaClient();

interface Chapter {
  number: number;
  title: string;
  text: string;
}

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

async function extractChaptersFromPdf(pdfPath: string): Promise<Chapter[]> {
  // Dynamic import for pdf-parse (CommonJS module)
  const pdfParse = (await import("pdf-parse")).default;

  console.log(`Extracting text from ${pdfPath}...`);
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(dataBuffer);

  const fullText = data.text;
  console.log(`  Extracted ${fullText.length} characters from ${data.numpages} pages`);

  // Try to split by chapter headings
  const chapterPattern = /(?:^|\n)\s*(?:CHAPTER|Chapter)\s+(\d+)[:\s.]*([^\n]+)/gm;
  const matches: { index: number; number: number; title: string }[] = [];

  let match;
  while ((match = chapterPattern.exec(fullText)) !== null) {
    matches.push({
      index: match.index,
      number: parseInt(match[1], 10),
      title: match[2].trim(),
    });
  }

  if (matches.length === 0) {
    console.log("  No chapter headings found, treating as single document");
    return [{ number: 1, title: "Full Document", text: fullText.slice(0, 50000) }];
  }

  const chapters: Chapter[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : fullText.length;
    let chapterText = fullText.slice(start, end);

    // Truncate very long chapters to avoid API limits
    if (chapterText.length > 50000) {
      chapterText = chapterText.slice(0, 50000) + "\n[... truncated for processing ...]";
    }

    chapters.push({
      number: matches[i].number,
      title: matches[i].title,
      text: chapterText,
    });
    console.log(`  Found Chapter ${matches[i].number}: ${matches[i].title} (${chapterText.length} chars)`);
  }

  console.log(`  Total: ${chapters.length} chapters extracted`);
  return chapters;
}

async function generateStudyContent(
  client: Anthropic,
  chapterText: string,
  chapterTitle: string
): Promise<StudyContent> {
  const prompt = `You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

Based on the following chapter content, generate comprehensive study materials in JSON format.

Chapter: ${chapterTitle}

Content:
${chapterText}

Generate a JSON object with exactly these fields:

{
  "summary": "A detailed summary of the chapter (2-3 paragraphs) covering the main concepts, focusing on what's most likely to appear on the FMH2 exam.",

  "keyPoints": [
    "List of 8-12 key points that a radiology resident must know from this chapter"
  ],

  "highYield": [
    "List of 5-8 high-yield facts that are commonly tested and worth the most points"
  ],

  "mnemonics": [
    {"name": "Mnemonic name/acronym", "content": "Explanation of what each letter stands for and how to remember it"}
  ],

  "memoryPalace": "A vivid memory palace description that walks through a familiar location, placing key concepts at specific stations. Make it visual and engaging with radiology-specific imagery.",

  "questions": [
    {
      "questionText": "A multiple-choice question in the style of RadPrimer (intermediate level)",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "Detailed explanation of why this answer is correct and why others are wrong",
      "difficulty": "medium",
      "category": "topic category"
    }
  ],

  "flashcards": [
    {
      "front": "Question or concept to recall",
      "back": "Answer or explanation",
      "category": "topic category"
    }
  ]
}

Important:
- Generate 8-15 questions per chapter, varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards per chapter covering key facts
- Generate 3-5 mnemonics per chapter
- Questions should mimic RadPrimer intermediate level format
- Focus on diagnostic imaging findings, differential diagnoses, and clinical correlations
- Use proper medical terminology

Return ONLY valid JSON, no markdown formatting.`;

  console.log(`    Generating study content for: ${chapterTitle}...`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  let responseText = (response.content[0] as { type: "text"; text: string }).text.trim();

  // Remove markdown code fences if present
  if (responseText.startsWith("```")) {
    responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(responseText) as StudyContent;
  } catch (e) {
    console.log(`    WARNING: Failed to parse JSON response: ${e}`);
    console.log(`    Raw response (first 500 chars): ${responseText.slice(0, 500)}`);
    return {
      summary: responseText.slice(0, 2000),
      keyPoints: [],
      highYield: [],
      mnemonics: [],
      memoryPalace: "",
      questions: [],
      flashcards: [],
    };
  }
}

async function saveToDatabase(
  bookSource: string,
  chapterNum: number,
  chapterTitle: string,
  rawText: string,
  content: StudyContent
) {
  // Upsert chapter
  const chapter = await prisma.chapter.upsert({
    where: {
      bookSource_number: { bookSource, number: chapterNum },
    },
    update: {
      title: chapterTitle,
      rawText: rawText.slice(0, 100000),
      summary: content.summary,
      keyPoints: JSON.stringify(content.keyPoints),
      highYield: JSON.stringify(content.highYield),
      mnemonics: JSON.stringify(content.mnemonics),
      memoryPalace: content.memoryPalace,
    },
    create: {
      bookSource,
      number: chapterNum,
      title: chapterTitle,
      rawText: rawText.slice(0, 100000),
      summary: content.summary,
      keyPoints: JSON.stringify(content.keyPoints),
      highYield: JSON.stringify(content.highYield),
      mnemonics: JSON.stringify(content.mnemonics),
      memoryPalace: content.memoryPalace,
    },
  });

  // Delete existing questions and flashcards for this chapter (regeneration)
  await prisma.questionAttempt.deleteMany({
    where: { question: { chapterId: chapter.id } },
  });
  await prisma.question.deleteMany({ where: { chapterId: chapter.id } });
  await prisma.flashcardReview.deleteMany({
    where: { flashcard: { chapterId: chapter.id } },
  });
  await prisma.flashcard.deleteMany({ where: { chapterId: chapter.id } });

  // Insert questions
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

  // Insert flashcards
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

  console.log(`    Saved: ${content.questions.length} questions, ${content.flashcards.length} flashcards`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pdf" && args[i + 1]) {
      parsed.pdf = args[++i];
    } else if (args[i] === "--book" && args[i + 1]) {
      parsed.book = args[++i];
    } else if (args[i] === "--chapters" && args[i + 1]) {
      parsed.chapters = args[++i];
    } else if (args[i] === "--skip-generation") {
      parsed.skipGeneration = "true";
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs();

  if (!args.pdf || !args.book) {
    console.log(`
RadioRevise PDF Ingestion Pipeline

Usage:
  npx tsx scripts/ingest.ts --pdf /path/to/book.pdf --book core_radiology
  npx tsx scripts/ingest.ts --pdf /path/to/book.pdf --book crack_the_core
  npx tsx scripts/ingest.ts --pdf /path/to/book.pdf --book core_radiology --chapters 1,2,5
  npx tsx scripts/ingest.ts --pdf /path/to/book.pdf --book core_radiology --skip-generation

Options:
  --pdf <path>         Path to the PDF file
  --book <source>      Book source: core_radiology or crack_the_core
  --chapters <nums>    Comma-separated chapter numbers (default: all)
  --skip-generation    Extract text only, skip AI content generation
`);
    process.exit(1);
  }

  if (!["core_radiology", "crack_the_core"].includes(args.book)) {
    console.error("Error: --book must be 'core_radiology' or 'crack_the_core'");
    process.exit(1);
  }

  if (!fs.existsSync(args.pdf)) {
    console.error(`Error: PDF file not found: ${args.pdf}`);
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && args.skipGeneration !== "true") {
    console.error("Error: ANTHROPIC_API_KEY not set. Set it in .env or as environment variable.");
    console.error("Use --skip-generation to extract text without AI content generation.");
    process.exit(1);
  }

  console.log(`Book source: ${args.book}`);
  console.log(`Database: ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@')}`);
  console.log();

  // Step 1: Extract chapters from PDF
  let chapters = await extractChaptersFromPdf(args.pdf);

  // Filter chapters if specified
  if (args.chapters) {
    const selected = new Set(args.chapters.split(",").map(Number));
    chapters = chapters.filter((ch) => selected.has(ch.number));
    console.log(`Processing ${chapters.length} selected chapters`);
  }

  // Step 2: Generate content and save
  let client: Anthropic | null = null;
  if (args.skipGeneration !== "true") {
    client = new Anthropic({ apiKey });
  }

  for (const ch of chapters) {
    console.log(`\nProcessing Chapter ${ch.number}: ${ch.title}`);

    let content: StudyContent;
    if (client) {
      content = await generateStudyContent(client, ch.text, ch.title);
      // Rate limit: wait between API calls
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      content = {
        summary: "",
        keyPoints: [],
        highYield: [],
        mnemonics: [],
        memoryPalace: "",
        questions: [],
        flashcards: [],
      };
    }

    await saveToDatabase(args.book, ch.number, ch.title, ch.text, content);
  }

  console.log(`\nDone! Processed ${chapters.length} chapters.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
