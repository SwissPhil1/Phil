import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CLAUDE_MODEL_FAST,
  getClaudeClient,
  callClaudeWithRetry,
} from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function buildDiagnosticPrompt(studyGuide: string): string {
  return `You are a radiology examiner. Generate exactly 8 quick diagnostic MCQ questions from this study guide.

These questions test the student BEFORE they read the guide, to identify knowledge gaps (pre-testing effect).

Rules:
- Focus on the most important/high-yield facts
- Mix question types: anatomy, pathology signs, differentials, imaging appearance
- Each question must have exactly 4 options
- Keep questions concise (1-2 sentences max)
- Write in French (keep medical terms bilingual where helpful)
- Difficulty: mix of easy (3), medium (3), hard (2)

Return ONLY a valid JSON array:
[{"questionText":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":0,"explanation":"...","difficulty":"medium"}]

STUDY GUIDE:
${studyGuide.slice(0, 30000)}`;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const chapterId = parseInt(id, 10);

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true, studyGuide: true, title: true },
    });

    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }
    if (!chapter.studyGuide) {
      return NextResponse.json({ error: "No study guide" }, { status: 400 });
    }

    const client = getClaudeClient();

    const result = await callClaudeWithRetry(
      () =>
        client.messages.create({
          model: CLAUDE_MODEL_FAST,
          max_tokens: 4000,
          messages: [
            { role: "user", content: buildDiagnosticPrompt(chapter.studyGuide!) },
          ],
        }),
      2,
      60_000
    );

    let text =
      result.content[0].type === "text" ? result.content[0].text : "";
    // Clean markdown fences
    text = text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) text = arrayMatch[0];

    const questions = JSON.parse(text);

    return NextResponse.json({
      chapterTitle: chapter.title,
      questions,
    });
  } catch (error: unknown) {
    console.error("Diagnostic quiz error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
