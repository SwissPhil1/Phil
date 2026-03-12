import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL,
  getClaudeClient,
  callClaudeStreamWithRetry,
} from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function buildCasePrompt(studyGuide: string): string {
  return `You are an expert radiology examiner creating CASE-BASED questions for the French FMH2 board exam.

Each case is a clinical vignette (2-4 sentences) describing a patient scenario, followed by 2-3 sequential questions about that case.

Create 5 clinical cases from this study guide. Each case must:
1. Start with a realistic clinical vignette (age, sex, symptoms, relevant history)
2. Mention imaging findings (what is seen on CT/MRI/X-ray/US)
3. Have 2-3 sequential questions (diagnosis → next step → complication or differential)
4. Each question has 4 options

Write in French (medical terms bilingual where helpful).

Return ONLY valid JSON:
[{
  "caseContext": "Patiente de 45 ans, douleurs abdominales depuis 3 jours...",
  "questions": [
    {"questionText": "Quel est le diagnostic le plus probable ?", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correctAnswer": 1, "explanation": "...", "difficulty": "medium"},
    {"questionText": "Quelle est la prochaine étape ?", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correctAnswer": 0, "explanation": "...", "difficulty": "hard"}
  ]
}]

STUDY GUIDE:
${studyGuide.slice(0, 40000)}`;
}

export async function POST(request: Request) {
  try {
    const { chapterId } = await request.json();

    if (!chapterId) {
      return NextResponse.json({ error: "Missing chapterId" }, { status: 400 });
    }

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true, studyGuide: true },
    });

    if (!chapter?.studyGuide) {
      return NextResponse.json({ error: "Chapter has no study guide" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(data: Record<string, unknown>) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch { /* closed */ }
        }

        const heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* ignore */ }
        }, 8000);

        try {
          send({ status: "generating", message: "Generating case-based questions..." });

          const client = getClaudeClient();

          const caseJson = await callClaudeStreamWithRetry(
            client,
            {
              model: CLAUDE_MODEL,
              max_tokens: 16000,
              messages: [
                { role: "user", content: buildCasePrompt(chapter.studyGuide!) },
              ],
            },
            (charCount) => {
              send({ status: "generating", message: `Creating clinical cases... (${Math.round(charCount / 1000)}KB)` });
            },
          );

          let cleaned = caseJson.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
          }
          const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
          if (arrayMatch) cleaned = arrayMatch[0];

          const cases: {
            caseContext: string;
            questions: {
              questionText: string;
              options: string[];
              correctAnswer: number;
              explanation: string;
              difficulty: string;
            }[];
          }[] = JSON.parse(cleaned);

          let questionsCreated = 0;
          for (const c of cases) {
            for (const q of c.questions) {
              await prisma.question.create({
                data: {
                  chapterId: chapter.id,
                  questionText: String(q.questionText || ""),
                  options: JSON.stringify(q.options || []),
                  correctAnswer: Number(q.correctAnswer) || 0,
                  explanation: String(q.explanation || ""),
                  difficulty: String(q.difficulty || "medium"),
                  category: "case",
                  questionType: "case",
                  caseContext: String(c.caseContext || ""),
                },
              });
              questionsCreated++;
            }
          }

          send({
            success: true,
            casesCreated: cases.length,
            questionsCreated,
            message: `Created ${cases.length} clinical cases (${questionsCreated} questions)`,
          });
        } catch (err) {
          console.error("Case question generation error:", err);
          send({ error: err instanceof Error ? err.message : "Case generation failed" });
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
    console.error("Generate case questions error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
