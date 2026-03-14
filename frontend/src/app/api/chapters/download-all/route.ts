import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const chapters = await prisma.chapter.findMany({
    where: {
      bookSource: { not: "image_cases" },
      studyGuide: { not: null },
    },
    select: {
      id: true,
      number: true,
      title: true,
      organ: true,
      bookSource: true,
      studyGuide: true,
    },
    orderBy: [{ bookSource: "asc" }, { number: "asc" }],
  });

  return NextResponse.json(chapters);
}
