import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { questionId, selectedAnswer, timeSpent } = body;

  if (questionId === undefined || selectedAnswer === undefined) {
    return NextResponse.json(
      { error: "questionId and selectedAnswer are required" },
      { status: 400 }
    );
  }

  const question = await prisma.question.findUnique({
    where: { id: questionId },
  });

  if (!question) {
    return NextResponse.json(
      { error: "Question not found" },
      { status: 404 }
    );
  }

  const isCorrect = selectedAnswer === question.correctAnswer;

  const attempt = await prisma.questionAttempt.create({
    data: {
      questionId,
      selectedAnswer,
      isCorrect,
      timeSpent: timeSpent || null,
    },
  });

  return NextResponse.json({
    ...attempt,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
  });
}
