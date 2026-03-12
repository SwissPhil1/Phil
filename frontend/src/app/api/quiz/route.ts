import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { ORGAN_TO_SYSTEM as FALLBACK_ORGAN_TO_SYSTEM } from "@/lib/taxonomy";

/** Get organ→system map from DB, falling back to hardcoded */
async function getOrganToSystem(): Promise<Record<string, string>> {
  try {
    const organs = await prisma.organCategory.findMany({
      include: { system: { select: { key: true } } },
    });
    if (organs.length > 0) {
      const map: Record<string, string> = {};
      for (const o of organs) map[o.key] = o.system.key;
      return map;
    }
  } catch { /* table may not exist yet */ }
  return FALLBACK_ORGAN_TO_SYSTEM;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chapterId = searchParams.get("chapterId");
  const organ = searchParams.get("organ");
  const system = searchParams.get("system");
  const difficulty = searchParams.get("difficulty");
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (chapterId) where.chapterId = parseInt(chapterId, 10);
  if (difficulty) where.difficulty = difficulty;

  // Filter by category (e.g., image_quiz for image-based questions)
  const category = searchParams.get("category");
  if (category) where.category = category;

  // Filter by organ or system via the chapter relation
  if (organ) {
    where.chapter = { organ };
  } else if (system) {
    const organToSystem = await getOrganToSystem();
    const organsInSystem = Object.entries(organToSystem)
      .filter(([, sys]) => sys === system)
      .map(([org]) => org);
    where.chapter = { organ: { in: organsInSystem } };
  }

  const allQuestions = await prisma.question.findMany({
    where,
    select: {
      id: true,
      questionText: true,
      options: true,
      correctAnswer: true,
      explanation: true,
      difficulty: true,
      category: true,
      imageUrl: true,
      questionType: true,
      caseContext: true,
      chapter: {
        select: { title: true, bookSource: true, number: true, organ: true },
      },
    },
  });

  // Fisher-Yates shuffle for unbiased randomization
  for (let i = allQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
  }

  return NextResponse.json(allQuestions.slice(0, limit));
}
