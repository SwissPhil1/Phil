import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/flashcards/:id — Update a flashcard's front, back, category, or imageUrl.
 * DELETE /api/flashcards/:id — Delete a flashcard and its reviews.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const flashcardId = parseInt(id, 10);
    if (isNaN(flashcardId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const body = await request.json();
    const { front, back, category, imageUrl } = body as {
      front?: string;
      back?: string;
      category?: string;
      imageUrl?: string | null;
    };

    // Build update data — only include fields that were provided
    const data: Record<string, unknown> = {};
    if (front !== undefined) data.front = front;
    if (back !== undefined) data.back = back;
    if (category !== undefined) data.category = category;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.flashcard.update({
      where: { id: flashcardId },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Flashcard update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const flashcardId = parseInt(id, 10);
    if (isNaN(flashcardId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    // Delete reviews first (foreign key), then flashcard
    await prisma.flashcardReview.deleteMany({ where: { flashcardId } });
    await prisma.flashcard.delete({ where: { id: flashcardId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Flashcard delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 }
    );
  }
}
