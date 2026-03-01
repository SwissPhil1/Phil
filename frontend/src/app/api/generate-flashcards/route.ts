import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  getClaudeClient,
  callClaudeStreamWithRetry,
} from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function buildFlashcardPrompt(studyGuide: string, language: string): string {
  const guideWords = studyGuide.split(/\s+/).length;
  const minFlashcards = guideWords > 8000 ? 150 : guideWords > 4000 ? 100 : 50;

  const langNote = language === "fr"
    ? "IMPORTANT: The study guide is in French. Write ALL flashcard front/back text in FRENCH. Keep medical terms in both languages where helpful (e.g., \"Bec d'oiseau / Bird's beak\").\n\n"
    : "";

  return `${langNote}Extract ALL Q/A pairs from this study guide and return them as a JSON array of flashcards.

Each flashcard should have:
- "front": The question (concise, exam-style)
- "back": The answer (concise but complete)
- "category": One of "anatomy", "pathology", "imaging", "differential", "mnemonic", "clinical"

Extract EVERY Q/A pair from the guide. Also extract key facts from tables, rapid-fire sections, and high-yield boxes as additional flashcards. Aim for ${minFlashcards}+ flashcards — this is a large study guide so do NOT skip any facts.

Return ONLY a valid JSON array, no other text. Example:
[{"front":"What is the classic sign of achalasia?","back":"Bird's beak — smooth distal tapering of the esophagus","category":"pathology"}]

STUDY GUIDE:
${studyGuide}`;
}

/**
 * POST /api/generate-flashcards
 * Generates flashcards for an existing chapter that has a study guide.
 * This is a separate endpoint so it can be called independently of the
 * import/transform pipeline, allowing retry without re-generating the study guide.
 */
export async function POST(request: Request) {
  try {
    const { chapterId, language = "fr" } = await request.json();

    if (!chapterId) {
      return NextResponse.json({ error: "Missing chapterId" }, { status: 400 });
    }

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true, studyGuide: true },
    });

    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }

    if (!chapter.studyGuide) {
      return NextResponse.json({ error: "Chapter has no study guide to extract flashcards from" }, { status: 400 });
    }

    // Delete existing flashcards for this chapter (if retrying)
    const existingCount = await prisma.flashcard.count({ where: { chapterId } });
    if (existingCount > 0) {
      await prisma.flashcardReview.deleteMany({
        where: { flashcard: { chapterId } },
      });
      await prisma.flashcard.deleteMany({ where: { chapterId } });
    }

    // Stream progress via SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(data: Record<string, unknown>) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        }

        try {
          send({ status: "generating", message: "Generating flashcards from study guide..." });

          const client = getClaudeClient();
          const guideWords = chapter.studyGuide!.split(/\s+/).length;
          const fcMaxTokens = guideWords > 8000 ? 32000 : 16000;

          const flashcardJson = await callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: fcMaxTokens,
              messages: [{ role: "user", content: buildFlashcardPrompt(chapter.studyGuide!, language) }],
            },
            (charCount) => {
              send({ status: "generating", message: `Extracting flashcards... (${Math.round(charCount / 1000)}KB generated)` });
            },
          );

          // Parse flashcards
          let cleaned = flashcardJson.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
          }
          const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            cleaned = arrayMatch[0];
          }

          const flashcards: { front: string; back: string; category: string }[] = JSON.parse(cleaned);

          let flashcardsCreated = 0;
          if (Array.isArray(flashcards) && flashcards.length > 0) {
            await prisma.flashcard.createMany({
              data: flashcards.map((fc) => ({
                chapterId: chapter.id,
                front: fc.front,
                back: fc.back,
                category: fc.category || "pathology",
              })),
            });
            flashcardsCreated = flashcards.length;
          }

          send({
            success: true,
            flashcardsCreated,
            message: `Created ${flashcardsCreated} flashcards`,
          });
        } catch (err) {
          console.error("Flashcard generation error:", err);
          send({ error: err instanceof Error ? err.message : "Flashcard generation failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    console.error("Generate flashcards error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
