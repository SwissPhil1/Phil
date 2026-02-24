import Anthropic from "@anthropic-ai/sdk";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Allow up to 5 minutes for uploading to Files API
export const maxDuration = 300;

export const runtime = "nodejs";

/**
 * POST /api/upload-pdf
 *
 * Accepts a single PDF chunk (already page-extracted on the client) via FormData.
 * Uploads it to:
 *   1. Anthropic Files API → returns file_id for immediate Claude processing
 *   2. Vercel Blob → returns permanent URL for future re-processing
 *
 * The client handles PDF splitting — this route proxies to both storage backends.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get("pdf") as File | null;
    const filename = (formData.get("filename") as string) || "chunk.pdf";

    if (!pdfFile) {
      return NextResponse.json({ error: "Missing 'pdf' file in form data" }, { status: 400 });
    }

    let client: Anthropic;
    try {
      client = new Anthropic();
    } catch {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured." },
        { status: 500 }
      );
    }

    // Read the buffer once, reuse for both uploads
    const buffer = await pdfFile.arrayBuffer();
    const fileBuffer = Buffer.from(buffer);

    // Upload to Anthropic Files API (for immediate Claude processing)
    const file = new File([fileBuffer], filename, { type: "application/pdf" });
    const uploaded = await client.beta.files.upload({ file });

    // Upload to Vercel Blob (permanent storage for future re-processing)
    let blobUrl: string | null = null;
    try {
      const blob = await put(`pdf-chunks/${filename}`, fileBuffer, {
        access: "public",
        contentType: "application/pdf",
      });
      blobUrl = blob.url;
    } catch (blobErr) {
      // Blob storage is optional — don't fail the upload if it's not configured
      console.warn("Vercel Blob upload failed (storage may not be configured):", blobErr instanceof Error ? blobErr.message : blobErr);
    }

    return NextResponse.json({
      success: true,
      fileId: uploaded.id,
      blobUrl,
    });
  } catch (error: unknown) {
    console.error("Upload-pdf error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
