import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * POST /api/store-pdf
 *
 * Blob-only upload: stores a PDF chunk in Vercel Blob for permanent reference.
 * Does NOT upload to Anthropic Files API — that happens later during content generation.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get("pdf") as File | null;
    const filename = (formData.get("filename") as string) || "chunk.pdf";

    if (!pdfFile) {
      return NextResponse.json({ error: "Missing 'pdf' file in form data" }, { status: 400 });
    }

    const buffer = await pdfFile.arrayBuffer();
    const fileBuffer = Buffer.from(buffer);

    const blob = await put(`pdf-chunks/${filename}`, fileBuffer, {
      access: "public",
      contentType: "application/pdf",
    });

    return NextResponse.json({ success: true, blobUrl: blob.url });
  } catch (error: unknown) {
    console.error("Store-pdf error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
