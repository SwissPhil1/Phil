import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  getClaudeClient,
  CLAUDE_MODEL_FAST,
  callClaudeWithRetry,
} from "@/lib/claude";
import { ORGAN_LABELS } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/generate-image-quiz
 *
 * Takes image flashcards and generates MCQ quiz questions from them.
 * Shows the image → asks user to identify / diagnose.
 * Claude generates 3 plausible distractors for each card.
 *
 * Body: { organ?: string, limit?: number }
 *   - organ: filter flashcards by organ (optional, generates for all if omitted)
 *   - limit: max flashcards to process (default 10)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { organ, limit = 10 } = body as { organ?: string; limit?: number };

    // Find image flashcards that don't already have a linked question
    // We identify "image flashcards" as those with an imageUrl OR backImageUrl
    // from image_cases chapters
    const existingImageQuestionFlashcardIds = (
      await prisma.question.findMany({
        where: { category: "image_quiz" },
        select: { explanation: true },
      })
    )
      .map((q) => {
        // We store flashcardId in explanation metadata: "[flashcard:123]"
        const match = q.explanation?.match(/\[flashcard:(\d+)\]/);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter(Boolean) as number[];

    const whereFlashcard: Record<string, unknown> = {
      id: { notIn: existingImageQuestionFlashcardIds },
      OR: [
        { imageUrl: { not: null } },
        { backImageUrl: { not: null } },
      ],
      chapter: { bookSource: "image_cases" },
    };

    if (organ) {
      whereFlashcard.chapter = { bookSource: "image_cases", organ };
    }

    const flashcards = await prisma.flashcard.findMany({
      where: whereFlashcard,
      include: {
        chapter: { select: { id: true, organ: true, title: true } },
      },
      take: limit,
    });

    if (flashcards.length === 0) {
      return NextResponse.json({
        success: true,
        generated: 0,
        message: "Aucune nouvelle image flashcard à convertir en quiz.",
      });
    }

    const client = getClaudeClient();
    let generated = 0;

    // Process flashcards in batches to avoid overloading
    for (const fc of flashcards) {
      const organLabel = fc.chapter.organ
        ? ORGAN_LABELS[fc.chapter.organ] || fc.chapter.organ
        : "radiologie";

      // Build prompt for Claude to generate distractors
      const prompt = `Tu es un radiologue expert qui crée des questions de quiz pour un étudiant en radiologie (FMH2).

Voici une flashcard d'imagerie médicale:
- Question (front): ${fc.front}
- Réponse correcte (back): ${fc.back}
- Organe/Région: ${organLabel}
- Catégorie: ${fc.category || "imagerie"}

L'étudiant verra une image médicale et devra répondre à la question.

Génère exactement 3 distracteurs (mauvaises réponses) plausibles mais incorrects. Les distracteurs doivent:
1. Être du même type/format que la bonne réponse
2. Être plausibles pour un étudiant (erreurs courantes)
3. Être clairement faux pour un expert
4. Être concis (même longueur approximative que la bonne réponse)

Génère aussi une explication courte (2-3 phrases) en français qui explique pourquoi la bonne réponse est correcte et pourquoi les distracteurs sont faux.

Réponds UNIQUEMENT en JSON valide:
{
  "distractors": ["distractor1", "distractor2", "distractor3"],
  "explanation": "Explication ici...",
  "difficulty": "easy|medium|hard"
}`;

      try {
        const response = await callClaudeWithRetry(
          () =>
            client.messages.create({
              model: CLAUDE_MODEL_FAST,
              max_tokens: 1000,
              messages: [{ role: "user", content: prompt }],
            }),
          2,
          30_000
        );

        const text =
          response.content[0].type === "text" ? response.content[0].text : "";

        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.warn(`No JSON in response for flashcard ${fc.id}, skipping`);
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]) as {
          distractors: string[];
          explanation: string;
          difficulty: string;
        };

        if (
          !parsed.distractors ||
          parsed.distractors.length < 3 ||
          !parsed.explanation
        ) {
          console.warn(`Invalid response for flashcard ${fc.id}, skipping`);
          continue;
        }

        // Build options array: correct answer at random position
        const correctIndex = Math.floor(Math.random() * 4);
        const options: string[] = [];
        let distractorIdx = 0;
        for (let i = 0; i < 4; i++) {
          if (i === correctIndex) {
            options.push(fc.back);
          } else {
            options.push(parsed.distractors[distractorIdx++]);
          }
        }

        // Use front image if available, otherwise back image
        const questionImage = fc.imageUrl || fc.backImageUrl;

        // Create the Question record
        await prisma.question.create({
          data: {
            chapterId: fc.chapter.id,
            questionText: fc.front,
            options: JSON.stringify(options),
            correctAnswer: correctIndex,
            explanation: `${parsed.explanation}\n\n[flashcard:${fc.id}]`,
            difficulty: ["easy", "medium", "hard"].includes(parsed.difficulty)
              ? parsed.difficulty
              : "medium",
            category: "image_quiz",
            imageUrl: questionImage,
          },
        });

        generated++;
      } catch (err) {
        console.error(`Error generating quiz for flashcard ${fc.id}:`, err);
        // Continue with next flashcard
      }
    }

    return NextResponse.json({
      success: true,
      generated,
      total: flashcards.length,
      message: `${generated} question(s) de quiz générée(s) à partir d'images.`,
    });
  } catch (error) {
    console.error("Generate image quiz error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}
