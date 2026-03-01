import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  getClaudeClient,
  callClaudeStreamWithRetry,
} from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function buildQuestionPrompt(studyGuide: string, language: string): string {
  const guideWords = studyGuide.split(/\s+/).length;
  const minQuestions = guideWords > 8000 ? 40 : guideWords > 4000 ? 25 : 15;

  const langNote =
    language === "fr"
      ? "IMPORTANT: The study guide is in French. Write ALL question text, options, and explanations in FRENCH. Keep medical terms in both languages where helpful (e.g., \"Bec d'oiseau / Bird's beak\").\n\n"
      : "";

  return `${langNote}You are an expert radiology examiner creating FMH2-style multiple choice questions from a study guide.

Extract ALL Q/A pairs, high-yield facts, key points, comparison tables, and rapid-fire items from this study guide and convert them into exam-style MCQ questions.

Each question must have:
- "questionText": The question stem (clinical scenario or direct knowledge question)
- "options": Array of 4-5 options (each prefixed with "A) ", "B) ", etc.)
- "correctAnswer": 0-based index of the correct option
- "explanation": Detailed explanation of WHY the correct answer is right and WHY others are wrong
- "difficulty": One of "easy", "medium", "hard"
- "category": Topic area (e.g., "anatomy", "pathology", "differential", "imaging", "clinical")

Question types to create:
1. **Classic sign questions**: "What is the classic imaging sign of [pathology]?"
2. **Clinical scenario**: "A 55-year-old presents with... CT shows... What is the most likely diagnosis?"
3. **Differential diagnosis**: "Which of the following is NOT a cause of [finding]?"
4. **Imaging appearance**: "On MRI, [pathology] appears as..."
5. **Comparison**: "What distinguishes [entity A] from [entity B]?"
6. **Next best step**: "What is the next best imaging study?"
7. **True/false style**: "Which statement about [topic] is correct?"

Aim for ${minQuestions}+ questions covering the FULL breadth of the study guide. Do NOT skip any major pathology or topic.

Return ONLY a valid JSON array, no other text. Example:
[{"questionText":"What is the classic barium swallow finding in achalasia?","options":["A) Corkscrew esophagus","B) Bird's beak sign","C) Rat-tail sign","D) Schatzki ring"],"correctAnswer":1,"explanation":"Bird's beak sign (smooth tapering of the distal esophagus) is the classic finding. Corkscrew = DES, rat-tail = esophageal carcinoma, Schatzki ring = lower esophageal ring.","difficulty":"medium","category":"pathology"}]

STUDY GUIDE:
${studyGuide}`;
}

/**
 * POST /api/generate-questions
 * Generates QCM questions for an existing chapter that has a study guide.
 * Separate endpoint for independent retry without re-generating the study guide.
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
      return NextResponse.json(
        { error: "Chapter has no study guide to extract questions from" },
        { status: 400 }
      );
    }

    // Delete existing questions for this chapter (if retrying)
    const existingCount = await prisma.question.count({ where: { chapterId } });
    if (existingCount > 0) {
      await prisma.questionAttempt.deleteMany({
        where: { question: { chapterId } },
      });
      await prisma.question.deleteMany({ where: { chapterId } });
    }

    // Stream progress via SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(data: Record<string, unknown>) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch { /* controller already closed */ }
        }

        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch { /* ignore */ }
        }, 8000);

        try {
          send({ status: "generating", message: "Generating questions from study guide..." });

          const client = getClaudeClient();
          const guideWords = chapter.studyGuide!.split(/\s+/).length;
          const maxTokens = guideWords > 8000 ? 32000 : 16000;

          const questionJson = await callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: maxTokens,
              messages: [
                { role: "user", content: buildQuestionPrompt(chapter.studyGuide!, language) },
              ],
            },
            (charCount) => {
              send({
                status: "generating",
                message: `Extracting questions... (${Math.round(charCount / 1000)}KB generated)`,
              });
            },
          );

          // Parse questions
          let cleaned = questionJson.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
          }
          const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            cleaned = arrayMatch[0];
          }

          const questions: {
            questionText: string;
            options: string[];
            correctAnswer: number;
            explanation: string;
            difficulty: string;
            category: string;
          }[] = JSON.parse(cleaned);

          let questionsCreated = 0;
          if (Array.isArray(questions) && questions.length > 0) {
            for (const q of questions) {
              await prisma.question.create({
                data: {
                  chapterId: chapter.id,
                  questionText: String(q.questionText || ""),
                  options: JSON.stringify(q.options || []),
                  correctAnswer: Number(q.correctAnswer) || 0,
                  explanation: String(q.explanation || ""),
                  difficulty: String(q.difficulty || "medium"),
                  category: q.category ? String(q.category) : null,
                },
              });
            }
            questionsCreated = questions.length;
          }

          send({
            success: true,
            questionsCreated,
            message: `Created ${questionsCreated} questions`,
          });
        } catch (err) {
          console.error("Question generation error:", err);
          send({ error: err instanceof Error ? err.message : "Question generation failed" });
        } finally {
          clearInterval(heartbeat);
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
    console.error("Generate questions error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
