import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Image upload API. Stores images as base64 data URIs in the database.
 * This avoids needing Vercel Blob in development and works everywhere.
 * For production with many images, swap to Vercel Blob or S3.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    const chapterId = formData.get("chapterId") as string | null;
    const target = formData.get("target") as string | null; // "studyGuide", "flashcard", "note"

    if (!file) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "File must be an image" }, { status: 400 });
    }

    // Limit to 5MB
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Image must be under 5MB" }, { status: 400 });
    }

    // Convert to base64 data URI
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUri = `data:${file.type};base64,${base64}`;

    // If target is "flashcard" and we have a flashcard ID, update it directly
    const flashcardId = formData.get("flashcardId") as string | null;
    if (target === "flashcard" && flashcardId) {
      try {
        await prisma.flashcard.update({
          where: { id: parseInt(flashcardId, 10) },
          data: { imageUrl: dataUri },
        });
      } catch (dbErr) {
        console.error("Failed to update flashcard image:", dbErr);
        return NextResponse.json(
          { error: "Image uploaded but failed to link to flashcard" },
          { status: 500 }
        );
      }
    }

    // If target is "question" and we have a question ID, update it
    const questionId = formData.get("questionId") as string | null;
    if (target === "question" && questionId) {
      try {
        await prisma.question.update({
          where: { id: parseInt(questionId, 10) },
          data: { imageUrl: dataUri },
        });
      } catch (dbErr) {
        console.error("Failed to update question image:", dbErr);
        return NextResponse.json(
          { error: "Image uploaded but failed to link to question" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      imageUrl: dataUri,
      size: file.size,
      chapterId: chapterId ? parseInt(chapterId, 10) : null,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}
